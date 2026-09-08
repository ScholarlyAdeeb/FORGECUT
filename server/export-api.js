/**
 * ForgeCut — export HTTP API.
 *
 * The rest of the server is deliberately read-only (every non-GET is refused
 * with 405). This router is the single exception, so it is scoped as tightly as
 * possible: a fixed set of paths, a UUID-shaped id, a byte cap on uploads, and
 * no path or command string ever taken from the client.
 *
 * Job lifecycle, mirrored to the client:
 *   QUEUED -> PREPARING -> ENCODING -> FINALIZING -> VALIDATING -> COMPLETED
 *                                                          \-> FAILED
 *                                                          \-> CANCELLED
 */
'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const svc = require('./ffmpeg-service.js');
const EC = require('../public/engine/ExportConfig.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the shape the client is allowed to see. Never the temp path or argv. */
function publicJob(job) {
    return {
        id: job.id,
        state: job.state,
        progress: Math.round((job.progress || 0) * 1000) / 1000,
        frame: job.frame || 0,
        fps: job.fps || 0,
        durationSec: job.durationSec,
        bytes: job.outputBytes || 0,
        filename: job.filename || null,
        config: job.config,
        error: job.error || null,
        validation: job.validation
            ? { ok: job.validation.ok, problems: job.validation.problems, checks: job.validation.checks,
                container: job.validation.container, videoCodec: job.validation.videoCodec,
                audioCodec: job.validation.audioCodec, duration: job.validation.duration,
                width: job.validation.width, height: job.validation.height }
            : null
    };
}

function findJob(req, res) {
    const id = req.params.id;
    if (!UUID_RE.test(String(id || ''))) {
        res.status(400).json({ error: 'Malformed job id.' });
        return null;
    }
    const job = svc.getJob(id);
    if (!job) {
        res.status(404).json({ error: 'Unknown or expired export job.' });
        return null;
    }
    return job;
}

function createRouter() {
    const router = express.Router();

    router.use(express.json({ limit: '256kb' }));

    /** What this deployment can actually produce, probed from the real binary. */
    router.get('/capabilities', async (req, res) => {
        const caps = await svc.probeCapabilities();
        res.json({
            backend: 'server-ffmpeg',
            available: caps.available,
            reason: caps.reason || null,
            version: caps.version || null,
            ffprobe: !!caps.ffprobe,
            containers: caps.containers || [],
            videoCodecs: caps.videoCodecs || [],
            audioCodecs: caps.audioCodecs || [],
            maxUploadBytes: svc.MAX_UPLOAD_BYTES,
            jobTimeoutMs: svc.JOB_TIMEOUT_MS
        });
    });

    /** Create a job from a configuration. No media yet. */
    router.post('/jobs', async (req, res) => {
        const body = req.body || {};
        const check = EC.validate(body.config || {});
        if (!check.ok) {
            return res.status(422).json({ error: 'Invalid export configuration.', problems: check.errors });
        }
        const caps = await svc.probeCapabilities();
        if (!caps.available) {
            return res.status(503).json({ error: caps.reason, fallback: 'Use the in-browser encoder instead.' });
        }
        const cfg = check.config;
        if (caps.containers.indexOf(cfg.container) === -1) {
            return res.status(422).json({ error: `This server's FFmpeg cannot mux ${cfg.container}.` });
        }
        if (cfg.videoCodec && caps.videoCodecs.indexOf(cfg.videoCodec) === -1) {
            return res.status(422).json({ error: `This server's FFmpeg has no encoder for ${cfg.videoCodec}.` });
        }
        if (cfg.audioCodec && caps.audioCodecs.indexOf(cfg.audioCodec) === -1) {
            return res.status(422).json({ error: `This server's FFmpeg has no encoder for ${cfg.audioCodec}.` });
        }

        try {
            const job = await svc.createJob(cfg);
            // The display name is preserved as the user typed it; only the
            // on-disk/ZIP name is sanitised.
            job.filename = EC.sanitiseFilename(body.name || 'export', EC.CONTAINERS[cfg.container].ext);
            res.status(201).json(publicJob(job));
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    /**
     * Upload the captured master for a job, streamed straight to disk.
     *
     * Deliberately streamed rather than buffered: a long 4K capture is far too
     * large to hold in the Node heap, and buffering it was how the browser side
     * used to fall over too.
     */
    router.put('/jobs/:id/source', (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        if (job.state !== 'QUEUED') {
            return res.status(409).json({ error: `Job is ${job.state}; source can only be uploaded while QUEUED.` });
        }

        let target;
        try {
            target = svc.safeJoin(job.dir, 'source.bin');
        } catch (e) {
            return res.status(400).json({ error: 'Invalid job directory.' });
        }

        let received = 0;
        let aborted = false;
        const out = fs.createWriteStream(target);

        const fail = (status, message) => {
            if (aborted) return;
            aborted = true;
            req.unpipe(out);
            out.destroy();
            fsp.rm(target, { force: true }).catch(() => {});
            if (!res.headersSent) res.status(status).json({ error: message });
        };

        req.on('data', (chunk) => {
            received += chunk.length;
            if (received > svc.MAX_UPLOAD_BYTES) {
                fail(413, `Upload exceeds the ${Math.round(svc.MAX_UPLOAD_BYTES / 1048576)} MB limit.`);
            }
        });
        req.on('aborted', () => fail(400, 'Upload aborted.'));
        out.on('error', (err) => fail(500, `Could not write upload: ${err.message}`));
        out.on('finish', () => {
            if (aborted) return;
            if (received === 0) return fail(400, 'Upload was empty.');
            job.sourceBytes = received;
            res.json({ ok: true, bytes: received });
        });

        req.pipe(out);
    });

    /** Begin encoding. Returns immediately; poll GET /jobs/:id for progress. */
    router.post('/jobs/:id/start', async (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        if (job.state !== 'QUEUED') {
            return res.status(409).json({ error: `Job is already ${job.state}.` });
        }
        if (!job.sourceBytes) {
            return res.status(409).json({ error: 'No source uploaded for this job.' });
        }

        res.status(202).json(publicJob(job));

        // Fire and forget; the client polls. Errors are recorded on the job
        // rather than thrown into an already-answered request.
        (async () => {
            try {
                await svc.encodeJob(job, 'source.bin');
                await svc.validateOutput(job);
                if (job.validation && !job.validation.ok) {
                    job.state = 'FAILED';
                    job.error = job.validation.problems.join(' ');
                    job.log.push({ t: Date.now(), state: 'FAILED', detail: job.error });
                } else {
                    job.state = 'COMPLETED';
                    job.log.push({ t: Date.now(), state: 'COMPLETED' });
                }
                // The source is no longer needed once the output exists.
                await svc.cleanupJob(job, { keepOutput: true });
            } catch (e) {
                if (e && e.code === 'ECANCELLED') return; // cancelJob already set state
                job.state = 'FAILED';
                job.error = e && e.message ? e.message : String(e);
                job.log.push({ t: Date.now(), state: 'FAILED', detail: job.error, stderr: job.stderr || null });
                await svc.cleanupJob(job, { keepOutput: false });
            }
        })();
    });

    /** Status and real progress. */
    router.get('/jobs/:id', (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        res.json(publicJob(job));
    });

    /** Full structured trace, for diagnostics rather than the progress UI. */
    router.get('/jobs/:id/log', (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        res.json({ id: job.id, log: job.log, stderr: job.stderr || null });
    });

    router.get('/jobs/:id/download', async (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        if (job.state !== 'COMPLETED' || !job.outputPath) {
            return res.status(409).json({ error: `Job is ${job.state}; nothing to download.` });
        }
        const stat = await fsp.stat(job.outputPath).catch(() => null);
        if (!stat) return res.status(410).json({ error: 'Export output has been cleaned up.' });

        res.setHeader('Content-Type', EC.CONTAINERS[job.config.container].mime);
        res.setHeader('Content-Length', stat.size);
        // RFC 5987 form keeps non-ASCII names intact for clients that support it.
        const safe = job.filename || `export.${EC.CONTAINERS[job.config.container].ext}`;
        res.setHeader('Content-Disposition',
            `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
        fs.createReadStream(job.outputPath).pipe(res);
    });

    /** Cancel a running job, or discard a finished one. */
    router.delete('/jobs/:id', async (req, res) => {
        const job = findJob(req, res);
        if (!job) return;
        const wasRunning = ['QUEUED', 'PREPARING', 'ENCODING', 'FINALIZING', 'VALIDATING'].indexOf(job.state) !== -1;
        if (wasRunning) {
            await svc.cancelJob(job.id);
            return res.json({ ok: true, cancelled: true, state: job.state });
        }
        await svc.disposeJob(job.id);
        res.json({ ok: true, cancelled: false, disposed: true });
    });

    return router;
}

module.exports = { createRouter, publicJob, UUID_RE };
