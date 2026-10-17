/**
 * ForgeCut editor — effect stack commands.
 *
 * Shared by both shells; each shell draws its own controls and calls these.
 * Every edit is one undo step: discrete edits via withHistory, slider drags
 * via commitGesture when the drag ends.
 */
(function () {
    'use strict';

    const FX = () => window.ForgeCut && window.ForgeCut.Effects;

    function refresh(full) {
        renderCanvasComposition();
        if (full) {
            if (typeof updateInspector === 'function') updateInspector();
            if (window.MacUI && window.MacUI.renderInspector) window.MacUI.renderInspector();
        }
    }

    function find(clipId, fxId) {
        const clip = findClipById(clipId);
        const fx = clip && Array.isArray(clip.effects) ? clip.effects.find(e => e.id === fxId) : null;
        return { clip, fx };
    }

    function locked(clip) {
        const track = clip && state.tracks.find(t => t.clips.includes(clip));
        return !track || (state.trackLock && state.trackLock[track.id]);
    }

    /** The value a param has at the playhead (keyframes included). */
    window.fxValue = function (clip, fx, param) {
        const base = fx.params[param];
        return window.getInterpolatedValue(clip, FX().keyFor(fx, param), base);
    };

    window.fxAdd = function (clipId, type) {
        const clip = findClipById(clipId);
        if (!clip || !FX() || !FX().EFFECTS[type] || locked(clip)) return;
        withHistory(`Add ${FX().EFFECTS[type].label}`, () => {
            clip.effects = FX().normaliseEffects(clip.effects || []);
            clip.effects.push(FX().createEffect(type));
        });
        refresh(true);
    };

    window.fxRemove = function (clipId, fxId) {
        const { clip, fx } = find(clipId, fxId);
        if (!fx || locked(clip)) return;
        withHistory('Remove Effect', () => {
            clip.effects = clip.effects.filter(e => e !== fx);
            // Its keyframes would otherwise linger, addressed to nothing.
            if (clip.keyframes) {
                Object.keys(clip.keyframes).forEach(k => { if (k.startsWith(`fx.${fx.id}.`)) delete clip.keyframes[k]; });
            }
        });
        refresh(true);
    };

    window.fxToggle = function (clipId, fxId) {
        const { clip, fx } = find(clipId, fxId);
        if (!fx || locked(clip)) return;
        withHistory(fx.enabled ? 'Disable Effect' : 'Enable Effect', () => { fx.enabled = !fx.enabled; });
        refresh(true);
    };

    /** Order is meaningful (grade-then-blur ≠ blur-then-grade), so it is explicit. */
    window.fxMove = function (clipId, fxId, delta) {
        const { clip, fx } = find(clipId, fxId);
        if (!fx || locked(clip)) return;
        const i = clip.effects.indexOf(fx), j = i + delta;
        if (j < 0 || j >= clip.effects.length) return;
        withHistory('Reorder Effects', () => {
            clip.effects.splice(i, 1);
            clip.effects.splice(j, 0, fx);
        });
        refresh(true);
    };

    // Slider drags: mutate live on 'input', commit one undo step on 'change'.
    const drag = {};

    /** Where a param edit should land: the keyframe at the playhead, or the base value. */
    function target(clip, fx, param) {
        const key = FX().keyFor(fx, param);
        const list = clip.keyframes && clip.keyframes[key];
        if (list && list.length) {
            const local = state.currentTime - clip.startTime;
            const k = list.find(f => Math.abs(f.time - local) < 0.15);
            if (k) return { get: () => k.value, set: (v) => { k.value = v; } };
        }
        return { get: () => fx.params[param], set: (v) => { fx.params[param] = v; } };
    }

    window.fxSetParam = function (clipId, fxId, param, value, phase) {
        const { clip, fx } = find(clipId, fxId);
        if (!fx || locked(clip)) return;
        const spec = FX().EFFECTS[fx.type] && FX().EFFECTS[fx.type].params[param];
        if (!spec) return;
        const v = Math.min(spec.max, Math.max(spec.min, Number(value)));
        if (!Number.isFinite(v)) return;
        const t = target(clip, fx, param);
        const key = `${clipId}|${fxId}|${param}`;
        if (!(key in drag)) drag[key] = t.get();
        if (phase === 'commit') {
            const before = drag[key];
            delete drag[key];
            commitGesture(`${FX().EFFECTS[fx.type].label}: ${spec.label}`, () => t.set(before), () => t.set(v));
            refresh(true);
        } else {
            t.set(v);
            refresh(false);
        }
    };

    window.fxToggleKeyframe = function (clipId, fxId, param) {
        const { clip, fx } = find(clipId, fxId);
        if (!fx || locked(clip)) return;
        const key = FX().keyFor(fx, param);
        const local = state.currentTime - clip.startTime;
        withHistory('Toggle Keyframe', () => {
            clip.keyframes = clip.keyframes && !Array.isArray(clip.keyframes) ? clip.keyframes : {};
            const list = clip.keyframes[key] || (clip.keyframes[key] = []);
            const i = list.findIndex(f => Math.abs(f.time - local) < 0.15);
            if (i >= 0) list.splice(i, 1);
            else list.push({ time: local, value: window.fxValue(clip, fx, param) });
            list.sort((a, b) => a.time - b.time);
            if (list.length === 0) delete clip.keyframes[key];
        });
        refresh(true);
    };

    window.fxHasKeyframeHere = function (clip, fx, param) {
        const list = clip.keyframes && clip.keyframes[FX().keyFor(fx, param)];
        if (!list) return false;
        const local = state.currentTime - clip.startTime;
        return list.some(f => Math.abs(f.time - local) < 0.15);
    };
})();
