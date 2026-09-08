class ForgeCutExportQueue extends HTMLElement {
    connectedCallback() {
        this.style.display = 'block';
        this.style.height = '100%';
        this.innerHTML = `
<!-- Right Panel: Inspector and Export Queue -->
<aside class="w-full bg-surface border-l border-outline-variant flex flex-col h-full select-none" id="rightSidebarContainer">
    <!-- Header tabs switching between Preview settings & Export List -->
    <nav class="flex border-b border-outline-variant bg-surface h-10 items-stretch shrink-0">
        <button class="right-tab-btn flex-1 text-center font-panel-header text-xs border-b-2 border-primary font-bold text-primary bg-transparent border-none cursor-pointer" data-right-tab="inspector">Inspector</button>
        <button class="right-tab-btn flex-1 text-center font-panel-header text-xs text-on-surface-variant hover:bg-surface-container-high transition-colors bg-transparent border-none cursor-pointer" data-right-tab="queue">Export Queue</button>
    </nav>
    
    <!-- Tab Sections Content Area -->
    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar bg-surface-bright" id="rightSidebarPanel">
        <!-- Inspector Section -->
        <div id="right-panel-inspector" class="right-tab-panel flex flex-col gap-4">
            <span class="text-xs font-bold text-outline uppercase tracking-wider">Properties Inspector</span>
            <div class="inspector-section flex flex-col gap-3">
                <div style="color: var(--text-muted); font-size:0.75rem; text-align:center;">Select a clip on the timeline or canvas to view properties</div>
            </div>
        </div>
        
        <!-- Export Queue Section -->
        <div id="right-panel-queue" class="right-tab-panel hidden flex flex-col gap-4">
            <div class="flex justify-between items-center">
                <span class="text-xs font-bold text-outline uppercase tracking-wider">Queue Management</span>
                <span class="text-[10px] bg-primary-container text-on-primary-container px-2 py-0.5 rounded font-bold" id="queueTotalCount">0 Items</span>
            </div>
            
            <!-- Queue Actions -->
            <div class="flex flex-col gap-2 p-3 bg-surface-container rounded border border-outline-variant/30">
                <div class="flex justify-between items-center text-xs">
                    <span class="text-on-surface-variant font-medium">Selected for Export:</span>
                    <span class="font-bold text-primary" id="queueSelectedCount">0</span>
                </div>
                <button class="w-full py-2 bg-primary text-white font-bold rounded hover:bg-primary-container hover:shadow transition-all border-none cursor-pointer" onclick="exportSelectedVariations()">Export Selected</button>
            </div>
            
            <!-- Cards list -->
            <div class="flex flex-col gap-3" id="rowSelectorList">
                <!-- Dynamically populated cards representing variations -->
            </div>
        </div>
    </div>
</aside>
        `;
    }
}

customElements.define('forgecut-export-queue', ForgeCutExportQueue);
