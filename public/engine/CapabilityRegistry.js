/**
 * ForgeCut — Runtime Capability Registry.
 *
 * Advertise only what this environment can actually produce.
 *
 * The export UI used to offer a fixed menu of formats regardless of whether
 * anything could encode them, so choosing MOV or MP3 produced a WebM stream
 * under a different extension. Format availability is not a static property of
 * the product; it depends on which of three backends is reachable, and they
 * have complementary gaps:
 *
 *   server-ffmpeg   Everything, when the deployment has FFmpeg installed.
 *                   Probed over HTTP, never assumed.
 *   wasm-ffmpeg     Everything EXCEPT VP9. libvpx-vp9 in @ffmpeg/core 0.12.6
 *                   faults with "memory access out of bounds" after the first
 *                   frame; reproducible on a fresh instance even at
 *                   -threads 1 -row-mt 0 -cpu-used 8. Always available, but
 *                   costs a ~32 MB download and is markedly slower.
 *   mediarecorder   Only what the browser will record natively — WebM/VP8/VP9
 *                   everywhere, and H.264/AAC in MP4 on some builds. No MOV,
 *                   MP3 or WAV anywhere. Fast, because it is hardware-backed.
 *
 * This module answers three questions and nothing else:
 *   - what can be produced here at all?
 *   - which backend should fulfil a given configuration?
 *   - if it cannot be produced, what should we tell the user to do instead?
 */
