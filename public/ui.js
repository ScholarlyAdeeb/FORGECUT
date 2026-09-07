/**
 * ForgeCut — ui.js
 * Handles: Dark Theme, Splash, Welcome, Editor Entry Animation,
 *          Backstage Office Animation, Editable Project Name, Panel Resizing
 */

'use strict';

/* ─────────────────────────────────────────────
   1. DARK THEME
   ───────────────────────────────────────────── */
function toggleDarkTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    html.classList.toggle('dark', !isDark);
    html.classList.toggle('light', isDark);
    localStorage.setItem('forgecut-theme', isDark ? 'light' : 'dark');

    // sync Welcome dashboard checkbox if visible
    const cb = document.getElementById('welcomeDarkToggle');
    if (cb) cb.checked = !isDark;
}

function initTheme() {
    const saved = localStorage.getItem('forgecut-theme') || 'light';
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(saved);

    const cb = document.getElementById('welcomeDarkToggle');
    if (cb) cb.checked = saved === 'dark';
}
window.toggleDarkTheme = toggleDarkTheme;


/* ─────────────────────────────────────────────
   2. SPLASH → WELCOME → EDITOR FLOW
   ───────────────────────────────────────────── */
window._editorLaunched = false;

function showSplash() {
    const splash = document.getElementById('fc-splash');
    if (!splash) return;
    splash.style.display = 'flex';
}

function hideSplashShowWelcome() {
    const splash = document.getElementById('fc-splash');
    const welcome = document.getElementById('fc-welcome');
    if (!splash || !welcome) return;

    splash.classList.add('exit');
    setTimeout(() => {
        splash.style.display = 'none';
        welcome.style.display = 'flex';
        // Trigger visible class next frame for transition
        requestAnimationFrame(() => {
            requestAnimationFrame(() => welcome.classList.add('visible'));
        });
        populateRecentProjects();
    }, 380);
}

window.launchEditor = function(ratio) {
    if (window._editorLaunched) return;
    window._editorLaunched = true;

    const welcome = document.getElementById('fc-welcome');
    const editorShell = document.getElementById('fc-editor-shell');

    // Fade out welcome
    if (welcome) {
        welcome.style.transition = 'opacity 0.25s ease';
        welcome.style.opacity = '0';
        welcome.style.pointerEvents = 'none';
        setTimeout(() => { welcome.style.display = 'none'; }, 260);
    }

    // Show editor shell
    setTimeout(() => {
        if (editorShell) {
            editorShell.style.display = 'flex';

            // Canvas setup is deferred until the shell is on screen, so tell the
            // editor to initialise now rather than leaving it to poll for us.
            if (window.ForgeCut && typeof window.ForgeCut.initEditor === 'function') {
                window.ForgeCut.initEditor();
            }

            // Trigger keyframe entry animation
            requestAnimationFrame(() => {
                editorShell.classList.add('editor-entering');
                // Remove animation class after it's done so it doesn't replay
                setTimeout(() => editorShell.classList.remove('editor-entering'), 800);
            });

            // Init resizers and set aspect ratio after shell is visible & engine inits
            setTimeout(() => {
                initResizers();
                initEditableProjectName();
                // Apply aspect ratio once canvas is ready
                if (window.setAspectRatio) {
                    if (ratio === '16_9') window.setAspectRatio(16, 9);
                    else if (ratio === '9_16') window.setAspectRatio(9, 16);
                    else if (ratio === '1_1') window.setAspectRatio(1, 1);
                }
                if (window.renderTimeline) window.renderTimeline();
                if (window.renderCanvasComposition) window.renderCanvasComposition();
                if (window.updateInspector) window.updateInspector();
            }, 700);
        }
    }, 200);
};

window.welcomeOpenProject = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.tracks) {
                // Launch editor first then load
                window.launchEditor('16_9');
                setTimeout(() => {
                    if (window.state) {
                        window.state.tracks = data.tracks;
                        window.state.duration = data.duration || 30;
                        window.state.currentTime = data.currentTime || 0;
                        window.state.zoom = data.zoom || 20;
                        if (data.bgType) window.state.bgType = data.bgType;
                        if (data.bgColor) window.state.bgColor = data.bgColor;
                    }
                    if (window.renderTimeline) window.renderTimeline();
                    if (window.renderCanvasComposition) window.renderCanvasComposition();
                }, 800);
                // Save to recent
                addRecentProject(file.name, data);
            }
        } catch (e) {
            fcToast('Failed to parse project file.');
        }
    };
    reader.readAsText(file);
};

