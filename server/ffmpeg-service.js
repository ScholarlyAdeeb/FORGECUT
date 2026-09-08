/**
 * ForgeCut — server-side FFmpeg encoding service.
 *
 * Turns a captured master (what the browser can record quickly) into a real
 * container with real codecs. The browser can only record WebM/VP8/VP9 — and,
 * depending on the build, H.264 — so every other format the product advertises
 * has to be produced by an actual muxer rather than by renaming a file.
 *
 * Security posture, because this is the only write-capable surface in the app:
 *
 *   - FFmpeg is invoked with spawn() and an ARGUMENT ARRAY, never a shell
 *     string. There is no interpolation of user data into a command line, so
 *     there is nothing for shell metacharacters to escape into.
 *   - Callers never supply a path. Every input and output path is derived from
 *     a server-generated job id inside a per-job temp directory, and is
 *     re-checked with path.resolve() before use.
 *   - Codec and container names are looked up in the ExportConfig tables and
 *     rejected if unknown; the values that reach argv are the table's, not the
 *     caller's.
 *   - Every job has a wall-clock timeout and its process tree is killed on
 *     cancel, timeout, or process exit. Temp directories are removed in all
 *     paths, including on SIGINT/SIGTERM.
 */
'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const EC = require('../public/engine/ExportConfig.js');

const FFMPEG = process.env.FORGECUT_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FORGECUT_FFPROBE || 'ffprobe';

const ROOT_TMP = path.join(os.tmpdir(), 'forgecut-export');
const JOB_TIMEOUT_MS = Number(process.env.FORGECUT_EXPORT_TIMEOUT_MS || 30 * 60 * 1000);
const MAX_UPLOAD_BYTES = Number(process.env.FORGECUT_MAX_UPLOAD || 2 * 1024 * 1024 * 1024);

/* ────────────────────────── capability probing ────────────────────────── */

let _caps = null;

function run(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: timeoutMs || 15000, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
    });
}

/**
 * Discover what this machine's FFmpeg can actually do.
 *
 * The result is cached: it cannot change while the process is alive, and
 * shelling out per request would be both slow and a denial-of-service lever.
 */
