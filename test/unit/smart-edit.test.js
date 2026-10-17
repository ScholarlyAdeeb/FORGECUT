/**
 * Tests for the Smart Edit engine.
 *
 * Silence removal is destructive across every track at once, so most of these
 * check the arithmetic that keeps a project coherent after a cut: source
 * offsets under playback speed, keyframes, linked clips, locked tracks.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const SE = require('../../public/engine/SmartEdit.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/** Build a mono signal from [seconds, amplitude] segments (sine at 440 Hz). */
function signal(sampleRate, segments) {
    const total = segments.reduce((n, [s]) => n + s, 0);
    const out = new Float32Array(Math.round(total * sampleRate));
    let i = 0;
    for (const [sec, amp] of segments) {
        const n = Math.round(sec * sampleRate);
        for (let k = 0; k < n; k++, i++) out[i] = amp * Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }
    return out;
}

test('silence detection', async (t) => {
    const sr = 8000;

    await t.test('finds a gap between two loud sections, padded inward', () => {
        const s = signal(sr, [[1, 0.5], [1, 0], [1, 0.5]]);
        const spans = SE.findSilences(s, sr, { thresholdDb: -40, minDuration: 0.5, padding: 0.1 });
        assert.strictEqual(spans.length, 1);
        near(spans[0].start, 1.1, 0.03);
        near(spans[0].end, 1.9, 0.03);
    });

    await t.test('ignores pauses shorter than minDuration', () => {
        const s = signal(sr, [[1, 0.5], [0.3, 0], [1, 0.5]]);
        assert.deepStrictEqual(SE.findSilences(s, sr, { minDuration: 0.5 }), []);
    });

    await t.test('quiet but not silent audio is kept', () => {
        // 0.05 amplitude sine ≈ -29 dBFS RMS, above a -40 dB threshold.
        const s = signal(sr, [[1, 0.5], [1, 0.05], [1, 0.5]]);
        assert.deepStrictEqual(SE.findSilences(s, sr, { thresholdDb: -40 }), []);
        // …but caught by a stricter threshold.
        assert.strictEqual(SE.findSilences(s, sr, { thresholdDb: -20 }).length, 1);
    });

    await t.test('leading and trailing silence are not padded away', () => {
        const s = signal(sr, [[1, 0], [1, 0.5], [1, 0]]);
        const spans = SE.findSilences(s, sr, { padding: 0.2 });
        assert.strictEqual(spans.length, 2);
        near(spans[0].start, 0);
        near(spans[0].end, 0.8, 0.03);
        near(spans[1].start, 2.2, 0.03);
        near(spans[1].end, 3);
    });

    await t.test('padding larger than the gap leaves nothing to cut', () => {
        const s = signal(sr, [[1, 0.5], [0.6, 0], [1, 0.5]]);
        assert.deepStrictEqual(SE.findSilences(s, sr, { minDuration: 0.5, padding: 0.4 }), []);
    });

    await t.test('rejects nonsense parameters', () => {
        assert.throws(() => SE.findSilences(new Float32Array(10), 0));
        assert.throws(() => SE.findSilences(new Float32Array(10), sr, { thresholdDb: NaN }));
        assert.throws(() => SE.findSilences(new Float32Array(10), sr, { padding: -1 }));
    });

    await t.test('mixToMono averages channels', () => {
        const m = SE.mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
        assert.deepStrictEqual(Array.from(m), [0.5, 0.5]);
    });

    await t.test('normaliseSpans merges overlaps and clamps', () => {
        const n = SE.normaliseSpans([{ start: 2, end: 3 }, { start: -1, end: 1 }, { start: 2.5, end: 5 }], 4);
        assert.deepStrictEqual(n, [{ start: 0, end: 1 }, { start: 2, end: 4 }]);
    });
});

function project() {
    return [
        { id: 'v', type: 'video', clips: [
            { id: 'a', startTime: 0, duration: 10, trimStart: 0, linkedClipId: 'aa',
              keyframes: { opacity: [{ time: 0, value: 0 }, { time: 8, value: 1 }] } }
        ] },
        { id: 'au', type: 'audio', clips: [
            { id: 'aa', startTime: 0, duration: 10, trimStart: 0, linkedClipId: 'a' }
        ] },
        { id: 't', type: 'text', clips: [
            { id: 'x', startTime: 12, duration: 2 }
        ] }
    ];
}

