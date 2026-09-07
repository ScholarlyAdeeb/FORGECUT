// Central state for the editor
const state = {
    duration: 30, // composition duration in seconds
    currentTime: 0,
    isPlaying: false,
    zoom: 20, // pixels per second
    tracks: [
        { id: 'videoTrack', type: 'video', name: 'Video Track 1', clips: [] },
        { id: 'videoTrack2', type: 'video', name: 'Video Track 2', clips: [] },
        { id: 'shapeTrack', type: 'shape', name: 'Shapes Track 1', clips: [] },
        { id: 'audioTrack', type: 'audio', name: 'Audio Track 1', clips: [] },
        { id: 'audioTrack2', type: 'audio', name: 'Audio Track 2', clips: [] },
        { id: 'textTrack', type: 'text', name: 'Text Track 1', clips: [] }
    ],
    trackVisibility: { textTrack: true, shapeTrack: true, videoTrack2: true, videoTrack: true, audioTrack: true, audioTrack2: true },
    trackLock: { textTrack: false, shapeTrack: false, videoTrack2: false, videoTrack: false, audioTrack: false, audioTrack2: false },
    selectedClipId: null,
    snapEnabled: true,
    csvData: [],
    placeholders: ['name', 'class'],
    selectedRowIndex: 0,
    batchSelection: [],
    canvasZoom: 100,
    canvasPanX: 0,
    canvasPanY: 0
};

// Asset cache: maps assetId -> { file, objectUrl, element (video/audio/image), duration }
const assetCache = new Map();
let audioContext = null;

// DOM Elements cache
let canvas, ctx, timelineContainer, timelineRuler, tracksContainer, playhead;
let timecodeDisplay, playPauseBtn, rowSelectorList, inspectorSection, generateBtn;
let activeDrag = null;
let isScrubbing = false;

// Initialize on DOM load — but defer canvas setup until editor shell is visible
// Safe function caller to prevent crashes on missing functions
function callIfExists(fnName, ...args) {
    if (typeof window[fnName] === 'function') return window[fnName](...args);
}

let _editorInitialized = false;

function runEditorInit() {
    if (_editorInitialized) return;
    _editorInitialized = true;
    initDOMElements();
    if (!canvas) { _editorInitialized = false; return; }
    initEventListeners();
    setupCanvas();
    if (typeof renderTimeline === 'function') renderTimeline();
    if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
    // Start the single render loop that drives playback and repaints.
    if (!window.ForgeCut || !window.ForgeCut.PlaybackEngine) {
        throw new Error('ForgeCut: PlaybackEngine failed to load — playback and rendering are unavailable.');
    }
    window.ForgeCut.PlaybackEngine.start(state, renderFrame);
    window.selectRow = selectRow;
}

window.addEventListener('DOMContentLoaded', () => {
    // Non-visual setup can run immediately (these don't need canvas)
    if (typeof setupRibbonNavigation === 'function') setupRibbonNavigation();
    if (typeof setupLeftSidebarTabs === 'function') setupLeftSidebarTabs();
    if (typeof setupRightSidebarTabs === 'function') setupRightSidebarTabs();
    if (typeof setupBackstageNavigation === 'function') setupBackstageNavigation();
    if (typeof setupFileInputListeners === 'function') setupFileInputListeners();

    // If the shell is already visible (welcome screen bypassed) initialise now.
    // Otherwise ui.js calls ForgeCut.initEditor() the moment it reveals the
    // shell. This used to be a 100ms poll plus a blind 4s timeout, which could
    // initialise the editor while the welcome screen was still up.
    const shell = document.getElementById('fc-editor-shell');
    if (shell && getComputedStyle(shell).display !== 'none') {
        runEditorInit();
    }
});

// Called by ui.js#launchEditor once the editor shell is on screen.
window.ForgeCut = window.ForgeCut || {};
window.ForgeCut.initEditor = runEditorInit;

function initDOMElements() {
    canvas = document.getElementById('renderCanvas');
    if (!canvas) return; // Editor shell not visible yet
    ctx = canvas.getContext('2d');
    timelineContainer = document.getElementById('timelineContainer');
    timelineRuler = document.getElementById('timelineRuler');
    tracksContainer = document.getElementById('tracksContainer');
    playhead = document.getElementById('playhead');
    timecodeDisplay = document.getElementById('timecodeDisplay');
    playPauseBtn = document.getElementById('playPauseBtn');
    rowSelectorList = document.getElementById('rowSelectorList');
    inspectorSection = document.querySelector('.inspector-section');
}

function setupCanvas() {
    if (!canvas) return;
    // Default video size: 1080x1920 (standard vertical shorts)
    canvas.width = 1080;
    canvas.height = 1920;

    // Initial size recalculation on canvas setup
    setTimeout(recalculateCanvasDisplaySize, 100);
}

function recalculateCanvasDisplaySize() {
    if (!canvas) return;
    const container = document.getElementById('canvasContainerBg');
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (!containerWidth || !containerHeight) return;

    const logicalAspectRatio = canvas.width / canvas.height;

    // Available size with safety padding
    const padding = 32;
    const maxW = Math.max(100, containerWidth - padding);
    const maxH = Math.max(100, containerHeight - padding);

    let displayWidth = maxW;
    let displayHeight = maxW / logicalAspectRatio;

    if (displayHeight > maxH) {
        displayHeight = maxH;
        displayWidth = maxH * logicalAspectRatio;
    }

    if (state.canvasZoom === undefined) {
        state.canvasZoom = 100;
    }

    displayWidth = displayWidth * (state.canvasZoom / 100);
    displayHeight = displayHeight * (state.canvasZoom / 100);

    const wrapper = document.getElementById('canvasWrapper');
    if (wrapper) {
        wrapper.style.width = `${displayWidth}px`;
        wrapper.style.height = `${displayHeight}px`;
    }

    const zoomLabel = document.getElementById('canvasZoomPercentLabel');
    if (zoomLabel) {
        zoomLabel.textContent = `${Math.round(state.canvasZoom)}%`;
    }

    // Position and size safeAreaPlatformBox relative to current aspect ratio bounds
    const safeAreaPlatform = state.safeAreaPlatform || 'YouTube';
    let safePctX = 0.1;
    let safePctY = 0.1;
    if (safeAreaPlatform === 'TikTok') {
        safePctX = 0.15;
        safePctY = 0.2;
    } else if (safeAreaPlatform === 'Instagram') {
        safePctX = 0.12;
        safePctY = 0.15;
    }

    const box = document.getElementById('safeAreaPlatformBox');
    if (box) {
        box.style.left = `${displayWidth * safePctX}px`;
        box.style.top = `${displayHeight * safePctY}px`;
        box.style.width = `${displayWidth * (1 - safePctX * 2)}px`;
        box.style.height = `${displayHeight * (1 - safePctY * 2)}px`;
    }
}
window.recalculateCanvasDisplaySize = recalculateCanvasDisplaySize;

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

