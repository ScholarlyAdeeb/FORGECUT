class ForgeCutBatchGallery extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<!-- Batch Output Gallery Grid Modal Overlay -->
<div id="batchGalleryOverlay" class="fixed inset-0 bg-black/75 backdrop-blur-md hidden z-100 flex items-center justify-center p-6 select-none">
    <div class="bg-surface border border-outline-variant rounded-2xl w-[960px] h-[640px] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 text-on-surface">
        
        <!-- Header -->
        <div class="h-14 border-b border-outline-variant/30 flex items-center justify-between px-6 bg-surface shrink-0">
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1;">collections</span>
                <h3 class="font-bold text-sm">Batch Output Variations Grid</h3>
            </div>
            <button class="p-1 hover:bg-surface-container-high rounded text-on-surface-variant cursor-pointer border-none bg-transparent" onclick="closeBatchGalleryOverlay()">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        
        <!-- Filter & Control Bar -->
        <div class="h-12 bg-surface-container-low border-b border-outline-variant/30 px-6 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-4">
                <span class="text-xs text-outline font-medium" id="batchGalleryRenderedProgressLabel">Rendered: 0 / 0 variations</span>
            </div>
            <div class="flex items-center gap-2">
                <button class="px-4 py-1.5 bg-primary text-white font-bold rounded hover:bg-primary-container transition-all border-none cursor-pointer text-xs" onclick="downloadAllRenderedBatchOutputs()">Download All Zip</button>
            </div>
        </div>
        
        <!-- Grid list of rendered items -->
        <div class="flex-grow p-6 overflow-y-auto custom-scrollbar bg-surface-bright" id="batchGalleryGridList">
            <!-- Populated dynamically via JS -->
            <div class="h-full flex flex-col items-center justify-center text-outline gap-2">
                <span class="material-symbols-outlined text-4xl">video_library</span>
                <span class="text-xs font-semibold">No batch variations generated yet. Upload a CSV to begin.</span>
            </div>
        </div>
    </div>
</div>
        `;
    }
}

customElements.define('forgecut-batch-gallery', ForgeCutBatchGallery);
