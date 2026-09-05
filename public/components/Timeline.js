class ForgeCutTimeline extends HTMLElement {
    connectedCallback() {
        this.style.display = 'block';
        this.innerHTML = `
<!-- Timeline Panel -->
<div class="h-full bg-surface border-t border-outline-variant flex flex-col min-h-[220px]">
    <!-- Timeline Toolbar -->
    <div class="h-10 border-b border-outline-variant/30 flex items-center px-4 justify-between bg-surface-container-low select-none shrink-0">
        <div class="flex items-center gap-4">
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="triggerUndo()">undo</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="triggerRedo()">redo</button>
            <div class="h-4 w-px bg-outline-variant/30"></div>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="triggerSplit()">content_cut</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="timelineDeleteSelected()" title="Delete Clip">delete</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="rippleDeleteSelected()" title="Ripple Delete Clip">delete_sweep</button>
        </div>
        <div class="flex items-center gap-4">
            <button class="material-symbols-outlined text-primary hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="toggleSnapping()" id="snapBtn" title="Toggle Snapping">straighten</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="alert('Magnet mode toggle')" id="magnetBtn">circle</button>
            <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="alert('Zoom slider focused')">zoom_in</button>
        </div>
    </div>
    
    <!-- Unified Workspace Layout -->
    <div class="flex-grow flex flex-col overflow-hidden relative">
        <!-- Ruler Header Row -->
        <div class="h-6 border-b border-outline-variant/30 flex shrink-0 select-none">
            <!-- Spacer matching Track Headers Column -->
            <div class="w-48 border-r border-outline-variant bg-surface-container-low shrink-0 flex items-center px-3 justify-end">
                <span class="text-[9px] text-outline font-bold tracking-wider mr-1">TIMECODE</span>
            </div>
            <!-- Ruler viewport -->
            <div class="flex-grow overflow-hidden bg-surface-container-low relative" id="rulerScrollParent">
                <div class="h-full w-full" id="timelineRuler"></div>
            </div>
        </div>

        <!-- Scrollable Tracks Area -->
        <div class="flex-grow flex overflow-y-auto custom-scrollbar" id="timelineScrollBody" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;">
            <!-- Track Headers Column -->
            <div class="w-48 flex flex-col border-r border-outline-variant bg-surface-container-low shrink-0 select-none divide-y divide-outline-variant/20" style="height: 320px;">
                <!-- Text Track Header -->
                <div class="h-16 px-3 flex flex-col justify-center gap-1 group">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-5 h-5 rounded bg-tertiary-container text-[10px] flex items-center justify-center text-white font-bold select-none">T</span>
                            <span class="text-xs font-bold truncate text-on-surface cursor-pointer" id="track-label-textTrack" ondblclick="renameTrack('textTrack')" title="Double click to rename">Text Track 1</span>
                        </div>
                        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="lock-textTrack" onclick="toggleTrackLock('textTrack')">lock_open</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="visibility-textTrack" onclick="toggleTrackVisibility('textTrack')">visibility</span>
                        </div>
                    </div>
                </div>
                <!-- Video Track 2 Header -->
                <div class="h-16 px-3 flex flex-col justify-center gap-1 group">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-5 h-5 rounded bg-primary-container text-[10px] flex items-center justify-center text-white font-bold select-none">V</span>
                            <span class="text-xs font-bold truncate text-on-surface cursor-pointer" id="track-label-videoTrack2" ondblclick="renameTrack('videoTrack2')" title="Double click to rename">Video Track 2</span>
                        </div>
                        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="lock-videoTrack2" onclick="toggleTrackLock('videoTrack2')">lock_open</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="visibility-videoTrack2" onclick="toggleTrackVisibility('videoTrack2')">visibility</span>
                        </div>
                    </div>
                </div>
                <!-- Video Track 1 Header -->
                <div class="h-16 px-3 flex flex-col justify-center gap-1 group">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-5 h-5 rounded bg-primary-container text-[10px] flex items-center justify-center text-white font-bold select-none">V</span>
                            <span class="text-xs font-bold truncate text-on-surface cursor-pointer" id="track-label-videoTrack" ondblclick="renameTrack('videoTrack')" title="Double click to rename">Video Track 1</span>
                        </div>
                        <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="lock-videoTrack" onclick="toggleTrackLock('videoTrack')">lock_open</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="visibility-videoTrack" onclick="toggleTrackVisibility('videoTrack')">visibility</span>
                        </div>
                    </div>
                </div>
                <!-- Audio Track 2 Header -->
                <div class="h-16 px-3 flex flex-col justify-center gap-1">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-5 h-5 rounded bg-[#4CAF50] text-[10px] flex items-center justify-center text-white font-bold select-none">A</span>
                            <span class="text-xs font-bold truncate text-on-surface cursor-pointer" id="track-label-audioTrack2" ondblclick="renameTrack('audioTrack2')" title="Double click to rename">Audio Track 2</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="lock-audioTrack2" onclick="toggleTrackLock('audioTrack2')">lock_open</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="visibility-audioTrack2" onclick="toggleTrackVisibility('audioTrack2')">visibility</span>
                        </div>
                    </div>
                    <!-- Track Controls: Mute, Solo, Track Volume Slider -->
                    <div class="flex items-center gap-2 mt-1">
                        <button class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant hover:bg-red-600 hover:text-white transition-colors border-none" id="mute-audioTrack2" onclick="toggleTrackMuteBtn('audioTrack2')">M</button>
                        <button class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant hover:bg-yellow-500 hover:text-black transition-colors border-none" id="solo-audioTrack2" onclick="toggleTrackSoloBtn('audioTrack2')">S</button>
                        <input type="range" min="0" max="100" value="100" class="w-20 h-1 bg-surface-container-highest rounded-full accent-primary cursor-pointer border-none" id="vol-audioTrack2" oninput="changeTrackVolumeBtn('audioTrack2', this.value)" title="Track Volume">
                    </div>
                </div>
                <!-- Audio Track 1 Header -->
                <div class="h-16 px-3 flex flex-col justify-center gap-1">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-5 h-5 rounded bg-[#4CAF50] text-[10px] flex items-center justify-center text-white font-bold select-none">A</span>
                            <span class="text-xs font-bold truncate text-on-surface cursor-pointer" id="track-label-audioTrack" ondblclick="renameTrack('audioTrack')" title="Double click to rename">Audio Track 1</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="lock-audioTrack" onclick="toggleTrackLock('audioTrack')">lock_open</span>
                            <span class="material-symbols-outlined text-xs cursor-pointer text-on-surface-variant hover:text-primary" id="visibility-audioTrack" onclick="toggleTrackVisibility('audioTrack')">visibility</span>
                        </div>
                    </div>
                    <!-- Track Controls: Mute, Solo, Track Volume Slider -->
                    <div class="flex items-center gap-2 mt-1">
                        <button class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant hover:bg-red-600 hover:text-white transition-colors border-none" id="mute-audioTrack" onclick="toggleTrackMuteBtn('audioTrack')">M</button>
                        <button class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant hover:bg-yellow-500 hover:text-black transition-colors border-none" id="solo-audioTrack" onclick="toggleTrackSoloBtn('audioTrack')">S</button>
                        <input type="range" min="0" max="100" value="100" class="w-20 h-1 bg-surface-container-highest rounded-full accent-primary cursor-pointer border-none" id="vol-audioTrack" oninput="changeTrackVolumeBtn('audioTrack', this.value)" title="Track Volume">
                    </div>
                </div>
            </div>
            
            <!-- Timeline tracks body (horizontal scroll only) -->
            <div class="flex-grow overflow-x-auto overflow-y-hidden custom-scrollbar relative select-none" id="timelineContainer" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; height: 320px;">
                <div class="min-w-full w-max flex flex-col h-full bg-surface-container relative">
                    <!-- Tracks Contents Rows Stack -->
                    <div class="flex flex-col divide-y divide-outline-variant/20 shrink-0" id="tracksContainer" style="height: 320px;">
                        <!-- Text Track row -->
                        <div class="timeline-track h-16 relative" id="textTrackContainer">
                            <div class="timeline-track-content h-16 relative" id="textTrackContent"></div>
                        </div>
                        <!-- Video Track 2 row -->
                        <div class="timeline-track h-16 relative" id="videoTrack2Container">
                            <div class="timeline-track-content h-16 relative" id="videoTrack2Content"></div>
                        </div>
                        <!-- Video Track 1 row -->
                        <div class="timeline-track h-16 relative" id="videoTrackContainer">
                            <div class="timeline-track-content h-16 relative" id="videoTrackContent"></div>
                        </div>
                        <!-- Audio Track 2 row -->
                        <div class="timeline-track h-16 relative" id="audioTrack2Container">
                            <div class="timeline-track-content h-16 relative" id="audioTrack2Content"></div>
                        </div>
                        <!-- Audio Track 1 row -->
                        <div class="timeline-track h-16 relative" id="audioTrackContainer">
                            <div class="timeline-track-content h-16 relative" id="audioTrackContent"></div>
                        </div>
                    </div>
                    
                    <!-- Timeline Vertical Playhead Line -->
                    <div id="playhead" class="absolute top-0 bottom-0 left-0 w-px bg-primary z-30 pointer-events-none">
                        <div id="playheadHandle" class="absolute -top-1 -left-[6px] w-3 h-5 bg-primary shadow-md cursor-ew-resize pointer-events-auto"></div>
                    </div>
                    
                    <!-- Timeline Vertical Snap Guide -->
                    <div id="timelineSnapGuide" class="absolute top-0 bottom-0 left-0 w-px bg-cyan-400 z-25 pointer-events-none hidden" style="box-shadow: 0 0 8px #00e5ff;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Timeline Minimap (Navigator) at the bottom -->
    <div class="h-6 border-t border-outline-variant/30 bg-surface-container-low flex items-center relative select-none shrink-0">
        <div class="w-48 h-full border-r border-outline-variant bg-surface-container-low shrink-0 flex items-center px-3">
            <span class="text-[9px] font-bold text-outline uppercase tracking-wider">Navigator</span>
        </div>
        <div class="flex-1 h-full relative" id="minimapScrollParent">
            <canvas id="timelineMinimap" class="w-full h-full opacity-60 hover:opacity-100 transition-opacity cursor-pointer"></canvas>
        </div>
    </div>
</div>
<!-- Hover Tooltip -->
<div id="timelineTooltip" class="absolute bg-surface-container-highest text-on-surface text-[10px] px-2 py-0.5 rounded shadow pointer-events-none hidden z-50 border border-outline-variant">00:00.00</div>
        `;
    }
}

customElements.define('forgecut-timeline', ForgeCutTimeline);