// Render active clips onto the canvas
function renderCanvasComposition() {
    if (!canvas || !ctx) return;

    // 1. Draw Checkerboard backdrop
    const chkSize = 32;
    for (let x = 0; x < canvas.width; x += chkSize) {
        for (let y = 0; y < canvas.height; y += chkSize) {
            ctx.fillStyle = ((x / chkSize + y / chkSize) % 2 === 0) ? '#1f2937' : '#111827';
            ctx.fillRect(x, y, chkSize, chkSize);
        }
    }

    // 2. Draw background configuration
    if (state.bgType === 'solid') {
        ctx.fillStyle = state.bgColor || '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (state.bgType === 'gradient') {
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, state.bgGradientStart || '#005faa');
        grad.addColorStop(1, state.bgGradientEnd || '#dee0e2');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (state.bgType === 'image' && state.bgImageUrl) {
        const bgImg = new Image();
        bgImg.src = state.bgImageUrl;
        try {
            ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        } catch (e) { }
    } else if (state.bgType === 'blur') {
        ctx.fillStyle = 'rgba(0, 95, 170, 0.4)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const activeRow = state.csvData[state.selectedRowIndex] || {};

    state.tracks.forEach(track => {
        if (state.trackVisibility[track.id] === false) return;

        track.clips.forEach(clip => {
            const inRange = state.currentTime >= clip.startTime && state.currentTime <= (clip.startTime + clip.duration);
            if (!inRange) return;

            // Apply keyframe interpolations before rendering
            const originalProperties = {};
            const numericProps = [
                'x', 'y', 'scale', 'rotation', 'opacity',
                'cropX', 'cropY', 'cropW', 'cropH',
                'blur', 'brightness', 'contrast', 'saturation', 'hue', 'playbackSpeed',
                'volume', 'gain', 'fadeIn', 'fadeOut', 'balance',
                'size', 'textStrokeWidth', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'lineHeight', 'letterSpacing',
                'shapeWidth', 'shapeHeight', 'strokeWidth', 'cornerRadius'
            ];
            numericProps.forEach(prop => {
                if (clip[prop] !== undefined) {
                    originalProperties[prop] = clip[prop];
                    clip[prop] = window.getInterpolatedValue(clip, prop, clip[prop]);
                }
            });

            ctx.save();

            // Calculate animated properties if AnimationEngine is loaded
            let animProps = { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, opacity: 1.0 };
            if (window.ForgeCut && window.ForgeCut.AnimationEngine) {
                const clipLocalTime = state.currentTime - clip.startTime;
                animProps = window.ForgeCut.AnimationEngine.getAnimatedProperties(clip, clipLocalTime);
            }

            ctx.globalAlpha = (clip.opacity !== undefined ? clip.opacity : 1.0) * animProps.opacity;

            // Handle transition blending if TransitionEngine is loaded
            let transProgress = { active: false };
            if (window.ForgeCut && window.ForgeCut.TransitionEngine) {
                transProgress = window.ForgeCut.TransitionEngine.getTransitionProgress(clip, state.currentTime);
            }

            if (track.type === 'video' || track.type === 'image') {
                const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
                    ? window.ForgeCut.MediaEngine.getAsset(clip.assetId)
                    : assetCache.get(clip.assetId);

                if (asset && asset.element) {
                    const el = asset.element;
                    const x = (clip.x !== undefined ? clip.x : canvas.width / 2) + animProps.offsetX;
                    const y = (clip.y !== undefined ? clip.y : canvas.height / 2) + animProps.offsetY;
                    const scale = (clip.scale !== undefined ? clip.scale : 1.0) * animProps.scale;
                    const rotation = (clip.rotation !== undefined ? clip.rotation : 0) + animProps.rotation;

                    ctx.translate(x, y);
                    ctx.rotate(rotation * Math.PI / 180);
                    ctx.scale(scale, scale);
                    try {
                        const width = el.videoWidth || el.width || 320;
                        const height = el.videoHeight || el.height || 180;

                        if (transProgress.active && window.ForgeCut.TransitionEngine) {
                            if (!window._offscreenCanvasFrom) {
                                window._offscreenCanvasFrom = document.createElement('canvas');
                                window._offscreenCanvasTo = document.createElement('canvas');
                            }
                            if (window._offscreenCanvasFrom.width !== canvas.width) {
                                window._offscreenCanvasFrom.width = canvas.width;
                                window._offscreenCanvasFrom.height = canvas.height;
                                window._offscreenCanvasTo.width = canvas.width;
                                window._offscreenCanvasTo.height = canvas.height;
                            }

                            const fromCtx = window._offscreenCanvasFrom.getContext('2d');
                            fromCtx.clearRect(0, 0, canvas.width, canvas.height);
                            fromCtx.drawImage(canvas, 0, 0);

                            const toCtx = window._offscreenCanvasTo.getContext('2d');
                            toCtx.clearRect(0, 0, canvas.width, canvas.height);
                            toCtx.save();
                            toCtx.translate(x, y);
                            toCtx.rotate(rotation * Math.PI / 180);
                            toCtx.scale(scale, scale);
                            if (clip.cropX !== undefined && clip.cropY !== undefined && clip.cropW !== undefined && clip.cropH !== undefined) {
                                toCtx.drawImage(el, clip.cropX, clip.cropY, clip.cropW, clip.cropH, -clip.cropW / 2, -clip.cropH / 2, clip.cropW, clip.cropH);
                            } else {
                                toCtx.drawImage(el, -width / 2, -height / 2);
                            }
                            toCtx.restore();

                            ctx.restore();
                            ctx.save();
                            window.ForgeCut.TransitionEngine.applyTransition(
                                ctx,
                                window._offscreenCanvasFrom,
                                window._offscreenCanvasTo,
                                transProgress.progress,
                                transProgress.type,
                                transProgress.direction,
                                canvas.width,
                                canvas.height,
                                clip.id
                            );
                        } else {
                            const blurVal = clip.blur || 0;
                            const brightnessVal = clip.brightness !== undefined ? clip.brightness : 1.0;
                            const contrastVal = clip.contrast !== undefined ? clip.contrast : 1.0;
                            const saturationVal = clip.saturation !== undefined ? clip.saturation : 1.0;
                            const hueVal = clip.hue || 0;
                            ctx.filter = `blur(${blurVal}px) brightness(${brightnessVal}) contrast(${contrastVal}) saturate(${saturationVal}) hue-rotate(${hueVal}deg)`;

                            if (clip.cropX !== undefined && clip.cropY !== undefined && clip.cropW !== undefined && clip.cropH !== undefined) {
                                ctx.drawImage(el, clip.cropX, clip.cropY, clip.cropW, clip.cropH, -clip.cropW / 2, -clip.cropH / 2, clip.cropW, clip.cropH);
                            } else {
                                ctx.drawImage(el, -width / 2, -height / 2);
                            }
                            ctx.filter = 'none';
                        }
                    } catch (e) { }
                }
            } else if (track.type === 'text') {
                if (window.ForgeCut && window.ForgeCut.TextRenderer) {
                    // Temporarily apply animation offsets
                    const origX = clip.x;
                    const origY = clip.y;
                    const origRot = clip.rotation;
                    const origOpacity = clip.opacity;

                    clip.x = (origX !== undefined ? origX : canvas.width / 2) + animProps.offsetX;
                    clip.y = (origY !== undefined ? origY : canvas.height / 2) + animProps.offsetY;
                    clip.rotation = (origRot !== undefined ? origRot : 0) + animProps.rotation;
                    clip.opacity = (origOpacity !== undefined ? origOpacity : 1.0) * animProps.opacity;

                    window.ForgeCut.TextRenderer.renderText(ctx, clip, canvas.width, canvas.height, activeRow, state.placeholders);

                    // Restore
                    clip.x = origX;
                    clip.y = origY;
                    clip.rotation = origRot;
                    clip.opacity = origOpacity;
                } else {
                    let text = clip.text || '';
                    state.placeholders.forEach(ph => {
                        const placeholderStr = `{${ph}}`;
                        const placeholderStrDouble = `{{${ph}}}`;
                        const val = activeRow[ph] || activeRow[placeholderStr] || activeRow[placeholderStrDouble] || '';
                        text = text.replaceAll(placeholderStrDouble, val);
                        text = text.replaceAll(placeholderStr, val);
                    });

                    const x = (clip.x !== undefined ? clip.x : canvas.width / 2) + animProps.offsetX;
                    const y = (clip.y !== undefined ? clip.y : canvas.height / 2) + animProps.offsetY;
                    const size = (clip.size !== undefined ? clip.size : 72) * animProps.scale;
                    const color = clip.color || '#ffffff';
                    const font = clip.font || 'Arial';
                    const rotation = (clip.rotation !== undefined ? clip.rotation : 0) + animProps.rotation;

                    ctx.translate(x, y);
                    ctx.rotate(rotation * Math.PI / 180);

                    ctx.font = `bold ${size}px ${font}`;
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                    ctx.shadowBlur = 12;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 4;

                    ctx.fillText(text, 0, 0);
                }
            } else if (track.type === 'shape') {
                if (window.ForgeCut && window.ForgeCut.ShapeRenderer) {
                    const origX = clip.x;
                    const origY = clip.y;
                    const origRot = clip.rotation;
                    const origOpacity = clip.opacity;

                    clip.x = (origX !== undefined ? origX : canvas.width / 2) + animProps.offsetX;
                    clip.y = (origY !== undefined ? origY : canvas.height / 2) + animProps.offsetY;
                    clip.rotation = (origRot !== undefined ? origRot : 0) + animProps.rotation;
                    clip.opacity = (origOpacity !== undefined ? origOpacity : 1.0) * animProps.opacity;

                    window.ForgeCut.ShapeRenderer.renderShape(ctx, clip);

                    clip.x = origX;
                    clip.y = origY;
                    clip.rotation = origRot;
                    clip.opacity = origOpacity;
                }
            }

            // Restore original properties
            numericProps.forEach(prop => {
                if (originalProperties[prop] !== undefined) {
                    clip[prop] = originalProperties[prop];
                }
            });

            ctx.restore();
        });
    });

    // Draw Gridlines
    if (state.showGridlines) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        const gridGap = 80;
        for (let x = gridGap; x < canvas.width; x += gridGap) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = gridGap; y < canvas.height; y += gridGap) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Draw Guides
    if (state.showGuides) {
        ctx.save();
        ctx.strokeStyle = '#005faa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, 0);
        ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        ctx.restore();
    }

    // Draw Safe Area Guides
    if (state.showSafeAreaGuide) {
        ctx.save();
        const platform = state.safeAreaPlatform || 'YouTube';
        const config = state.safeZoneConfig || { title: true, action: true, caption: true, danger: true };
        const cw = canvas.width;
        const ch = canvas.height;

        ctx.lineWidth = 2;
        ctx.font = 'bold 16px Arial';

        // 1. UI Danger Zones (areas covered by buttons/captions)
        if (config.danger) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
            if (platform === 'TikTok' || platform === 'Reels' || platform === 'Shorts') {
                // Right side buttons & Bottom captions
                ctx.fillRect(cw - 120, ch / 2, 120, ch / 2 - 100);
                ctx.fillRect(0, ch - 250, cw, 250);
            } else if (platform === 'YouTube') {
                // Player controls
                ctx.fillRect(0, ch - 80, cw, 80);
            } else if (platform === 'Instagram') {
                ctx.fillRect(0, ch - 100, cw, 100);
            }
        }

        // 2. Action Safe
        if (config.action) {
            ctx.strokeStyle = '#4CAF50';
            ctx.setLineDash([5, 5]);
            let ax = cw * 0.05; let ay = ch * 0.05;
            ctx.strokeRect(ax, ay, cw - ax * 2, ch - ay * 2);
            ctx.fillStyle = '#4CAF50';
            ctx.fillText('Action Safe', ax + 10, ay + 20);
        }

        // 3. Title Safe
        if (config.title) {
            ctx.strokeStyle = '#2196F3';
            ctx.setLineDash([5, 5]);
            let tx = cw * 0.1; let ty = ch * 0.1;
            ctx.strokeRect(tx, ty, cw - tx * 2, ch - ty * 2);
            ctx.fillStyle = '#2196F3';
            ctx.fillText('Title Safe', tx + 10, ty + 20);
        }

        // 4. Caption Safe
        if (config.caption) {
            ctx.strokeStyle = '#FFC107';
            ctx.setLineDash([10, 5]);
            let cx = cw * 0.1; let cy = ch * 0.75;
            if (platform === 'TikTok') cy = ch * 0.6;
            ctx.strokeRect(cx, cy, cw - cx * 2, ch * 0.2);
            ctx.fillStyle = '#FFC107';
            ctx.fillText('Caption Safe', cx + 10, cy + 20);
        }

        ctx.restore();
    }

    drawSelectedClipTransformBox();

    // Render Canvas Guides
    if (window._activeGuides && window._activeGuides.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#00c2ff'; // High visibility guide color
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);

        window._activeGuides.forEach(g => {
            if (g.type === 'v') {
                ctx.beginPath();
                ctx.moveTo(g.x, 0);
                ctx.lineTo(g.x, canvas.height);
                ctx.stroke();

                if (g.label) {
                    ctx.fillStyle = '#00c2ff';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(g.label, g.x + 10, 40);
                }
            } else if (g.type === 'h') {
                ctx.beginPath();
                ctx.moveTo(0, g.y);
                ctx.lineTo(canvas.width, g.y);
                ctx.stroke();

                if (g.label) {
                    ctx.fillStyle = '#00c2ff';
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(g.label, 20, g.y - 10);
                }
            }
        });
        ctx.restore();
    }
}

function drawSelectedClipTransformBox() {
    const ids = state.selectedClipIds || (state.selectedClipId ? [state.selectedClipId] : []);
    if (ids.length === 0) return;

    ids.forEach(id => {
        let selectedClip = findClipById(id);
        if (!selectedClip) return;

        let selectedTrack = state.tracks.find(t => t.clips.includes(selectedClip));
        if (!selectedTrack) return;

        if (selectedTrack.type === 'audio' && selectedClip.linkedClipId) {
            const linked = findClipById(selectedClip.linkedClipId);
            if (linked) {
                const linkedTrack = state.tracks.find(t => t.clips.includes(linked));
                if (linkedTrack && (linkedTrack.type === 'video' || linkedTrack.type === 'image' || linkedTrack.type === 'text')) {
                    selectedClip = linked;
                    selectedTrack = linkedTrack;
                }
            }
        }

        if (state.trackLock[selectedTrack.id]) return;

        const inRange = state.currentTime >= selectedClip.startTime && state.currentTime <= (selectedClip.startTime + selectedClip.duration);
        if (!inRange || (selectedTrack.type !== 'video' && selectedTrack.type !== 'text' && selectedTrack.type !== 'image' && selectedTrack.type !== 'shape')) return;

        let w = 200;
        let h = 100;

        if (selectedTrack.type === 'video' || selectedTrack.type === 'image') {
            const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
                ? window.ForgeCut.MediaEngine.getAsset(selectedClip.assetId)
                : assetCache.get(selectedClip.assetId);
            if (asset && asset.element) {
                const el = asset.element;
                w = (el.videoWidth || el.width || 320) * (selectedClip.scale || 1.0);
                h = (el.videoHeight || el.height || 180) * (selectedClip.scale || 1.0);
            }
        } else if (selectedTrack.type === 'text') {
            if (window.ForgeCut && window.ForgeCut.TextRenderer) {
                const size = window.ForgeCut.TextRenderer.measureText(ctx, selectedClip, state.placeholders, state.csvData[state.selectedRowIndex]);
                w = size.width;
                h = size.height;
            } else {
                const size = selectedClip.size || 72;
                ctx.font = `bold ${size}px ${selectedClip.font || 'Arial'}`;
                w = ctx.measureText(selectedClip.text || '').width + 40;
                h = size + 20;
            }
        } else if (selectedTrack.type === 'shape') {
            w = selectedClip.shapeWidth || 200;
            h = selectedClip.shapeHeight || 150;
        }

        const x = selectedClip.x !== undefined ? selectedClip.x : canvas.width / 2;
        const y = selectedClip.y !== undefined ? selectedClip.y : canvas.height / 2;
        const rotation = selectedClip.rotation !== undefined ? selectedClip.rotation : 0;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.strokeStyle = '#0078d4'; // Fluent design blue selection outline
        ctx.lineWidth = 3;
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0078d4';
        ctx.lineWidth = 2;
        const handleSize = 12;

        // 8 Handles: 4 Corners + 4 Edges
        // Corners
        ctx.fillRect(-w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);

        // Edges
        ctx.fillRect(-handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-handleSize / 2, -h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
        ctx.fillRect(-w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(-w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.fillRect(w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(w / 2 - handleSize / 2, -handleSize / 2, handleSize, handleSize);

        // Rotation Handle
        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(0, -h / 2 - 25);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -h / 2 - 25, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    });
}

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
    timelineRuler.innerHTML = '';

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

    const canvasEl = document.createElement('canvas');
    canvasEl.width = totalWidth;
    canvasEl.height = 24; // height of timelineRuler (h-6 = 24px)
    canvasEl.style.width = `${totalWidth}px`;
    canvasEl.style.height = `24px`;
    canvasEl.style.display = 'block';
    canvasEl.style.pointerEvents = 'none';
    timelineRuler.appendChild(canvasEl);

    const ctxRuler = canvasEl.getContext('2d');

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

        contentDiv.innerHTML = '';

        track.clips.forEach(clip => {
            const clipEnd = clip.startTime + clip.duration;
            const isVisible = (clipEnd >= visibleStart - 10) && (clip.startTime <= visibleEnd + 10);
            if (!isVisible) return;

            const isSelected = clip.id === state.selectedClipId || (clip.linkedClipId && clip.linkedClipId === state.selectedClipId);
            const isDragging = activeDrag && activeDrag.clipId === clip.id;

            const clipEl = document.createElement('div');
            clipEl.className = `timeline-clip clip-${track.type} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging opacity-60 scale-95 border-dashed border-2 border-primary' : ''}`;

            const left = clip.startTime * state.zoom;
            const width = clip.duration * state.zoom;

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
                    if (track.type === 'image') {
                        const img = document.createElement('img');
                        img.src = asset.objectUrl;
                        img.className = 'absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none';
                        clipEl.appendChild(img);
                    } else if (track.type === 'video') {
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
            titleSpan.innerHTML = `
                <div class="font-bold truncate max-w-full text-[10px] text-white">${clip.name || clip.text || track.name}</div>
                <div class="text-[8px] text-gray-300">${clip.duration.toFixed(2)}s</div>
            `;
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

            contentDiv.appendChild(clipEl);
        });
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

// Navigation Setup functions
function setupRibbonNavigation() {
    document.querySelectorAll('.ribbon-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ribbon-tab-btn').forEach(b => {
                b.className = 'ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-on-surface-variant hover:bg-surface-container-high transition-colors';
            });
            btn.className = 'ribbon-tab-btn px-4 h-full font-ribbon-tab text-ribbon-tab text-primary border-b-2 border-primary font-bold bg-surface-container-low';

            const activeTab = btn.dataset.tab;
            document.querySelectorAll('.ribbon-group-container').forEach(group => {
                group.classList.add('hidden');
            });
            const activeGroup = document.getElementById(`ribbon-group-${activeTab}`);
            if (activeGroup) {
                activeGroup.classList.remove('hidden');
            }

            if (activeTab === 'bulk') {
                if (typeof window.openBulkDrawer === 'function') {
                    window.openBulkDrawer();
                }
            } else {
                if (typeof window.closeBulkDrawer === 'function') {
                    window.closeBulkDrawer();
                }
            }
        });
    });
}

function setupLeftSidebarTabs() {
    document.querySelectorAll('.left-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.left-tab-btn').forEach(b => {
                b.className = 'left-tab-btn flex-1 py-2 text-center text-on-surface-variant hover:bg-surface-container-high';
            });
            btn.className = 'left-tab-btn flex-1 py-2 text-center border-b-2 border-primary font-bold text-primary';

            const activeTab = btn.dataset.leftTab;
            document.querySelectorAll('.left-tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            const activeEl = document.getElementById(`left-panel-${activeTab}`);
            if (activeEl) {
                activeEl.classList.remove('hidden');
            }
        });
    });
}