window.switchWelcomeTab = function(tab, btn) {
    document.querySelectorAll('.fc-welcome-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.fc-welcome-section').forEach(s => s.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const section = document.getElementById('wt-' + tab);
    if (section) section.classList.add('active');
};


/* ─────────────────────────────────────────────
   3. RECENT PROJECTS
   ───────────────────────────────────────────── */
function addRecentProject(name, data) {
    const recents = JSON.parse(localStorage.getItem('fc-recents') || '[]');
    recents.unshift({ name, timestamp: Date.now(), preview: null });
    if (recents.length > 8) recents.length = 8;
    localStorage.setItem('fc-recents', JSON.stringify(recents));
}

function populateRecentProjects() {
    const container = document.getElementById('welcomeRecentList');
    if (!container) return;
    const recents = JSON.parse(localStorage.getItem('fc-recents') || '[]');
    if (!recents.length) {
        container.innerHTML = '<div style="color:var(--on-surface-variant);font-size:13px;padding:20px 0;">No recent projects yet.</div>';
        return;
    }
    container.innerHTML = recents.map((r, i) => `
        <div class="fc-recent-item">
            <span class="material-symbols-outlined fc-recent-item-icon" style="font-variation-settings:'FILL' 1;">movie</span>
            <div>
                <div class="fc-recent-item-name">${escapeHtml(r.name)}</div>
                <div class="fc-recent-item-meta">${new Date(r.timestamp).toLocaleDateString()} · ForgeCut Project</div>
            </div>
        </div>
    `).join('');
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* ─────────────────────────────────────────────
   4. BACKSTAGE OFFICE-STYLE ANIMATION
   ───────────────────────────────────────────── */
let _backstageOpen = false;

window.openBackstage = function() {
    const overlay = document.getElementById('backstageOverlay');
    const behind  = document.getElementById('fc-editor-behind');
    if (!overlay) return;

    _backstageOpen = true;

    // Ensure backstage is flex but with panel slid off-screen
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    // The inner panel
    const panel = overlay.querySelector('.backstage-panel') || overlay.firstElementChild;
    if (panel) {
        panel.style.transition = 'none';
        panel.style.transform = 'translateX(-100%)';
        // Trigger slide-in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                panel.style.transition = 'transform 0.2s cubic-bezier(0.22,1,0.36,1)';
                panel.style.transform = 'translateX(0)';
            });
        });
    }

    // Blur/dim editor
    if (behind) {
        behind.classList.add('backstage-open');
    }
};

window.closeBackstage = function() {
    const overlay = document.getElementById('backstageOverlay');
    const behind  = document.getElementById('fc-editor-behind');
    if (!overlay) return;

    _backstageOpen = false;

    const panel = overlay.querySelector('.backstage-panel') || overlay.firstElementChild;
    if (panel) {
        panel.style.transition = 'transform 0.18s cubic-bezier(0.4,0,1,1)';
        panel.style.transform = 'translateX(-100%)';
    }

    // Restore editor
    if (behind) {
        behind.classList.remove('backstage-open');
    }

    // Hide overlay after animation
    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.add('hidden');
    }, 200);
};


/* ─────────────────────────────────────────────
   5. EDITABLE PROJECT NAME
   ───────────────────────────────────────────── */
let _projectName = localStorage.getItem('fc-project-name') || 'Untitled Project';

function initEditableProjectName() {
    const nameEl = document.getElementById('footerProjectName');
    if (!nameEl) return;

    // Set initial name
    nameEl.textContent = _projectName;

    nameEl.addEventListener('dblclick', () => {
        startEditingProjectName(nameEl);
    });
}

function startEditingProjectName(nameEl) {
    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'footerProjectNameInput';
    input.value = currentName;
    input.style.width = Math.max(100, currentName.length * 8) + 'px';

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
        const newName = input.value.trim() || 'Untitled Project';
        _projectName = newName;
        localStorage.setItem('fc-project-name', newName);

        const span = document.createElement('span');
        span.id = 'footerProjectName';
        span.className = 'font-medium text-on-surface';
        span.title = 'Double-click to rename';
        span.textContent = newName;
        input.replaceWith(span);

        // Re-attach listener
        span.addEventListener('dblclick', () => startEditingProjectName(span));

        // Update project metadata if state exists
        if (window.state) window.state.projectName = newName;
        // Update title bar if present
        const titleEl = document.getElementById('titleBarProjectName');
        if (titleEl) titleEl.textContent = newName;
    };

    const cancel = () => {
        const span = document.createElement('span');
        span.id = 'footerProjectName';
        span.className = 'font-medium text-on-surface';
        span.title = 'Double-click to rename';
        span.textContent = currentName;
        input.replaceWith(span);
        span.addEventListener('dblclick', () => startEditingProjectName(span));
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
}


