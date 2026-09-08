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

    // Screen / camera capture. The recording is handed to handleAssetUpload
    // exactly like a picked file, so it lands in the media library, the
    // Project Explorer and the timeline through the normal import path.
    let _recorder = null;
    let _recordStream = null;
    let _recordBar = null;

    function stopRecordingUI() {
        if (_recordBar) { _recordBar.remove(); _recordBar = null; }
    }

    function showRecordingUI(onStop) {
        stopRecordingUI();
        const bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:100002;' +
            'display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;' +
            'background:#1f2430;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.4);font:600 12px system-ui,sans-serif';
        const dot = document.createElement('span');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#e53935;animation:fcRecPulse 1s infinite';
        const label = document.createElement('span');
        label.textContent = 'Recording…';
        const stop = document.createElement('button');
        stop.textContent = 'Stop';
        stop.style.cssText = 'padding:5px 14px;border-radius:999px;border:none;cursor:pointer;background:#e53935;color:#fff;font:600 12px system-ui,sans-serif';
        stop.addEventListener('click', onStop);
        if (!document.getElementById('fc-rec-style')) {
            const st = document.createElement('style');
            st.id = 'fc-rec-style';
            st.textContent = '@keyframes fcRecPulse{0%,100%{opacity:1}50%{opacity:.25}}';
            document.head.appendChild(st);
        }
        bar.append(dot, label, stop);
        document.body.appendChild(bar);
        _recordBar = bar;
    }

    function stopRecording() {
        if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
    }

    window.toggleRecordingDialog = async function () {
        // Already recording? The button doubles as a stop control.
        if (_recorder && _recorder.state === 'recording') {
            stopRecording();
            return;
        }

        const md = navigator.mediaDevices;
        if (!md || typeof window.MediaRecorder === 'undefined') {
            fcToast('Recording is not supported in this browser.', 'error');
            return;
        }
        if (!window.isSecureContext) {
            fcToast('Recording needs a secure context (https or localhost).', 'error');
            return;
        }

        const source = await window.fcModal('What would you like to record?', {
            okLabel: 'Screen',
            cancelLabel: 'Camera + Mic',
            cancelValue: 'camera'
        });
        // The modal resolves true for OK, and 'camera' for cancel; Escape or a
        // backdrop click also yields 'camera', so treat only true as screen.
        const wantScreen = source === true;

        try {
            _recordStream = wantScreen
                ? await md.getDisplayMedia({ video: true, audio: true })
                : await md.getUserMedia({ video: true, audio: true });
        } catch (err) {
            // NotAllowedError just means the user dismissed the picker.
            if (err && err.name === 'NotAllowedError') fcToast('Recording cancelled.');
            else fcToast(`Could not start recording: ${err && err.message ? err.message : err}`, 'error');
            return;
        }

        const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
            .find(t => window.MediaRecorder.isTypeSupported(t)) || '';
        const chunks = [];
        try {
            _recorder = mime ? new MediaRecorder(_recordStream, { mimeType: mime }) : new MediaRecorder(_recordStream);
        } catch (err) {
            _recordStream.getTracks().forEach(t => t.stop());
            fcToast(`Could not start recording: ${err && err.message ? err.message : err}`, 'error');
            return;
        }

        _recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });

        _recorder.addEventListener('stop', async () => {
            stopRecordingUI();
            if (_recordStream) {
                _recordStream.getTracks().forEach(t => t.stop());
                _recordStream = null;
            }
            _recorder = null;
            if (chunks.length === 0) {
                fcToast('Nothing was recorded.', 'error');
                return;
            }
            const blob = new Blob(chunks, { type: 'video/webm' });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const file = new File([blob], `recording ${stamp}.webm`, { type: 'video/webm' });
            if (typeof handleAssetUpload === 'function') {
                await handleAssetUpload(file, 'video');
                fcToast(`Recording added to the timeline (${(blob.size / 1048576).toFixed(1)} MB).`);
            }
        });

        // Ending the capture from the browser's own "Stop sharing" bar must
        // finish the recording too, not leave it running against a dead track.
        _recordStream.getVideoTracks().forEach(t => t.addEventListener('ended', stopRecording));

        _recorder.start();
        showRecordingUI(stopRecording);
        fcToast(wantScreen ? 'Recording the screen — press Stop when done.' : 'Recording from camera — press Stop when done.');
    };

    // Keep the icon in step with whatever the slider is initialised to.
    window.addEventListener('DOMContentLoaded', () => {
        const slider = document.getElementById('canvasMasterVolumeSlider');
        if (slider) window.setMasterVolume(slider.value);
    });
})();