test('range ripple delete', async (t) => {
    await t.test('splits a clip around the cut and closes the gap', () => {
        const { tracks, removed } = SE.rippleDeleteRanges(project(), [{ start: 3, end: 5 }]);
        near(removed, 2);
        const v = tracks[0].clips.sort((p, q) => p.startTime - q.startTime);
        assert.strictEqual(v.length, 2);
        assert.strictEqual(v[0].id, 'a');
        near(v[0].duration, 3);
        near(v[1].startTime, 3);
        near(v[1].duration, 5);
        near(v[1].trimStart, 5);
        // Later clips slide left by the removed length.
        near(tracks[2].clips[0].startTime, 10);
    });

    await t.test('does not mutate its input', () => {
        const p = project();
        const before = JSON.stringify(p);
        SE.rippleDeleteRanges(p, [{ start: 3, end: 5 }]);
        assert.strictEqual(JSON.stringify(p), before);
    });

    await t.test('source offset honours playback speed', () => {
        const tracks = [{ id: 'v', clips: [{ id: 'a', startTime: 0, duration: 10, trimStart: 1, playbackSpeed: 2 }] }];
        const out = SE.rippleDeleteRanges(tracks, [{ start: 2, end: 4 }]).tracks[0].clips;
        const tail = out.find(c => c.startTime > 0);
        // 4 s of timeline at 2x = 8 s of source, plus the original 1 s trim.
        near(tail.trimStart, 9);
    });

    await t.test('keyframes on the tail piece are rebased to its new start', () => {
        const { tracks } = SE.rippleDeleteRanges(project(), [{ start: 3, end: 5 }]);
        const tail = tracks[0].clips.find(c => c.startTime > 0);
        assert.deepStrictEqual(tail.keyframes.opacity.map(k => k.time), [-5, 3]);
        // Head keeps the original keyframes untouched.
        const head = tracks[0].clips.find(c => c.startTime === 0);
        assert.deepStrictEqual(head.keyframes.opacity.map(k => k.time), [0, 8]);
    });

    await t.test('linked clips stay linked piece by piece', () => {
        const { tracks, linkedBroken } = SE.rippleDeleteRanges(project(), [{ start: 3, end: 5 }, { start: 7, end: 8 }]);
        assert.strictEqual(linkedBroken, 0);
        const v = tracks[0].clips, a = tracks[1].clips;
        assert.strictEqual(v.length, 3);
        assert.strictEqual(a.length, 3);
        for (const c of v) {
            const partner = a.find(x => x.id === c.linkedClipId);
            assert.ok(partner, 'every video piece has an audio partner');
            assert.strictEqual(partner.linkedClipId, c.id);
            near(partner.startTime, c.startTime);
            near(partner.trimStart, c.trimStart);
        }
        assert.strictEqual(new Set(v.map(c => c.id)).size, 3, 'ids are unique');
    });

    await t.test('locked tracks are untouched and their links are dropped', () => {
        const { tracks, linkedBroken } = SE.rippleDeleteRanges(project(), [{ start: 3, end: 5 }], { locked: { au: true } });
        assert.strictEqual(tracks[1].clips.length, 1);
        near(tracks[1].clips[0].duration, 10);
        assert.ok(linkedBroken > 0);
        assert.ok(tracks[0].clips.every(c => !c.linkedClipId));
        assert.ok(tracks[1].clips.every(c => !c.linkedClipId));
    });

    await t.test('a cut covering a whole clip removes it', () => {
        const { tracks } = SE.rippleDeleteRanges(project(), [{ start: 11, end: 15 }]);
        assert.strictEqual(tracks[2].clips.length, 0);
    });

    await t.test('a cut over the head trims the clip and keeps its id', () => {
        const { tracks } = SE.rippleDeleteRanges(project(), [{ start: 0, end: 2 }]);
        const v = tracks[0].clips;
        assert.strictEqual(v.length, 1);
        assert.strictEqual(v[0].id, 'a');
        near(v[0].startTime, 0);
        near(v[0].trimStart, 2);
        near(v[0].duration, 8);
    });

    await t.test('continuation pieces do not repeat entrance effects', () => {
        const tracks = [{ id: 'v', clips: [{ id: 'a', startTime: 0, duration: 10, fadeIn: 1, fadeOut: 1, transition: 'fade', transitionDuration: 0.5 }] }];
        const out = SE.rippleDeleteRanges(tracks, [{ start: 4, end: 6 }]).tracks[0].clips.sort((p, q) => p.startTime - q.startTime);
        assert.strictEqual(out[0].fadeIn, 1);
        assert.strictEqual(out[0].fadeOut, 0);
        assert.strictEqual(out[0].transition, 'fade');
        assert.strictEqual(out[1].fadeIn, 0);
        assert.strictEqual(out[1].fadeOut, 1);
        assert.strictEqual(out[1].transition, undefined);
    });
});

