/**
 * Tests for the Phase 4 visual pack: .cube parsing and storage, and the
 * reference definitions of grade, selective colour, chroma key, mask and LUT.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('../../public/engine/Luts.js');
const FX = require('../../public/engine/Effects.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function cube3(n, f, header) {
    const rows = [];
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
        rows.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map(v => v.toFixed(6)).join(' '));
    }
    return (header || '') + `LUT_3D_SIZE ${n}\n` + rows.join('\n') + '\n';
}

test('.cube parsing', async (t) => {
    await t.test('3D table with title, comments and CRLF; red varies fastest', () => {
        const text = '# made by hand\r\nTITLE "Warm"\r\n' + cube3(2, (r, g, b) => [r, g * 0.5, b]).replace(/\n/g, '\r\n');
        const lut = L.parseCube(text);
        assert.strictEqual(lut.title, 'Warm');
        assert.strictEqual(lut.size, 2);
        // entry 1 is (r=1, g=0, b=0)
        assert.deepStrictEqual(Array.from(lut.data.slice(3, 6)), [1, 0, 0]);
        near(L.trilinear(lut, 0.5, 1, 0.5)[1], 0.5);
    });

    await t.test('identity LUT reproduces its input', () => {
        const lut = L.parseCube(cube3(9, (r, g, b) => [r, g, b]));
        for (const c of [[0.1, 0.5, 0.9], [0.33, 0.66, 0.01]]) {
            const o = L.trilinear(lut, ...c);
            c.forEach((v, i) => near(o[i], v, 1e-5));
        }
    });

    await t.test('1D LUT is expanded into an equivalent 3D table', () => {
        const rows = [];
        for (let i = 0; i < 5; i++) { const v = i / 4; rows.push(`${v * v} ${v} ${1 - v}`); }
        const lut = L.parseCube('LUT_1D_SIZE 5\n' + rows.join('\n'));
        const o = L.trilinear(lut, 0.5, 0.5, 0.5);
        near(o[0], 0.25, 0.01); near(o[1], 0.5, 0.01); near(o[2], 0.5, 0.01);
    });

    await t.test('custom DOMAIN is resampled onto 0..1', () => {
        // Domain 0..2: an identity over that domain halves 0..1 input.
        const lut = L.parseCube('DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n' + cube3(5, (r, g, b) => [r, g, b]));
        near(L.trilinear(lut, 0.8, 0.4, 1)[0], 0.4, 0.01);
    });

    await t.test('hostile or broken files are rejected with a reason', () => {
        assert.throws(() => L.parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /Expected 8 entries/);
        assert.throws(() => L.parseCube('0 0 0\n'), /Missing LUT_3D_SIZE/);
        assert.throws(() => L.parseCube('LUT_3D_SIZE 4096\n'), /outside/);
        assert.throws(() => L.parseCube('LUT_3D_SIZE 2\n0 0 zero\n'), /not a number/);
        assert.throws(() => L.parseCube('DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n' + cube3(2, (r, g, b) => [r, g, b])), /DOMAIN/);
    });

    await t.test('output is clamped to 0..1', () => {
        const lut = L.parseCube(cube3(2, (r) => [r * 3 - 1, 0, 0]));
        assert.ok(Array.from(lut.data).every(v => v >= 0 && v <= 1));
    });

    await t.test('pack/unpack round-trips within 16-bit precision', () => {
        const lut = L.parseCube(cube3(5, (r, g, b) => [r * 0.9, Math.sqrt(g), b * b]));
        const rec = L.pack(lut, 'Test');
        assert.strictEqual(rec.encoding, 'u16le-b64');
        const back = L.unpack(JSON.parse(JSON.stringify(rec)));
        assert.strictEqual(back.size, 5);
        for (let i = 0; i < lut.data.length; i++) near(back.data[i], lut.data[i], 1 / 65535 + 1e-7);
        assert.strictEqual(L.unpack({ encoding: 'u16le-b64', size: 5, data: 'AAAA' }), null);
    });
});

test('Phase 4 effect references', async (t) => {
    await t.test('grade at defaults is identity and flagged as such', () => {
        const p = FX.defaults('grade');
        assert.ok(FX.isIdentity('grade', p));
        const o = FX.gradePixel([0.2, 0.5, 0.9], p);
        [0.2, 0.5, 0.9].forEach((v, i) => near(o[i], v, 1e-9));
    });

    await t.test('grade: +1 stop doubles, warm temperature raises red and lowers blue', () => {
        const p = Object.assign(FX.defaults('grade'), { exposure: 1 });
        near(FX.gradePixel([0.2, 0.2, 0.2], p)[0], 0.4);
        const w = FX.gradePixel([0.5, 0.5, 0.5], Object.assign(FX.defaults('grade'), { temperature: 1 }));
        assert.ok(w[0] > 0.5 && w[2] < 0.5);
        const g = FX.gradePixel([0.25, 0.25, 0.25], Object.assign(FX.defaults('grade'), { gamma: 2 }));
        near(g[0], 0.5);
    });

    await t.test('selective colour only touches the chosen hue, never greys', () => {
        const p = Object.assign(FX.defaults('selectiveColor'), { hue: 120, range: 20, softness: 10, hueShift: 120 });
        const green = FX.selectivePixel([0.1, 0.8, 0.1], p);
        assert.ok(green[2] > green[1], 'green should rotate toward blue');
        const red = FX.selectivePixel([0.8, 0.1, 0.1], p);
        assert.deepStrictEqual(red, [0.8, 0.1, 0.1]);
        const grey = FX.selectivePixel([0.5, 0.5, 0.5], p);
        assert.deepStrictEqual(grey, [0.5, 0.5, 0.5]);
    });

    await t.test('HSV round trip', () => {
        for (const c of [[0.9, 0.2, 0.4], [0.1, 0.7, 0.3], [0.2, 0.3, 0.95]]) {
            const back = FX.hsvToRgb(...FX.rgbToHsv(...c));
            c.forEach((v, i) => near(back[i], v, 1e-9));
        }
    });

    await t.test('chroma key: key colour → transparent; neutral subject → opaque and untouched', () => {
        const p = FX.defaults('chromaKey');
        const k = FX.hexToRgb(p.key), kc = FX.cbcr(...k);
        assert.strictEqual(FX.chromaPixel(k, p, kc)[3], 0);
        const grey = FX.chromaPixel([0.5, 0.5, 0.5], p, kc);
        assert.strictEqual(grey[3], 1);
        [0.5, 0.5, 0.5].forEach((v, i) => near(grey[i], v));
        // Darker green (a shadow on the screen) still keys: chroma, not brightness.
        assert.strictEqual(FX.chromaPixel(k.map(v => v * 0.6), p, kc)[3], 0);
    });

    await t.test('chroma key spill suppression pulls greenish edges toward grey', () => {
        const p = Object.assign(FX.defaults('chromaKey'), { spill: 1 });
        const kc = FX.cbcr(...FX.hexToRgb(p.key));
        const o = FX.chromaPixel([0.45, 0.75, 0.5], p, kc);
        assert.ok(o[1] - o[0] < 0.3, 'green excess reduced');
    });

    await t.test('mask: centre kept, outside cut, feathered edge, invert flips', () => {
        const p = Object.assign(FX.defaults('mask'), { shape: 'rectangle', width: 0.5, height: 0.5, feather: 0.1 });
        assert.strictEqual(FX.maskCoverage(50, 50, 100, 100, p), 1);
        assert.strictEqual(FX.maskCoverage(2, 2, 100, 100, p), 0);
        near(FX.maskCoverage(25, 50, 100, 100, p), 0.5, 0.05);       // on the edge
        assert.strictEqual(FX.maskCoverage(2, 2, 100, 100, Object.assign({}, p, { invert: 'yes' })), 1);
    });

    await t.test('LUT effect is skipped when its table is missing from the project', () => {
        const e = FX.createEffect('lut', { lut: 'lut_gone' });
        assert.deepStrictEqual(FX.resolveStack([e], null, { lut: () => null }), []);
        const table = L.identity(3);
        const s = FX.resolveStack([e], null, { lut: () => table });
        assert.strictEqual(s[0].lutData, table);
    });

    await t.test('non-numeric params are validated and never keyframed', () => {
        const e = FX.normaliseEffect({ type: 'chromaKey', params: { key: 'red;}' } });
        assert.strictEqual(e.params.key, '#00b140');
        const m = FX.normaliseEffect({ type: 'mask', params: { shape: 'star' } });
        assert.strictEqual(m.params.shape, 'ellipse');
        assert.ok(!FX.isAnimatable('mask', 'shape'));
        assert.ok(FX.isAnimatable('mask', 'centerX'));
        const seen = [];
        FX.resolveStack([FX.createEffect('chromaKey')], (k, b) => { seen.push(k); return b; });
        assert.ok(!seen.some(k => k.endsWith('.key')));
    });
});

const S = require('../../public/engine/Scopes.js');

test('scopes', async (t) => {
    const frame = (rgba, n) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set(rgba, i * 4); return a; };

    await t.test('histogram bins each channel and luma; transparent pixels ignored', () => {
        const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 0]);
        const h = S.histogram(px);
        assert.strictEqual(h.r[255], 2);
        assert.strictEqual(h.g[0], 1);
        assert.strictEqual(h.l[255], 1);
        assert.strictEqual(h.l[Math.round(0.2126 * 255)], 1);
        assert.strictEqual(h.r[9], 0, 'transparent pixel counted');
    });

    await t.test('waveform places a white column at the top level and black at the bottom', () => {
        const w = 2, h = 3, px = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) { px.set([255, 255, 255, 255], (y * w) * 4); px.set([0, 0, 0, 255], (y * w + 1) * 4); }
        const wf = S.waveform(px, w, h, 16);
        assert.strictEqual(wf.data[15 * w + 0], 3);
        assert.strictEqual(wf.data[0 * w + 1], 3);
    });

    await t.test('vectorscope: greys sit at the centre, colours move out toward their target', () => {
        const N = 65;
        const grey = S.vectorscope(frame([128, 128, 128, 255], 10), N);
        assert.strictEqual(grey.data[32 * N + 32], 10);
        const red = S.vectorscope(frame([255, 0, 0, 255], 4), N);
        const t1 = S.vectorTarget(1, 0, 0, N);
        assert.strictEqual(red.data[Math.round(t1.y) * N + Math.round(t1.x)], 4);
        assert.ok(t1.y < 32, 'red plots above centre (positive Cr)');
    });
});