async function probeCapabilities() {
    if (_caps) return _caps;

    const version = await run(FFMPEG, ['-hide_banner', '-version']);
    if (version.err) {
        _caps = {
            available: false,
            reason: version.err.code === 'ENOENT'
                ? 'FFmpeg is not installed or not on PATH.'
                : `FFmpeg failed to start: ${version.err.message}`,
            encoders: [], muxers: [], ffprobe: false
        };
        return _caps;
    }

    const [encRes, muxRes, probeRes] = await Promise.all([
        run(FFMPEG, ['-hide_banner', '-encoders']),
        run(FFMPEG, ['-hide_banner', '-muxers']),
        run(FFPROBE, ['-hide_banner', '-version'])
    ]);

    // Encoders and muxers print different flag-field widths, so one pattern
    // cannot read both:
    //   encoders " V....D libx264    libx264 H.264 ..."  6 flag chars
    //   muxers   "  E  matroska      Matroska"           3 flag chars
    const parseNames = (text, flagClass) => {
        const out = new Set();
        const re = new RegExp('^\\s*[' + flagClass + ']{2,6}\\s+([A-Za-z0-9_,\\-]+)(?:\\s|$)');
        text.split(/\r?\n/).forEach(line => {
            const m = line.match(re);
            if (m) m[1].split(',').forEach(n => out.add(n));
        });
        return out;
    };

    const encoders = parseNames(encRes.stdout, 'A-Z.');
    const muxers = parseNames(muxRes.stdout, 'DEd. ');

    const videoCodecs = Object.keys(EC.VIDEO_CODECS).filter(k => encoders.has(EC.VIDEO_CODECS[k].encoder));
    const audioCodecs = Object.keys(EC.AUDIO_CODECS).filter(k => encoders.has(EC.AUDIO_CODECS[k].encoder));
    const containers = Object.keys(EC.CONTAINERS).filter(k => {
        // FFmpeg's muxer names do not all match our extension names.
        const muxerFor = { mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov', mp3: 'mp3', wav: 'wav', m4a: 'ipod' };
        return muxers.has(muxerFor[k]);
    });

    _caps = {
        available: true,
        version: (version.stdout.split(/\r?\n/)[0] || '').trim(),
        ffprobe: !probeRes.err,
        containers, videoCodecs, audioCodecs,
        encoders: [...encoders]
    };
    return _caps;
}

/* ─────────────────────────── argument building ─────────────────────────── */

/**
 * Build the FFmpeg argument vector for a validated export configuration.
 *
 * Pure and synchronous so it can be unit-tested without spawning anything —
 * the argument vector IS the security boundary, so it is the thing most worth
 * asserting on.
 */
function buildArgs(config, inputPath, outputPath, opts) {
    opts = opts || {};
    const check = EC.validate(config);
    if (!check.ok) {
        const e = new Error(check.errors.join(' '));
        e.code = 'EINVALIDCONFIG';
        throw e;
    }
    const cfg = check.config;
    const container = EC.CONTAINERS[cfg.container];

    const args = ['-hide_banner', '-nostdin', '-y'];

    // Machine-readable progress on stdout, so progress comes from the encoder
    // itself rather than from a timer guessing at it.
    args.push('-progress', 'pipe:1', '-nostats');
    args.push('-i', inputPath);

    if (cfg.videoCodec) {
        const vc = EC.VIDEO_CODECS[cfg.videoCodec];
        args.push('-c:v', vc.encoder);
        args.push('-pix_fmt', vc.pixFmt);

        if (cfg.resolution && cfg.resolution !== 'source') {
            args.push('-s', `${cfg.resolution.width}x${cfg.resolution.height}`);
        }
        if (cfg.frameRate && cfg.frameRate !== 'source') {
            args.push('-r', String(cfg.frameRate));
        }
        if (cfg.bitrate) {
            args.push('-b:v', `${cfg.bitrate}k`);
        }
        if (cfg.videoCodec === 'h264' || cfg.videoCodec === 'h265') {
            args.push('-preset', opts.preset || 'medium');
        }
        if (cfg.videoCodec === 'vp9') {
            // Without this libvpx-vp9 defaults to single-threaded and is
            // dramatically slower on multi-core machines.
            args.push('-row-mt', '1');
        }
        if (cfg.videoCodec === 'prores') {
            args.push('-profile:v', '3'); // ProRes 422 HQ
        }
    } else {
        args.push('-vn');
    }

    if (cfg.audioCodec) {
        const ac = EC.AUDIO_CODECS[cfg.audioCodec];
        args.push('-c:a', ac.encoder);
        if (cfg.audioBitrate && !ac.lossless) args.push('-b:a', `${cfg.audioBitrate}k`);
        if (cfg.audioSampleRate) args.push('-ar', String(cfg.audioSampleRate));
    } else {
        args.push('-an');
    }

    if (container.faststart) {
        // Move the moov atom to the front so the file can start playing before
        // it has fully downloaded.
        args.push('-movflags', '+faststart');
    }

    // Name the muxer explicitly. Relying on the output extension would mean the
    // filename decided the container, which is the exact confusion this
    // pipeline exists to remove.
    const muxerFor = { mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov', mp3: 'mp3', wav: 'wav', m4a: 'ipod' };
    args.push('-f', muxerFor[cfg.container]);

    args.push(outputPath);
    return args;
}

/* ────────────────────────────── job registry ───────────────────────────── */

const STATES = ['QUEUED', 'PREPARING', 'ENCODING', 'FINALIZING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const jobs = new Map();

function newJobId() {
    return crypto.randomUUID();
}

/** Resolve a path inside a job directory, refusing anything that escapes it. */
function safeJoin(dir, name) {
    const full = path.resolve(dir, name);
    const base = path.resolve(dir) + path.sep;
    if (!full.startsWith(base)) {
        const e = new Error('Refusing to resolve a path outside the job directory.');
        e.code = 'EPATHESCAPE';
        throw e;
    }
    return full;
}

async function createJob(config) {
    const check = EC.validate(config);
    if (!check.ok) {
        const e = new Error(check.errors.join(' '));
        e.code = 'EINVALIDCONFIG';
        throw e;
    }
    const id = newJobId();
    const dir = path.join(ROOT_TMP, id);
    await fsp.mkdir(dir, { recursive: true });

    const job = {
        id, dir,
        config: check.config,
        state: 'QUEUED',
        progress: 0,
        durationSec: null,
        error: null,
        log: [],            // structured trace, kept server-side
        outputPath: null,
        outputBytes: 0,
        validation: null,
        proc: null,
        createdAt: Date.now(),
        cancelled: false
    };
    jobs.set(id, job);
    return job;
}

function getJob(id) {
    // Ids are UUIDs generated here; a lookup miss is simply "unknown job".
    return jobs.get(String(id)) || null;
}

function setState(job, state, detail) {
    if (STATES.indexOf(state) === -1) throw new Error(`Invalid job state ${state}`);
    job.state = state;
    job.log.push({ t: Date.now(), state, detail: detail || null });
}

/**
 * Parse FFmpeg's `-progress pipe:1` stream, which emits key=value lines and a
 * `progress=continue|end` terminator per block.
 */
function makeProgressParser(job) {
    let buf = '';
    return (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const key = line.slice(0, eq).trim();
            const value = line.slice(eq + 1).trim();
            if (key === 'out_time_us' || key === 'out_time_ms') {
                // out_time_ms is misnamed upstream: it is microseconds.
                const us = Number(value);
                if (isFinite(us) && job.durationSec > 0) {
                    job.progress = Math.max(0, Math.min(1, (us / 1e6) / job.durationSec));
                }
            } else if (key === 'frame') {
                job.frame = Number(value) || job.frame;
            } else if (key === 'fps') {
                job.fps = Number(value) || 0;
            } else if (key === 'total_size') {
                job.outputBytes = Number(value) || job.outputBytes;
            }
        }
    };
}

/**
 * Run FFmpeg for a job whose input has already been written to disk.
 */
async function encodeJob(job, inputName) {
    const caps = await probeCapabilities();
    if (!caps.available) {
        setState(job, 'FAILED', caps.reason);
        job.error = caps.reason;
        throw new Error(caps.reason);
    }

    const inputPath = safeJoin(job.dir, inputName);
    const outName = `output.${EC.CONTAINERS[job.config.container].ext}`;
    const outputPath = safeJoin(job.dir, outName);

    setState(job, 'PREPARING');
    job.durationSec = await probeDuration(inputPath).catch(() => null);

    const args = buildArgs(job.config, inputPath, outputPath);
    job.log.push({ t: Date.now(), argv: args });

    setState(job, 'ENCODING');

    await new Promise((resolve, reject) => {
        // shell:false is the default for spawn, stated explicitly because it is
        // the property that makes the argument array safe.
        const proc = spawn(FFMPEG, args, { shell: false, windowsHide: true });
        job.proc = proc;

        const onProgress = makeProgressParser(job);
        let stderrTail = [];

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', onProgress);
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (d) => {
            stderrTail.push(d);
            if (stderrTail.length > 80) stderrTail = stderrTail.slice(-80);
        });

        const timer = setTimeout(() => {
            job.timedOut = true;
            killTree(proc);
        }, JOB_TIMEOUT_MS);

        proc.on('error', (err) => {
            clearTimeout(timer);
            job.proc = null;
            reject(err);
        });

        proc.on('close', (code, signal) => {
            clearTimeout(timer);
            job.proc = null;
            job.stderr = stderrTail.join('');
            if (job.cancelled) return reject(Object.assign(new Error('Export cancelled'), { code: 'ECANCELLED' }));
            if (job.timedOut) return reject(Object.assign(new Error(`Export exceeded ${Math.round(JOB_TIMEOUT_MS / 1000)}s and was stopped`), { code: 'ETIMEOUT' }));
            if (code === 0) return resolve();
            reject(Object.assign(new Error(describeFfmpegFailure(job.stderr, code, signal)), { code: 'EENCODE' }));
        });
    });

    setState(job, 'FINALIZING');
    const stat = await fsp.stat(outputPath);
    job.outputPath = outputPath;
    job.outputBytes = stat.size;
    job.progress = 1;
    return outputPath;
}

/**
 * Turn FFmpeg's stderr into something a user can act on. The raw tail is kept
 * in the job log either way.
 */
function describeFfmpegFailure(stderr, code, signal) {
    const s = String(stderr || '');
    if (/Unknown encoder|Encoder .* not found/i.test(s)) {
        const m = s.match(/Unknown encoder '([^']+)'/);
        return `This FFmpeg build has no encoder${m ? ` for ${m[1]}` : ''}. Choose a different codec, or install a full FFmpeg build.`;
    }
    if (/No space left on device|ENOSPC/i.test(s)) return 'The disk ran out of space while writing the export.';
    if (/Permission denied|EACCES/i.test(s)) return 'Permission denied writing the export file.';
    if (/Invalid data found|moov atom not found/i.test(s)) return 'The captured source was unreadable — the recording may have been interrupted.';
    if (/(?:width|height) not divisible by 2/i.test(s)) return 'The chosen resolution has odd dimensions, which this codec cannot encode.';
    if (/Conversion failed/i.test(s)) return 'FFmpeg could not convert the source to the requested format.';
    if (signal) return `Encoder terminated by signal ${signal}.`;
    return `Encoder exited with code ${code}.`;
}

