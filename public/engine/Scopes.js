/**
 * ForgeCut — video scopes (pure maths).
 *
 * All three take straight RGBA bytes of a SMALL, downsampled frame: the view
 * that drives them reads the canvas at most a few times a second, never once
 * per rendered frame (see the Phase 3 plan: scopes must not become the
 * readback that makes GPU compositing slow).
 *
 * Luma and chroma use BT.709, matching the effect maths in Effects.js.
 */
(function () {
    'use strict';

    const KR = 0.2126, KG = 0.7152, KB = 0.0722;

    /** 256-bin histograms of R, G, B and luma. Transparent pixels are ignored. */
    function histogram(px) {
        const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            r[px[i]]++; g[px[i + 1]]++; b[px[i + 2]]++;
            l[Math.round(KR * px[i] + KG * px[i + 1] + KB * px[i + 2])]++;
        }
        return { r, g, b, l };
    }

    /**
     * Luma waveform: for each image column, how many pixels sit at each of
     * `levels` luma levels. → { cols, levels, data: Uint32Array(cols*levels) },
     * row-major by level (level 0 = black).
     */
    function waveform(px, w, h, levels) {
        const L = levels || 128;
        const data = new Uint32Array(w * L);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (px[i + 3] === 0) continue;
            const v = (KR * px[i] + KG * px[i + 1] + KB * px[i + 2]) / 255;
            const lv = Math.min(L - 1, Math.round(v * (L - 1)));
            data[lv * w + x]++;
        }
        return { cols: w, levels: L, data };
    }

    /**
     * Vectorscope: 2D histogram of chroma (Cb across, Cr up), `size` × `size`,
     * centre = neutral. Cb and Cr span about ±0.5 for full-range sRGB.
     */
    function vectorscope(px, size) {
        const S = size || 128;
        const data = new Uint32Array(S * S);
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue;
            const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
            const y = KR * r + KG * g + KB * b;
            const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
            const x = Math.min(S - 1, Math.max(0, Math.round((cb + 0.5) * (S - 1))));
            const yy = Math.min(S - 1, Math.max(0, Math.round((0.5 - cr) * (S - 1))));
            data[yy * S + x]++;
        }
        return { size: S, data };
    }

    /** Where a pure colour lands on the vectorscope, for the target boxes. */
    function vectorTarget(r, g, b, size) {
        const S = size || 128;
        const y = KR * r + KG * g + KB * b;
        const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
        return { x: (cb + 0.5) * (S - 1), y: (0.5 - cr) * (S - 1) };
    }

    const API = { histogram, waveform, vectorscope, vectorTarget };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Scopes = API;
    }
})();