(function () {
    'use strict';

    const EC = (typeof window !== 'undefined' && window.ForgeCut && window.ForgeCut.ExportConfig) || null;

    /** Codecs the wasm build cannot be trusted with, with the reason. */
    const WASM_BROKEN = {
        vp9: 'The in-browser encoder crashes on VP9 (a known fault in this FFmpeg build).'
    };

    const state = {
        probed: false,
        probing: null,
        server: { available: false, reason: 'not probed', containers: [], videoCodecs: [], audioCodecs: [] },
        wasm: { available: true, containers: [], videoCodecs: [], audioCodecs: [] },
        mediarecorder: { available: false, mimeTypes: [] }
    };

    /* ───────────────────────────── probing ───────────────────────────── */

    async function probeServer(signal) {
        try {
            const res = await fetch('/api/export/capabilities', { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const caps = await res.json();
            state.server = {
                available: !!caps.available,
                reason: caps.reason || null,
                version: caps.version || null,
                ffprobe: !!caps.ffprobe,
                containers: caps.containers || [],
                videoCodecs: caps.videoCodecs || [],
                audioCodecs: caps.audioCodecs || [],
                maxUploadBytes: caps.maxUploadBytes || 0
            };
        } catch (e) {
            state.server = {
                available: false,
                reason: `Export server unreachable (${e && e.message ? e.message : e}).`,
                containers: [], videoCodecs: [], audioCodecs: []
            };
        }
    }

    /**
     * What MediaRecorder will actually record. isTypeSupported is the only
     * honest source here — support varies by browser AND by build, so a
     * hardcoded list would be wrong somewhere.
     */
    function probeMediaRecorder() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            state.mediarecorder = { available: false, mimeTypes: [], containers: [], videoCodecs: [], audioCodecs: [] };
            return;
        }
        const candidates = [
            { mime: 'video/webm;codecs=vp9,opus', container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
            { mime: 'video/webm;codecs=vp8,opus', container: 'webm', videoCodec: 'vp8', audioCodec: 'opus' },
            { mime: 'video/webm;codecs=vp9', container: 'webm', videoCodec: 'vp9', audioCodec: null },
            { mime: 'video/webm;codecs=vp8', container: 'webm', videoCodec: 'vp8', audioCodec: null },
            { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
            { mime: 'video/mp4;codecs=avc1.42E01E', container: 'mp4', videoCodec: 'h264', audioCodec: null },
            { mime: 'video/x-matroska;codecs=avc1', container: 'mkv', videoCodec: 'h264', audioCodec: null }
        ];
        const supported = candidates.filter(c => {
            try { return MediaRecorder.isTypeSupported(c.mime); } catch (e) { return false; }
        });
        state.mediarecorder = {
            available: supported.length > 0,
            mimeTypes: supported.map(s => s.mime),
            profiles: supported,
            containers: [...new Set(supported.map(s => s.container))],
            videoCodecs: [...new Set(supported.map(s => s.videoCodec).filter(Boolean))],
            audioCodecs: [...new Set(supported.map(s => s.audioCodec).filter(Boolean))]
        };
    }

    /**
     * The wasm backend ships a fixed FFmpeg build, so its capabilities are
     * known statically — minus the codecs measured to be broken in it.
     */
    function probeWasm() {
        if (!EC) return;
        state.wasm = {
            available: true,
            containers: Object.keys(EC.CONTAINERS),
            videoCodecs: Object.keys(EC.VIDEO_CODECS).filter(c => !WASM_BROKEN[c]),
            audioCodecs: Object.keys(EC.AUDIO_CODECS),
            broken: WASM_BROKEN,
            note: 'Runs entirely in the browser. Requires a ~32 MB download and is slower than the server encoder.'
        };
    }

    async function probe(force) {
        if (state.probed && !force) return snapshot();
        if (state.probing) return state.probing;
        state.probing = (async () => {
            probeMediaRecorder();
            probeWasm();
            await probeServer();
            state.probed = true;
            state.probing = null;
            return snapshot();
        })();
        return state.probing;
    }

    function snapshot() {
        return JSON.parse(JSON.stringify({
            server: state.server, wasm: state.wasm, mediarecorder: state.mediarecorder
        }));
    }

    /* ──────────────────────────── resolution ──────────────────────────── */

    function backendSupports(backend, cfg) {
        const b = state[backend];
        if (!b || !b.available) return false;
        if (b.containers.indexOf(cfg.container) === -1) return false;
        if (cfg.videoCodec && b.videoCodecs.indexOf(cfg.videoCodec) === -1) return false;
        if (cfg.audioCodec && b.audioCodecs.indexOf(cfg.audioCodec) === -1) return false;
        return true;
    }

    /**
     * Can MediaRecorder capture this configuration directly, with no transcode?
     * Only true when the container AND both codecs line up exactly — otherwise
     * the capture is a master that still has to be muxed properly.
     */
    function directCaptureProfile(cfg) {
        const mr = state.mediarecorder;
        if (!mr.available || !mr.profiles) return null;
        return mr.profiles.find(p =>
            p.container === cfg.container &&
            p.videoCodec === cfg.videoCodec &&
            (cfg.audioCodec ? p.audioCodec === cfg.audioCodec : true)) || null;
    }

    /**
     * The best capture profile to use as an intermediate master when the target
     * needs transcoding. Prefers a codec that is cheap to decode again.
     */
    function bestCaptureProfile() {
        const mr = state.mediarecorder;
        if (!mr.available || !mr.profiles || !mr.profiles.length) return null;
        const order = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8', 'video/webm;codecs=vp9'];
        for (const mime of order) {
            const hit = mr.profiles.find(p => p.mime === mime);
            if (hit) return hit;
        }
        return mr.profiles[0];
    }

    /**
     * Decide how a configuration will be fulfilled.
     *
     * Returns { ok, backend, direct, capture, reasons, advice }. When ok is
     * false, `advice` is written to be actionable rather than a bare refusal.
     */
    function resolve(config) {
        const check = EC ? EC.validate(config) : { ok: true, config, errors: [] };
        if (!check.ok) {
            return { ok: false, backend: null, reasons: check.errors, advice: check.errors.join(' ') };
        }
        const cfg = check.config;
        const reasons = [];

        // 1. Direct capture: fastest, no second encode, no download.
        const direct = directCaptureProfile(cfg);
        if (direct) {
            return { ok: true, backend: 'mediarecorder', direct: true, capture: direct, config: cfg, reasons };
        }

        // 2. Server: real muxer, fastest transcode, no client memory pressure.
        if (backendSupports('server', cfg)) {
            return { ok: true, backend: 'server-ffmpeg', direct: false, capture: bestCaptureProfile(), config: cfg, reasons };
        }
        reasons.push(state.server.available
            ? `The export server cannot produce ${cfg.container}/${cfg.videoCodec || 'audio'}.`
            : (state.server.reason || 'Export server unavailable.'));

        // 3. wasm: always present, slower, and VP9 is known broken in it.
        if (backendSupports('wasm', cfg)) {
            return { ok: true, backend: 'wasm-ffmpeg', direct: false, capture: bestCaptureProfile(), config: cfg, reasons };
        }
        if (cfg.videoCodec && WASM_BROKEN[cfg.videoCodec]) reasons.push(WASM_BROKEN[cfg.videoCodec]);

        return { ok: false, backend: null, config: cfg, reasons, advice: adviseFallback(cfg, reasons) };
    }

    /** Concrete, actionable alternatives — never a bare "unsupported". */
    function adviseFallback(cfg, reasons) {
        const alternatives = [];
        if (!EC) return reasons.join(' ');

        const container = EC.CONTAINERS[cfg.container];
        if (container && cfg.videoCodec && WASM_BROKEN[cfg.videoCodec]) {
            const other = (container.video || []).filter(c => c !== cfg.videoCodec && !WASM_BROKEN[c]);
            if (other.length) {
                alternatives.push(`choose ${other.map(c => EC.VIDEO_CODECS[c].label).join(' or ')} in ${container.label}`);
            }
        }
        // Any container/codec pair some reachable backend can do.
        for (const name of Object.keys(EC.PRESETS)) {
            const p = EC.normalise(EC.PRESETS[name].config);
            if (p.container === cfg.container) continue;
            if (backendSupports('server', p) || backendSupports('wasm', p) || directCaptureProfile(p)) {
                alternatives.push(`export as ${EC.PRESETS[name].label}`);
                break;
            }
        }
        if (!state.server.available) {
            alternatives.push('install FFmpeg on the server for the full format list');
        }
        const why = reasons.length ? reasons.join(' ') : 'No available encoder can produce this combination.';
        return alternatives.length ? `${why} Try: ${alternatives.join(', or ')}.` : why;
    }

    /**
     * Every preset this environment can actually deliver, each annotated with
     * the backend that would run it. The UI is expected to render only these.
     */
    function availablePresets() {
        if (!EC) return [];
        return Object.keys(EC.PRESETS).map(name => {
            const preset = EC.PRESETS[name];
            const r = resolve(preset.config);
            return {
                name, label: preset.label, description: preset.description,
                config: EC.normalise(preset.config),
                available: r.ok, backend: r.backend,
                direct: !!r.direct,
                advice: r.ok ? null : r.advice
            };
        });
    }

    /** Containers with at least one reachable backend. */
    function availableContainers() {
        if (!EC) return [];
        return Object.keys(EC.CONTAINERS).filter(c => resolve(EC.normalise({ container: c })).ok);
    }

    const API = {
        probe, snapshot, resolve, availablePresets, availableContainers,
        bestCaptureProfile, directCaptureProfile,
        WASM_BROKEN,
        get probed() { return state.probed; },
        get server() { return state.server; },
        get wasm() { return state.wasm; },
        get mediarecorder() { return state.mediarecorder; }
    };

    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.CapabilityRegistry = API;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