async function probeDuration(file) {
    const res = await run(FFPROBE, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file
    ]);
    if (res.err) return null;
    const d = parseFloat(String(res.stdout).trim());
    return isFinite(d) && d > 0 ? d : null;
}

/**
 * Multi-stage validation of a finished file: it must be non-empty, parse as the
 * container we asked for, carry the streams we asked for, have a plausible
 * duration, and actually decode.
 */
async function validateOutput(job) {
    setState(job, 'VALIDATING');
    const file = job.outputPath;
    const cfg = job.config;
    const result = { ok: false, checks: {}, problems: [] };

    const stat = await fsp.stat(file).catch(() => null);
    result.checks.nonEmpty = !!(stat && stat.size > 0);
    if (!result.checks.nonEmpty) {
        result.problems.push('Output file is missing or empty.');
        job.validation = result;
        return result;
    }
    result.bytes = stat.size;

    const caps = await probeCapabilities();
    if (!caps.ffprobe) {
        result.checks.probed = false;
        result.problems.push('ffprobe unavailable — container and streams were not verified.');
        result.ok = true; // do not fail an export purely because the validator is missing
        job.validation = result;
        return result;
    }

    const res = await run(FFPROBE, [
        '-v', 'error', '-print_format', 'json',
        '-show_format', '-show_streams', file
    ]);
    if (res.err) {
        result.problems.push('ffprobe could not parse the output container.');
        job.validation = result;
        return result;
    }

    let info;
    try { info = JSON.parse(res.stdout); } catch (e) {
        result.problems.push('ffprobe returned unparseable output.');
        job.validation = result;
        return result;
    }

    const streams = info.streams || [];
    const v = streams.filter(s => s.codec_type === 'video');
    const a = streams.filter(s => s.codec_type === 'audio');
    result.container = (info.format && info.format.format_name) || '';
    result.duration = parseFloat((info.format && info.format.duration) || '0') || 0;
    result.videoCodec = v[0] ? v[0].codec_name : null;
    result.audioCodec = a[0] ? a[0].codec_name : null;
    result.width = v[0] ? v[0].width : null;
    result.height = v[0] ? v[0].height : null;
    result.frameRate = v[0] ? v[0].r_frame_rate : null;

    // Container identity. ffprobe reports families ("mov,mp4,m4a,3gp,3g2,mj2").
    const expectFamily = {
        mp4: /mp4|mov/, mov: /mov|mp4/, mkv: /matroska|webm/, webm: /webm|matroska/,
        mp3: /mp3/, wav: /wav/, m4a: /mov|mp4|m4a/
    }[cfg.container];
    result.checks.container = expectFamily ? expectFamily.test(result.container) : true;
    if (!result.checks.container) {
        result.problems.push(`Container is "${result.container}", expected ${cfg.container}.`);
    }

    // Streams present as configured.
    result.checks.videoStream = cfg.videoCodec ? v.length > 0 : v.length === 0;
    if (!result.checks.videoStream) {
        result.problems.push(cfg.videoCodec ? 'Expected a video stream and found none.' : 'Found an unexpected video stream in an audio-only export.');
    }
    result.checks.audioStream = cfg.audioCodec ? a.length > 0 : true;
    if (cfg.audioCodec && a.length === 0) result.problems.push('Expected an audio stream and found none.');

    // Codec identity, mapping our names onto ffprobe's.
    const codecAlias = { h264: 'h264', h265: 'hevc', vp8: 'vp8', vp9: 'vp9', prores: 'prores', ffv1: 'ffv1' };
    if (cfg.videoCodec && v[0]) {
        result.checks.videoCodec = v[0].codec_name === codecAlias[cfg.videoCodec];
        if (!result.checks.videoCodec) result.problems.push(`Video codec is ${v[0].codec_name}, expected ${codecAlias[cfg.videoCodec]}.`);
    }
    const aAlias = { aac: 'aac', mp3: 'mp3', opus: 'opus', vorbis: 'vorbis', pcm_s16le: 'pcm_s16le' };
    if (cfg.audioCodec && a[0]) {
        result.checks.audioCodec = a[0].codec_name === aAlias[cfg.audioCodec];
        if (!result.checks.audioCodec) result.problems.push(`Audio codec is ${a[0].codec_name}, expected ${aAlias[cfg.audioCodec]}.`);
    }

    // Duration sanity against the source.
    if (job.durationSec) {
        const drift = Math.abs(result.duration - job.durationSec);
        result.checks.duration = drift <= Math.max(0.5, job.durationSec * 0.05);
        result.durationDriftSec = +drift.toFixed(3);
        if (!result.checks.duration) {
            result.problems.push(`Duration ${result.duration.toFixed(2)}s differs from the source ${job.durationSec.toFixed(2)}s.`);
        }
    }

    // Decodability: actually decode every packet and discard the output. This
    // is what separates "the header parses" from "the file plays".
    const decode = await run(FFMPEG, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], 120000);
    result.checks.decodes = !decode.err && !/error|invalid/i.test(decode.stderr || '');
    if (!result.checks.decodes) {
        result.problems.push('The file did not decode cleanly.');
        result.decodeStderr = String(decode.stderr || '').slice(0, 400);
    }

    result.ok = result.problems.length === 0;
    job.validation = result;
    return result;
}

