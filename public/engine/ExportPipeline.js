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

    /* ─────────────────── frame-accurate offline rendering ─────────────────── */

    /**
     * Move every in-range media element to its clip-local time and WAIT.
     *
     * This is the step the realtime capture path cannot perform. A <video>
     * element does not update the frame it exposes to drawImage until it has
     * finished seeking, so a render loop that only sets state.currentTime draws
     * whatever frame the element happened to be showing. Measured on a source
     * whose colour changes every second: without this, all six sampled
     * timeline positions rendered the SAME frame; with it, they render the six
     * expected ones.
     */
    async function seekAllForRender(appState, time) {
        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        if (!ME) return;
        const waits = [];

        (appState.tracks || []).forEach(track => {
            (track.clips || []).forEach(clip => {
                const asset = ME.getAsset(clip.assetId);
                if (!asset || !asset.element) return;
                const el = asset.element;
                if (!el.duration || !isFinite(el.duration)) return;

                const inRange = time >= clip.startTime && time < clip.startTime + clip.duration;
                if (!inRange) return;

                // Speed is applied during playback as element.playbackRate, which
                // an offline seek never sees. Without folding it into the source
                // time here, a 2x clip previewed at 2x but exported at 1x - a
                // preview-only behaviour failing silently at render.
                const speed = (clip.playbackSpeed !== undefined && clip.playbackSpeed > 0)
                    ? clip.playbackSpeed : 1;

                // Clamp: seeking past the end never fires 'seeked'.
                let target = (time - clip.startTime) * speed + (clip.trimStart || 0);
                target = Math.max(0, Math.min(target, Math.max(0, el.duration - 1e-3)));

                // A frame is ~1/fps wide; anything closer than half that is
                // already the right frame and re-seeking only costs time.
                if (Math.abs(el.currentTime - target) < 0.005) return;

                if (!el.paused) { try { el.pause(); } catch (e) { /* ignore */ } }
                waits.push(new Promise(resolve => {
                    let done = false;
                    const finish = () => {
                        if (done) return;
                        done = true;
                        el.removeEventListener('seeked', finish);
                        resolve();
                    };
                    el.addEventListener('seeked', finish);
                    // A seek that never completes must not hang the export.
                    setTimeout(finish, 2000);
                    try { el.currentTime = target; } catch (e) { finish(); }
                }));
            });
        });

        if (waits.length) await Promise.all(waits);
    }

    /** Does this project contain anything that has to be seeked to render? */
    function needsFrameAccurateRender(appState) {
        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        if (!ME) return false;
        return (appState.tracks || []).some(track =>
            track.type !== 'audio' && (track.clips || []).some(clip => {
                const a = ME.getAsset(clip.assetId);
                return !!(a && a.element && a.element.duration && isFinite(a.element.duration) && a.type === 'video');
            }));
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas produced no image data.')), type, quality);
        });
    }

    /**
     * Render every frame offline and stream it to the server encoder.
     *
     * Nothing accumulates: one frame Blob exists at a time, it is PUT
     * immediately, and the reference is dropped. Peak memory is therefore flat
     * in the length of the export rather than linear, which is what makes long
     * and 4K exports survivable at all.
     */
    async function renderOfflineFrames(job, appState, renderFn, options) {
        const ecfg = EC();
        const canvas = options.canvas;
        const fps = options.fps;
        const duration = options.duration;
        const totalFrames = Math.max(1, Math.round(duration * fps));

        setState(job, 'PREPARING', 'frame-accurate');

        const res = await fetch('/api/export/jobs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: job.config, name: job.name }),
            signal: job._abort.signal
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Export server refused the job (HTTP ${res.status}).`);
        }
        const created = await res.json();
        job._serverJobId = created.id;
        job.filename = created.filename;

        // Audio first: it is one deterministic offline mix, independent of the
        // frame loop, so A/V alignment does not depend on capture timing.
        if (job.config.audioCodec) {
            const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
            const EE = window.ForgeCut && window.ForgeCut.ExportEngine;
            if (AE && EE && typeof AE.renderOfflineAudio === 'function') {
                try {
                    const buffer = await AE.renderOfflineAudio(appState.tracks, duration,
                        job.config.audioSampleRate || 48000);
                    if (buffer) {
                        const wav = EE.audioBufferToWav(buffer);
                        const up = await fetch(`/api/export/jobs/${created.id}/audio`, {
                            method: 'PUT',
                            headers: { 'content-type': 'application/octet-stream' },
                            body: new Blob([wav], { type: 'audio/wav' }),
                            signal: job._abort.signal
                        });
                        if (!up.ok) throw new Error(`Audio upload failed (HTTP ${up.status}).`);
                        job.log.push({ t: Date.now(), detail: `audio mix ${buffer.duration.toFixed(3)}s` });
                    }
                } catch (e) {
                    job.log.push({ t: Date.now(), warning: `Audio mix failed: ${e && e.message}` });
                }
            }
        }

        setState(job, 'ENCODING', 'frames');
        const origTime = appState.currentTime;
        const renderShare = options.renderShare == null ? 0.7 : options.renderShare;
        let bytes = 0;

        try {
            for (let i = 0; i < totalFrames; i++) {
                cancelled(job);
                const t = i / fps;
                appState.currentTime = t;

                await seekAllForRender(appState, t);
                renderFn();

                // PNG keeps the render bit-exact, so a fidelity failure is the
                // renderer's rather than the frame codec's.
                const blob = await canvasToBlob(canvas, 'image/png');
                bytes += blob.size;

                const put = await fetch(`/api/export/jobs/${created.id}/frames/${i + 1}`, {
                    method: 'PUT',
                    headers: { 'content-type': 'image/png' },
                    body: blob,
                    signal: job._abort.signal
                });
                if (!put.ok) {
                    const err = await put.json().catch(() => ({}));
                    throw new Error(err.error || `Frame ${i + 1} upload failed (HTTP ${put.status}).`);
                }

                setProgress(job, 'render', ((i + 1) / totalFrames) * renderShare);
            }
        } finally {
            appState.currentTime = origTime;
        }

        job.framesRendered = totalFrames;
        job.frameBytes = bytes;

        const start = await fetch(`/api/export/jobs/${created.id}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fps }),
            signal: job._abort.signal
        });
        if (!start.ok) {
            const err = await start.json().catch(() => ({}));
            throw new Error(err.error || `Could not start encoding (HTTP ${start.status}).`);
        }

        let last = null;
        for (;;) {
            cancelled(job);
            await new Promise(r => setTimeout(r, 250));
            const st = await fetch(`/api/export/jobs/${created.id}`, { signal: job._abort.signal });
            if (!st.ok) throw new Error(`Lost track of the export job (HTTP ${st.status}).`);
            last = await st.json();

            if (last.state === 'VALIDATING' && job.state !== 'VALIDATING') setState(job, 'VALIDATING');
            else if (last.state === 'FINALIZING' && job.state !== 'FINALIZING') setState(job, 'FINALIZING');

            setProgress(job, String(last.state).toLowerCase(),
                renderShare + (1 - renderShare) * (last.progress || 0));

            if (last.state === 'COMPLETED') break;
            if (last.state === 'FAILED') throw new Error(last.error || 'Encoding failed on the server.');
            if (last.state === 'CANCELLED') { const e = new Error('Export cancelled'); e.code = 'ECANCELLED'; throw e; }
        }

        job.validation = last.validation;
        const dl = await fetch(`/api/export/jobs/${created.id}/download`, { signal: job._abort.signal });
        if (!dl.ok) throw new Error(`Could not download the finished export (HTTP ${dl.status}).`);
        const out = await dl.blob();

        fetch(`/api/export/jobs/${created.id}`, { method: 'DELETE' }).catch(() => {});
        job._serverJobId = null;
        return out;
    }

    /* ────────────────── frame-accurate rendering in the browser ───────────── */

    /**
     * Codec strings to try for each of our codec ids, best first.
     *
     * Probed rather than assumed: this browser supports H.264 HIGH but reports
     * baseline and main as unsupported, so the conventional 'avc1.42E01E'
     * would fail here. The level digits also have to cover the frame size, so
     * larger levels are offered first and the list is probed at the ACTUAL
     * export resolution.
     */
    const WEBCODEC_CANDIDATES = {
        h264: ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.640028', 'avc1.4D4028', 'avc1.42E01E'],
        h265: ['hvc1.1.6.L153.B0', 'hvc1.1.6.L120.B0', 'hvc1.1.6.L93.B0'],
        vp8: ['vp8'],
        vp9: ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.10.08']
    };

    /** Which of our video codecs this browser can hardware/software encode. */
    async function probeWebCodec(videoCodec, width, height, bitrate, fps) {
        if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) return null;
        const list = WEBCODEC_CANDIDATES[videoCodec];
        if (!list) return null;

        for (const codec of list) {
            const cfg = {
                codec,
                width: Math.round(width), height: Math.round(height),
                bitrate: Math.max(100000, Math.round((bitrate || 8000) * 1000)),
                framerate: fps
            };
            // Annex B keeps the elementary stream muxable with -c:v copy.
            if (codec.startsWith('avc1')) cfg.avc = { format: 'annexb' };
            if (codec.startsWith('hvc1')) cfg.hevc = { format: 'annexb' };
            try {
                const res = await VideoEncoder.isConfigSupported(cfg);
                if (res && res.supported) return res.config || cfg;
            } catch (e) { /* try the next candidate */ }
        }
        return null;
    }

    /**
     * Wrap raw VP8/VP9 frames in an IVF container.
     *
     * WebCodecs hands back bare compressed frames with no container, and
     * FFmpeg cannot demux those on their own. IVF is the minimal wrapper that
     * carries the codec fourcc, the frame size and a timebase, which is
     * everything needed to mux losslessly afterwards.
     */
    function wrapIVF(frames, fourcc, width, height, fps) {
        const payload = frames.reduce((n, f) => n + f.length + 12, 0);
        const out = new Uint8Array(32 + payload);
        const dv = new DataView(out.buffer);
        const ascii = (s, at) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };

        ascii('DKIF', 0);
        dv.setUint16(4, 0, true);          // version
        dv.setUint16(6, 32, true);         // header length
        ascii(fourcc, 8);
        dv.setUint16(12, width, true);
        dv.setUint16(14, height, true);
        dv.setUint32(16, Math.round(fps), true);  // timebase denominator
        dv.setUint32(20, 1, true);                // timebase numerator
        dv.setUint32(24, frames.length, true);
        dv.setUint32(28, 0, true);

        let off = 32;
        frames.forEach((f, i) => {
            dv.setUint32(off, f.length, true);
            dv.setUint32(off + 4, i, true);   // timestamp low
            dv.setUint32(off + 8, 0, true);   // timestamp high
            out.set(f, off + 12);
            off += 12 + f.length;
        });
        return out;
    }

    /**
     * Render every frame offline and encode it with WebCodecs, then let
     * ffmpeg.wasm MUX the result without re-encoding.
     *
     * This is what makes a frame-accurate export possible with no server. The
     * realtime capture path cannot wait for a seek, so it exported one frozen
     * frame per video clip; this path seeks, waits, draws, and hands the frame
     * to a hardware encoder. ffmpeg.wasm then only has to mux (-c:v copy),
     * which costs milliseconds rather than the seconds per frame that encoding
     * in wasm would.
     */
    async function renderFramesWithWebCodecs(job, appState, renderFn, options) {
        const ecfg = EC();
        const cfg = job.config;
        const canvas = options.canvas;
        const fps = options.fps;
        const duration = options.duration;
        const totalFrames = Math.max(1, Math.round(duration * fps));
        const renderShare = options.renderShare == null ? 0.75 : options.renderShare;

        const width = (cfg.resolution && cfg.resolution !== 'source') ? cfg.resolution.width : canvas.width;
        const height = (cfg.resolution && cfg.resolution !== 'source') ? cfg.resolution.height : canvas.height;

        setState(job, 'PREPARING', 'webcodecs');
        const encoderConfig = await probeWebCodec(cfg.videoCodec, width, height, cfg.bitrate, fps);
        if (!encoderConfig) {
            const e = new Error(`This browser cannot encode ${cfg.videoCodec} with WebCodecs.`);
            e.code = 'ENOWEBCODEC';
            throw e;
        }

        // Scaling target, if the export resolution differs from the canvas.
        let scratch = null;
        if (width !== canvas.width || height !== canvas.height) {
            scratch = document.createElement('canvas');
            scratch.width = width; scratch.height = height;
        }

        const chunks = [];
        let encodeError = null;
        const encoder = new VideoEncoder({
            output: (chunk) => {
                const buf = new Uint8Array(chunk.byteLength);
                chunk.copyTo(buf);
                chunks.push(buf);
            },
            error: (e) => { encodeError = e; }
        });
        encoder.configure(encoderConfig);
        job._encoder = encoder;

        setState(job, 'ENCODING', 'webcodecs');
        const origTime = appState.currentTime;
        const frameDurUs = Math.round(1e6 / fps);

        try {
            for (let i = 0; i < totalFrames; i++) {
                cancelled(job);
                if (encodeError) throw encodeError;

                appState.currentTime = i / fps;
                await seekAllForRender(appState, i / fps);
                renderFn();

                let source = canvas;
                if (scratch) {
                    const sx = scratch.getContext('2d');
                    sx.drawImage(canvas, 0, 0, width, height);
                    source = scratch;
                }

                const frame = new VideoFrame(source, {
                    timestamp: Math.round((i * 1e6) / fps),
                    duration: frameDurUs
                });
                // A keyframe every second keeps the result seekable.
                encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 });
                frame.close();

                // Backpressure: without this the encoder queue grows without
                // bound and the whole point of streaming is lost.
                while (encoder.encodeQueueSize > 8) {
                    await new Promise(r => setTimeout(r, 1));
                    if (job.cancelled) break;
                }

                setProgress(job, 'render', ((i + 1) / totalFrames) * renderShare);
            }
            await encoder.flush();
        } finally {
            appState.currentTime = origTime;
            try { encoder.close(); } catch (e) { /* already closed */ }
            job._encoder = null;
        }
        if (encodeError) throw encodeError;
        cancelled(job);

        // Assemble the elementary stream. Encoded frames are ~100x smaller than
        // raw ones, so this is the one place data is gathered, and it is the
        // compressed size rather than the pixel size.
        let elementary, inputArgs;
        const totalBytes = chunks.reduce((n, c) => n + c.length, 0);
        if (cfg.videoCodec === 'vp8' || cfg.videoCodec === 'vp9') {
            elementary = wrapIVF(chunks, cfg.videoCodec === 'vp9' ? 'VP90' : 'VP80', width, height, fps);
            inputArgs = ['-f', 'ivf', '-i', 'video.ivf'];
        } else if (cfg.videoCodec === 'h265') {
            elementary = concatChunks(chunks, totalBytes);
            inputArgs = ['-f', 'hevc', '-framerate', String(fps), '-i', 'video.h265'];
        } else {
            elementary = concatChunks(chunks, totalBytes);
            inputArgs = ['-f', 'h264', '-framerate', String(fps), '-i', 'video.h264'];
        }
        job.encodedBytes = elementary.length;

        setState(job, 'FINALIZING', 'mux');
        setProgress(job, 'mux', renderShare);

        const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
        const { toBlobURL } = await import('/vendor/ffmpeg-util/index.js');
        const base = '/vendor/ffmpeg-core';
        const ff = new FFmpeg();
        job._wasm = ff;
        await ff.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
        });
        cancelled(job);

        const vName = inputArgs[inputArgs.length - 1];
        await ff.writeFile(vName, elementary);

        // Audio is a separate deterministic offline mix, so A/V alignment does
        // not depend on capture timing.
        let hasAudio = false;
        if (cfg.audioCodec) {
            const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
            const EE = window.ForgeCut && window.ForgeCut.ExportEngine;
            if (AE && EE) {
                try {
                    const buffer = await AE.renderOfflineAudio(appState.tracks, duration,
                        cfg.audioSampleRate || 48000);
                    if (buffer) {
                        await ff.writeFile('audio.wav', new Uint8Array(EE.audioBufferToWav(buffer)));
                        hasAudio = true;
                    }
                } catch (e) {
                    job.log.push({ t: Date.now(), warning: `Audio mix failed: ${e && e.message}` });
                }
            }
        }

        const outName = `output.${ecfg.CONTAINERS[cfg.container].ext}`;
        const args = ['-hide_banner', '-y'].concat(inputArgs);
        if (hasAudio) args.push('-i', 'audio.wav');
        // The video is already encoded — copy it rather than paying for a
        // second, much slower, wasm encode.
        args.push('-c:v', 'copy');
        if (hasAudio) {
            const ac = ecfg.AUDIO_CODECS[cfg.audioCodec];
            args.push('-c:a', ac.encoder);
            if (cfg.audioBitrate && !ac.lossless) args.push('-b:a', `${cfg.audioBitrate}k`);
            if (cfg.audioSampleRate) args.push('-ar', String(cfg.audioSampleRate));
            args.push('-shortest');
        } else {
            args.push('-an');
        }
        if (ecfg.CONTAINERS[cfg.container].faststart) args.push('-movflags', '+faststart');
        const muxerFor = { mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov' };
        args.push('-f', muxerFor[cfg.container], outName);
        job.log.push({ t: Date.now(), argv: args, encodedBytes: elementary.length, frames: totalFrames });

        const code = await ff.exec(args);
        if (code !== 0) throw new Error(`Muxing failed (exit ${code}).`);
        const data = await ff.readFile(outName);
        const blob = new Blob([data], { type: ecfg.CONTAINERS[cfg.container].mime });
        try { ff.terminate(); } catch (e) { /* already gone */ }
        job._wasm = null;

        setProgress(job, 'done', 1);
        return blob;
    }

    function concatChunks(chunks, total) {
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
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

        // Frame-accurate rendering is REQUIRED whenever a video clip is on the
        // timeline: the realtime capture path cannot wait for a seek, so it
        // would export the same frozen frame for the whole clip. It needs the
        // server encoder, because assembling an image sequence at an exact
        // frame rate is what makes the timing right.
        const needsSeek = !audioOnly && options.mode !== 'realtime' && needsFrameAccurateRender(appState);
        const serverCanDoFrames = needsSeek &&
            registry.server && registry.server.available &&
            backendCanTake(registry, config);

        // With no server, WebCodecs still gives a frame-accurate export: it
        // encodes each rendered frame in hardware and ffmpeg.wasm only muxes.
        // Without it the export would fall back to realtime capture, which
        // cannot wait for a seek and so exports one frozen frame per clip.
        const webCodecCandidate = needsSeek && !serverCanDoFrames &&
            typeof VideoEncoder !== 'undefined' &&
            !!WEBCODEC_CANDIDATES[config.videoCodec] &&
            ['mp4', 'mkv', 'mov', 'webm'].indexOf(config.container) !== -1;

        let wantsFrameAccurate = serverCanDoFrames;
        let useWebCodecs = false;

        if (webCodecCandidate) {
            const w = (config.resolution && config.resolution !== 'source')
                ? config.resolution.width : options.canvas.width;
            const h = (config.resolution && config.resolution !== 'source')
                ? config.resolution.height : options.canvas.height;
            const probed = await probeWebCodec(config.videoCodec, w, h, config.bitrate,
                options.fps || (config.frameRate === 'source' ? 30 : config.frameRate) || 30);
            if (probed) { useWebCodecs = true; wantsFrameAccurate = true; }
        }

        if (wantsFrameAccurate) {
            job.backend = useWebCodecs ? 'webcodecs' : 'server-ffmpeg-frames';
            job.captureShare = useWebCodecs ? 0.75 : 0.7;
        } else if (needsSeek) {
            // Nothing frame-accurate is reachable. Say so in the log rather
            // than silently shipping frozen frames.
            job.log.push({ t: Date.now(),
                warning: 'No frame-accurate encoder available (no export server, and WebCodecs cannot encode this format). Falling back to realtime capture, which cannot seek video clips.' });
        }

        try {
            if (wantsFrameAccurate && useWebCodecs) {
                const out = await renderFramesWithWebCodecs(job, appState, renderFn, {
                    canvas: options.canvas,
                    fps: options.fps || (config.frameRate === 'source' ? 30 : config.frameRate) || 30,
                    duration: job.durationSec,
                    renderShare: 0.75
                });
                job.blob = out;
                job.bytes = out.size;
                job.filename = job.filename ||
                    ecfg.sanitiseFilename(job.name, ecfg.CONTAINERS[config.container].ext);
                setState(job, 'VALIDATING');
                job.validation = await validateLocally(out, config, job.durationSec);
                if (!job.validation.ok) throw new Error(job.validation.problems.join(' '));
                setProgress(job, 'done', 1);
                setState(job, 'COMPLETED');
                return publicViewWithBlob(job);
            }

            if (wantsFrameAccurate) {
                const out = await renderOfflineFrames(job, appState, renderFn, {
                    canvas: options.canvas,
                    fps: options.fps || (config.frameRate === 'source' ? 30 : config.frameRate) || 30,
                    duration: job.durationSec,
                    renderShare: 0.7
                });
                job.blob = out;
                job.bytes = out.size;
                job.filename = job.filename ||
                    ecfg.sanitiseFilename(job.name, ecfg.CONTAINERS[config.container].ext);
                setProgress(job, 'done', 1);
                setState(job, 'COMPLETED');
                return publicViewWithBlob(job);
            }

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

    /** Can the server encoder produce this configuration? */
    function backendCanTake(registry, cfg) {
        const srv = registry.server;
        if (!srv || !srv.available) return false;
        if ((srv.containers || []).indexOf(cfg.container) === -1) return false;
        if (cfg.videoCodec && (srv.videoCodecs || []).indexOf(cfg.videoCodec) === -1) return false;
        if (cfg.audioCodec && (srv.audioCodecs || []).indexOf(cfg.audioCodec) === -1) return false;
        return true;
    }

    /** Stop an export at whatever stage it has reached. */
    async function cancel(job) {
        if (!job) return false;
        job.cancelled = true;
        try { job._abort.abort(); } catch (e) {}
        if (job._recorder) { try { job._recorder.stop(); } catch (e) {} }
        if (job._encoder) { try { job._encoder.close(); } catch (e) {} job._encoder = null; }
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
        validateLocally, matchSignature, SIGNATURES,
        seekAllForRender, needsFrameAccurateRender, probeWebCodec, wrapIVF, WEBCODEC_CANDIDATES };

    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.ExportPipeline = API;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
