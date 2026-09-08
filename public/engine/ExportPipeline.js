/**
 * ForgeCut — Export Pipeline.
 *
 * One export = capture a master, then produce the real container.
 *
 * Capture is done with MediaRecorder because it is hardware-backed and runs at
 * real time; muxing is done by an actual muxer (server FFmpeg, or ffmpeg.wasm
 * when there is no server) because that is the only way a requested container
 * is the container that comes out. When the browser can already record exactly
 * what was asked for, the second step is skipped entirely.
 *
 * Job lifecycle, identical to the server's so the two can be reported as one:
 *
 *   QUEUED -> PREPARING -> ENCODING -> FINALIZING -> VALIDATING -> COMPLETED
 *                                                           \-> FAILED
 *                                                           \-> CANCELLED
 *
 * Cancellation is real at every stage: it stops the capture loop, aborts the
 * in-flight upload, tells the server to kill its FFmpeg process, and
 * terminates the wasm worker.
 */
(function () {
    'use strict';

    const STATES = ['QUEUED', 'PREPARING', 'ENCODING', 'FINALIZING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED'];

    const EC = () => window.ForgeCut && window.ForgeCut.ExportConfig;
    const CR = () => window.ForgeCut && window.ForgeCut.CapabilityRegistry;

    let _jobSeq = 0;

    /** A cancellable unit of export work. */
    function createJob(config, name) {
        return {
            id: `local_${++_jobSeq}`,
            config,
            name: name || 'export',
            state: 'QUEUED',
            progress: 0,
            stage: null,
            backend: null,
            bytes: 0,
            blob: null,
            filename: null,
            validation: null,
            error: null,
            log: [],
            cancelled: false,
            _abort: new AbortController(),
            _recorder: null,
            _serverJobId: null,
            _wasm: null
        };
    }

    function setState(job, next, detail) {
        if (STATES.indexOf(next) === -1) throw new Error(`Invalid state ${next}`);
        job.state = next;
        job.log.push({ t: Date.now(), state: next, detail: detail || null });
        emit(job, 'state');
    }

    function emit(job, kind) {
        if (typeof job.onUpdate === 'function') {
            try { job.onUpdate({ kind, job: publicView(job) }); } catch (e) { /* listener's problem */ }
        }
    }

    function publicView(job) {
        return {
            id: job.id, state: job.state, progress: job.progress, stage: job.stage,
            backend: job.backend, bytes: job.bytes, filename: job.filename,
            validation: job.validation, error: job.error, config: job.config
        };
    }

    function setProgress(job, stage, value) {
        job.stage = stage;
        job.progress = Math.max(0, Math.min(1, value));
        emit(job, 'progress');
    }

    function cancelled(job) {
        if (job.cancelled) {
            const e = new Error('Export cancelled');
            e.code = 'ECANCELLED';
            throw e;
        }
    }

    /* ─────────────────────────── stage 1: capture ─────────────────────────── */

    function waitUntil(deadline) {
        const remaining = deadline - performance.now();
        return new Promise(r => setTimeout(r, remaining > 0 ? remaining : 0));
    }

    /**
     * Record the composed canvas in real time.
     *
     * captureStream samples the canvas on the wall clock, so the loop is paced
     * to an absolute per-frame deadline. Pacing on requestAnimationFrame
     * instead ties the result to the display refresh rate and plays back at 2x
     * on a 60Hz monitor for a 30fps export.
     */
    async function captureMaster(job, appState, renderFn, options) {
        const canvas = options.canvas;
        const fps = options.fps || 30;
        const duration = options.duration || appState.duration;
        const profile = options.profile;

        setState(job, 'PREPARING');
        const stream = canvas.captureStream(fps);

        // Mix the timeline's audio into the capture so A/V stay in one file and
        // therefore in sync; a separate audio render would have to be aligned
        // again afterwards.
        let audioCtx = null;
        let startAudio = null;
        if (profile && profile.audioCodec) {
            try {
                const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
                if (AE && typeof AE.renderOfflineAudio === 'function') {
                    const buffer = await AE.renderOfflineAudio(appState.tracks, duration, 48000);
                    if (buffer) {
                        audioCtx = new AudioContext();
                        const dest = audioCtx.createMediaStreamDestination();
                        const src = audioCtx.createBufferSource();
                        src.buffer = buffer;
                        src.connect(dest);
                        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

                        // Deliberately NOT started here. Starting the buffer
                        // while the graph is still being built plays the head of
                        // the mix before MediaRecorder is running, so the audio
                        // track is short by the recorder's startup latency and
                        // ends early — an audio-only export then came out
                        // measurably shorter than the timeline (0.5s on a 2s
                        // clip) and drifted against the video on longer ones.
                        // The source is started immediately after
                        // recorder.start() instead, so both streams begin
                        // together.
                        startAudio = () => { try { src.start(); } catch (e) { /* already started */ } };
                    }
                }
            } catch (e) {
                job.log.push({ t: Date.now(), warning: `Audio mix failed: ${e && e.message}` });
            }
        }

        cancelled(job);

        let recorder;
        try {
            recorder = new MediaRecorder(stream, { mimeType: profile.mime });
        } catch (e) {
            recorder = new MediaRecorder(stream);
        }
        job._recorder = recorder;

        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

        const finished = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: profile.mime.split(';')[0] }));
            recorder.onerror = (e) => reject(e && e.error ? e.error : new Error('Recorder failed'));
        });

        // A freshly constructed AudioContext reports 'running' before its clock
        // has actually started, and MediaRecorder will happily begin without
        // the audio track producing samples yet. The first audio-only export of
        // a session then came out ~0.5s short of the timeline while every
        // later one was correct. Resume, then wait for currentTime to actually
        // advance, so both streams are live before recording starts.
        if (audioCtx) {
            try { if (audioCtx.state === 'suspended') await audioCtx.resume(); } catch (e) { /* stays suspended */ }
            const clockDeadline = performance.now() + 500;
            while (audioCtx.currentTime === 0 && performance.now() < clockDeadline) {
                await new Promise(r => setTimeout(r, 10));
            }
        }

        setState(job, 'ENCODING');
        recorder.start();
        if (startAudio) startAudio();

        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        const started = performance.now();
        const origTime = appState.currentTime;

        try {
            for (let frame = 0; frame < totalFrames; frame++) {
                if (job.cancelled) {
                    try { recorder.stop(); } catch (e) { /* already stopped */ }
                    break;
                }
                appState.currentTime = frame / fps;
                renderFn();
                setProgress(job, 'capture', (frame / totalFrames) * (options.captureShare || 1));
                await waitUntil(started + ((frame + 1) * 1000) / fps);
            }
            if (!job.cancelled) {
                // captureStream samples on the wall clock, so stopping the
                // instant the last frame is drawn can drop it. One frame of
                // grace costs nothing and keeps the output the full length.
                await waitUntil(started + ((totalFrames + 1) * 1000) / fps);
                recorder.stop();
            }
        } finally {
            appState.currentTime = origTime;
            if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
            stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        }

        const blob = await finished;
        job._recorder = null;
        cancelled(job);
        return blob;
    }

    /**
     * Build an audio master directly from the timeline, with no real-time
     * capture at all.
     *
     * An audio-only export has no reason to be recorded through MediaRecorder:
     * doing so made its duration depend on how quickly the browser's audio
     * graph happened to come up, and the first export of a session came out
     * short (measured 1.44-1.68s for a 2.0s timeline, while later ones were
     * correct) because the recorder began before the AudioContext clock had
     * started. renderOfflineAudio already produces exactly `duration` seconds
     * of PCM deterministically, so that buffer IS the master. This is also far
     * faster, since it does not run in real time.
     */
    async function renderAudioMaster(job, appState, options) {
        setState(job, 'PREPARING');
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        const EE = window.ForgeCut && window.ForgeCut.ExportEngine;
        if (!AE || typeof AE.renderOfflineAudio !== 'function') {
            throw new Error('Audio engine unavailable — cannot render an audio-only export.');
        }
        if (!EE || typeof EE.audioBufferToWav !== 'function') {
            throw new Error('WAV encoder unavailable — cannot render an audio-only export.');
        }

        const duration = options.duration;
        const rate = job.config.audioSampleRate || 48000;

        setState(job, 'ENCODING');
        setProgress(job, 'mix', 0.1);
        const buffer = await AE.renderOfflineAudio(appState.tracks, duration, rate);
        if (!buffer) throw new Error('The timeline produced no audio to export.');
        cancelled(job);

        setProgress(job, 'mix', (options.captureShare || 0.5) * 0.9);
        const wav = EE.audioBufferToWav(buffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        job.log.push({
            t: Date.now(),
            detail: `audio master ${buffer.duration.toFixed(3)}s @ ${rate}Hz, ${buffer.numberOfChannels}ch`
        });
        setProgress(job, 'mix', options.captureShare || 0.5);
        return blob;
    }

    /* ──────────────────────── stage 2a: server transcode ──────────────────── */

    async function transcodeOnServer(job, master) {
        const cfg = job.config;
        let created;

        setState(job, 'ENCODING', 'server');
        const res = await fetch('/api/export/jobs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: cfg, name: job.name }),
            signal: job._abort.signal
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Export server refused the job (HTTP ${res.status}).`);
        }
        created = await res.json();
        job._serverJobId = created.id;
        job.filename = created.filename;

        // The Blob is passed straight to fetch as the body. It is disk-backed in
        // the browser, so this streams rather than materialising the whole
        // capture in the JS heap.
        const up = await fetch(`/api/export/jobs/${created.id}/source`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: master,
            signal: job._abort.signal
        });
        if (!up.ok) {
            const err = await up.json().catch(() => ({}));
            throw new Error(err.error || `Upload failed (HTTP ${up.status}).`);
        }

        const start = await fetch(`/api/export/jobs/${created.id}/start`, {
            method: 'POST', signal: job._abort.signal
        });
        if (!start.ok) {
            const err = await start.json().catch(() => ({}));
            throw new Error(err.error || `Could not start encoding (HTTP ${start.status}).`);
        }

        // Poll for real encoder progress.
        let last = null;
        for (;;) {
            cancelled(job);
            await new Promise(r => setTimeout(r, 250));
            const s = await fetch(`/api/export/jobs/${created.id}`, { signal: job._abort.signal });
            if (!s.ok) throw new Error(`Lost track of the export job (HTTP ${s.status}).`);
            last = await s.json();

            if (last.state === 'VALIDATING' && job.state !== 'VALIDATING') setState(job, 'VALIDATING');
            else if (last.state === 'FINALIZING' && job.state !== 'FINALIZING') setState(job, 'FINALIZING');

            setProgress(job, last.state === 'ENCODING' ? 'encode' : String(last.state).toLowerCase(),
                (job.captureShare || 0) + (1 - (job.captureShare || 0)) * (last.progress || 0));

            if (last.state === 'COMPLETED') break;
            if (last.state === 'FAILED') throw new Error(last.error || 'Encoding failed on the server.');
            if (last.state === 'CANCELLED') { const e = new Error('Export cancelled'); e.code = 'ECANCELLED'; throw e; }
        }

        job.validation = last.validation;
        const dl = await fetch(`/api/export/jobs/${created.id}/download`, { signal: job._abort.signal });
        if (!dl.ok) throw new Error(`Could not download the finished export (HTTP ${dl.status}).`);
        const blob = await dl.blob();

        // Release the server's temp copy now that we hold the bytes.
        fetch(`/api/export/jobs/${created.id}`, { method: 'DELETE' }).catch(() => {});
        job._serverJobId = null;
        return blob;
    }

    /* ───────────────────────── stage 2b: wasm transcode ───────────────────── */

    async function transcodeInBrowser(job, master) {
        const cfg = job.config;
        const ecfg = EC();
        setState(job, 'ENCODING', 'wasm');

        const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
        const { toBlobURL } = await import('/vendor/ffmpeg-util/index.js');
        const base = '/vendor/ffmpeg-core';
        const ff = new FFmpeg();
        job._wasm = ff;

        const durationSec = job.durationSec || 0;
        ff.on('log', ({ message }) => {
            const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(message || '');
            if (m && durationSec > 0) {
                const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
                setProgress(job, 'encode',
                    (job.captureShare || 0) + (1 - (job.captureShare || 0)) * Math.min(1, secs / durationSec));
            }
        });

        await ff.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
        });
        cancelled(job);

        const inName = 'source.bin';
        const outExt = ecfg.CONTAINERS[cfg.container].ext;
        const outName = `output.${outExt}`;

        await ff.writeFile(inName, new Uint8Array(await master.arrayBuffer()));
        cancelled(job);

        const args = buildWasmArgs(cfg, inName, outName);
        job.log.push({ t: Date.now(), argv: args });

        const code = await ff.exec(args);
        cancelled(job);
        if (code !== 0) throw new Error(`In-browser encoder exited with code ${code}.`);

        const data = await ff.readFile(outName);
        setState(job, 'FINALIZING');

        const blob = new Blob([data], { type: ecfg.CONTAINERS[cfg.container].mime });
        try { ff.terminate(); } catch (e) { /* already gone */ }
        job._wasm = null;
        return blob;
    }

    /**
     * The wasm build takes the same flags as the server, minus the ones that
     * only make sense for a real filesystem.
     */
    function buildWasmArgs(cfg, inName, outName) {
        const ecfg = EC();
        const container = ecfg.CONTAINERS[cfg.container];
        const args = ['-hide_banner', '-y', '-i', inName];

        if (cfg.videoCodec) {
            const vc = ecfg.VIDEO_CODECS[cfg.videoCodec];
            args.push('-c:v', vc.encoder, '-pix_fmt', vc.pixFmt);
            if (cfg.resolution && cfg.resolution !== 'source') args.push('-s', `${cfg.resolution.width}x${cfg.resolution.height}`);
            if (cfg.frameRate && cfg.frameRate !== 'source') args.push('-r', String(cfg.frameRate));
            if (cfg.bitrate) args.push('-b:v', `${cfg.bitrate}k`);
            if (cfg.videoCodec === 'h264' || cfg.videoCodec === 'h265') args.push('-preset', 'veryfast');
            if (cfg.videoCodec === 'prores') args.push('-profile:v', '3');
        } else {
            args.push('-vn');
        }

        if (cfg.audioCodec) {
            const ac = ecfg.AUDIO_CODECS[cfg.audioCodec];
            args.push('-c:a', ac.encoder);
            if (cfg.audioBitrate && !ac.lossless) args.push('-b:a', `${cfg.audioBitrate}k`);
            if (cfg.audioSampleRate) args.push('-ar', String(cfg.audioSampleRate));
        } else {
            args.push('-an');
        }

        if (container.faststart) args.push('-movflags', '+faststart');
        const muxerFor = { mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov', mp3: 'mp3', wav: 'wav', m4a: 'ipod' };
        args.push('-f', muxerFor[cfg.container], outName);
        return args;
    }

    /* ──────────────────────────── validation ──────────────────────────── */

    /**
     * Container signatures, checked against the file's own first bytes.
     *
     * A direct MediaRecorder capture never reaches the server, so ffprobe never
     * sees it. Without this, exactly the outputs that skip transcoding would
     * also skip validation — and "the extension says mp4" is the assumption
     * this whole pipeline exists to stop trusting.
     */
    const SIGNATURES = {
        webm: { at: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], label: 'EBML' },
        mkv: { at: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], label: 'EBML' },
        mp4: { at: 4, ascii: 'ftyp', label: 'ISO base media' },
        mov: { at: 4, ascii: 'ftyp', label: 'QuickTime' },
        m4a: { at: 4, ascii: 'ftyp', label: 'ISO base media' },
        wav: { at: 0, ascii: 'RIFF', label: 'RIFF' },
        mp3: { at: 0, anyOf: [{ ascii: 'ID3' }, { bytes: [0xff] }], label: 'MPEG audio' }
    };

    function matchSignature(head, container) {
        const sig = SIGNATURES[container];
        if (!sig) return true;
        const readAscii = (at, len) => String.fromCharCode.apply(null, Array.from(head.slice(at, at + len)));
        const test = (rule, at) => {
            if (rule.ascii) return readAscii(at, rule.ascii.length) === rule.ascii;
            if (rule.bytes) return rule.bytes.every((b, i) => head[at + i] === b);
            return false;
        };
        if (sig.anyOf) return sig.anyOf.some(rule => test(rule, sig.at));
        return test(sig, sig.at);
    }

    /** Read the real duration back out of the produced file. */
    function probeDurationInBrowser(blob, isAudio) {
        return new Promise((resolve) => {
            const el = document.createElement(isAudio ? 'audio' : 'video');
            const url = URL.createObjectURL(blob);
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                URL.revokeObjectURL(url);
                el.removeAttribute('src');
                resolve(value);
            };
            el.preload = 'metadata';
            el.onloadedmetadata = () => {
                // WebM from MediaRecorder reports Infinity until it is seeked,
                // because the recorder writes no duration into the header.
                if (el.duration === Infinity || isNaN(el.duration)) {
                    el.currentTime = 1e101;
                    el.ontimeupdate = () => { el.ontimeupdate = null; done(el.duration); };
                } else {
                    done(el.duration);
                }
            };
            el.onerror = () => done(null);
            setTimeout(() => done(null), 8000);
            el.src = url;
        });
    }

    /**
     * Validate an output that never went through the server: size, container
     * signature, duration, and that the browser can actually decode it.
     */
    async function validateLocally(blob, config, expectedDuration) {
        const result = { ok: false, checks: {}, problems: [], bytes: blob.size, source: 'browser' };

        result.checks.nonEmpty = blob.size > 0;
        if (!result.checks.nonEmpty) {
            result.problems.push('Output file is empty.');
            return result;
        }

        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        result.checks.container = matchSignature(head, config.container);
        result.magic = Array.from(head.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        if (!result.checks.container) {
            result.problems.push(`File does not begin with a ${SIGNATURES[config.container] ? SIGNATURES[config.container].label : config.container} signature (got ${result.magic}).`);
        }

        const isAudio = !config.videoCodec;
        const duration = await probeDurationInBrowser(blob, isAudio);
        result.duration = duration;
        const decoded = duration !== null && isFinite(duration) && duration > 0;

        // Chrome plays neither Matroska nor QuickTime, and refuses ProRes
        // regardless of container. Failing those here would report a perfectly
        // good export as broken, so playback is only treated as evidence when
        // the browser is actually expected to manage it. Files bound for those
        // containers are still signature-checked above, and are verified in
        // full by ffprobe whenever the server encoder produced them.
        const BROWSER_PLAYABLE = { mp4: true, webm: true, m4a: true, mp3: true, wav: true, mkv: false, mov: false };
        const expectPlayable = BROWSER_PLAYABLE[config.container] !== false &&
            config.videoCodec !== 'prores' && config.videoCodec !== 'ffv1';

        if (!expectPlayable) {
            result.checks.decodes = null;
            result.unverified = `${config.container.toUpperCase()} is not playable in this browser, so decodability was not verified here.`;
        } else {
            result.checks.decodes = decoded;
            if (!decoded) result.problems.push('The browser could not decode the exported file.');
        }

        if (decoded && expectedDuration) {
            const drift = Math.abs(duration - expectedDuration);
            result.durationDriftSec = +drift.toFixed(3);
            result.checks.duration = drift <= Math.max(0.5, expectedDuration * 0.05);
            if (!result.checks.duration) {
                result.problems.push(`Duration ${duration.toFixed(2)}s differs from the timeline's ${expectedDuration.toFixed(2)}s.`);
            }
        }

        result.ok = result.problems.length === 0;
        return result;
    }

    /* ──────────────────────────── orchestration ──────────────────────────── */

    /**
     * Run one export end to end.
     *
     * options: { canvas, config | preset, name, fps, duration, onUpdate }
     */
    async function runExport(appState, renderFn, options) {
        options = options || {};
        const ecfg = EC();
        const registry = CR();
        if (!ecfg || !registry) throw new Error('Export subsystem not loaded.');

        const config = options.config
            ? ecfg.normalise(options.config)
            : ecfg.fromPreset(options.preset || 'web-compat');

        const job = createJob(config, options.name);
        job.onUpdate = options.onUpdate;
        job.durationSec = options.duration || appState.duration;

        // Hand the caller a cancellation handle before any work starts. The
        // resolved value is a plain snapshot, so without this there would be no
        // way to stop an export that is already running.
        if (typeof options.onJob === 'function') {
            options.onJob({
                id: job.id,
                cancel: () => cancel(job),
                snapshot: () => publicView(job)
            });
        }

        await registry.probe();
        const plan = registry.resolve(config);
        if (!plan.ok) {
            job.backend = null;
            job.error = plan.advice || plan.reasons.join(' ');
            setState(job, 'FAILED', job.error);
            const e = new Error(job.error);
            e.code = 'EUNSUPPORTED';
            e.job = publicView(job);
            throw e;
        }

        job.backend = plan.backend;
        // A direct capture is the whole job; a transcode makes capture the
        // first portion of a two-stage progress bar.
        job.captureShare = plan.direct ? 1 : 0.5;

        const audioOnly = ecfg.isAudioOnly(config.container);

        try {
            const master = audioOnly
                ? await renderAudioMaster(job, appState, {
                    duration: job.durationSec,
                    captureShare: job.captureShare
                })
                : await captureMaster(job, appState, renderFn, {
                    canvas: options.canvas,
                    fps: options.fps || (config.frameRate === 'source' ? 30 : config.frameRate) || 30,
                    duration: job.durationSec,
                    profile: plan.capture,
                    captureShare: job.captureShare
                });
            job.bytes = master.size;

            let out = master;
            if (!plan.direct) {
                out = plan.backend === 'server-ffmpeg'
                    ? await transcodeOnServer(job, master)
                    : await transcodeInBrowser(job, master);
            } else {
                setState(job, 'FINALIZING');
            }

            // Anything the server did not validate is validated here — direct
            // captures and in-browser wasm encodes alike. Without this, the
            // outputs that skip the server would be the only ones nothing ever
            // checked.
            if (!job.validation) {
                setState(job, 'VALIDATING');
                job.validation = await validateLocally(out, config, job.durationSec);
                if (!job.validation.ok) {
                    throw new Error(job.validation.problems.join(' '));
                }
            }

            job.blob = out;
            job.bytes = out.size;
            job.filename = job.filename || ecfg.sanitiseFilename(job.name, ecfg.CONTAINERS[config.container].ext);
            setProgress(job, 'done', 1);
            setState(job, 'COMPLETED');
            return publicViewWithBlob(job);
        } catch (e) {
            if (e && e.code === 'ECANCELLED' || job.cancelled) {
                setState(job, 'CANCELLED');
                const c = new Error('Export cancelled');
                c.code = 'ECANCELLED';
                c.job = publicView(job);
                throw c;
            }
            job.error = e && e.message ? e.message : String(e);
            setState(job, 'FAILED', job.error);
            e.job = publicView(job);
            throw e;
        }
    }

    function publicViewWithBlob(job) {
        const v = publicView(job);
        v.blob = job.blob;
        return v;
    }

    /** Stop an export at whatever stage it has reached. */
    async function cancel(job) {
        if (!job) return false;
        job.cancelled = true;
        try { job._abort.abort(); } catch (e) {}
        if (job._recorder) { try { job._recorder.stop(); } catch (e) {} }
        if (job._wasm) { try { job._wasm.terminate(); } catch (e) {} job._wasm = null; }
        if (job._serverJobId) {
            // Tell the server to kill its FFmpeg process and purge the partial
            // file; without this the encode keeps running after the user has
            // stopped caring about it.
            try { await fetch(`/api/export/jobs/${job._serverJobId}`, { method: 'DELETE' }); } catch (e) {}
            job._serverJobId = null;
        }
        return true;
    }

    const API = { STATES, runExport, cancel, createJob, buildWasmArgs, publicView,
        validateLocally, matchSignature, SIGNATURES };

    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.ExportPipeline = API;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
