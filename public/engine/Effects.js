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
    const color = (def, label) => ({ kind: 'color', default: def, label });
    const choice = (def, options, label) => ({ kind: 'choice', default: def, options, label });
    const lutRef = (label) => ({ kind: 'lut', default: '', label });

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
        },
        grade: {
            label: 'Color Grade',
            description: 'Exposure, white balance, lift / gamma / gain and vibrance, applied in that order.',
            params: {
                exposure: num(0, -3, 3, 0.01, 'Exposure'),
                temperature: num(0, -1, 1, 0.01, 'Temperature'),
                tint: num(0, -1, 1, 0.01, 'Tint'),
                lift: num(0, -0.5, 0.5, 0.005, 'Lift'),
                gamma: num(1, 0.2, 3, 0.01, 'Gamma'),
                gain: num(1, 0, 2, 0.01, 'Gain'),
                vibrance: num(0, -1, 1, 0.01, 'Vibrance')
            }
        },
        selectiveColor: {
            label: 'Selective Color',
            description: 'HSL qualifier: adjust only the colours near a chosen hue.',
            params: {
                hue: num(120, 0, 360, 1, 'Target Hue'),
                range: num(30, 1, 180, 1, 'Range'),
                softness: num(20, 0, 90, 1, 'Softness'),
                hueShift: num(0, -180, 180, 1, 'Hue Shift'),
                saturation: num(1, 0, 3, 0.01, 'Saturation'),
                lightness: num(0, -1, 1, 0.01, 'Lightness')
            }
        },
        lut: {
            label: 'LUT',
            description: 'Apply a .cube look-up table.',
            params: { lut: lutRef('Look'), intensity: num(1, 0, 1, 0.01, 'Intensity') }
        },
        chromaKey: {
            label: 'Chroma Key',
            description: 'Key out a colour (green screen) with spill suppression.',
            params: {
                key: color('#00b140', 'Key Colour'),
                similarity: num(0.4, 0, 1, 0.005, 'Similarity'),
                smoothness: num(0.08, 0.001, 1, 0.005, 'Smoothness'),
                spill: num(0.1, 0.001, 1, 0.005, 'Spill Reduction')
            }
        },
        mask: {
            label: 'Mask',
            description: 'Keep (or cut out) a feathered rectangle or ellipse. Geometry is keyframeable.',
            params: {
                shape: choice('ellipse', ['ellipse', 'rectangle'], 'Shape'),
                centerX: num(0.5, -0.5, 1.5, 0.005, 'Centre X'),
                centerY: num(0.5, -0.5, 1.5, 0.005, 'Centre Y'),
                width: num(0.6, 0.01, 2, 0.005, 'Width'),
                height: num(0.6, 0.01, 2, 0.005, 'Height'),
                rotation: num(0, -180, 180, 1, 'Rotation'),
                feather: num(0.05, 0, 0.5, 0.005, 'Feather'),
                invert: choice('no', ['no', 'yes'], 'Invert')
            }
        },
        backgroundRemoval: {
            label: 'Remove Background',
            description: 'AI person segmentation, no green screen needed. Downloads a small model on first use.',
            params: {
                threshold: num(0.5, 0.05, 0.95, 0.01, 'Threshold'),
                feather: num(0.15, 0, 0.5, 0.01, 'Edge Softness')
            }
        }
    };

    /**
     * Clip blend modes → canvas globalCompositeOperation. The standard
     * separable and non-separable set, all native to the 2D canvas.
     */
    const BLEND_MODES = {
        normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
        darken: 'darken', lighten: 'lighten', colorDodge: 'color-dodge', colorBurn: 'color-burn',
        hardLight: 'hard-light', softLight: 'soft-light', difference: 'difference', exclusion: 'exclusion',
        hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity'
    };
    const BLEND_LABELS = {
        normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken',
        lighten: 'Lighten', colorDodge: 'Color Dodge', colorBurn: 'Color Burn', hardLight: 'Hard Light',
        softLight: 'Soft Light', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue',
        saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity'
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
        if (spec.kind === 'color') return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : spec.default;
        if (spec.kind === 'choice') return spec.options.indexOf(v) >= 0 ? v : spec.default;
        if (spec.kind === 'lut') return typeof v === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(v) ? v : spec.default;
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
            case 'grade': return p.exposure === 0 && p.temperature === 0 && p.tint === 0 && p.lift === 0 &&
                p.gamma === 1 && p.gain === 1 && p.vibrance === 0;
            case 'selectiveColor': return p.hueShift === 0 && p.saturation === 1 && p.lightness === 0;
            case 'lut': return !p.lut || p.intensity === 0;
            case 'chromaKey': return false;
            case 'mask': return false;
            case 'backgroundRemoval': return false;
            default: return false;
        }
    }

    /**
     * The effects that actually need to run at the current time, with every
     * numeric param resolved through `interp(key, base)` (the keyframe
     * lookup). Identity effects are skipped so a clip with only neutral
     * effects costs nothing.
     */
    function resolveStack(effects, interp, resources) {
        const out = [];
        for (const e of effects || []) {
            if (!e || !e.enabled || !EFFECTS[e.type]) continue;
            const def = EFFECTS[e.type];
            const p = {};
            for (const [k, spec] of Object.entries(def.params)) {
                const base = e.params && e.params[k] !== undefined ? e.params[k] : spec.default;
                const live = spec.kind === 'number' && interp ? interp(keyFor(e, k), base) : base;
                p[k] = clampParam(spec, live);
            }
            if (isIdentity(e.type, p)) continue;
            const fx = { id: e.id, type: e.type, params: p };
            if (e.type === 'lut') {
                // A LUT that is not in the project (deleted, or a file from
                // elsewhere) is skipped rather than guessed at.
                fx.lutData = resources && resources.lut ? resources.lut(p.lut) : null;
                if (!fx.lutData) continue;
            }
            out.push(fx);
        }
        return out;
    }

    /** Is this param one the keyframe system can animate? */
    function isAnimatable(type, param) {
        const d = EFFECTS[type];
        return !!(d && d.params[param] && d.params[param].kind === 'number');
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
                default: applyPhase4(px, w, h, fx);
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

    /* ── Phase 4 references ───────────────────────────────────────────── */

    const LUMA = [0.2126, 0.7152, 0.0722];

    function hexToRgb(hex) {
        const n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    /** One pixel of 'grade', in 0..1. Shared order: exposure, WB, LGG, vibrance. */
    function gradePixel(c, p) {
        const e = Math.pow(2, p.exposure);
        let r = c[0] * e, g = c[1] * e, b = c[2] * e;
        r *= 1 + 0.25 * p.temperature; b *= 1 - 0.25 * p.temperature; g *= 1 - 0.25 * p.tint;
        const lgg = (v) => {
            v = clamp01(v);
            v = clamp01(p.gain * (v + p.lift * (1 - v)));
            return Math.pow(v, 1 / p.gamma);
        };
        r = lgg(r); g = lgg(g); b = lgg(b);
        if (p.vibrance !== 0) {
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const k = 1 + p.vibrance * (1 - (mx - mn));
            const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
            r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k;
        }
        return [clamp01(r), clamp01(g), clamp01(b)];
    }

    function rgbToHsv(r, g, b) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d > 1e-6) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return [h, mx > 0 ? d / mx : 0, mx];
    }
    function hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
        const k = Math.floor(h / 60) % 6;
        const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
        return [t[0] + m, t[1] + m, t[2] + m];
    }

    /** How strongly a pixel of this hue/saturation is selected (0..1). */
    function selectWeight(h, s, p) {
        let d = Math.abs(h - p.hue) % 360; if (d > 180) d = 360 - d;
        const hueW = 1 - smoothstep(p.range, p.range + p.softness + 1e-6, d);
        return hueW * smoothstep(0.05, 0.2, s);       // greys are never "a colour"
    }

    function selectivePixel(c, p) {
        const [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
        const w = selectWeight(h, s, p);
        if (w <= 0) return c;
        const h2 = h + p.hueShift * w;
        const s2 = clamp01(s * (1 + (p.saturation - 1) * w));
        const v2 = clamp01(v + p.lightness * w);
        return hsvToRgb(h2, s2, v2);
    }

    /** Chroma distance in BT.709 CbCr — brightness-independent, so shadows on the screen still key. */
    function cbcr(r, g, b) {
        const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
        return [(b - y) / 1.8556, (r - y) / 1.5748];
    }

    /** → [r, g, b, alphaFactor] */
    function chromaPixel(c, p, keyCbCr) {
        const q = cbcr(c[0], c[1], c[2]);
        const dist = Math.hypot(q[0] - keyCbCr[0], q[1] - keyCbCr[1]);
        // similarity is on a 0..1 slider; real chroma distances are ~0..0.6.
        const base = dist - p.similarity * 0.4;
        const alpha = Math.pow(clamp01(base / (p.smoothness * 0.4)), 1.5);
        const spillVal = Math.pow(clamp01(base / (p.spill * 0.4)), 1.5);
        const y = clamp01(c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]);
        return [y + (c[0] - y) * spillVal, y + (c[1] - y) * spillVal, y + (c[2] - y) * spillVal, alpha];
    }

    /** Mask coverage (0..1) at pixel centre (x, y) of a w×h frame. */
    function maskCoverage(x, y, w, h, p) {
        const a = -p.rotation * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        const dx = x - p.centerX * w, dy = y - p.centerY * h;
        const px = dx * ca - dy * sa, py = dx * sa + dy * ca;
        const hw = Math.max(0.5, p.width * w / 2), hh = Math.max(0.5, p.height * h / 2);
        let d;
        if (p.shape === 'rectangle') {
            const qx = Math.abs(px) - hw, qy = Math.abs(py) - hh;
            d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        } else {
            d = (Math.hypot(px / hw, py / hh) - 1) * Math.min(hw, hh);
        }
        const f = Math.max(0.5, p.feather * Math.min(w, h));
        const cov = 1 - smoothstep(-f / 2, f / 2, d);
        return p.invert === 'yes' ? 1 - cov : cov;
    }

    /** Trilinear lookup in a cube LUT {size, data: Float32Array rgb, R fastest}. */
    function lutSample(lut, r, g, b) {
        const n = lut.size, d = lut.data, m = n - 1;
        const fr = clamp01(r) * m, fg = clamp01(g) * m, fb = clamp01(b) * m;
        const r0 = Math.min(m - 1, Math.floor(fr)), g0 = Math.min(m - 1, Math.floor(fg)), b0 = Math.min(m - 1, Math.floor(fb));
        const tr = fr - r0, tg = fg - g0, tb = fb - b0;
        const idx = (ri, gi, bi) => 3 * (ri + n * (gi + n * bi));
        const out = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
            const v = (ri, gi, bi) => d[idx(ri, gi, bi) + c];
            const c00 = v(r0, g0, b0) * (1 - tr) + v(r0 + 1, g0, b0) * tr;
            const c10 = v(r0, g0 + 1, b0) * (1 - tr) + v(r0 + 1, g0 + 1, b0) * tr;
            const c01 = v(r0, g0, b0 + 1) * (1 - tr) + v(r0 + 1, g0, b0 + 1) * tr;
            const c11 = v(r0, g0 + 1, b0 + 1) * (1 - tr) + v(r0 + 1, g0 + 1, b0 + 1) * tr;
            out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
        }
        return out;
    }

    function perPixel(px, fn) {
        for (let i = 0; i < px.length; i += 4) {
            const o = fn([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], i);
            px[i] = Math.round(clamp01(o[0]) * 255);
            px[i + 1] = Math.round(clamp01(o[1]) * 255);
            px[i + 2] = Math.round(clamp01(o[2]) * 255);
            if (o.length > 3) px[i + 3] = Math.round(px[i + 3] * clamp01(o[3]));
        }
    }

    function applyPhase4(px, w, h, fx) {
        const p = fx.params;
        switch (fx.type) {
            case 'grade': perPixel(px, c => gradePixel(c, p)); return true;
            case 'selectiveColor': perPixel(px, c => selectivePixel(c, p)); return true;
            case 'chromaKey': {
                const k = hexToRgb(p.key), kc = cbcr(k[0], k[1], k[2]);
                perPixel(px, c => chromaPixel(c, p, kc));
                return true;
            }
            case 'mask':
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    px[i + 3] = Math.round(px[i + 3] * maskCoverage(x + 0.5, y + 0.5, w, h, p));
                }
                return true;
            case 'lut': {
                const lut = fx.lutData;
                if (!lut) return true;
                perPixel(px, c => {
                    const o = lutSample(lut, c[0], c[1], c[2]);
                    return [c[0] + (o[0] - c[0]) * p.intensity, c[1] + (o[1] - c[1]) * p.intensity, c[2] + (o[2] - c[2]) * p.intensity];
                });
                return true;
            }
            case 'backgroundRemoval': {
                // Needs a per-frame segmentation mask supplied by the caller.
                const m = fx.maskData;
                if (!m) return true;
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    const mx = Math.min(m.width - 1, Math.floor((x + 0.5) / w * m.width));
                    const my = Math.min(m.height - 1, Math.floor((y + 0.5) / h * m.height));
                    const conf = m.data[my * m.width + mx];
                    const a = smoothstep(p.threshold - p.feather / 2, p.threshold + p.feather / 2 + 1e-6, conf);
                    const i = (y * w + x) * 4;
                    px[i + 3] = Math.round(px[i + 3] * a);
                }
                return true;
            }
        }
        return false;
    }

    const API = {
        EFFECTS, BLEND_MODES, BLEND_LABELS, defaults, createEffect, normaliseEffect, normaliseEffects, keyFor, isIdentity, resolveStack, isAnimatable,
        gradePixel, selectivePixel, rgbToHsv, hsvToRgb, selectWeight, cbcr, chromaPixel, hexToRgb, maskCoverage, lutSample,
        saturateMatrix, hueMatrix, grayscaleMatrix, sepiaMatrix, mulMat, adjustStages, vignetteFactor, gaussianKernel,
        applyReference
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Effects = API;
    }
})();