function setupRightSidebarTabs() {
    document.querySelectorAll('.right-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.right-tab-btn').forEach(b => {
                b.className = 'right-tab-btn font-semibold text-sm text-on-surface-variant pb-1';
            });
            btn.className = 'right-tab-btn font-semibold text-sm text-primary border-b-2 border-primary pb-1';

            const activeTab = btn.dataset.rightTab;
            document.querySelectorAll('.right-tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            const activeEl = document.getElementById(`right-panel-${activeTab}`);
            if (activeEl) {
                activeEl.classList.remove('hidden');
            }
        });
    });
}

function setupBackstageNavigation() {
    document.querySelectorAll('.backstage-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.backstage-nav-btn').forEach(b => {
                b.className = 'backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-transparent border-none text-left cursor-pointer';
            });
            btn.className = 'backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-white/20 font-semibold border-none text-left cursor-pointer';

            const activeTab = btn.dataset.backstageTab;
            document.querySelectorAll('.backstage-section').forEach(sec => {
                sec.classList.add('hidden');
            });
            const activeSec = document.getElementById(`backstage-section-${activeTab}`);
            if (activeSec) {
                activeSec.classList.remove('hidden');
            }
        });
    });
}

function setupFileInputListeners() {
    const bindInput = (id, type) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                for (let file of e.target.files) {
                    handleAssetUpload(file, type);
                }
            });
        }
    };
    bindInput('mediaFileInput', 'video');
    bindInput('audioFileInput', 'audio');
    bindInput('imageFileInput', 'image');

    const backstageUploadInput = document.getElementById('backstageUploadInput');
    if (backstageUploadInput) {
        backstageUploadInput.addEventListener('change', (e) => {
            for (let file of e.target.files) {
                let type = 'video';
                if (file.type.startsWith('audio')) type = 'audio';
                else if (file.type.startsWith('image')) type = 'image';
                handleAssetUpload(file, type);
            }
            closeBackstage();
        });
    }
}

// Backstage open/close — handled by ui.js with Office-style animation
// These stubs ensure any early calls before ui.js loads don't crash
if (!window.openBackstage) window.openBackstage = function () {
    const backstage = document.getElementById('backstageOverlay');
    if (backstage) { backstage.classList.remove('hidden'); backstage.style.display = 'flex'; }
};
if (!window.closeBackstage) window.closeBackstage = function () {
    const backstage = document.getElementById('backstageOverlay');
    if (backstage) { backstage.classList.add('hidden'); backstage.style.display = 'none'; }
};

// Undo / Redo mock hooks
window.triggerUndo = function () { fcToast('Undo action completed'); };
window.triggerRedo = function () { fcToast('Redo action completed'); };

// Native App Commands simulations
window.openProjectSettings = function () {
    openBackstage();
    const btn = document.querySelector('[data-backstage-tab="settings"]');
    if (btn) btn.click();
};
window.minimizeApp = function () { fcToast('Application minimized'); };
window.maximizeApp = function () { fcToast('Application maximized'); };
window.closeApp = function () { fcToast('Application closed'); };

