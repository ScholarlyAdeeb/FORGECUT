/**
 * ForgeCut editor — speed ramps, motion tracking and pinning.
 *
 * Shared by both shells. Like the rest of the AI/visual tools these only
 * WRITE DATA the renderer already understands — playbackSpeed keyframes,
 * mask centre keyframes, x/y keyframes — so they preview, export, split,
 * undo and stay hand-editable with no special handling.
 */
(function () {
    'use strict';

    const TM = () => window.ForgeCut && window.ForgeCut.TimeMap;
    const FX = () => window.ForgeCut && window.ForgeCut.Effects;
    const ME = () => window.ForgeCut && window.ForgeCut.MediaEngine;
    let busy = false;

    function refresh() {
        renderTimeline();
        updateInspector();
        if (window.MacUI && window.MacUI.renderInspector) window.MacUI.renderInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    }
    const trackOf = (clip) => state.tracks.find(t => t.clips.includes(clip));
    const locked = (clip) => { const t = clip && trackOf(clip); return !t || (state.trackLock && state.trackLock[t.id]); };
    /** The clip and its linked partner: speed must change on both or A/V drifts apart. */
    function withLinked(clip) {
        const out = [clip];
        const l = clip.linkedClipId ? findClipById(clip.linkedClipId) : null;
        if (l && !locked(l) && Math.abs(l.startTime - clip.startTime) < 1e-3) out.push(l);
        return out;
    }
    const kfObj = (clip) => (clip.keyframes && !Array.isArray(clip.keyframes)) ? clip.keyframes : (clip.keyframes = {});

    /* ── speed ───────────────────────────────────────────────────────── */

    /** Constant speed (slider). Mutates live; the inspector wiring records undo. */
    window.setClipSpeed = function (clipId, speed) {
        const clip = findClipById(clipId);
        if (!clip || locked(clip) || !TM()) return;
        const s = TM().clampSpeed(Number(speed) || 1);
        withLinked(clip).forEach(c => { c.playbackSpeed = s; });
        renderCanvasComposition();
        syncMediaPlayback();
    };

    /**
     * Apply a ramp preset (TimeMap.PRESETS) to a clip and its linked audio.
     * If the ramp would need more source than the media has left, the clip is
     * shortened to fit rather than freezing on its last frame.
     */
    window.applySpeedRamp = function (clipId, preset) {
        const clip = findClipById(clipId);
        if (!clip || locked(clip) || !TM()) return;
        const P = TM().PRESETS[preset];
        if (!P) return;
        const asset = ME() ? ME().getAsset(clip.assetId) : null;
        const available = asset && asset.duration ? asset.duration - (clip.trimStart || 0) : Infinity;
        let newDur = clip.duration, shortened = false;
        if (P.points) {
            newDur = TM().fitDuration(P.points, available, clip.duration);
            shortened = newDur < clip.duration - 1e-3;
        }
        withHistory(P.points ? `Speed Ramp: ${P.label}` : 'Remove Speed Ramp', () => {
            withLinked(clip).forEach(c => {
                const k = kfObj(c);
                if (P.points) {
                    k.playbackSpeed = TM().presetKeyframes(preset, newDur);
                    c.duration = newDur;
                    c.speedRamp = preset;
                } else {
                    delete k.playbackSpeed;
                    delete c.speedRamp;
                }
            });
        });
        refresh();
        if (shortened) fcToast(`Shortened to ${newDur.toFixed(2)} s so the ramp does not run past the end of the media.`);
    };

    /* ── motion tracking ─────────────────────────────────────────────── */

    function seekTo(v, t) {
        return new Promise((ok) => {
            const done = () => { v.removeEventListener('seeked', done); ok(); };
            v.addEventListener('seeked', done);
            // +0.1 ms keeps float error from landing just before a frame boundary.
            v.currentTime = Math.max(0, Math.min(t + 1e-4, (v.duration || t) - 0.01));
        });
    }

    /**
     * Track the region under a Mask effect, forward and backward from the
     * playhead across the clip, and write the path as the mask's centre
     * keyframes. The raw path is kept on the clip (clip.motionTracks) so
     * other clips can be pinned to it later.
     */
    window.trackMask = async function (clipId, fxId, opts) {
        if (busy) return;
        const o = Object.assign({ fps: 30 }, opts || {});
        const clip = findClipById(clipId);
        const fx = clip && (clip.effects || []).find(e => e.id === fxId);
        const asset = clip && ME() ? ME().getAsset(clip.assetId) : null;
        const T = window.ForgeCut && window.ForgeCut.Tracker;
        if (!fx || fx.type !== 'mask' || !asset || asset.type !== 'video' || !T || !TM()) {
            fcToast('Select a video clip with a Mask effect to track.');
            return;
        }
        if (locked(clip)) { fcToast('That track is locked.'); return; }
        const local0 = Math.min(clip.duration, Math.max(0, state.currentTime - clip.startTime));
        const at = (p) => window.getInterpolatedValue(clip, FX().keyFor(fx, p), fx.params[p]);
        const box = { cx: at('centerX'), cy: at('centerY'), w: at('width'), h: at('height') };

        busy = true;
        const v = document.createElement('video');
        try {
            fcToast('Tracking motion…');
            v.muted = true; v.preload = 'auto'; v.src = asset.objectUrl;
            await new Promise((ok, fail) => { v.onloadeddata = ok; v.onerror = () => fail(new Error('Could not decode this video.')); });
            const W = v.videoWidth, H = v.videoHeight;
            // Analysis size: keep the template around 64 px on its long side —
            // big regions are tracked on a small frame, small ones on a larger
            // one — capped at 640 px wide.
            const regionPx = Math.max(box.w * W, box.h * H, 1);
            const AW = Math.max(64, Math.min(640, W, Math.round(W * 64 / regionPx)));
            const AH = Math.max(2, Math.round(AW * H / W));
            const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
            const g = cv.getContext('2d', { willReadFrequently: true });
            const grab = async (local) => {
                await seekTo(v, TM().sourceTime(clip, local));
                g.drawImage(v, 0, 0, AW, AH);
                return T.toGray(g.getImageData(0, 0, AW, AH).data, AW, AH);
            };
            const start = { cx: box.cx * AW, cy: box.cy * AH, w: box.w * AW, h: box.h * AH };
            const points = [{ t: local0, x: box.cx, y: box.cy, lost: false }];
            let lostCount = 0;
            for (const dir of [1, -1]) {
                const tr = T.create(await grab(local0), AW, AH, start);
                // Times from an integer index, never by accumulating step:
                // repeated += lands just short of frame boundaries.
                for (let i = 1; ; i++) {
                    const t = local0 + dir * i / o.fps;
                    if (dir > 0 ? t > clip.duration + 1e-6 : t < -1e-6) break;
                    const r = tr.update(await grab(Math.max(0, Math.min(clip.duration, t))));
                    if (r.lost) lostCount++;
                    points.push({ t: Math.max(0, Math.min(clip.duration, t)), x: r.cx / AW, y: r.cy / AH, lost: r.lost });
                }
            }
            points.sort((a, b) => a.t - b.t);
            const good = points.filter(p => !p.lost);
            const simplify = window.ForgeCut.Reframe ? window.ForgeCut.Reframe.simplify : (p) => p;
            const kx = simplify(good.map(p => ({ time: p.t, value: Math.round(p.x * 1e4) / 1e4 })), 0.0015);
            const ky = simplify(good.map(p => ({ time: p.t, value: Math.round(p.y * 1e4) / 1e4 })), 0.0015);

            withHistory('Track Motion', () => {
                const k = kfObj(clip);
                k[FX().keyFor(fx, 'centerX')] = kx;
                k[FX().keyFor(fx, 'centerY')] = ky;
                clip.motionTracks = clip.motionTracks || {};
                clip.motionTracks[fx.id] = {
                    name: `${clip.name || 'Clip'} · Mask ${(clip.effects.indexOf(fx) + 1)}`,
                    points: points.map(p => ({ t: Math.round(p.t * 1000) / 1000, x: p.x, y: p.y, lost: p.lost || undefined }))
                };
            });
            refresh();
            const pct = Math.round(100 * lostCount / Math.max(1, points.length));
            fcToast(lostCount ? `Tracked ${points.length} frames; lost the subject in ${pct}% (those frames hold position).`
                : `Tracked ${points.length} frames.`);
        } catch (e) {
            console.error('[ForgeCut] tracking failed', e);
            fcToast('Tracking failed: ' + (e && e.message || e));
        } finally {
            v.removeAttribute('src'); v.load();
            busy = false;
        }
    };

    /** Every motion track in the project, for pinning menus. */
    window.listMotionTracks = function () {
        const out = [];
        state.tracks.forEach(t => t.clips.forEach(c => {
            Object.entries(c.motionTracks || {}).forEach(([fxId, tr]) => out.push({ ref: `${c.id}|${fxId}`, label: tr.name, clipId: c.id }));
        }));
        return out;
    };

    /**
     * Where a normalised source point (x, y) of `clip` lands on the canvas at
     * clip-local time t, through the clip's own (keyframed) position, scale,
     * rotation and crop — the same transform the renderer applies.
     */
    function canvasPointOf(clip, asset, t, x, y) {
        const kf = clip.keyframes && !Array.isArray(clip.keyframes) ? clip.keyframes : {};
        const val = (p, d) => TM().interpolate(kf[p], t, clip[p] !== undefined ? clip[p] : d);
        const W = asset.width || (asset.element && asset.element.videoWidth) || 1;
        const H = asset.height || (asset.element && asset.element.videoHeight) || 1;
        const cw = window.canvas ? window.canvas.width : 1080, ch = window.canvas ? window.canvas.height : 1920;
        const X = val('x', cw / 2), Y = val('y', ch / 2), S = val('scale', 1), R = val('rotation', 0) * Math.PI / 180;
        const hasCrop = clip.cropX !== undefined && clip.cropY !== undefined && clip.cropW !== undefined && clip.cropH !== undefined;
        const cx = hasCrop ? val('cropX', 0) + val('cropW', W) / 2 : W / 2;
        const cy = hasCrop ? val('cropY', 0) + val('cropH', H) / 2 : H / 2;
        const dx = (x * W - cx) * S, dy = (y * H - cy) * S;
        return { x: X + dx * Math.cos(R) - dy * Math.sin(R), y: Y + dx * Math.sin(R) + dy * Math.cos(R) };
    }

    /**
     * Pin a clip (text, shape, image…) to a motion track: it keeps its current
     * offset from the subject and follows it, as x/y keyframes.
     */
    window.pinToTrack = function (targetId, ref) {
        const target = findClipById(targetId);
        const [srcId, fxId] = String(ref || '').split('|');
        const src = findClipById(srcId);
        const tr = src && src.motionTracks && src.motionTracks[fxId];
        const asset = src && ME() ? ME().getAsset(src.assetId) : null;
        if (!target || !tr || !asset || !TM()) { fcToast('Choose a motion track to pin to.'); return; }
        if (target === src) { fcToast('A clip cannot be pinned to its own track.'); return; }
        if (locked(target)) { fcToast('That track is locked.'); return; }
        const pts = tr.points.filter(p => !p.lost);
        if (!pts.length) { fcToast('That track has no usable points.'); return; }

        // Offset from the subject at the playhead, so the pinned clip stays
        // exactly where the user put it relative to what it follows.
        const nearest = (t) => pts.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
        const kfT = target.keyframes && !Array.isArray(target.keyframes) ? target.keyframes : {};
        const tLocalNow = state.currentTime - target.startTime;
        const curX = TM().interpolate(kfT.x, tLocalNow, target.x !== undefined ? target.x : (window.canvas ? window.canvas.width / 2 : 540));
        const curY = TM().interpolate(kfT.y, tLocalNow, target.y !== undefined ? target.y : (window.canvas ? window.canvas.height / 2 : 960));
        const pNow = nearest(state.currentTime - src.startTime);
        const anchor = canvasPointOf(src, asset, pNow.t, pNow.x, pNow.y);
        const ox = curX - anchor.x, oy = curY - anchor.y;

        const kx = [], ky = [];
        pts.forEach(p => {
            const timeline = src.startTime + p.t;
            const tl = timeline - target.startTime;
            if (tl < -1e-6 || tl > target.duration + 1e-6) return;
            const c = canvasPointOf(src, asset, p.t, p.x, p.y);
            kx.push({ time: Math.round(tl * 1000) / 1000, value: Math.round((c.x + ox) * 10) / 10 });
            ky.push({ time: Math.round(tl * 1000) / 1000, value: Math.round((c.y + oy) * 10) / 10 });
        });
        if (kx.length < 2) { fcToast('The track and this clip do not overlap in time.'); return; }
        const simplify = window.ForgeCut.Reframe ? window.ForgeCut.Reframe.simplify : (p) => p;
        withHistory('Pin to Motion', () => {
            const k = kfObj(target);
            k.x = simplify(kx, 0.75);
            k.y = simplify(ky, 0.75);
            if (target.x === undefined) target.x = curX;
            if (target.y === undefined) target.y = curY;
            target.pinnedTo = ref;
        });
        refresh();
        fcToast(`Pinned to ${tr.name}.`);
    };

    window.unpinClip = function (targetId) {
        const target = findClipById(targetId);
        if (!target || !target.pinnedTo || locked(target)) return;
        withHistory('Unpin', () => {
            const k = kfObj(target);
            const t = state.currentTime - target.startTime;
            // Freeze where it is now, rather than jumping back.
            target.x = TM().interpolate(k.x, t, target.x);
            target.y = TM().interpolate(k.y, t, target.y);
            delete k.x; delete k.y; delete target.pinnedTo;
        });
        refresh();
    };
})();