/* ─────────────────────────── lifecycle control ─────────────────────────── */

/**
 * Kill an encoder and RESOLVE ONLY ONCE IT HAS ACTUALLY EXITED.
 *
 * The wait matters on Windows: taskkill is asynchronous, and until FFmpeg has
 * really gone it still holds an open handle on the partially written output.
 * Removing the job directory before then fails with EBUSY and leaves the
 * partial file on disk, which is exactly what a cancel is supposed to prevent.
 */
function killTree(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return Promise.resolve();

    const exited = new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        proc.once('close', finish);
        proc.once('exit', finish);
        // Never hang a cancel on a process that refuses to die.
        setTimeout(finish, 8000);
    });

    try {
        if (process.platform === 'win32') {
            // FFmpeg on Windows does not reliably die from SIGTERM, and killing
            // only the parent would orphan its children.
            execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
        } else {
            proc.kill('SIGTERM');
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 3000);
        }
    } catch (e) { /* already gone */ }

    return exited;
}

/** Synchronous best-effort kill, for process exit handlers only. */
function killTreeSync(proc) {
    if (!proc) return;
    try {
        if (process.platform === 'win32') {
            execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
        } else {
            proc.kill('SIGKILL');
        }
    } catch (e) { /* already gone */ }
}

/**
 * Remove a directory, retrying briefly while the OS still reports it locked.
 * fs.rm's own `maxRetries` does not cover every Windows lock error here.
 */
