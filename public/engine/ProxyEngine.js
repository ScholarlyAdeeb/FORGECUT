/**
 * ForgeCut — proxy media for smooth 4K editing.
 *
 * A proxy is a small (540p) copy of a large video used ONLY for preview.
 * Decoding and uploading a 4K frame every repaint is what makes 4K timelines
 * stutter; a 540p frame is ~16× fewer pixels.
 *
 * Rules (from the Phase 5 plan's risk table):
 *   - Export never uses a proxy. MediaEngine.getRenderElement() hands out the
 *     proxy only while proxies are switched on AND no export is running
 *     (ForgeCut.__exporting), and the export seeks originals regardless.
 *   - A proxy is frame-accurate: built by seeking every frame, not by
 *     recording playback, so preview of a proxy shows the same moment the
 *     export will.
 *
 * Built entirely in the browser (Vercel-safe): WebCodecs VP8/VP9 encode,
 * then the vendored ffmpeg.wasm muxes the IVF stream into WebM without
 * re-encoding. Proxies are cached in the Origin Private File System so a
 * file is only processed once per browser.
 */
(function () {
    'use strict';

    const PROXY_HEIGHT = 540;
    const PROXY_FPS = 30;
    const KEYFRAME_EVERY = 30;          // seekable proxies: a keyframe a second
    const BITRATE_KBPS = 2500;

    const EP = () => window.ForgeCut && window.ForgeCut.ExportPipeline;

    /** Worth proxying? Anything meaningfully larger than 1080p. */
    function needsProxy(asset) {
        return !!(asset && asset.type === 'video' && asset.width && asset.height &&
            asset.width * asset.height > 1920 * 1080 * 1.1);
    }

    function proxySize(w, h) {
        const ph = Math.min(PROXY_HEIGHT, h);
        const pw = Math.max(2, Math.round(w * ph / h / 2) * 2);
        return { w: pw, h: Math.max(2, Math.round(ph / 2) * 2) };
    }

    /* ── OPFS cache ──────────────────────────────────────────────────── */

    function cacheKey(file) {
        const raw = `${file.name}|${file.size}|${file.lastModified || 0}|${PROXY_HEIGHT}p${PROXY_FPS}`;
        let h = 2166136261;                         // FNV-1a: a stable, short file name
        for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return `proxy-${h.toString(16)}-${file.size.toString(36)}.webm`;
    }

    async function cacheDir() {
        if (!navigator.storage || !navigator.storage.getDirectory) return null;
        try {
            const root = await navigator.storage.getDirectory();
            return await root.getDirectoryHandle('forgecut-proxies', { create: true });
        } catch (e) { return null; }
    }

    async function cacheGet(file) {
        const dir = await cacheDir();
        if (!dir) return null;
        try { return await (await dir.getFileHandle(cacheKey(file))).getFile(); } catch (e) { return null; }
    }

    async function cachePut(file, blob) {
        const dir = await cacheDir();
        if (!dir) return false;
        try {
            const fh = await dir.getFileHandle(cacheKey(file), { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            return true;
        } catch (e) { return false; }
    }

    /* ── build ───────────────────────────────────────────────────────── */

    function seek(v, t) {
        return new Promise((ok) => {
            const done = () => { v.removeEventListener('seeked', done); ok(); };
            v.addEventListener('seeked', done);
            v.currentTime = t;
        });
    }

    /** Wait until a WebCodecs queue drains below `limit` (event-driven, not timer-driven). */
    async function drain(codec, prop, limit) {
        while (codec[prop] > limit) {
            await new Promise((r) => {
                const done = () => { codec.removeEventListener && codec.removeEventListener('dequeue', done); r(); };
                if (codec.addEventListener) codec.addEventListener('dequeue', done, { once: true });
                // Belt and braces for engines without 'dequeue': a message
                // hop, which background timer throttling does not slow down.
                const ch = new MessageChannel(); ch.port1.onmessage = done; ch.port2.postMessage(0);
            });
        }
    }

    /**
     * Fast path: demux the MP4 and decode it SEQUENTIALLY with WebCodecs.
     * One decode per frame, versus a decode from the last keyframe per frame
     * when seeking (533 ms/frame on a long-GOP 4K file). Emits frames on the
     * proxy's constant 30 fps grid: grid frame k shows the latest source frame
     * whose presentation time is ≤ k/30 — exactly what seeking the original
     * to k/30 shows. Returns null if the file or codec is out of scope.
     */
    async function buildByDecoding(asset, encCfg, codec, w, h, o) {
        const D = window.ForgeCut && window.ForgeCut.Mp4Demux;
        if (!D || typeof VideoDecoder === 'undefined' || !asset.file) return null;
        const info = await D.open(D.fileReader(asset.file), asset.file.size);
        if (!info) return null;
        const decCfg = { codec: info.codec, description: info.description, codedWidth: info.width, codedHeight: info.height };
        try { if (!(await VideoDecoder.isConfigSupported(decCfg)).supported) return null; } catch (e) { return null; }

        const chunks = [];
        let err = null;
        const enc = new VideoEncoder({
            output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); },
            error: (e) => { err = e; }
        });
        enc.configure(encCfg);
        const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const g = cv.getContext('2d');
        const total = Math.max(1, Math.ceil(info.duration * PROXY_FPS - 1e-6));
        let k = 0, have = false;
        const emit = () => {
            const vf = new VideoFrame(cv, { timestamp: Math.round(k * 1e6 / PROXY_FPS), duration: Math.round(1e6 / PROXY_FPS) });
            enc.encode(vf, { keyFrame: k % KEYFRAME_EVERY === 0 });
            vf.close();
            k++;
        };
        const dec = new VideoDecoder({
            output: (frame) => {
                const p = frame.timestamp / 1e6;
                while (have && k < total && k / PROXY_FPS < p - 1e-4) emit();
                g.drawImage(frame, 0, 0, w, h);
                frame.close();
                have = true;
            },
            error: (e) => { err = e; }
        });
        dec.configure(decCfg);
        const read = D.fileReader(asset.file);
        try {
            const n = info.samples.length;
            for (let i = 0; i < n; i++) {
                if (o.signal && o.signal.aborted) throw Object.assign(new Error('Proxy build cancelled.'), { code: 'ECANCELLED' });
                if (err) throw err;
                const s = info.samples[i];
                dec.decode(new EncodedVideoChunk({
                    type: s.key ? 'key' : 'delta',
                    timestamp: Math.round(s.pts * 1e6),
                    data: await read(s.offset, s.size)
                }));
                await drain(dec, 'decodeQueueSize', 12);
                await drain(enc, 'encodeQueueSize', 8);
                if (o.onProgress && i % 15 === 0) o.onProgress((i + 1) / n * 0.95);
            }
            await dec.flush();
            while (have && k < total) emit();
            await enc.flush();
            if (err) throw err;
        } finally {
            try { dec.close(); } catch (e) { /* closed */ }
            try { enc.close(); } catch (e) { /* closed */ }
        }
        return { chunks, frames: k, method: 'decode' };
    }

    /**
     * Build (or fetch from cache) a proxy for a video asset.
     *   opts.onProgress(fraction), opts.signal (AbortSignal)
     * → { blob, width, height, fps, cached }
     */
    async function build(asset, opts) {
        const o = opts || {};
        if (!asset || !asset.file) throw new Error('No source file for this clip.');
        const cached = await cacheGet(asset.file);
        if (cached && cached.size > 0) {
            const s = proxySize(asset.width, asset.height);
            return { blob: cached, width: s.w, height: s.h, fps: PROXY_FPS, cached: true };
        }
        if (!EP() || !EP().probeWebCodec || !EP().wrapIVF) throw new Error('Export engine not loaded.');

        const v = document.createElement('video');
        v.muted = true; v.preload = 'auto'; v.src = asset.objectUrl;
        await new Promise((ok, fail) => { v.onloadeddata = ok; v.onerror = () => fail(new Error('Could not decode this video.')); });
        const { w, h } = proxySize(v.videoWidth, v.videoHeight);
        const duration = v.duration;

        let codec = 'vp8', config = await EP().probeWebCodec('vp8', w, h, BITRATE_KBPS, PROXY_FPS);
        if (!config) { codec = 'vp9'; config = await EP().probeWebCodec('vp9', w, h, BITRATE_KBPS, PROXY_FPS); }
        if (!config) throw new Error('This browser cannot encode VP8 or VP9 with WebCodecs.');

        // Fast path first: sequential decode. Seeking per frame is the
        // fallback for anything the demuxer or decoder does not handle.
        let chunks = null, method = 'seek';
        try {
            const fast = await buildByDecoding(asset, config, codec, w, h, o);
            if (fast) { chunks = fast.chunks; method = 'decode'; }
        } catch (e) {
            if (e && e.code === 'ECANCELLED') throw e;
            console.warn('[ForgeCut] proxy decode path failed, falling back to seeking:', e && e.message);
        }
        if (!chunks) chunks = await buildBySeeking();
        v.removeAttribute('src'); v.load();

        async function buildBySeeking() {
            const chunks = [];
            let encErr = null;
            const enc = new VideoEncoder({
                output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push(b); },
                error: (e) => { encErr = e; }
            });
            enc.configure(config);

            const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
            const g = cv.getContext('2d');
            const total = Math.max(1, Math.ceil(duration * PROXY_FPS - 1e-6));
            try {
                for (let i = 0; i < total; i++) {
                    if (o.signal && o.signal.aborted) throw Object.assign(new Error('Proxy build cancelled.'), { code: 'ECANCELLED' });
                    if (encErr) throw encErr;
                    // Same +0.1 ms frame-boundary guard as export seeking.
                    await seek(v, Math.min(i / PROXY_FPS + 1e-4, Math.max(0, duration - 1e-3)));
                    g.drawImage(v, 0, 0, w, h);
                    const frame = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / PROXY_FPS), duration: Math.round(1e6 / PROXY_FPS) });
                    enc.encode(frame, { keyFrame: i % KEYFRAME_EVERY === 0 });
                    frame.close();
                    await drain(enc, 'encodeQueueSize', 8);
                    if (o.onProgress && (i % 10 === 0)) o.onProgress((i + 1) / total * 0.95);
                }
                await enc.flush();
            } finally {
                try { enc.close(); } catch (e) { /* already closed */ }
            }

            return chunks;
        }

        const ivf = EP().wrapIVF(chunks, codec === 'vp9' ? 'VP90' : 'VP80', w, h, PROXY_FPS);
        const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
        const { toBlobURL } = await import('/vendor/ffmpeg-util/index.js');
        const ff = new FFmpeg();
        try {
            await ff.load({
                coreURL: await toBlobURL('/vendor/ffmpeg-core/ffmpeg-core.js', 'text/javascript'),
                wasmURL: await toBlobURL('/vendor/ffmpeg-core/ffmpeg-core.wasm', 'application/wasm')
            });
            await ff.writeFile('in.ivf', ivf);
            await ff.exec(['-hide_banner', '-y', '-f', 'ivf', '-i', 'in.ivf', '-c:v', 'copy', '-an', 'out.webm']);
            const data = await ff.readFile('out.webm');
            const blob = new Blob([data], { type: 'video/webm' });
            if (!blob.size) throw new Error('Proxy mux produced an empty file.');
            await cachePut(asset.file, blob);
            if (o.onProgress) o.onProgress(1);
            return { blob, width: w, height: h, fps: PROXY_FPS, cached: false, method };
        } finally {
            try { ff.terminate(); } catch (e) { /* ignore */ }
        }
    }

    /** Attach a built proxy to its asset as a ready-to-draw element. */
    async function attach(asset, result) {
        const url = URL.createObjectURL(result.blob);
        const el = document.createElement('video');
        el.muted = true; el.preload = 'auto'; el.playsInline = true; el.src = url;
        // WebM stores times in whole milliseconds (frame 14 = 0.467 s, not
        // 0.46667), so seeking to a frame's exact start can land on the
        // previous one. Seekers aim for the middle of the frame instead.
        el.__fcProxyFps = result.fps;
        await new Promise((ok, fail) => { el.onloadeddata = ok; el.onerror = () => fail(new Error('Proxy file could not be decoded.')); });
        if (asset.proxy && asset.proxy.url) URL.revokeObjectURL(asset.proxy.url);
        asset.proxy = { url, element: el, width: result.width, height: result.height, fps: result.fps, ready: true };
        return asset.proxy;
    }

    async function clearCache() {
        if (!navigator.storage || !navigator.storage.getDirectory) return 0;
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry('forgecut-proxies', { recursive: true });
            return 1;
        } catch (e) { return 0; }
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.ProxyEngine = { PROXY_HEIGHT, PROXY_FPS, needsProxy, proxySize, build, attach, cacheKey, clearCache };
})();
