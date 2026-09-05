/**
 * ForgeCut TransitionEngine — Canvas-based video transition effects.
 * Supports: Cut, Fade, Dissolve, Push, Slide, Wipe, Zoom, Dip To Black, Split, Reveal, Random.
 */
(function() {
    'use strict';

    const randomTypes = ['Fade', 'Dissolve', 'Push', 'Wipe', 'Split', 'Reveal', 'Zoom'];

    function applyTransition(ctx, fromFrame, toFrame, progress, type, direction, canvasWidth, canvasHeight, clipId = '') {
        direction = direction || 'left';
        progress = Math.max(0, Math.min(1, progress));

        switch (type) {
            case 'Cut':
                renderCut(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Fade':
                renderFade(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Dissolve':
            case 'Cross Dissolve':
                renderCrossDissolve(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Push':
                renderPush(ctx, fromFrame, toFrame, progress, direction, canvasWidth, canvasHeight);
                break;
            case 'Slide':
                renderSlide(ctx, fromFrame, toFrame, progress, direction, canvasWidth, canvasHeight);
                break;
            case 'Wipe':
                renderWipe(ctx, fromFrame, toFrame, progress, direction, canvasWidth, canvasHeight);
                break;
            case 'Zoom':
                renderZoom(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Dip To Black':
            case 'DipToBlack':
                renderDipToBlack(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Split':
                renderSplit(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Reveal':
                renderReveal(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
                break;
            case 'Random':
                renderRandom(ctx, fromFrame, toFrame, progress, direction, canvasWidth, canvasHeight, clipId);
                break;
            default:
                renderCut(ctx, fromFrame, toFrame, progress, canvasWidth, canvasHeight);
        }
    }

    function drawFrame(ctx, frame, x, y, w, h) {
        if (!frame) return;
        try {
            ctx.drawImage(frame, x, y, w, h);
        } catch (e) {}
    }

    // ─────────── Transition Implementations ───────────

    function renderCut(ctx, from, to, progress, w, h) {
        if (progress < 0.5) {
            if (from) drawFrame(ctx, from, 0, 0, w, h);
        } else {
            if (to) drawFrame(ctx, to, 0, 0, w, h);
        }
    }

    function renderFade(ctx, from, to, progress, w, h) {
        if (from) {
            ctx.globalAlpha = 1 - progress;
            drawFrame(ctx, from, 0, 0, w, h);
        }
        if (to) {
            ctx.globalAlpha = progress;
            drawFrame(ctx, to, 0, 0, w, h);
        }
        ctx.globalAlpha = 1;
    }

    function renderCrossDissolve(ctx, from, to, progress, w, h) {
        const eased = easeInOutCubic(progress);
        if (from) {
            ctx.globalAlpha = 1 - eased;
            drawFrame(ctx, from, 0, 0, w, h);
        }
        if (to) {
            ctx.globalAlpha = eased;
            drawFrame(ctx, to, 0, 0, w, h);
        }
        ctx.globalAlpha = 1;
    }

    function renderPush(ctx, from, to, progress, dir, w, h) {
        const offset = progress;
        switch (dir) {
            case 'left':
                if (from) drawFrame(ctx, from, -w * offset, 0, w, h);
                if (to) drawFrame(ctx, to, w * (1 - offset), 0, w, h);
                break;
            case 'right':
                if (from) drawFrame(ctx, from, w * offset, 0, w, h);
                if (to) drawFrame(ctx, to, -w * (1 - offset), 0, w, h);
                break;
            case 'up':
                if (from) drawFrame(ctx, from, 0, -h * offset, w, h);
                if (to) drawFrame(ctx, to, 0, h * (1 - offset), w, h);
                break;
            case 'down':
                if (from) drawFrame(ctx, from, 0, h * offset, w, h);
                if (to) drawFrame(ctx, to, 0, -h * (1 - offset), w, h);
                break;
        }
    }

    function renderSlide(ctx, from, to, progress, dir, w, h) {
        if (from) drawFrame(ctx, from, 0, 0, w, h);
        if (to) {
            switch (dir) {
                case 'left':
                    drawFrame(ctx, to, w * (1 - progress), 0, w, h);
                    break;
                case 'right':
                    drawFrame(ctx, to, -w * (1 - progress), 0, w, h);
                    break;
                case 'up':
                    drawFrame(ctx, to, 0, h * (1 - progress), w, h);
                    break;
                case 'down':
                    drawFrame(ctx, to, 0, -h * (1 - progress), w, h);
                    break;
            }
        }
    }

    function renderWipe(ctx, from, to, progress, dir, w, h) {
        if (from) drawFrame(ctx, from, 0, 0, w, h);
        if (to) {
            ctx.save();
            ctx.beginPath();
            switch (dir) {
                case 'left':
                    ctx.rect(0, 0, w * progress, h);
                    break;
                case 'right':
                    ctx.rect(w * (1 - progress), 0, w * progress, h);
                    break;
                case 'up':
                    ctx.rect(0, 0, w, h * progress);
                    break;
                case 'down':
                    ctx.rect(0, h * (1 - progress), w, h * progress);
                    break;
            }
            ctx.clip();
            drawFrame(ctx, to, 0, 0, w, h);
            ctx.restore();
        }
    }

    function renderZoom(ctx, from, to, progress, w, h) {
        if (from) {
            const scale = 1 + progress * 0.3;
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.translate(w/2, h/2);
            ctx.scale(scale, scale);
            ctx.translate(-w/2, -h/2);
            drawFrame(ctx, from, 0, 0, w, h);
            ctx.restore();
        }
        if (to) {
            const scale = 0.7 + progress * 0.3;
            ctx.save();
            ctx.globalAlpha = progress;
            ctx.translate(w/2, h/2);
            ctx.scale(scale, scale);
            ctx.translate(-w/2, -h/2);
            drawFrame(ctx, to, 0, 0, w, h);
            ctx.restore();
        }
    }

    function renderDipToBlack(ctx, from, to, progress, w, h) {
        if (progress < 0.5) {
            const p = progress * 2;
            if (from) drawFrame(ctx, from, 0, 0, w, h);
            ctx.fillStyle = `rgba(0, 0, 0, ${p})`;
            ctx.fillRect(0, 0, w, h);
        } else {
            const p = (progress - 0.5) * 2;
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, w, h);
            if (to) {
                ctx.globalAlpha = p;
                drawFrame(ctx, to, 0, 0, w, h);
                ctx.globalAlpha = 1;
            }
        }
    }

    function renderSplit(ctx, from, to, progress, w, h) {
        if (from) drawFrame(ctx, from, 0, 0, w, h);
        if (to) {
            ctx.save();
            ctx.beginPath();
            const splitW = w * progress / 2;
            ctx.rect(0, 0, splitW, h);
            ctx.rect(w - splitW, 0, splitW, h);
            ctx.clip();
            drawFrame(ctx, to, 0, 0, w, h);
            ctx.restore();
        }
    }

    function renderReveal(ctx, from, to, progress, w, h) {
        if (to) drawFrame(ctx, to, 0, 0, w, h);
        if (from) {
            ctx.save();
            ctx.translate(w * progress, 0);
            drawFrame(ctx, from, 0, 0, w, h);
            ctx.restore();
        }
    }

    function renderRandom(ctx, from, to, progress, direction, w, h, clipId) {
        let hash = 0;
        for (let i = 0; i < clipId.length; i++) {
            hash = clipId.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % randomTypes.length;
        applyTransition(ctx, from, to, progress, randomTypes[index], direction, w, h, clipId);
    }

    // ─────────── Helpers ───────────

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function getClipTransition(clip) {
        if (!clip.transition || clip.transition === 'None') return null;
        return {
            type: clip.transition,
            duration: clip.transitionDuration || 1.0,
            direction: clip.transitionDirection || 'left'
        };
    }

    function getTransitionProgress(clip, currentTime) {
        const trans = getClipTransition(clip);
        if (!trans) return { active: false, progress: 0, isEntry: false };

        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;
        const elapsed = currentTime - clipStart;
        const remaining = clipEnd - currentTime;

        if (elapsed < trans.duration && elapsed >= 0) {
            return {
                active: true,
                progress: elapsed / trans.duration,
                isEntry: true,
                type: trans.type,
                direction: trans.direction
            };
        }

        if (remaining < trans.duration && remaining >= 0) {
            return {
                active: true,
                progress: 1 - (remaining / trans.duration),
                isEntry: false,
                type: trans.type,
                direction: trans.direction
            };
        }

        return { active: false, progress: 0, isEntry: false };
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.TransitionEngine = {
        applyTransition,
        getClipTransition,
        getTransitionProgress,
        easeInOutCubic
    };
})();