async function rmWithRetry(target, attempts) {
    attempts = attempts || 6;
    for (let i = 0; i < attempts; i++) {
        try {
            await fsp.rm(target, { recursive: true, force: true });
            if (!fs.existsSync(target)) return true;
        } catch (e) {
            if (i === attempts - 1) throw e;
        }
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
    }
    return !fs.existsSync(target);
}

async function cancelJob(id) {
    const job = getJob(id);
    if (!job) return false;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].indexOf(job.state) !== -1) return false;
    job.cancelled = true;
    // Wait for the encoder to actually exit, otherwise the purge below races
    // an open file handle and silently leaves the partial output behind.
    await killTree(job.proc);
    setState(job, 'CANCELLED');
    // A partially written file is not a valid export and must not be
    // downloadable, so it goes immediately rather than at cleanup time.
    await cleanupJob(job, { keepOutput: false });
    return true;
}

async function cleanupJob(job, opts) {
    opts = opts || {};
    try {
        if (opts.keepOutput && job.outputPath) {
            const entries = await fsp.readdir(job.dir);
            await Promise.all(entries
                .filter(n => path.join(job.dir, n) !== job.outputPath)
                .map(n => fsp.rm(path.join(job.dir, n), { force: true, recursive: true })));
        } else {
            await rmWithRetry(job.dir);
            job.outputPath = null;
        }
    } catch (e) {
        console.error('[ForgeCut] temp cleanup failed for job', job.id, e && e.message);
    }
}

