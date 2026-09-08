class ForgeCutSidebar extends HTMLElement {
    connectedCallback() {
        this.style.display = 'block';
        this.style.height = '100%';
        this.innerHTML = `
<!-- Sidebar Catalog Asset Manager -->
<aside class="w-full bg-surface border-r border-outline-variant flex flex-col h-full select-none" id="leftSidebarContainer">
    <!-- Sidebar Navigation Tabs -->
    <nav class="flex border-b border-outline-variant bg-surface h-10 items-stretch shrink-0">
        <button class="left-tab-btn flex-1 text-center font-panel-header text-xs border-b-2 border-primary font-bold text-primary bg-transparent border-none cursor-pointer" data-left-tab="media">Media</button>
        <button class="left-tab-btn flex-1 text-center font-panel-header text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors bg-transparent border-none cursor-pointer" data-left-tab="audio">Audio</button>
        <button class="left-tab-btn flex-1 text-center font-panel-header text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors bg-transparent border-none cursor-pointer" data-left-tab="text">Text</button>
        <button class="left-tab-btn flex-1 text-center font-panel-header text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors bg-transparent border-none cursor-pointer" data-left-tab="shapes">Shapes</button>
    </nav>
    
    <!-- Tab Sections Content Area -->
    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar bg-surface-bright" id="leftSidebarPanel">
        <!-- Media Section -->
        <div id="left-panel-media" class="left-tab-panel flex flex-col gap-4">
            <div class="flex justify-between items-center">
                <span class="text-xs font-bold text-outline uppercase tracking-wider">Project Media</span>
                <button class="flex items-center gap-1 text-xs text-primary font-bold hover:underline bg-transparent border-none cursor-pointer relative">
                    <span class="material-symbols-outlined text-sm">add_circle</span>
                    <span>Import</span>
                    <input type="file" id="mediaImportBtnInput" accept="video/*,image/*" multiple class="absolute inset-0 opacity-0 cursor-pointer">
                </button>
            </div>
            <div class="grid grid-cols-2 gap-3" id="catalog-media-grid">
                <!-- Dynamically populated files -->
            </div>
        </div>
        
        <!-- Audio Section -->
        <div id="left-panel-audio" class="left-tab-panel hidden flex flex-col gap-4">
            <div class="flex justify-between items-center">
                <span class="text-xs font-bold text-outline uppercase tracking-wider">Audio Library</span>
                <button class="flex items-center gap-1 text-xs text-primary font-bold hover:underline bg-transparent border-none cursor-pointer relative">
                    <span class="material-symbols-outlined text-sm">library_music</span>
                    <span>Upload</span>
                    <input type="file" id="audioImportBtnInput" accept="audio/*" multiple class="absolute inset-0 opacity-0 cursor-pointer">
                </button>
            </div>
            <div class="flex flex-col gap-2" id="catalog-audio-list">
                <!-- Dynamically populated audio assets -->
            </div>
        </div>
        
        <!-- Text Section -->
        <div id="left-panel-text" class="left-tab-panel hidden flex flex-col gap-4">
            <span class="text-xs font-bold text-outline uppercase tracking-wider">Text Presets</span>
            <div class="flex flex-col gap-2">
                <div class="p-3 bg-surface hover:bg-surface-container rounded border border-outline-variant/30 cursor-grab flex items-center justify-between text-on-surface" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({type:'text', style:'Heading'}))" onclick="addNewTextClip('Heading')">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold">Heading</span>
                        <span class="text-[10px] text-outline">Large header label</span>
                    </div>
                    <span class="material-symbols-outlined text-primary">title</span>
                </div>
                <div class="p-3 bg-surface hover:bg-surface-container rounded border border-outline-variant/30 cursor-grab flex items-center justify-between text-on-surface" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({type:'text', style:'Textbox'}))" onclick="addNewTextClip('Textbox')">
                    <div class="flex flex-col">
                        <span class="text-sm">Paragraph Text</span>
                        <span class="text-[10px] text-outline">Standard description textbox</span>
                    </div>
                    <span class="material-symbols-outlined text-primary">text_fields</span>
                </div>
                <div class="p-3 bg-surface hover:bg-surface-container rounded border border-outline-variant/30 cursor-grab flex items-center justify-between text-on-surface" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({type:'text', style:'Caption'}))" onclick="addNewTextClip('Caption')">
                    <div class="flex flex-col">
                        <span class="text-sm italic">Subtitles / Caption</span>
                        <span class="text-[10px] text-outline">Styled voice translation captions</span>
                    </div>
                    <span class="material-symbols-outlined text-primary">closed_caption</span>
                </div>
            </div>
        </div>
        
        <!-- Shapes Section -->
        <div id="left-panel-shapes" class="left-tab-panel hidden flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-250px)] custom-scrollbar pr-1">
            <span class="text-xs font-bold text-outline uppercase tracking-wider">PowerPoint Shapes</span>
            
            <!-- Category: Recently Used -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Recently Used</span>
                <div class="grid grid-cols-3 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Rectangle')">
                        <span class="material-symbols-outlined text-sm text-primary">rectangle</span>
                        <span class="text-[9px] truncate w-full">Rectangle</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Rounded Rectangle')">
                        <span class="material-symbols-outlined text-sm text-primary">square</span>
                        <span class="text-[9px] truncate w-full">Rounded Rect</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Circle')">
                        <span class="material-symbols-outlined text-sm text-primary">circle</span>
                        <span class="text-[9px] truncate w-full">Circle</span>
                    </button>
                </div>
            </div>

            <!-- Category: Lines -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Lines</span>
                <div class="grid grid-cols-3 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Line')">
                        <span class="text-sm font-bold text-primary">—</span>
                        <span class="text-[9px] truncate w-full">Line</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Arrow Line')">
                        <span class="text-sm font-bold text-primary">→</span>
                        <span class="text-[9px] truncate w-full">Arrow Line</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Double Arrow Line')">
                        <span class="text-sm font-bold text-primary">↔</span>
                        <span class="text-[9px] truncate w-full">Dbl Arrow</span>
                    </button>
                </div>
            </div>

            <!-- Category: Rectangles -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Rectangles</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Rectangle')">
                        <span class="text-[9px] truncate w-full">Rectangle</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Rounded Rectangle')">
                        <span class="text-[9px] truncate w-full">Rounded</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Single Corner Snipped Rectangle')">
                        <span class="text-[9px] truncate w-full">Snipped</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Snip and Round Single Corner Rectangle')">
                        <span class="text-[9px] truncate w-full">Snip/Round</span>
                    </button>
                </div>
            </div>

            <!-- Category: Basic Shapes -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Basic Shapes</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Circle')">
                        <span class="text-[9px] truncate w-full">Circle</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Ellipse')">
                        <span class="text-[9px] truncate w-full">Ellipse</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Triangle')">
                        <span class="text-[9px] truncate w-full">Triangle</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Polygon')">
                        <span class="text-[9px] truncate w-full">Polygon</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Diamond')">
                        <span class="text-[9px] truncate w-full">Diamond</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Parallelogram')">
                        <span class="text-[9px] truncate w-full">Parallelogram</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Trapezoid')">
                        <span class="text-[9px] truncate w-full">Trapezoid</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Hexagon')">
                        <span class="text-[9px] truncate w-full">Hexagon</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Octagon')">
                        <span class="text-[9px] truncate w-full">Octagon</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Heart')">
                        <span class="text-[9px] truncate w-full">Heart</span>
                    </button>
                </div>
            </div>

            <!-- Category: Block Arrows -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Block Arrows</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Arrow')">
                        <span class="text-[9px] truncate w-full">Right Arrow</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Left Arrow')">
                        <span class="text-[9px] truncate w-full">Left Arrow</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Up Arrow')">
                        <span class="text-[9px] truncate w-full">Up Arrow</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Down Arrow')">
                        <span class="text-[9px] truncate w-full">Down Arrow</span>
                    </button>
                </div>
            </div>

            <!-- Category: Flowchart -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Flowchart</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Flowchart Process')">
                        <span class="text-[9px] truncate w-full">Process</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Flowchart Decision')">
                        <span class="text-[9px] truncate w-full">Decision</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Flowchart Data')">
                        <span class="text-[9px] truncate w-full">Data</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Flowchart Terminal')">
                        <span class="text-[9px] truncate w-full">Terminal</span>
                    </button>
                </div>
            </div>

            <!-- Category: Stars & Banners -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Stars & Banners</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Star')">
                        <span class="text-[9px] truncate w-full">5-Pt Star</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('4-Point Star')">
                        <span class="text-[9px] truncate w-full">4-Pt Star</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('6-Point Star')">
                        <span class="text-[9px] truncate w-full">6-Pt Star</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('8-Point Star')">
                        <span class="text-[9px] truncate w-full">8-Pt Star</span>
                    </button>
                </div>
            </div>

            <!-- Category: Callouts -->
            <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-primary uppercase">Callouts</span>
                <div class="grid grid-cols-2 gap-2">
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Callout')">
                        <span class="text-[9px] truncate w-full">Callout</span>
                    </button>
                    <button class="p-2 bg-surface hover:bg-surface-container-high rounded border border-outline-variant/20 flex flex-col items-center justify-center gap-1 cursor-pointer text-center" onclick="insertShape('Oval Callout')">
                        <span class="text-[9px] truncate w-full">Oval Callout</span>
                    </button>
                </div>
            </div>
        </div>

    </div>
    
    <!-- Active Asset Inspector / Details View (Fluent Design Card) -->
    <div class="h-[180px] border-t border-outline-variant p-4 bg-surface flex flex-col gap-3 shrink-0" id="sidebarAssetInspector">
        <span class="text-xs font-bold text-outline uppercase tracking-wider">Active Element properties</span>
        <div id="activeAssetDetail" class="flex-1 flex flex-col gap-1.5 justify-center">
            <div style="color: var(--text-muted); font-size:0.75rem; text-align:center;">Select an asset above or a timeline clip to inspect properties</div>
        </div>
    </div>
</aside>
        `;
    }
}

customElements.define('forgecut-sidebar', ForgeCutSidebar);
