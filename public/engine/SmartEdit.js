/**
 * ForgeCut — Smart Edit engine (silence removal, scene detection).
 *
 * Pure analysis and timeline arithmetic. Nothing here touches the DOM, the
 * history stack or an AudioContext: callers hand in sample arrays or plain
 * track data and get spans or new track data back. That keeps the hard part —
 * cutting a range out of every track while keeping linked clips, trims,
 * speed and keyframes coherent — testable in node, and lets both shells put
 * their own UI on top.
 *
 * All times are seconds on the timeline unless a name says otherwise.
 */
(function () {
    'use strict';

    const EPS = 1e-6;

    // ── Silence detection ────────────────────────────────────────────────

    const SILENCE_DEFAULTS = {
        thresholdDb: -40,   // RMS below this (dBFS) counts as silent
        minDuration: 0.5,   // shorter gaps are natural pauses, keep them
        padding: 0.1,       // leave this much breathing room either side
        windowMs: 20        // analysis window
    };

    /** Average channels into one mono Float32Array. */
    function mixToMono(channels) {
        if (!channels || channels.length === 0) return new Float32Array(0);
        if (channels.length === 1) return channels[0];
        const n = Math.min(...channels.map(c => c.length));
        const out = new Float32Array(n);
        for (const ch of channels) {
            for (let i = 0; i < n; i++) out[i] += ch[i];
        }
        const k = 1 / channels.length;
        for (let i = 0; i < n; i++) out[i] *= k;
        return out;
    }

    /** RMS per window, in dBFS (-Infinity for digital silence). */
    function rmsEnvelope(samples, sampleRate, windowMs) {
        const win = Math.max(1, Math.round(sampleRate * (windowMs || SILENCE_DEFAULTS.windowMs) / 1000));
        const count = Math.ceil(samples.length / win);
        const db = new Float32Array(count);
        for (let w = 0; w < count; w++) {
            const a = w * win;
            const b = Math.min(samples.length, a + win);
            let sum = 0;
            for (let i = a; i < b; i++) sum += samples[i] * samples[i];
            const rms = Math.sqrt(sum / Math.max(1, b - a));
            db[w] = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
        }
        return { db, windowSeconds: win / sampleRate };
    }

    /**
     * Find silent spans in a mono signal.
     * Returns [{start, end}] already shrunk by `padding`, sorted, non-empty.
     */
    function findSilences(samples, sampleRate, opts) {
        const o = Object.assign({}, SILENCE_DEFAULTS, opts || {});
        if (!(sampleRate > 0)) throw new Error('findSilences: sampleRate must be positive');
        if (!Number.isFinite(o.thresholdDb)) throw new Error('findSilences: thresholdDb must be a number');
        if (!(o.minDuration >= 0) || !(o.padding >= 0)) throw new Error('findSilences: minDuration and padding must be >= 0');

        const { db, windowSeconds } = rmsEnvelope(samples, sampleRate, o.windowMs);
        const total = samples.length / sampleRate;
        const spans = [];
        let runStart = -1;
        const flush = (endIdx) => {
            const start = runStart * windowSeconds;
            const end = Math.min(total, endIdx * windowSeconds);
            if (end - start + EPS >= o.minDuration) {
                // Padding is not applied at the very edges of the signal:
                // there is nothing to breathe into before t=0 or after the end.
                const s = start <= EPS ? 0 : start + o.padding;
                const e = end >= total - EPS ? total : end - o.padding;
                if (e - s > EPS) spans.push({ start: s, end: e });
            }
            runStart = -1;
        };
        for (let w = 0; w < db.length; w++) {
            if (db[w] < o.thresholdDb) {
                if (runStart < 0) runStart = w;
            } else if (runStart >= 0) {
                flush(w);
            }
        }
        if (runStart >= 0) flush(db.length);
        return spans;
    }

    /** Merge overlapping/touching spans and clamp to [0, max]. */
    function normaliseSpans(spans, max) {
        const sorted = (spans || [])
            .map(s => ({ start: Math.max(0, +s.start), end: max != null ? Math.min(max, +s.end) : +s.end }))
            .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start > EPS)
            .sort((a, b) => a.start - b.start);
        const out = [];
        for (const s of sorted) {
            const last = out[out.length - 1];
            if (last && s.start <= last.end + EPS) last.end = Math.max(last.end, s.end);
            else out.push({ start: s.start, end: s.end });
        }
        return out;
    }

    /** Parts of `spans` that also fall inside `within`. */
    function intersectSpans(spans, within) {
        const a = normaliseSpans(spans), b = normaliseSpans(within);
        const out = [];
        let i = 0, j = 0;
        while (i < a.length && j < b.length) {
            const s = Math.max(a[i].start, b[j].start);
            const e = Math.min(a[i].end, b[j].end);
            if (e - s > EPS) out.push({ start: s, end: e });
            if (a[i].end < b[j].end) i++; else j++;
        }
        return out;
    }

    function totalLength(spans) {
        return spans.reduce((n, s) => n + (s.end - s.start), 0);
    }

    // ── Range ripple delete ──────────────────────────────────────────────

    function cloneClip(c) {
        const copy = Object.assign({}, c);
        if (c.keyframes) {
            copy.keyframes = {};
            for (const k of Object.keys(c.keyframes)) {
                copy.keyframes[k] = (c.keyframes[k] || []).map(f => Object.assign({}, f));
            }
        }
        if (Array.isArray(c.effects)) {
            copy.effects = c.effects.map(e => Object.assign({}, e, { params: Object.assign({}, e.params) }));
        }
        return copy;
    }

    /**
     * Cut `[start, end)` out of one clip. Returns the surviving pieces
     * (0, 1 or 2) positioned as if the range had been rippled out.
     */
    function cutClip(clip, start, end, makeId) {
        const cs = clip.startTime;
        const ce = clip.startTime + clip.duration;
        const len = end - start;
        if (end <= cs + EPS) {
            // Entirely after the cut: just slide left.
            const c = cloneClip(clip);
            c.startTime = Math.max(0, cs - len);
            return [c];
        }
        if (start >= ce - EPS) return [cloneClip(clip)];   // entirely before

        const speed = clip.playbackSpeed || 1;
        const pieces = [];
        if (start > cs + EPS) {
            const head = cloneClip(clip);
            head.duration = start - cs;
            head.fadeOut = 0;
            pieces.push(head);
        }
        if (end < ce - EPS) {
            const offset = end - cs;                         // timeline seconds into the clip
            const tail = cloneClip(clip);
            tail.id = pieces.length ? makeId(clip.id) : clip.id;
            tail.startTime = start;                          // rippled: lands where the cut began
            tail.duration = ce - end;
            tail.trimStart = (clip.trimStart || 0) + offset * speed;
            if (tail.keyframes) {
                for (const k of Object.keys(tail.keyframes)) {
                    tail.keyframes[k].forEach(f => { f.time -= offset; });
                }
            }
            if (pieces.length) {                             // a continuation, not a new entrance
                tail.fadeIn = 0;
                delete tail.transition;
                delete tail.transitionDuration;
                delete tail.transitionDirection;
                delete tail.transitionSound;
            }
            pieces.push(tail);
        }
        return pieces;
    }

    /**
     * Remove every range from the timeline and close the gaps, on all tracks
     * that are not locked. Locked tracks are left exactly as they were — the
     * same rule ripple delete already follows.
     *
     *   rippleDeleteRanges(tracks, [{start, end}], { locked: {trackId: true} })
     *     → { tracks, removed, linkedBroken }
     *
     * Returns new track objects; the input is not mutated.
     */
    function rippleDeleteRanges(tracks, ranges, opts) {
        const o = opts || {};
        const locked = o.locked || {};
        let seq = 0;
        const makeId = o.makeId || ((base) => `${base}_cut${Date.now().toString(36)}${(seq++).toString(36)}`);
        const spans = normaliseSpans(ranges);

        // Remember which ids were linked so pieces can be re-paired afterwards.
        const pairs = [];
        const seen = new Set();
        tracks.forEach(t => t.clips.forEach(c => {
            if (c.linkedClipId && !seen.has(c.id)) {
                seen.add(c.id); seen.add(c.linkedClipId);
                pairs.push([c.id, c.linkedClipId]);
            }
        }));

        const origin = new Map();     // new piece id → original clip id
        let out = tracks.map(t => Object.assign({}, t, {
            clips: t.clips.map(c => { origin.set(c.id, c.id); return cloneClip(c); })
        }));

        // Last span first, so earlier spans keep their original coordinates.
        for (let i = spans.length - 1; i >= 0; i--) {
            const { start, end } = spans[i];
            out = out.map(t => {
                if (locked[t.id]) return t;
                const clips = [];
                t.clips.forEach(c => {
                    cutClip(c, start, end, makeId).forEach(p => {
                        origin.set(p.id, origin.get(c.id) || c.id);
                        clips.push(p);
                    });
                });
                return Object.assign({}, t, { clips });
            });
        }

        // Re-pair linked clips piece by piece, by matching timeline position.
        const byOrigin = new Map();
        out.forEach(t => t.clips.forEach(c => {
            const k = origin.get(c.id) || c.id;
            if (!byOrigin.has(k)) byOrigin.set(k, []);
            byOrigin.get(k).push(c);
        }));
        let linkedBroken = 0;
        for (const [a, b] of pairs) {
            const pa = (byOrigin.get(a) || []).sort((x, y) => x.startTime - y.startTime);
            const pb = (byOrigin.get(b) || []).sort((x, y) => x.startTime - y.startTime);
            const aligned = pa.length === pb.length &&
                pa.every((c, i) => Math.abs(c.startTime - pb[i].startTime) < 1e-3);
            if (aligned) {
                pa.forEach((c, i) => { c.linkedClipId = pb[i].id; pb[i].linkedClipId = c.id; });
            } else {
                // Only one side moved (e.g. its partner sits on a locked
                // track). Keeping the link would make the next linked edit
                // act on a clip that no longer lines up.
                pa.forEach(c => { if (c.linkedClipId) { delete c.linkedClipId; linkedBroken++; } });
                pb.forEach(c => { if (c.linkedClipId) { delete c.linkedClipId; linkedBroken++; } });
            }
        }

        return { tracks: out, removed: totalLength(spans), linkedBroken };
    }

    /**
     * Split one clip (and its linked partner, if it lines up) at several
     * timeline times, without moving anything. Times outside the clip are
     * ignored.  → { tracks, pieces }  where pieces is how many clips the
     * target became. Input is not mutated.
     */
    function splitTracksAt(tracks, clipId, times, opts) {
        const o = opts || {};
        const locked = o.locked || {};
        let seq = 0;
        const makeId = o.makeId || ((base) => `${base}_s${Date.now().toString(36)}${(seq++).toString(36)}`);
        let target = null, partner = null;
        tracks.forEach(t => t.clips.forEach(c => { if (c.id === clipId) target = { t, c }; }));
        if (!target || locked[target.t.id]) return { tracks, pieces: 0 };
        if (target.c.linkedClipId) {
            tracks.forEach(t => t.clips.forEach(c => { if (c.id === target.c.linkedClipId) partner = { t, c }; }));
            if (partner && (locked[partner.t.id] ||
                Math.abs(partner.c.startTime - target.c.startTime) > 1e-3 ||
                Math.abs(partner.c.duration - target.c.duration) > 1e-3)) partner = null;
        }
        const cs = target.c.startTime, ce = cs + target.c.duration;
        const cuts = [...new Set((times || []).filter(x => x > cs + 1e-3 && x < ce - 1e-3))].sort((a, b) => a - b);
        if (!cuts.length) return { tracks, pieces: 1 };

        const piecesOf = (clip) => {
            const out = [];
            let cur = cloneClip(clip);
            for (const at of cuts) {
                const r = cutClip(cur, at, at, () => makeId(clip.id));   // zero-length cut = split
                out.push(r[0]);
                cur = r[1];
            }
            out.push(cur);
            return out;
        };
        const a = piecesOf(target.c);
        const b = partner ? piecesOf(partner.c) : null;
        if (b) a.forEach((p, i) => { p.linkedClipId = b[i].id; b[i].linkedClipId = p.id; });
        else a.slice(1).forEach(p => { delete p.linkedClipId; });   // the partner still points at the head

        const out = tracks.map(t => {
            if (t === target.t || (partner && t === partner.t)) {
                const clips = [];
                t.clips.forEach(c => {
                    if (c.id === target.c.id) clips.push(...a);
                    else if (b && c.id === partner.c.id) clips.push(...b);
                    else clips.push(cloneClip(c));
                });
                return Object.assign({}, t, { clips });
            }
            return t;
        });
        return { tracks: out, pieces: a.length };
    }

    // ── Scene detection ──────────────────────────────────────────────────

    const SCENE_DEFAULTS = { threshold: 0.3, minGap: 0.5 };

    /** Validate a scene threshold for use in an FFmpeg filter expression. */
    function validateSceneThreshold(v) {
        const n = typeof v === 'string' && /^\s*\d*\.?\d+\s*$/.test(v) ? parseFloat(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n >= 1) {
            throw new Error('Scene threshold must be a number between 0 and 1 (exclusive)');
        }
        return Math.round(n * 1000) / 1000;
    }

    /** Pull `pts_time` values out of FFmpeg `showinfo` stderr. */
    function parseShowinfo(text) {
        const times = [];
        const re = /\[Parsed_showinfo[^\]]*\][^\n]*?pts_time:\s*(-?\d+(?:\.\d+)?)/g;
        let m;
        while ((m = re.exec(String(text || '')))) {
            const t = parseFloat(m[1]);
            if (Number.isFinite(t) && t >= 0) times.push(t);
        }
        return times.sort((a, b) => a - b);
    }

    /**
     * Mean absolute luma difference between two RGBA frames of equal size,
     * scaled to 0..1. Used by the browser fallback when no FFmpeg server is
     * reachable.
     */
    function frameDifference(a, b) {
        if (!a || !b || a.length !== b.length || a.length < 4) return 0;
        let sum = 0, n = 0;
        for (let i = 0; i < a.length; i += 4) {
            const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
            const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
            sum += Math.abs(la - lb);
            n++;
        }
        return sum / (n * 255);
    }

    /**
     * Turn per-sample differences into cut times.
     *   samples: [{time, diff}] in time order; diff is the change INTO `time`.
     */
    function pickSceneCuts(samples, opts) {
        const o = Object.assign({}, SCENE_DEFAULTS, opts || {});
        const cuts = [];
        for (const s of samples || []) {
            if (!(s.diff >= o.threshold)) continue;
            const last = cuts[cuts.length - 1];
            if (last != null && s.time - last < o.minGap) continue;
            cuts.push(s.time);
        }
        return cuts;
    }

    /** Drop cuts that are too close together or to the clip edges. */
    function dedupeCuts(times, minGap, duration) {
        const gap = minGap != null ? minGap : SCENE_DEFAULTS.minGap;
        const out = [];
        [...(times || [])].sort((a, b) => a - b).forEach(t => {
            if (t < gap - EPS) return;
            if (duration != null && t > duration - gap + EPS) return;
            if (out.length && t - out[out.length - 1] < gap) return;
            out.push(t);
        });
        return out;
    }

    const API = {
        SILENCE_DEFAULTS, SCENE_DEFAULTS,
        mixToMono, rmsEnvelope, findSilences, normaliseSpans, intersectSpans, totalLength,
        cutClip, rippleDeleteRanges, splitTracksAt,
        validateSceneThreshold, parseShowinfo, frameDifference, pickSceneCuts, dedupeCuts
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    }
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.SmartEdit = API;
    }
})();
