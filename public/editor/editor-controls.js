/**
 * ForgeCut editor — controls the markup referenced but nothing ever defined.
 *
 * Every handler here was already wired to a visible button via an inline
 * onclick/oninput in index.html or components/*.js, but no implementation
 * existed anywhere. Clicking those controls threw a ReferenceError, so the
 * Arrange ribbon group, the preview volume/mute controls, Reset Layout and
 * Insert GIF all did nothing.
 *
 * Loaded last so it can rely on everything else being defined.
 */
(function () {
    'use strict';

    function selectedClip() {
        if (!state.selectedClipId || typeof findClipById !== 'function') return null;
        return findClipById(state.selectedClipId);
    }

    function trackOf(clip) {
        return state.tracks.find(t => t.clips.includes(clip));
    }

    function repaint(label) {
        if (typeof renderTimeline === 'function') renderTimeline();
        if (typeof window.requestRedraw === 'function') window.requestRedraw();
        if (label && typeof window.saveStateToHistory === 'function') {
            window.saveStateToHistory(label);
        }
    }

    /* ── Arrange ribbon: Forward / Backward / Align / Group ─────────────── */

    /**
     * Clips are painted in array order within their track, so "forward" means
     * moving one step later in that array.
     */
    window.arrangeClip = function (action) {
        if (action === 'group') {
            if (typeof window.groupSelectedClips === 'function') window.groupSelectedClips();
            return;
        }

        const clip = selectedClip();
        if (!clip) {
            fcToast('Select a clip first.');
            return;
        }
        const track = trackOf(clip);
        if (!track) return;

        if (action === 'align') {
            // Centre on the composition. Canvas dimensions are the source of
            // truth for size — state.resolution is never populated.
            clip.x = canvas.width / 2;
            clip.y = canvas.height / 2;
            repaint('Align Clip');
            fcToast('Clip centred on canvas.');
            return;
        }

        const i = track.clips.indexOf(clip);
        const j = action === 'forward' ? i + 1 : i - 1;
        if (j < 0 || j >= track.clips.length) {
            fcToast(action === 'forward' ? 'Already at the front.' : 'Already at the back.');
            return;
        }
        track.clips[i] = track.clips[j];
        track.clips[j] = clip;
        repaint(action === 'forward' ? 'Bring Forward' : 'Send Backward');
    };

    /* ── Preview transport: master volume and mute ──────────────────────── */

    let _volumeBeforeMute = null;

    function audioEngine() {
        return window.ForgeCut && window.ForgeCut.AudioEngine;
    }

    function updateVolumeIcon() {
        const icon = document.getElementById('canvasAudioVolumeIcon');
        if (!icon) return;
        const AE = audioEngine();
        const v = AE ? AE.getMasterVolume() : 1;
        icon.textContent = v === 0 ? 'volume_off' : (v < 0.5 ? 'volume_down' : 'volume_up');
    }

    /** Slider reports 0–100; AudioEngine works in 0–1. */
    window.setMasterVolume = function (value) {
        const AE = audioEngine();
        if (!AE) return;
        const v = Math.max(0, Math.min(1, Number(value) / 100));
        AE.setMasterVolume(v);
        if (v > 0) _volumeBeforeMute = null;
        updateVolumeIcon();
    };

    window.toggleMuteAudio = function () {
        const AE = audioEngine();
        if (!AE) return;
        const slider = document.getElementById('canvasMasterVolumeSlider');
        const current = AE.getMasterVolume();

        if (current > 0) {
            _volumeBeforeMute = current;
            AE.setMasterVolume(0);
            if (slider) slider.value = 0;
        } else {
            const restored = _volumeBeforeMute != null ? _volumeBeforeMute : 0.8;
            AE.setMasterVolume(restored);
            if (slider) slider.value = Math.round(restored * 100);
            _volumeBeforeMute = null;
        }
        updateVolumeIcon();
    };

    /* ── View ribbon: Reset Layout ──────────────────────────────────────── */

    window.resetLayout = function () {
        const left = document.getElementById('leftSidebarContainer');
        const right = document.getElementById('rightSidebarContainer');
        if (left) left.style.width = '';
        if (right) right.style.width = '';

        state.canvasZoom = 100;
        state.canvasPanX = 0;
        state.canvasPanY = 0;
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) wrapper.style.transform = '';

        if (typeof recalculateCanvasDisplaySize === 'function') recalculateCanvasDisplaySize();
        repaint();
        fcToast('Layout reset.');
    };

    /* ── Insert ribbon: GIF ─────────────────────────────────────────────── */

    /**
     * GIFs go through the same path as any other image asset; the browser
     * decodes them into an <img> and the renderer draws whatever frame it has.
     */
    window.addNewGifClip = function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/gif,image/*';
        input.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file && typeof handleAssetUpload === 'function') handleAssetUpload(file, 'image');
        });
        input.click();
    };

    /* ── Insert ribbon: Record ──────────────────────────────────────────── */

    // Deliberately not implemented: there is no recording code anywhere in the
    // project for this to hook into, so building it is a new feature rather
    // than repairing an existing one. Kept as an explicit notice so the button
    // stops throwing a ReferenceError when clicked.
    window.toggleRecordingDialog = function () {
        fcToast('Recording is not available in this build yet.');
    };

    // Keep the icon in step with whatever the slider is initialised to.
    window.addEventListener('DOMContentLoaded', () => {
        const slider = document.getElementById('canvasMasterVolumeSlider');
        if (slider) window.setMasterVolume(slider.value);
    });
})();
