/**
 * ForgeCut editor — Central state, DOM element cache, init and canvas sizing
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
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
