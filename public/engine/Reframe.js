/**
 * ForgeCut — Auto-reframe engine.
 *
 * Takes where the subject is in sampled frames and turns it into keyframes on
 * the clip's existing x / y / scale. The renderer already draws a video clip
 * centred at (x, y) at its natural size times `scale`, and already
 * interpolates keyframes on those properties, so a reframe is pure data: it
 * previews and exports through the same path as a hand-placed clip and stays
 * hand-editable afterwards.
 *
 * Pure: no DOM, no detector. Detection lives in editor/editor-ai.js.
 */
(function () {
    'use strict';

    const DEFAULTS = {
        zoom: 1,            // extra zoom on top of "cover"
        deadzone: 0.06,     // fraction of the visible width the subject may drift before the camera follows
        smoothing: 0.5,     // seconds; time constant of the zero-phase smoother
        tolerance: 2,       // canvas px; keyframes closer than this to a straight line are dropped
        anchorY: 0.4        // where the subject sits vertically (0 top, 1 bottom) — faces read best above centre
    };

    /** Scale at which a W×H source fully covers a CW×CH canvas. */
    function coverScale(W, H, CW, CH) {
        return Math.max(CW / W, CH / H);
    }

    /**
     * Fill missing detections. Gaps between detections are interpolated;
     * before the first and after the last the nearest detection is held.
     * With no detections at all, the frame centre is used.
     */
    function fillGaps(samples, W, H) {
        const known = samples.filter(s => s.cx != null && s.cy != null);
        if (known.length === 0) return samples.map(s => ({ t: s.t, cx: W / 2, cy: H / 2 }));
        let k = 0;
        return samples.map(s => {
            if (s.cx != null && s.cy != null) return { t: s.t, cx: s.cx, cy: s.cy };
            while (k < known.length - 1 && known[k + 1].t < s.t) k++;
            const a = known[k], b = known[k + 1];
            if (s.t <= a.t || !b) return { t: s.t, cx: a.cx, cy: a.cy };
            const f = (s.t - a.t) / (b.t - a.t);
            return { t: s.t, cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f };
        });
    }

    /** Camera only moves once the subject leaves a dead zone around it. */
    function applyDeadzone(values, dz) {
        if (!values.length || !(dz > 0)) return values.slice();
        const out = [];
        let p = values[0];
        for (const v of values) {
            if (v > p + dz) p = v - dz;
            else if (v < p - dz) p = v + dz;
            out.push(p);
        }
        return out;
    }

    /** Forward then backward exponential smoothing: no lag, no overshoot. */
    function smoothZeroPhase(times, values, tau) {
        const n = values.length;
        if (n < 2 || !(tau > 0)) return values.slice();
        const out = values.slice();
        for (let i = 1; i < n; i++) {
            const a = 1 - Math.exp(-Math.abs(times[i] - times[i - 1]) / tau);
            out[i] = out[i - 1] + a * (out[i] - out[i - 1]);
        }
        for (let i = n - 2; i >= 0; i--) {
            const a = 1 - Math.exp(-Math.abs(times[i + 1] - times[i]) / tau);
            out[i] = out[i + 1] + a * (out[i] - out[i + 1]);
        }
        return out;
    }

    /** Ramer–Douglas–Peucker on [{time, value}], keeping both ends. */
    function simplify(points, tol) {
        if (points.length <= 2 || !(tol > 0)) return points.slice();
        const keep = new Array(points.length).fill(false);
        keep[0] = keep[points.length - 1] = true;
        const stack = [[0, points.length - 1]];
        while (stack.length) {
            const [a, b] = stack.pop();
            let worst = -1, dist = 0;
            for (let i = a + 1; i < b; i++) {
                const f = (points[i].time - points[a].time) / (points[b].time - points[a].time || 1);
                const d = Math.abs(points[i].value - (points[a].value + (points[b].value - points[a].value) * f));
                if (d > dist) { dist = d; worst = i; }
            }
            if (dist > tol && worst > 0) {
                keep[worst] = true;
                stack.push([a, worst], [worst, b]);
            }
        }
        return points.filter((_, i) => keep[i]);
    }

    /**
     * samples: [{ t, cx, cy }] — t in CLIP-LOCAL timeline seconds, (cx, cy) the
     * subject centre in source pixels, or null where nothing was found.
     *
     * → { scale, x, y, keyframes: { x: [{time, value}], y: [...] }, coverage }
     */
    function planReframe(samples, dims, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const { srcWidth: W, srcHeight: H, canvasWidth: CW, canvasHeight: CH } = dims || {};
        if (!(W > 0 && H > 0 && CW > 0 && CH > 0)) throw new Error('planReframe: source and canvas sizes are required');
        const list = (samples || []).slice().sort((a, b) => a.t - b.t);
        const found = list.filter(s => s.cx != null).length;

        const scale = coverScale(W, H, CW, CH) * Math.max(1, o.zoom);
        // Visible window in source pixels.
        const visW = CW / scale, visH = CH / scale;
        const filled = fillGaps(list, W, H);
        const times = filled.map(s => s.t);
        const cx = smoothZeroPhase(times, applyDeadzone(filled.map(s => s.cx), visW * o.deadzone), o.smoothing);
        const cy = smoothZeroPhase(times, applyDeadzone(filled.map(s => s.cy), visH * o.deadzone), o.smoothing);

        // Source point (sx, sy) should land at canvas (CW/2, CH*anchorY).
        // The clip is drawn centred at (x, y), so x = CW/2 - (sx - W/2)·scale.
        // Clamp so the scaled frame always covers the canvas: no black edges.
        const maxDX = Math.max(0, (W * scale - CW) / 2);
        const maxDY = Math.max(0, (H * scale - CH) / 2);
        const clamp = (v, c, m) => Math.min(c + m, Math.max(c - m, v));
        const xs = cx.map(sx => clamp(CW / 2 - (sx - W / 2) * scale, CW / 2, maxDX));
        const ys = cy.map(sy => clamp(CH * o.anchorY - (sy - H / 2) * scale, CH / 2, maxDY));

        const round = v => Math.round(v * 10) / 10;
        // A path that never leaves the tolerance band is a static crop: the
        // clip's base x/y says it all, and keyframes would only add noise.
        const moving = (k) => k.length > 1 &&
            Math.max(...k.map(p => p.value)) - Math.min(...k.map(p => p.value)) > o.tolerance;
        const kx = simplify(times.map((t, i) => ({ time: t, value: round(xs[i]) })), o.tolerance);
        const ky = simplify(times.map((t, i) => ({ time: t, value: round(ys[i]) })), o.tolerance);

        return {
            scale: Math.round(scale * 10000) / 10000,
            x: xs.length ? round(xs[0]) : CW / 2,
            y: ys.length ? round(ys[0]) : CH / 2,
            keyframes: { x: moving(kx) ? kx : [], y: moving(ky) ? ky : [] },
            coverage: list.length ? found / list.length : 0
        };
    }

    /** Pick the subject from detections in one frame: biggest × most confident. */
    function pickSubject(detections, prev) {
        if (!detections || detections.length === 0) return null;
        let best = null, bestScore = -Infinity;
        for (const d of detections) {
            const area = d.width * d.height;
            const cx = d.x + d.width / 2, cy = d.y + d.height / 2;
            // Prefer staying on the same person between samples.
            const stick = prev ? 1 / (1 + Math.hypot(cx - prev.cx, cy - prev.cy) / Math.sqrt(area || 1)) : 1;
            const score = area * (d.score != null ? d.score : 1) * (0.5 + stick);
            if (score > bestScore) { bestScore = score; best = { cx, cy }; }
        }
        return best;
    }

    /**
     * Saliency fallback when no face detector is available: the centroid of
     * frame-to-frame change (motion), weighted toward edges. Works on small
     * greyscale buffers. Returns null for a static frame.
     */
    function motionCentroid(prev, cur, w, h) {
        if (!prev || !cur || prev.length !== cur.length) return null;
        let sx = 0, sy = 0, sum = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const d = Math.abs(cur[i] - prev[i]);
                if (d < 12) continue;            // sensor noise / compression shimmer
                sx += x * d; sy += y * d; sum += d;
            }
        }
        if (sum < w * h * 0.5) return null;      // too little change to trust
        return { cx: sx / sum, cy: sy / sum };
    }

    const API = { DEFAULTS, coverScale, fillGaps, applyDeadzone, smoothZeroPhase, simplify, planReframe, pickSubject, motionCentroid };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Reframe = API;
    }
})();
