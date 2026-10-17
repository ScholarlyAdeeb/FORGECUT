/**
 * Tests for the Captions and Reframe engines.
 *
 * Both features produce plain data the renderer already understands (text
 * clips, x/y keyframes), so what matters is that the data is right: caption
 * timing never overlaps or vanishes, and a reframe never exposes the canvas
 * edge or jitters.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../../public/engine/Captions.js');
const R = require('../../public/engine/Reframe.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('subtitle parsing', async (t) => {
    await t.test('timestamps in SRT, VTT and bare forms', () => {
        near(C.parseTimestamp('00:01:02,345'), 62.345);
        near(C.parseTimestamp('01:02.5'), 62.5);
        near(C.parseTimestamp('1:00:00.000'), 3600);
        near(C.parseTimestamp('7.25'), 7.25);
        assert.throws(() => C.parseTimestamp('soon'));
    });

    await t.test('SRT with markup, CRLF and a BOM', () => {
        const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond &amp; last\r\n';
        assert.deepStrictEqual(C.parseSubtitles(srt), [
            { start: 1, end: 2.5, text: 'Hello there' },
            { start: 3, end: 4, text: 'Second & last' }
        ]);
    });

    await t.test('WebVTT header, NOTE blocks and cue settings are skipped', () => {
        const vtt = 'WEBVTT\n\nNOTE made by hand\n\nintro\n00:00.500 --> 00:01.500 align:center line:80%\n<v Sam>Hi</v>\n\n00:02.000 --> 00:01.000\nbackwards cue is dropped\n';
        assert.deepStrictEqual(C.parseSubtitles(vtt), [{ start: 0.5, end: 1.5, text: 'Hi' }]);
    });
});

test('words and grouping', async (t) => {
    await t.test('multi-word cues share their span by word length', () => {
        const w = C.cuesToWords([{ start: 0, end: 2, text: 'a bbb' }]);
        assert.strictEqual(w.length, 2);
        near(w[0].end, 2 * 2 / 6);
        near(w[1].start, w[0].end);
        near(w[1].end, 2);
    });

    await t.test('transformers.js word chunks, including a null end', () => {
        const words = C.wordsFromChunks([
            { text: ' Hello', timestamp: [0.2, 0.5] },
            { text: ' world.', timestamp: [0.6, null] },
            { text: ' Next', timestamp: [1.4, 1.7] },
            { text: '   ', timestamp: [1.8, 1.9] }
        ], 10);
        assert.deepStrictEqual(words.map(w => w.text), ['Hello', 'world.', 'Next']);
        near(words[1].end, 11.4);          // borrowed the next start
        near(words[0].start, 10.2);        // offset applied
    });

    await t.test('groups respect word count, sentence ends and pauses', () => {
        const mk = (text, s) => ({ text, start: s, end: s + 0.3 });
        const pages = C.groupWords([
            mk('one', 0), mk('two', 0.3), mk('three', 0.6), mk('four', 0.9),
            mk('end.', 1.2), mk('after', 1.5), mk('pause', 3.0)
        ], { maxWords: 3, maxChars: 40, maxGap: 0.6 });
        assert.deepStrictEqual(pages.map(p => p.text), ['one two three', 'four end.', 'after', 'pause']);
    });

    await t.test('captions never overlap and are long enough to read', () => {
        const pages = C.groupWords([
            { text: 'a', start: 0, end: 0.05 }, { text: 'b.', start: 0.04, end: 0.3 }, { text: 'c', start: 2, end: 2.02 }
        ], { maxWords: 1 });
        for (let i = 0; i < pages.length - 1; i++) assert.ok(pages[i].end <= pages[i + 1].start + 1e-9);
        near(pages[2].end - pages[2].start, C.GROUP_DEFAULTS.minDuration);
    });
});

test('caption clips', async (t) => {
    await t.test('builds styled text clips sharing a group id', () => {
        const clips = C.buildCaptionClips([{ start: 1, end: 2, text: 'hi there' }], { style: 'bold', canvasWidth: 1080, canvasHeight: 1920, group: 'g1' });
        assert.strictEqual(clips.length, 1);
        const c = clips[0];
        assert.strictEqual(c.text, 'HI THERE');
        assert.strictEqual(c.captionGroup, 'g1');
        assert.strictEqual(c.x, 540);
        assert.ok(c.y > 960 && c.y < 1920);
        assert.strictEqual(c.animations.entrance, 'Zoom In');
        assert.ok(c.maxWidth > 0 && c.maxWidth < 1080);
    });

    await t.test('unknown style falls back to bold', () => {
        const [c] = C.buildCaptionClips([{ start: 0, end: 1, text: 'x' }], { style: 'nope' });
        assert.strictEqual(c.captionStyle, 'bold');
    });

    await t.test('SRT round trip', () => {
        const srt = C.toSRT([{ startTime: 3661.5, duration: 1.25, text: 'Hi' }]);
        assert.strictEqual(srt, '1\n01:01:01,500 --> 01:01:02,750\nHi\n');
        assert.deepStrictEqual(C.parseSubtitles(srt), [{ start: 3661.5, end: 3662.75, text: 'Hi' }]);
    });
});

const dims = { srcWidth: 1920, srcHeight: 1080, canvasWidth: 1080, canvasHeight: 1920 };

test('reframe', async (t) => {
    await t.test('cover scale fills the canvas', () => {
        near(R.coverScale(1920, 1080, 1080, 1920), 1920 / 1080);
    });

    await t.test('a subject on the right moves the frame left, within bounds', () => {
        const samples = [0, 1, 2].map(t => ({ t, cx: 1500, cy: 540 }));
        const r = R.planReframe(samples, dims, { deadzone: 0 });
        const s = r.scale;
        // Subject at x=1500 should land at canvas centre: x = 540 - (1500-960)*s
        near(r.x, Math.round((540 - 540 * s) * 10) / 10, 0.11);
        // …and never so far that the right edge of the video shows the canvas.
        assert.ok(r.x + 1920 * s / 2 >= 1080 - 0.1);
    });

    await t.test('a subject at the extreme edge is clamped, never exposing background', () => {
        const r = R.planReframe([{ t: 0, cx: 1919, cy: 1079 }, { t: 1, cx: 0, cy: 0 }], dims, { deadzone: 0, smoothing: 0 });
        const half = 1920 * r.scale / 2;
        for (const v of [r.x, ...r.keyframes.x.map(k => k.value)]) {
            assert.ok(v - half <= 0.1 && v + half >= 1080 - 0.1, `x=${v} exposes the edge`);
        }
    });

    await t.test('no detections → centred, coverage 0', () => {
        const r = R.planReframe([{ t: 0, cx: null }, { t: 1, cx: null }], dims);
        near(r.x, 540, 0.11);
        assert.strictEqual(r.coverage, 0);
        assert.deepStrictEqual(r.keyframes.x, []);
    });

    await t.test('gaps are interpolated and the ends held', () => {
        const f = R.fillGaps([{ t: 0, cx: null, cy: null }, { t: 1, cx: 100, cy: 0 }, { t: 2, cx: null }, { t: 3, cx: 300, cy: 0 }, { t: 4, cx: null }], 1000, 1000);
        assert.deepStrictEqual(f.map(s => s.cx), [100, 100, 200, 300, 300]);
    });

    await t.test('jitter inside the dead zone produces no keyframes', () => {
        const samples = Array.from({ length: 50 }, (_, i) => ({ t: i / 5, cx: 960 + (i % 2 ? 15 : -15), cy: 540 }));
        const r = R.planReframe(samples, dims);
        assert.deepStrictEqual(r.keyframes.x, []);
    });

    await t.test('a real move is followed smoothly and simplified', () => {
        const samples = Array.from({ length: 50 }, (_, i) => ({ t: i / 5, cx: i < 25 ? 700 : 1250, cy: 540 }));
        const r = R.planReframe(samples, dims);
        assert.ok(r.keyframes.x.length >= 2 && r.keyframes.x.length < 50, `${r.keyframes.x.length} keyframes`);
        const v = r.keyframes.x.map(k => k.value);
        // Monotonic (no overshoot) and actually moved.
        for (let i = 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1] + 0.11);
        assert.ok(v[0] - v[v.length - 1] > 300);
    });

    await t.test('smoother has no lag: symmetric step stays centred on the step', () => {
        const times = Array.from({ length: 21 }, (_, i) => i / 10);
        const vals = times.map(t => (t < 1 ? 0 : 1));
        const s = R.smoothZeroPhase(times, vals, 0.2);
        near(s[10] + s[9], 1, 0.15);
    });

    await t.test('pickSubject prefers the larger, steadier face', () => {
        const dets = [{ x: 0, y: 0, width: 50, height: 50, score: 0.9 }, { x: 500, y: 500, width: 200, height: 200, score: 0.8 }];
        assert.deepStrictEqual(R.pickSubject(dets), { cx: 600, cy: 600 });
        assert.strictEqual(R.pickSubject([]), null);
    });

    await t.test('motionCentroid finds where the frame changed', () => {
        const w = 10, h = 10, a = new Uint8Array(100), b = new Uint8Array(100);
        for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) b[y * w + x] = 200;
        const c = R.motionCentroid(a, b, w, h);
        near(c.cx, 7); near(c.cy, 7);
        assert.strictEqual(R.motionCentroid(a, a, w, h), null);
    });

    await t.test('rejects missing dimensions', () => {
        assert.throws(() => R.planReframe([], {}));
    });
});

test('restyle keeps hand edits and restores case', () => {
    const [c] = C.buildCaptionClips([{ start: 0, end: 1, text: 'Hello there' }], { style: 'bold' });
    assert.strictEqual(c.text, 'HELLO THERE');
    assert.strictEqual(C.restyledText(c, 'clean'), 'Hello there');
    const edited = Object.assign({}, c, { text: 'HI!' });
    assert.strictEqual(C.restyledText(edited, 'clean'), 'HI!');
});

test('captions never merge words across subtitle cues', () => {
    const cues = C.parseSubtitles('1\n00:00:00,500 --> 00:00:02,000\nHello from an SRT file\n\n2\n00:00:02,500 --> 00:00:03,000\nBye.\n');
    const pages = C.groupWords(C.cuesToWords(cues), { maxWords: 3 });
    assert.deepStrictEqual(pages.map(p => p.text), ['Hello from an', 'SRT file', 'Bye.']);
    near(pages[1].end, 2);
    near(pages[2].start, 2.5);
});
