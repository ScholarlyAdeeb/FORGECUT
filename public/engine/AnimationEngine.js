/**
 * ForgeCut AnimationEngine — Keyframe-based object animation system.
 * Entrance: Fade In, Slide Left, Slide Right, Zoom In
 * Exit: Fade Out, Slide Left, Slide Right, Zoom Out
 * Emphasis: Scale, Rotate, Opacity
 */
(function() {
    'use strict';

    const EASING = {
        linear: (t) => t,
        easeIn: (t) => t * t * t,
        easeOut: (t) => 1 - Math.pow(1 - t, 3),
        easeInOut: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        easeInQuad: (t) => t * t,
        easeOutQuad: (t) => t * (2 - t),
        easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        easeOutBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
        easeOutElastic: (t) => {
            if (t === 0 || t === 1) return t;
            return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
        },
        bounce: (t) => {
            if (t < 1/2.75) return 7.5625*t*t;
            if (t < 2/2.75) return 7.5625*(t-=1.5/2.75)*t+0.75;
            if (t < 2.5/2.75) return 7.5625*(t-=2.25/2.75)*t+0.9375;
            return 7.5625*(t-=2.625/2.75)*t+0.984375;
        }
    };

    function getEasing(name) {
        return EASING[name] || EASING.easeInOut;
    }

    const ENTRANCE = {
        'Fade In': (progress, config) => ({ opacity: progress }),
        'Fade': (progress, config) => ({ opacity: progress }),
        'Slide Left': (progress, config) => ({ offsetX: 500 * (1 - progress), opacity: progress }),
        'Slide Right': (progress, config) => ({ offsetX: -500 * (1 - progress), opacity: progress }),
        'Slide': (progress, config) => {
            const dir = config.direction || 'left';
            const dist = config.distance || 500;
            const offsets = {
                left:  { x: -dist * (1 - progress), y: 0 },
                right: { x: dist * (1 - progress), y: 0 },
                up:    { x: 0, y: -dist * (1 - progress) },
                down:  { x: 0, y: dist * (1 - progress) }
            };
            return {
                offsetX: (offsets[dir] || offsets.left).x,
                offsetY: (offsets[dir] || offsets.left).y,
                opacity: progress
            };
        },
        'Zoom In': (progress, config) => ({ scale: progress, opacity: progress }),
        'Zoom': (progress, config) => ({ scale: progress, opacity: progress }),
        'Pop': (progress, config) => ({ scale: EASING.easeOutBack(progress), opacity: Math.min(1, progress * 2) })
    };

    const EXIT = {
        'Fade Out': (progress, config) => ({ opacity: 1 - progress }),
        'Fade': (progress, config) => ({ opacity: 1 - progress }),
        'Slide Left': (progress, config) => ({ offsetX: -500 * progress, opacity: 1 - progress }),
        'Slide Right': (progress, config) => ({ offsetX: 500 * progress, opacity: 1 - progress }),
        'Slide': (progress, config) => {
            const dir = config.direction || 'right';
            const dist = config.distance || 500;
            const offsets = {
                left:  { x: -dist * progress, y: 0 },
                right: { x: dist * progress, y: 0 },
                up:    { x: 0, y: -dist * progress },
                down:  { x: 0, y: dist * progress }
            };
            return {
                offsetX: (offsets[dir] || offsets.right).x,
                offsetY: (offsets[dir] || offsets.right).y,
                opacity: 1 - progress
            };
        },
        'Zoom Out': (progress, config) => ({ scale: 1 - progress, opacity: 1 - progress }),
        'Zoom': (progress, config) => ({ scale: 1 - progress, opacity: 1 - progress }),
        'Shrink': (progress, config) => ({ scale: 1 - progress, opacity: 1 - progress })
    };

    const EMPHASIS = {
        'Scale': (progress, config) => ({ scale: 1 + Math.sin(progress * Math.PI) * 0.3 }),
        'Pulse': (progress, config) => ({ scale: 1 + Math.sin(progress * Math.PI * 2) * 0.15 }),
        'Rotate': (progress, config) => ({ rotation: progress * 360 }),
        'Opacity': (progress, config) => ({ opacity: 0.5 + Math.sin(progress * Math.PI * 2) * 0.5 }),
        'Shake': (progress, config) => {
            const intensity = config.intensity || 10;
            const freq = 8;
            return {
                offsetX: Math.sin(progress * Math.PI * freq) * intensity,
                offsetY: Math.cos(progress * Math.PI * freq * 0.7) * intensity * 0.5
            };
        }
    };

    function getAnimatedProperties(clip, clipLocalTime) {
        const result = {
            offsetX: 0,
            offsetY: 0,
            scale: 1.0,
            rotation: 0,
            opacity: 1.0
        };

        const anims = clip.animations;
        if (!anims) return result;

        const animDuration = parseFloat(anims.duration) || 0.5;
        const animDelay = parseFloat(anims.delay) || 0;
        const easingName = anims.easing || 'easeInOut';
        const easeFn = getEasing(easingName);
        const loopCount = anims.loopCount || 1;

        // Entrance
        if (anims.entrance && ENTRANCE[anims.entrance]) {
            const entranceEnd = animDelay + animDuration;
            if (clipLocalTime < animDelay) {
                const entranceResult = ENTRANCE[anims.entrance](0, anims);
                applyAnimResult(result, entranceResult);
            } else if (clipLocalTime < entranceEnd) {
                const raw = (clipLocalTime - animDelay) / animDuration;
                const eased = easeFn(Math.max(0, Math.min(1, raw)));
                const entranceResult = ENTRANCE[anims.entrance](eased, anims);
                applyAnimResult(result, entranceResult);
            }
        }

        // Exit
        if (anims.exit && EXIT[anims.exit]) {
            const exitDuration = parseFloat(anims.exitDuration) || animDuration;
            const exitStart = clip.duration - exitDuration;
            if (clipLocalTime > exitStart) {
                const raw = (clipLocalTime - exitStart) / exitDuration;
                const eased = easeFn(Math.max(0, Math.min(1, raw)));
                const exitResult = EXIT[anims.exit](eased, anims);
                applyAnimResult(result, exitResult);
            }
        }

        // Emphasis
        if (anims.emphasis && EMPHASIS[anims.emphasis]) {
            const emphStart = animDelay + animDuration;
            if (clipLocalTime > emphStart) {
                const emphDuration = parseFloat(anims.emphasisDuration) || 1.0;
                const elapsed = clipLocalTime - emphStart;
                const cycle = elapsed / emphDuration;
                const currentCycle = Math.floor(cycle);

                if (loopCount === 0 || currentCycle < loopCount) {
                    const raw = cycle - currentCycle;
                    const emphResult = EMPHASIS[anims.emphasis](raw, anims);
                    applyAnimResult(result, emphResult);
                }
            }
        }

        return result;
    }

    function applyAnimResult(target, source) {
        if (source.offsetX !== undefined) target.offsetX += source.offsetX;
        if (source.offsetY !== undefined) target.offsetY += source.offsetY;
        if (source.scale !== undefined) target.scale *= source.scale;
        if (source.rotation !== undefined) target.rotation += source.rotation;
        if (source.opacity !== undefined) target.opacity *= source.opacity;
    }

    function setAnimation(clip, phase, type) {
        if (!clip.animations) {
            clip.animations = {
                duration: '0.5',
                delay: '0',
                easing: 'easeInOut',
                loopCount: 1
            };
        }
        clip.animations[phase] = type;
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.AnimationEngine = {
        getAnimatedProperties,
        setAnimation,
        ENTRANCE,
        EXIT,
        EMPHASIS,
        EASING,
        getEasing
    };
})();
