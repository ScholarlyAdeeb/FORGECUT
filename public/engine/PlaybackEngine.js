/**
 * ForgeCut PlaybackEngine — Stateful transport controls, element recycling,
 * speed scaling, frame stepping, and synchronized multi-track playback.
 */
(function() {
    'use strict';

    const DRIFT_THRESHOLD = 0.1; // seconds
    const ELEMENT_POOL_MAX = 16;
    // Largest time step we will ever apply in one frame. Without this, returning
    // to a backgrounded tab hands us a multi-second delta and the playhead jumps.
    const MAX_FRAME_DELTA = 0.25; // seconds

    let _state = null;
    let _playbackRate = 1.0;
    let _isLooping = false;
    let _elementPool = { video: [], audio: [] };
    let _rafId = null;
    let _renderFn = null;
    let _lastTimestamp = 0;

    function bindState(stateRef) {
        _state = stateRef;
    }

    /**
     * Start the transport render loop. This is the only animation loop in the
     * app: it advances time while playing and repaints whenever the frame moved
     * or something marked the composition dirty via state.needsRedraw.
     * Safe to call repeatedly — a second call will not start a second loop.
     */
    function start(stateRef, renderFn) {
        if (stateRef) bindState(stateRef);
        if (typeof renderFn === 'function') _renderFn = renderFn;
        if (_rafId !== null) return;
        _lastTimestamp = 0;
        _rafId = requestAnimationFrame(_tick);
    }

    function stopLoop() {
        if (_rafId === null) return;
        cancelAnimationFrame(_rafId);
        _rafId = null;
        _lastTimestamp = 0;
    }

    function isRunning() {
        return _rafId !== null;
    }

    function _tick(timestamp) {
        _rafId = requestAnimationFrame(_tick);

        // Skip work while the tab is hidden, but keep the loop alive so playback
        // resumes cleanly. Reset the clock so the next visible frame gets a
        // sane delta instead of the whole hidden duration.
        if (document.hidden) {
            _lastTimestamp = 0;
            return;
        }

        if (!_lastTimestamp) _lastTimestamp = timestamp;
        const delta = Math.min((timestamp - _lastTimestamp) / 1000, MAX_FRAME_DELTA);
        _lastTimestamp = timestamp;

        let moved = false;
        if (_state && _state.isPlaying) {
            moved = advanceTime(delta);
            syncAllMedia();
        }

        if (moved || (_state && _state.needsRedraw)) {
            if (_state) _state.needsRedraw = false;
            if (_renderFn) _renderFn();
        }
    }

    function getOrCreateElement(type, src) {
        // Try to find an existing element in the pool with the same src
        const pool = _elementPool[type] || [];
        for (let i = 0; i < pool.length; i++) {
            if (pool[i].src === src || pool[i]._assetSrc === src) {
                return pool[i];
            }
        }
        // Recycle an unused element if pool is full
        if (pool.length >= ELEMENT_POOL_MAX) {
            const recycled = pool.shift();
            recycled.pause();
            recycled.src = src;
            recycled._assetSrc = src;
            pool.push(recycled);
            return recycled;
        }
        // Create new element
        const el = document.createElement(type === 'video' ? 'video' : 'audio');
        el.preload = 'auto';
        if (type === 'video') {
            el.muted = true;
            el.playsInline = true;
        }
        el.src = src;
        el._assetSrc = src;
        if (!_elementPool[type]) _elementPool[type] = [];
        _elementPool[type].push(el);
        return el;
    }

    function play() {
        if (!_state) return;
        if (_state.isPlaying) return;
        if (_state.currentTime >= _state.duration) {
            _state.currentTime = 0;
        }
        _state.isPlaying = true;
        updateTransportUI('pause');

        // Resume AudioEngine context
        if (window.ForgeCut && window.ForgeCut.AudioEngine) {
            window.ForgeCut.AudioEngine.resume();
        }
        syncAllMedia();
    }

    function pause() {
        if (!_state) return;
        if (!_state.isPlaying) return;
        _state.isPlaying = false;
        updateTransportUI('play_arrow');
        syncAllMedia();
    }

    function stop() {
        if (!_state) return;
        _state.isPlaying = false;
        _state.currentTime = 0;
        updateTransportUI('play_arrow');
        syncAllMedia();
    }

    function togglePlay() {
        if (!_state) return;
        _state.isPlaying ? pause() : play();
    }

    function toggleLoop() {
        _isLooping = !_isLooping;
        return _isLooping;
    }

    function setPlaybackRate(rate) {
        _playbackRate = Math.max(0.25, Math.min(4.0, rate));
        // Update all active elements
        _state && _state.tracks.forEach(track => {
            track.clips.forEach(clip => {
                const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
                const asset = ME ? ME.getAsset(clip.assetId) : null;
                if (asset && asset.element && asset.element.playbackRate !== undefined) {
                    asset.element.playbackRate = _playbackRate;
                }
            });
        });
        return _playbackRate;
    }

    function getPlaybackRate() {
        return _playbackRate;
    }

    function stepForward() {
        if (!_state) return;
        const fps = _state.projectFps || 30;
        seekTo(_state.currentTime + (1 / fps));
    }

    function stepBackward() {
        if (!_state) return;
        const fps = _state.projectFps || 30;
        seekTo(_state.currentTime - (1 / fps));
    }

    function seekTo(time) {
        if (!_state) return;
        _state.currentTime = Math.max(0, Math.min(_state.duration, time));
        _state.needsRedraw = true;
        syncAllMedia();
    }

    function advanceTime(delta) {
        if (!_state || !_state.isPlaying) return false;
        let newTime = _state.currentTime + (delta * _playbackRate);
        if (newTime >= _state.duration) {
            if (_isLooping) {
                newTime = 0;
            } else {
                // Park exactly on the last frame before pausing, otherwise the
                // playhead stops short of the end of the composition.
                _state.currentTime = _state.duration;
                _state.needsRedraw = true;
                pause();
                return false;
            }
        }
        _state.currentTime = newTime;
        return true;
    }

    function syncAllMedia() {
        if (!_state) return;
        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;

        let realtimeBeepActive = false;

        _state.tracks.forEach(track => {
            track.clips.forEach(clip => {
                const asset = ME ? ME.getAsset(clip.assetId) : (window.assetCache ? window.assetCache.get(clip.assetId) : null);
                if (!asset || !asset.element) return;
                if (asset.element.tagName !== 'VIDEO' && asset.element.tagName !== 'AUDIO') return;

                const clipEnd = clip.startTime + clip.duration;
                const inRange = _state.currentTime >= clip.startTime && _state.currentTime < clipEnd;
                const element = asset.element;

                if (inRange) {
                    const localTime = (_state.currentTime - clip.startTime) + (clip.trimStart || 0);

                    if (_state.isPlaying) {
                        element.playbackRate = _playbackRate * (clip.playbackSpeed !== undefined ? clip.playbackSpeed : 1.0);
                        if (element.paused) {
                            element.currentTime = localTime;
                            element.play().catch(() => {});
                        } else if (Math.abs(element.currentTime - localTime) > DRIFT_THRESHOLD) {
                            element.currentTime = localTime;
                        }

                        // Audio volume with fades, keyframes, ducking and censor beeps
                        if (track.type === 'audio' || (track.type === 'video' && !element.muted)) {
                            let vol = 1.0;
                            const clipLocal = _state.currentTime - clip.startTime;
                            if (AE) {
                                vol = AE.computeClipVolume(track.id, clip, clipLocal);
                            } else {
                                vol = clip.volume !== undefined ? clip.volume : 1.0;
                                if (clip.fadeIn > 0 && clipLocal < clip.fadeIn) {
                                    vol *= (clipLocal / clip.fadeIn);
                                }
                                const remaining = clip.duration - clipLocal;
                                if (clip.fadeOut > 0 && remaining < clip.fadeOut) {
                                    vol *= (remaining / clip.fadeOut);
                                }
                            }
                            // Preview audio plays through HTMLMediaElement volume,
                            // which bypasses AudioEngine's master gain node, so the
                            // master slider had no effect on playback. Apply it here.
                            const master = AE ? AE.getMasterVolume() : 1;
                            element.volume = Math.max(0, Math.min(1, vol * master));
                        }

                        // Check if current playhead hits a censor beep for real-time oscillator trigger
                        if (clip.censorBeeps) {
                            const clipLocal = _state.currentTime - clip.startTime;
                            const inBeep = clip.censorBeeps.some(beep => 
                                clipLocal >= beep.startTime && clipLocal < beep.startTime + beep.duration
                            );
                            if (inBeep) {
                                realtimeBeepActive = true;
                            }
                        }
                    } else {
                        if (!element.paused) element.pause();
                        element.currentTime = localTime;
                    }
                } else {
                    if (!element.paused) element.pause();
                }
            });
        });

        if (AE) {
            if (realtimeBeepActive && _state.isPlaying) {
                AE.startRealtimeBeep();
            } else {
                AE.stopRealtimeBeep();
            }
        }
    }

    /**
     * Announce a transport state change instead of painting it.
     *
     * This used to write straight into the Ribbon's playPauseIcon and
     * ribbonPlayIcon elements, which put Windows presentation inside the
     * shared engine: every other platform would have had to either adopt
     * those element ids or watch the engine miss its own buttons. The engine
     * now reports what happened and each platform layer decides how to show
     * it — see platform/windows/editor/editor-transport.js for the Ribbon's
     * listener.
     */
    function updateTransportUI(icon) {
        window.dispatchEvent(new CustomEvent('forgecut:transport', {
            detail: { icon: icon, isPlaying: !!(_state && _state.isPlaying) }
        }));
    }

    function clearPool() {
        Object.values(_elementPool).forEach(pool => {
            pool.forEach(el => {
                if (el.pause) el.pause();
                el.src = '';
            });
        });
        _elementPool = { video: [], audio: [] };
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.PlaybackEngine = {
        bindState,
        start, stopLoop, isRunning,
        play, pause, stop, togglePlay, toggleLoop,
        setPlaybackRate, getPlaybackRate,
        stepForward, stepBackward, seekTo,
        advanceTime, syncAllMedia,
        clearPool,
        get isLooping() { return _isLooping; },
        get playbackRate() { return _playbackRate; }
    };
})();