test('scene detection helpers', async (t) => {
    await t.test('threshold validation rejects anything that is not a plain fraction', () => {
        assert.strictEqual(SE.validateSceneThreshold(0.3), 0.3);
        assert.strictEqual(SE.validateSceneThreshold('0.45'), 0.45);
        for (const bad of [0, 1, -0.2, NaN, '0.3,select', '1e-1', null, '0.3)']) {
            assert.throws(() => SE.validateSceneThreshold(bad), `accepted ${bad}`);
        }
    });

    await t.test('parses pts_time from showinfo output', () => {
        const log = [
            '[Parsed_showinfo_1 @ 000001] config in time_base: 1/15360',
            '[Parsed_showinfo_1 @ 000001] n:   0 pts:  30720 pts_time:2       duration: 512',
            'frame=    2 fps=0.0 q=-0.0 size=N/A',
            '[Parsed_showinfo_1 @ 000001] n:   1 pts:  61440 pts_time:4.0333  duration: 512'
        ].join('\n');
        assert.deepStrictEqual(SE.parseShowinfo(log), [2, 4.0333]);
        assert.deepStrictEqual(SE.parseShowinfo(''), []);
    });

    await t.test('frame difference is 0 for identical frames and 1 for black→white', () => {
        const black = new Uint8ClampedArray(16).fill(0);
        for (let i = 3; i < 16; i += 4) black[i] = 255;
        const white = new Uint8ClampedArray(16).fill(255);
        near(SE.frameDifference(black, black), 0);
        near(SE.frameDifference(black, white), 1);
    });

    await t.test('pickSceneCuts applies threshold and minimum gap', () => {
        const samples = [
            { time: 1, diff: 0.05 }, { time: 2, diff: 0.6 }, { time: 2.2, diff: 0.7 },
            { time: 4, diff: 0.31 }, { time: 5, diff: 0.29 }
        ];
        assert.deepStrictEqual(SE.pickSceneCuts(samples, { threshold: 0.3, minGap: 0.5 }), [2, 4]);
    });

    await t.test('dedupeCuts drops cuts at the edges and too close together', () => {
        assert.deepStrictEqual(SE.dedupeCuts([0.1, 2, 2.2, 5, 9.9], 0.5, 10), [2, 5]);
    });
});

test('split at scene cuts', async (t) => {
    await t.test('splits a clip and its linked partner at the same times', () => {
        const { tracks, pieces } = SE.splitTracksAt(project(), 'a', [2, 6, 50]);
        assert.strictEqual(pieces, 3);
        const v = tracks[0].clips.sort((p, q) => p.startTime - q.startTime);
        const a = tracks[1].clips.sort((p, q) => p.startTime - q.startTime);
        assert.deepStrictEqual(v.map(c => c.startTime), [0, 2, 6]);
        assert.deepStrictEqual(v.map(c => c.duration), [2, 4, 4]);
        assert.deepStrictEqual(v.map(c => c.trimStart), [0, 2, 6]);
        v.forEach((c, i) => {
            assert.strictEqual(c.linkedClipId, a[i].id);
            assert.strictEqual(a[i].linkedClipId, c.id);
        });
        // Untouched track is shared, not copied.
        near(tracks[2].clips[0].startTime, 12);
    });

    await t.test('a locked partner keeps its link to the head only', () => {
        const { tracks } = SE.splitTracksAt(project(), 'a', [5], { locked: { au: true } });
        const v = tracks[0].clips.sort((p, q) => p.startTime - q.startTime);
        assert.strictEqual(v[0].linkedClipId, 'aa');
        assert.strictEqual(v[1].linkedClipId, undefined);
        assert.strictEqual(tracks[1].clips.length, 1);
    });

    await t.test('locked target or no in-range times is a no-op', () => {
        const p = project();
        assert.strictEqual(SE.splitTracksAt(p, 'a', [5], { locked: { v: true } }).tracks, p);
        assert.strictEqual(SE.splitTracksAt(p, 'a', [0, 10, 11]).tracks, p);
    });
});

test('intersectSpans keeps only overlapping parts', () => {
    assert.deepStrictEqual(
        SE.intersectSpans([{ start: 0, end: 4 }, { start: 6, end: 9 }], [{ start: 2, end: 7 }, { start: 8, end: 20 }]),
        [{ start: 2, end: 4 }, { start: 6, end: 7 }, { start: 8, end: 9 }]);
    assert.deepStrictEqual(SE.intersectSpans([{ start: 0, end: 1 }], []), []);
});
