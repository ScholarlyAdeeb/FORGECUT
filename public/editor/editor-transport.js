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
        // seekTo() already runs a full syncAllMedia() pass. Calling
        // syncMediaPlayback() afterwards ran an identical second pass over
        // every clip on every seek — and syncAllMedia is roughly O(clips^2),
        // because computeClipVolume walks all tracks for ducking and searches
        // for crossfade neighbours per clip. One pass is enough.
        window.ForgeCut.PlaybackEngine.seekTo(time);
        updateTimecodeDisplay();
        updatePlayheadUI();
        // Repaint next frame. The inspector only needs refreshing for
        // user-driven seeks — during playback it would rebuild every frame.
        scheduleRender({ inspector: !!state.selectedClipId && !state.isPlaying });
        return;
    }

    state.currentTime = Math.max(0, Math.min(state.duration, time));
    updateTimecodeDisplay();
    updatePlayheadUI();

    if (forceUpdateMedia) {
        syncMediaPlayback();
    }
    scheduleRender();
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

/**
 * Move the playhead. Nothing else.
 *
 * This used to also redraw the minimap, composite the whole canvas and rebuild
 * the inspector, which made a one-line DOM update cost ~19.5ms — and because
 * renderFrame() calls this and *then* composites, the canvas was painted twice
 * on every frame of playback. The heavier work is coalesced through the frame
 * loop instead.
 */
function updatePlayheadUI() {
    const leftOffset = state.currentTime * state.zoom;
    if (playhead) {
        playhead.style.left = `${leftOffset}px`;
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

/**
 * Request work for the next animation frame instead of doing it synchronously.
 *
 * High-frequency handlers (drag, scrub, pan, wheel) used to call
 * renderTimeline() / updateInspector() / renderCanvasComposition() directly on
 * every pointer event — 60-120 full timeline rebuilds, inspector DOM rebuilds
 * and 1920x1080 canvas repaints per second. Marking dirty flags here coalesces
 * all of that into one paint per frame, driven by the loop that already exists
 * in PlaybackEngine.
 *
 *   scheduleRender()                       -> repaint canvas next frame
 *   scheduleRender({ timeline: true })     -> and rebuild the timeline
 *   scheduleRender({ inspector: true })    -> and rebuild the inspector
 */
window.scheduleRender = function (what) {
    if (what) {
        if (what.timeline) state._dirtyTimeline = true;
        if (what.inspector) state._dirtyInspector = true;
    }
    state.needsRedraw = true;
};

function renderFrame() {
    updateTimecodeDisplay();
    updatePlayheadUI();

    // Flush coalesced structural work before painting the canvas, so the
    // timeline DOM and the composition agree within a single frame.
    if (state._dirtyTimeline) {
        state._dirtyTimeline = false;
        if (typeof renderTimeline === 'function') renderTimeline();
    }
    if (state._dirtyInspector) {
        state._dirtyInspector = false;
        if (typeof updateInspector === 'function') updateInspector();
    }
    if (typeof renderTimelineMinimap === 'function') {
        renderTimelineMinimap();
    }

    renderCanvasComposition();
}
