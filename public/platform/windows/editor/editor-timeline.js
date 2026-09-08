/**
 * ForgeCut editor — Timeline ruler, tracks and snapping
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
// Timeline Rendering & Drag-Drop interactions
function renderTimeline() {
    renderTimelineRuler();
    renderTracks();
    if (typeof renderTimelineMinimap === 'function') {
        renderTimelineMinimap();
    }
}

function renderTimelineRuler() {
    if (!timelineRuler) return;

    const totalWidth = Math.max(10, state.duration * state.zoom);
    timelineRuler.style.width = `${totalWidth}px`;
    timelineRuler.style.minWidth = '100%';
    if (tracksContainer) {
        tracksContainer.style.width = `${totalWidth}px`;
        tracksContainer.style.minWidth = '100%';
    }
    if (timelineRuler.parentElement && timelineRuler.parentElement.id !== 'rulerScrollParent') {
        timelineRuler.parentElement.style.width = `${totalWidth}px`;
    }

    // The ruler canvas is reused across renders. Allocating a fresh
    // <canvas> of totalWidth x 24 and calling getContext('2d') on every
    // render cost ~3ms on a long timeline, for a surface that only needs
    // resizing when the duration or zoom changes.
    let canvasEl = timelineRuler._rulerCanvas;
    if (!canvasEl || canvasEl.parentElement !== timelineRuler) {
        canvasEl = document.createElement('canvas');
        canvasEl.style.display = 'block';
        canvasEl.style.pointerEvents = 'none';
        timelineRuler.replaceChildren(canvasEl);
        timelineRuler._rulerCanvas = canvasEl;
        timelineRuler._rulerCtx = canvasEl.getContext('2d');
    }
    // Assigning width/height clears the canvas, so only do it on a real change.
    if (canvasEl.width !== totalWidth || canvasEl.height !== 24) {
        canvasEl.width = totalWidth;
        canvasEl.height = 24; // height of timelineRuler (h-6 = 24px)
        canvasEl.style.width = `${totalWidth}px`;
        canvasEl.style.height = `24px`;
    }

    const ctxRuler = timelineRuler._rulerCtx;

    // Clear and draw background
    ctxRuler.clearRect(0, 0, totalWidth, 24);
    ctxRuler.fillStyle = '#111318'; // Sleek dark editor background
    ctxRuler.fillRect(0, 0, totalWidth, 24);

    // Font setup
    ctxRuler.font = '9px "Inter", "Libre Franklin", sans-serif';
    ctxRuler.fillStyle = '#909090';
    ctxRuler.textBaseline = 'top';
    ctxRuler.textAlign = 'left';

    const fps = 25;
    const frameTime = 1 / fps; // 0.04s

    // Determine spacing of ticks dynamically based on zoom (pixels per second)
    let majorStep = 1; // in seconds
    let minorStep = 0.2; // in seconds (5 ticks per second)

    if (state.zoom >= 250) {
        majorStep = 0.2; // every 5 frames is major (labeled)
        minorStep = frameTime; // every frame is minor
    } else if (state.zoom >= 100) {
        majorStep = 1;
        minorStep = frameTime; // every frame is minor
    } else if (state.zoom >= 40) {
        majorStep = 1;
        minorStep = 5 * frameTime; // every 5 frames is minor
    } else if (state.zoom >= 15) {
        majorStep = 5;
        minorStep = 1;
    } else if (state.zoom >= 5) {
        majorStep = 10;
        minorStep = 2;
    } else {
        majorStep = 30;
        minorStep = 10;
    }

    // Draw minor ticks
    ctxRuler.strokeStyle = '#303030';
    ctxRuler.lineWidth = 1;
    ctxRuler.beginPath();
    for (let t = 0; t <= state.duration; t += minorStep) {
        // Skip major tick positions
        if (Math.abs(t % majorStep) < 0.001 || Math.abs((t % majorStep) - majorStep) < 0.001) {
            continue;
        }
        const x = t * state.zoom;
        ctxRuler.moveTo(x, 15);
        ctxRuler.lineTo(x, 24);
    }
    ctxRuler.stroke();

    // Draw major ticks & labels
    ctxRuler.strokeStyle = '#606060';
    ctxRuler.lineWidth = 1.2;
    ctxRuler.beginPath();
    for (let t = 0; t <= state.duration; t += majorStep) {
        const x = t * state.zoom;
        ctxRuler.moveTo(x, 8);
        ctxRuler.lineTo(x, 24);

        // Format: MM:SS or MM:SS:FF depending on precision
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        const frames = Math.round((t - Math.floor(t)) * fps);
        let labelText = '';
        if (state.zoom >= 100) {
            labelText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
        } else {
            labelText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        ctxRuler.fillText(labelText, x + 3, 2);
    }
    ctxRuler.stroke();

    // Draw bottom border line
    ctxRuler.strokeStyle = '#252528';
    ctxRuler.lineWidth = 1;
    ctxRuler.beginPath();
    ctxRuler.moveTo(0, 23.5);
    ctxRuler.lineTo(totalWidth, 23.5);
    ctxRuler.stroke();

    updatePlayheadUI();
}

function renderTracks() {
    // Render vertical snap guide
    const snapGuideEl = document.getElementById('timelineSnapGuide');
    if (snapGuideEl) {
        if (state.isSnapping && state.lastSnappedTime !== undefined) {
            snapGuideEl.style.left = `${state.lastSnappedTime * state.zoom}px`;
            snapGuideEl.classList.remove('hidden');
        } else {
            snapGuideEl.classList.add('hidden');
        }
    }

    const timelineContainer = document.getElementById('timelineContainer');
    const scrollLeft = timelineContainer ? timelineContainer.scrollLeft : 0;
    const clientWidth = timelineContainer ? timelineContainer.clientWidth : window.innerWidth;
    const visibleStart = scrollLeft / state.zoom;
    const visibleEnd = (scrollLeft + clientWidth) / state.zoom;

    state.tracks.forEach(track => {
        const contentDiv = document.getElementById(`${track.id}Content`);
        if (!contentDiv) return;

        // Rebuilding every clip element on every render was the single biggest
        // cost in the editor: ~0.22ms per visible clip, so ~18ms for a busy
        // timeline — over a whole 60fps frame budget, on every drag event.
        // Almost none of that was building the nodes (~0.5ms); it was the style
        // recalculation the browser has to do when hundreds of freshly created
        // elements are matched against Tailwind's stylesheet.
        //
        // So elements are now cached per clip id and reused. A drag only
        // changes position and selection, which are cheap property writes on
        // existing nodes. An element is only rebuilt when something that
        // affects its structure changes (tracked by `sig` below).
        if (!contentDiv._clipEls) contentDiv._clipEls = new Map();
        const cache = contentDiv._clipEls;
        const seen = new Set();
        const desired = [];

        track.clips.forEach(clip => {
            const clipEnd = clip.startTime + clip.duration;
            const isVisible = (clipEnd >= visibleStart - 10) && (clip.startTime <= visibleEnd + 10);
            if (!isVisible) return;

            const isSelected = clip.id === state.selectedClipId || (clip.linkedClipId && clip.linkedClipId === state.selectedClipId);
            const isDragging = activeDrag && activeDrag.clipId === clip.id;

            const left = clip.startTime * state.zoom;
            const width = clip.duration * state.zoom;
            const className = `timeline-clip clip-${track.type} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging opacity-60 scale-95 border-dashed border-2 border-primary' : ''}`;

            // Everything that changes the element's internal structure. Zoom is
            // included because waveforms and thumbnail strips are rasterised at
            // the clip's pixel width.
            const sig = [
                track.type, clip.name, clip.text, clip.assetId, clip.duration,
                clip.trimStart, clip.transitionDuration, clip.transition,
                state.zoom, (clip.keyframes || []).length,
                (clip.censorBeeps || []).length
            ].join('|');

            const cached = cache.get(clip.id);
            if (cached && cached.sig === sig) {
                // Fast path: reposition and restyle in place, no new nodes.
                seen.add(clip.id);
                const el = cached.el;
                if (el.style.left !== `${left}px`) el.style.left = `${left}px`;
                if (el.style.width !== `${width}px`) el.style.width = `${width}px`;
                if (el.className !== className) el.className = className;
                desired.push(el);
                return;
            }
            seen.add(clip.id);

            const clipEl = document.createElement('div');
            clipEl.className = className;

            clipEl.style.left = `${left}px`;
            clipEl.style.width = `${width}px`;
            clipEl.dataset.clipId = clip.id;

            // Render waveform for audio tracks
            if (track.type === 'audio') {
                const asset = assetCache.get(clip.assetId);
                if (asset && asset.waveform) {
                    const canvasWf = document.createElement('canvas');
                    canvasWf.className = 'absolute inset-0 w-full h-full pointer-events-none opacity-40';
                    const displayW = Math.max(10, width);
                    canvasWf.width = displayW;
                    canvasWf.height = 64;
                    const wfCtx = canvasWf.getContext('2d');
                    wfCtx.fillStyle = '#ffffff';

                    const samples = asset.waveform;
                    const trimStart = clip.trimStart || 0;
                    const duration = clip.duration;
                    const assetDuration = asset.duration || clip.duration;
                    const startIdx = Math.floor((trimStart / assetDuration) * samples.length);
                    const endIdx = Math.floor(((trimStart + duration) / assetDuration) * samples.length);
                    let visibleSamples = samples.slice(startIdx, endIdx);
                    if (visibleSamples.length === 0) visibleSamples = samples;

                    const sliceW = displayW / visibleSamples.length;
                    for (let i = 0; i < visibleSamples.length; i++) {
                        const h = visibleSamples[i] * 48; // max height 48px
                        const x = i * sliceW;
                        const y = (64 - h) / 2;
                        wfCtx.fillRect(x, y, Math.max(1, sliceW - 0.5), h);
                    }
                    clipEl.appendChild(canvasWf);
                }
            }

            // Render thumbnails for video and image tracks
            if (track.type === 'video' || track.type === 'image') {
                const asset = assetCache.get(clip.assetId);
                if (asset && asset.objectUrl) {
                    // Key the filmstrip off what the asset actually is, not the
                    // track it sits on. Images are placed on videoTrack2, which
                    // is type 'video', so the image branch below was dead code
                    // and every image clip instead built a row of <video>
                    // elements pointed at an image blob — one failed resource
                    // load per thumbnail slot, and no thumbnail on the clip.
                    if (asset.type === 'image') {
                        const img = document.createElement('img');
                        img.src = asset.objectUrl;
                        img.className = 'absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none';
                        clipEl.appendChild(img);
                    } else if (asset.type === 'video') {
                        // Thumbnail strip
                        const thumbStrip = document.createElement('div');
                        thumbStrip.className = 'absolute inset-0 w-full h-full flex overflow-hidden pointer-events-none opacity-20';
                        const thumbCount = Math.max(1, Math.floor(width / 60));
                        for (let i = 0; i < thumbCount; i++) {
                            const video = document.createElement('video');
                            video.src = asset.objectUrl;
                            video.muted = true;
                            video.className = 'h-full object-cover flex-1 min-w-[50px]';
                            if (asset.duration) {
                                video.currentTime = (i / thumbCount) * asset.duration;
                            }
                            thumbStrip.appendChild(video);
                        }
                        clipEl.appendChild(thumbStrip);
                    }
                }
            }

            // Text Icon
            if (track.type === 'text') {
                const textIcon = document.createElement('span');
                textIcon.className = 'material-symbols-outlined text-[14px] text-yellow-400 mr-1 z-10 select-none';
                textIcon.textContent = 'title';
                clipEl.appendChild(textIcon);
            }

            const titleSpan = document.createElement('span');
            titleSpan.className = 'clip-title z-10 flex flex-col items-start gap-0.5 pl-1 select-none pointer-events-none';
            // Built as text nodes, not innerHTML: clip.name is the imported
            // file's name and clip.text is user-typed, so interpolating either
            // into markup let a filename like `<img src=x onerror=...>.mp4`
            // (legal on macOS and Linux) run script when the clip was drawn.
            const clipNameEl = document.createElement('div');
            clipNameEl.className = 'font-bold truncate max-w-full text-[10px] text-white';
            clipNameEl.textContent = clip.name || clip.text || track.name;
            const clipDurEl = document.createElement('div');
            clipDurEl.className = 'text-[8px] text-gray-300';
            clipDurEl.textContent = `${clip.duration.toFixed(2)}s`;
            titleSpan.append(clipNameEl, clipDurEl);
            clipEl.appendChild(titleSpan);

            // Trim handles
            const trimL = document.createElement('div');
            trimL.className = 'trim-handle trim-handle-left z-10';
            const trimR = document.createElement('div');
            trimR.className = 'trim-handle trim-handle-right z-10';

            clipEl.appendChild(trimL);
            clipEl.appendChild(trimR);

            // Render transition handle/indicator on clip
            if (clip.transition && clip.transition !== 'None') {
                const transDur = clip.transitionDuration || 1.0;
                const transW = transDur * state.zoom;
                const transIndicator = document.createElement('div');
                transIndicator.className = 'absolute top-0 bottom-0 left-0 bg-yellow-500/20 border-r-2 border-yellow-500 z-15 flex items-center justify-end cursor-col-resize select-none transition-handle';
                transIndicator.style.width = `${transW}px`;
                transIndicator.dataset.clipId = clip.id;
                transIndicator.title = `Transition: ${clip.transition} (${transDur.toFixed(1)}s)`;

                const handleGrab = document.createElement('div');
                handleGrab.className = 'w-1 h-4 bg-yellow-500 mr-0.5 rounded-full';
                transIndicator.appendChild(handleGrab);

                clipEl.appendChild(transIndicator);
            }

            // Render keyframe diamonds
            if (clip.keyframes && clip.keyframes.length > 0) {
                clip.keyframes.forEach(kf => {
                    const kfEl = document.createElement('div');
                    kfEl.className = 'absolute w-2 h-2 bg-yellow-400 rotate-45 border border-black/50 z-20 cursor-pointer hover:bg-yellow-300';
                    const kfLeft = kf.time * state.zoom;
                    kfEl.style.left = `${kfLeft - 4}px`;
                    kfEl.style.top = 'calc(50% - 4px)';
                    kfEl.title = `Keyframe at ${kf.time.toFixed(2)}s`;
                    kfEl.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        setTime(clip.startTime + kf.time);
                    });
                    clipEl.appendChild(kfEl);
                });
            }

            // Bind right-click context menu
            clipEl.addEventListener('contextmenu', (e) => {
                if (typeof showClipContextMenu === 'function') {
                    showClipContextMenu(e, clip.id);
                }
            });

            cache.set(clip.id, { el: clipEl, sig });
            desired.push(clipEl);
        });

        // Drop cache entries for clips that are gone or scrolled out of view,
        // so the map cannot grow without bound across a long session.
        for (const id of cache.keys()) {
            if (!seen.has(id)) cache.delete(id);
        }

        // Only touch the DOM when the child list actually changed. Calling
        // replaceChildren with already-attached nodes still detaches and
        // re-inserts every one of them, which re-runs style matching against
        // Tailwind's stylesheet — that alone cost ~13ms per render even when
        // nothing had changed.
        const current = contentDiv.childNodes;
        let unchanged = current.length === desired.length;
        if (unchanged) {
            for (let i = 0; i < desired.length; i++) {
                if (current[i] !== desired[i]) { unchanged = false; break; }
            }
        }
        if (!unchanged) {
            const frag = document.createDocumentFragment();
            for (const el of desired) frag.appendChild(el);
            contentDiv.replaceChildren(frag);
        }
    });
}

function getSnappedTime(rawTime, excludeClipId = null) {
    state.isSnapping = false;
    if (!state.snapEnabled) return rawTime;

    const snapThreshold = 0.25;
    let bestTime = rawTime;
    let minDiff = snapThreshold;

    const diffPlayhead = Math.abs(rawTime - state.currentTime);
    if (diffPlayhead < minDiff) {
        bestTime = state.currentTime;
        minDiff = diffPlayhead;
        state.isSnapping = true;
    }

    state.tracks.forEach(track => {
        track.clips.forEach(clip => {
            if (clip.id === excludeClipId) return;

            const diffStart = Math.abs(rawTime - clip.startTime);
            const diffEnd = Math.abs(rawTime - (clip.startTime + clip.duration));

            if (diffStart < minDiff) {
                bestTime = clip.startTime;
                minDiff = diffStart;
                state.isSnapping = true;
            }
            if (diffEnd < minDiff) {
                bestTime = clip.startTime + clip.duration;
                minDiff = diffEnd;
                state.isSnapping = true;
            }
        });
    });

    if (state.isSnapping) {
        state.lastSnappedTime = bestTime;
    }
    return bestTime;
}
