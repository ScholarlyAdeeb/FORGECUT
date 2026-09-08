class ForgeCutPreview extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<!-- Main Canvas Preview Panel -->
<div class="flex-1 flex flex-col h-full bg-surface-container-low select-none relative" id="previewPanelWrapper">
    <!-- Safe Area Overlay / Title Bar Details -->
    <div class="h-10 border-b border-outline-variant/30 flex items-center justify-between px-4 bg-surface shrink-0">
        <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-on-surface-variant" style="font-size:16px;">monitor</span>
            <span class="text-xs font-bold text-on-surface uppercase tracking-wider">Canvas Workspace</span>
        </div>
        <div class="flex items-center gap-3">
            <button class="flex items-center gap-1 text-[11px] hover:bg-surface-container-high rounded px-1.5 py-0.5 transition-colors bg-transparent border-none cursor-pointer text-on-surface-variant" onclick="adjustCanvasZoom(-10)">
                <span class="material-symbols-outlined text-sm">zoom_out</span>
            </button>
            <div class="flex items-center gap-1.5 bg-surface-container px-2 py-0.5 rounded border border-outline-variant/30 cursor-pointer" onclick="cycleCanvasZoom()">
                <span class="text-[9px] text-outline font-bold">ZOOM:</span>
                <span class="text-[10px] text-on-surface font-semibold" id="canvasZoomPercentLabel">100%</span>
            </div>
            <button class="flex items-center gap-1 text-[11px] hover:bg-surface-container-high rounded px-1.5 py-0.5 transition-colors bg-transparent border-none cursor-pointer text-on-surface-variant" onclick="adjustCanvasZoom(10)">
                <span class="material-symbols-outlined text-sm">zoom_in</span>
            </button>
            <button class="flex items-center gap-1 text-[11px] hover:bg-surface-container-high rounded px-2 py-0.5 transition-colors bg-transparent border-none cursor-pointer text-on-surface-variant" onclick="zoomCanvasFit()">
                <span class="material-symbols-outlined text-sm">fit_screen</span>
                <span>Fit</span>
            </button>
            <button class="flex items-center gap-1 text-[11px] hover:bg-surface-container-high rounded px-2 py-0.5 transition-colors bg-transparent border-none cursor-pointer text-on-surface-variant" id="btnToggleSafeArea" onclick="toggleSafeAreaGuide()">
                <span class="material-symbols-outlined text-sm">square_foot</span>
                <span>Safe Zones</span>
            </button>
        </div>
    </div>
    
    <!-- Canvas Composition Work Area -->
    <div class="flex-1 flex items-center justify-center relative overflow-hidden bg-slate-900" id="canvasContainerBg">
        <div id="canvasWrapper" class="relative shrink-0 shadow-2xl transition-all duration-75" style="width: 800px; height: 450px;">
            <!-- Gridlines / Guides / Safe Area overlays -->
            <div class="absolute inset-0 pointer-events-none hidden z-10" id="canvasGridOverlay"></div>
            <div class="absolute inset-0 pointer-events-none hidden z-10" id="canvasGuidesOverlay"></div>
            <div class="absolute pointer-events-none hidden z-15 border border-red-500/30" id="safeAreaPlatformBox">
                <span class="absolute top-1 left-2 text-[9px] text-red-500 font-bold bg-slate-950/80 px-1 py-0.5 rounded" id="safeAreaLabelText">YouTube Safe Area (16:9)</span>
            </div>
            
            <!-- Interactive Bounding Box Transform Overlay -->
            <div class="absolute border-2 border-primary hidden z-20 pointer-events-auto" id="transformOverlayContainer">
                <!-- Resize Handles -->
                <div class="absolute w-3 h-3 bg-white border border-primary -top-1.5 -left-1.5 cursor-nwse-resize" data-handle="top-left"></div>
                <div class="absolute w-3 h-3 bg-white border border-primary -top-1.5 -right-1.5 cursor-nesw-resize" data-handle="top-right"></div>
                <div class="absolute w-3 h-3 bg-white border border-primary -bottom-1.5 -left-1.5 cursor-nesw-resize" data-handle="bottom-left"></div>
                <div class="absolute w-3 h-3 bg-white border border-primary -bottom-1.5 -right-1.5 cursor-nwse-resize" data-handle="bottom-right"></div>
                <!-- Rotation Anchor -->
                <div class="absolute w-3.5 h-3.5 bg-white border-2 border-primary rounded-full -top-6 left-1/2 -translate-x-1/2 cursor-grab flex items-center justify-center" id="rotationAnchorBtn">
                    <span class="w-1.5 h-1.5 bg-primary rounded-full"></span>
                </div>
                <!-- Connecting rod to rotation anchor -->
                <div class="absolute w-px h-3 bg-primary -top-3 left-1/2 -translate-x-1/2"></div>
            </div>
            
            <!-- Inline Canvas Text Area Editor -->
            <textarea id="canvasInlineTextEditor" class="absolute hidden z-30 p-2 text-center bg-black/90 text-white border-2 border-primary focus:outline-none resize-none font-bold rounded shadow-lg overflow-hidden"></textarea>
    
            <!-- Primary HTML5 Canvas Render Layer -->
            <canvas id="renderCanvas" width="1080" height="1920" class="w-full h-full relative bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px] bg-slate-950"></canvas>
        </div>
    </div>
    
    <!-- Video Player Control Panel -->
    <div class="h-14 border-t border-outline-variant bg-surface px-4 flex items-center justify-between shrink-0 select-none">
        <div class="flex items-center gap-3">
            <span class="text-xs font-mono font-bold px-2 py-0.5 bg-surface-container rounded border border-outline-variant/30 text-on-surface" id="timecodeDisplay">00:00:00:00</span>
            <span class="text-[10px] text-outline" id="activeTimelineLengthLabel">Total: 00:00s</span>
        </div>
        
        <!-- Control buttons -->
        <div class="flex items-center gap-1.5">
            <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="setTime(0)"><span class="material-symbols-outlined text-[18px]">first_page</span></button>
            <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="setTime(state.currentTime - 1)"><span class="material-symbols-outlined text-[18px]">chevron_left</span></button>
            <button class="p-2.5 bg-primary text-white rounded-full hover:bg-primary-container shadow flex items-center justify-center cursor-pointer border-none" id="playPauseBtn">
                <span class="material-symbols-outlined text-lg" id="playPauseIcon" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
            </button>
            <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="setTime(state.currentTime + 1)"><span class="material-symbols-outlined text-[18px]">chevron_right</span></button>
            <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="setTime(state.duration)"><span class="material-symbols-outlined text-[18px]">last_page</span></button>
        </div>
        
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-1">
                <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="toggleMuteAudio()"><span class="material-symbols-outlined text-[18px]" id="canvasAudioVolumeIcon">volume_up</span></button>
                <input type="range" class="w-16 h-1 bg-outline-variant rounded-lg appearance-none cursor-pointer accent-primary" min="0" max="100" value="80" id="canvasMasterVolumeSlider" oninput="setMasterVolume(this.value)">
            </div>
            <button class="p-1 hover:bg-surface-container-high rounded bg-transparent border-none cursor-pointer" onclick="toggleCanvasFullScreen()"><span class="material-symbols-outlined text-[18px]">fullscreen</span></button>
        </div>
    </div>
</div>
        `;
    }
}

customElements.define('forgecut-preview', ForgeCutPreview);
