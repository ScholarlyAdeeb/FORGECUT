/**
 * ForgeCut editor — Track rename, context menu, grouping, minimap, keyframes
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    window.renameTrack = async function (trackId) {
        const track = state.tracks.find(t => t.id === trackId);
        if (!track) return;
        const newName = await fcPrompt(`Enter new name for track "${track.name}":`, track.name);
        if (newName && newName.trim() !== '') {
            track.name = newName.trim();
            const labelEl = document.getElementById(`track-label-${trackId}`);
            if (labelEl) {
                labelEl.textContent = track.name;
            }
            renderTimeline();
        }
    };

    window.showClipContextMenu = function (e, clipId) {
        e.preventDefault();
        e.stopPropagation();

        const existing = document.getElementById('timelineContextMenu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'timelineContextMenu';
        menu.className = 'absolute bg-[#1e1e2e] border border-white/10 shadow-lg rounded py-1 z-50 text-xs w-40 text-white select-none';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.position = 'fixed';

        const items = [
            { label: 'Split Clip', action: () => splitClipAtPlayhead(clipId) },
            { label: 'Copy Clip', action: () => { state.selectedClipId = clipId; window.timelineCopy(); } },
            { label: 'Duplicate Clip', action: () => { state.selectedClipId = clipId; window.timelineDuplicate(); } },
            { label: 'Delete Clip', action: () => { state.selectedClipId = clipId; window.timelineDeleteSelected(); } },
            { label: 'Ripple Delete', action: () => { state.selectedClipId = clipId; window.rippleDeleteSelected(); } },
            {
                label: 'Add Keyframe', action: () => {
                    const clip = findClipById(clipId);
                    if (clip) {
                        if (!clip.keyframes) clip.keyframes = [];
                        const relativeTime = state.currentTime - clip.startTime;
                        if (relativeTime >= 0 && relativeTime <= clip.duration) {
                            clip.keyframes.push({ time: relativeTime, value: 1.0 });
                            renderTimeline();
                        } else {
                            fcToast('Playhead must be inside the clip to add a keyframe.');
                        }
                    }
                }
            },
            {
                label: 'Clear Keyframes', action: () => {
                    const clip = findClipById(clipId);
                    if (clip) {
                        clip.keyframes = [];
                        renderTimeline();
                    }
                }
            },
            { label: 'Group Clips', action: () => window.groupSelectedClips() },
            { label: 'Ungroup Clips', action: () => window.ungroupSelectedClips() }
        ];

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'px-3 py-1.5 hover:bg-indigo-600 hover:text-white cursor-pointer';
            row.textContent = item.label;
            row.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(row);
        });

        document.body.appendChild(menu);

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    };

    window.groupSelectedClips = function () {
        const ids = state.selectedClipIds || [];
        if (ids.length < 2) {
            fcToast('Please select at least 2 clips to group.');
            return;
        }
        const groupId = `group_${Date.now()}`;
        ids.forEach(id => {
            const clip = findClipById(id);
            if (clip) clip.groupId = groupId;
        });
    };

    window.ungroupSelectedClips = function () {
        const ids = state.selectedClipIds || [];
        ids.forEach(id => {
            const clip = findClipById(id);
            if (clip && clip.groupId) {
                const gId = clip.groupId;
                state.tracks.forEach(t => {
                    t.clips.forEach(c => {
                        if (c.groupId === gId) delete c.groupId;
                    });
                });
            }
        });
    };

    window.renderTimelineMinimap = function () {
        const canvasMinimap = document.getElementById('timelineMinimap');
        if (!canvasMinimap) return;
        const ctxMinimap = canvasMinimap.getContext('2d');

        const w = canvasMinimap.clientWidth || 300;
        const h = canvasMinimap.clientHeight || 24;
        if (canvasMinimap.width !== w || canvasMinimap.height !== h) {
            canvasMinimap.width = w;
            canvasMinimap.height = h;
        }

        ctxMinimap.clearRect(0, 0, w, h);
        ctxMinimap.fillStyle = '#111827';
        ctxMinimap.fillRect(0, 0, w, h);

        const totalDuration = state.duration || 30;
        const numTracks = state.tracks.length;
        const rowH = h / numTracks;

        state.tracks.forEach((track, trackIdx) => {
            let color = '#4f46e5';
            if (track.type === 'video') color = '#0284c7';
            else if (track.type === 'audio') color = '#22c55e';
            else if (track.type === 'text') color = '#e11d48';

            track.clips.forEach(clip => {
                const startX = (clip.startTime / totalDuration) * w;
                const clipW = (clip.duration / totalDuration) * w;
                const y = trackIdx * rowH;

                ctxMinimap.fillStyle = color;
                ctxMinimap.fillRect(startX, y + 2, Math.max(2, clipW), rowH - 4);
            });
        });

        const playheadX = (state.currentTime / totalDuration) * w;
        ctxMinimap.strokeStyle = '#ef4444';
        ctxMinimap.lineWidth = 2;
        ctxMinimap.beginPath();
        ctxMinimap.moveTo(playheadX, 0);
        ctxMinimap.lineTo(playheadX, h);
        ctxMinimap.stroke();
    };

    window.addEventListener('DOMContentLoaded', () => {
        // Debounced, dirty-checked autosave background loop using requestIdleCallback/setTimeout
        state.isDirty = false;
        setInterval(() => {
            if (!state.isDirty || !state.tracks || state.tracks.length === 0 || window._isResettingProject) return;
            state.isDirty = false;

            const saveFunc = () => {
                const autoSaveData = {
                    version: "1.0",
                    timestamp: new Date().toISOString(),
                    duration: state.duration,
                    currentTime: state.currentTime,
                    zoom: state.zoom,
                    tracks: state.tracks,
                    bgType: state.bgType,
                    bgColor: state.bgColor,
                    safeZoneConfig: state.safeZoneConfig,
                    safeAreaPlatform: state.safeAreaPlatform
                };
                try {
                    localStorage.setItem('forgecut_autosave', JSON.stringify(autoSaveData));
                } catch (e) {
                    console.warn('Autosave quota exceeded');
                }
            };

            if (window.requestIdleCallback) {
                window.requestIdleCallback(saveFunc);
            } else {
                setTimeout(saveFunc, 1);
            }
        }, 15000);

        // Autosave Restore Check
        setTimeout(async () => {
            const saved = localStorage.getItem('forgecut_autosave');
            if (saved) {
                const restore = await fcConfirm('An autosaved project was found. Restore it?', { okLabel: 'Restore', cancelLabel: 'Discard' });
                if (restore) {
                    try {
                        const data = JSON.parse(saved);
                        state.tracks = data.tracks || [];
                        state.duration = data.duration || 30;
                        state.currentTime = data.currentTime || 0;
                        state.zoom = data.zoom || 20;
                        if (data.bgType) state.bgType = data.bgType;
                        if (data.bgColor) state.bgColor = data.bgColor;
                        if (data.safeZoneConfig) state.safeZoneConfig = data.safeZoneConfig;
                        if (data.safeAreaPlatform) state.safeAreaPlatform = data.safeAreaPlatform;

                        renderTimeline();
                        updateInspector();
                        renderCanvasComposition();
                        fcToast('Autosave restored successfully.');
                    } catch (e) {
                        console.error('Failed to parse autosave');
                    }
                }
            }
        }, 1000);

        // Minimap scrub seek interaction
        const canvasMinimap = document.getElementById('timelineMinimap');
        if (canvasMinimap) {
            const handleMinimapInteraction = (e) => {
                const rect = canvasMinimap.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const pct = clickX / rect.width;
                const targetTime = pct * state.duration;
                setTime(Math.max(0, Math.min(state.duration, targetTime)));
            };
            canvasMinimap.addEventListener('mousedown', (e) => {
                handleMinimapInteraction(e);
                const moveHandler = (moveEvent) => handleMinimapInteraction(moveEvent);
                const upHandler = () => {
                    document.removeEventListener('mousemove', moveHandler);
                    document.removeEventListener('mouseup', upHandler);
                };
                document.addEventListener('mousemove', moveHandler);
                document.addEventListener('mouseup', upHandler);
            });
        }

        // Double-click to rename track headers
        setTimeout(() => {
            document.querySelectorAll('.w-48 span.text-xs').forEach(span => {
                span.addEventListener('dblclick', async () => {
                    const newName = await fcPrompt('Enter new track name:', span.textContent);
                    if (newName && newName.trim()) {
                        span.textContent = newName.trim();
                    }
                });
            });
        }, 500);
    });

    window.toggleKeyframe = function (clipId, propertyName) {
        const clip = findClipById(clipId);
        if (!clip) return;

        if (!clip.keyframes) clip.keyframes = {};
        if (!clip.keyframes[propertyName]) clip.keyframes[propertyName] = [];

        const localTime = state.currentTime - clip.startTime;
        const existingIdx = clip.keyframes[propertyName].findIndex(kf => Math.abs(kf.time - localTime) < 0.15);

        if (existingIdx !== -1) {
            clip.keyframes[propertyName].splice(existingIdx, 1);
        } else {
            const val = clip[propertyName] !== undefined ? clip[propertyName] : 0;
            clip.keyframes[propertyName].push({ time: localTime, value: val });
        }

        renderCanvasComposition();
        updateInspector();
        saveStateToHistory('Toggle Keyframe');
    };

    window.getInterpolatedValue = function (clip, propertyName, defaultValue) {
        if (!clip.keyframes || !clip.keyframes[propertyName] || clip.keyframes[propertyName].length === 0) {
            return clip[propertyName] !== undefined ? clip[propertyName] : defaultValue;
        }

        const keyframes = [...clip.keyframes[propertyName]].sort((a, b) => a.time - b.time);
        const clipLocalTime = state.currentTime - clip.startTime;

        if (clipLocalTime <= keyframes[0].time) return keyframes[0].value;
        if (clipLocalTime >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

        for (let i = 0; i < keyframes.length - 1; i++) {
            const k1 = keyframes[i];
            const k2 = keyframes[i + 1];
            if (clipLocalTime >= k1.time && clipLocalTime <= k2.time) {
                const t = (clipLocalTime - k1.time) / (k2.time - k1.time);
                return k1.value + (k2.value - k1.value) * t;
            }
        }
        return defaultValue;
    };

    window.toggleClipNormalize = function (clipId, checked) {
        const clip = findClipById(clipId);
        if (clip) {
            clip.normalize = !!checked;
            syncMediaPlayback();
            saveStateToHistory('Toggle Normalize');
        }
    };

    window.showFluentNotification = function (title, message, type = 'info') {
        const container = document.getElementById('fluentNotificationContainer') || (() => {
            const c = document.createElement('div');
            c.id = 'fluentNotificationContainer';
            c.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;';
            document.body.appendChild(c);
            return c;
        })();

        const notif = document.createElement('div');
        let borderColor = 'border-[#6200ee]';
        if (type === 'error') borderColor = 'border-red-500';
        else if (type === 'warning') borderColor = 'border-yellow-500';

        notif.className = `p-4 bg-[#1e1e24] border-l-4 ${borderColor} text-xs text-white rounded-lg shadow-2xl flex flex-col gap-1 transition-all duration-300 transform translate-x-full opacity-0 pointer-events-auto`;
        notif.style.width = '300px';
        notif.style.borderStyle = 'solid';
        notif.style.borderWidth = '0 0 0 4px';
        notif.innerHTML = `
        <div class="font-bold flex justify-between items-center text-white">
            <span>${title}</span>
            <span class="material-symbols-outlined text-sm cursor-pointer opacity-60 hover:opacity-100" onclick="this.parentElement.parentElement.remove()">close</span>
        </div>
        <div class="text-gray-400 mt-1">${message}</div>
    `;
        container.appendChild(notif);

        setTimeout(() => {
            notif.style.transform = 'translateX(0)';
            notif.style.opacity = '1';
        }, 50);

        setTimeout(() => {
            notif.style.transform = 'translateX(100%)';
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 300);
        }, 5000);
    }