/* ─────────────────────────────────────────────
   6. RESIZABLE PANELS
   ───────────────────────────────────────────── */
function initResizers() {
    const leftResizer  = document.getElementById('left-resizer');
    const rightResizer = document.getElementById('right-resizer');
    const sidebar      = document.querySelector('forgecut-sidebar');
    const exportQueue  = document.querySelector('forgecut-export-queue');
    const timeline     = document.querySelector('forgecut-timeline');

    // Timeline resizer
    let timelineResizer = document.getElementById('timeline-resizer');
    if (!timelineResizer && timeline) {
        timelineResizer = document.createElement('div');
        timelineResizer.id = 'timeline-resizer';
        timelineResizer.className = 'h-1 bg-outline-variant/30 hover:bg-primary cursor-row-resize transition-colors z-40 w-full';
        timelineResizer.style.cssText = 'position:absolute;top:0;left:0;';
        timeline.style.position = 'relative';
        timeline.prepend(timelineResizer);
    }

    // Load saved sizes
    if (sidebar)     sidebar.style.width     = localStorage.getItem('forgecut-sidebar-w')   || '320px';
    if (exportQueue) exportQueue.style.width  = localStorage.getItem('forgecut-queue-w')     || '360px';
    if (timeline)    timeline.style.height    = localStorage.getItem('forgecut-timeline-h')  || '300px';

    let isResizing = false;
    let currentResizer = null;

    const onMove = (e) => {
        if (!isResizing) return;
        if (currentResizer === 'left' && sidebar) {
            let w = Math.min(500, Math.max(200, e.clientX));
            sidebar.style.width = w + 'px';
            localStorage.setItem('forgecut-sidebar-w', w + 'px');
        } else if (currentResizer === 'right' && exportQueue) {
            let w = Math.min(600, Math.max(240, window.innerWidth - e.clientX));
            exportQueue.style.width = w + 'px';
            localStorage.setItem('forgecut-queue-w', w + 'px');
        } else if (currentResizer === 'timeline' && timeline) {
            let h = Math.min(window.innerHeight * 0.7, Math.max(150, window.innerHeight - e.clientY - 32));
            timeline.style.height = h + 'px';
            localStorage.setItem('forgecut-timeline-h', h + 'px');
        }
        if (window.recalculateCanvasDisplaySize) window.recalculateCanvasDisplaySize();
        if (window.renderCanvasComposition) window.renderCanvasComposition();
        if (window.renderTimeline) window.renderTimeline();
    };

    const onUp = () => {
        isResizing = false; currentResizer = null;
        document.body.style.cursor = 'default';
    };

    if (leftResizer) {
        leftResizer.addEventListener('mousedown', (e) => {
            isResizing = true; currentResizer = 'left';
            document.body.style.cursor = 'col-resize'; e.preventDefault();
        });
        leftResizer.addEventListener('dblclick', () => {
            if (sidebar) {
                sidebar.style.width = '320px';
                localStorage.setItem('forgecut-sidebar-w','320px');
                if (window.recalculateCanvasDisplaySize) window.recalculateCanvasDisplaySize();
                if (window.renderCanvasComposition) window.renderCanvasComposition();
                if (window.renderTimeline) window.renderTimeline();
            }
        });
    }
    if (rightResizer) {
        rightResizer.addEventListener('mousedown', (e) => {
            isResizing = true; currentResizer = 'right';
            document.body.style.cursor = 'col-resize'; e.preventDefault();
        });
        rightResizer.addEventListener('dblclick', () => {
            if (exportQueue) {
                exportQueue.style.width = '360px';
                localStorage.setItem('forgecut-queue-w','360px');
                if (window.recalculateCanvasDisplaySize) window.recalculateCanvasDisplaySize();
                if (window.renderCanvasComposition) window.renderCanvasComposition();
                if (window.renderTimeline) window.renderTimeline();
            }
        });
    }
    if (timelineResizer) {
        timelineResizer.addEventListener('mousedown', (e) => {
            isResizing = true; currentResizer = 'timeline';
            document.body.style.cursor = 'row-resize'; e.preventDefault();
        });
        timelineResizer.addEventListener('dblclick', () => {
            if (timeline) {
                timeline.style.height='300px';
                localStorage.setItem('forgecut-timeline-h','300px');
                if (window.recalculateCanvasDisplaySize) window.recalculateCanvasDisplaySize();
                if (window.renderCanvasComposition) window.renderCanvasComposition();
                if (window.renderTimeline) window.renderTimeline();
            }
        });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}


/* ─────────────────────────────────────────────
   7. CANVAS HELPERS (alignment / positioning)
   ───────────────────────────────────────────── */
window.alignText = function(clipId, align) {
    if (!window.findClipById) return;
    const clip = window.findClipById(clipId);
    if (clip) {
        clip.textAlign = align;
        if (window.renderCanvasComposition) window.renderCanvasComposition();
        if (window.saveStateToHistory) window.saveStateToHistory('Text Align');
    }
};

window.positionObject = function(clipId, posType) {
    if (!window.findClipById || !window.state || !window.state.resolution) return;
    const clip = window.findClipById(clipId);
    if (!clip) return;
    const cw = window.state.resolution.width;
    const ch = window.state.resolution.height;
    switch(posType) {
        case 'center':      clip.x = cw/2;  clip.y = ch/2;  break;
        case 'top-left':    clip.x = 0;     clip.y = 0;     break;
        case 'top-center':  clip.x = cw/2;  clip.y = 0;     break;
        case 'top-right':   clip.x = cw;    clip.y = 0;     break;
        case 'mid-left':    clip.x = 0;     clip.y = ch/2;  break;
        case 'mid-right':   clip.x = cw;    clip.y = ch/2;  break;
        case 'bot-left':    clip.x = 0;     clip.y = ch;    break;
        case 'bot-center':  clip.x = cw/2;  clip.y = ch;    break;
        case 'bot-right':   clip.x = cw;    clip.y = ch;    break;
    }
    if (window.renderCanvasComposition) window.renderCanvasComposition();
    if (window.updateInspector) window.updateInspector();
    if (window.saveStateToHistory) window.saveStateToHistory('Position Object');
};


/* ─────────────────────────────────────────────
   8. BACKSTAGE INNER PANEL SETUP
   ───────────────────────────────────────────── */
function prepareBackstagePanel() {
    const overlay = document.getElementById('backstageOverlay');
    if (!overlay) return;

    // Make overlay itself just a backdrop (no flex centering for sliding panel)
    overlay.style.padding = '0';

    // The inner div (first child) becomes the sliding panel
    const panel = overlay.firstElementChild;
    if (panel && !panel.classList.contains('backstage-panel')) {
        panel.classList.add('backstage-panel');
    }
}


/* ─────────────────────────────────────────────
   9. SPLASH SEQUENCE BOOT
   ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    // Apply theme first (before anything renders)
    initTheme();

    // Check if we should skip to welcome (dev mode)
    const skipSplash = localStorage.getItem('fc-skip-splash') === 'true';

    if (skipSplash) {
        document.getElementById('fc-splash').style.display = 'none';
        const welcome = document.getElementById('fc-welcome');
        if (welcome) {
            welcome.style.display = 'flex';
            requestAnimationFrame(() => requestAnimationFrame(() => welcome.classList.add('visible')));
        }
        populateRecentProjects();
    } else {
        // Show splash for ~1.8 seconds
        setTimeout(() => {
            hideSplashShowWelcome();
        }, 1800);
    }

    // Backstage panel prep (runs even before backstage is opened)
    setTimeout(() => {
        prepareBackstagePanel();
    }, 500);

    // Expose globals
    window.toggleDarkTheme = toggleDarkTheme;
    window.openBackstage = window.openBackstage || function() {};
    window.closeBackstage = window.closeBackstage || function() {};
    window.showHelpDialog = showHelpDialog;
    window.closeHelpDialog = closeHelpDialog;
    window.changeHelpTab = changeHelpTab;
    window.submitBugReport = submitBugReport;
    window.showAboutDialog = showAboutDialog;
    window.openHelpCenter = openHelpCenter;
});

/* ─────────────────────────────────────────────
   10. HELP CENTER MODULE
   ───────────────────────────────────────────── */
let helpDialogOverlay = null;

function getBrowserInfo() {
    const ua = navigator.userAgent;
    let tem, M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
    if (/trident/i.test(M[1])) {
        tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
        return 'IE ' + (tem[1] || '');
    }
    if (M[1] === 'Chrome') {
        tem = ua.match(/\b(OPR|Edge)\/(\d+)/);
        if (tem != null) return tem.slice(1).join(' ').replace('OPR', 'Opera');
    }
    M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
    if ((tem = ua.match(/version\/(\d+)/i)) != null) M.splice(1, 1, tem[1]);
    return M.join(' ');
}

function getGPURenderer() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return 'Software Rasterizer / WebGL disabled';
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
        return 'WebGL (Hardware Accelerated)';
    } catch (e) {
        return 'Unknown (Sandbox restriction)';
    }
}

