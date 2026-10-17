/**
 * Tests for TimeMap — the single timeline→source mapping.
 *
 * The plan's containment for speed ramps: "a single shared time-mapping
 * function, property-tested against the constant-speed case". These are those
 * property tests, plus exactness of the closed-form integrals against brute
 * numerical integration.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const TM = require('../../public/engine/TimeMap.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// Deterministic PRNG so property tests are reproducible.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function numeric(keys, t0, t1, n) {
    let s = 0; const h = (t1 - t0) / n;
    for (let i = 0; i < n; i++) s += TM.interpolate(keys, t0 + (i + 0.5) * h, 1) * h;
    return s;
}

test('constant speed is the special case, not a separate path', async (t) => {
    await t.test('no keyframes: source = trimStart + speed·t', () => {
        const clip = { trimStart: 2, duration: 10, playbackSpeed: 1.5 };
        near(TM.sourceTime(clip, 4), 8);
        near(TM.speedAt(clip, 7), 1.5);
        near(TM.sourceSpan(clip), 15);
    });

    await t.test('property: flat keyframes at s ≡ constant s, for any times', () => {
        const r = rng(7);
        for (let i = 0; i < 200; i++) {
            const s = 0.1 + r() * 5, d = 1 + r() * 30, trim = r() * 10;
            const n = 2 + Math.floor(r() * 5);
            const keys = Array.from({ length: n }, (_, j) => ({ time: d * j / (n - 1), value: s, ease: ['linear', 'smooth', 'easeIn', 'easeOut'][j % 4] }));
            const ramp = { trimStart: trim, duration: d, keyframes: { playbackSpeed: keys } };
            const flat = { trimStart: trim, duration: d, playbackSpeed: s };
            const at = r() * d;
            near(TM.sourceTime(ramp, at), TM.sourceTime(flat, at), 1e-9);
        }
    });

    await t.test('default speed is 1 and a missing trimStart is 0', () => {
        near(TM.sourceTime({ duration: 5 }, 3), 3);
    });
});

test('exact integrals', async (t) => {
    await t.test('linear ramp 1→3 over 2 s consumes 4 s of source', () => {
        const clip = { duration: 2, keyframes: { playbackSpeed: [{ time: 0, value: 1 }, { time: 2, value: 3 }] } };
        near(TM.sourceSpan(clip), 4);
        near(TM.speedAt(clip, 1), 2);
    });

    await t.test('every easing matches brute-force numerical integration', () => {
        for (const ease of Object.keys(TM.EASES)) {
            const keys = [{ time: 0.5, value: 0.4, ease }, { time: 2.5, value: 2.7, ease }, { time: 4, value: 1.1 }];
            for (const [a, b] of [[0, 5], [0.7, 3.1], [1, 1.5], [3, 4.6]]) {
                near(TM.integrate(keys, a, b, 1), numeric(keys, a, b, 20000), 1e-5);
            }
        }
    });

    await t.test('additivity: ∫a→c = ∫a→b + ∫b→c', () => {
        const keys = [{ time: 0, value: 1, ease: 'smooth' }, { time: 1, value: 4, ease: 'easeOut' }, { time: 3, value: 0.5 }];
        const r = rng(3);
        for (let i = 0; i < 100; i++) {
            const a = r() * 4, b = a + r() * 2, c = b + r() * 2;
            near(TM.integrate(keys, a, c), TM.integrate(keys, a, b) + TM.integrate(keys, b, c), 1e-9);
        }
    });
});

test('mapping properties', async (t) => {
    const clip = { trimStart: 1, duration: 6, keyframes: { playbackSpeed: TM.presetKeyframes('bullet', 6) } };

    await t.test('strictly increasing (speed is always positive)', () => {
        let prev = -Infinity;
        for (let i = 0; i <= 600; i++) {
            const s = TM.sourceTime(clip, i / 100);
            assert.ok(s > prev, `not increasing at ${i}`);
            prev = s;
        }
    });

    await t.test('inverse round-trips', () => {
        for (const l of [0, 0.3, 2.7, 3, 5.99, 6]) {
            near(TM.localTimeForSource(clip, TM.sourceTime(clip, l)), l, 1e-5);
        }
        assert.strictEqual(TM.localTimeForSource(clip, 0.5), null);   // before trimStart
    });

    await t.test('interpolate honours ease and holds past the ends', () => {
        const k = [{ time: 0, value: 0, ease: 'smooth' }, { time: 1, value: 10 }];
        near(TM.interpolate(k, 0.5, 0), 5);
        near(TM.interpolate(k, 0.25, 0), 10 * (0.0625 * 3 - 2 * 0.015625));
        near(TM.interpolate(k, -1, 0), 0);
        near(TM.interpolate(k, 9, 0), 10);
        near(TM.interpolate(null, 1, 42), 42);
    });

    await t.test('rate schedule hits every keyframe exactly', () => {
        const sched = TM.rateSchedule(clip);
        for (const k of clip.keyframes.playbackSpeed) {
            const p = sched.find(x => Math.abs(x.time - k.time) < 1e-9);
            assert.ok(p, `missing ${k.time}`);
            near(p.rate, k.value);
        }
        assert.ok(sched.length > clip.keyframes.playbackSpeed.length, 'eased segments are subdivided');
    });

    await t.test('fitDuration keeps a ramp inside the available media', () => {
        const pts = TM.PRESETS.rampUp.points;               // 1 → 3, average ~2
        const d = TM.fitDuration(pts, 10, 30);
        const keys = pts.map(([u, v]) => ({ time: u * d, value: v, ease: 'smooth' }));
        near(TM.integrate(keys, 0, d), 10, 1e-6);
        near(TM.fitDuration(pts, 1000, 30), 30);
    });

    await t.test('speeds are clamped to a safe range', () => {
        const c = { duration: 1, keyframes: { playbackSpeed: [{ time: 0, value: 0 }, { time: 1, value: 999 }] } };
        assert.strictEqual(TM.speedAt(c, 0), TM.MIN_SPEED);
        assert.strictEqual(TM.speedAt(c, 1), TM.MAX_SPEED);
    });
});

test('cutting a ramped clip keeps source continuity', () => {
    const SE = require('../../public/engine/SmartEdit.js');
    const orig = { id: 'a', startTime: 0, duration: 6, trimStart: 1, keyframes: { playbackSpeed: TM.presetKeyframes('hero', 6) } };
    const out = SE.splitTracksAt([{ id: 'v', clips: [orig] }], 'a', [2.5]).tracks[0].clips.sort((p, q) => p.startTime - q.startTime);
    const [head, tail] = out;
    for (const x of [0, 0.4, 1.7, 3.5]) {
        near(TM.sourceTime(tail, x), TM.sourceTime(orig, 2.5 + x), 1e-9);
    }
    for (const x of [0, 1, 2.4]) near(TM.sourceTime(head, x), TM.sourceTime(orig, x), 1e-12);
});
