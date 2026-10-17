/**
 * Tests for the effect stack model and the CPU reference implementations.
 *
 * The reference is the definition every GPU shader is checked against, so
 * these pin it to the published CSS Filter Effects maths and to the
 * behaviours that matter for a project file: defaults, clamping, keyframe
 * addressing, and that neutral effects cost nothing.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const FX = require('../../public/engine/Effects.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const px = (...rgba) => Uint8ClampedArray.from(rgba);

test('model', async (t) => {
    await t.test('createEffect fills defaults and gets a unique id', () => {
        const a = FX.createEffect('adjust'), b = FX.createEffect('adjust');
        assert.deepStrictEqual(a.params, { brightness: 1, contrast: 1, saturation: 1, hue: 0 });
        assert.ok(a.enabled);
        assert.notStrictEqual(a.id, b.id);
        assert.throws(() => FX.createEffect('teleport'));
    });

    await t.test('normalise clamps, drops junk, and keeps unknown types disabled', () => {
        const [e, u] = FX.normaliseEffects([
            { id: 'x', type: 'adjust', params: { brightness: 99, contrast: 'abc', bogus: 1 } },
            { id: 'y', type: 'futureEffect', enabled: true, params: { k: 1 } }
        ]);
        assert.strictEqual(e.params.brightness, 3);
        assert.strictEqual(e.params.contrast, 1);
        assert.ok(!('bogus' in e.params));
        assert.strictEqual(u.enabled, false);
        assert.ok(u.unknown);
        assert.deepStrictEqual(u.params, { k: 1 });     // preserved for a newer build
    });

    await t.test('duplicate ids in one stack are re-issued', () => {
        const list = FX.normaliseEffects([{ id: 'same', type: 'invert' }, { id: 'same', type: 'sepia' }]);
        assert.notStrictEqual(list[0].id, list[1].id);
    });

    await t.test('resolveStack skips disabled and neutral effects', () => {
        const stack = FX.resolveStack([
            { id: 'a', type: 'adjust', enabled: true, params: { brightness: 1, contrast: 1, saturation: 1, hue: 0 } },
            { id: 'b', type: 'invert', enabled: false, params: { amount: 1 } },
            { id: 'c', type: 'sepia', enabled: true, params: { amount: 0.5 } }
        ]);
        assert.deepStrictEqual(stack.map(s => s.id), ['c']);
    });

    await t.test('params resolve through keyframes under fx.<id>.<param>', () => {
        const e = { id: 'f1', type: 'vignette', enabled: true, params: { amount: 0.2, radius: 0.8, softness: 0.5 } };
        const seen = [];
        const stack = FX.resolveStack([e], (key, base) => { seen.push(key); return key === 'fx.f1.amount' ? 5 : base; });
        assert.ok(seen.includes('fx.f1.amount'));
        assert.strictEqual(stack[0].params.amount, 1);   // keyframed 5, clamped to max
        assert.strictEqual(FX.keyFor(e, 'radius'), 'fx.f1.radius');
    });
});

test('CSS Filter Effects maths', async (t) => {
    await t.test('saturate(0) gives luminance grey; saturate(1) is identity', () => {
        const m0 = FX.saturateMatrix(0), m1 = FX.saturateMatrix(1);
        near(m0[0], 0.213); near(m0[1], 0.715); near(m0[2], 0.072);
        [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => near(m1[i], v));
    });

    await t.test('hue-rotate(0) is identity and 360 returns to it', () => {
        [FX.hueMatrix(0), FX.hueMatrix(360)].forEach(m => [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => near(m[i], v, 1e-9)));
    });

    await t.test('every matrix preserves white at full strength except invert', () => {
        for (const m of [FX.saturateMatrix(0.3), FX.hueMatrix(77), FX.grayscaleMatrix(1)]) {
            for (let r = 0; r < 3; r++) near(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2], 1, 2e-3);
        }
    });
});

test('reference implementation', async (t) => {
    await t.test('brightness and contrast follow the CSS formulas, clamped per stage', () => {
        const p = px(100, 200, 50, 255);
        FX.applyReference(p, 1, 1, [{ type: 'adjust', params: { brightness: 1.5, contrast: 1, saturation: 1, hue: 0 } }]);
        assert.deepStrictEqual(Array.from(p), [150, 255, 75, 255]);
        const q = px(100, 200, 50, 255);
        FX.applyReference(q, 1, 1, [{ type: 'adjust', params: { brightness: 1, contrast: 0, saturation: 1, hue: 0 } }]);
        assert.deepStrictEqual(Array.from(q.slice(0, 3)), [128, 128, 128]);
    });

    await t.test('grayscale(1) makes channels equal; invert(1) and invert(0.5)', () => {
        const g = px(255, 0, 0, 255);
        FX.applyReference(g, 1, 1, [{ type: 'grayscale', params: { amount: 1 } }]);
        assert.ok(g[0] === g[1] && g[1] === g[2]);
        near(g[0], Math.round(0.2126 * 255), 1);
        const i = px(10, 100, 250, 7);
        FX.applyReference(i, 1, 1, [{ type: 'invert', params: { amount: 1 } }]);
        assert.deepStrictEqual(Array.from(i), [245, 155, 5, 7]);   // alpha untouched
        const h = px(0, 255, 40, 255);
        FX.applyReference(h, 1, 1, [{ type: 'invert', params: { amount: 0.5 } }]);
        assert.deepStrictEqual(Array.from(h.slice(0, 3)), [128, 128, 128]);
    });

    await t.test('vignette leaves the centre alone and darkens corners', () => {
        const w = 21, h = 21, a = new Uint8ClampedArray(w * h * 4).fill(200);
        FX.applyReference(a, w, h, [{ type: 'vignette', params: { amount: 1, radius: 0.75, softness: 0.45 } }]);
        assert.strictEqual(a[(10 * w + 10) * 4], 200);
        assert.ok(a[0] < 20, `corner ${a[0]}`);
    });

    await t.test('blur conserves a flat field and spreads an impulse symmetrically', () => {
        const w = 9, h = 9;
        const flat = new Uint8ClampedArray(w * h * 4).fill(123);
        FX.applyReference(flat, w, h, [{ type: 'blur', params: { radius: 2 } }]);
        assert.ok(flat.every(v => v === 123));
        const imp = new Uint8ClampedArray(w * h * 4);
        for (let i = 3; i < imp.length; i += 4) imp[i] = 255;
        imp[(4 * w + 4) * 4] = 255;
        FX.applyReference(imp, w, h, [{ type: 'blur', params: { radius: 1 } }]);
        const at = (x, y) => imp[(y * w + x) * 4];
        assert.ok(at(4, 4) < 255 && at(4, 4) > 0);
        assert.strictEqual(at(3, 4), at(5, 4));
        assert.strictEqual(at(4, 3), at(4, 5));
    });

    await t.test('blur does not bleed colour out of transparent pixels', () => {
        const w = 3, h = 1, a = Uint8ClampedArray.from([255, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255]);
        FX.applyReference(a, w, h, [{ type: 'blur', params: { radius: 1 } }]);
        assert.strictEqual(a[4], 0, 'red from a fully transparent pixel leaked');
    });

    await t.test('stack order matters and is honoured', () => {
        const a = px(200, 100, 50, 255), b = px(200, 100, 50, 255);
        FX.applyReference(a, 1, 1, [{ type: 'invert', params: { amount: 1 } }, { type: 'adjust', params: { brightness: 0.5, contrast: 1, saturation: 1, hue: 0 } }]);
        FX.applyReference(b, 1, 1, [{ type: 'adjust', params: { brightness: 0.5, contrast: 1, saturation: 1, hue: 0 } }, { type: 'invert', params: { amount: 1 } }]);
        assert.notDeepStrictEqual(Array.from(a), Array.from(b));
    });
});