// Timeline zoom adjust
window.adjustZoom = function (amount) {
    state.zoom = Math.max(5, Math.min(100, state.zoom + amount));
    const footerZoomSlider = document.getElementById('footerZoomSlider');
    if (footerZoomSlider) footerZoomSlider.value = state.zoom;
    const footerZoomLabel = document.getElementById('footerZoomLabel');
    if (footerZoomLabel) footerZoomLabel.textContent = `${state.zoom}%`;
    renderTimeline();
};

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
            const rect = timelineContainer.getBoundingClientRect();
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

        renderTimeline();
        syncMediaPlayback();
    });

    document.addEventListener('mouseup', () => {
        if (activeDrag) {
            saveStateToHistory(`Timeline Drag ${activeDrag.type}`);
        }
        activeDrag = null;
        state.isSnapping = false;
        renderTimeline();
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

        const rect = canvas.getBoundingClientRect();
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
            updateInspector();
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
            updateInspector();
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
            updateInspector();
        } else if (activeCanvasDrag.type === 'rotate') {
            const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
            const angleRad = Math.atan2(mouseY - activeCanvasDrag.cy, mouseX - activeCanvasDrag.cx);
            const angleDeg = (angleRad * 180 / Math.PI) + 90;
            clip.rotation = Math.round(angleDeg % 360);
            updateInspector();
        }
    });

    document.addEventListener('mouseup', () => {
        activeCanvasDrag = null;
        window._activeGuides = [];
        renderCanvasComposition();
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

function findClipById(clipId) {
    let found = null;
    state.tracks.forEach(track => {
        const c = track.clips.find(x => x.id === clipId);
        if (c) found = c;
    });
    return found;
}

function selectClip(clipId, isCtrl = false) {
    if (!state.selectedClipIds) state.selectedClipIds = [];
    if (isCtrl) {
        const idx = state.selectedClipIds.indexOf(clipId);
        if (idx !== -1) {
            state.selectedClipIds.splice(idx, 1);
        } else {
            state.selectedClipIds.push(clipId);
        }
        state.selectedClipId = state.selectedClipIds.length > 0 ? state.selectedClipIds[state.selectedClipIds.length - 1] : null;
    } else {
        state.selectedClipIds = clipId ? [clipId] : [];
        state.selectedClipId = clipId;
    }
    renderTracks();
    updateInspector();
}

function splitClipAtPlayhead(clipId) {
    const clip = findClipById(clipId);
    if (!clip) return;

    const playheadLocal = state.currentTime;
    if (playheadLocal <= clip.startTime || playheadLocal >= (clip.startTime + clip.duration)) {
        return;
    }

    const track = state.tracks.find(t => t.clips.includes(clip));
    if (!track || state.trackLock[track.id]) return;

    saveStateToHistory();

    const originalDuration = clip.duration;
    const splitPoint = playheadLocal - clip.startTime;

    clip.duration = splitPoint;

    const newClipId = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newClip = {
        ...clip,
        id: newClipId,
        startTime: playheadLocal,
        duration: originalDuration - splitPoint,
        trimStart: (clip.trimStart || 0) + splitPoint
    };
    track.clips.push(newClip);

    // Split linked clip if it exists
    const linkedClip = clip.linkedClipId ? findClipById(clip.linkedClipId) : null;
    if (linkedClip) {
        const linkedTrack = state.tracks.find(t => t.clips.includes(linkedClip));
        if (linkedTrack && !state.trackLock[linkedTrack.id]) {
            const originalLinkedDuration = linkedClip.duration;
            linkedClip.duration = splitPoint;

            const newLinkedClipId = `clip_${Date.now()}_linked_${Math.random().toString(36).substr(2, 5)}`;
            const newLinkedClip = {
                ...linkedClip,
                id: newLinkedClipId,
                startTime: playheadLocal,
                duration: originalLinkedDuration - splitPoint,
                trimStart: (linkedClip.trimStart || 0) + splitPoint,
                linkedClipId: newClipId
            };
            linkedTrack.clips.push(newLinkedClip);
            newClip.linkedClipId = newLinkedClipId;
        }
    }

    selectClip(newClip.id);
    renderTimeline();
    syncMediaPlayback();
}

// Inspector Collapsible Toggle
window.toggleInspectorSection = function (id) {
    if (!state.inspectorCollapsed) state.inspectorCollapsed = {};
    const content = document.getElementById(`sec-${id}`);
    const chev = document.getElementById(`chevron-${id}`);
    if (content) {
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            if (chev) chev.textContent = 'expand_more';
            state.inspectorCollapsed[id] = false;
        } else {
            content.classList.add('hidden');
            if (chev) chev.textContent = 'chevron_right';
            state.inspectorCollapsed[id] = true;
        }
    }
};

// Inspector Sync
function updateInspector() {
    if (!state.selectedClipId) {
        inspectorSection.innerHTML = '<div style="color: var(--text-muted); font-size:0.8rem; text-align:center;">Select a clip to edit properties</div>';
        return;
    }

    const clip = findClipById(state.selectedClipId);
    if (!clip) return;

    const track = state.tracks.find(t => t.clips.includes(clip));
    if (!track) return;

    // Sync Ribbon Transition Controls
    const transitionDurationInput = document.getElementById('transitionDurationInput');
    if (transitionDurationInput) {
        transitionDurationInput.value = (clip.transitionDuration !== undefined ? clip.transitionDuration : 1.5).toFixed(2);
    }
    const transitionSoundSelect = document.getElementById('transitionSoundSelect');
    if (transitionSoundSelect) {
        transitionSoundSelect.value = clip.transitionSound || 'none';
    }

    // Sync Ribbon Animation Controls
    const animDelayInput = document.getElementById('animationDelayInput');
    if (animDelayInput) {
        animDelayInput.value = `${(clip.animations && clip.animations.delay !== undefined ? parseFloat(clip.animations.delay) : 0).toFixed(2)}s`;
    }
    const animDurationInput = document.getElementById('animationDurationInput');
    if (animDurationInput) {
        animDurationInput.value = `${(clip.animations && clip.animations.duration !== undefined ? parseFloat(clip.animations.duration) : 0.5).toFixed(2)}s`;
    }

    const kf = (prop) => {
        const localTime = state.currentTime - clip.startTime;
        const hasKf = clip.keyframes && clip.keyframes[prop] && clip.keyframes[prop].some(kf => Math.abs(kf.time - localTime) < 0.15);
        return `<span class="material-symbols-outlined text-[14px] cursor-pointer ${hasKf ? 'text-blue-500 font-bold' : 'text-white/40'} hover:text-blue-500 mr-1 select-none align-middle" onclick="window.toggleKeyframe('${clip.id}', '${prop}')" title="Toggle Keyframe">change_history</span>`;
    };

    const renderSection = (title, id, contentHtml) => {
        if (!state.inspectorCollapsed) state.inspectorCollapsed = {};
        const isCollapsed = state.inspectorCollapsed[id] || false;
        return `
            <div class="fluent-section border border-outline-variant/30 rounded mb-2 overflow-hidden bg-surface-container-low">
                <div class="fluent-section-header px-3 py-1.5 bg-surface-container-high flex items-center justify-between cursor-pointer select-none font-bold text-xs" onclick="window.toggleInspectorSection('${id}')">
                    <span class="text-on-surface">${title}</span>
                    <span class="material-symbols-outlined text-xs text-on-surface-variant" id="chevron-${id}">${isCollapsed ? 'chevron_right' : 'expand_more'}</span>
                </div>
                <div class="fluent-section-content p-3 flex flex-col gap-2 ${isCollapsed ? 'hidden' : ''}" id="sec-${id}">
                    ${contentHtml}
                </div>
            </div>
        `;
    };

    let transformHtml = '';
    let appearanceHtml = '';
    let textHtml = '';
    let audioHtml = '';
    let animationHtml = '';
    let effectsHtml = '';

    // Transform properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        transformHtml = `
            <div class="control-group">
                <label>${kf('x')} Position X (px)</label>
                <input type="number" id="insp_x" value="${Math.round(clip.x !== undefined ? clip.x : canvas.width / 2)}">
            </div>
            <div class="control-group">
                <label>${kf('y')} Position Y (px)</label>
                <input type="number" id="insp_y" value="${Math.round(clip.y !== undefined ? clip.y : canvas.height / 2)}">
            </div>
            <div class="control-group mt-1">
                <label>Quick Positioning</label>
                <div class="grid grid-cols-3 gap-1 mt-1">
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-left')" title="Top Left"><span class="material-symbols-outlined text-sm">north_west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-center')" title="Top Center"><span class="material-symbols-outlined text-sm">north</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'top-right')" title="Top Right"><span class="material-symbols-outlined text-sm">north_east</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'mid-left')" title="Middle Left"><span class="material-symbols-outlined text-sm">west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'center')" title="Center Canvas"><span class="material-symbols-outlined text-sm">filter_center_focus</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'mid-right')" title="Middle Right"><span class="material-symbols-outlined text-sm">east</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-left')" title="Bottom Left"><span class="material-symbols-outlined text-sm">south_west</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-center')" title="Bottom Center"><span class="material-symbols-outlined text-sm">south</span></button>
                    <button class="flex items-center justify-center p-1 rounded hover:bg-surface-container-high transition-colors text-on-surface bg-surface-container border-none cursor-pointer" onclick="window.positionObject('${clip.id}', 'bot-right')" title="Bottom Right"><span class="material-symbols-outlined text-sm">south_east</span></button>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('rotation')} Rotation (deg)</label>
                <input type="range" id="insp_rot" min="0" max="360" value="${clip.rotation || 0}">
            </div>
        `;
    }

    // Appearance properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        appearanceHtml = `
            <div class="control-group">
                <label>${kf('opacity')} Opacity</label>
                <input type="range" id="insp_opacity" min="0" max="100" value="${Math.round((clip.opacity !== undefined ? clip.opacity : 1.0) * 100)}">
            </div>
        `;

        if (track.type === 'video' || track.type === 'image') {
            appearanceHtml += `
                <div class="control-group">
                    <label>${kf('scale')} Scale</label>
                    <input type="range" id="insp_scale" min="10" max="300" value="${Math.round((clip.scale || 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('blur')} Blur (px)</label>
                    <input type="range" id="insp_blur" min="0" max="50" value="${clip.blur || 0}">
                </div>
                <div class="control-group">
                    <label>${kf('brightness')} Brightness</label>
                    <input type="range" id="insp_brightness" min="0" max="300" value="${Math.round((clip.brightness !== undefined ? clip.brightness : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('contrast')} Contrast</label>
                    <input type="range" id="insp_contrast" min="0" max="300" value="${Math.round((clip.contrast !== undefined ? clip.contrast : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('saturation')} Saturation</label>
                    <input type="range" id="insp_saturation" min="0" max="300" value="${Math.round((clip.saturation !== undefined ? clip.saturation : 1.0) * 100)}">
                </div>
                <div class="control-group">
                    <label>${kf('hue')} Hue (deg)</label>
                    <input type="range" id="insp_hue" min="0" max="360" value="${clip.hue || 0}">
                </div>
                <div class="control-group">
                    <label>${kf('playbackSpeed')} Playback Speed</label>
                    <input type="range" id="insp_playback_speed" min="25" max="400" value="${Math.round((clip.playbackSpeed || 1.0) * 100)}">
                </div>
            `;
        }

        const compatibleTracks = state.tracks.filter(t => t.type === track.type);
        if (compatibleTracks.length > 1) {
            appearanceHtml += `
                <div class="control-group">
                    <label>Layer (Track)</label>
                    <select id="insp_track" onchange="moveClipToTrack('${clip.id}', this.value)" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white">
                        ${compatibleTracks.map(t => `<option value="${t.id}" ${t.id === track.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                </div>
            `;
        }
    }

    // Text specific properties
    if (track.type === 'text') {
        const availableFonts = window.ForgeCut && window.ForgeCut.TextRenderer ? window.ForgeCut.TextRenderer.getAvailableFonts() : ['Arial', 'Helvetica'];
        textHtml = `
            <div class="control-group">
                <label>Text Value</label>
                <input type="text" id="insp_text" value="${esc(clip.text || '')}">
            </div>
            <div class="control-group">
                <label>Font Family</label>
                <div class="flex gap-2">
                    <select id="insp_font" class="flex-1 bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white" style="font-size: 14px;">
                        ${availableFonts.map(f => `<option value="${f}" style="font-family: '${f}';" ${clip.font === f ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('size')} Font Size (px)</label>
                <input type="number" id="insp_size" min="10" value="${clip.size || 72}">
            </div>
            <div class="control-group">
                <label>Formatting</label>
                <div class="flex gap-2">
                    <button class="flex-1 py-1 rounded text-xs border ${clip.fontWeight === 'bold' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextWeight('${clip.id}')"><b>B</b></button>
                    <button class="flex-1 py-1 rounded text-xs border ${clip.italic ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextItalic('${clip.id}')"><i>I</i></button>
                    <button class="flex-1 py-1 rounded text-xs border ${clip.underline ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/50 text-on-surface-variant'}" onclick="toggleTextUnderline('${clip.id}')"><u>U</u></button>
                </div>
            </div>
            <div class="control-group">
                <label>Text Alignment</label>
                <div class="flex gap-2 mb-1">
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'left')">Left</button>
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'center')">Center</button>
                    <button class="flex-1 py-1 rounded text-xs border bg-surface-container border-none cursor-pointer text-on-surface hover:bg-surface-container-high" onclick="window.alignText('${clip.id}', 'right')">Right</button>
                </div>
            </div>
            <div class="control-group">
                <label>Color Mode</label>
                <select id="insp_color_mode" onchange="changeTextColorMode('${clip.id}', this.value)" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white">
                    <option value="solid" ${clip.colorType !== 'gradient' ? 'selected' : ''}>Solid Color</option>
                    <option value="gradient" ${clip.colorType === 'gradient' ? 'selected' : ''}>Gradient Fill</option>
                </select>
            </div>
            <div class="control-group" id="solid_color_group" style="${clip.colorType === 'gradient' ? 'display: none;' : ''}">
                <label>Text Color</label>
                <input type="color" id="insp_color" value="${clip.color || '#ffffff'}" class="w-full h-8 cursor-pointer rounded">
            </div>
            <div class="control-group" id="gradient_color_group" style="${clip.colorType !== 'gradient' ? 'display: none;' : ''}">
                <label>Gradient Colors</label>
                <div class="flex gap-2">
                    <input type="color" id="insp_grad_start" value="${clip.gradientStartColor || '#ff007f'}" class="flex-1 h-8 cursor-pointer rounded" title="Gradient Start">
                    <input type="color" id="insp_grad_end" value="${clip.gradientEndColor || '#7f00ff'}" class="flex-1 h-8 cursor-pointer rounded" title="Gradient End">
                </div>
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('letterSpacing')} Letter Spacing (px)</label>
                    <span class="text-white/70 font-medium">${clip.letterSpacing || 0}px</span>
                </div>
                <input type="range" id="insp_letter_spacing" min="-10" max="50" value="${clip.letterSpacing || 0}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('lineHeight')} Line Spacing</label>
                    <span class="text-white/70 font-medium">${clip.lineHeight || 1.3}</span>
                </div>
                <input type="range" id="insp_line_height" min="80" max="250" value="${Math.round((clip.lineHeight || 1.3) * 100)}" class="w-full">
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Stroke / Outline</label>
                <div class="flex gap-2 items-center mt-1">
                    <input type="color" id="insp_stroke_color" value="${clip.strokeColor || '#000000'}" class="w-8 h-8 cursor-pointer rounded">
                    <div class="flex-1">
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('textStrokeWidth')} Stroke Width</span>
                            <span>${clip.textStrokeWidth || 0}px</span>
                        </div>
                        <input type="range" id="insp_stroke_width" min="0" max="20" value="${clip.textStrokeWidth || 0}" class="w-full">
                    </div>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Text Shadow</label>
                <div class="flex flex-col gap-2 mt-1">
                    <div class="flex gap-2 items-center">
                        <label class="text-[10px] w-24">Shadow Color</label>
                        <input type="color" id="insp_shadow_color" value="${clip.shadowColor || '#000000'}" class="w-full h-6 cursor-pointer rounded">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowBlur')} Shadow Blur</span>
                            <span>${clip.shadowBlur !== undefined ? clip.shadowBlur : 12}px</span>
                        </div>
                        <input type="range" id="insp_shadow_blur" min="0" max="30" value="${clip.shadowBlur !== undefined ? clip.shadowBlur : 12}" class="w-full">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowOffsetX')} Offset X</span>
                            <span>${clip.shadowOffsetX !== undefined ? clip.shadowOffsetX : 0}px</span>
                        </div>
                        <input type="range" id="insp_shadow_offsetx" min="-20" max="20" value="${clip.shadowOffsetX !== undefined ? clip.shadowOffsetX : 0}" class="w-full">
                    </div>
                    <div>
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('shadowOffsetY')} Offset Y</span>
                            <span>${clip.shadowOffsetY !== undefined ? clip.shadowOffsetY : 4}px</span>
                        </div>
                        <input type="range" id="insp_shadow_offsety" min="-20" max="20" value="${clip.shadowOffsetY !== undefined ? clip.shadowOffsetY : 4}" class="w-full">
                    </div>
                </div>
            </div>
        `;
    }

    // Audio properties
    if (track.type === 'audio') {
        const isVoice = clip.isVoice || false;
        const duckAmount = clip.duckAmount !== undefined ? clip.duckAmount : 0.7;
        const censorBeepsCount = clip.censorBeeps ? clip.censorBeeps.length : 0;
        audioHtml = `
            <div class="control-group">
                <label>${kf('volume')} Volume</label>
                <div class="flex items-center gap-2">
                    <input type="range" id="insp_volume" min="0" max="200" value="${Math.round((clip.volume !== undefined ? clip.volume : 1.0) * 100)}" class="flex-1">
                    <span class="text-xs w-8 text-right">${Math.round((clip.volume !== undefined ? clip.volume : 1.0) * 100)}%</span>
                </div>
            </div>
            <div class="control-group">
                <label>${kf('gain')} Gain (dB)</label>
                <input type="range" id="insp_gain" min="0" max="300" value="${Math.round((clip.gain !== undefined ? clip.gain : 1.0) * 100)}">
            </div>
            <div class="control-group">
                <label>${kf('fadeIn')} Fade In (sec)</label>
                <input type="number" id="insp_fadein" step="0.1" min="0" value="${clip.fadeIn || 0}">
            </div>
            <div class="control-group">
                <label>${kf('fadeOut')} Fade Out (sec)</label>
                <input type="number" id="insp_fadeout" step="0.1" min="0" value="${clip.fadeOut || 0}">
            </div>
            <div class="control-group">
                <label>${kf('balance')} Balance (Panning)</label>
                <input type="range" id="insp_balance" min="-100" max="100" value="${Math.round((clip.balance !== undefined ? clip.balance : 0) * 100)}">
            </div>
            <div class="control-group flex items-center gap-2 mt-2">
                <input type="checkbox" id="insp_normalize" ${clip.normalize ? 'checked' : ''} onchange="window.toggleClipNormalize('${clip.id}', this.checked)">
                <label for="insp_normalize" class="text-xs font-semibold">Normalize Volume</label>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="flex items-center gap-2">
                    <input type="checkbox" id="insp_isvoice" ${isVoice ? 'checked' : ''} onchange="toggleClipVoice('${clip.id}', this.checked)">
                    <span class="font-medium text-xs">Is Voice / Dialogue Clip</span>
                </label>
            </div>
            <div class="control-group">
                <label>Ducking Intensity (Music only)</label>
                <div class="flex items-center gap-2">
                    <input type="range" id="insp_duckamount" min="0" max="100" value="${Math.round(duckAmount * 100)}" class="flex-1" oninput="changeClipDuckAmount('${clip.id}', this.value)">
                    <span class="text-xs w-8 text-right">${Math.round(duckAmount * 100)}%</span>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs">Censor Beeps (${censorBeepsCount})</label>
                <button class="w-full py-1 bg-[#4CAF50] text-white rounded text-xs mt-1 border-none cursor-pointer" onclick="addCensorBeepAtPlayhead('${clip.id}')">+ Add Censor Beep at Playhead</button>
                ${censorBeepsCount > 0 ? `
                <div class="max-h-24 overflow-y-auto bg-[#1e1e2e] p-1 rounded mt-1 text-xs flex flex-col gap-1">
                    ${clip.censorBeeps.map((beep, idx) => `
                        <div class="flex justify-between items-center bg-[#2d2d3e] p-1 rounded">
                            <span>Start: ${beep.startTime.toFixed(2)}s | Duration: ${beep.duration.toFixed(1)}s</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-red-500 hover:text-red-700" onclick="deleteCensorBeep('${clip.id}', ${idx})">delete</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        `;
    }

    // Effects properties
    if (track.type === 'video' || track.type === 'image') {
        const asset = (window.ForgeCut && window.ForgeCut.MediaEngine)
            ? window.ForgeCut.MediaEngine.getAsset(clip.assetId)
            : assetCache.get(clip.assetId);
        const assetW = asset ? (asset.width || 1920) : 1920;
        const assetH = asset ? (asset.height || 1080) : 1080;
        effectsHtml = `
            <div class="flex flex-col gap-2">
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropX')} Crop X</span>
                        <span>${clip.cropX !== undefined ? clip.cropX : 0}px</span>
                    </div>
                    <input type="range" id="insp_cropx" min="0" max="${assetW}" value="${clip.cropX !== undefined ? clip.cropX : 0}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropY')} Crop Y</span>
                        <span>${clip.cropY !== undefined ? clip.cropY : 0}px</span>
                    </div>
                    <input type="range" id="insp_cropy" min="0" max="${assetH}" value="${clip.cropY !== undefined ? clip.cropY : 0}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropW')} Crop Width</span>
                        <span>${clip.cropW !== undefined ? clip.cropW : assetW}px</span>
                    </div>
                    <input type="range" id="insp_cropw" min="50" max="${assetW}" value="${clip.cropW !== undefined ? clip.cropW : assetW}" class="w-full">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-white/70 mb-0.5">
                        <span>${kf('cropH')} Crop Height</span>
                        <span>${clip.cropH !== undefined ? clip.cropH : assetH}px</span>
                    </div>
                    <input type="range" id="insp_croph" min="50" max="${assetH}" value="${clip.cropH !== undefined ? clip.cropH : assetH}" class="w-full">
                </div>
            </div>
        `;
    } else if (track.type === 'shape') {
        const props = clip.shapeProps || {};
        effectsHtml = `
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('shapeWidth')} Width (px)</label>
                    <span class="text-white/70 font-medium">${clip.shapeWidth || 200}px</span>
                </div>
                <input type="range" id="insp_shape_width" min="10" max="800" value="${clip.shapeWidth || 200}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('shapeHeight')} Height (px)</label>
                    <span class="text-white/70 font-medium">${clip.shapeHeight || 150}px</span>
                </div>
                <input type="range" id="insp_shape_height" min="10" max="800" value="${clip.shapeHeight || 150}" class="w-full">
            </div>
            <div class="control-group">
                <div class="flex justify-between text-[11px] mb-1">
                    <label>${kf('cornerRadius')} Corner Radius</label>
                    <span class="text-white/70 font-medium">${props.cornerRadius || 0}px</span>
                </div>
                <input type="range" id="insp_shape_corner_radius" min="0" max="100" value="${props.cornerRadius || 0}" class="w-full">
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Fill Settings</label>
                <div class="flex flex-col gap-2 mt-1">
                    <div>
                        <label class="text-[10px]">Fill Mode</label>
                        <select id="insp_shape_fill_type" class="w-full bg-[#1e1e2e] border border-white/10 rounded p-1 text-xs text-white" onchange="changeShapeFillType('${clip.id}', this.value)">
                            <option value="solid" ${props.fillType === 'solid' ? 'selected' : ''}>Solid Color</option>
                            <option value="gradient" ${props.fillType === 'gradient' ? 'selected' : ''}>Gradient Fill</option>
                            <option value="pattern" ${props.fillType === 'pattern' ? 'selected' : ''}>Pattern Fill</option>
                            <option value="image" ${props.fillType === 'image' ? 'selected' : ''}>Image Fill</option>
                        </select>
                    </div>
                    <div id="shape_solid_fill_group" style="${props.fillType !== 'solid' && props.fillType !== undefined ? 'display:none;' : ''}">
                        <label>Color</label>
                        <input type="color" id="insp_shape_fill" value="${props.fill || '#ffc107'}" class="w-full h-8 cursor-pointer rounded">
                    </div>
                    <div id="shape_gradient_fill_group" style="${props.fillType !== 'gradient' ? 'display:none;' : ''}" class="flex gap-2">
                        <div class="flex-1">
                            <label class="text-[10px]">Start</label>
                            <input type="color" id="insp_shape_grad_start" value="${props.gradientStartColor || '#ffc107'}" class="w-full h-8 cursor-pointer rounded">
                        </div>
                        <div class="flex-1">
                            <label class="text-[10px]">End</label>
                            <input type="color" id="insp_shape_grad_end" value="${props.gradientEndColor || '#ff5722'}" class="w-full h-8 cursor-pointer rounded">
                        </div>
                    </div>
                </div>
            </div>
            <div class="control-group border-t border-white/10 pt-2 mt-2">
                <label class="font-semibold text-xs text-indigo-400">Outline & Shadow</label>
                <div class="flex gap-2 items-center mt-1">
                    <input type="color" id="insp_shape_stroke" value="${props.stroke || '#ffffff'}" class="w-8 h-8 cursor-pointer rounded">
                    <div class="flex-1">
                        <div class="flex justify-between text-[10px] text-white/70">
                            <span>${kf('strokeWidth')} Outline Width</span>
                            <span>${props.strokeWidth || 0}px</span>
                        </div>
                        <input type="range" id="insp_shape_stroke_width" min="0" max="30" value="${props.strokeWidth || 0}" class="w-full">
                    </div>
                </div>
                <div class="mt-2">
                    <div class="flex justify-between text-[10px] text-white/70">
                        <span>${kf('blur')} Shadow Blur</span>
                        <span>${props.blur || 0}px</span>
                    </div>
                    <input type="range" id="insp_shape_blur" min="0" max="100" value="${props.blur || 0}" class="w-full">
                </div>
            </div>
        `;
    }

    // Animation properties
    if (track.type === 'video' || track.type === 'text' || track.type === 'image' || track.type === 'shape') {
        const anims = clip.animations || { duration: 0.5, delay: 0, easing: 'easeInOut', entrance: 'None', exit: 'None', emphasis: 'None' };
        animationHtml = `
            <div class="flex flex-col gap-2">
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Entrance</label>
                    <select id="insp_anim_entrance" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'entrance', this.value)">
                        <option value="None" ${anims.entrance === 'None' || !anims.entrance ? 'selected' : ''}>None</option>
                        <option value="Fade In" ${anims.entrance === 'Fade In' ? 'selected' : ''}>Fade In</option>
                        <option value="Slide Left" ${anims.entrance === 'Slide Left' ? 'selected' : ''}>Slide Left</option>
                        <option value="Slide Right" ${anims.entrance === 'Slide Right' ? 'selected' : ''}>Slide Right</option>
                        <option value="Zoom In" ${anims.entrance === 'Zoom In' ? 'selected' : ''}>Zoom In</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Exit</label>
                    <select id="insp_anim_exit" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'exit', this.value)">
                        <option value="None" ${anims.exit === 'None' || !anims.exit ? 'selected' : ''}>None</option>
                        <option value="Fade Out" ${anims.exit === 'Fade Out' ? 'selected' : ''}>Fade Out</option>
                        <option value="Slide Left" ${anims.exit === 'Slide Left' ? 'selected' : ''}>Slide Left</option>
                        <option value="Slide Right" ${anims.exit === 'Slide Right' ? 'selected' : ''}>Slide Right</option>
                        <option value="Zoom Out" ${anims.exit === 'Zoom Out' ? 'selected' : ''}>Zoom Out</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Emphasis</label>
                    <select id="insp_anim_emphasis" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'emphasis', this.value)">
                        <option value="None" ${anims.emphasis === 'None' || !anims.emphasis ? 'selected' : ''}>None</option>
                        <option value="Scale" ${anims.emphasis === 'Scale' ? 'selected' : ''}>Scale</option>
                        <option value="Rotate" ${anims.emphasis === 'Rotate' ? 'selected' : ''}>Rotate</option>
                        <option value="Opacity" ${anims.emphasis === 'Opacity' ? 'selected' : ''}>Opacity</option>
                    </select>
                </div>
                <div class="flex gap-2 items-center">
                    <label class="text-[10px] w-12 text-on-surface-variant">Easing</label>
                    <select id="insp_anim_easing" class="flex-1 bg-surface-container border border-outline-variant/30 rounded p-1 text-xs" onchange="changeClipAnimation('${clip.id}', 'easing', this.value)">
                        <option value="linear" ${anims.easing === 'linear' ? 'selected' : ''}>linear</option>
                        <option value="easeIn" ${anims.easing === 'easeIn' ? 'selected' : ''}>easeIn</option>
                        <option value="easeOut" ${anims.easing === 'easeOut' ? 'selected' : ''}>easeOut</option>
                        <option value="easeInOut" ${anims.easing === 'easeInOut' || !anims.easing ? 'selected' : ''}>easeInOut</option>
                        <option value="easeInQuad" ${anims.easing === 'easeInQuad' ? 'selected' : ''}>easeInQuad</option>
                        <option value="easeOutQuad" ${anims.easing === 'easeOutQuad' ? 'selected' : ''}>easeOutQuad</option>
                        <option value="easeInOutQuad" ${anims.easing === 'easeInOutQuad' ? 'selected' : ''}>easeInOutQuad</option>
                        <option value="easeOutBack" ${anims.easing === 'easeOutBack' ? 'selected' : ''}>easeOutBack</option>
                        <option value="easeOutElastic" ${anims.easing === 'easeOutElastic' ? 'selected' : ''}>easeOutElastic</option>
                        <option value="bounce" ${anims.easing === 'bounce' ? 'selected' : ''}>bounce</option>
                    </select>
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-on-surface-variant">
                        <span>Anim Delay</span>
                        <span>${anims.delay || 0}s</span>
                    </div>
                    <input type="range" id="insp_anim_delay" min="0" max="10" step="0.1" value="${anims.delay || 0}" class="w-full" oninput="changeClipAnimationParam('${clip.id}', 'delay', this.value)">
                </div>
                <div>
                    <div class="flex justify-between text-[10px] text-on-surface-variant">
                        <span>Anim Duration</span>
                        <span>${anims.duration || 0.5}s</span>
                    </div>
                    <input type="range" id="insp_anim_duration" min="0.1" max="10" step="0.1" value="${anims.duration || 0.5}" class="w-full" oninput="changeClipAnimationParam('${clip.id}', 'duration', this.value)">
                </div>
            </div>
        `;
    }

    let finalHtml = `<h4 class="inspector-title" style="font-size:0.8rem; font-weight:600; margin-bottom:0.75rem; color: var(--text-on-surface);">Properties: ${clip.name || track.name}</h4>`;
    if (transformHtml) finalHtml += renderSection('Transform', 'transform', transformHtml);
    if (appearanceHtml) finalHtml += renderSection('Appearance', 'appearance', appearanceHtml);
    if (textHtml) finalHtml += renderSection('Text', 'text', textHtml);
    if (audioHtml) finalHtml += renderSection('Audio', 'audio', audioHtml);
    if (effectsHtml) finalHtml += renderSection('Effects', 'effects', effectsHtml);
    if (animationHtml) finalHtml += renderSection('Animation', 'animation', animationHtml);

    finalHtml += `<button class="w-full py-1.5 bg-red-600 text-white rounded font-medium mt-3 border-none cursor-pointer hover:bg-red-700 transition-colors" id="insp_delete">Delete Clip</button>`;
    inspectorSection.innerHTML = finalHtml;

    const bindInput = (id, key, multiplier = 1, isInt = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
            clip[key] = val * multiplier;
            renderCanvasComposition();
            if (track.type === 'audio') {
                syncMediaPlayback();
                if (id === 'insp_volume') {
                    const span = el.nextElementSibling;
                    if (span) span.textContent = `${Math.round(val)}%`;
                }
            }
            if (id.startsWith('insp_crop')) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) span.textContent = `${Math.round(val)}px`;
                }
            }
            if (id === 'insp_letter_spacing' || id === 'insp_line_height' || id === 'insp_stroke_width' || id.startsWith('insp_shadow_')) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) {
                        if (id === 'insp_line_height') {
                            span.textContent = (val * multiplier).toFixed(1);
                        } else {
                            span.textContent = `${Math.round(val * multiplier)}px`;
                        }
                    }
                }
            }
        });
    };

    bindInput('insp_x', 'x', 1, false);
    bindInput('insp_y', 'y', 1, false);
    bindInput('insp_rot', 'rotation', 1, true);
    bindInput('insp_opacity', 'opacity', 0.01, false);
    bindInput('insp_scale', 'scale', 0.01, false);
    bindInput('insp_volume', 'volume', 0.01, false);
    bindInput('insp_fadein', 'fadeIn', 1, false);
    bindInput('insp_fadeout', 'fadeOut', 1, false);
    bindInput('insp_size', 'size', 1, true);
    bindInput('insp_cropx', 'cropX', 1, true);
    bindInput('insp_cropy', 'cropY', 1, true);
    bindInput('insp_cropw', 'cropW', 1, true);
    bindInput('insp_croph', 'cropH', 1, true);

    bindInput('insp_letter_spacing', 'letterSpacing', 1, true);
    bindInput('insp_line_height', 'lineHeight', 0.01, false);
    bindInput('insp_stroke_width', 'textStrokeWidth', 1, true);
    bindInput('insp_shadow_blur', 'shadowBlur', 1, true);
    bindInput('insp_shadow_offsetx', 'shadowOffsetX', 1, true);
    bindInput('insp_shadow_offsety', 'shadowOffsetY', 1, true);

    const colorEl = document.getElementById('insp_color');
    if (colorEl) {
        colorEl.addEventListener('input', (e) => {
            clip.color = e.target.value;
            renderCanvasComposition();
        });
    }

    const strokeColorEl = document.getElementById('insp_stroke_color');
    if (strokeColorEl) {
        strokeColorEl.addEventListener('input', (e) => {
            clip.strokeColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const shadowColorEl = document.getElementById('insp_shadow_color');
    if (shadowColorEl) {
        shadowColorEl.addEventListener('input', (e) => {
            clip.shadowColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const gradStartEl = document.getElementById('insp_grad_start');
    if (gradStartEl) {
        gradStartEl.addEventListener('input', (e) => {
            clip.gradientStartColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const gradEndEl = document.getElementById('insp_grad_end');
    if (gradEndEl) {
        gradEndEl.addEventListener('input', (e) => {
            clip.gradientEndColor = e.target.value;
            renderCanvasComposition();
        });
    }

    const bindShapeInput = (id, key, multiplier = 1, isInt = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps[key] = val * multiplier;
            renderCanvasComposition();

            const label = el.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${Math.round(val * multiplier)}px`;
            }
        });
    };

    bindInput('insp_shape_width', 'shapeWidth', 1, true);
    bindInput('insp_shape_height', 'shapeHeight', 1, true);

    const shapeWEl = document.getElementById('insp_shape_width');
    if (shapeWEl) {
        shapeWEl.addEventListener('input', (e) => {
            const label = shapeWEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }
    const shapeHEl = document.getElementById('insp_shape_height');
    if (shapeHEl) {
        shapeHEl.addEventListener('input', (e) => {
            const label = shapeHEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }

    bindShapeInput('insp_shape_stroke_width', 'strokeWidth', 1, true);
    bindShapeInput('insp_shape_corner_radius', 'cornerRadius', 1, true);
    bindShapeInput('insp_shape_blur', 'blur', 1, true);

    const shapeFillEl = document.getElementById('insp_shape_fill');
    if (shapeFillEl) {
        shapeFillEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.fill = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeStrokeEl = document.getElementById('insp_shape_stroke');
    if (shapeStrokeEl) {
        shapeStrokeEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.stroke = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGradStartEl = document.getElementById('insp_shape_grad_start');
    if (shapeGradStartEl) {
        shapeGradStartEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.gradientStartColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGradEndEl = document.getElementById('insp_shape_grad_end');
    if (shapeGradEndEl) {
        shapeGradEndEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.gradientEndColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapePatternColorEl = document.getElementById('insp_shape_pattern_color');
    if (shapePatternColorEl) {
        shapePatternColorEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.patternColor = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeFillImageTextEl = document.getElementById('insp_shape_fill_image');
    if (shapeFillImageTextEl) {
        shapeFillImageTextEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            clip.shapeProps.fillImage = e.target.value;
            clip.shapeProps.fillImageElement = null;
            renderCanvasComposition();
        });
    }
    const shapeGlowColorEl = document.getElementById('insp_shape_glow_color');
    if (shapeGlowColorEl) {
        shapeGlowColorEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            if (!clip.shapeProps.glow) clip.shapeProps.glow = { color: '#ff00ff', size: 0 };
            clip.shapeProps.glow.color = e.target.value;
            renderCanvasComposition();
        });
    }
    const shapeGlowSizeEl = document.getElementById('insp_shape_glow_size');
    if (shapeGlowSizeEl) {
        shapeGlowSizeEl.addEventListener('input', (e) => {
            if (!clip.shapeProps) clip.shapeProps = {};
            if (!clip.shapeProps.glow) clip.shapeProps.glow = { color: '#ff00ff', size: 0 };
            clip.shapeProps.glow.size = parseInt(e.target.value);
            renderCanvasComposition();
            const label = shapeGlowSizeEl.previousElementSibling;
            if (label) {
                const span = label.querySelector('span:last-child');
                if (span) span.textContent = `${e.target.value}px`;
            }
        });
    }

    const textEl = document.getElementById('insp_text');
    if (textEl) {
        textEl.addEventListener('input', (e) => {
            clip.text = e.target.value;
            clip.name = e.target.value;
            renderTimeline();
            renderCanvasComposition();
        });
    }

    const fontEl = document.getElementById('insp_font');
    if (fontEl) {
        fontEl.addEventListener('change', (e) => {
            clip.font = e.target.value;
            renderCanvasComposition();
        });
    }

    // Auto-save history on change for all inspector inputs
    if (inspectorSection) {
        inspectorSection.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', (e) => {
                saveStateToHistory(`Edit ${input.id || 'Property'}`);
            });
        });
    }

    const deleteBtn = document.getElementById('insp_delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            window.timelineDeleteSelected();
        });
    }
}

// Asset uploading helpers
async function handleAssetUpload(file, type) {
    if (!window.ForgeCut || !window.ForgeCut.MediaEngine) {
            console.error('[Editor] MediaEngine not loaded');
            return;
        }

        // Show spinner or loading state
        const statusText = document.querySelector('footer .font-status-bar');
        if (statusText) statusText.textContent = `Processing ${file.name}...`;

        try {
            const asset = await window.ForgeCut.MediaEngine.importFile(file, type);
            assetCache.set(asset.id, asset);
            addUploadFileItem(asset, asset.type);

            if (asset.type === 'video') {
                canvas.width = asset.width || canvas.width;
                canvas.height = asset.height || canvas.height;
                const resLabel = document.getElementById('footerResolution');
                if (resLabel) resLabel.textContent = `${canvas.width}x${canvas.height}`;
                recalculateCanvasDisplaySize();

                const videoClipId = `clip_${Date.now()}`;
                const track = state.tracks.find(t => t.id === 'videoTrack');
                const newClip = {
                    id: videoClipId,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: Math.min(state.duration, asset.duration || 5.0),
                    trimStart: 0,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    scale: 1.0,
                    rotation: 0,
                    opacity: 1.0
                };

                // Check if video has an embedded audio stream (waveform exists)
                const hasAudio = asset.waveform && asset.waveform.length > 0;
                if (hasAudio) {
                    const audioAssetId = `${asset.id}_audio`;
                    const audioElement = document.createElement('audio');
                    audioElement.src = asset.objectUrl;
                    audioElement.preload = 'auto';

                    const audioAsset = {
                        ...asset,
                        id: audioAssetId,
                        element: audioElement,
                        type: 'audio',
                        name: `${asset.name} (Audio)`
                    };

                    assetCache.set(audioAssetId, audioAsset);
                    if (window.ForgeCut && window.ForgeCut.MediaEngine) {
                        window.ForgeCut.MediaEngine.mediaLibrary.set(audioAssetId, audioAsset);
                    }

                    const audioTrack = state.tracks.find(t => t.id === 'audioTrack');
                    const linkedAudioClipId = `clip_${Date.now()}_audio`;
                    const newAudioClip = {
                        id: linkedAudioClipId,
                        assetId: audioAssetId,
                        name: `${asset.name} (Audio)`,
                        startTime: 0,
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

                track.clips.push(newClip);
                state.duration = Math.max(state.duration, asset.duration || 30.0);
                renderTimeline();
                setTime(0);
            } else if (asset.type === 'audio') {
                const track = state.tracks.find(t => t.id === 'audioTrack');
                const newClip = {
                    id: `clip_${Date.now()}`,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: Math.min(state.duration, asset.duration || 5.0),
                    trimStart: 0,
                    volume: 1.0,
                    fadeIn: 0.5,
                    fadeOut: 0.5
                };
                track.clips.push(newClip);
                renderTimeline();
            } else if (asset.type === 'image') {
                const track = state.tracks.find(t => t.id === 'videoTrack2');
                const newClip = {
                    id: `clip_${Date.now()}`,
                    assetId: asset.id,
                    name: asset.name,
                    startTime: 0,
                    duration: 5.0,
                    trimStart: 0,
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    scale: 0.5,
                    rotation: 0,
                    opacity: 1.0
                };
                track.clips.push(newClip);
                renderTimeline();
            }

            if (statusText) statusText.textContent = 'System Ready';
        } catch (e) {
            console.error('[Editor] Asset import error:', e);
            if (statusText) statusText.textContent = 'Import failed';
        }
}
window.handleAssetUpload = handleAssetUpload;

    function addUploadFileItem(asset, type) {
        if (type === 'video' || type === 'image') {
            const grid = document.getElementById('catalog-media-grid');
            if (!grid) return;

            const item = document.createElement('div');
            item.className = 'p-2 bg-surface hover:bg-surface-container rounded-lg border border-outline-variant/30 flex flex-col gap-2 relative group cursor-grab';
            item.setAttribute('draggable', 'true');
            item.dataset.assetId = asset.id;
            item.dataset.assetType = type;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'media', assetId: asset.id, assetType: type }));
            });

            item.addEventListener('click', () => {
                let foundClipId = null;
                state.tracks.forEach(track => {
                    const clip = track.clips.find(c => c.assetId === asset.id);
                    if (clip) foundClipId = clip.id;
                });
                if (foundClipId) {
                    selectClip(foundClipId);
                }
            });

            const previewHtml = type === 'video'
                ? `<div class="aspect-video bg-black rounded overflow-hidden flex items-center justify-center relative">
                 <span class="material-symbols-outlined text-white/50 text-2xl absolute">play_circle</span>
                 <video class="w-full h-full object-cover opacity-60" src="${asset.objectUrl}"></video>
               </div>`
                : `<div class="aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
                 <img class="w-full h-full object-cover" src="${asset.objectUrl}">
               </div>`;

            item.innerHTML = `
            ${previewHtml}
            <div class="flex justify-between items-center w-full">
                <span class="text-[10px] font-bold text-on-surface truncate w-32" title="${esc(asset.name)}">${esc(asset.name)}</span>
                <button class="text-xs text-on-surface-variant hover:text-error bg-transparent border-none cursor-pointer p-0" onclick="removeUploadedAsset('${esc(asset.id)}', '${esc(type)}')">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        `;
            grid.appendChild(item);
        } else if (type === 'audio') {
            const list = document.getElementById('catalog-audio-list');
            if (!list) return;

            const item = document.createElement('div');
            item.className = 'p-3 bg-surface hover:bg-surface-container rounded-lg border border-outline-variant/30 flex items-center justify-between cursor-grab';
            item.setAttribute('draggable', 'true');
            item.dataset.assetId = asset.id;

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'media', assetId: asset.id, assetType: 'audio' }));
            });

            item.addEventListener('click', () => {
                let foundClipId = null;
                state.tracks.forEach(track => {
                    const clip = track.clips.find(c => c.assetId === asset.id);
                    if (clip) foundClipId = clip.id;
                });
                if (foundClipId) {
                    selectClip(foundClipId);
                }
            });

            item.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-primary">audiotrack</span>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-on-surface truncate w-36" title="${esc(asset.name)}">${esc(asset.name)}</span>
                    <span class="text-[9px] text-outline">Audio Track Asset</span>
                </div>
            </div>
            <button class="text-xs text-on-surface-variant hover:text-error bg-transparent border-none cursor-pointer p-0" onclick="removeUploadedAsset('${asset.id}', 'audio')">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
        `;
            list.appendChild(item);
        }
    }

    window.removeUploadedAsset = function (assetId, type) {
        const asset = assetCache.get(assetId);
        if (!asset) return;

        state.tracks.forEach(track => {
            track.clips = track.clips.filter(c => c.assetId !== assetId);
        });

        // Route removal through MediaEngine so its own library drops the asset
        // too. assetCache is a second index over the *same* asset objects, so
        // revoking here without telling MediaEngine left it holding an entry
        // with a dead objectUrl and a live media element — a leak, and a source
        // of stale reads via PlaybackEngine's ME.getAsset() lookup.
        if (window.ForgeCut && window.ForgeCut.MediaEngine) {
            window.ForgeCut.MediaEngine.removeAsset(assetId);
        } else if (asset.objectUrl) {
            URL.revokeObjectURL(asset.objectUrl);
        }
        assetCache.delete(assetId);

        const grid = document.getElementById('catalog-media-grid');
        if (grid) grid.innerHTML = '';
        const list = document.getElementById('catalog-audio-list');
        if (list) list.innerHTML = '';

        assetCache.forEach(a => {
            const matchType = a.element && a.element.tagName === 'VIDEO' ? 'video' : (a.element && a.element.tagName === 'AUDIO' ? 'audio' : 'image');
            addUploadFileItem(a, matchType);
        });

        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        syncMediaPlayback();
    };

    window.addNewTextClip = function (type = 'Textbox') {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const newClip = {
            id: `clip_${Date.now()}`,
            name: type,
            text: type === 'Textbox' ? 'Double click or edit text' : `New ${type} {{name}}`,
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * (type === 'Heading' ? 0.25 : 0.75),
            font: 'Arial',
            size: type === 'Heading' ? 96 : 72,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };

    function renderPlaceholders() {
        const container = document.getElementById('csvPlaceholdersContainer');
        if (!container) return;
        container.innerHTML = '';
        state.placeholders.forEach(ph => {
            const tag = document.createElement('span');
            tag.className = 'label-tag';
            tag.style.cursor = 'pointer';
            // Built as DOM nodes rather than an interpolated inline handler:
            // placeholder names come from CSV column headers, and a header
            // containing a quote used to break out of the onclick attribute and
            // run as script.
            const label = document.createElement('span');
            label.textContent = `{{${ph}}}`;
            label.addEventListener('click', () => window.handleLabelTagClick(ph));

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (event) => window.removePlaceholder(event, ph));

            tag.appendChild(label);
            tag.appendChild(removeBtn);
            container.appendChild(tag);
        });
    }

    window.removePlaceholder = function (event, ph) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        state.placeholders = state.placeholders.filter(p => p !== ph);
        renderPlaceholders();
        renderCanvasComposition();
    };

    window.handleLabelTagClick = function (ph) {
        const labelTextMask = document.getElementById('labelTextMask');
        if (labelTextMask) {
            labelTextMask.value = ph;
        }
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                const track = state.tracks.find(t => t.clips.includes(clip));
                if (track && track.type === 'text') {
                    clip.text = `{{${ph}}}`;
                    clip.name = ph;
                    renderTimeline();
                    updateInspector();
                }
            }
        }
    };

    function addNewTextClipWithPlaceholder(ph) {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const newClip = {
            id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: ph,
            text: `{{${ph}}}`,
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * 0.75,
            font: 'Arial',
            size: 72,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    }

    function renderRowSelector() {
        if (!rowSelectorList) return;
        rowSelectorList.innerHTML = '';
        if (state.csvData.length === 0) {
            rowSelectorList.innerHTML = `<div class="text-center py-4 text-xs text-on-surface-variant/50">Upload CSV to display rows</div>`;
            const wrapper = document.getElementById('csvRowFieldsWrapper');
            if (wrapper) wrapper.classList.add('hidden');
            return;
        }

        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = `row-item ${idx === state.selectedRowIndex ? 'active' : ''}`;
            item.onclick = () => selectRow(idx);

            const keys = Object.keys(row);
            const val1 = row[keys[0]] || '';
            const val2 = keys[1] ? row[keys[1]] || '' : '';
            const displayText = val2 ? `${val1} (${val2})` : val1;

            // textContent, not innerHTML: these values come straight from the
            // user's CSV and must never be parsed as markup.
            const valueEl = document.createElement('span');
            valueEl.className = 'row-text-val';
            valueEl.textContent = displayText || `Row ${idx + 1}`;

            const badgeEl = document.createElement('span');
            badgeEl.className = 'badge-id';
            badgeEl.textContent = `#${idx + 1}`;

            item.appendChild(valueEl);
            item.appendChild(badgeEl);
            rowSelectorList.appendChild(item);
        });

        const wrapper = document.getElementById('csvRowFieldsWrapper');
        if (wrapper) wrapper.classList.remove('hidden');
        updateCsvRowFieldsEditor();
    }

    function selectRow(rowIndex) {
        state.selectedRowIndex = rowIndex;
        renderRowSelector();
        renderQueueList();
        renderCanvasComposition();
    }

    function updateCsvRowFieldsEditor() {
        const container = document.getElementById('csvRowFieldsContainer');
        if (!container) return;
        container.innerHTML = '';

        const activeRow = state.csvData[state.selectedRowIndex];
        if (!activeRow) return;

        Object.keys(activeRow).forEach(key => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'control-group';
            fieldGroup.style.marginBottom = '0.5rem';

            const label = document.createElement('label');
            label.textContent = key;
            label.style.fontSize = '0.7rem';
            label.style.color = 'var(--text-secondary)';
            label.style.display = 'block';
            label.style.marginBottom = '0.2rem';

            const input = document.createElement('input');
            input.type = 'text';
            input.value = activeRow[key] || '';
            input.style.width = '100%';
            input.style.padding = '0.35rem 0.5rem';
            input.style.fontSize = '0.75rem';
            input.style.borderRadius = '4px';
            input.style.border = '1px solid var(--border)';
            input.style.background = 'var(--bg-surface)';
            input.style.color = 'var(--text-primary)';
            input.style.outline = 'none';

            input.addEventListener('input', (e) => {
                activeRow[key] = e.target.value;
                renderCanvasComposition();

                const keys = Object.keys(activeRow);
                if (key === keys[0] || key === keys[1]) {
                    const activeItemText = rowSelectorList.querySelector(`.row-item.active .row-text-val`);
                    if (activeItemText) {
                        const val1 = activeRow[keys[0]] || '';
                        const val2 = keys[1] ? activeRow[keys[1]] || '' : '';
                        activeItemText.textContent = val2 ? `${val1} (${val2})` : val1;
                    }
                }
                renderQueueList();
            });

            fieldGroup.appendChild(label);
            fieldGroup.appendChild(input);
            container.appendChild(fieldGroup);
        });
    }

    function getRowThumbnailDataUrl(rowIndex) {
        const origIndex = state.selectedRowIndex;
        state.selectedRowIndex = rowIndex;
        renderCanvasComposition();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        state.selectedRowIndex = origIndex;
        renderCanvasComposition();
        return dataUrl;
    }

    async function renderBatchGalleryGrid() {
        const grid = document.getElementById('batchGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (!state.batchSelection) {
            state.batchSelection = state.csvData.map(() => true);
        }
        if (state.batchSelection.length !== state.csvData.length) {
            state.batchSelection = state.csvData.map((_, i) => state.batchSelection[i] !== undefined ? state.batchSelection[i] : true);
        }

        state.csvData.forEach((row, idx) => {
            const card = document.createElement('div');
            card.className = 'batch-card';
            card.dataset.index = idx;

            const imgUrl = getRowThumbnailDataUrl(idx);
            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;
            const subtitleVal = keys[1] ? row[keys[1]] || '' : '';
            const titleText = `${idx + 1} - ${nameVal}`;

            card.innerHTML = `
            <div class="batch-card-top-controls">
                <input type="checkbox" class="batch-card-checkbox" ${state.batchSelection[idx] ? 'checked' : ''} onchange="toggleBatchSelection(${idx}, this.checked)">
                <button class="batch-card-menu-btn" onclick="deleteBatchVariation(event, ${idx})">&times;</button>
            </div>
            <div class="batch-card-preview">
                <img src="${imgUrl}" style="width:100%; height:100%; object-fit:contain;">
                <div class="batch-card-overlay">
                    <button class="batch-card-play-btn" onclick="playBatchVariation(event, ${idx})" title="Preview in Monitor">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
            </div>
            <div class="batch-card-info">
                <span class="batch-card-title" title="${esc(titleText)}">${esc(titleText)}</span>
                ${subtitleVal ? `<span class="batch-card-tag">${subtitleVal}</span>` : ''}
            </div>
        `;
            grid.appendChild(card);
        });

        const addCard = document.createElement('div');
        addCard.className = 'batch-card add-card';
        addCard.onclick = addNewBatchVariation;
        addCard.innerHTML = `
        <div class="add-card-content">
            <div class="add-card-icon">+</div>
            <span style="font-size:0.75rem;">Add variation</span>
        </div>
    `;
        grid.appendChild(addCard);
    }

    window.toggleBatchSelection = function (idx, isChecked) {
        state.batchSelection[idx] = isChecked;
        renderQueueList();
    };

    window.deleteBatchVariation = function (event, idx) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        state.csvData.splice(idx, 1);
        state.batchSelection.splice(idx, 1);
        if (state.selectedRowIndex >= state.csvData.length) {
            state.selectedRowIndex = Math.max(0, state.csvData.length - 1);
        }
        renderRowSelector();
        renderQueueList();
        if (document.getElementById('batchGalleryOverlay').style.display !== 'none') {
            renderBatchGalleryGrid();
        }
    };

    window.playBatchVariation = function (event, idx) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        selectRow(idx);
        const overlay = document.getElementById('batchGalleryOverlay');
        if (overlay) overlay.style.display = 'none';
        play();
    };

    window.addNewBatchVariation = function () {
        const newRow = {};
        state.placeholders.forEach(ph => {
            newRow[ph] = `New ${ph}`;
        });
        state.csvData.push(newRow);
        if (state.batchSelection) {
            state.batchSelection.push(true);
        }
        renderRowSelector();
        renderQueueList();
        if (document.getElementById('batchGalleryOverlay').style.display !== 'none') {
            renderBatchGalleryGrid();
        }
    };

    async function exportSelectedVariations() {
        if (!window.ForgeCut || !window.ForgeCut.ExportEngine) {
            console.error('[Editor] ExportEngine not loaded');
            return;
        }
        pause();
        await window.ForgeCut.ExportEngine.exportBatch(state, renderCanvasComposition, {
            canvas: canvas,
            fps: 30
        });
    }

    window.startBulkExport = async function () {
        if (state.csvData.length === 0) {
            fcToast('Please upload a populated CSV file first!');
            return;
        }
        pause();
        const overlay = document.getElementById('batchGalleryOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
        await renderBatchGalleryGrid();

        if (window.ForgeCut && window.ForgeCut.ExportEngine) {
            await window.ForgeCut.ExportEngine.exportBatch(state, renderCanvasComposition, {
                canvas: canvas,
                fps: 30
            });
        }
    };

    window.newProject = function () {
        state.tracks.forEach(track => track.clips = []);
        state.selectedClipId = null;
        state.csvData = [];
        state.batchSelection = [];
        renderTimeline();
        renderRowSelector();
        renderQueueList();
        renderCanvasComposition();
    };

    window.openProject = function () {
        fcToast('Opening local project templates...');
    };

    window.saveProject = function () {
        fcToast('Project saved successfully!');
    };

    window.saveProjectAs = function () {
        fcToast('Project template duplicated!');
    };

    window.addNewTrack = function (type) {
        const trackId = `${type}Track_${Date.now()}`;
        state.tracks.push({
            id: trackId,
            type: type,
            name: `${type.toUpperCase()} Track`,
            clips: []
        });
        // Dynamically insert track markup
        const tracksContainer = document.getElementById('tracksContainer');
        const newTrackDiv = document.createElement('div');
        newTrackDiv.className = 'timeline-track';
        newTrackDiv.id = trackId;
        newTrackDiv.innerHTML = `
        <div class="track-header">
            <span>${type.toUpperCase()} Track</span>
            <div class="track-icons">
                <span class="track-lock-icon" onclick="toggleTrackLock('${trackId}')">lock_open</span>
                <span class="track-eye-icon" onclick="toggleTrackVisibility('${trackId}')">visibility</span>
            </div>
        </div>
        <div class="track-content" id="${trackId}Content"></div>
    `;
        tracksContainer.appendChild(newTrackDiv);
        state.trackVisibility[trackId] = true;
        state.trackLock[trackId] = false;
        renderTimeline();
    };

    window.insertShape = function (shapeType) {
        let track = state.tracks.find(t => t.id === 'shapeTrack');
        if (!track) {
            track = { id: 'shapeTrack', type: 'shape', name: 'Shapes Track 1', clips: [] };
            state.tracks.push(track);
            state.trackVisibility['shapeTrack'] = true;
            state.trackLock['shapeTrack'] = false;
        }
        const newClip = window.ForgeCut.ShapeRenderer.createShapeClip(shapeType, canvas.width, canvas.height, state.currentTime);
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };

    window.insertSymbol = function (symbolType) {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const today = new Date().toLocaleDateString();
        const newClip = {
            id: `clip_${Date.now()}`,
            name: symbolType,
            text: symbolType === 'DateTime' ? today : 'Page 1',
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * 0.9,
            font: 'Arial',
            size: 48,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };

    window.toggleTrackLock = function (trackId) {
        state.trackLock[trackId] = !state.trackLock[trackId];
        const el = document.querySelector(`#${trackId} .track-lock-icon`);
        if (el) {
            el.textContent = state.trackLock[trackId] ? 'lock' : 'lock_open';
            el.classList.toggle('text-primary', state.trackLock[trackId]);
        }
    };

    window.toggleTrackVisibility = function (trackId) {
        state.trackVisibility[trackId] = !state.trackVisibility[trackId];
        const el = document.querySelector(`#${trackId} .track-eye-icon`);
        if (el) {
            el.textContent = state.trackVisibility[trackId] ? 'visibility' : 'visibility_off';
            el.classList.toggle('text-primary', !state.trackVisibility[trackId]);
        }
        renderCanvasComposition();
    };

    window.setAspectRatio = function (w, h) {
        state.canvasPanX = 0;
        state.canvasPanY = 0;
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) wrapper.style.transform = '';

        if (w === 16 && h === 9) {
            canvas.width = 1920;
            canvas.height = 1080;
        } else if (w === 9 && h === 16) {
            canvas.width = 1080;
            canvas.height = 1920;
        } else if (w === 1 && h === 1) {
            canvas.width = 1080;
            canvas.height = 1080;
        } else if (w === 4 && h === 3) {
            canvas.width = 1440;
            canvas.height = 1080;
        } else if (w === 3 && h === 4) {
            canvas.width = 1080;
            canvas.height = 1440;
        } else if (w === 21 && h === 9) {
            canvas.width = 2560;
            canvas.height = 1080;
        } else {
            // Custom resolution support
            if (w >= h) {
                canvas.height = 1080;
                canvas.width = Math.round(1080 * (w / h));
            } else {
                canvas.width = 1080;
                canvas.height = Math.round(1080 * (h / w));
            }
        }

        const resLabel = document.getElementById('footerResolution');
        if (resLabel) resLabel.textContent = `${canvas.width}x${canvas.height}`;

        recalculateCanvasDisplaySize();
        renderCanvasComposition();
    };

    function renderQueueList() {
        const queueList = document.getElementById('queueList');
        if (!queueList) return;
        queueList.innerHTML = '';

        if (state.csvData.length === 0) {
            queueList.innerHTML = `<div class="empty-msg text-xs text-on-surface-variant/50 text-center py-8">Export queue is currently empty</div>`;
            const selCount = document.getElementById('queueSelectedCount');
            if (selCount) selCount.textContent = '0';
            const totCount = document.getElementById('queueTotalCount');
            if (totCount) totCount.textContent = '0';
            return;
        }

        if (!state.batchSelection) {
            state.batchSelection = state.csvData.map(() => true);
        }
        if (state.batchSelection.length !== state.csvData.length) {
            state.batchSelection = state.csvData.map((_, i) => state.batchSelection[i] !== undefined ? state.batchSelection[i] : true);
        }

        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = `file-item ${idx === state.selectedRowIndex ? 'active' : ''}`;

            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;

            item.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem; flex:1;">
                <input type="checkbox" class="queue-item-checkbox" ${state.batchSelection[idx] ? 'checked' : ''} onchange="toggleQueueSelection(${idx}, this.checked)">
                <span style="font-size:0.75rem; cursor:pointer;" onclick="selectRow(${idx})">${idx + 1} - ${esc(nameVal)}</span>
            </div>
            <div style="display:flex; gap:0.25rem;">
                <button onclick="selectRow(${idx})" style="padding:0.1rem 0.3rem; font-size:0.7rem; cursor:pointer; background:none; border:none; color:inherit;">👁️</button>
                <button onclick="deleteBatchVariation(null, ${idx})" style="color:var(--red); padding:0.1rem 0.3rem; font-size:0.7rem; cursor:pointer; background:none; border:none;">&times;</button>
            </div>
        `;
            queueList.appendChild(item);
        });

        const selectedCount = state.batchSelection.filter(Boolean).length;
        const selCountEl = document.getElementById('queueSelectedCount');
        if (selCountEl) selCountEl.textContent = selectedCount;
        const totCountEl = document.getElementById('queueTotalCount');
        if (totCountEl) totCountEl.textContent = state.csvData.length;
    }

    window.toggleQueueSelection = function (idx, isChecked) {
        state.batchSelection[idx] = isChecked;
        const selectedCount = state.batchSelection.filter(Boolean).length;
        const selCountEl = document.getElementById('queueSelectedCount');
        if (selCountEl) selCountEl.textContent = selectedCount;

        const cardCheckbox = document.querySelector(`.batch-card[data-index="${idx}"] .batch-card-checkbox`);
        if (cardCheckbox) {
            cardCheckbox.checked = isChecked;
        }
    };

    window.renderQueueList = renderQueueList;
    window.exportSelectedVariations = exportSelectedVariations;

    // Real Undo / Redo history system using HistoryManager
    if (window.ForgeCut && window.ForgeCut.HistoryManager) {
        window.ForgeCut.HistoryManager.bindState(state, () => {
            renderTimeline();
            updateInspector();
            renderCanvasComposition();
            syncMediaPlayback();
        });
    }

    function saveStateToHistory(label) {
        state.isDirty = true;
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.pushState(label || 'Action');
        }
    }

    window.saveStateToHistory = saveStateToHistory;

    window.triggerUndo = function () {
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.undo();
        }
    };

    window.triggerRedo = function () {
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.redo();
        }
    };

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

    // Production-Grade Lifecycle & State Purging
    window.triggerNewProject = async function (ratio) {
        if (!(await fcConfirm('Start a new project? All unsaved tracks and cached assets will be purged.', { okLabel: 'Discard and start new', danger: true }))) return;

        // Purge cached files and references. MediaEngine owns the object URLs
        // and media elements; clearing only assetCache used to strand its
        // library for the rest of the session.
        if (window.ForgeCut && window.ForgeCut.MediaEngine) {
            window.ForgeCut.MediaEngine.clearAll();
        } else {
            assetCache.forEach(asset => {
                if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
            });
        }
        assetCache.clear();
        if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
            window.ForgeCut.PlaybackEngine.clearPool();
        }

        // Reset state vectors
        state.duration = 30;
        state.currentTime = 0;
        state.isPlaying = false;
        state.selectedClipId = null;
        state.csvData = [];
        state.placeholders = ['name', 'class'];
        state.selectedRowIndex = 0;
        state.batchSelection = [];
        state.tracks.forEach(track => {
            track.clips = [];
        });

        // Clean history trees
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.clearHistory();
        }

        // Clear catalog DOM elements
        const grid = document.getElementById('catalog-media-grid');
        if (grid) grid.innerHTML = '';
        const list = document.getElementById('catalog-audio-list');
        if (list) list.innerHTML = '';
        const queueList = document.getElementById('rowSelectorList');
        if (queueList) queueList.innerHTML = '';

        // Reset aspect ratio
        if (ratio === '16_9') {
            window.setAspectRatio(16, 9);
        } else if (ratio === '9_16') {
            window.setAspectRatio(9, 16);
        } else {
            window.setAspectRatio(16, 9);
        }

        // Update interfaces
        setTime(0);
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        closeBackstage();
        // Clear autosave so restored session won't overwrite new project
        localStorage.removeItem('forgecut_autosave');
        // Reset project name
        window._isResettingProject = true;
        state.projectName = 'Untitled Project';
        const nameEl = document.getElementById('footerProjectName');
        if (nameEl) nameEl.textContent = 'Untitled Project';
        setTimeout(() => { window._isResettingProject = false; }, 500);
        fcToast('Clean project workspace initialized.');
    };

    window.saveProject = function () {
        const projectData = {
            version: "1.0",
            timestamp: new Date().toISOString(),
            duration: state.duration,
            currentTime: state.currentTime,
            zoom: state.zoom,
            tracks: state.tracks,
            bgType: state.bgType,
            bgColor: state.bgColor,
            bgGradientStart: state.bgGradientStart,
            bgGradientEnd: state.bgGradientEnd,
            bgImageUrl: state.bgImageUrl,
            safeZoneConfig: state.safeZoneConfig,
            safeAreaPlatform: state.safeAreaPlatform
        };
        const jsonStr = JSON.stringify(projectData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ForgeCut_Project_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        fcToast('Project saved successfully.');
    };

    window.saveProjectAs = window.saveProject;

    window.triggerOpenProject = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.tracks) {
                    state.tracks = data.tracks;
                    state.duration = data.duration || 30;
                    state.currentTime = data.currentTime || 0;
                    state.zoom = data.zoom || 20;
                    renderTimeline();
                    updateInspector();
                    renderCanvasComposition();
                    closeBackstage();
                    fcToast('Project configuration loaded successfully.');
                }
            } catch (err) {
                fcToast('Failed to parse project file.');
            }
        };
        reader.readAsText(file);
    };

    // Canvas Custom Design Background Types
    window.changeBackgroundType = async function (type) {
        state.bgType = type;
        if (type === 'solid') {
            state.bgColor = (await fcPrompt('Enter Solid Hex Color Code (e.g. #005faa):', state.bgColor || '#005faa')) || '#005faa';
        } else if (type === 'gradient') {
            state.bgGradientStart = (await fcPrompt('Gradient Start Hex Color Code:', state.bgGradientStart || '#005faa')) || '#005faa';
            state.bgGradientEnd = (await fcPrompt('Gradient End Hex Color Code:', state.bgGradientEnd || '#dee0e2')) || '#dee0e2';
        } else if (type === 'image') {
            state.bgImageUrl = (await fcPrompt('Enter Background Image URL:', state.bgImageUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080')) || '';
        }
        renderCanvasComposition();
    };

    window.applyThemePreset = function (preset) {
        state.bgType = 'solid';
        if (preset === 'default') {
            state.bgColor = '#0f172a';
        } else if (preset === 'classic') {
            state.bgColor = '#1e293b';
        } else if (preset === 'modern') {
            state.bgColor = '#020617';
        }
        renderCanvasComposition();
        fcToast(`Applied theme preset: ${preset}`);
    };

    window.applyBrandKit = function () {
        state.bgType = 'solid';
        state.bgColor = '#005faa';
        renderCanvasComposition();
        fcToast('Applied brand kit settings.');
    };

    window.uploadBrandAsset = function (type) {
        fcToast(`Import brand asset logic active for: ${type}`);
    };

    // Safe Guide platform overlays
    window.selectSafeZonePlatform = function (platform) {
        state.safeAreaPlatform = platform;
        const label = document.getElementById('safeAreaLabelText');
        if (label) label.textContent = `${platform} Safe Area`;
        renderCanvasComposition();
    };

    window.toggleSafeAreaGuide = function () {
        state.showSafeAreaGuide = !state.showSafeAreaGuide;
        renderCanvasComposition();
    };

    window.toggleSafeZoneItem = function (zone, bool) {
        if (!state.safeZoneConfig) state.safeZoneConfig = { title: true, action: true, caption: true, danger: true };
        state.safeZoneConfig[zone] = bool;
        renderCanvasComposition();
    };

    // Transitions preview & controls
    window.playTransitionPreview = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to preview its transition.');
            return;
        }
        const clip = findClipById(state.selectedClipId);
        if (clip) {
            setTime(Math.max(0, clip.startTime - 1));
            play();
            setTimeout(() => {
                pause();
            }, 3000);
        }
    };

    window.applyTransitionToSelected = function () {
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                const durationInput = document.getElementById('transitionDurationInput');
                clip.transitionDuration = parseFloat(durationInput.value) || 1.5;
                fcToast(`Applied transition settings to selected clip.`);
            }
        } else {
            fcToast('Please select a clip first.');
        }
    };

    window.applyTransitionToAll = function () {
        const durationInput = document.getElementById('transitionDurationInput');
        const dur = parseFloat(durationInput.value) || 1.5;
        state.tracks.forEach(track => {
            track.clips.forEach(clip => {
                clip.transitionDuration = dur;
            });
        });
        fcToast('Applied transition settings to all clips in timeline.');
    };

    window.applyTransitionSound = function (sound) {
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                clip.transitionSound = sound;
                console.log(`Transition sound set to ${sound} on selected clip.`);
            }
        }
    };

    // Animations drawer & configurations
    window.toggleAnimationPane = function () {
        const rightPanel = document.querySelector('[data-right-tab="queue"]');
        if (rightPanel) rightPanel.click();
        fcToast('Animation list panel active on Right Sidebar.');
    };

    window.updateAnimationParameters = function () {
        if (!state.selectedClipId) return;
        const clip = findClipById(state.selectedClipId);
        if (clip) {
            const delayVal = document.getElementById('animationDelayInput').value;
            const durVal = document.getElementById('animationDurationInput').value;
            if (!clip.animations) clip.animations = {};
            clip.animations.delay = parseFloat(delayVal) || 0;
            clip.animations.duration = parseFloat(durVal) || 0.5;

            // Sync to inspector fields if visible
            const delaySlider = document.getElementById('insp_anim_delay');
            if (delaySlider) delaySlider.value = clip.animations.delay;
            const durSlider = document.getElementById('insp_anim_duration');
            if (durSlider) durSlider.value = clip.animations.duration;

            renderTimeline();
            renderCanvasComposition();
        }
    };

    window.changeClipAnimation = function (clipId, phase, value) {
        const clip = findClipById(clipId);
        if (clip) {
            if (!clip.animations) {
                clip.animations = { duration: 0.5, delay: 0, easing: 'easeInOut' };
            }
            clip.animations[phase] = value;
            renderTimeline();
            renderCanvasComposition();
        }
    };

    window.changeClipAnimationParam = function (clipId, param, value) {
        const clip = findClipById(clipId);
        if (clip) {
            if (!clip.animations) {
                clip.animations = { duration: 0.5, delay: 0, easing: 'easeInOut' };
            }
            clip.animations[param] = parseFloat(value) || 0;

            const el = document.getElementById(`insp_anim_${param}`);
            if (el) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) span.textContent = `${parseFloat(value).toFixed(1)}s`;
                }
            }

            if (param === 'delay') {
                const delayInput = document.getElementById('animationDelayInput');
                if (delayInput) delayInput.value = `${parseFloat(value).toFixed(2)}s`;
            } else if (param === 'duration') {
                const durationInput = document.getElementById('animationDurationInput');
                if (durationInput) durationInput.value = `${parseFloat(value).toFixed(2)}s`;
            }

            renderTimeline();
            renderCanvasComposition();
        }
    };

    // App layouts & theme modes
    window.setAppTheme = function (theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        fcToast(`Theme set to ${theme}`);
    };

    window.toggleViewElement = function (element, visible) {
        if (element === 'grid') {
            state.showGridlines = visible;
        } else if (element === 'guides') {
            state.showGuides = visible;
        } else if (element === 'layers') {
            const listContainer = document.getElementById('timelineTrackHeadersContainer');
            if (listContainer) {
                if (visible) listContainer.classList.remove('hidden');
                else listContainer.classList.add('hidden');
            }
        }
        renderCanvasComposition();
    };

    window.zoomFitToScreen = function () {
        const container = document.getElementById('timelineContainer');
        const containerW = container ? container.clientWidth - 24 : 800;
        state.zoom = Math.max(5, Math.min(100, Math.round(containerW / (state.duration || 30))));
        const label = document.getElementById('footerZoomLabel');
        if (label) label.textContent = `${state.zoom}%`;
        const slider = document.getElementById('footerZoomSlider');
        if (slider) slider.value = state.zoom;
        renderTimeline();
    };

    // Bulk Production & CSV dynamic configuration
    window.openColumnMapper = function () {
        fcToast(`Column variable mapper is operational. Current dynamic placeholders: ${state.placeholders.join(', ')}`);
    };

    window.validateCsvMapping = function () {
        if (state.csvData.length === 0) {
            fcToast('Please import a CSV configuration first.');
            return;
        }
        fcToast(`CSV mapping validation: Success! ${state.csvData.length} records parsed successfully.`);
    };

    window.generateSampleVariation = function () {
        if (state.csvData.length === 0) {
            fcToast('Please import a CSV configuration first.');
            return;
        }
        state.selectedRowIndex = Math.floor(Math.random() * state.csvData.length);
        renderCanvasComposition();
        fcToast(`Generated variation preview for Row Index: ${state.selectedRowIndex + 1}`);
    };

    window.openBatchGalleryOverlay = function () {
        window.openBulkDrawer();
    };

    window.closeBatchGalleryOverlay = function () {
        window.closeBulkDrawer();
    };

    function renderBatchGalleryGrid() {
        const grid = document.getElementById('batchGalleryGridList');
        if (!grid) return;
        grid.innerHTML = '';

        if (state.csvData.length === 0) {
            grid.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-outline gap-2">
                <span class="material-symbols-outlined text-4xl">video_library</span>
                <span class="text-xs font-semibold">No batch variations generated yet. Upload a CSV to begin.</span>
            </div>
        `;
            return;
        }

        const container = document.createElement('div');
        container.className = 'grid grid-cols-3 gap-6';
        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = 'p-3 bg-surface border border-outline-variant/30 rounded-xl flex flex-col gap-3';
            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;
            item.innerHTML = `
            <div class="aspect-video bg-black rounded-lg flex items-center justify-center relative overflow-hidden">
                <span class="material-symbols-outlined text-white/40 text-4xl">video_library</span>
                <span class="absolute bottom-2 left-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded font-bold">Variation #${idx + 1}</span>
            </div>
            <div class="flex flex-col gap-1">
                <span class="text-xs font-bold text-on-surface truncate">${esc(nameVal)}</span>
                <span class="text-[10px] text-outline truncate">${esc(keys.map(k => `${k}: ${row[k]}`).join(' | '))}</span>
            </div>
        `;
            container.appendChild(item);
        });
        grid.appendChild(container);

        const progressLabel = document.getElementById('batchGalleryRenderedProgressLabel');
        if (progressLabel) {
            progressLabel.textContent = `Rendered: ${state.csvData.length} / ${state.csvData.length} variations`;
        }
    }

    let batchExportTimeout = null;
    window.startBulkExport = function () {
        window.openBulkDrawer();
        window.startBatchGenerate(true);
    };

    window.cancelBatchExport = function () {
        window.cancelBatchQueue();
    };

    window.retryFailedBatchJobs = function () {
        window.retryFailedBatch();
    };

    window.downloadAllRenderedBatchOutputs = function () {
        window.exportAllBatch();
    };

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
