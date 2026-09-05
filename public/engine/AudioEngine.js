/**
 * ForgeCut AudioEngine — Web Audio API context with per-track gain nodes,
 * mute/solo routing, fade envelopes, and master volume control.
 */
(function() {
    'use strict';

    let _audioContext = null;
    let _masterGain = null;
    let _trackNodes = {};  // trackId -> { gainNode, muted, solo, volume }
    let _masterVolume = 1.0;

    function getContext() {
        if (!_audioContext) {
            _audioContext = new (window.AudioContext || window.webkitAudioContext)();
            _masterGain = _audioContext.createGain();
            _masterGain.gain.value = _masterVolume;
            _masterGain.connect(_audioContext.destination);
        }
        return _audioContext;
    }

    function resume() {
        const ctx = getContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
    }

    function ensureTrackNode(trackId) {
        if (!_trackNodes[trackId]) {
            const ctx = getContext();
            const gainNode = ctx.createGain();
            gainNode.gain.value = 1.0;
            gainNode.connect(_masterGain);
            _trackNodes[trackId] = {
                gainNode,
                muted: false,
                solo: false,
                volume: 1.0
            };
        }
        return _trackNodes[trackId];
    }

    function setTrackVolume(trackId, volume) {
        const node = ensureTrackNode(trackId);
        node.volume = Math.max(0, Math.min(1, volume));
        updateTrackGains();
    }

    function setTrackMute(trackId, muted) {
        const node = ensureTrackNode(trackId);
        node.muted = !!muted;
        updateTrackGains();
    }

    function toggleTrackMute(trackId) {
        const node = ensureTrackNode(trackId);
        node.muted = !node.muted;
        updateTrackGains();
        return node.muted;
    }

    function setTrackSolo(trackId, solo) {
        const node = ensureTrackNode(trackId);
        node.solo = !!solo;
        updateTrackGains();
    }

    function toggleTrackSolo(trackId) {
        const node = ensureTrackNode(trackId);
        node.solo = !node.solo;
        updateTrackGains();
        return node.solo;
    }

    function updateTrackGains() {
        // Determine if any track has solo enabled
        const hasSolo = Object.values(_trackNodes).some(n => n.solo);

        for (const [trackId, node] of Object.entries(_trackNodes)) {
            let effectiveVolume = node.volume;

            if (node.muted) {
                effectiveVolume = 0;
            } else if (hasSolo && !node.solo) {
                effectiveVolume = 0;
            }

            if (node.gainNode) {
                node.gainNode.gain.setValueAtTime(effectiveVolume, _audioContext.currentTime);
            }
        }
    }

    function setMasterVolume(volume) {
        _masterVolume = Math.max(0, Math.min(1, volume));
        if (_masterGain) {
            _masterGain.gain.setValueAtTime(_masterVolume, _audioContext.currentTime);
        }
    }

    function getMasterVolume() {
        return _masterVolume;
    }

    let _activeBeepOsc = null;
    let _activeBeepGain = null;

    function startRealtimeBeep() {
        if (_activeBeepOsc) return;
        const ctx = getContext();
        _activeBeepOsc = ctx.createOscillator();
        _activeBeepGain = ctx.createGain();
        _activeBeepOsc.type = 'sine';
        _activeBeepOsc.frequency.setValueAtTime(1000, ctx.currentTime);
        _activeBeepGain.gain.setValueAtTime(0.15, ctx.currentTime);
        _activeBeepOsc.connect(_activeBeepGain);
        _activeBeepGain.connect(_masterGain);
        _activeBeepOsc.start();
    }

    function stopRealtimeBeep() {
        if (_activeBeepOsc) {
            try {
                _activeBeepOsc.stop();
            } catch(e) {}
            _activeBeepOsc = null;
            _activeBeepGain = null;
        }
    }

    function getTrackState(trackId) {
        return _trackNodes[trackId] || null;
    }

    /**
     * Interpolates volume from keyframes
     */
    function getAutomatedVolume(clip, clipLocalTime) {
        if (!clip.gainAutomation || clip.gainAutomation.length === 0) {
            return clip.volume !== undefined ? clip.volume : 1.0;
        }
        const keyframes = [...clip.gainAutomation].sort((a, b) => a.time - b.time);
        if (clipLocalTime <= keyframes[0].time) {
            return keyframes[0].volume;
        }
        if (clipLocalTime >= keyframes[keyframes.length - 1].time) {
            return keyframes[keyframes.length - 1].volume;
        }
        for (let i = 0; i < keyframes.length - 1; i++) {
            const k1 = keyframes[i];
            const k2 = keyframes[i + 1];
            if (clipLocalTime >= k1.time && clipLocalTime <= k2.time) {
                const pct = (clipLocalTime - k1.time) / (k2.time - k1.time);
                return k1.volume + pct * (k2.volume - k1.volume);
            }
        }
        return clip.volume !== undefined ? clip.volume : 1.0;
    }

    /**
     * Apply fade envelope to a clip's volume at a specific local time.
     * Returns the faded volume multiplier.
     */
    function computeFadeVolume(clip, clipLocalTime) {
        let multiplier = 1.0;
        const fadeIn = clip.fadeIn || 0;
        const fadeOut = clip.fadeOut || 0;

        if (fadeIn > 0 && clipLocalTime < fadeIn) {
            multiplier *= (clipLocalTime / fadeIn);
        }

        const remaining = clip.duration - clipLocalTime;
        if (fadeOut > 0 && remaining < fadeOut) {
            multiplier *= (remaining / fadeOut);
        }

        return Math.max(0, Math.min(1, multiplier));
    }

    /**
     * Compute the final volume for a clip considering track volume, mute, solo, fades, gain automation, ducking, censor beeps, and automatic crossfades.
     */
    function computeClipVolume(trackId, clip, clipLocalTime) {
        const node = ensureTrackNode(trackId);
        const hasSolo = Object.values(_trackNodes).some(n => n.solo);

        if (node.muted || (hasSolo && !node.solo)) return 0;
        if (clip.muted) return 0;

        // 1. Gain automation
        let baseVol = getAutomatedVolume(clip, clipLocalTime);

        // 2. Fades
        const fadeMultiplier = computeFadeVolume(clip, clipLocalTime);

        // 3. Audio Ducking
        let duckMultiplier = 1.0;
        const globalTime = clip.startTime + clipLocalTime;
        const state = window.state;
        if (state && !clip.isVoice && trackId === 'audioTrack') {
            let isVoicePlaying = false;
            let duckAmount = clip.duckAmount !== undefined ? clip.duckAmount : 0.7; // ducks to 30% level by default
            state.tracks.forEach(t => {
                t.clips.forEach(c => {
                    if (c.isVoice && globalTime >= c.startTime && globalTime < c.startTime + c.duration) {
                        isVoicePlaying = true;
                    }
                });
            });
            if (isVoicePlaying) {
                duckMultiplier = (1.0 - duckAmount);
            }
        }

        // 4. Automatic Crossfade for overlapping clips on the same track
        let crossfadeMultiplier = 1.0;
        if (state) {
            const track = state.tracks.find(t => t.id === trackId);
            if (track) {
                // Find overlapping clip starting after this one (fade out)
                const nextClip = track.clips.find(c => c.id !== clip.id && c.startTime > clip.startTime && c.startTime < clip.startTime + clip.duration);
                if (nextClip) {
                    const overlapStart = nextClip.startTime;
                    const overlapEnd = clip.startTime + clip.duration;
                    const overlapDuration = overlapEnd - overlapStart;
                    if (globalTime >= overlapStart && globalTime < overlapEnd && overlapDuration > 0) {
                        const progress = (globalTime - overlapStart) / overlapDuration;
                        crossfadeMultiplier = 1.0 - progress; // Fade out
                    }
                }
                // Find overlapping clip starting before this one (fade in)
                const prevClip = track.clips.find(c => c.id !== clip.id && c.startTime < clip.startTime && c.startTime + c.duration > clip.startTime);
                if (prevClip) {
                    const overlapStart = clip.startTime;
                    const overlapEnd = prevClip.startTime + prevClip.duration;
                    const overlapDuration = overlapEnd - overlapStart;
                    if (globalTime >= overlapStart && globalTime < overlapEnd && overlapDuration > 0) {
                        const progress = (globalTime - overlapStart) / overlapDuration;
                        crossfadeMultiplier = progress; // Fade in
                    }
                }
            }
        }

        // 5. Censor Beep (Silence during beep)
        if (clip.censorBeeps) {
            const inBeep = clip.censorBeeps.some(beep => 
                clipLocalTime >= beep.startTime && clipLocalTime < beep.startTime + beep.duration
            );
            if (inBeep) return 0;
        }

        const gainVal = clip.gain !== undefined ? clip.gain : 1.0;
        const normalizeMultiplier = clip.normalize ? 1.4 : 1.0;
        return baseVol * fadeMultiplier * duckMultiplier * crossfadeMultiplier * node.volume * _masterVolume * gainVal * normalizeMultiplier;
    }

    /**
     * Create an OfflineAudioContext for export rendering.
     * Mix all audio tracks into a single stereo buffer.
     */
    async function renderOfflineAudio(tracks, duration, sampleRate) {
        sampleRate = sampleRate || 44100;
        const numSamples = Math.ceil(duration * sampleRate);
        const offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);
        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        const promises = [];

        tracks.forEach(track => {
            if (track.type !== 'audio') return;

            track.clips.forEach(clip => {
                const asset = ME ? ME.getAsset(clip.assetId) : null;
                if (!asset || !asset.file) return;

                const p = new Promise(async (resolve) => {
                    try {
                        const arrayBuffer = await asset.file.arrayBuffer();
                        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                        const source = offlineCtx.createBufferSource();
                        source.buffer = audioBuffer;

                        const gainNode = offlineCtx.createGain();
                        
                        // Schedule automated volume values at small step intervals
                        const clipStart = clip.startTime;
                        const clipDuration = clip.duration;
                        const step = 0.05;
                        
                        const startVol = computeClipVolume(track.id, clip, 0);
                        gainNode.gain.setValueAtTime(startVol, clipStart);

                        for (let t = 0; t < clipDuration; t += step) {
                            const vol = computeClipVolume(track.id, clip, t);
                            gainNode.gain.linearRampToValueAtTime(vol, clipStart + t);
                        }
                        
                        const endVol = computeClipVolume(track.id, clip, clipDuration);
                        gainNode.gain.linearRampToValueAtTime(endVol, clipStart + clipDuration);
                        gainNode.gain.setValueAtTime(0, clipStart + clipDuration + 0.01);

                        source.connect(gainNode);
                        let lastNode = gainNode;
                        if (clip.balance !== undefined && clip.balance !== 0 && offlineCtx.createStereoPanner) {
                            const panner = offlineCtx.createStereoPanner();
                            panner.pan.setValueAtTime(clip.balance, clipStart);
                            lastNode.connect(panner);
                            lastNode = panner;
                        }
                        lastNode.connect(offlineCtx.destination);

                        const trimStart = clip.trimStart || 0;
                        source.start(clip.startTime, trimStart, clip.duration);

                        // Censor beep oscillators in offline render
                        if (clip.censorBeeps) {
                            clip.censorBeeps.forEach(beep => {
                                const beepStart = clip.startTime + beep.startTime;
                                const beepEnd = beepStart + beep.duration;

                                const osc = offlineCtx.createOscillator();
                                osc.frequency.setValueAtTime(1000, beepStart);
                                
                                const oscGain = offlineCtx.createGain();
                                oscGain.gain.setValueAtTime(0.15, beepStart);
                                oscGain.gain.setValueAtTime(0.15, beepEnd - 0.01);
                                oscGain.gain.linearRampToValueAtTime(0, beepEnd);

                                osc.connect(oscGain);
                                oscGain.connect(offlineCtx.destination);

                                osc.start(beepStart);
                                osc.stop(beepEnd);
                            });
                        }
                    } catch (e) {
                        console.warn('[AudioEngine] Offline render clip error:', e);
                    }
                    resolve();
                });
                promises.push(p);
            });
        });

        await Promise.all(promises);

        try {
            const renderedBuffer = await offlineCtx.startRendering();
            return renderedBuffer;
        } catch (e) {
            console.error('[AudioEngine] Offline render failed:', e);
            return null;
        }
    }

    function clearAll() {
        _trackNodes = {};
        if (_audioContext) {
            _audioContext.close().catch(() => {});
            _audioContext = null;
            _masterGain = null;
        }
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.AudioEngine = {
        getContext, resume,
        ensureTrackNode,
        setTrackVolume, setTrackMute, toggleTrackMute,
        setTrackSolo, toggleTrackSolo,
        setMasterVolume, getMasterVolume,
        getTrackState,
        computeFadeVolume, computeClipVolume,
        renderOfflineAudio,
        clearAll,
        startRealtimeBeep,
        stopRealtimeBeep
    };
})();
