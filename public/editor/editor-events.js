/**
 * ForgeCut editor — Global event wiring (initEventListeners)
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
function initEventListeners() {
    window.addEventListener('resize', recalculateCanvasDisplaySize);

    const timelineContainer = document.getElementById('timelineContainer');
    const rulerScrollParent = document.getElementById('rulerScrollParent');
    if (timelineContainer) {
        timelineContainer.addEventListener('scroll', () => {
            if (rulerScrollParent) {
                rulerScrollParent.scrollLeft = timelineContainer.scrollLeft;
            }
            renderTracks();
        });
    }

    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', togglePlay);
    }

    // Zoom controls
    const zoomIn = document.getElementById('zoomInBtn');
    if (zoomIn) {
        zoomIn.addEventListener('click', () => adjustZoom(5));
    }
    const zoomOut = document.getElementById('zoomOutBtn');
    if (zoomOut) {
        zoomOut.addEventListener('click', () => adjustZoom(-5));
    }

    const footerZoom = document.getElementById('footerZoomSlider');
    if (footerZoom) {
        footerZoom.addEventListener('input', (e) => {
            state.zoom = parseInt(e.target.value);
            const label = document.getElementById('footerZoomLabel');
            if (label) label.textContent = `${state.zoom}%`;
            renderTimeline();
        });
    }

    const showTimingCheckbox = document.getElementById('showTimingCheckbox');
    if (showTimingCheckbox) {
        showTimingCheckbox.addEventListener('change', (e) => {
            state.snapEnabled = e.target.checked;
        });
    }

    // Seek Timeline via Ruler
    isScrubbing = false;
    if (timelineRuler) {
        timelineRuler.addEventListener('mousedown', (e) => {
            isScrubbing = true;
            scrub(e);
        });
        timelineRuler.addEventListener('mousemove', (e) => {
            const rect = timelineRuler.getBoundingClientRect();
            const clientX = e.clientX - rect.left;
            const hoverTime = clientX / state.zoom;

            const format = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                const ms = Math.floor((seconds % 1) * 100);
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
            };

            const tooltip = document.getElementById('timelineTooltip');
            if (tooltip) {
                tooltip.textContent = format(Math.max(0, hoverTime));
                tooltip.style.left = `${e.clientX + 10}px`;
                tooltip.style.top = `${e.clientY - 25}px`;
                tooltip.style.position = 'fixed';
                tooltip.classList.remove('hidden');
            }
        });
        timelineRuler.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('timelineTooltip');
            if (tooltip) tooltip.classList.add('hidden');
        });
    }
    document.addEventListener('mousemove', (e) => {
        if (isScrubbing) scrub(e);
    });
    document.addEventListener('mouseup', () => {
        isScrubbing = false;
    });

    function scrub(e) {
        if (!timelineRuler) return;
        const rect = timelineRuler.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        let targetSeconds = clientX / state.zoom;
        // Snap to nearest frame boundary (25fps -> 0.04s)
        targetSeconds = Math.round(targetSeconds / 0.04) * 0.04;
        setTime(targetSeconds);
    }

    // Bulk Rendering CSV Upload
    const bulkCsvFileInput = document.getElementById('bulkCsvFileInput');
    if (bulkCsvFileInput) {
        bulkCsvFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Papa.parse(e.target.files[0], {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results) => {
                        state.csvData = results.data;
                        if (results.meta && results.meta.fields) {
                            state.placeholders = results.meta.fields.map(f => f.trim()).filter(Boolean);
                            renderPlaceholders();
                        }
                        renderRowSelector();
                        renderQueueList();
                        if (state.csvData.length > 0) {
                            state.selectedRowIndex = 0;
                            selectRow(0);
                        }
                        if (typeof window.initBatchJobs === 'function') {
                            window.initBatchJobs();
                        }
                        if (typeof window.openBulkDrawer === 'function') {
                            window.openBulkDrawer();
                        }
                    }
                });
            }
        });
    }

    const bulkDownloadTemplateBtn = document.getElementById('bulkDownloadTemplateBtn');
    if (bulkDownloadTemplateBtn) {
        bulkDownloadTemplateBtn.addEventListener('click', () => {
            const headers = state.placeholders.join(',');
            const sampleRow = state.placeholders.map(ph => `Sample ${ph}`).join(',');
            const csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + sampleRow;
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "ForgeCut_Template.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    // Micro Playback controls below Canvas
    const prevFrameBtn = document.getElementById('prevFrameBtn');
    if (prevFrameBtn) {
        prevFrameBtn.addEventListener('click', () => setTime(state.currentTime - 1 / 30));
    }
    const nextFrameBtn = document.getElementById('nextFrameBtn');
    if (nextFrameBtn) {
        nextFrameBtn.addEventListener('click', () => setTime(state.currentTime + 1 / 30));
    }

    const volSlider = document.getElementById('volumeSlider');
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value) / 100;
            state.tracks.forEach(track => {
                track.clips.forEach(clip => {
                    if (track.type === 'audio') {
                        clip.volume = vol;
                        const asset = assetCache.get(clip.assetId);
                        if (asset && asset.element) {
                            asset.element.volume = vol;
                        }
                    }
                });
            });
        });
    }

    // Replace Text Label controls
    const addLabelBtn = document.getElementById('addLabelBtn');
    const linkLabelBtn = document.getElementById('linkLabelBtn');
    const labelTextMask = document.getElementById('labelTextMask');

    if (addLabelBtn && labelTextMask) {
        addLabelBtn.addEventListener('click', () => {
            const val = labelTextMask.value.trim().replaceAll(/[{}]/g, '');
            if (val) {
                if (!state.placeholders.includes(val)) {
                    state.placeholders.push(val);
                    renderPlaceholders();
                }
                addNewTextClipWithPlaceholder(val);
                labelTextMask.value = '';
            } else {
                fcToast('Please enter a label name!');
            }
        });
    }

    if (linkLabelBtn && labelTextMask) {
        linkLabelBtn.addEventListener('click', () => {
            const val = labelTextMask.value.trim().replaceAll(/[{}]/g, '');
            if (val) {
                if (!state.placeholders.includes(val)) {
                    state.placeholders.push(val);
                    renderPlaceholders();
                }
                if (state.selectedClipId) {
                    const clip = findClipById(state.selectedClipId);
                    if (clip) {
                        const track = state.tracks.find(t => t.clips.includes(clip));
                        if (track && track.type === 'text') {
                            clip.text = `{{${val}}}`;
                            clip.name = val;
                            renderTimeline();
                            updateInspector();
                        } else {
                            fcToast('Please select a text clip to link!');
                        }
                    }
                } else {
                    fcToast('Please select a text clip to link!');
                }
                labelTextMask.value = '';
            } else {
                fcToast('Please enter a label name!');
            }
        });
    }

    // Safe Zones design tab btn
    const toggleSafeAreaBtnDesign = document.getElementById('toggleSafeAreaBtnDesign');
    if (toggleSafeAreaBtnDesign) {
        let isSafeAreaVisible = false;
        toggleSafeAreaBtnDesign.addEventListener('click', () => {
            isSafeAreaVisible = !isSafeAreaVisible;
            document.getElementById('safeAreaGuide').classList.toggle('hidden', !isSafeAreaVisible);
            toggleSafeAreaBtnDesign.classList.toggle('active', isSafeAreaVisible);
        });
    }

    // Queue actions in Right panel
    const queueSelectAllBtn = document.getElementById('queueSelectAllBtn');
    if (queueSelectAllBtn) {
        let allSelected = true;
        queueSelectAllBtn.addEventListener('click', () => {
            allSelected = !allSelected;
            state.batchSelection = state.csvData.map(() => allSelected);
            renderQueueList();
            if (document.getElementById('batchGalleryOverlay').style.display !== 'none') {
                renderBatchGalleryGrid();
            }
        });
    }

    const queueAddBtn = document.getElementById('queueAddBtn');
    if (queueAddBtn) {
        queueAddBtn.addEventListener('click', addNewBatchVariation);
    }

    const queueExportBtn = document.getElementById('queueExportBtn');
    if (queueExportBtn) {
        queueExportBtn.addEventListener('click', exportSelectedVariations);
    }

    // Drag-Drop Move/Trim Timeline Logic
    activeDrag = null;
    if (tracksContainer) {
        tracksContainer.addEventListener('mousedown', (e) => {
            const clipEl = e.target.closest('.timeline-clip');
            if (!clipEl) return;

            const clipId = clipEl.dataset.clipId;
            const clip = findClipById(clipId);
            if (!clip) return;

            const track = state.tracks.find(t => t.clips.includes(clip));
            if (state.trackLock[track.id]) return; // ignore locked tracks

            const isCtrl = e.ctrlKey || e.metaKey || e.shiftKey;
            selectClip(clipId, isCtrl);

            let dragType = 'move';
            if (e.target.classList.contains('trim-handle-left')) {
                dragType = 'trim-left';
            } else if (e.target.classList.contains('trim-handle-right')) {
                dragType = 'trim-right';
            } else if (e.target.closest('.transition-handle')) {
                dragType = 'transition-drag';
            }

            const startTimes = {};
            if (state.selectedClipIds) {
                state.selectedClipIds.forEach(id => {
                    const c = findClipById(id);
                    if (c) startTimes[id] = c.startTime;
                });
            }

            activeDrag = {
                clipId,
                type: dragType,
                startX: e.clientX,
                startStartTime: clip.startTime,
                startDuration: clip.duration,
                startTrimStart: clip.trimStart || 0,
                startTransitionDuration: clip.transitionDuration || 1.0,
                startTimes
            };

            e.preventDefault();
            e.stopPropagation();
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!activeDrag) return;
        const clip = findClipById(activeDrag.clipId);
        if (!clip) return;

        if (timelineContainer) {
            // Cached per gesture: reading it every mousemove forced a layout
            // flush on each event.
            if (!activeDrag._containerRect) {
                activeDrag._containerRect = timelineContainer.getBoundingClientRect();
            }
            const rect = activeDrag._containerRect;
            const mouseX = e.clientX;
            const threshold = 60;
            if (mouseX > rect.right - threshold) {
                timelineContainer.scrollLeft += 8;
            } else if (mouseX < rect.left + threshold) {
                timelineContainer.scrollLeft -= 8;
            }
        }

        const deltaX = e.clientX - activeDrag.startX;
        const deltaSeconds = deltaX / state.zoom;

        const linkedClip = clip.linkedClipId ? findClipById(clip.linkedClipId) : null;

        if (activeDrag.type === 'move') {
            if (e.altKey) {
                // Slip Edit
                clip.trimStart = Math.max(0, activeDrag.startTrimStart - deltaSeconds);
                clip.startTime = activeDrag.startStartTime;
            } else {
                // Default Slide/Move
                // Drag between tracks: find track row under pointer
                const trackRow = e.target.closest('.timeline-track');
                if (trackRow) {
                    const targetTrackId = trackRow.id.replace('Container', '');
                    const currentTrack = state.tracks.find(t => t.clips.includes(clip));
                    if (currentTrack && currentTrack.id !== targetTrackId) {
                        const targetTrack = state.tracks.find(t => t.id === targetTrackId);
                        if (targetTrack && !state.trackLock[targetTrack.id] && targetTrack.type === currentTrack.type) {
                            currentTrack.clips = currentTrack.clips.filter(c => c.id !== clip.id);
                            targetTrack.clips.push(clip);
                        }
                    }
                }

                // Move all selected clips
                const ids = state.selectedClipIds && state.selectedClipIds.length > 0 ? state.selectedClipIds : [clip.id];
                ids.forEach(id => {
                    const c = findClipById(id);
                    const startStartTime = activeDrag.startTimes ? activeDrag.startTimes[id] : undefined;
                    if (c && startStartTime !== undefined) {
                        let targetStart = startStartTime + deltaSeconds;
                        if (id === activeDrag.clipId) {
                            targetStart = getSnappedTime(targetStart, id);
                            const finalStart = Math.max(0, Math.min(state.duration - c.duration, targetStart));
                            c.startTime = finalStart;

                            // Apply relative offset to other clips
                            const snapOffset = finalStart - (startStartTime + deltaSeconds);
                            ids.forEach(otherId => {
                                if (otherId !== id) {
                                    const otherC = findClipById(otherId);
                                    const otherStart = activeDrag.startTimes[otherId];
                                    if (otherC && otherStart !== undefined) {
                                        otherC.startTime = Math.max(0, Math.min(state.duration - otherC.duration, otherStart + deltaSeconds + snapOffset));
                                    }
                                }
                            });
                        }
                    }
                });
            }
        } else if (activeDrag.type === 'trim-left') {
            if (e.ctrlKey) {
                // Rolling Edit
                const adjacent = track.clips.find(c => Math.abs((c.startTime + c.duration) - clip.startTime) < 0.2);
                if (adjacent) {
                    adjacent.duration += deltaSeconds;
                    clip.startTime += deltaSeconds;
                    clip.duration -= deltaSeconds;
                    clip.trimStart += deltaSeconds;
                }
            } else {
                let targetStart = activeDrag.startStartTime + deltaSeconds;
                targetStart = getSnappedTime(targetStart, clip.id);
                const maxStart = activeDrag.startStartTime + activeDrag.startDuration - 0.5;
                targetStart = Math.max(0, Math.min(maxStart, targetStart));
                const realDelta = targetStart - activeDrag.startStartTime;
                clip.startTime = targetStart;
                clip.duration = activeDrag.startDuration - realDelta;
                clip.trimStart = Math.max(0, activeDrag.startTrimStart + realDelta);
                if (linkedClip) {
                    linkedClip.startTime = targetStart;
                    linkedClip.duration = clip.duration;
                    linkedClip.trimStart = clip.trimStart;
                }
            }
        } else if (activeDrag.type === 'trim-right') {
            if (e.ctrlKey) {
                // Rolling Edit
                const adjacent = track.clips.find(c => Math.abs(c.startTime - (clip.startTime + clip.duration)) < 0.2);
                if (adjacent) {
                    clip.duration += deltaSeconds;
                    adjacent.startTime += deltaSeconds;
                    adjacent.duration -= deltaSeconds;
                    adjacent.trimStart += deltaSeconds;
                }
            } else {
                let targetDuration = activeDrag.startDuration + deltaSeconds;
                let targetEnd = clip.startTime + targetDuration;
                targetEnd = getSnappedTime(targetEnd, clip.id);
                targetDuration = targetEnd - clip.startTime;
                const finalDuration = Math.max(0.5, Math.min(state.duration - clip.startTime, targetDuration));

                if (e.shiftKey) {
                    // Ripple Edit (shift clips on track)
                    const diff = finalDuration - clip.duration;
                    const startOfSubsequent = clip.startTime + clip.duration;
                    track.clips.forEach(c => {
                        if (c.id !== clip.id && c.startTime >= startOfSubsequent) {
                            c.startTime += diff;
                        }
                    });
                }

                clip.duration = finalDuration;
                if (linkedClip) {
                    linkedClip.duration = finalDuration;
                }
            }
        } else if (activeDrag.type === 'transition-drag') {
            const targetDuration = Math.max(0.2, Math.min(clip.duration / 2, activeDrag.startTransitionDuration + deltaSeconds));
            clip.transitionDuration = targetDuration;
        }

        // Coalesced into one paint per frame. This used to rebuild the whole
        // timeline and re-seek every media element on every mousemove.
        scheduleRender({ timeline: true });
    });

    document.addEventListener('mouseup', () => {
        if (activeDrag) {
            saveStateToHistory(`Timeline Drag ${activeDrag.type}`);
            // Media is re-synced once at gesture end rather than per pointer
            // event; seeking elements mid-drag caused audible stutter and
            // races on rapid movement.
            syncMediaPlayback();
        }
        activeDrag = null;
        state.isSnapping = false;
        scheduleRender({ timeline: true, inspector: true });
    });

    // Canvas Move/Scale/Rotate Transform controls
    let activeCanvasDrag = null;
    if (canvas) {
        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

            const isCtrl = e.ctrlKey || e.metaKey;
            const clickedClip = findClipAtCoordinate(mouseX, mouseY);
            if (clickedClip) {
                selectClip(clickedClip.id, isCtrl);
            } else if (!isCtrl) {
                state.selectedClipId = null;
                state.selectedClipIds = [];
                renderTracks();
                updateInspector();
                renderCanvasComposition();
                return;
            }

            let clip = findClipById(state.selectedClipId);
            if (!clip) return;

            let track = state.tracks.find(t => t.clips.includes(clip));
            if (track.type === 'audio' && clip.linkedClipId) {
                const linked = findClipById(clip.linkedClipId);
                if (linked) {
                    const linkedTrack = state.tracks.find(t => t.clips.includes(linked));
                    if (linkedTrack && (linkedTrack.type === 'video' || linkedTrack.type === 'image' || linkedTrack.type === 'text')) {
                        clip = linked;
                        track = linkedTrack;
                    }
                }
            }

            if (state.trackLock[track.id]) return;
            const cx = clip.x !== undefined ? clip.x : canvas.width / 2;
            const cy = clip.y !== undefined ? clip.y : canvas.height / 2;

            let w = 200, h = 100;
            if (track.type === 'video' || track.type === 'image') {
                const asset = assetCache.get(clip.assetId);
                if (asset && asset.element) {
                    const el = asset.element;
                    w = (el.videoWidth || el.width) * (clip.scale || 1.0);
                    h = (el.videoHeight || el.height) * (clip.scale || 1.0);
                }
            } else if (track.type === 'text') {
                const size = clip.size || 72;
                ctx.font = `bold ${size}px ${clip.font || 'Arial'}`;
                w = ctx.measureText(clip.text || '').width + 40;
                h = size + 20;
            } else if (track.type === 'shape') {
                w = clip.shapeWidth || 200;
                h = clip.shapeHeight || 150;
            }

            const rad = (clip.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(-rad);
            const sin = Math.sin(-rad);
            const rx = (mouseX - cx) * cos - (mouseY - cy) * sin;
            const ry = (mouseX - cx) * sin + (mouseY - cy) * cos;

            // Check rotate handle
            const rotYTarget = -h / 2 - 25;
            if (Math.hypot(rx, ry - rotYTarget) < 15) {
                activeCanvasDrag = { clipId: clip.id, type: 'rotate', startX: e.clientX, startY: e.clientY, startRotation: clip.rotation || 0, cx, cy };
                e.preventDefault();
                return;
            }

            // Check 8 scale handles
            const handleSize = 16;
            const isNearHandle = (hx, hy) => Math.abs(rx - hx) < handleSize && Math.abs(ry - hy) < handleSize;

            // Corners (proportional/scale)
            if (isNearHandle(-w / 2, -h / 2) || isNearHandle(w / 2, -h / 2) || isNearHandle(-w / 2, h / 2) || isNearHandle(w / 2, h / 2)) {
                activeCanvasDrag = {
                    clipId: clip.id,
                    type: 'scale-corner',
                    startX: e.clientX,
                    startY: e.clientY,
                    startScale: clip.scale || 1.0,
                    startSize: clip.size || 72,
                    startWidth: clip.shapeWidth || 200,
                    startHeight: clip.shapeHeight || 150
                };
                e.preventDefault();
                return;
            }

            // Edges (width/height resize)
            let edgeType = null;
            if (isNearHandle(0, -h / 2)) edgeType = 'top';
            else if (isNearHandle(0, h / 2)) edgeType = 'bottom';
            else if (isNearHandle(-w / 2, 0)) edgeType = 'left';
            else if (isNearHandle(w / 2, 0)) edgeType = 'right';

            if (edgeType) {
                activeCanvasDrag = {
                    clipId: clip.id,
                    type: 'scale-edge',
                    edge: edgeType,
                    startX: e.clientX,
                    startY: e.clientY,
                    startScale: clip.scale || 1.0,
                    startSize: clip.size || 72,
                    startWidth: clip.shapeWidth || 200,
                    startHeight: clip.shapeHeight || 150
                };
                e.preventDefault();
                return;
            }

            // Check move
            if (Math.abs(rx) < w / 2 && Math.abs(ry) < h / 2) {
                // Support Alt duplicate drag
                if (e.altKey) {
                    saveStateToHistory('Alt Duplicate Drag');
                    const duplicatedIds = [];
                    state.selectedClipIds.forEach(id => {
                        const orig = findClipById(id);
                        if (orig) {
                            const dup = JSON.parse(JSON.stringify(orig));
                            dup.id = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                            dup.startTime = state.currentTime;
                            const tr = state.tracks.find(t => t.clips.includes(orig));
                            if (tr) {
                                tr.clips.push(dup);
                                duplicatedIds.push(dup.id);
                            }
                        }
                    });
                    if (duplicatedIds.length > 0) {
                        state.selectedClipIds = duplicatedIds;
                        state.selectedClipId = duplicatedIds[duplicatedIds.length - 1];
                        clip = findClipById(state.selectedClipId);
                    }
                }

                // Record initial positions of all dragged clips
                const startPositions = {};
                state.selectedClipIds.forEach(id => {
                    const c = findClipById(id);
                    if (c) {
                        startPositions[id] = { x: c.x !== undefined ? c.x : canvas.width / 2, y: c.y !== undefined ? c.y : canvas.height / 2 };
                    }
                });

                activeCanvasDrag = {
                    clipId: clip.id,
                    type: 'move',
                    startX: e.clientX,
                    startY: e.clientY,
                    startPositions
                };
                e.preventDefault();
            }
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!activeCanvasDrag) return;
        const clip = findClipById(activeCanvasDrag.clipId);
        if (!clip) return;

        // Cached per gesture — see the timeline drag above.
        if (!activeCanvasDrag._rect) activeCanvasDrag._rect = canvas.getBoundingClientRect();
        const rect = activeCanvasDrag._rect;
        const deltaX = (e.clientX - activeCanvasDrag.startX) * (canvas.width / rect.width);
        const deltaY = (e.clientY - activeCanvasDrag.startY) * (canvas.height / rect.height);

        const track = state.tracks.find(t => t.clips.includes(clip));

        if (activeCanvasDrag.type === 'move') {
            state.selectedClipIds.forEach(id => {
                const c = findClipById(id);
                const startPos = activeCanvasDrag.startPositions[id];
                if (c && startPos) {
                    c.x = startPos.x + deltaX;
                    c.y = startPos.y + deltaY;
                    if (id === activeCanvasDrag.clipId) {
                        window.applyCanvasSnapping(c);
                        const snapDeltaX = c.x - (startPos.x + deltaX);
                        const snapDeltaY = c.y - (startPos.y + deltaY);
                        state.selectedClipIds.forEach(otherId => {
                            if (otherId !== id) {
                                const otherC = findClipById(otherId);
                                const otherStart = activeCanvasDrag.startPositions[otherId];
                                if (otherC && otherStart) {
                                    otherC.x = otherStart.x + deltaX + snapDeltaX;
                                    otherC.y = otherStart.y + deltaY + snapDeltaY;
                                }
                            }
                        });
                    }
                }
            });
            scheduleRender({ inspector: true });
        } else if (activeCanvasDrag.type === 'scale-corner') {
            if (!e.shiftKey && track && track.type === 'shape') {
                clip.shapeWidth = Math.max(20, activeCanvasDrag.startWidth + deltaX);
                clip.shapeHeight = Math.max(20, activeCanvasDrag.startHeight + deltaY);
            } else {
                const scaleMultiplier = 1 + deltaX / 200;
                if (track && track.type === 'shape') {
                    clip.shapeWidth = Math.max(20, activeCanvasDrag.startWidth * scaleMultiplier);
                    clip.shapeHeight = Math.max(20, activeCanvasDrag.startHeight * scaleMultiplier);
                } else if (track && track.type === 'text') {
                    clip.size = Math.max(10, Math.round(activeCanvasDrag.startSize * scaleMultiplier));
                } else {
                    clip.scale = Math.max(0.1, activeCanvasDrag.startScale * scaleMultiplier);
                }
            }
            scheduleRender({ inspector: true });
        } else if (activeCanvasDrag.type === 'scale-edge') {
            if (track && track.type === 'shape') {
                if (activeCanvasDrag.edge === 'left' || activeCanvasDrag.edge === 'right') {
                    const factor = activeCanvasDrag.edge === 'left' ? -1 : 1;
                    clip.shapeWidth = Math.max(20, activeCanvasDrag.startWidth + deltaX * factor);
                } else {
                    const factor = activeCanvasDrag.edge === 'top' ? -1 : 1;
                    clip.shapeHeight = Math.max(20, activeCanvasDrag.startHeight + deltaY * factor);
                }
            } else {
                const scaleMultiplier = 1 + deltaX / 200;
                if (track && track.type === 'text') {
                    clip.size = Math.max(10, Math.round(activeCanvasDrag.startSize * scaleMultiplier));
                } else {
                    clip.scale = Math.max(0.1, activeCanvasDrag.startScale * scaleMultiplier);
                }
            }
            scheduleRender({ inspector: true });
        } else if (activeCanvasDrag.type === 'rotate') {
            const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
            const angleRad = Math.atan2(mouseY - activeCanvasDrag.cy, mouseX - activeCanvasDrag.cx);
            const angleDeg = (angleRad * 180 / Math.PI) + 90;
            clip.rotation = Math.round(angleDeg % 360);
            scheduleRender({ inspector: true });
        }
    });

    document.addEventListener('mouseup', () => {
        activeCanvasDrag = null;
        window._activeGuides = [];
        scheduleRender();
    });

    // Keydown Split shortcut
    window.addEventListener('keydown', (e) => {
        if (e.key === 's' || e.key === 'S') {
            if (state.selectedClipId) {
                splitClipAtPlayhead(state.selectedClipId);
            }
        }
    });

    // Arrow keys movement nudge (1px or 10px on Shift)
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable)) {
            return;
        }

        const ids = state.selectedClipIds || (state.selectedClipId ? [state.selectedClipId] : []);
        if (ids.length === 0) return;

        const step = e.shiftKey ? 10 : 1;
        let moved = false;

        if (e.key === 'ArrowLeft') {
            ids.forEach(id => {
                const clip = findClipById(id);
                if (clip) {
                    clip.x = (clip.x !== undefined ? clip.x : canvas.width / 2) - step;
                    moved = true;
                }
            });
        } else if (e.key === 'ArrowRight') {
            ids.forEach(id => {
                const clip = findClipById(id);
                if (clip) {
                    clip.x = (clip.x !== undefined ? clip.x : canvas.width / 2) + step;
                    moved = true;
                }
            });
        } else if (e.key === 'ArrowUp') {
            ids.forEach(id => {
                const clip = findClipById(id);
                if (clip) {
                    clip.y = (clip.y !== undefined ? clip.y : canvas.height / 2) - step;
                    moved = true;
                }
            });
        } else if (e.key === 'ArrowDown') {
            ids.forEach(id => {
                const clip = findClipById(id);
                if (clip) {
                    clip.y = (clip.y !== undefined ? clip.y : canvas.height / 2) + step;
                    moved = true;
                }
            });
        }

        if (moved) {
            e.preventDefault();
            renderCanvasComposition();
            updateInspector();
        }
    });

    window.addEventListener('keyup', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable)) {
            return;
        }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            saveStateToHistory('Nudge Clip');
        }
    });

    // Overlay Close Back Button
    const batchGalleryBackBtn = document.getElementById('batchGalleryBackBtn');
    if (batchGalleryBackBtn) {
        batchGalleryBackBtn.addEventListener('click', () => {
            document.getElementById('batchGalleryOverlay').style.display = 'none';
        });
    }

    const batchSelectAllBtn = document.getElementById('batchSelectAllBtn');
    if (batchSelectAllBtn) {
        let allSelected = true;
        batchSelectAllBtn.addEventListener('click', () => {
            allSelected = !allSelected;
            state.batchSelection = state.csvData.map(() => allSelected);
            renderBatchGalleryGrid();
            renderQueueList();
            batchSelectAllBtn.textContent = allSelected ? 'Deselect all' : 'Select all';
        });
    }

    const batchExportSelectedBtn = document.getElementById('batchExportSelectedBtn');
    if (batchExportSelectedBtn) {
        batchExportSelectedBtn.addEventListener('click', exportSelectedVariations);
    }
}
