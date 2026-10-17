/**
 * Tests for the streaming MP4 demuxer that feeds proxy generation.
 *
 * Builds small MP4 'moov' boxes in memory, so nothing depends on the
 * (gitignored) media corpus: codec strings, chunk/offset resolution, B-frame
 * presentation order, sync samples and 64-bit chunk offsets.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const D = require('../../public/engine/Mp4Demux.js');

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s) => [...s].map(c => c.charCodeAt(0));
function box(type, ...parts) {
    const body = [].concat(...parts);
    return be32(8 + body.length).concat(ascii(type), body);
}
const full = (v, flags) => [v, 0, 0, flags || 0];

/** A one-video-track moov. samples: [{size, dur, cto, key}], chunks: samples per chunk. */
function moov({ fourcc = 'avc1', config, samples, chunkOffsets, perChunk, co64 = false, timescale = 30000, noStss = false }) {
    const avcC = config || [1, 0x64, 0x00, 0x1f, 0xff, 0xe0, 0x00];
    const cfgType = fourcc.startsWith('hv') ? 'hvcC' : 'avcC';
    const entry = box(fourcc, new Array(6).fill(0), [0, 1], new Array(16).fill(0), [0x07, 0x80, 0x04, 0x38], new Array(50).fill(0), box(cfgType, avcC));
    const stsd = box('stsd', full(0), be32(1), entry);
    const stsz = box('stsz', full(0), be32(0), be32(samples.length), ...samples.map(s => be32(s.size)));
    const stco = co64
        ? box('co64', full(0), be32(chunkOffsets.length), ...chunkOffsets.map(o => [0, 0, 0, 0].concat(be32(o))))
        : box('stco', full(0), be32(chunkOffsets.length), ...chunkOffsets.map(be32));
    const stsc = box('stsc', full(0), be32(1), be32(1), be32(perChunk), be32(1));
    const stts = box('stts', full(0), be32(samples.length), ...samples.map(s => be32(1).concat(be32(s.dur))));
    const ctts = box('ctts', full(0), be32(samples.length), ...samples.map(s => be32(1).concat(be32(s.cto || 0))));
    const keys = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
    const stss = noStss ? [] : box('stss', full(0), be32(keys.length), ...keys.map(be32));
    const stbl = box('stbl', stsd, stts, ctts, stss, stsc, stsz, stco);
    const minf = box('minf', box('stbl', []).slice(0, 0), stbl);
    const mdhd = box('mdhd', full(0), be32(0), be32(0), be32(timescale), be32(0), [0, 0, 0, 0]);
    const hdlr = box('hdlr', full(0), be32(0), ascii('vide'), new Array(12).fill(0), [0]);
    const mdia = box('mdia', mdhd, hdlr, minf);
    return Uint8Array.from(box('moov', box('trak', mdia)));
}

test('codec strings', async (t) => {
    await t.test('AVC from avcC profile/compat/level bytes', () => {
        assert.strictEqual(D.avcCodec(Uint8Array.from([1, 0x64, 0x00, 0x28])), 'avc1.640028');
        assert.strictEqual(D.avcCodec(Uint8Array.from([1, 0x42, 0xc0, 0x33])), 'avc1.42c033');
    });
    await t.test('HEVC Main, level 93, from hvcC (RFC 6381 compat-flag bit reversal)', () => {
        const h = Uint8Array.from([1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 93]);
        assert.strictEqual(D.hevcCodec(h, 'hvc1'), 'hvc1.1.6.L93.b0');
        const high = Uint8Array.from([1, 0x22, 0x20, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 153]);
        assert.strictEqual(D.hevcCodec(high, 'hev1'), 'hev1.2.4.H153.90');
    });
});

test('sample table', async (t) => {
    // I P B B P: decode order with composition offsets → presentation order I B B P P
    const samples = [
        { size: 100, dur: 1000, cto: 1000, key: true },
        { size: 50, dur: 1000, cto: 3000 },
        { size: 20, dur: 1000, cto: 0 },
        { size: 21, dur: 1000, cto: 0 },
        { size: 60, dur: 1000, cto: 1000 }
    ];

    await t.test('offsets follow chunks; pts normalised to start at 0; B-frames reordered', () => {
        const r = D.parseMoov(moov({ samples, chunkOffsets: [1000, 5000], perChunk: 3 }));
        assert.strictEqual(r.codec, 'avc1.64001f');
        assert.strictEqual(r.width, 1920); assert.strictEqual(r.height, 1080);
        assert.deepStrictEqual(r.samples.map(s => s.offset), [1000, 1100, 1150, 5000, 5021]);
        const pts = r.samples.map(s => Math.round(s.pts * 30000));
        assert.deepStrictEqual(pts, [0, 3000, 1000, 2000, 4000]);
        assert.deepStrictEqual(r.samples.map(s => s.key), [true, false, false, false, false]);
        assert.ok(Math.abs(r.duration - 5000 / 30000) < 1e-9);
    });

    await t.test('64-bit chunk offsets', () => {
        const r = D.parseMoov(moov({ samples, chunkOffsets: [7, 9000], perChunk: 3, co64: true }));
        assert.deepStrictEqual(r.samples.map(s => s.offset), [7, 107, 157, 9000, 9021]);
    });

    await t.test('no stss means every sample is a keyframe', () => {
        const r = D.parseMoov(moov({ samples, chunkOffsets: [0, 500], perChunk: 3, noStss: true }));
        assert.ok(r.samples.every(s => s.key));
    });

    await t.test('HEVC tracks are recognised; unknown codecs are out of scope', () => {
        const hv = D.parseMoov(moov({ fourcc: 'hvc1', config: [1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 93], samples, chunkOffsets: [0, 500], perChunk: 3 }));
        assert.strictEqual(hv.codec, 'hvc1.1.6.L93.b0');
        assert.strictEqual(D.parseMoov(moov({ fourcc: 'mp4v', samples, chunkOffsets: [0, 500], perChunk: 3 })), null);
    });

    await t.test('open() walks top-level boxes to moov and refuses fragmented files', async () => {
        const m = moov({ samples, chunkOffsets: [0, 500], perChunk: 3 });
        const ftyp = Uint8Array.from(box('ftyp', ascii('isom'), be32(0)));
        const mdat = Uint8Array.from(box('mdat', new Array(40).fill(0)));
        const file = new Uint8Array(ftyp.length + mdat.length + m.length);
        file.set(ftyp, 0); file.set(mdat, ftyp.length); file.set(m, ftyp.length + mdat.length);    // moov at the END
        const read = async (o, l) => file.slice(o, o + l);
        const r = await D.open(read, file.length);
        assert.strictEqual(r.samples.length, 5);
        const frag = new Uint8Array(ftyp.length + 8); frag.set(ftyp, 0); frag.set(Uint8Array.from(box('moof', [])), ftyp.length);
        assert.strictEqual(await D.open(async (o, l) => frag.slice(o, o + l), frag.length), null);
    });
});
