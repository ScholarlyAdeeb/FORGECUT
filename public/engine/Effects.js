/**
 * ForgeCut — Effect stack model and reference implementations.
 *
 * A clip may carry an ordered effect stack:
 *
 *     clip.effects = [
 *       { id: 'fx_ab12', type: 'adjust', enabled: true, params: { brightness: 1.2, ... } },
 *       { id: 'fx_cd34', type: 'vignette', enabled: true, params: { amount: 0.5, ... } }
 *     ]
 *
 * Effects run top to bottom on the clip's source frame, BEFORE the clip is
 * positioned on the canvas. The compositor (engine/Compositor.js) runs them on
 * the GPU; this file defines what each one MEANS, with a per-pixel CPU
 * reference used as the fallback when WebGL2 is unavailable and as the
 * ground truth the GPU output is tested against.
 *
 * COLOUR SPACE — decided once, here: effects operate on sRGB-encoded values
 * in 0..1, the same space ctx.filter and CSS filter functions use. That makes
 * the GPU path match the 2D path it sits beside, and keeps existing projects
 * looking the same. An effect that needs linear light (a physically correct
 * blur or exposure) must convert explicitly inside its own pass and say so.
 *
 * KEYFRAMES — every numeric param is animatable through the existing keyframe
 * system under the key `fx.<effectId>.<param>`, so effects animate, split,
 * ripple and undo exactly like x or opacity.
 *
 * Pure: node and browser, no DOM.
 */
