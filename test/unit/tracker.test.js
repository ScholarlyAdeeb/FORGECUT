/**
 * Tests for the motion tracker, on synthetic footage with a known path:
 * a textured patch moving over a different texture, with sensor noise,
 * lighting changes and an occlusion.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const T = require('../../public/engine/Tracker.js');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const W = 240, H = 160, P = 28;
const r0 = rng(11);
const bg = Uint8Array.from({ length: W * H }, () => 40 + r0() * 60);
const patch = Uint8Array.from({ length: P * P }, () => r0() * 255);

/** Frame with the patch's top-left at a (possibly fractional) position. */
function frame(px, py, opts) {
    const o = opts || {};
    const r = rng(o.seed || 1);
    const g = new Uint8Array(W * H);
    for (let i = 0; i < g.length; i++) g[i] = bg[i];
    // Bilinear placement so sub-pixel motion is real.
    for (let y = -1; y <= P; y++) for (let x = -1; x <= P; x++) {
        const X = Math.floor(px) + x, Y = Math.floor(py) + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const u = X - px, v = Y - py;
        const s = (a, b) => (a < 0 || b < 0 || a >= P || b >= P) ? null : patch[b * P + a];
        const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
        const c = [[u0, v0, (1 - fu) * (1 - fv)], [u0 + 1, v0, fu * (1 - fv)], [u0, v0 + 1, (1 - fu) * fv], [u0 + 1, v0 + 1, fu * fv]];
        let acc = 0, wsum = 0;
        for (const [a, b, wt] of c) { const val = s(a, b); if (val != null) { acc += val * wt; wsum += wt; } }
        if (wsum > 0.5) g[Y * W + X] = acc / wsum;
    }
    for (let i = 0; i < g.length; i++) {
        let v = g[i] * (o.gain || 1) + (o.offset || 0) + (r() - 0.5) * (o.noise || 6);
        g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    if (o.occlude) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = 128;
    return g;
}

const path = (i) => ({ x: 30 + i * 3.3 + 6 * Math.sin(i / 5), y: 40 + i * 1.7 + 4 * Math.cos(i / 7) });

test('tracker', async (t) => {
    await t.test('follows a moving textured patch to sub-pixel accuracy', () => {
        const p0 = path(0);
        const tr = T.create(frame(p0.x, p0.y), W, H, { cx: p0.x + P / 2, cy: p0.y + P / 2, w: P, h: P });
        let worst = 0;
        for (let i = 1; i <= 40; i++) {
            const p = path(i);
            const r = tr.update(frame(p.x, p.y, { seed: i }));
            assert.ok(!r.lost, `lost at ${i} (score ${r.score})`);
            const err = Math.hypot(r.cx - (p.x + P / 2), r.cy - (p.y + P / 2));
            worst = Math.max(worst, err);
        }
        assert.ok(worst < 1.0, `worst error ${worst.toFixed(2)} px`);
    });

    await t.test('survives a lighting change mid-track (ZNCC is gain/offset invariant)', () => {
        const p0 = path(0);
        const tr = T.create(frame(p0.x, p0.y), W, H, { cx: p0.x + P / 2, cy: p0.y + P / 2, w: P, h: P });
        for (let i = 1; i <= 20; i++) {
            const p = path(i);
            const dark = i > 10 ? { gain: 0.55, offset: -10 } : {};
            const r = tr.update(frame(p.x, p.y, Object.assign({ seed: i }, dark)));
            assert.ok(!r.lost, `lost at ${i}`);
            assert.ok(Math.hypot(r.cx - (p.x + P / 2), r.cy - (p.y + P / 2)) < 1.5);
        }
    });

    await t.test('reports lost on occlusion, holds position, and reacquires', () => {
        const p0 = path(0);
        const tr = T.create(frame(p0.x, p0.y), W, H, { cx: p0.x + P / 2, cy: p0.y + P / 2, w: P, h: P });
        let last;
        for (let i = 1; i <= 5; i++) { const p = path(i); last = tr.update(frame(p.x, p.y, { seed: i })); }
        const occ = tr.update(frame(0, 0, { occlude: true }));
        assert.ok(occ.lost);
        assert.strictEqual(occ.cx, last.cx);
        const p = path(6);
        const back = tr.update(frame(p.x, p.y, { seed: 99 }));
        assert.ok(!back.lost);
        assert.ok(Math.hypot(back.cx - (p.x + P / 2), back.cy - (p.y + P / 2)) < 1.5);
    });

    await t.test('ZNCC basics', () => {
        const g = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 251);
        const tpl = T.prepare(T.extract(g, 8, 8, 2, 2, 4, 4));
        assert.ok(Math.abs(T.zncc(g, 8, 8, tpl, 4, 4, 2, 2) - 1) < 1e-6);
        const flat = T.prepare(new Float32Array(16).fill(9));
        assert.strictEqual(T.zncc(g, 8, 8, flat, 4, 4, 0, 0), 0);
        assert.ok(Math.abs(T.parabola(0.5, 1, 0.5)) < 1e-9);
        assert.ok(T.parabola(0.9, 1, 0.5) < 0);
    });
});
