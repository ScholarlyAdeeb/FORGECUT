/**
 * ForgeCut editor — Keyboard shortcuts, drag-drop, resizers, canvas zoom/pan
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    // Bind keyboard shortcuts Matrix
    window.addEventListener('keydown', (e) => {
        // Check if focused in input or textarea
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

        const ctrl = e.ctrlKey || e.metaKey;

        if (ctrl && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            window.triggerNewProject('16_9');
        } else if (ctrl && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            openBackstage();
            const tab = document.querySelector('[data-backstage-tab="open"]');
            if (tab) tab.click();
        } else if (ctrl && e.key.toLowerCase() === 's') {
            e.preventDefault();
            fcToast('Workspace saved to local browser sandbox storage.');
        } else if (ctrl && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            window.triggerUndo();
        } else if (ctrl && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            window.triggerRedo();
        } else if (ctrl && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            window.timelineCopy();
        } else if (ctrl && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            window.timelinePaste();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            window.timelineDeleteSelected();
        } else if (e.key === ' ') {
            e.preventDefault();
            togglePlay();
        } else if (e.key.toLowerCase() === 'j') {
            e.preventDefault();
            setTime(state.currentTime - 2);
        } else if (e.key.toLowerCase() === 'k') {
            e.preventDefault();
            pause();
        } else if (e.key.toLowerCase() === 'l') {
            e.preventDefault();
            setTime(state.currentTime + 2);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setTime(state.currentTime - 0.04); // 1 frame scrub (25fps)
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setTime(state.currentTime + 0.04); // 1 frame scrub (25fps)
        }
    });

    // Setup drag and drop events on Timeline container
    if (timelineContainer) {
        timelineContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        timelineContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.type === 'media') {
                    const asset = assetCache.get(data.assetId);
                    if (asset) {
                        // Create clip at cursor
                        const rect = timelineContainer.getBoundingClientRect();
                        const clientX = e.clientX - rect.left;
                        const startVal = Math.max(0, clientX / state.zoom);

                        const trackId = data.assetType === 'audio' ? 'audioTrack' : 'videoTrack';
                        const track = state.tracks.find(t => t.id === trackId);

                        const videoClipId = `clip_${Date.now()}`;
                        const newClip = {
                            id: videoClipId,
                            assetId: asset.id,
                            name: asset.name,
                            startTime: startVal,
                            duration: asset.duration || 5,
                            trimStart: 0,
                            x: canvas.width / 2,
                            y: canvas.height / 2,
                            scale: 1.0,
                            rotation: 0,
                            opacity: 1.0
                        };

                        saveStateToHistory();

                        if (data.assetType === 'video') {
                            const audioAsset = assetCache.get(`${asset.id}_audio`);
                            if (audioAsset) {
                                const audioTrack = state.tracks.find(t => t.id === 'audioTrack');
                                const linkedAudioClipId = `clip_${Date.now()}_audio`;
                                const newAudioClip = {
                                    id: linkedAudioClipId,
                                    assetId: audioAsset.id,
                                    name: `${asset.name} (Audio)`,
                                    startTime: startVal,
                                    duration: newClip.duration,
                                    trimStart: 0,
                                    volume: 1.0,
                                    fadeIn: 0,
                                    fadeOut: 0,
                                    linkedClipId: videoClipId
                                };
                                audioTrack.clips.push(newAudioClip);
                                newClip.linkedClipId = linkedAudioClipId;
                            }
                        }

                        track.clips.push(newClip);
                        renderTimeline();
                        renderCanvasComposition();
                        fcToast(`Added clip at position: ${startVal.toFixed(2)}s`);
                    }
                }
            } catch (err) { }
        });
    }

    function setupSidebarResizers() {
        const leftResizer = document.getElementById('left-resizer');
        const rightResizer = document.getElementById('right-resizer');
        const sidebarLeft = document.getElementById('leftSidebarContainer');
        const sidebarRight = document.getElementById('rightSidebarContainer');

        if (leftResizer && sidebarLeft) {
            let startX, startWidth;
            leftResizer.addEventListener('mousedown', (e) => {
                startX = e.clientX;
                startWidth = sidebarLeft.getBoundingClientRect().width;
                document.addEventListener('mousemove', resizeLeft);
                document.addEventListener('mouseup', stopResizeLeft);
                e.preventDefault();
            });
            function resizeLeft(e) {
                const newWidth = Math.max(200, Math.min(500, startWidth + (e.clientX - startX)));
                sidebarLeft.style.width = `${newWidth}px`;
                recalculateCanvasDisplaySize();
            }
            function stopResizeLeft() {
                document.removeEventListener('mousemove', resizeLeft);
                document.removeEventListener('mouseup', stopResizeLeft);
                recalculateCanvasDisplaySize();
            }
        }

        if (rightResizer && sidebarRight) {
            let startX, startWidth;
            rightResizer.addEventListener('mousedown', (e) => {
                startX = e.clientX;
                startWidth = sidebarRight.getBoundingClientRect().width;
                document.addEventListener('mousemove', resizeRight);
                document.addEventListener('mouseup', stopResizeRight);
                e.preventDefault();
            });
            function resizeRight(e) {
                const newWidth = Math.max(240, Math.min(600, startWidth - (e.clientX - startX)));
                sidebarRight.style.width = `${newWidth}px`;
                recalculateCanvasDisplaySize();
            }
            function stopResizeRight() {
                document.removeEventListener('mousemove', resizeRight);
                document.removeEventListener('mouseup', stopResizeRight);
                recalculateCanvasDisplaySize();
            }
        }
    }
    window.setupSidebarResizers = setupSidebarResizers;

    // Canvas Zoom and Pan Implementation
    window.adjustCanvasZoom = function (amount) {
        if (state.canvasZoom === undefined) state.canvasZoom = 100;
        state.canvasZoom = Math.max(10, Math.min(400, state.canvasZoom + amount));
        recalculateCanvasDisplaySize();
        renderCanvasComposition();
    };

    window.cycleCanvasZoom = function () {
        if (state.canvasZoom === undefined) state.canvasZoom = 100;
        const presets = [50, 75, 100, 150, 200];
        let nextIndex = presets.findIndex(p => p > state.canvasZoom);
        if (nextIndex === -1) {
            state.canvasZoom = 50;
        } else {
            state.canvasZoom = presets[nextIndex];
        }
        recalculateCanvasDisplaySize();
        renderCanvasComposition();
    };

    window.zoomCanvasFit = function () {
        state.canvasZoom = 100;
        state.canvasPanX = 0;
        state.canvasPanY = 0;
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) wrapper.style.transform = '';
        recalculateCanvasDisplaySize();
        renderCanvasComposition();
    };

    // Panning and Wheel Zoom Event Listeners
    (function () {
        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        let isSpacePressed = false;

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                if (e.key === 'Escape') {
                    e.target.blur();
                    e.preventDefault();
                }
                return;
            }

            const isCtrl = e.ctrlKey || e.metaKey;
            const isShift = e.shiftKey;
            const isAlt = e.altKey;

            // General
            if (isCtrl && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                fcConfirm('Create new project? Unsaved changes will be lost.', { okLabel: 'Discard and reload', danger: true })
                    .then(ok => { if (ok) location.reload(); });
            } else if (isCtrl && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = '.json';
                inp.onchange = (ev) => {
                    const file = ev.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (readEv) => {
                            try {
                                const parsed = JSON.parse(readEv.target.result);
                                Object.assign(state, parsed);
                                renderTimeline();
                                renderCanvasComposition();
                                syncMediaPlayback();
                            } catch (err) {
                                fcToast('Failed to load project.');
                            }
                        };
                        reader.readAsText(file);
                    }
                };
                inp.click();
            } else if (isCtrl && e.key.toLowerCase() === 's') {
                e.preventDefault();
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", isShift ? "forgecut_project_copy.json" : "forgecut_project.json");
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
            }

            // Editing
            else if (isCtrl && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (window.HistoryManager) window.HistoryManager.undo(state);
                renderTimeline();
                renderCanvasComposition();
                syncMediaPlayback();
                updateInspector();
            } else if ((isCtrl && e.key.toLowerCase() === 'y') || (isCtrl && isShift && e.key.toLowerCase() === 'z')) {
                e.preventDefault();
                if (window.HistoryManager) window.HistoryManager.redo(state);
                renderTimeline();
                renderCanvasComposition();
                syncMediaPlayback();
                updateInspector();
            } else if (isCtrl && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                window.timelineCopy();
            } else if (isCtrl && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                window.timelinePaste();
            } else if (isCtrl && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                window.timelineCopy();
                window.timelineDeleteSelected();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                window.timelineDeleteSelected();
            } else if (isCtrl && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                window.timelineDuplicate();
            }

            // Playback
            else if (e.code === 'Space' || e.key.toLowerCase() === 'k') {
                e.preventDefault();
                togglePlayPause();
            } else if (e.key.toLowerCase() === 'j') {
                e.preventDefault();
                setTime(Math.max(0, state.currentTime - 1));
            } else if (e.key.toLowerCase() === 'l') {
                e.preventDefault();
                setTime(Math.min(state.duration, state.currentTime + 1));
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setTime(Math.max(0, state.currentTime - (1 / 30)));
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setTime(Math.min(state.duration, state.currentTime + (1 / 30)));
            }

            // Timeline
            else if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (state.selectedClipId) {
                    splitClipAtPlayhead(state.selectedClipId);
                }
            } else if (e.key.toLowerCase() === 'm') {
                e.preventDefault();
                if (!state.markers) state.markers = [];
                state.markers.push(state.currentTime);
                renderTimeline();
            } else if (e.key === 'Home') {
                e.preventDefault();
                setTime(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                setTime(state.duration);
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                state.zoom = Math.min(200, state.zoom + 10);
                renderTimeline();
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                state.zoom = Math.max(10, state.zoom - 10);
                renderTimeline();
            }

            // Canvas
            else if (isCtrl && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                state.selectedClipIds = [];
                state.tracks.forEach(t => {
                    t.clips.forEach(c => state.selectedClipIds.push(c.id));
                });
                if (state.selectedClipIds.length > 0) {
                    state.selectedClipId = state.selectedClipIds[0];
                }
                updateInspector();
                renderTimeline();
                renderCanvasComposition();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                state.selectedClipId = null;
                state.selectedClipIds = [];
                updateInspector();
                renderTimeline();
                renderCanvasComposition();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                isSpacePressed = false;
            }
        });

        window.addEventListener('DOMContentLoaded', () => {
            const tooltips = [
                { selector: 'button[onclick*="triggerUndo"]', title: 'Undo (Ctrl+Z)' },
                { selector: 'button[onclick*="triggerRedo"]', title: 'Redo (Ctrl+Y / Ctrl+Shift+Z)' },
                { selector: 'button[onclick*="timelinePaste"]', title: 'Paste (Ctrl+V)' },
                { selector: 'button[onclick*="timelineCut"]', title: 'Cut (Ctrl+X)' },
                { selector: 'button[onclick*="timelineCopy"]', title: 'Copy (Ctrl+C)' },
                { selector: 'button[onclick*="timelineDuplicate"]', title: 'Duplicate (Ctrl+D)' },
                { selector: 'button[onclick*="triggerSplit"]', title: 'Split at Playhead (S)' },
                { selector: 'button[onclick*="timelineDeleteSelected"]', title: 'Delete Clip (Delete)' },
                { selector: 'button[onclick*="timelineRippleDelete"]', title: 'Ripple Delete (Shift+Delete)' },
                { selector: '#snapBtn', title: 'Toggle Snapping' }
            ];
            setTimeout(() => {
                tooltips.forEach(item => {
                    const el = document.querySelector(item.selector);
                    if (el) el.setAttribute('title', item.title);
                });
            }, 1000);
        });

        window.addEventListener('DOMContentLoaded', () => {
            const container = document.getElementById('canvasContainerBg');
            if (!container) return;

            // Middle-click or Space + Drag to pan
            container.addEventListener('mousedown', (e) => {
                if (e.button === 1 || isSpacePressed) {
                    isPanning = true;
                    panStartX = e.clientX - (state.canvasPanX || 0);
                    panStartY = e.clientY - (state.canvasPanY || 0);
                    container.style.cursor = 'grabbing';
                    e.preventDefault();
                }
            });

            document.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    state.canvasPanX = e.clientX - panStartX;
                    state.canvasPanY = e.clientY - panStartY;
                    const wrapper = document.getElementById('canvasWrapper');
                    if (wrapper) {
                        wrapper.style.transform = `translate(${state.canvasPanX}px, ${state.canvasPanY}px)`;
                    }
                }
            });

            document.addEventListener('mouseup', () => {
                if (isPanning) {
                    isPanning = false;
                    container.style.cursor = '';
                }
            });

            // Ctrl + Wheel to zoom
            container.addEventListener('wheel', (e) => {
                if (e.ctrlKey) {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 10 : -10;
                    window.adjustCanvasZoom(delta);
                }
            }, { passive: false });
        });
    });

    window.toggleMagneticSnapping = function (enabled) {
        state.snapEnabled = !!enabled;
        const chk = document.getElementById('chkMagneticSnapping');
        if (chk) chk.checked = state.snapEnabled;
        console.log('Magnetic Snapping toggled:', state.snapEnabled);
    };

    window.applyCanvasSnapping = function (clip) {
        window._activeGuides = [];
        if (!state.snapEnabled) return;

        const snapThreshold = 20; // Magnetic range

        // Snap to Canvas Center
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        if (Math.abs(clip.x - centerX) < snapThreshold) {
            clip.x = centerX;
            window._activeGuides.push({ type: 'v', x: centerX, label: 'Center X' });
        }
        if (Math.abs(clip.y - centerY) < snapThreshold) {
            clip.y = centerY;
            window._activeGuides.push({ type: 'h', y: centerY, label: 'Center Y' });
        }

        // Snap to Safe Zone margins (10%)
        const safeLeft = canvas.width * 0.1;
        const safeRight = canvas.width * 0.9;
        const safeTop = canvas.height * 0.1;
        const safeBottom = canvas.height * 0.9;
        if (Math.abs(clip.x - safeLeft) < snapThreshold) {
            clip.x = safeLeft;
            window._activeGuides.push({ type: 'v', x: safeLeft, label: 'Safe Margin Left' });
        }
        if (Math.abs(clip.x - safeRight) < snapThreshold) {
            clip.x = safeRight;
            window._activeGuides.push({ type: 'v', x: safeRight, label: 'Safe Margin Right' });
        }
        if (Math.abs(clip.y - safeTop) < snapThreshold) {
            clip.y = safeTop;
            window._activeGuides.push({ type: 'h', y: safeTop, label: 'Safe Margin Top' });
        }
        if (Math.abs(clip.y - safeBottom) < snapThreshold) {
            clip.y = safeBottom;
            window._activeGuides.push({ type: 'h', y: safeBottom, label: 'Safe Margin Bottom' });
        }

        // Snap to other clips currently visible on the screen
        state.tracks.forEach(track => {
            track.clips.forEach(other => {
                if (other.id === clip.id) return;
                const inRange = state.currentTime >= other.startTime && state.currentTime <= (other.startTime + other.duration);
                if (!inRange) return;

                const ox = other.x !== undefined ? other.x : canvas.width / 2;
                const oy = other.y !== undefined ? other.y : canvas.height / 2;

                if (Math.abs(clip.x - ox) < snapThreshold) {
                    clip.x = ox;
                    window._activeGuides.push({ type: 'v', x: ox, label: 'Align Edge' });
                }
                if (Math.abs(clip.y - oy) < snapThreshold) {
                    clip.y = oy;
                    window._activeGuides.push({ type: 'h', y: oy, label: 'Align Edge' });
                }
            });
        });
    };
