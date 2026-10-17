/**
 * ForgeCut — Captions engine.
 *
 * Turns timed words (from Whisper, or from an imported SRT/VTT file) into
 * ordinary text clips. Captions deliberately add nothing to the renderer: a
 * caption is a text clip like any other, so it previews, exports and edits
 * exactly as hand-made text does.
 *
 * Pure: no DOM, no network, no model. The transcription itself lives in
 * engine/workers/transcribe-worker.js.
 */
(function () {
    'use strict';

    /* ── parsing ─────────────────────────────────────────────────────── */

    /** "00:01:02,345" | "01:02.345" | "62.3" → seconds */
    function parseTimestamp(s) {
        const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
        if (!m) {
            const n = Number(s);
            if (Number.isFinite(n)) return n;
            throw new Error(`Bad timestamp "${s}"`);
        }
        const h = +(m[1] || 0), min = +m[2], sec = +m[3];
        const ms = m[4] ? +(m[4] + '00').slice(0, 3) : 0;
        return h * 3600 + min * 60 + sec + ms / 1000;
    }

    function cleanCueText(t) {
        return t
            .replace(/<[^>]*>/g, '')          // VTT voice/style tags, SRT <i>
            .replace(/\{\\[^}]*\}/g, '')      // ASS-style overrides some SRTs carry
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** SRT or WebVTT text → [{start, end, text}] */
    function parseSubtitles(src) {
        const text = String(src || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
        const blocks = text.split(/\n{2,}/);
        const cues = [];
        for (const block of blocks) {
            const lines = block.split('\n').filter(l => l.trim() !== '');
            const i = lines.findIndex(l => l.includes('-->'));
            if (i < 0) continue;                       // WEBVTT header, NOTE, STYLE, index-only
            const [a, b] = lines[i].split('-->');
            const end = String(b).trim().split(/\s+/)[0];   // drop VTT cue settings
            let start, stop;
            try { start = parseTimestamp(a); stop = parseTimestamp(end); } catch (e) { continue; }
            const body = cleanCueText(lines.slice(i + 1).join(' '));
            if (!body || !(stop > start)) continue;
            cues.push({ start, end: stop, text: body });
        }
        return cues.sort((p, q) => p.start - q.start);
    }

    /* ── words ───────────────────────────────────────────────────────── */

    /**
     * Split cues into words. A cue that is already one word keeps its exact
     * timing; longer cues share their span in proportion to word length,
     * which is close enough for display when the source has no word timing.
     */
    function cuesToWords(cues) {
        const words = [];
        for (const c of cues || []) {
            const parts = String(c.text).trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) continue;
            if (parts.length === 1) { words.push({ start: c.start, end: c.end, text: parts[0], cueStart: true }); continue; }
            const weights = parts.map(p => p.length + 1);
            const total = weights.reduce((n, w) => n + w, 0);
            let t = c.start;
            parts.forEach((p, i) => {
                const d = (c.end - c.start) * weights[i] / total;
                words.push(i === 0 ? { start: t, end: t + d, text: p, cueStart: true } : { start: t, end: t + d, text: p });
                t += d;
            });
        }
        return words;
    }

    /**
     * transformers.js ASR output with return_timestamps:'word' →
     * [{start, end, text}]. Chunks with a null end (the last word of a
     * window) borrow the next start, or a short default.
     */
    function wordsFromChunks(chunks, offset) {
        const off = offset || 0;
        const out = [];
        (chunks || []).forEach((c, i) => {
            const ts = c.timestamp || [];
            const text = String(c.text || '').trim();
            if (!text || ts[0] == null) return;
            let end = ts[1];
            if (end == null || !(end > ts[0])) {
                const next = chunks[i + 1];
                end = next && next.timestamp && next.timestamp[0] > ts[0] ? next.timestamp[0] : ts[0] + 0.3;
            }
            out.push({ start: ts[0] + off, end: end + off, text });
        });
        return out;
    }

    /* ── grouping ────────────────────────────────────────────────────── */

    const GROUP_DEFAULTS = { maxWords: 3, maxChars: 18, maxGap: 0.6, minDuration: 0.25 };

    /**
     * Group words into on-screen captions. Short-form style is 1–3 words at a
     * time; a pause or sentence end always starts a new caption.
     */
    function groupWords(words, opts) {
        const o = Object.assign({}, GROUP_DEFAULTS, opts || {});
        const pages = [];
        let cur = null;
        const flush = () => { if (cur) { pages.push(cur); cur = null; } };
        for (const w of words || []) {
            if (cur) {
                const text = cur.text + ' ' + w.text;
                const gap = w.start - cur.end;
                // A subtitle author's cue boundary is never merged across.
                if (w.cueStart || cur.words.length >= o.maxWords || text.length > o.maxChars || gap > o.maxGap) flush();
            }
            if (!cur) cur = { start: w.start, end: w.end, text: w.text, words: [w] };
            else { cur.text += ' ' + w.text; cur.end = w.end; cur.words.push(w); }
            if (/[.!?…]["')\]]?$/.test(w.text)) flush();
        }
        flush();
        // No overlaps, and nothing too brief to read: stretch into the gap
        // before the next caption where there is room.
        for (let i = 0; i < pages.length; i++) {
            const next = pages[i + 1];
            if (next && pages[i].end > next.start) pages[i].end = next.start;
            if (pages[i].end - pages[i].start < o.minDuration) {
                const limit = next ? next.start : Infinity;
                pages[i].end = Math.min(limit, pages[i].start + o.minDuration);
            }
        }
        return pages.filter(p => p.end > p.start);
    }

    /* ── styles and clips ────────────────────────────────────────────── */

    const STYLES = {
        bold: {
            label: 'Bold Pop', font: 'Arial', fontWeight: 'bold', sizeRatio: 0.06, color: '#ffffff',
            strokeColor: '#000000', textStrokeWidth: 10, yRatio: 0.72, uppercase: true,
            animation: { entrance: 'Zoom In', duration: '0.12', easing: 'easeOutBack' }
        },
        clean: {
            label: 'Clean', font: 'Arial', fontWeight: '600', sizeRatio: 0.045, color: '#ffffff',
            textShadow: true, shadowColor: 'rgba(0,0,0,0.8)', shadowBlur: 12, shadowOffsetX: 0, shadowOffsetY: 3,
            yRatio: 0.8, uppercase: false, animation: null
        },
        boxed: {
            label: 'Boxed', font: 'Arial', fontWeight: 'bold', sizeRatio: 0.045, color: '#ffffff',
            textBackground: 'rgba(0,0,0,0.65)', textBackgroundPadding: 18, yRatio: 0.78, uppercase: false,
            animation: { entrance: 'Fade In', duration: '0.1', easing: 'easeOut' }
        },
        highlight: {
            label: 'Highlight', font: 'Arial', fontWeight: 'bold', sizeRatio: 0.065, color: '#FFE600',
            strokeColor: '#000000', textStrokeWidth: 12, yRatio: 0.66, uppercase: true,
            animation: { entrance: 'Zoom In', duration: '0.1', easing: 'easeOutBack' }
        }
    };

    /**
     * Pages → text clip objects for the caption track. Every caption carries
     * `captionGroup` so the whole set can be restyled or removed together.
     */
    function buildCaptionClips(pages, opts) {
        const o = opts || {};
        const style = STYLES[o.style] || STYLES.bold;
        const W = o.canvasWidth || 1080, H = o.canvasHeight || 1920;
        const group = o.group || ('cap_' + Date.now().toString(36));
        const short = Math.min(W, H);
        let seq = 0;
        return (pages || []).map(p => {
            const clip = {
                id: `${group}_${(seq++).toString(36)}`,
                name: 'Caption',
                captionGroup: group,
                captionStyle: o.style in STYLES ? o.style : 'bold',
                text: style.uppercase ? p.text.toUpperCase() : p.text,
                captionSource: p.text,          // as spoken, so a restyle can restore case
                startTime: Math.max(0, p.start),
                duration: Math.max(0.05, p.end - p.start),
                x: W / 2,
                y: Math.round(H * style.yRatio),
                font: style.font,
                fontWeight: style.fontWeight,
                size: Math.round(short * style.sizeRatio * (H > W ? 1.6 : 1)),
                color: style.color,
                textAlign: 'center',
                maxWidth: Math.round(W * 0.86),
                rotation: 0,
                opacity: 1
            };
            ['strokeColor', 'textStrokeWidth', 'textShadow', 'shadowColor', 'shadowBlur', 'shadowOffsetX',
             'shadowOffsetY', 'textBackground', 'textBackgroundPadding'].forEach(k => {
                if (style[k] !== undefined) clip[k] = style[k];
            });
            if (style.animation) clip.animations = Object.assign({ delay: '0', loopCount: 1 }, style.animation);
            return clip;
        });
    }

    /**
     * Text for a caption after switching style. Unedited captions are rebuilt
     * from their source words; anything the user retyped is kept as typed.
     */
    function restyledText(clip, newStyle) {
        const src = clip.captionSource;
        const old = STYLES[clip.captionStyle] || STYLES.bold;
        const next = STYLES[newStyle] || STYLES.bold;
        if (src == null) return clip.text;
        const untouched = clip.text === (old.uppercase ? src.toUpperCase() : src);
        if (!untouched) return clip.text;
        return next.uppercase ? src.toUpperCase() : src;
    }

    /* ── export ──────────────────────────────────────────────────────── */

    function fmtSrtTime(t) {
        const ms = Math.max(0, Math.round(t * 1000));
        const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
        const pad = (n, w) => String(n).padStart(w, '0');
        return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
    }

    /** Caption clips (or pages) → SRT text. */
    function toSRT(items) {
        return (items || [])
            .map(c => ({ start: c.startTime != null ? c.startTime : c.start,
                         end: c.startTime != null ? c.startTime + c.duration : c.end, text: c.text }))
            .sort((a, b) => a.start - b.start)
            .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`)
            .join('\n');
    }

    /* ── hosted transcription helpers ────────────────────────────────── */

    /**
     * Split mono audio into chunks of at most `maxSec`, cutting at the
     * quietest 50 ms within the last `searchSec` of each window so a cut never
     * lands mid-word. → [{ start, end }] in samples, contiguous and covering
     * everything.
     */
    function planChunks(samples, sampleRate, maxSec, searchSec) {
        const max = Math.floor((maxSec || 110) * sampleRate);
        const search = Math.floor((searchSec || 8) * sampleRate);
        const win = Math.max(1, Math.floor(0.05 * sampleRate));
        const out = [];
        let start = 0;
        while (samples.length - start > max) {
            const hardEnd = start + max;
            let best = hardEnd, bestE = Infinity;
            for (let w = Math.max(start + 1, hardEnd - search); w + win <= hardEnd; w += win) {
                let e = 0;
                for (let i = w; i < w + win; i++) e += samples[i] * samples[i];
                if (e < bestE) { bestE = e; best = w + (win >> 1); }
            }
            out.push({ start, end: best });
            start = best;
        }
        out.push({ start, end: samples.length });
        return out.filter(c => c.end > c.start);
    }

    /** Float mono samples → 16-bit PCM WAV bytes. */
    function encodeWav16(samples, sampleRate) {
        const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
        w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return new Uint8Array(buf);
    }

    /**
     * Words from a hosted response chunk: word-level chunks pass through;
     * segment-level ones are spread across their words like an SRT cue.
     */
    function wordsFromHosted(resp, offset) {
        const off = offset || 0;
        if (!resp || !Array.isArray(resp.chunks)) return [];
        if (resp.granularity === 'word') return wordsFromChunks(resp.chunks, off);
        const cues = resp.chunks.map((c, i) => {
            const s = c.timestamp[0];
            let e = c.timestamp[1];
            if (e == null || !(e > s)) { const nx = resp.chunks[i + 1]; e = nx && nx.timestamp[0] > s ? nx.timestamp[0] : s + 2; }
            return { start: s + off, end: e + off, text: String(c.text).trim() };
        });
        return cuesToWords(cues);
    }

    const API = {
        STYLES, GROUP_DEFAULTS, planChunks, encodeWav16, wordsFromHosted,
        parseTimestamp, parseSubtitles, cuesToWords, wordsFromChunks, groupWords, buildCaptionClips, restyledText, toSRT
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.Captions = API;
    }
})();
