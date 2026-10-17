/**
 * ForgeCut — the ONE mapping from timeline time to source time.
 *
 * A clip's speed is either constant (clip.playbackSpeed) or a curve
 * (clip.keyframes.playbackSpeed). The source position at clip-local time t is
 *
 *     trimStart + ∫₀ᵗ speed(τ) dτ
 *
 * That integral used to be approximated differently in different places, or
 * not at all: preview multiplied by a constant speed for playbackRate but
 * seeked as if speed were 1, export folded in a constant speed, the offline
 * audio mix ignored speed entirely, and split/cut moved trimStart by
 * timeline time. A speed ramp would have made all four disagree. Everything
 * now asks this file, and the integral is exact (closed-form per segment,
 * including eased segments), so the constant-speed case is a special case
 * rather than a separate code path.
 *
 * Keyframe interpolation lives here too, so an eased keyframe means the same
 * thing to the renderer (getInterpolatedValue) as to the speed integral.
 *
 * Pure: node and browser.
 */
(function () {
    'use strict';

    const MIN_SPEED = 0.05, MAX_SPEED = 16;

    /**
     * Easing of the segment that STARTS at a keyframe ({ ease } on that
     * keyframe). Each has a closed-form antiderivative on [0, 1].
     */
    const EASES = {
        linear: { f: u => u, F: u => u * u / 2 },
        smooth: { f: u => u * u * (3 - 2 * u), F: u => u * u * u - u * u * u * u / 2 },
        easeIn: { f: u => u * u, F: u => u * u * u / 3 },
        easeOut: { f: u => 1 - (1 - u) * (1 - u), F: u => u * u - u * u * u / 3 }
    };
    const easeOf = (k) => EASES[k && k.ease] || EASES.linear;

    function sorted(list) {
        if (!Array.isArray(list) || list.length === 0) return null;
        let ok = true;
        for (let i = 1; i < list.length; i++) if (list[i].time < list[i - 1].time) { ok = false; break; }
        return ok ? list : list.slice().sort((a, b) => a.time - b.time);
    }

    /** Value of a keyframed property at time t (clip-local seconds). */
    function interpolate(keyframes, t, fallback) {
        const k = sorted(keyframes);
        if (!k) return fallback;
        if (t <= k[0].time) return k[0].value;
        if (t >= k[k.length - 1].time) return k[k.length - 1].value;
        for (let i = 0; i < k.length - 1; i++) {
            const a = k[i], b = k[i + 1];
            if (t >= a.time && t <= b.time) {
                const span = b.time - a.time;
                if (!(span > 0)) return b.value;
                return a.value + (b.value - a.value) * easeOf(a).f((t - a.time) / span);
            }
        }
        return fallback;
    }

    /** Exact ∫ of the keyframed value from t0 to t1 (t0 ≤ t1). */
    function integrate(keyframes, t0, t1, fallback) {
        if (!(t1 > t0)) return 0;
        const k = sorted(keyframes);
        if (!k) return (fallback == null ? 1 : fallback) * (t1 - t0);
        let sum = 0;
        // Before the first keyframe: held at its value.
        const first = k[0], last = k[k.length - 1];
        if (t0 < first.time) {
            const e = Math.min(t1, first.time);
            sum += first.value * (e - t0);
        }
        for (let i = 0; i < k.length - 1; i++) {
            const a = k[i], b = k[i + 1];
            const s = Math.max(t0, a.time), e = Math.min(t1, b.time);
            if (!(e > s)) continue;
            const span = b.time - a.time;
            if (!(span > 0)) continue;
            const F = easeOf(a).F;
            const u0 = (s - a.time) / span, u1 = (e - a.time) / span;
            sum += a.value * (e - s) + (b.value - a.value) * span * (F(u1) - F(u0));
        }
        // After the last keyframe: held at its value.
        if (t1 > last.time) {
            const s = Math.max(t0, last.time);
            sum += last.value * (t1 - s);
        }
        return sum;
    }

    function speedKeyframes(clip) {
        const k = clip && clip.keyframes && !Array.isArray(clip.keyframes) && clip.keyframes.playbackSpeed;
        return k && k.length ? k : null;
    }

    function baseSpeed(clip) {
        const s = clip && clip.playbackSpeed;
        return s > 0 ? s : 1;
    }

    const clampSpeed = (s) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));

    /** Speed at clip-local time t. */
    function speedAt(clip, t) {
        const k = speedKeyframes(clip);
        return clampSpeed(k ? interpolate(k, t, baseSpeed(clip)) : baseSpeed(clip));
    }

    /** Source seconds consumed between clip-local 0 and t. */
    function sourceOffset(clip, t) {
        if (!(t > 0)) return 0;
        const k = speedKeyframes(clip);
        return k ? integrate(k, 0, t, baseSpeed(clip)) : baseSpeed(clip) * t;
    }

    /** Source time (seconds into the media file) at clip-local time t. */
    function sourceTime(clip, t) {
        return (clip.trimStart || 0) + sourceOffset(clip, t);
    }

    /** How much source a clip consumes over its whole duration. */
    function sourceSpan(clip) {
        return sourceOffset(clip, clip.duration || 0);
    }

    /**
     * Clip-local time at which the clip reaches source time `src`. Speed is
     * always positive, so sourceTime is strictly increasing and bisection is
     * exact to the tolerance. Returns null outside the clip's source range.
     */
    function localTimeForSource(clip, src) {
        const lo0 = sourceTime(clip, 0), hi0 = sourceTime(clip, clip.duration || 0);
        if (src < lo0 - 1e-9 || src > hi0 + 1e-9) return null;
        if (!speedKeyframes(clip)) return (src - lo0) / baseSpeed(clip);
        let lo = 0, hi = clip.duration || 0;
        for (let i = 0; i < 60 && hi - lo > 1e-7; i++) {
            const mid = (lo + hi) / 2;
            if (sourceTime(clip, mid) < src) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    /**
     * Breakpoints for driving an AudioParam (AudioBufferSourceNode.playbackRate)
     * so the offline mix follows the same curve: exact at every keyframe,
     * with linear segments as-is and eased segments subdivided.
     * → [{ time (clip-local), rate }]
     */
    function rateSchedule(clip, steps) {
        const k = speedKeyframes(clip), dur = clip.duration || 0;
        if (!k) return [{ time: 0, rate: speedAt(clip, 0) }];
        const n = steps || 24;
        const times = new Set([0, dur]);
        const s = sorted(k);
        for (let i = 0; i < s.length; i++) {
            if (s[i].time > 0 && s[i].time < dur) times.add(s[i].time);
            if (i < s.length - 1 && easeOf(s[i]) !== EASES.linear) {
                for (let j = 1; j < n; j++) {
                    const t = s[i].time + (s[i + 1].time - s[i].time) * j / n;
                    if (t > 0 && t < dur) times.add(t);
                }
            }
        }
        return [...times].sort((a, b) => a - b).map(t => ({ time: t, rate: speedAt(clip, t) }));
    }

    /**
     * Ramp presets as normalised points (0..1 across the clip) — turned into
     * playbackSpeed keyframes in clip-local seconds by applyPreset().
     */
    const PRESETS = {
        none: { label: 'None (constant)', points: null },
        rampUp: { label: 'Ramp Up', points: [[0, 1], [1, 3]] },
        rampDown: { label: 'Ramp Down', points: [[0, 3], [1, 1]] },
        hero: { label: 'Hero (slow-mo middle)', points: [[0, 1.5], [0.4, 0.3], [0.6, 0.3], [1, 1.5]] },
        bullet: { label: 'Bullet', points: [[0, 2.5], [0.45, 0.2], [0.55, 0.2], [1, 2.5]] },
        montage: { label: 'Montage', points: [[0, 3], [0.5, 0.8], [1, 3]] },
        jump: { label: 'Jump Cut Pulse', points: [[0, 1], [0.3, 1], [0.35, 4], [0.65, 4], [0.7, 1], [1, 1]] }
    };

    function presetKeyframes(name, duration, ease) {
        const p = PRESETS[name];
        if (!p || !p.points) return null;
        return p.points.map(([u, v]) => ({ time: Math.round(u * duration * 1000) / 1000, value: clampSpeed(v), ease: ease || 'smooth' }));
    }

    /**
     * Longest clip duration (seconds) whose source span fits in `available`
     * seconds of media, for keyframes given as normalised positions. Used so
     * a ramp never runs off the end of the media.
     */
    function fitDuration(normPoints, available, maxDuration, ease) {
        const span = (d) => integrate(normPoints.map(([u, v]) => ({ time: u * d, value: clampSpeed(v), ease: ease || 'smooth' })), 0, d, 1);
        if (span(maxDuration) <= available + 1e-9) return maxDuration;
        let lo = 0, hi = maxDuration;
        for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (span(m) <= available) lo = m; else hi = m; }
        return lo;
    }

    const API = {
        MIN_SPEED, MAX_SPEED, EASES, PRESETS,
        interpolate, integrate, speedAt, sourceOffset, sourceTime, sourceSpan, localTimeForSource,
        rateSchedule, presetKeyframes, fitDuration, clampSpeed
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.TimeMap = API;
    }
})();
