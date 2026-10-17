/**
 * ForgeCut editor — Smart Edit commands (Remove Silence, Detect Scenes).
 *
 * Shared by both shells. The analysis and timeline arithmetic live in
 * engine/SmartEdit.js; this file only gathers input from the live project,
 * asks the user, and applies the result as ONE undo step.
 */
(function () {
    'use strict';

    const SE = () => window.ForgeCut && window.ForgeCut.SmartEdit;
    const ME = () => window.ForgeCut && window.ForgeCut.MediaEngine;
    let busy = false;

    function contentEnd(types) {
        let end = 0;
        state.tracks.forEach(t => {
            if (types && types.indexOf(t.type) === -1) return;
            t.clips.forEach(c => { end = Math.max(end, c.startTime + c.duration); });
        });
        return end;
    }

    /** Swap in new clip arrays while keeping the track objects other code holds. */
    function applyTracks(next) {
        state.tracks.forEach((t, i) => { t.clips = next[i].clips; });
        const ids = new Set();
        state.tracks.forEach(t => t.clips.forEach(c => ids.add(c.id)));
        if (state.selectedClipId && !ids.has(state.selectedClipId)) state.selectedClipId = null;
        if (state.selectedClipIds) state.selectedClipIds = state.selectedClipIds.filter(id => ids.has(id));
    }

    function refresh() {
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    }

    const fmt = (s) => s < 10 ? s.toFixed(1) + ' s' : Math.round(s) + ' s';

    /**
     * Analyse what the project actually sounds like (mute, solo and volume
     * automation included) and ripple out the quiet stretches on every
     * unlocked track.
     */
    async function analyseSilences(opts) {
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        const end = contentEnd(['audio']);
        if (!AE || end <= 0) return null;
        const sr = 16000;   // plenty for an RMS envelope, 1/3 the work of 48k
        const buf = await AE.renderOfflineAudio(state.tracks, end, sr);
        const chans = [];
        for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
        const silent = SE().findSilences(SE().mixToMono(chans), buf.sampleRate, opts);
        // Only where there IS audio to be silent. A stretch with no audio
        // clip at all (B-roll, a title card) is deliberate, not dead air.
        const covered = [];
        state.tracks.forEach(t => {
            if (t.type !== 'audio') return;
            t.clips.forEach(c => covered.push({ start: c.startTime, end: c.startTime + c.duration }));
        });
        return SE().intersectSpans(silent, covered).filter(s => s.end - s.start >= 0.2);
    }

    window.smartRemoveSilence = async function (opts) {
        if (busy || !SE()) return;
        if (contentEnd(['audio']) <= 0) {
            fcToast('Nothing to analyse — add audio, or a video with sound, first.');
            return;
        }
        busy = true;
        try {
            fcToast('Listening for silence…');
            const spans = await analyseSilences(opts);
            if (!spans || spans.length === 0) {
                fcToast('No silences long enough to remove.');
                return;
            }
            const total = SE().totalLength(spans);
            const ok = await fcConfirm(
                `Found ${spans.length} silent section${spans.length === 1 ? '' : 's'} (${fmt(total)} in total). ` +
                'Remove them and close the gaps on every unlocked track?',
                { okLabel: 'Remove Silence', cancelLabel: 'Cancel' });
            if (!ok) return;

            withHistory('Remove Silence', () => {
                const r = SE().rippleDeleteRanges(state.tracks, spans, { locked: state.trackLock || {} });
                applyTracks(r.tracks);
                state.duration = Math.max(contentEnd(), state.duration - r.removed, 1);
                if (state.currentTime > state.duration) state.currentTime = 0;
                if (r.linkedBroken) {
                    fcToast('Some linked clips were on locked tracks and have been unlinked.');
                }
            });
            refresh();
            fcToast(`Removed ${fmt(total)} of silence.`);
        } catch (e) {
            console.error('[ForgeCut] silence removal failed', e);
            fcToast('Silence removal failed: ' + (e && e.message || e));
        } finally {
            busy = false;
        }
    };

    /* ── scene detection ─────────────────────────────────────────────── */

    async function scenesFromServer(file, threshold) {
        // On a static host (Vercel) there is no export server. Ask the probe
        // instead of uploading the whole file just to be told so.
        const CR = window.ForgeCut && window.ForgeCut.CapabilityRegistry;
        if (CR) {
            try { await CR.probe(); } catch (e) { /* treated as unavailable below */ }
            if (!CR.server || !CR.server.available) return null;
            if (CR.server.maxUploadBytes && file.size > CR.server.maxUploadBytes) return null;
        }
        let res;
        try {
            res = await fetch(`/api/export/analyze/scenes?threshold=${encodeURIComponent(threshold)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file
            });
        } catch (e) {
            return null;                          // no server: use the browser
        }
        if (res.status === 404 || res.status === 405 || res.status === 413 || res.status === 503) return null;
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
        return body.cuts || [];
    }

    /**
     * Browser fallback: sample a thumbnail-sized frame every 1/rate seconds
     * and compare consecutive frames. Coarser than FFmpeg's detector, but it
     * needs nothing installed.
     */
    async function scenesInBrowser(url, from, to, threshold, rate) {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = url;
        await new Promise((ok, fail) => {
            v.onloadeddata = ok;
            v.onerror = () => fail(new Error('Could not decode this video in the browser.'));
        });
        const W = 64, H = 36;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const g = cv.getContext('2d', { willReadFrequently: true });
        const seek = (t) => new Promise((ok) => {
            const done = () => { v.removeEventListener('seeked', done); ok(); };
            v.addEventListener('seeked', done);
            v.currentTime = t;
        });
        const samples = [];
        let prev = null;
        const step = 1 / (rate || 5);
        const stop = Math.min(to, v.duration || to);
        for (let n = 0, t = from; t < stop; n++, t = from + n * step) {
            await seek(t);
            g.drawImage(v, 0, 0, W, H);
            const cur = g.getImageData(0, 0, W, H).data;
            if (prev) samples.push({ time: t, diff: SE().frameDifference(prev, cur) });
            prev = cur;
        }
        v.removeAttribute('src');
        v.load();
        // Mean luma change per sample is a far smaller number than FFmpeg's
        // scene score, so scale the user's threshold to the same feel.
        return SE().pickSceneCuts(samples, { threshold: threshold * 0.5, minGap: 0.5 });
    }

    window.smartDetectScenes = async function (opts) {
        if (busy || !SE()) return;
        const o = Object.assign({ threshold: 0.3 }, opts || {});
        const clip = state.selectedClipId ? findClipById(state.selectedClipId) : null;
        const track = clip && state.tracks.find(t => t.clips.includes(clip));
        const asset = clip && ME() ? ME().getAsset(clip.assetId) : null;
        if (!clip || !track || track.type !== 'video' || !asset || asset.type !== 'video') {
            fcToast('Select a video clip to detect scenes in.');
            return;
        }
        if (state.trackLock && state.trackLock[track.id]) {
            fcToast('That track is locked.');
            return;
        }
        let threshold;
        try { threshold = SE().validateSceneThreshold(o.threshold); }
        catch (e) { fcToast(e.message); return; }

        busy = true;
        try {
            fcToast('Detecting scene changes…');
            const TM = window.ForgeCut && window.ForgeCut.TimeMap;
            const speed = clip.playbackSpeed || 1;
            const srcFrom = clip.trimStart || 0;
            const srcTo = TM ? TM.sourceTime(clip, clip.duration) : srcFrom + clip.duration * speed;

            let cuts = asset.file ? await scenesFromServer(asset.file, threshold) : null;
            if (cuts === null) {
                cuts = await scenesInBrowser(asset.objectUrl, srcFrom, srcTo, threshold, 5);
            }
            // Source seconds → timeline seconds, keeping only this clip's span.
            const onTimeline = SE().dedupeCuts(
                cuts.filter(s => s > srcFrom && s < srcTo)
                    .map(s => TM ? TM.localTimeForSource(clip, s) : (s - srcFrom) / speed)
                    .filter(t => t != null),
                0.5, clip.duration
            ).map(t => clip.startTime + t);

            if (onTimeline.length === 0) {
                fcToast('No scene changes found in this clip.');
                return;
            }
            const ok = await fcConfirm(
                `Found ${onTimeline.length} scene change${onTimeline.length === 1 ? '' : 's'}. ` +
                `Split the clip into ${onTimeline.length + 1} parts?`,
                { okLabel: 'Split at Scenes', cancelLabel: 'Cancel' });
            if (!ok) return;

            withHistory('Split at Scenes', () => {
                const r = SE().splitTracksAt(state.tracks, clip.id, onTimeline, { locked: state.trackLock || {} });
                applyTracks(r.tracks);
            });
            refresh();
            fcToast(`Split into ${onTimeline.length + 1} scenes.`);
        } catch (e) {
            console.error('[ForgeCut] scene detection failed', e);
            fcToast('Scene detection failed: ' + (e && e.message || e));
        } finally {
            busy = false;
        }
    };
})();