async function disposeJob(id) {
    const job = getJob(id);
    if (!job) return false;
    await killTree(job.proc);
    await cleanupJob(job, { keepOutput: false });
    jobs.delete(job.id);
    return true;
}

/** Remove jobs whose files are older than `maxAgeMs`. */
async function sweep(maxAgeMs) {
    const cutoff = Date.now() - (maxAgeMs || 60 * 60 * 1000);
    for (const job of [...jobs.values()]) {
        if (job.createdAt < cutoff && !job.proc) await disposeJob(job.id);
    }
    // Also clear orphaned directories from a previous process.
    try {
        const entries = await fsp.readdir(ROOT_TMP).catch(() => []);
        for (const name of entries) {
            if (jobs.has(name)) continue;
            const p = path.join(ROOT_TMP, name);
            const st = await fsp.stat(p).catch(() => null);
            if (st && st.mtimeMs < cutoff) await fsp.rm(p, { recursive: true, force: true });
        }
    } catch (e) { /* best effort */ }
}

/** Kill every running encode and remove every temp directory. */
function shutdownSync() {
    for (const job of jobs.values()) killTreeSync(job.proc);
    try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

module.exports = {
    FFMPEG, FFPROBE, ROOT_TMP, STATES, MAX_UPLOAD_BYTES, JOB_TIMEOUT_MS,
    probeCapabilities, buildArgs, safeJoin,
    createJob, getJob, encodeJob, validateOutput, cancelJob, disposeJob, cleanupJob,
    sweep, shutdownSync, describeFfmpegFailure, probeDuration, killTree, rmWithRetry,
    _jobs: jobs
};
