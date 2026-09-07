/**
 * ForgeCut editor — Clipboard, edit actions, text/shape properties, transitions
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    // Clipboard & Edit Actions
    let clipboardClip = null;

    window.timelineCopy = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to copy.');
            return;
        }
        let selectedClip = null;
        state.tracks.forEach(track => {
            const found = track.clips.find(c => c.id === state.selectedClipId);
            if (found) selectedClip = found;
        });
        if (selectedClip) {
            clipboardClip = JSON.parse(JSON.stringify(selectedClip));
            console.log('Copied clip:', clipboardClip);
        }
    };

    window.timelineCut = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to cut.');
            return;
        }
        saveStateToHistory();
        window.timelineCopy();
        window.timelineDeleteSelected();
    };

    window.timelinePaste = function () {
        if (!clipboardClip) {
            fcToast('Clipboard is empty. Copy a clip first.');
            return;
        }
        saveStateToHistory();
        let pasted = false;
        state.tracks.forEach(track => {
            if (!pasted && ((track.type === 'video' && clipboardClip.assetId && assetCache.get(clipboardClip.assetId)?.element?.videoWidth) ||
                (track.type === 'audio' && clipboardClip.assetId && !assetCache.get(clipboardClip.assetId)?.element?.videoWidth) ||
                (track.type === 'text' && !clipboardClip.assetId))) {
                const newClip = JSON.parse(JSON.stringify(clipboardClip));
                newClip.id = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                newClip.startTime = state.currentTime;
                track.clips.push(newClip);
                state.selectedClipId = newClip.id;
                pasted = true;
            }
        });
        if (!pasted) {
            const newClip = JSON.parse(JSON.stringify(clipboardClip));
            newClip.id = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            newClip.startTime = state.currentTime;
            state.tracks[0].clips.push(newClip);
            state.selectedClipId = newClip.id;
        }
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    };

    window.timelineDuplicate = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to duplicate.');
            return;
        }
        saveStateToHistory();
        let selectedClip = null;
        let selectedTrack = null;
        state.tracks.forEach(track => {
            const found = track.clips.find(c => c.id === state.selectedClipId);
            if (found) {
                selectedClip = found;
                selectedTrack = track;
            }
        });
        if (selectedClip && selectedTrack) {
            const newClip = JSON.parse(JSON.stringify(selectedClip));
            newClip.id = 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            newClip.startTime = selectedClip.startTime + selectedClip.duration;
            selectedTrack.clips.push(newClip);
            state.selectedClipId = newClip.id;
            renderTimeline();
            updateInspector();
            renderCanvasComposition();
            syncMediaPlayback();
        }
    };

    window.triggerSplit = function () {
        if (state.selectedClipId) {
            saveStateToHistory();
            splitClipAtPlayhead(state.selectedClipId);
        } else {
            fcToast('Please select a clip to split.');
        }
    };

    window.triggerTrim = function () {
        fcToast('Trim tool active. You can drag the left or right edges of any clip on the timeline to trim its duration.');
    };

    window.timelineRippleDelete = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to ripple delete.');
            return;
        }
        saveStateToHistory();
        let selectedClip = null;
        let selectedTrack = null;
        state.tracks.forEach(track => {
            const found = track.clips.find(c => c.id === state.selectedClipId);
            if (found) {
                selectedClip = found;
                selectedTrack = track;
            }
        });
        if (selectedClip && selectedTrack) {
            const shiftAmount = selectedClip.duration;
            const deletedStartTime = selectedClip.startTime;

            selectedTrack.clips = selectedTrack.clips.filter(c => c.id !== state.selectedClipId);
            selectedTrack.clips.forEach(clip => {
                if (clip.startTime > deletedStartTime) {
                    clip.startTime = Math.max(0, clip.startTime - shiftAmount);
                }
            });

            state.selectedClipId = null;
            renderTimeline();
            updateInspector();
            renderCanvasComposition();
            syncMediaPlayback();
        }
    };

    window.timelineDeleteSelected = async function () {
        if (state.selectedClipId) {
            saveStateToHistory();

            let clipToDelete = null;
            state.tracks.forEach(track => {
                const found = track.clips.find(c => c.id === state.selectedClipId);
                if (found) clipToDelete = found;
            });

            if (clipToDelete) {
                let deleteLinked = false;
                if (clipToDelete.linkedClipId) {
                    let trackType = '';
                    state.tracks.forEach(track => {
                        if (track.clips.includes(clipToDelete)) trackType = track.type;
                    });
                    if (trackType === 'video') {
                        deleteLinked = await fcConfirm("Do you also want to delete the linked audio clip?", { okLabel: 'Delete both', cancelLabel: 'Keep audio' });
                    }
                }

                state.tracks.forEach(track => {
                    track.clips = track.clips.filter(c => {
                        if (c.id === clipToDelete.id) return false;
                        if (deleteLinked && c.id === clipToDelete.linkedClipId) return false;
                        return true;
                    });
                });
            }

            state.selectedClipId = null;
            renderTimeline();
            updateInspector();
            renderCanvasComposition();
            syncMediaPlayback();
        } else {
            fcToast('Please select a clip to delete.');
        }
    };

    window.toggleSnapping = function () {
        state.snapEnabled = !state.snapEnabled;
        const btn = document.getElementById('snapBtn');
        if (btn) {
            btn.classList.toggle('text-primary', state.snapEnabled);
            btn.classList.toggle('text-on-surface-variant', !state.snapEnabled);
        }
    };

    window.rippleDeleteSelected = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to delete.');
            return;
        }
        const clip = findClipById(state.selectedClipId);
        if (!clip) return;
        const track = state.tracks.find(t => t.clips.includes(clip));
        if (!track || state.trackLock[track.id]) return;

        saveStateToHistory();

        const deleteStart = clip.startTime;
        const deleteDuration = clip.duration;

        // Delete the clip and linked clip
        const deleteLinked = clip.linkedClipId ? findClipById(clip.linkedClipId) : null;

        state.tracks.forEach(t => {
            t.clips = t.clips.filter(c => c.id !== clip.id && (!deleteLinked || c.id !== deleteLinked.id));
        });

        // Shift subsequent clips on the same track or linked tracks
        state.tracks.forEach(t => {
            if (state.trackLock[t.id]) return;
            t.clips.forEach(c => {
                if (c.startTime >= deleteStart) {
                    c.startTime = Math.max(0, c.startTime - deleteDuration);
                }
            });
        });

        state.selectedClipId = null;
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    };

    window.toggleTrackMuteBtn = function (trackId) {
        if (window.ForgeCut && window.ForgeCut.AudioEngine) {
            const muted = window.ForgeCut.AudioEngine.toggleTrackMute(trackId);
            const btn = document.getElementById(`mute-${trackId}`);
            if (btn) {
                btn.classList.toggle('bg-red-600', muted);
                btn.classList.toggle('text-white', muted);
                btn.classList.toggle('bg-surface-container-highest', !muted);
                btn.classList.toggle('text-on-surface-variant', !muted);
            }
            syncMediaPlayback();
        }
    };

    window.toggleTrackSoloBtn = function (trackId) {
        if (window.ForgeCut && window.ForgeCut.AudioEngine) {
            const solo = window.ForgeCut.AudioEngine.toggleTrackSolo(trackId);
            const btn = document.getElementById(`solo-${trackId}`);
            if (btn) {
                btn.classList.toggle('bg-yellow-500', solo);
                btn.classList.toggle('text-black', solo);
                btn.classList.toggle('bg-surface-container-highest', !solo);
                btn.classList.toggle('text-on-surface-variant', !solo);
            }
            // Also update other tracks' visual states since solo affects them
            state.tracks.forEach(t => {
                if (t.id !== trackId) {
                    const otherSolo = window.ForgeCut.AudioEngine.getTrackState(t.id)?.solo;
                    const otherBtn = document.getElementById(`solo-${t.id}`);
                    if (otherBtn) {
                        otherBtn.classList.toggle('bg-yellow-500', !!otherSolo);
                        otherBtn.classList.toggle('text-black', !!otherSolo);
                        otherBtn.classList.toggle('bg-surface-container-highest', !otherSolo);
                        otherBtn.classList.toggle('text-on-surface-variant', !otherSolo);
                    }
                }
            });
            syncMediaPlayback();
        }
    };

    window.changeTrackVolumeBtn = function (trackId, value) {
        if (window.ForgeCut && window.ForgeCut.AudioEngine) {
            window.ForgeCut.AudioEngine.setTrackVolume(trackId, value / 100);
            syncMediaPlayback();
        }
    };

    window.normalizeClipVolume = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        const asset = assetCache.get(clip.assetId);
        if (asset && asset.waveform && asset.waveform.length > 0) {
            const peak = Math.max(...asset.waveform, 0.05);
            clip.volume = Math.min(2.0, 0.95 / peak);
            updateInspector();
            syncMediaPlayback();
        } else {
            clip.volume = 1.2;
            updateInspector();
            syncMediaPlayback();
        }
    };

    window.addVolumeKeyframeAtPlayhead = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        const playheadLocal = state.currentTime - clip.startTime;
        if (playheadLocal < 0 || playheadLocal > clip.duration) {
            fcToast('Playhead is outside the selected clip.');
            return;
        }
        if (!clip.gainAutomation) clip.gainAutomation = [];

        // Add or update keyframe
        const existingIdx = clip.gainAutomation.findIndex(kf => Math.abs(kf.time - playheadLocal) < 0.1);
        const vol = clip.volume !== undefined ? clip.volume : 1.0;
        if (existingIdx >= 0) {
            clip.gainAutomation[existingIdx].volume = vol;
        } else {
            clip.gainAutomation.push({ time: playheadLocal, volume: vol });
        }
        clip.gainAutomation.sort((a, b) => a.time - b.time);
        updateInspector();
        syncMediaPlayback();
    };

    window.deleteVolumeKeyframe = function (clipId, index) {
        const clip = findClipById(clipId);
        if (!clip || !clip.gainAutomation) return;
        clip.gainAutomation.splice(index, 1);
        updateInspector();
        syncMediaPlayback();
    };

    window.toggleClipVoice = function (clipId, checked) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.isVoice = checked;
        updateInspector();
        syncMediaPlayback();
    };

    window.changeClipDuckAmount = function (clipId, value) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.duckAmount = value / 100;
        syncMediaPlayback();
    };

    window.addCensorBeepAtPlayhead = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        const playheadLocal = state.currentTime - clip.startTime;
        if (playheadLocal < 0 || playheadLocal > clip.duration) {
            fcToast('Playhead is outside the selected clip.');
            return;
        }
        if (!clip.censorBeeps) clip.censorBeeps = [];
        clip.censorBeeps.push({ startTime: playheadLocal, duration: 0.5 });
        updateInspector();
        syncMediaPlayback();
    };

    window.deleteCensorBeep = function (clipId, index) {
        const clip = findClipById(clipId);
        if (!clip || !clip.censorBeeps) return;
        clip.censorBeeps.splice(index, 1);
        updateInspector();
        syncMediaPlayback();
    };

    window.moveClipToTrack = function (clipId, targetTrackId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        const sourceTrack = state.tracks.find(t => t.clips.includes(clip));
        if (!sourceTrack || sourceTrack.id === targetTrackId) return;

        saveStateToHistory();

        sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clipId);

        const targetTrack = state.tracks.find(t => t.id === targetTrackId);
        if (targetTrack) {
            targetTrack.clips.push(clip);
        }

        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    };

    function findClipAtCoordinate(mouseX, mouseY) {
        let foundClip = null;
        const tracksCopy = [...state.tracks].reverse();
        for (let track of tracksCopy) {
            if (state.trackVisibility[track.id] === false) continue;
            for (let clip of track.clips) {
                const inRange = state.currentTime >= clip.startTime && state.currentTime <= (clip.startTime + clip.duration);
                if (!inRange) continue;

                let w = 200, h = 100;
                if (track.type === 'video' || track.type === 'image') {
                    const asset = assetCache.get(clip.assetId);
                    if (asset && asset.element) {
                        const el = asset.element;
                        const fullW = clip.cropW !== undefined ? clip.cropW : (el.videoWidth || el.width || 320);
                        const fullH = clip.cropH !== undefined ? clip.cropH : (el.videoHeight || el.height || 180);
                        w = fullW * (clip.scale || 1.0);
                        h = fullH * (clip.scale || 1.0);
                    }
                } else if (track.type === 'text') {
                    const size = clip.size || 72;
                    w = (clip.text ? clip.text.length : 5) * size * 0.5;
                    h = size;
                } else if (track.type === 'shape') {
                    w = clip.shapeWidth || 200;
                    h = clip.shapeHeight || 150;
                }

                const cx = clip.x !== undefined ? clip.x : canvas.width / 2;
                const cy = clip.y !== undefined ? clip.y : canvas.height / 2;
                const rad = (clip.rotation || 0) * Math.PI / 180;
                const cos = Math.cos(-rad);
                const sin = Math.sin(-rad);
                const rx = (mouseX - cx) * cos - (mouseY - cy) * sin;
                const ry = (mouseX - cx) * sin + (mouseY - cy) * cos;

                if (rx >= -w / 2 && rx <= w / 2 && ry >= -h / 2 && ry <= h / 2) {
                    foundClip = clip;
                    break;
                }
            }
            if (foundClip) break;
        }
        return foundClip;
    }

    window.toggleCanvasFullScreen = function () {
        const el = document.getElementById('previewPanelWrapper');
        if (!el) return;
        if (!document.fullscreenElement) {
            el.requestFullscreen().catch(err => {
                console.error('Error entering fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    };

    window.toggleTextWeight = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.fontWeight = clip.fontWeight === 'bold' ? 'normal' : 'bold';
        updateInspector();
        renderCanvasComposition();
    };

    window.toggleTextItalic = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.italic = !clip.italic;
        updateInspector();
        renderCanvasComposition();
    };

    window.toggleTextUnderline = function (clipId) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.underline = !clip.underline;
        updateInspector();
        renderCanvasComposition();
    };

    window.changeTextColorMode = function (clipId, mode) {
        const clip = findClipById(clipId);
        if (!clip) return;
        clip.colorType = mode;
        updateInspector();
        renderCanvasComposition();
    };

    window.importCustomFontFile = async function (event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const fontName = file.name.substring(0, file.name.lastIndexOf('.')).replace(/[^a-zA-Z0-9]/g, '_');
            const arrayBuffer = await file.arrayBuffer();

            const fontFace = new FontFace(fontName, arrayBuffer);
            const loadedFace = await fontFace.load();
            document.fonts.add(loadedFace);

            if (!state.customFonts) state.customFonts = [];
            if (!state.customFonts.includes(fontName)) {
                state.customFonts.push(fontName);
            }

            const activeClip = findClipById(state.selectedClipId);
            if (activeClip && activeClip.text !== undefined) {
                activeClip.font = fontName;
            }

            updateInspector();
            renderCanvasComposition();
            fcToast(`Font '${fontName}' imported and registered successfully!`);
        } catch (e) {
            console.error('[FontManager] Font import failed:', e);
            fcToast('Failed to load custom font file. Please ensure it is a valid .ttf or .otf file.');
        }
    };

    window.changeShapeFillType = function (clipId, type) {
        const clip = findClipById(clipId);
        if (!clip) return;
        if (!clip.shapeProps) clip.shapeProps = {};
        clip.shapeProps.fillType = type;
        updateInspector();
        renderCanvasComposition();
    };

    window.changeShapePatternType = function (clipId, type) {
        const clip = findClipById(clipId);
        if (!clip) return;
        if (!clip.shapeProps) clip.shapeProps = {};
        clip.shapeProps.patternType = type;
        renderCanvasComposition();
    };

    window.changeShapeStrokeStyle = function (clipId, style) {
        const clip = findClipById(clipId);
        if (!clip) return;
        if (!clip.shapeProps) clip.shapeProps = {};
        clip.shapeProps.strokeStyle = style;
        renderCanvasComposition();
    };

    window.toggleShapeReflection = function (clipId, checked) {
        const clip = findClipById(clipId);
        if (!clip) return;
        if (!clip.shapeProps) clip.shapeProps = {};
        clip.shapeProps.reflection = checked;
        renderCanvasComposition();
    };

    window.uploadShapeFillImage = function (clipId, event) {
        const file = event.target.files[0];
        if (!file) return;
        const clip = findClipById(clipId);
        if (!clip) return;
        if (!clip.shapeProps) clip.shapeProps = {};

        const reader = new FileReader();
        reader.onload = function (e) {
            clip.shapeProps.fillImage = e.target.result;
            clip.shapeProps.fillImageElement = null; // reset cache
            const input = document.getElementById('insp_shape_fill_image');
            if (input) input.value = e.target.result;
            renderCanvasComposition();
        };
        reader.readAsDataURL(file);
    };

    // Transitions & Animations Settings
    window.setTransition = function (type) {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to apply the transition.');
            return;
        }
        saveStateToHistory();
        let applied = false;
        state.tracks.forEach(track => {
            const found = track.clips.find(c => c.id === state.selectedClipId);
            if (found) {
                found.transition = type;
                const durationInput = document.getElementById('transitionDurationInput');
                if (durationInput) {
                    found.transitionDuration = parseFloat(durationInput.value) || 1.5;
                }
                applied = true;
            }
        });
        if (applied) {
            renderTimeline();
            renderCanvasComposition();
            updateInspector();
        }
    };

    window.updateTransitionDuration = function (val) {
        if (!state.selectedClipId) return;
        const clip = findClipById(state.selectedClipId);
        if (clip) {
            clip.transitionDuration = parseFloat(val) || 1.0;
            renderTimeline();
            renderCanvasComposition();
        }
    };

    window.setAnimation = function (phase, type) {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to apply the animation.');
            return;
        }
        saveStateToHistory();
        let applied = false;
        state.tracks.forEach(track => {
            const found = track.clips.find(c => c.id === state.selectedClipId);
            if (found) {
                if (!found.animations) found.animations = {};
                found.animations[phase] = type;
                applied = true;
            }
        });
        if (applied) {
            fcToast(`${phase} animation set to: ${type}`);
            updateInspector();
        }
    };
