/**
 * Unit tests for the pure functions in public/workers/MediaWorker.js.
 *
 * These functions have no DOM dependency, and every case below corresponds to
 * a bug that actually shipped:
 *   - RIFF containers all resolved to video/avi, so .wav and .webp were
 *     reported as video
 *   - ftyp brands were ignored, so audio-only .m4a was reported as video
 *   - extractExifOrientation read past the end of short files and threw,
 *     which failed the whole metadata extraction
 *
 * Run: npm test
 *
 * The real worker file is loaded and evaluated with a stubbed `self`, so this
 * exercises the shipped source rather than a copy of it.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKER = path.join(__dirname, '..', '..', 'public', 'workers', 'MediaWorker.js');

function loadWorker() {
    const context = {
        self: {},
        DataView, Uint8Array, Float32Array, Math, String, Object, console
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(WORKER, 'utf8'), context, { filename: 'MediaWorker.js' });
    return context;
}

const W = loadWorker();

/** First `n` bytes of a container header, from a byte list. */
const header = (...bytes) => new Uint8Array([...bytes, ...new Array(Math.max(0, 32 - bytes.length)).fill(0)]);
const ascii = (s) => [...s].map(c => c.charCodeAt(0));

/* ── Container detection ────────────────────────────────────────────────── */

test('RIFF containers are told apart by their form tag, not by table order', async (t) => {
    // All three start with "RIFF"; only bytes 8-12 distinguish them. Before the
    // fix, the first matching table entry (video/avi) won for all of them.
    const riff = (form) => header(...ascii('RIFF'), 0, 0, 0, 0, ...ascii(form));

    await t.test('WAVE is audio', () => {
        const r = W.detectFileType(riff('WAVE'), 'wav', 'audio/wav');
        assert.strictEqual(r.category, 'audio');
        assert.strictEqual(r.format, 'wav');
    });

    await t.test('AVI is video', () => {
        const r = W.detectFileType(riff('AVI '), 'avi', 'video/x-msvideo');
        assert.strictEqual(r.category, 'video');
        assert.strictEqual(r.format, 'avi');
    });

    await t.test('WEBP is an image', () => {
        const r = W.detectFileType(riff('WEBP'), 'webp', 'image/webp');
        assert.strictEqual(r.category, 'image');
        assert.strictEqual(r.format, 'webp');
    });
});

test('ftyp brands distinguish mp4, mov and audio-only m4a', async (t) => {
    const ftyp = (brand) => header(0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii(brand));

    await t.test('isom is video/mp4', () => {
        const r = W.detectFileType(ftyp('isom'), 'mp4', 'video/mp4');
        assert.strictEqual(r.category, 'video');
        assert.strictEqual(r.format, 'mp4');
    });

    await t.test('qt is video/mov', () => {
        const r = W.detectFileType(ftyp('qt  '), 'mov', 'video/quicktime');
        assert.strictEqual(r.category, 'video');
        assert.strictEqual(r.format, 'mov');
    });

    await t.test('M4A is audio, not video', () => {
        const r = W.detectFileType(ftyp('M4A '), 'm4a', 'audio/mp4');
        assert.strictEqual(r.category, 'audio');
        assert.strictEqual(r.format, 'm4a');
    });
});

test('EBML resolves to matroska or webm', () => {
    const ebml = header(0x1A, 0x45, 0xDF, 0xA3);
    assert.strictEqual(W.detectFileType(ebml, 'mkv', 'video/x-matroska').category, 'video');

    const webm = new Uint8Array(64);
    webm.set([0x1A, 0x45, 0xDF, 0xA3], 0);
    webm.set(ascii('webm'), 24);
    assert.strictEqual(W.detectFileType(webm, 'webm', 'video/webm').format, 'webm');
});

test('falls back to extension, then MIME, then unknown', async (t) => {
    const nothing = new Uint8Array(32);

    await t.test('extension wins when there is no magic number', () => {
        assert.strictEqual(W.detectFileType(nothing, 'mp3', '').category, 'audio');
        assert.strictEqual(W.detectFileType(nothing, 'svg', '').category, 'image');
    });

    await t.test('MIME is used when the extension is unknown', () => {
        assert.strictEqual(W.detectFileType(nothing, 'xyz', 'audio/weird').category, 'audio');
    });

    await t.test('otherwise unknown and not valid', () => {
        const r = W.detectFileType(nothing, 'xyz', '');
        assert.strictEqual(r.category, 'unknown');
        assert.strictEqual(r.valid, false);
    });
});

