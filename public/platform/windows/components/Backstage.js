class ForgeCutBackstage extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<!-- Project Backstage Overlay (Modal Dashboard) -->
<div id="backstageOverlay" class="fixed inset-0 hidden z-[100]" style="background:transparent;">
    <div class="backstage-panel bg-surface w-full h-full flex overflow-hidden shadow-2xl">
        
        <!-- Left Side Navigation Bar (Office Blue / Primary) -->
        <aside class="w-[280px] bg-primary flex flex-col justify-between pt-12 pb-6 text-on-primary shadow-lg z-10">
            <div class="flex flex-col gap-6">
                <!-- Back Button -->
                <button class="flex items-center gap-3 px-6 py-2 hover:bg-white/10 transition-colors border-none bg-transparent text-on-primary cursor-pointer w-fit ml-4 rounded-full" onclick="closeBackstage()" title="Back to Editor">
                    <span class="material-symbols-outlined text-2xl">arrow_back</span>
                </button>
                
                <nav class="flex flex-col mt-4">
                    <button class="backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-white/20 font-semibold border-none text-left cursor-pointer" data-backstage-tab="new">
                        <span class="text-sm">New</span>
                    </button>
                    <button class="backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-transparent border-none text-left cursor-pointer" data-backstage-tab="open">
                        <span class="text-sm">Open</span>
                    </button>
                    <button class="backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-transparent border-none text-left cursor-pointer" data-backstage-tab="settings">
                        <span class="text-sm">Options</span>
                    </button>
                    <button class="backstage-nav-btn flex items-center gap-4 px-8 py-4 text-on-primary/80 hover:bg-white/10 transition-colors bg-transparent border-none text-left cursor-pointer" data-backstage-tab="help">
                        <span class="text-sm">Help</span>
                    </button>
                </nav>
            </div>
            
            <div class="flex flex-col gap-1 px-8 pt-4">
                <span class="text-xs text-on-primary/60">ForgeCut Studio Version 1.0.0</span>
            </div>
        </aside>
        
        <!-- Right Side Tab Sections Content Area -->
        <main class="flex-grow bg-surface p-12 md:p-20 overflow-y-auto relative text-on-surface">
            
            <div class="max-w-4xl">
                <!-- Section: New Project -->
                <div id="backstage-section-new" class="backstage-section flex flex-col gap-10">
                    <h2 class="text-4xl font-light text-primary">New</h2>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-6">
                        <div class="p-6 bg-surface-container-low hover:bg-surface-container rounded-lg border border-outline-variant/30 cursor-pointer flex flex-col items-center gap-4 group transition-colors shadow-sm" onclick="triggerNewProject('16_9')">
                            <div class="w-32 h-20 bg-surface border border-outline-variant rounded flex items-center justify-center group-hover:border-primary transition-colors">
                                <span class="material-symbols-outlined text-4xl text-outline group-hover:text-primary">aspect_ratio</span>
                            </div>
                            <div class="flex flex-col items-center text-center gap-1">
                                <span class="text-sm font-semibold">Landscape (16:9)</span>
                                <span class="text-xs text-on-surface-variant">YouTube, Desktop, Broadcast</span>
                            </div>
                        </div>
                        <div class="p-6 bg-surface-container-low hover:bg-surface-container rounded-lg border border-outline-variant/30 cursor-pointer flex flex-col items-center gap-4 group transition-colors shadow-sm" onclick="triggerNewProject('9_16')">
                            <div class="w-20 h-32 bg-surface border border-outline-variant rounded flex items-center justify-center group-hover:border-primary transition-colors">
                                <span class="material-symbols-outlined text-4xl text-outline group-hover:text-primary">stay_current_portrait</span>
                            </div>
                            <div class="flex flex-col items-center text-center gap-1">
                                <span class="text-sm font-semibold">Portrait (9:16)</span>
                                <span class="text-xs text-on-surface-variant">TikTok, Reels, Shorts</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Section: Open Project -->
                <div id="backstage-section-open" class="backstage-section hidden flex flex-col gap-10">
                    <h2 class="text-4xl font-light text-primary">Open</h2>
                    <div class="p-12 bg-surface-container-low hover:bg-surface-container rounded-lg border border-dashed border-outline-variant flex flex-col items-center justify-center gap-4 relative cursor-pointer transition-colors max-w-xl">
                        <span class="material-symbols-outlined text-5xl text-outline">folder_open</span>
                        <span class="text-sm font-semibold text-on-surface">Browse for a ForgeCut project (.json)</span>
                        <input type="file" id="projectOpenFileInput" accept=".json" class="absolute inset-0 opacity-0 cursor-pointer" onchange="triggerOpenProject(event)">
                    </div>
                </div>
                
                <!-- Section: Settings -->
                <div id="backstage-section-settings" class="backstage-section hidden flex flex-col gap-10">
                    <h2 class="text-4xl font-light text-primary">Options</h2>
                    <div class="flex flex-col gap-6 max-w-2xl">
                        <div class="flex justify-between items-center py-4 border-b border-outline-variant/30">
                            <div class="flex flex-col gap-1">
                                <span class="text-base font-semibold">Enable Safe Zones Grid</span>
                                <span class="text-sm text-on-surface-variant">Display standard framing guide lines on player</span>
                            </div>
                            <input type="checkbox" checked onchange="toggleSafeAreaGuide()" class="rounded border-outline-variant text-primary focus:ring-primary h-5 w-5 cursor-pointer">
                        </div>
                        <div class="flex justify-between items-center py-4 border-b border-outline-variant/30">
                            <div class="flex flex-col gap-1">
                                <span class="text-base font-semibold">WebCodecs Acceleration</span>
                                <span class="text-sm text-on-surface-variant">Accelerate background rendering of variations</span>
                            </div>
                            <input type="checkbox" checked class="rounded border-outline-variant text-primary focus:ring-primary h-5 w-5 cursor-pointer">
                        </div>
                        <div class="flex justify-between items-center py-4 border-b border-outline-variant/30">
                            <div class="flex flex-col gap-1">
                                <span class="text-base font-semibold">Dark Theme</span>
                                <span class="text-sm text-on-surface-variant">Toggle dark mode interface</span>
                            </div>
                            <input type="checkbox" onchange="window.toggleDarkTheme()" class="rounded border-outline-variant text-primary focus:ring-primary h-5 w-5 cursor-pointer">
                        </div>
                    </div>
                </div>
                
                <!-- Section: Help -->
                <div id="backstage-section-help" class="backstage-section hidden flex flex-col gap-10">
                    <h2 class="text-4xl font-light text-primary">Help</h2>
                    <div class="flex flex-col gap-4 max-w-xl text-sm">
                        <div class="flex justify-between p-3 border-b border-outline-variant/20"><span class="font-semibold">Play / Pause</span><kbd class="px-2 py-1 bg-surface-container border border-outline-variant/50 rounded font-mono text-xs">Space</kbd></div>
                        <div class="flex justify-between p-3 border-b border-outline-variant/20"><span class="font-semibold">Undo Action</span><kbd class="px-2 py-1 bg-surface-container border border-outline-variant/50 rounded font-mono text-xs">Ctrl + Z</kbd></div>
                        <div class="flex justify-between p-3 border-b border-outline-variant/20"><span class="font-semibold">Redo Action</span><kbd class="px-2 py-1 bg-surface-container border border-outline-variant/50 rounded font-mono text-xs">Ctrl + Y</kbd></div>
                        <div class="flex justify-between p-3 border-b border-outline-variant/20"><span class="font-semibold">Split Clip</span><kbd class="px-2 py-1 bg-surface-container border border-outline-variant/50 rounded font-mono text-xs">S</kbd></div>
                        <div class="flex justify-between p-3 border-b border-outline-variant/20"><span class="font-semibold">Delete Selected</span><kbd class="px-2 py-1 bg-surface-container border border-outline-variant/50 rounded font-mono text-xs">Delete</kbd></div>
                    </div>
                </div>
            </div>
        </main>
    </div>
</div>
        `;
    }
}

customElements.define('forgecut-backstage', ForgeCutBackstage);
