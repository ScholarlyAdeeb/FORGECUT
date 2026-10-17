/**
 * ForgeCut — .cube LUT parsing and storage.
 *
 * Adobe/Resolve .cube files: a header (TITLE, LUT_3D_SIZE or LUT_1D_SIZE,
 * optional DOMAIN_MIN / DOMAIN_MAX) followed by one "r g b" row per entry,
 * red varying fastest. Everything is normalised here to the one shape the
 * renderer understands — a 3D table over the 0..1 cube — so the shader and
 * the CPU reference never deal with 1D tables or custom domains.
 *
 * LUTs are stored IN the project (state.luts), packed as 16-bit values, so a
 * project file stays self-contained when it is moved or shared: a 33³ LUT is
 * about 290 KB of base64.
 *
 * Pure: node and browser.
 */
(function () {
    'use strict';

    const MAX_3D = 65;          // largest common size; 129³ would be 25 MB of floats
    const MAX_1D = 65536;
    const EXPAND_1D_TO = 33;

    function fail(msg) { const e = new Error(msg); e.code = 'EBADLUT'; throw e; }

    function identity(n) {
        const d = new Float32Array(n * n * n * 3);
        let i = 0;
        for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
            d[i++] = r / (n - 1); d[i++] = g / (n - 1); d[i++] = b / (n - 1);
        }
        return { size: n, data: d };
    }

    /** Build a 3D LUT from f(r, g, b) → [r, g, b]. Used for tests and built-in looks. */
    function fromFunction(n, f) {
        const d = new Float32Array(n * n * n * 3);
        let i = 0;
        for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
            const o = f(r / (n - 1), g / (n - 1), b / (n - 1));
            d[i++] = o[0]; d[i++] = o[1]; d[i++] = o[2];
        }
        return { size: n, data: d };
    }

    function trilinear(lut, r, g, b) {
        const n = lut.size, d = lut.data, m = n - 1;
        const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
        const fr = cl(r) * m, fg = cl(g) * m, fb = cl(b) * m;
        const r0 = Math.min(m - 1, Math.floor(fr)), g0 = Math.min(m - 1, Math.floor(fg)), b0 = Math.min(m - 1, Math.floor(fb));
        const tr = fr - r0, tg = fg - g0, tb = fb - b0;
        const out = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
            const v = (ri, gi, bi) => d[3 * (ri + n * (gi + n * bi)) + c];
            const c00 = v(r0, g0, b0) * (1 - tr) + v(r0 + 1, g0, b0) * tr;
            const c10 = v(r0, g0 + 1, b0) * (1 - tr) + v(r0 + 1, g0 + 1, b0) * tr;
            const c01 = v(r0, g0, b0 + 1) * (1 - tr) + v(r0 + 1, g0, b0 + 1) * tr;
            const c11 = v(r0, g0 + 1, b0 + 1) * (1 - tr) + v(r0 + 1, g0 + 1, b0 + 1) * tr;
            out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
        }
        return out;
    }

    /**
     * Parse .cube text. Returns { title, size, data: Float32Array } over the
     * 0..1 domain, with output values clamped to 0..1.
     */
    function parseCube(text) {
        const src = String(text || '').replace(/^﻿/, '');
        let title = '', size3 = 0, size1 = 0;
        let dmin = [0, 0, 0], dmax = [1, 1, 1];
        const values = [];
        const lines = src.split(/\r\n|\r|\n/);
        for (let ln = 0; ln < lines.length; ln++) {
            const line = lines[ln].trim();
            if (!line || line[0] === '#') continue;
            const parts = line.split(/\s+/);
            const key = parts[0].toUpperCase();
            if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
            if (key === 'LUT_3D_SIZE') { size3 = parseInt(parts[1], 10); continue; }
            if (key === 'LUT_1D_SIZE') { size1 = parseInt(parts[1], 10); continue; }
            if (key === 'DOMAIN_MIN') { dmin = parts.slice(1, 4).map(Number); continue; }
            if (key === 'DOMAIN_MAX') { dmax = parts.slice(1, 4).map(Number); continue; }
            if (key === 'LUT_3D_INPUT_RANGE' || key === 'LUT_1D_INPUT_RANGE') {
                const a = Number(parts[1]), b = Number(parts[2]);
                dmin = [a, a, a]; dmax = [b, b, b];
                continue;
            }
            if (/^[A-Z_]+$/.test(key)) continue;          // unknown keyword: ignore, as Resolve does
            if (parts.length < 3) fail(`Line ${ln + 1}: expected three numbers`);
            for (let k = 0; k < 3; k++) {
                const v = Number(parts[k]);
                if (!Number.isFinite(v)) fail(`Line ${ln + 1}: "${parts[k]}" is not a number`);
                values.push(v);
            }
        }
        if (dmin.some(v => !Number.isFinite(v)) || dmax.some(v => !Number.isFinite(v)) ||
            dmin.some((v, i) => !(dmax[i] > v))) fail('DOMAIN_MIN must be below DOMAIN_MAX');

        let lut;
        if (size3) {
            if (!(size3 >= 2 && size3 <= MAX_3D)) fail(`LUT_3D_SIZE ${size3} is outside 2..${MAX_3D}`);
            const need = size3 * size3 * size3 * 3;
            if (values.length !== need) fail(`Expected ${need / 3} entries for a ${size3}³ LUT, found ${values.length / 3}`);
            lut = { size: size3, data: Float32Array.from(values) };
        } else if (size1) {
            if (!(size1 >= 2 && size1 <= MAX_1D)) fail(`LUT_1D_SIZE ${size1} is outside 2..${MAX_1D}`);
            if (values.length !== size1 * 3) fail(`Expected ${size1} entries for a 1D LUT, found ${values.length / 3}`);
            // Per-channel curves → a 3D table (exact along each axis).
            const curve = (c, v) => {
                const f = Math.min(1, Math.max(0, v)) * (size1 - 1), i = Math.min(size1 - 2, Math.floor(f)), t = f - i;
                return values[3 * i + c] * (1 - t) + values[3 * (i + 1) + c] * t;
            };
            const n = Math.min(EXPAND_1D_TO, size1);
            lut = fromFunction(n, (r, g, b) => [curve(0, r), curve(1, g), curve(2, b)]);
        } else {
            fail('Missing LUT_3D_SIZE or LUT_1D_SIZE');
        }

        // Custom domain: resample so the table is indexed by plain 0..1 input.
        const custom = dmin.some(v => v !== 0) || dmax.some(v => v !== 1);
        if (custom && size3) {
            const src3 = lut;
            const norm = (v, c) => (v - dmin[c]) / (dmax[c] - dmin[c]);
            lut = fromFunction(src3.size, (r, g, b) => trilinear(src3, norm(r, 0), norm(g, 1), norm(b, 2)));
        }
        for (let i = 0; i < lut.data.length; i++) lut.data[i] = Math.min(1, Math.max(0, lut.data[i]));
        return { title, size: lut.size, data: lut.data };
    }

    /* ── project storage ─────────────────────────────────────────────── */

    const toB64 = (bytes) => {
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    };
    const fromB64 = (b64) => {
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
        const s = atob(b64), out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    };

    /** { name, size, data: Float32Array } → JSON-safe record (16-bit, little endian). */
    function pack(lut, name) {
        const u16 = new Uint16Array(lut.data.length);
        for (let i = 0; i < u16.length; i++) u16[i] = Math.round(Math.min(1, Math.max(0, lut.data[i])) * 65535);
        const bytes = new Uint8Array(u16.length * 2);
        for (let i = 0; i < u16.length; i++) { bytes[2 * i] = u16[i] & 255; bytes[2 * i + 1] = u16[i] >> 8; }
        return { name: String(name || lut.title || 'LUT').slice(0, 120), size: lut.size, encoding: 'u16le-b64', data: toB64(bytes) };
    }

    function unpack(rec) {
        if (!rec || rec.encoding !== 'u16le-b64' || !(rec.size >= 2 && rec.size <= MAX_3D)) return null;
        const bytes = fromB64(rec.data);
        const n = rec.size * rec.size * rec.size * 3;
        if (bytes.length !== n * 2) return null;
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) data[i] = (bytes[2 * i] | (bytes[2 * i + 1] << 8)) / 65535;
        return { name: rec.name, size: rec.size, data };
    }

    let seq = 0;
    function newId() { seq = (seq + 1) % 1679616; return 'lut_' + Date.now().toString(36).slice(-5) + seq.toString(36).padStart(4, '0'); }

    const API = { MAX_3D, identity, fromFunction, trilinear, parseCube, pack, unpack, newId };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Luts = API;
    }
})();
