/**
 * ForgeCut editor — Playhead, timecode, play/pause and media sync
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
// Global playhead update
function setTime(time, forceUpdateMedia = true) {
    // Snap to nearest frame boundary (25fps -> 0.04 seconds step)
    time = Math.round(time / 0.04) * 0.04;

    if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
        window.ForgeCut.PlaybackEngine.seekTo(time);
    } else {
        state.currentTime = Math.max(0, Math.min(state.duration, time));
    }
    updateTimecodeDisplay();
    updatePlayheadUI();

    if (forceUpdateMedia) {
        syncMediaPlayback();
    }
}

function updateTimecodeDisplay() {
    const format = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };
    if (timecodeDisplay) {
        timecodeDisplay.innerHTML = `<span class="text-on-surface font-bold">${format(state.currentTime)}</span> / ${format(state.duration)}`;
    }
    const durationLabel = document.getElementById('activeTimelineLengthLabel');
    if (durationLabel) {
        durationLabel.textContent = `Total: ${format(state.duration)}`;
    }
}

function updatePlayheadUI() {
    const leftOffset = state.currentTime * state.zoom;
    if (playhead) {
        playhead.style.left = `${leftOffset}px`;
    }
    if (typeof renderTimelineMinimap === 'function') {
        renderTimelineMinimap();
    }
    renderCanvasComposition();
    if (state.selectedClipId) {
        updateInspector();
    }
}

function togglePlay() {
    if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
        window.ForgeCut.PlaybackEngine.bindState(state);
        window.ForgeCut.PlaybackEngine.togglePlay();
    } else {
        if (state.isPlaying) {
            pause();
        } else {
            play();
        }
    }
}

function play() {
    if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
        window.ForgeCut.PlaybackEngine.bindState(state);
        window.ForgeCut.PlaybackEngine.play();
    } else {
        if (state.isPlaying) return;
        if (state.currentTime >= state.duration) {
            setTime(0);
        }
        state.isPlaying = true;

        const playIcon = document.getElementById('playPauseIcon');
        if (playIcon) playIcon.textContent = 'pause';
        const ribbonPlay = document.getElementById('ribbonPlayIcon');
        if (ribbonPlay) ribbonPlay.textContent = 'pause';

        syncMediaPlayback();
    }
}

function pause() {
    if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
        window.ForgeCut.PlaybackEngine.bindState(state);
        window.ForgeCut.PlaybackEngine.pause();
    } else {
        if (!state.isPlaying) return;
        state.isPlaying = false;

        const playIcon = document.getElementById('playPauseIcon');
        if (playIcon) playIcon.textContent = 'play_arrow';
        const ribbonPlay = document.getElementById('ribbonPlayIcon');
        if (ribbonPlay) ribbonPlay.textContent = 'play_arrow';

        syncMediaPlayback();
    }
}

// Primary Media Sync (keep audio and video elements playing in sync with state.currentTime)
function syncMediaPlayback() {
    if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
        window.ForgeCut.PlaybackEngine.bindState(state);
        window.ForgeCut.PlaybackEngine.syncAllMedia();
    } else {
        state.tracks.forEach(track => {
            track.clips.forEach(clip => {
                const asset = assetCache.get(clip.assetId);
                if (!asset) return;

                const inClipRange = state.currentTime >= clip.startTime && state.currentTime <= (clip.startTime + clip.duration);
                const element = asset.element;

                if (!element) return;

                if (inClipRange) {
                    const targetTime = (state.currentTime - clip.startTime) + clip.trimStart;

                    if (state.isPlaying) {
                        if (element.paused) {
                            element.currentTime = targetTime;
                            element.play().catch(e => console.log('Audio/Video play delayed:', e));
                        } else if (Math.abs(element.currentTime - targetTime) > 0.15) {
                            element.currentTime = targetTime;
                        }
                    } else {
                        if (!element.paused) {
                            element.pause();
                        }
                        element.currentTime = targetTime;
                    }
                } else {
                    if (!element.paused) {
                        element.pause();
                    }
                }
            });
        });
    }
}

// The render loop itself lives in PlaybackEngine.start(); this is the frame
// callback it drives. Marking state.needsRedraw (via requestRedraw) is what
// schedules a repaint, so edits coalesce into one paint per frame instead of
// repainting synchronously on every mutation.
state.needsRedraw = true; // initially true to draw first frame
window.requestRedraw = function () {
    state.needsRedraw = true;
};

function renderFrame() {
    updateTimecodeDisplay();
    updatePlayheadUI();
    renderCanvasComposition();
}
