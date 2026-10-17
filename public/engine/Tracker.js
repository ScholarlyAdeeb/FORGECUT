/**
 * ForgeCut — point/region motion tracker (pure).
 *
 * Template matching with zero-mean normalised cross-correlation (ZNCC):
 * insensitive to overall brightness and contrast changes, which is what
 * breaks plain difference matching when a subject walks into shadow.
 *
 *   coarse search on a 2× downsampled frame → refine ±2 px at full scale →
 *   sub-pixel parabola fit → slow template adaptation on confident matches
 *
 * Works on single-channel 8-bit frames (see toGray). Knows nothing about
 * video elements, clips or keyframes: the editor feeds frames in and writes
 * the path out (editor-motion.js).
 */
(function () {
    'use strict';

    const DEFAULTS = {
        searchScale: 0.9,     // search radius as a fraction of the template's larger side
        minRadius: 12,        // px at analysis resolution
        adapt: 0.12,          // template blend toward the latest match
        adaptAbove: 0.85,     // only adapt on matches at least this good
        lostBelow: 0.45       // a best score under this is "lost"
    };

    function toGray(rgba, w, h) {
        const g = new Uint8Array(w * h);
        for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
        return g;
    }

    function downsample(g, w, h) {
        const w2 = w >> 1, h2 = h >> 1, out = new Uint8Array(w2 * h2);
        for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
            const i = (2 * y) * w + 2 * x;
            out[y * w2 + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) >> 2;
        }
        return { g: out, w: w2, h: h2 };
    }

    /** Patch of size tw×th whose top-left is (x0, y0), edge-clamped, as floats. */
    function extract(g, w, h, x0, y0, tw, th) {
        const p = new Float32Array(tw * th);
        for (let y = 0; y < th; y++) {
            const sy = Math.min(h - 1, Math.max(0, y0 + y));
            for (let x = 0; x < tw; x++) {
                const sx = Math.min(w - 1, Math.max(0, x0 + x));
                p[y * tw + x] = g[sy * w + sx];
            }
        }
        return p;
    }

    /** Mean-subtract and normalise a template once; reused for every candidate. */
    function prepare(p) {
        let m = 0;
        for (let i = 0; i < p.length; i++) m += p[i];
        m /= p.length;
        const z = new Float32Array(p.length);
        let ss = 0;
        for (let i = 0; i < p.length; i++) { z[i] = p[i] - m; ss += z[i] * z[i]; }
        return { z, norm: Math.sqrt(ss) };
    }

    /** ZNCC of a prepared template against the frame at top-left (x0, y0). */
    function zncc(g, w, h, t, tw, th, x0, y0) {
        if (!(t.norm > 1e-6)) return 0;            // flat template: nothing to match on
        let sum = 0, sum2 = 0, cross = 0;
        const n = tw * th;
        for (let y = 0; y < th; y++) {
            const sy = Math.min(h - 1, Math.max(0, y0 + y)), row = sy * w;
            for (let x = 0; x < tw; x++) {
                const v = g[row + Math.min(w - 1, Math.max(0, x0 + x))];
                sum += v; sum2 += v * v;
                cross += v * t.z[y * tw + x];
            }
        }
        const varI = sum2 - sum * sum / n;
        if (!(varI > 1e-6)) return 0;
        return cross / (Math.sqrt(varI) * t.norm);
    }

    function bestIn(g, w, h, t, tw, th, cx0, cy0, radius) {
        let best = -2, bx = cx0, by = cy0;
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const s = zncc(g, w, h, t, tw, th, cx0 + dx, cy0 + dy);
            if (s > best) { best = s; bx = cx0 + dx; by = cy0 + dy; }
        }
        return { x: bx, y: by, score: best };
    }

    /** Vertex of the parabola through three samples; offset in (-0.5, 0.5). */
    function parabola(a, b, c) {
        const d = a - 2 * b + c;
        if (!(Math.abs(d) > 1e-9)) return 0;
        return Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d));
    }

    /**
     * Start tracking the box { cx, cy, w, h } (centre and size, in pixels) in
     * the first frame. Returns { update(frame) → { cx, cy, score, lost } }.
     */
    function create(frame0, w, h, box, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const tw = Math.max(8, Math.round(box.w) | 0) & ~1, th = Math.max(8, Math.round(box.h) | 0) & ~1;
        let x0 = Math.round(box.cx - tw / 2), y0 = Math.round(box.cy - th / 2);
        let tplRaw = extract(frame0, w, h, x0, y0, tw, th);
        const original = prepare(tplRaw);
        let tpl = original;
        const radius = Math.max(o.minRadius, Math.round(Math.max(tw, th) * o.searchScale));
        let fx = box.cx, fy = box.cy;

        function update(frame) {
            // Coarse: half resolution, half-size template.
            const d = downsample(frame, w, h);
            const half = downsample(Float32ToU8(tplRaw), tw, th);
            const tHalf = prepare(Float32Array.from(half.g));
            const c = bestIn(d.g, d.w, d.h, tHalf, half.w, half.h, Math.round(x0 / 2), Math.round(y0 / 2), Math.ceil(radius / 2));
            // Fine: full resolution around the coarse hit.
            const f = bestIn(frame, w, h, tpl, tw, th, c.x * 2, c.y * 2, 2);
            let score = f.score;
            // Guard against template drift: also score the ORIGINAL template;
            // trust whichever agrees better.
            const so = zncc(frame, w, h, original, tw, th, f.x, f.y);
            if (so > score) score = so;
            if (score < o.lostBelow) return { cx: fx, cy: fy, score, lost: true };

            const sx = parabola(zncc(frame, w, h, tpl, tw, th, f.x - 1, f.y), f.score, zncc(frame, w, h, tpl, tw, th, f.x + 1, f.y));
            const sy = parabola(zncc(frame, w, h, tpl, tw, th, f.x, f.y - 1), f.score, zncc(frame, w, h, tpl, tw, th, f.x, f.y + 1));
            x0 = f.x; y0 = f.y;
            fx = f.x + sx + tw / 2; fy = f.y + sy + th / 2;
            if (score >= o.adaptAbove && o.adapt > 0) {
                const cur = extract(frame, w, h, x0, y0, tw, th);
                for (let i = 0; i < tplRaw.length; i++) tplRaw[i] = tplRaw[i] * (1 - o.adapt) + cur[i] * o.adapt;
                tpl = prepare(tplRaw);
            }
            return { cx: fx, cy: fy, score, lost: false };
        }

        return { update, size: { w: tw, h: th }, radius };
    }

    function Float32ToU8(p) {
        const u = new Uint8Array(p.length);
        for (let i = 0; i < p.length; i++) u[i] = p[i] < 0 ? 0 : p[i] > 255 ? 255 : p[i];
        return u;
    }

    const API = { DEFAULTS, toGray, downsample, extract, prepare, zncc, parabola, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Tracker = API;
    }
})();
