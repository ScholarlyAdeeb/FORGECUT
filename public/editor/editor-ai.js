/**
 * ForgeCut editor — AI Shorts commands (Auto Captions, Auto Reframe).
 *
 * Shared by both shells. Everything runs in the browser so it works on a
 * static deployment with no server: Whisper in a worker for speech, MediaPipe
 * for faces. Both write ordinary data — text clips and x/y keyframes — so
 * nothing here touches the renderer or the export path.
 */
(function () {
    'use strict';

    const CAP = () => window.ForgeCut && window.ForgeCut.Captions;
    const RF = () => window.ForgeCut && window.ForgeCut.Reframe;
    const SE = () => window.ForgeCut && window.ForgeCut.SmartEdit;
    const ME = () => window.ForgeCut && window.ForgeCut.MediaEngine;
    let busy = false;
    // Captured at load: document.currentScript is only set while this runs,
    // and both shells load this file from different relative paths.
    const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;

    const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

    function refresh() {
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    }

    function canvasSize() {
        const c = window.canvas || document.getElementById('renderCanvas');
        return { w: (c && c.width) || state.canvasWidth || 1080, h: (c && c.height) || state.canvasHeight || 1920 };
    }

    function captionTrack() {
        return state.tracks.find(t => t.id === 'textTrack') || state.tracks.find(t => t.type === 'text');
    }

    function existingCaptions() {
        const t = captionTrack();
        return t ? t.clips.filter(c => c.captionGroup) : [];
    }

    function mb(bytes) { return (bytes / 1048576).toFixed(0) + ' MB'; }

    /* ── transcription ───────────────────────────────────────────────── */

    let worker = null, seq = 0;
    function transcribe(audio, opts, onProgress) {
        if (!worker) {
            worker = new Worker(new URL('../engine/workers/transcribe-worker.js', SCRIPT_URL), { type: 'module' });
        }
        const id = ++seq;
        return new Promise((resolve, reject) => {
            const onMsg = (e) => {
                const m = e.data || {};
                if (m.id !== id) return;
                if (m.type === 'progress') { onProgress && onProgress(m); return; }
                worker.removeEventListener('message', onMsg);
                if (m.type === 'done') resolve(m);
                else reject(new Error(m.message || 'Transcription failed'));
            };
            worker.addEventListener('message', onMsg);
            worker.postMessage({ id, audio, quality: opts.quality, language: opts.language }, [audio.buffer]);
        });
    }

    /** Swap in caption clips as one undoable step. */
    function placeCaptions(clips, label) {
        const track = captionTrack();
        if (!track) throw new Error('No text track to place captions on.');
        withHistory(label, () => {
            track.clips = track.clips.filter(c => !c.captionGroup).concat(clips);
            const end = clips.reduce((n, c) => Math.max(n, c.startTime + c.duration), 0);
            if (end > state.duration) state.duration = Math.ceil(end);
        });
        refresh();
    }

    async function confirmReplace() {
        if (existingCaptions().length === 0) return true;
        return fcConfirm('This project already has captions. Replace them?', { okLabel: 'Replace', cancelLabel: 'Cancel' });
    }

    window.smartAutoCaptions = async function (opts) {
        if (busy || !CAP()) return;
        const o = Object.assign({ quality: 'fast', style: 'bold', language: 'auto', maxWords: 3 }, opts || {});
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        let end = 0;
        state.tracks.forEach(t => { if (t.type === 'audio') t.clips.forEach(c => { end = Math.max(end, c.startTime + c.duration); }); });
        if (!AE || end <= 0) { fcToast('Nothing to caption — add audio, or a video with sound, first.'); return; }
        if (!(await confirmReplace())) return;

        busy = true;
        try {
            fcToast('Preparing audio…');
            // Whisper expects 16 kHz mono. Rendering the mix means captions
            // follow what is actually audible: muted tracks stay silent.
            const buf = await AE.renderOfflineAudio(state.tracks, end, 16000);
            const chans = [];
            for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
            const mono = Float32Array.from(SE() ? SE().mixToMono(chans) : chans[0]);

            let lastShown = 0;
            const result = await transcribe(mono, o, (p) => {
                const now = Date.now();
                // Cache hits report tiny totals; only a real download is worth a toast.
                if (now - lastShown < 1500 || !(p.total > 5 * 1048576)) return;
                lastShown = now;
                fcToast(`Downloading speech model… ${mb(p.loaded)} of ${mb(p.total)} (first time only)`);
            });
            const words = CAP().wordsFromChunks(result.chunks);
            if (words.length === 0) { fcToast('No speech found.'); return; }
            const pages = CAP().groupWords(words, { maxWords: o.maxWords });
            const { w, h } = canvasSize();
            const clips = CAP().buildCaptionClips(pages, { style: o.style, canvasWidth: w, canvasHeight: h });
            placeCaptions(clips, 'Auto Captions');
            fcToast(`Added ${clips.length} captions (${words.length} words).`);
        } catch (e) {
            console.error('[ForgeCut] auto captions failed', e);
            fcToast('Auto captions failed: ' + (e && e.message || e));
        } finally {
            busy = false;
        }
    };

    /** SRT / VTT → captions. Works with no model at all. */
    window.smartImportCaptions = async function (file, opts) {
        if (!CAP()) return;
        if (!file) {
            file = await new Promise((resolve) => {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = '.srt,.vtt,text/vtt,application/x-subrip';
                inp.onchange = () => resolve(inp.files && inp.files[0]);
                inp.click();
            });
            if (!file) return;
        }
        try {
            const cues = CAP().parseSubtitles(await file.text());
            if (cues.length === 0) { fcToast('No captions found in that file.'); return; }
            if (!(await confirmReplace())) return;
            const o = Object.assign({ style: 'bold', maxWords: 3 }, opts || {});
            const pages = CAP().groupWords(CAP().cuesToWords(cues), { maxWords: o.maxWords });
            const { w, h } = canvasSize();
            const clips = CAP().buildCaptionClips(pages, { style: o.style, canvasWidth: w, canvasHeight: h });
            placeCaptions(clips, 'Import Captions');
            fcToast(`Imported ${cues.length} cues as ${clips.length} captions.`);
        } catch (e) {
            fcToast('Could not read captions: ' + (e && e.message || e));
        }
    };

    window.smartRestyleCaptions = function (style) {
        const caps = existingCaptions();
        if (!caps.length || !CAP() || !CAP().STYLES[style]) { fcToast('No captions to restyle.'); return; }
        const { w, h } = canvasSize();
        const pages = caps.map(c => ({ start: c.startTime, end: c.startTime + c.duration, text: c.captionSource != null ? c.captionSource : c.text }));
        const fresh = CAP().buildCaptionClips(pages, { style, canvasWidth: w, canvasHeight: h, group: caps[0].captionGroup });
        // Only the look changes: ids, and any words the user retyped, survive.
        fresh.forEach((c, i) => {
            c.id = caps[i].id;
            c.text = CAP().restyledText(caps[i], style);
        });
        placeCaptions(fresh, 'Restyle Captions');
    };

    /** Step through the caption looks; one undo entry per step. */
    window.smartCycleCaptionStyle = function () {
        const caps = existingCaptions();
        if (!caps.length || !CAP()) { fcToast('No captions to restyle.'); return; }
        const names = Object.keys(CAP().STYLES);
        const next = names[(names.indexOf(caps[0].captionStyle) + 1) % names.length];
        window.smartRestyleCaptions(next);
        fcToast(`Caption style: ${CAP().STYLES[next].label}`);
    };

    window.smartRemoveCaptions = function () {
        if (!existingCaptions().length) { fcToast('No captions to remove.'); return; }
        placeCaptions([], 'Remove Captions');
    };

    window.smartExportSRT = function () {
        const caps = existingCaptions();
        if (!caps.length || !CAP()) { fcToast('No captions to export.'); return; }
        const blob = new Blob([CAP().toSRT(caps)], { type: 'application/x-subrip' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (state.projectName || 'captions').replace(/[\\/:*?"<>|]+/g, '_') + '.srt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    /* ── auto reframe ────────────────────────────────────────────────── */

    let faceDetector = null;
    async function getFaceDetector() {
        if (faceDetector !== null) return faceDetector;
        try {
            const v = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
            const files = await v.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
            const make = (delegate) => v.FaceDetector.createFromOptions(files, {
                baseOptions: { modelAssetPath: FACE_MODEL, delegate },
                runningMode: 'IMAGE',
                minDetectionConfidence: 0.5
            });
            try { faceDetector = await make('GPU'); } catch (e) { faceDetector = await make('CPU'); }
        } catch (e) {
            console.warn('[ForgeCut] face detector unavailable, using motion only:', e && e.message);
            faceDetector = false;
        }
        return faceDetector;
    }

    window.smartAutoReframe = async function (opts) {
        if (busy || !RF()) return;
        const o = Object.assign({ zoom: 1, rate: 5 }, opts || {});
        const clip = state.selectedClipId ? findClipById(state.selectedClipId) : null;
        const track = clip && state.tracks.find(t => t.clips.includes(clip));
        const asset = clip && ME() ? ME().getAsset(clip.assetId) : null;
        if (!clip || !track || track.type !== 'video' || !asset || asset.type !== 'video') {
            fcToast('Select a video clip to reframe.');
            return;
        }
        if (state.trackLock && state.trackLock[track.id]) { fcToast('That track is locked.'); return; }

        // Reframing only means something when the canvas is a different shape
        // from the footage. The common case is a 16:9 import, which sets the
        // canvas to 16:9 — so offer the vertical canvas this is usually for.
        const cs = canvasSize();
        if (asset.width && asset.height &&
            Math.abs(cs.w / cs.h - asset.width / asset.height) < 0.02) {
            const vertical = cs.w < cs.h;
            const ok = await fcConfirm(
                `The canvas is ${cs.w}×${cs.h}, the same shape as this clip, so there is nothing to reframe. ` +
                `Switch the canvas to ${vertical ? '16:9 (1920×1080)' : '9:16 (1080×1920)'} first?`,
                { okLabel: vertical ? 'Switch to 16:9' : 'Switch to 9:16', cancelLabel: 'Cancel' });
            if (!ok) return;
            if (vertical) window.setAspectRatio(16, 9); else window.setAspectRatio(9, 16);
        }

        busy = true;
        const v = document.createElement('video');
        try {
            fcToast('Finding the subject…');
            v.muted = true;
            v.preload = 'auto';
            v.src = asset.objectUrl;
            await new Promise((ok, fail) => {
                v.onloadeddata = ok;
                v.onerror = () => fail(new Error('Could not decode this video in the browser.'));
            });
            const W = v.videoWidth, H = v.videoHeight;
            const detector = await getFaceDetector();

            // Detection frame: big enough for small faces, small enough to be quick.
            const dw = Math.min(640, W), dh = Math.round(H * dw / W);
            const det = document.createElement('canvas'); det.width = dw; det.height = dh;
            const dctx = det.getContext('2d', { willReadFrequently: true });
            // Motion frame for the fallback.
            const mw = 64, mh = Math.max(1, Math.round(64 * H / W));
            const mot = document.createElement('canvas'); mot.width = mw; mot.height = mh;
            const mctx = mot.getContext('2d', { willReadFrequently: true });

            const seek = (t) => new Promise((ok) => {
                const done = () => { v.removeEventListener('seeked', done); ok(); };
                v.addEventListener('seeked', done);
                v.currentTime = t;
            });
            const speed = clip.playbackSpeed || 1;
            const from = clip.trimStart || 0;
            const step = 1 / o.rate;
            const samples = [];
            let prevGrey = null, prev = null, faces = 0;
            for (let local = 0; local <= clip.duration + 1e-6; local += step) {
                const src = Math.min(from + local * speed, (v.duration || Infinity) - 0.01);
                await seek(src);
                dctx.drawImage(v, 0, 0, dw, dh);
                let subject = null;
                if (detector) {
                    const r = detector.detect(det);
                    const boxes = (r.detections || []).map(d => ({
                        x: d.boundingBox.originX * W / dw, y: d.boundingBox.originY * H / dh,
                        width: d.boundingBox.width * W / dw, height: d.boundingBox.height * H / dh,
                        score: d.categories && d.categories[0] ? d.categories[0].score : 1
                    }));
                    subject = RF().pickSubject(boxes, prev);
                    if (subject) faces++;
                }
                mctx.drawImage(v, 0, 0, mw, mh);
                const rgba = mctx.getImageData(0, 0, mw, mh).data;
                const grey = new Uint8Array(mw * mh);
                for (let i = 0; i < grey.length; i++) grey[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
                if (!subject) {
                    const m = RF().motionCentroid(prevGrey, grey, mw, mh);
                    if (m) subject = { cx: m.cx * W / mw, cy: m.cy * H / mh };
                }
                prevGrey = grey;
                if (subject) prev = subject;
                samples.push({ t: local, cx: subject ? subject.cx : null, cy: subject ? subject.cy : null });
            }

            const { w: CW, h: CH } = canvasSize();
            const plan = RF().planReframe(samples, { srcWidth: W, srcHeight: H, canvasWidth: CW, canvasHeight: CH }, { zoom: o.zoom });
            withHistory('Auto Reframe', () => {
                clip.scale = plan.scale;
                clip.x = plan.x;
                clip.y = plan.y;
                const kf = clip.keyframes && !Array.isArray(clip.keyframes) ? clip.keyframes : {};
                delete kf.x; delete kf.y; delete kf.scale;
                if (plan.keyframes.x.length) kf.x = plan.keyframes.x;
                if (plan.keyframes.y.length) kf.y = plan.keyframes.y;
                clip.keyframes = kf;
            });
            refresh();
            const how = faces ? `face found in ${Math.round(100 * faces / samples.length)}% of frames`
                : plan.coverage > 0 ? 'no faces, followed motion' : 'nothing to follow, centred';
            fcToast(`Reframed (${how}).`);
        } catch (e) {
            console.error('[ForgeCut] auto reframe failed', e);
            fcToast('Auto reframe failed: ' + (e && e.message || e));
        } finally {
            v.removeAttribute('src');
            v.load();
            busy = false;
        }
    };
})();