test('getExtension handles dotted and extensionless names', () => {
    assert.strictEqual(W.getExtension('clip.mp4'), 'mp4');
    assert.strictEqual(W.getExtension('screenshot 2024-01-01 at 12.34.56.png'), 'png');
    assert.strictEqual(W.getExtension('noextension'), '');
});

/* ── EXIF ───────────────────────────────────────────────────────────────── */

test('extractExifOrientation never throws on short or malformed input', async (t) => {
    // The shipped bug: a 1-byte file made getUint16(0) throw, which the worker
    // reported as "metadata extraction failed" for the entire file.
    await t.test('empty buffer', () => {
        assert.strictEqual(W.extractExifOrientation(new Uint8Array(0).buffer), 1);
    });

    await t.test('one byte', () => {
        assert.strictEqual(W.extractExifOrientation(new Uint8Array([0xFF]).buffer), 1);
    });

    await t.test('not a JPEG', () => {
        assert.strictEqual(W.extractExifOrientation(new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer), 1);
    });

    await t.test('JPEG header that is truncated mid-segment', () => {
        const buf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00]).buffer;
        assert.strictEqual(W.extractExifOrientation(buf), 1);
    });

    await t.test('a zero segment length does not hang', () => {
        const buf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0xFF, 0xD9]).buffer;
        assert.strictEqual(W.extractExifOrientation(buf), 1);
    });
});

test('extractExifOrientation reads a real Orientation tag', () => {
    // JPEG SOI + APP1 carrying a little-endian TIFF block with Orientation = 6.
    const tiff = [
        0x49, 0x49, 0x2A, 0x00,     // "II*\0"
        0x08, 0x00, 0x00, 0x00,     // offset to IFD0
        0x01, 0x00,                 // one entry
        0x12, 0x01,                 // tag 0x0112 (Orientation)
        0x03, 0x00,                 // type SHORT
        0x01, 0x00, 0x00, 0x00,     // count 1
        0x06, 0x00, 0x00, 0x00,     // value 6
        0x00, 0x00, 0x00, 0x00      // next IFD
    ];
    const app1 = [...ascii('Exif'), 0x00, 0x00, ...tiff];
    const len = app1.length + 2;
    const bytes = [0xFF, 0xD8, 0xFF, 0xE1, (len >> 8) & 0xFF, len & 0xFF, ...app1, 0xFF, 0xD9];
    assert.strictEqual(W.extractExifOrientation(new Uint8Array(bytes).buffer), 6);
});

/* ── Waveform reduction ─────────────────────────────────────────────────── */

test('downsample reduces PCM to normalised peaks', async (t) => {
    await t.test('returns exactly the requested number of samples', () => {
        const pcm = new Float32Array(10000).map((_, i) => Math.sin(i / 50));
        assert.strictEqual(W.downsample(pcm, 800).length, 800);
        assert.strictEqual(W.downsample(pcm, 1).length, 1);
    });

    await t.test('peaks are normalised into 0..1', () => {
        const pcm = new Float32Array(5000).map((_, i) => (i % 2 ? 0.5 : -0.5));
        const wf = W.downsample(pcm, 100);
        assert.ok(Math.max(...wf) <= 1.0000001, 'no peak above 1');
        assert.ok(Math.min(...wf) >= 0, 'no negative peak');
        assert.ok(Math.max(...wf) > 0.9, 'loudest block normalises close to 1');
    });

    await t.test('silence does not divide by zero', () => {
        const wf = W.downsample(new Float32Array(1000), 50);
        assert.ok(wf.every(v => v === 0), 'silence stays zero, not NaN');
    });

    await t.test('more requested samples than input does not produce NaN', () => {
        const wf = W.downsample(new Float32Array([1, -1, 1, -1]), 100);
        assert.ok(wf.every(v => Number.isFinite(v)), 'every peak is finite');
    });
});
