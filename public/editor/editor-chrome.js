/**
 * ForgeCut editor — Ribbon/sidebar navigation, backstage stubs, zoom
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
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

    // Inputs that accept more than one kind of media have to pick the type per
    // file instead of being pinned to one.
    const typeForFile = (file) => {
        if (file.type.startsWith('audio')) return 'audio';
        if (file.type.startsWith('image')) return 'image';
        return 'video';
    };

    // The Import button in the Project Media panel (accept="video/*,image/*",
    // multiple). It had no listener at all, so choosing a file through the
    // panel's most obvious import affordance silently did nothing.
    const mediaImportBtnInput = document.getElementById('mediaImportBtnInput');
    if (mediaImportBtnInput) {
        mediaImportBtnInput.addEventListener('change', (e) => {
            for (let file of e.target.files) {
                handleAssetUpload(file, typeForFile(file));
            }
            // Clear the selection so picking the same file again re-fires
            // 'change' rather than looking like another dead button.
            e.target.value = '';
        });
    }

    const backstageUploadInput = document.getElementById('backstageUploadInput');
    if (backstageUploadInput) {
        backstageUploadInput.addEventListener('change', (e) => {
            for (let file of e.target.files) {
                handleAssetUpload(file, typeForFile(file));
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

// Undo / Redo are implemented for real in editor-project.js on top of
// HistoryManager. The mock hooks that used to sit here only ever showed a
// toast, and were shadowed purely because editor-project.js happens to load
// later in index.html — reordering the scripts would have silently turned
// undo back into a no-op.

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
