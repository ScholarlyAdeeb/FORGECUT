/**
 * ForgeCut — minimal streaming MP4 (ISO BMFF) video demuxer.
 *
 * Reads just enough of an MP4 to hand its video samples to WebCodecs'
 * VideoDecoder: the codec string and decoder description (avcC / hvcC), and
 * a sample table with byte ranges and presentation times. Sample data is
 * read on demand through `read(offset, length)`, so a multi-gigabyte 4K file
 * is never held in memory.
 *
 * Why it exists: building a proxy by SEEKING each frame of a long-GOP 4K
 * file costs a decode from the last keyframe per frame (measured 533 ms per
 * seek, 84 s for 5 s of footage). Decoding sequentially costs one decode per
 * frame.
 *
 * Scope: progressive (non-fragmented) MP4/MOV with H.264 (avc1/avc3) or HEVC
 * (hvc1/hev1) video. Anything else returns null and the caller falls back.
 *
 * Pure: node and browser. `read` is async (File.slice in the browser, a file
 * handle in node).
 */
(function () {
    'use strict';

    const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const u16 = (b, o) => (b[o] << 8) | b[o + 1];
    const s32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const type4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }

    /** Iterate child boxes of a buffer slice. */
    function* boxes(b, start, end) {
        let o = start;
        while (o + 8 <= end) {
            let size = u32(b, o), hdr = 8;
            const t = type4(b, o + 4);
            if (size === 1) { size = u64(b, o + 8); hdr = 16; }
            else if (size === 0) size = end - o;
            if (size < hdr || o + size > end) return;
            yield { type: t, start: o, body: o + hdr, end: o + size };
            o += size;
        }
    }
    const child = (b, box, t) => { for (const c of boxes(b, box.body, box.end)) if (c.type === t) return c; return null; };
    const path = (b, box, ...ts) => ts.reduce((bx, t) => bx && child(b, bx, t), box);

    /** Find the top-level moov box, reading only box headers. */
    async function locateMoov(read, fileSize) {
        let o = 0;
        while (o + 8 <= fileSize) {
            const h = await read(o, 16);
            let size = u32(h, 0), hdr = 8;
            const t = type4(h, 4);
            if (size === 1) { size = u64(h, 8); hdr = 16; }
            else if (size === 0) size = fileSize - o;
            if (size < hdr) return null;
            if (t === 'moov') return { offset: o, size };
            if (t === 'moof') return null;                 // fragmented: out of scope
            o += size;
        }
        return null;
    }

    function hex2(n) { return n.toString(16).padStart(2, '0'); }

    function avcCodec(avcC) {
        return 'avc1.' + hex2(avcC[1]) + hex2(avcC[2]) + hex2(avcC[3]);
    }

    /** RFC 6381 codec string for HEVC from an hvcC record. */
    function hevcCodec(h, fourcc) {
        const space = h[1] >> 6, tier = (h[1] >> 5) & 1, profile = h[1] & 0x1f;
        const compat = u32(h, 2);
        let rev = 0;
        for (let i = 0; i < 32; i++) if (compat & (1 << i)) rev |= (1 << (31 - i));
        rev >>>= 0;
        const constraints = [];
        for (let i = 6; i < 12; i++) constraints.push(h[i]);
        while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
        const level = h[12];
        return `${fourcc}.${space ? 'ABC'[space - 1] : ''}${profile}.${rev.toString(16)}.${tier ? 'H' : 'L'}${level}` +
            (constraints.length ? '.' + constraints.map(c => c.toString(16)).join('.') : '');
    }

    /**
     * Parse a moov buffer → { codec, description, width, height, timescale,
     * duration, samples: [{ offset, size, pts, dts, key }] } (pts/dts in
     * seconds, presentation-normalised so the first frame is at 0).
     */
    function parseMoov(b) {
        const moov = { type: 'moov', body: 8, end: b.length };
        for (const trak of boxes(b, moov.body, moov.end)) {
            if (trak.type !== 'trak') continue;
            const hdlr = path(b, trak, 'mdia', 'hdlr');
            if (!hdlr || type4(b, hdlr.body + 8) !== 'vide') continue;
            const mdhd = path(b, trak, 'mdia', 'mdhd');
            const v = b[mdhd.body];
            const timescale = v === 1 ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
            const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
            if (!stbl) return null;
            const stsd = child(b, stbl, 'stsd');
            const entry = boxes(b, stsd.body + 8, stsd.end).next().value;
            if (!entry) return null;
            const fourcc = entry.type;
            const width = u16(b, entry.body + 24), height = u16(b, entry.body + 26);
            let codec = null, description = null;
            // Visual sample entry header is 78 bytes; codec config boxes follow.
            for (const c of boxes(b, entry.body + 78, entry.end)) {
                if ((fourcc === 'avc1' || fourcc === 'avc3') && c.type === 'avcC') {
                    description = b.slice(c.body, c.end); codec = avcCodec(description);
                }
                if ((fourcc === 'hvc1' || fourcc === 'hev1') && c.type === 'hvcC') {
                    description = b.slice(c.body, c.end); codec = hevcCodec(description, fourcc);
                }
            }
            if (!codec) return null;

            // Sample sizes
            const stsz = child(b, stbl, 'stsz');
            const fixed = u32(b, stsz.body + 4), count = u32(b, stsz.body + 8);
            const sizes = new Array(count);
            for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.body + 12 + 4 * i);
            // Chunk offsets
            const stco = child(b, stbl, 'stco'), co64 = child(b, stbl, 'co64');
            const chunkOffsets = [];
            if (stco) { const n = u32(b, stco.body + 4); for (let i = 0; i < n; i++) chunkOffsets.push(u32(b, stco.body + 8 + 4 * i)); }
            else if (co64) { const n = u32(b, co64.body + 4); for (let i = 0; i < n; i++) chunkOffsets.push(u64(b, co64.body + 8 + 8 * i)); }
            // Samples per chunk
            const stsc = child(b, stbl, 'stsc');
            const sc = [];
            { const n = u32(b, stsc.body + 4); for (let i = 0; i < n; i++) { const o = stsc.body + 8 + 12 * i; sc.push([u32(b, o), u32(b, o + 4)]); } }
            const offsets = new Array(count);
            let s = 0;
            for (let ci = 0; ci < chunkOffsets.length && s < count; ci++) {
                let per = 0;
                for (let k = sc.length - 1; k >= 0; k--) if (sc[k][0] <= ci + 1) { per = sc[k][1]; break; }
                let off = chunkOffsets[ci];
                for (let j = 0; j < per && s < count; j++, s++) { offsets[s] = off; off += sizes[s]; }
            }
            // Decode times
            const stts = child(b, stbl, 'stts');
            const dts = new Array(count);
            { let t = 0, i = 0; const n = u32(b, stts.body + 4);
              for (let e = 0; e < n; e++) { const c = u32(b, stts.body + 8 + 8 * e), d = u32(b, stts.body + 12 + 8 * e);
                  for (let j = 0; j < c && i < count; j++, i++) { dts[i] = t; t += d; } } }
            // Composition offsets (B-frames)
            const ctts = child(b, stbl, 'ctts');
            const cto = new Array(count).fill(0);
            if (ctts) { const ver = b[ctts.body]; const n = u32(b, ctts.body + 4); let i = 0;
                for (let e = 0; e < n; e++) { const c = u32(b, ctts.body + 8 + 8 * e); const off = ver === 1 ? s32(b, ctts.body + 12 + 8 * e) : u32(b, ctts.body + 12 + 8 * e);
                    for (let j = 0; j < c && i < count; j++, i++) cto[i] = off; } }
            // Sync samples (absent = every sample is a keyframe)
            const stss = child(b, stbl, 'stss');
            const key = new Array(count).fill(!stss);
            if (stss) { const n = u32(b, stss.body + 4); for (let i = 0; i < n; i++) key[u32(b, stss.body + 8 + 4 * i) - 1] = true; }

            let minPts = Infinity;
            for (let i = 0; i < count; i++) minPts = Math.min(minPts, dts[i] + cto[i]);
            const samples = new Array(count);
            for (let i = 0; i < count; i++) {
                samples[i] = { offset: offsets[i], size: sizes[i], dts: dts[i] / timescale,
                    pts: (dts[i] + cto[i] - minPts) / timescale, key: key[i] };
            }
            const last = samples.reduce((m, x) => Math.max(m, x.pts), 0);
            const frameDur = count > 1 ? last / (count - 1) : 0;
            return { codec, description, width, height, timescale, samples, duration: last + frameDur };
        }
        return null;
    }

    /**
     * Open an MP4 for sequential video decoding.
     *   read(offset, length) → Promise<Uint8Array>, fileSize → number
     * Returns null when out of scope (fragmented, no video, unsupported codec).
     */
    async function open(read, fileSize) {
        const loc = await locateMoov(read, fileSize);
        if (!loc || loc.size > 256 * 1024 * 1024) return null;
        const moov = await read(loc.offset, loc.size);
        return parseMoov(moov);
    }

    /** A `read` over a browser File/Blob. */
    function fileReader(file) {
        return async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    }

    const API = { open, parseMoov, fileReader, avcCodec, hevcCodec };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Mp4Demux = API;
    }
})();