(function () {
    'use strict';

    /* ── registry ────────────────────────────────────────────────────── */

    const num = (def, min, max, step, label) => ({ kind: 'number', default: def, min, max, step, label });

    /**
     * Effect definitions. `params` drives validation, defaults and the
     * inspector UI. Adding an effect = an entry here + a reference function
     * below + a shader in Compositor.js.
     */
    const EFFECTS = {
        adjust: {
            label: 'Adjust',
            description: 'Brightness, contrast, saturation and hue, matching the CSS filter functions.',
            params: {
                brightness: num(1, 0, 3, 0.01, 'Brightness'),
                contrast: num(1, 0, 3, 0.01, 'Contrast'),
                saturation: num(1, 0, 3, 0.01, 'Saturation'),
                hue: num(0, -180, 180, 1, 'Hue')
            }
        },
        grayscale: { label: 'Black & White', description: 'Desaturate toward luminance.', params: { amount: num(1, 0, 1, 0.01, 'Amount') } },
        sepia: { label: 'Sepia', description: 'Warm vintage tone.', params: { amount: num(1, 0, 1, 0.01, 'Amount') } },
        invert: { label: 'Invert', description: 'Photographic negative.', params: { amount: num(1, 0, 1, 0.01, 'Amount') } },
        vignette: {
            label: 'Vignette',
            description: 'Darken toward the edges of the frame.',
            params: {
                amount: num(0.5, 0, 1, 0.01, 'Amount'),
                radius: num(0.75, 0.1, 1.5, 0.01, 'Radius'),
                softness: num(0.45, 0.01, 1, 0.01, 'Softness')
            }
        },
        blur: {
            label: 'Blur',
            description: 'Gaussian blur; radius is in source pixels.',
            params: { radius: num(8, 0, 64, 0.5, 'Radius') }
        }
    };

    /* ── model ───────────────────────────────────────────────────────── */

    let seq = 0;
    function newId() {
        seq = (seq + 1) % 1679616;
        return 'fx_' + Date.now().toString(36).slice(-5) + seq.toString(36).padStart(4, '0');
    }

    function defaults(type) {
        const def = EFFECTS[type];
        if (!def) throw new Error(`Unknown effect "${type}"`);
        const p = {};
        for (const [k, s] of Object.entries(def.params)) p[k] = s.default;
        return p;
    }

    function createEffect(type, params) {
        const e = { id: newId(), type, enabled: true, params: Object.assign(defaults(type), params || {}) };
        return normaliseEffect(e);
    }

    function clampParam(spec, v) {
        if (spec.kind !== 'number') return v;
        const n = Number(v);
        if (!Number.isFinite(n)) return spec.default;
        return Math.min(spec.max, Math.max(spec.min, n));
    }

    /** Fill defaults, clamp ranges, drop unknown params. Unknown types are kept but disabled. */
    function normaliseEffect(e) {
        const def = EFFECTS[e && e.type];
        const out = { id: (e && e.id) || newId(), type: e && e.type, enabled: e ? e.enabled !== false : false, params: {} };
        if (!def) { out.enabled = false; out.params = Object.assign({}, e && e.params); out.unknown = true; return out; }
        for (const [k, spec] of Object.entries(def.params)) {
            out.params[k] = clampParam(spec, e.params && e.params[k] !== undefined ? e.params[k] : spec.default);
        }
        return out;
    }

    function normaliseEffects(list) {
        if (!Array.isArray(list)) return [];
        const seen = new Set();
        return list.map(normaliseEffect).map(e => {
            if (seen.has(e.id)) e.id = newId();       // duplicated clips must not share keyframe keys
            seen.add(e.id);
            return e;
        });
    }

    function keyFor(effect, param) { return `fx.${effect.id}.${param}`; }

    /** True if this effect would change nothing at its current values. */
    function isIdentity(type, p) {
        switch (type) {
            case 'adjust': return p.brightness === 1 && p.contrast === 1 && p.saturation === 1 && p.hue === 0;
            case 'grayscale': case 'sepia': case 'invert': case 'vignette': return p.amount === 0;
            case 'blur': return p.radius < 0.25;
            default: return false;
        }
    }

    /**
     * The effects that actually need to run at the current time, with every
     * numeric param resolved through `interp(key, base)` (the keyframe
     * lookup). Identity effects are skipped so a clip with only neutral
     * effects costs nothing.
     */
    function resolveStack(effects, interp) {
        const out = [];
        for (const e of effects || []) {
            if (!e || !e.enabled || !EFFECTS[e.type]) continue;
            const def = EFFECTS[e.type];
            const p = {};
            for (const [k, spec] of Object.entries(def.params)) {
                const base = e.params && e.params[k] !== undefined ? e.params[k] : spec.default;
                p[k] = clampParam(spec, interp ? interp(keyFor(e, k), base) : base);
            }
            if (!isIdentity(e.type, p)) out.push({ id: e.id, type: e.type, params: p });
        }
        return out;
    }

    /* ── colour maths (shared by CPU reference and documented for shaders) ── */

    /**
     * CSS Filter Effects 1 matrices, operating on sRGB-encoded values.
     * https://www.w3.org/TR/filter-effects-1/#ShorthandEquivalents
     * Each returns a 3x3 row-major matrix plus an offset.
     */
    function saturateMatrix(s) {
        return [
            0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
            0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
            0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s
        ];
    }
    function hueMatrix(deg) {
        const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [
            0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072
        ];
    }
    function grayscaleMatrix(a) {
        const k = 1 - a;
        return [
            0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
            0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
            0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k
        ];
    }
    function sepiaMatrix(a) {
        const k = 1 - a;
        return [
            0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
            0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
            0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k
        ];
    }
    function mulMat(a, b) {           // a·b, 3x3 row-major
        const o = new Array(9);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
        }
        return o;
    }

    /**
     * The whole 'adjust' effect as one affine colour transform, in the same
     * order ctx.filter applies its functions: brightness → contrast →
     * saturate → hue-rotate. Returns { m: 3x3, b: offset } for rgb' = m·rgb + b.
     *
     * Each stage is clamped to 0..1 in CSS. Folding them into one matrix skips
     * the intermediate clamps; the shader therefore applies the stages one by
     * one, and this folded form is only used where clamping cannot occur.
     */
    function adjustStages(p) {
        return [
            { m: [p.brightness, 0, 0, 0, p.brightness, 0, 0, 0, p.brightness], b: [0, 0, 0] },
            { m: [p.contrast, 0, 0, 0, p.contrast, 0, 0, 0, p.contrast], b: [0.5 - 0.5 * p.contrast, 0.5 - 0.5 * p.contrast, 0.5 - 0.5 * p.contrast] },
            { m: saturateMatrix(p.saturation), b: [0, 0, 0] },
            { m: hueMatrix(p.hue), b: [0, 0, 0] }
        ];
    }

    const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

    /* ── CPU reference implementations ───────────────────────────────── */

    function applyAffine(px, stage) {
        const { m, b } = stage;
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i] / 255, g = px[i + 1] / 255, bl = px[i + 2] / 255;
            px[i] = Math.round(clamp01(m[0] * r + m[1] * g + m[2] * bl + b[0]) * 255);
            px[i + 1] = Math.round(clamp01(m[3] * r + m[4] * g + m[5] * bl + b[1]) * 255);
            px[i + 2] = Math.round(clamp01(m[6] * r + m[7] * g + m[8] * bl + b[2]) * 255);
        }
    }

    function gaussianKernel(radius) {
        // CSS blur(r) is a Gaussian with standard deviation r.
        const sigma = Math.max(0.01, radius);
        const half = Math.min(192, Math.ceil(sigma * 3));
        const k = new Float32Array(half * 2 + 1);
        let sum = 0;
        for (let i = -half; i <= half; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + half] = v; sum += v; }
        for (let i = 0; i < k.length; i++) k[i] /= sum;
        return { k, half };
    }

    /**
     * Run a resolved stack over RGBA pixels in place.
     * px: Uint8ClampedArray, w × h × 4, straight (non-premultiplied) alpha.
     */
    function applyReference(px, w, h, stack) {
        for (const fx of stack || []) {
            const p = fx.params;
            switch (fx.type) {
                case 'adjust':
                    for (const st of adjustStages(p)) applyAffine(px, st);
                    break;
                case 'grayscale': applyAffine(px, { m: grayscaleMatrix(p.amount), b: [0, 0, 0] }); break;
                case 'sepia': applyAffine(px, { m: sepiaMatrix(p.amount), b: [0, 0, 0] }); break;
                case 'invert': {
                    const a = p.amount;
                    applyAffine(px, { m: [1 - 2 * a, 0, 0, 0, 1 - 2 * a, 0, 0, 0, 1 - 2 * a], b: [a, a, a] });
                    break;
                }
                case 'vignette': {
                    const cx = w / 2, cy = h / 2, diag = Math.hypot(cx, cy);
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                        const f = vignetteFactor(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / diag, p);
                        const i = (y * w + x) * 4;
                        px[i] = Math.round(px[i] * f); px[i + 1] = Math.round(px[i + 1] * f); px[i + 2] = Math.round(px[i + 2] * f);
                    }
                    break;
                }
                case 'blur': blurReference(px, w, h, p.radius); break;
            }
        }
        return px;
    }

    function smoothstep(a, b, x) {
        const t = clamp01((x - a) / (b - a || 1e-6));
        return t * t * (3 - 2 * t);
    }

    /** d is distance from centre normalised so the corner is 1. */
    function vignetteFactor(d, p) {
        const inner = p.radius * (1 - p.softness);
        return 1 - p.amount * smoothstep(inner, p.radius, d);
    }

    /**
     * Separable Gaussian with clamp-to-edge sampling. (CSS blur treats the
     * outside as transparent, which darkens edges; for a video frame that is
     * repositioned and scaled afterwards, edge-extend is the useful choice.)
     * Operates on premultiplied values so transparent pixels do not bleed colour.
     */
    function blurReference(px, w, h, radius) {
        if (radius < 0.25) return;
        const { k, half } = gaussianKernel(radius);
        const tmp = new Float32Array(w * h * 4), out = new Float32Array(w * h * 4);
        const src = new Float32Array(w * h * 4);
        for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3] / 255;
            src[i] = px[i] * a; src[i + 1] = px[i + 1] * a; src[i + 2] = px[i + 2] * a; src[i + 3] = px[i + 3];
        }
        const pass = (from, to, dx, dy) => {
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                let r = 0, g = 0, b = 0, a = 0;
                for (let t = -half; t <= half; t++) {
                    const sx = Math.min(w - 1, Math.max(0, x + t * dx)), sy = Math.min(h - 1, Math.max(0, y + t * dy));
                    const j = (sy * w + sx) * 4, wt = k[t + half];
                    r += from[j] * wt; g += from[j + 1] * wt; b += from[j + 2] * wt; a += from[j + 3] * wt;
                }
                const i = (y * w + x) * 4;
                to[i] = r; to[i + 1] = g; to[i + 2] = b; to[i + 3] = a;
            }
        };
        pass(src, tmp, 1, 0);
        pass(tmp, out, 0, 1);
        for (let i = 0; i < px.length; i += 4) {
            const a = out[i + 3] / 255;
            px[i] = a > 0 ? Math.round(out[i] / a) : 0;
            px[i + 1] = a > 0 ? Math.round(out[i + 1] / a) : 0;
            px[i + 2] = a > 0 ? Math.round(out[i + 2] / a) : 0;
            px[i + 3] = Math.round(out[i + 3]);
        }
    }

    const API = {
        EFFECTS, defaults, createEffect, normaliseEffect, normaliseEffects, keyFor, isIdentity, resolveStack,
        saturateMatrix, hueMatrix, grayscaleMatrix, sepiaMatrix, mulMat, adjustStages, vignetteFactor, gaussianKernel,
        applyReference
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Effects = API;
    }
})();