function showHelpDialog(initialTab = 'documentation') {
    if (!helpDialogOverlay) {
        helpDialogOverlay = document.createElement('div');
        helpDialogOverlay.className = 'help-dialog-overlay';
        helpDialogOverlay.id = 'helpDialogOverlay';
        
        helpDialogOverlay.innerHTML = `
            <div class="help-dialog-card">
                <!-- Header -->
                <div class="help-dialog-header">
                    <span class="text-sm font-bold text-on-surface flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-lg">help</span>
                        <span>ForgeCut Help Center</span>
                    </span>
                    <button class="material-symbols-outlined text-on-surface-variant hover:text-on-surface cursor-pointer text-lg bg-transparent border-none" onclick="closeHelpDialog()">close</button>
                </div>
                
                <!-- Tab Navigation -->
                <div class="help-dialog-tabs">
                    <button class="help-tab-button" id="tab-btn-documentation" onclick="changeHelpTab('documentation')">Documentation</button>
                    <button class="help-tab-button" id="tab-btn-bug" onclick="changeHelpTab('bug')">Report Bug</button>
                    <button class="help-tab-button" id="tab-btn-about" onclick="changeHelpTab('about')">About</button>
                </div>
                
                <!-- Body -->
                <div class="help-dialog-body" id="helpDialogBody">
                    <!-- Tab contents will go here -->
                </div>
                
                <!-- Footer -->
                <div class="help-dialog-footer">
                    <button class="px-4 py-2 bg-surface-container-highest hover:bg-outline-variant/30 text-on-surface text-xs font-semibold rounded cursor-pointer border-none transition-colors" onclick="closeHelpDialog()">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(helpDialogOverlay);
        
        // Add click listener on backdrop to close
        helpDialogOverlay.addEventListener('mousedown', (e) => {
            if (e.target === helpDialogOverlay) {
                closeHelpDialog();
            }
        });
    }
    
    // Add active class after a microtask for transition
    helpDialogOverlay.style.display = 'flex';
    setTimeout(() => {
        helpDialogOverlay.classList.add('active');
    }, 10);
    
    changeHelpTab(initialTab);
}

function closeHelpDialog() {
    if (!helpDialogOverlay) return;
    helpDialogOverlay.classList.remove('active');
    setTimeout(() => {
        helpDialogOverlay.style.display = 'none';
    }, 250);
}

function changeHelpTab(tabName) {
    const body = document.getElementById('helpDialogBody');
    if (!body) return;
    
    // Update active tab styling
    document.querySelectorAll('.help-tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    if (tabName === 'documentation') {
        body.innerHTML = `
            <div class="flex flex-col gap-4">
                <div>
                    <h3 class="text-sm font-bold text-primary mb-1">Getting Started</h3>
                    <p class="text-xs text-on-surface-variant">ForgeCut is a professional web-based non-linear video editor (NLE). Drag and drop your video, audio, or image files onto the left media bin or directly to the timeline tracks to start editing.</p>
                </div>
                <div class="border-t border-outline-variant/30 pt-3">
                    <h3 class="text-sm font-bold text-primary mb-2">Keyboard Shortcuts</h3>
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="border-b border-outline-variant/40">
                                <th class="py-1 font-semibold text-on-surface">Action</th>
                                <th class="py-1 font-semibold text-on-surface">Shortcut</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-outline-variant/10 text-on-surface-variant">
                            <tr>
                                <td class="py-1.5">Play / Pause playback</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Space</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Split Selected Clip</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">C</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Delete Selected Clip</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Delete</kbd> / <kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Backspace</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Undo Action</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Ctrl + Z</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Redo Action</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Ctrl + Y</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Copy Selected Clip</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Ctrl + C</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">Paste Clip</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">Ctrl + V</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">1 Frame Scrub (Left/Right)</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">←</kbd> / <kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">→</kbd></td>
                            </tr>
                            <tr>
                                <td class="py-1.5">2 Seconds Scrub (Back/Forward)</td>
                                <td class="py-1.5"><kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">J</kbd> / <kbd class="bg-surface-container px-1.5 py-0.5 rounded font-mono border border-outline-variant/30">L</kbd></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } else if (tabName === 'bug') {
        body.innerHTML = `
            <form id="bugReportForm" onsubmit="submitBugReport(event)" class="flex flex-col gap-3">
                <div class="flex flex-col gap-1">
                    <label for="bugTitle" class="text-xs font-semibold text-on-surface">Bug Title</label>
                    <input type="text" id="bugTitle" required placeholder="Brief summary of the issue" class="bg-surface-container border border-outline-variant/50 rounded px-3 py-1.5 text-on-surface text-xs outline-none focus:border-primary">
                </div>
                <div class="flex flex-col gap-1">
                    <label for="bugDescription" class="text-xs font-semibold text-on-surface">Description</label>
                    <textarea id="bugDescription" required rows="4" placeholder="Steps to reproduce, expected vs actual behavior..." class="bg-surface-container border border-outline-variant/50 rounded px-3 py-1.5 text-on-surface text-xs outline-none focus:border-primary resize-none"></textarea>
                </div>
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-on-surface">Upload Screenshot</label>
                    <div class="border border-dashed border-outline-variant/50 rounded p-4 text-center cursor-pointer hover:border-primary transition-colors relative bg-surface-container">
                        <span class="material-symbols-outlined text-lg text-on-surface-variant block mb-1">upload_file</span>
                        <span class="text-xs text-on-surface-variant block" id="fileUploadName">Drag and drop file here, or click to upload</span>
                        <input type="file" id="bugScreenshot" accept="image/*" onchange="document.getElementById('fileUploadName').textContent = this.files[0] ? this.files[0].name : 'Drag and drop file here, or click to upload'" class="absolute inset-0 opacity-0 cursor-pointer">
                    </div>
                </div>
                <button type="submit" class="mt-2 py-2 bg-primary hover:bg-primary-container text-white font-bold rounded text-xs cursor-pointer border-none transition-colors">Submit Bug Report</button>
            </form>
        `;
    } else if (tabName === 'about') {
        body.innerHTML = `
            <div class="flex flex-col gap-3">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-primary flex items-center justify-center font-bold text-white text-xl">FC</div>
                    <div>
                        <h2 class="text-base font-bold text-on-surface">ForgeCut Professional NLE</h2>
                        <p class="text-xs text-outline">State-of-the-Art Web Video Editing System</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-outline-variant/30 pt-3 text-xs">
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">Version:</span>
                        <span class="font-bold text-on-surface">1.2.0-beta</span>
                    </div>
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">Build Number:</span>
                        <span class="font-mono text-on-surface">FC.2026.0715</span>
                    </div>
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">Browser:</span>
                        <span class="text-on-surface truncate max-w-[160px]" title="${navigator.userAgent}">${getBrowserInfo()}</span>
                    </div>
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">GPU/WebGL Renderer:</span>
                        <span class="text-on-surface truncate max-w-[160px]" title="${getGPURenderer()}">${getGPURenderer()}</span>
                    </div>
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">License:</span>
                        <span class="text-on-surface font-semibold">Proprietary / Commercial</span>
                    </div>
                    <div class="flex justify-between border-b border-outline-variant/10 py-1">
                        <span class="text-on-surface-variant font-medium">GitHub Repository:</span>
                        <a href="https://github.com/forgecut/forgecut-web" target="_blank" class="text-primary hover:underline font-semibold">forgecut/forgecut-web</a>
                    </div>
                </div>
                
                <div class="text-[10px] text-outline text-center mt-3">
                    Copyright &copy; 2026 ForgeCut Professional. All Rights Reserved.
                </div>
            </div>
        `;
    }
}

function submitBugReport(event) {
    event.preventDefault();
    const title = document.getElementById('bugTitle').value;
    const description = document.getElementById('bugDescription').value;
    const screenshot = document.getElementById('bugScreenshot').files[0];
    
    // Standard visual feedback notification / alert
    fcToast(`Bug Report Submitted Successfully!\nTitle: ${title}\nDescription: ${description.substring(0, 50)}...\nScreenshot: ${screenshot ? screenshot.name : 'None'}`);
    closeHelpDialog();
}

function showAboutDialog() {
    showHelpDialog('about');
}

function openHelpCenter() {
    showHelpDialog('documentation');
}
