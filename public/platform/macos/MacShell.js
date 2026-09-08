/**
 * ForgeCut macOS — application shell.
 *
 * Assembles the menu bar, toolbar, sidebar, transport, status bar and the
 * appearance/shortcut handling, and boots the shared editor.
 *
 * Every command here delegates to the SHARED command layer (triggerUndo,
 * timelineCopy, setTransition, handleAssetUpload, startBulkExport, ...). This
 * layer owns presentation only — it defines no editing behaviour of its own.
 */
(function () {
    'use strict';

    const Mac = window.MacUI = window.MacUI || {};
    const APPEARANCE_KEY = 'forgecut.macos.appearance';

    const call = (name, ...args) => {
        const fn = window[name];
        if (typeof fn === 'function') return fn(...args);
        console.warn('[macOS] shared command unavailable:', name);
    };
    const hasSelection = () => !!(window.state && window.state.selectedClipId);

    /* ── Appearance ─────────────────────────────────────────────────────── */
    function systemPrefersDark() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    function currentAppearance() {
        try { return localStorage.getItem(APPEARANCE_KEY) || 'auto'; } catch (e) { return 'auto'; }
    }
    function applyAppearance(mode) {
        const dark = mode === 'dark' || (mode === 'auto' && systemPrefersDark());
        document.documentElement.classList.toggle('mac-dark', dark);
        try { localStorage.setItem(APPEARANCE_KEY, mode); } catch (e) { /* private mode */ }
        // The composition repaints against the new surface colours.
        if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
    }

    /* ── Toolbar ────────────────────────────────────────────────────────── */
    function tb(symbol, caption, title, action, opts) {
        opts = opts || {};
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mac-tb' + (opts.primary ? ' mac-tb-primary' : '');
        b.title = title;
        b.setAttribute('aria-label', title);
        b.appendChild(Mac.icon(symbol));
        if (caption) {
            const c = document.createElement('span');
            c.className = 'cap';
            c.textContent = caption;
            b.appendChild(c);
        }
        b.addEventListener('click', (e) => action(e, b));
        return b;
    }

    function buildToolbar() {
        const host = document.getElementById('macToolbar');
        host.replaceChildren();
        const group = () => {
            const g = document.createElement('div');
            g.className = 'mac-toolbar-group';
            host.appendChild(g);
            return g;
        };

        const g1 = group();
        g1.append(
            tb('importMedia', 'Import', 'Import Media (⌘I)', () => call('openImportPicker')),
            tb('undo', 'Undo', 'Undo (⌘Z)', () => { call('triggerUndo'); refreshAll(); }),
            tb('redo', 'Redo', 'Redo (⇧⌘Z)', () => { call('triggerRedo'); refreshAll(); })
        );

        const g2 = group();
        g2.append(
            tb('split', 'Split', 'Split at Playhead (S)', () => { call('triggerSplit'); refreshAll(); }),
            tb('trim', 'Trim', 'Trim to Playhead', () => { call('triggerTrim'); refreshAll(); }),
            tb('duplicate', 'Duplicate', 'Duplicate (⌘D)', () => { call('timelineDuplicate'); refreshAll(); }),
            tb('deleteClip', 'Delete', 'Delete Selected (⌫)', () => { call('timelineDeleteSelected'); refreshAll(); })
        );

        const g3 = group();
        g3.append(
            tb('text', 'Text', 'Add Text', () => { call('addNewTextClip', 'Heading'); refreshAll(); }),
            tb('shape', 'Shape', 'Add Shape', (e, btn) => {
                Mac.popover(btn, ['Rectangle', 'Circle', 'Line', 'Arrow', 'Callout'].map(s => ({
                    label: s, action: () => { call('insertShape', s); refreshAll(); }
                })));
            })
        );

        const spacer = document.createElement('div');
        spacer.className = 'mac-toolbar-spacer';
        host.appendChild(spacer);

        const g4 = group();
        const sidebarBtn = tb('sidebar', 'Sidebar', 'Hide or Show Sidebar (⌥⌘S)', () => toggleSidebar());
        const inspBtn = tb('inspector', 'Inspector', 'Hide or Show Inspector (⌥⌘I)', () => toggleInspector());
        g4.append(sidebarBtn, inspBtn);
        Mac._sidebarBtn = sidebarBtn;
        Mac._inspBtn = inspBtn;

        const g5 = group();
        g5.append(tb('share', 'Share', 'Export project (⌘E)', () => { call('startBulkExport'); }, { primary: true }));
        syncToggleButtons();
    }

    /* ── Menu bar ───────────────────────────────────────────────────────── */
    function buildMenuBar() {
        const bar = document.getElementById('macMenubar');
        [...bar.querySelectorAll('.mac-menu-title')].forEach(n => n.remove());

        const menus = {
            File: () => [
                { label: 'New Project', shortcut: '⌘N', action: () => call('triggerNewProject', '16_9') },
                { label: 'Open…', shortcut: '⌘O', action: () => call('triggerOpenProject') },
                'separator',
                { label: 'Import Media…', shortcut: '⌘I', action: () => call('openImportPicker') },
                'separator',
                { label: 'Save Project', shortcut: '⌘S', action: () => call('saveProject') },
                { label: 'Export…', shortcut: '⌘E', action: () => call('startBulkExport') }
            ],
            Edit: () => [
                { label: 'Undo', shortcut: '⌘Z', action: () => { call('triggerUndo'); refreshAll(); } },
                { label: 'Redo', shortcut: '⇧⌘Z', action: () => { call('triggerRedo'); refreshAll(); } },
                'separator',
                { label: 'Cut', shortcut: '⌘X', enabled: hasSelection(), action: () => { call('timelineCut'); refreshAll(); } },
                { label: 'Copy', shortcut: '⌘C', enabled: hasSelection(), action: () => call('timelineCopy') },
                { label: 'Paste', shortcut: '⌘V', action: () => { call('timelinePaste'); refreshAll(); } },
                { label: 'Duplicate', shortcut: '⌘D', enabled: hasSelection(), action: () => { call('timelineDuplicate'); refreshAll(); } },
                'separator',
                { label: 'Delete', shortcut: '⌫', enabled: hasSelection(), action: () => { call('timelineDeleteSelected'); refreshAll(); } }
            ],
            View: () => [
                { label: 'Show Sidebar', checked: !document.getElementById('macBody').classList.contains('no-sidebar'), shortcut: '⌥⌘S', action: toggleSidebar },
                { label: 'Show Inspector', checked: !document.getElementById('macBody').classList.contains('no-inspector'), shortcut: '⌥⌘I', action: toggleInspector },
                'separator',
                { label: 'Zoom In Timeline', shortcut: '⌘+', action: () => Mac.timeline.setZoom(Mac.timeline.getZoom() * 1.25) },
                { label: 'Zoom Out Timeline', shortcut: '⌘−', action: () => Mac.timeline.setZoom(Mac.timeline.getZoom() * 0.8) },
                'separator',
                { label: 'Appearance: Light', checked: currentAppearance() === 'light', action: () => applyAppearance('light') },
                { label: 'Appearance: Dark', checked: currentAppearance() === 'dark', action: () => applyAppearance('dark') },
                { label: 'Appearance: Automatic', checked: currentAppearance() === 'auto', action: () => applyAppearance('auto') }
            ],
            Clip: () => [
                { label: 'Split at Playhead', shortcut: 'S', enabled: hasSelection(), action: () => { call('triggerSplit'); refreshAll(); } },
                { label: 'Trim to Playhead', enabled: hasSelection(), action: () => { call('triggerTrim'); refreshAll(); } },
                { label: 'Ripple Delete', enabled: hasSelection(), action: () => { call('timelineRippleDelete'); refreshAll(); } },
                'separator',
                { label: 'Centre on Canvas', enabled: hasSelection(), action: () => { window.positionObject && positionObject(state.selectedClipId, 'center'); refreshAll(); } }
            ],
            Help: () => [
                { label: 'ForgeCut Help', shortcut: '⌘?', action: () => call('openHelpCenter') },
                { label: 'Keyboard Shortcuts', action: showShortcuts },
                'separator',
                { label: 'About ForgeCut', action: () => call('showAboutDialog') }
            ]
        };

        Object.keys(menus).forEach(name => {
            const b = document.createElement('button');
            b.className = 'mac-menu-title';
            b.type = 'button';
            b.textContent = name;
            b.setAttribute('aria-haspopup', 'true');
            b.setAttribute('aria-expanded', 'false');
            b.addEventListener('click', () => Mac.popover(b, menus[name]()));
            // macOS menu bars track the pointer once a menu is open.
            b.addEventListener('mouseenter', () => {
                if (bar.querySelector('.mac-menu-title[aria-expanded="true"]')) Mac.popover(b, menus[name]());
            });
            bar.appendChild(b);
        });
    }

    function showShortcuts() {
        Mac.sheet(
            'Undo ⌘Z · Redo ⇧⌘Z · Cut ⌘X · Copy ⌘C · Paste ⌘V · Duplicate ⌘D\n' +
            'Split S · Delete ⌫ · Play/Pause Space\n' +
            'Import ⌘I · Save ⌘S · New ⌘N · Open ⌘O · Export ⌘E\n' +
            'Sidebar ⌥⌘S · Inspector ⌥⌘I · Zoom timeline ⌘+ / ⌘−',
            { title: 'Keyboard Shortcuts', okLabel: 'Done', cancelLabel: 'Close' }
        );
    }

    /* ── Panels ─────────────────────────────────────────────────────────── */
    function syncToggleButtons() {
        const body = document.getElementById('macBody');
        if (Mac._sidebarBtn) Mac._sidebarBtn.classList.toggle('is-on', !body.classList.contains('no-sidebar'));
        if (Mac._inspBtn) Mac._inspBtn.classList.toggle('is-on', !body.classList.contains('no-inspector'));
    }
    function toggleSidebar() {
        document.getElementById('macBody').classList.toggle('no-sidebar');
        syncToggleButtons();
        Mac.timeline.invalidate(true);
    }
    function toggleInspector() {
        document.getElementById('macBody').classList.toggle('no-inspector');
        syncToggleButtons();
        Mac.timeline.invalidate(true);
    }

    /* ── Sidebar ────────────────────────────────────────────────────────── */
    function assetKind(a) {
        return a.type === 'audio' ? 'audio' : a.type === 'image' ? 'image' : 'video';
    }

    Mac.renderSidebar = function () {
        const host = document.getElementById('macSidebar');
        if (!host) return;
        host.replaceChildren();

        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        const assets = ME ? ME.getAllAssets().filter(a => a.type !== 'font') : [];

        const section = (title, key, rows) => {
            const wrap = document.createElement('div');
            wrap.className = 'mac-sb-section';
            const head = document.createElement('button');
            head.className = 'mac-sb-header';
            head.type = 'button';
            head.setAttribute('aria-expanded', 'true');
            const tw = Mac.icon('expand_more', 'tw');
            head.append(tw, document.createTextNode(title));
            const list = document.createElement('ul');
            list.className = 'mac-sb-list';
            head.addEventListener('click', () => {
                const open = head.getAttribute('aria-expanded') === 'true';
                head.setAttribute('aria-expanded', open ? 'false' : 'true');
                list.style.display = open ? 'none' : '';
            });
            rows(list);
            wrap.append(head, list);
            host.appendChild(wrap);
        };

        section('Media', 'media', (list) => {
            if (!assets.length) {
                const li = document.createElement('li');
                li.className = 'mac-sb-empty';
                li.textContent = 'No media yet. Use Import (⌘I).';
                list.appendChild(li);
                return;
            }
            for (const a of assets) {
                const li = document.createElement('li');
                li.className = 'mac-sb-row';
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                li.draggable = true;
                li.title = a.name;
                li.append(Mac.icon(assetKind(a)));
                const nm = document.createElement('span');
                nm.className = 'nm';
                nm.textContent = a.name;
                const sub = document.createElement('span');
                sub.className = 'sub';
                sub.textContent = a.duration ? a.duration.toFixed(1) + 's' : '';
                li.append(nm, sub);

                li.addEventListener('dragstart', (e) => {
                    Mac.dragAsset = a.id;
                    li.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', a.id);
                });
                li.addEventListener('dragend', () => { li.classList.remove('dragging'); Mac.dragAsset = null; });
                li.addEventListener('contextmenu', (e) => Mac.contextMenu(e, [
                    { label: 'Add to Timeline', action: () => Mac.dropAssetOnTrack(a.id, defaultTrackFor(a), state.currentTime) },
                    'separator',
                    { label: 'Remove from Project', action: () => { window.removeUploadedAsset && removeUploadedAsset(a.id, a.type); refreshAll(); } }
                ]));
                li.addEventListener('dblclick', () => Mac.dropAssetOnTrack(a.id, defaultTrackFor(a), state.currentTime));
                list.appendChild(li);
            }
        });

        section('Tracks', 'tracks', (list) => {
            for (const t of (window.state && state.tracks) || []) {
                const li = document.createElement('li');
                li.className = 'mac-sb-row';
                li.append(Mac.icon(t.type === 'audio' ? 'audio' : t.type === 'text' ? 'text' : 'video'));
                const nm = document.createElement('span');
                nm.className = 'nm';
                nm.textContent = t.name || t.id;
                const sub = document.createElement('span');
                sub.className = 'sub';
                sub.textContent = String((t.clips || []).length);
                li.append(nm, sub);
                list.appendChild(li);
            }
        });
    };

    function defaultTrackFor(asset) {
        const s = window.state;
        const id = asset.type === 'audio' ? 'audioTrack' : asset.type === 'image' ? 'videoTrack2' : 'videoTrack';
        return s.tracks.find(t => t.id === id) || s.tracks[0];
    }

    /**
     * Place an existing library asset onto a track at a time. Uses the same
     * clip shape the shared command layer creates.
     */
    Mac.dropAssetOnTrack = function (assetId, track, at) {
        const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
        const asset = ME && ME.getAsset(assetId);
        if (!asset || !track) return;
        if (typeof saveStateToHistory === 'function') saveStateToHistory('Add Clip');

        const clip = {
            id: 'clip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            assetId: asset.id,
            name: asset.name,
            startTime: Math.max(0, at || 0),
            duration: Math.max(0.1, asset.duration || 5),
            trimStart: 0
        };
        if (track.type === 'audio') {
            Object.assign(clip, { volume: 1.0, fadeIn: 0, fadeOut: 0 });
        } else {
            Object.assign(clip, {
                x: (window.canvas ? canvas.width : 1920) / 2,
                y: (window.canvas ? canvas.height : 1080) / 2,
                scale: 1.0, rotation: 0, opacity: 1.0
            });
        }
        track.clips.push(clip);
        if (window.state.duration < clip.startTime + clip.duration) {
            window.state.duration = clip.startTime + clip.duration;
        }
        if (typeof selectClip === 'function') selectClip(clip.id);
        if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
        refreshAll();
    };

    /* ── Import ─────────────────────────────────────────────────────────── */
    // Presentation only: chooses the file, then hands it to the shared
    // handleAssetUpload pipeline exactly as the Windows layer does.
    window.openImportPicker = function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*,audio/*,image/*';
        input.multiple = true;
        input.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                const type = file.type.startsWith('audio') ? 'audio'
                    : file.type.startsWith('image') ? 'image' : 'video';
                if (typeof handleAssetUpload === 'function') await handleAssetUpload(file, type);
            }
            refreshAll();
        });
        input.click();
    };

    window.triggerOpenProject = function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            if (window.loadProjectFile) window.loadProjectFile(e);
            else if (window.welcomeOpenProject) window.welcomeOpenProject(e);
            refreshAll();
        });
        input.click();
    };

    /* ── Transport ──────────────────────────────────────────────────────── */
    function buildTransport() {
        const host = document.getElementById('macTransport');
        host.replaceChildren();
        const mk = (sym, title, action, cls) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mac-tp' + (cls ? ' ' + cls : '');
            b.title = title;
            b.setAttribute('aria-label', title);
            b.appendChild(Mac.icon(sym));
            b.addEventListener('click', action);
            return b;
        };
        const time = document.createElement('span');
        time.className = 'mac-timecode';
        time.id = 'macTimecode';
        time.textContent = '0:00.00';

        const playBtn = mk('play', 'Play or Pause (Space)', () => call('togglePlay'), 'mac-tp-play');
        Mac._playBtn = playBtn;

        host.append(
            mk('start', 'Go to Start (Home)', () => call('setTime', 0)),
            mk('back', 'Step Back', () => call('setTime', Math.max(0, state.currentTime - 1 / 30))),
            playBtn,
            mk('forward', 'Step Forward', () => call('setTime', Math.min(state.duration, state.currentTime + 1 / 30))),
            mk('end', 'Go to End (End)', () => call('setTime', state.duration)),
            time
        );

        // The shared engine reports transport changes; macOS paints its own icon.
        window.addEventListener('forgecut:transport', (e) => {
            const icon = e.detail && e.detail.icon;
            const sym = playBtn.querySelector('.sym');
            if (sym && icon) sym.textContent = icon === 'pause' ? Mac.sym.pause : Mac.sym.play;
        });
    }

    /* ── Status bar ─────────────────────────────────────────────────────── */
    function buildStatus() {
        const host = document.getElementById('macStatus');
        host.replaceChildren();
        const mk = (id, label) => {
            const s = document.createElement('span');
            s.innerHTML = '';
            s.append(document.createTextNode(label + ' '));
            const b = document.createElement('b');
            b.id = id;
            s.appendChild(b);
            return s;
        };
        const grow = document.createElement('span');
        grow.className = 'grow';
        host.append(mk('macStatusRes', 'Resolution'), mk('macStatusDur', 'Duration'),
            mk('macStatusClips', 'Clips'), grow, mk('macStatusZoom', 'Zoom'));
    }

    function refreshStatus() {
        const s = window.state;
        if (!s) return;
        const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
        set('macStatusRes', window.canvas ? `${canvas.width}×${canvas.height}` : '—');
        set('macStatusDur', (s.duration || 0).toFixed(2) + 's');
        set('macStatusClips', String((s.tracks || []).reduce((n, t) => n + (t.clips || []).length, 0)));
        set('macStatusZoom', Math.round(Mac.timeline.getZoom()) + ' px/s');
        const tc = document.getElementById('macTimecode');
        if (tc) {
            const t = s.currentTime || 0;
            tc.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`;
        }
    }

    function refreshAll() {
        Mac.timeline.invalidate(true);
        Mac.renderSidebar();
        Mac.renderInspector();
        refreshStatus();
    }
    Mac.refreshAll = refreshAll;

    /* ── Keyboard ───────────────────────────────────────────────────────────
       The shared KeyboardShortcuts engine already owns Space, S, Delete,
       Home/End and the whole Ctrl+ set — and it normalises metaKey to Ctrl,
       so ⌘Z / ⌘C / ⌘V / ⌘X / ⌘D / ⌘N / ⌘O / ⌘S / ⌘E / ⌘+ / ⌘− already reach
       the right commands on a Mac. Re-binding them here would run every one
       of them twice (two undos per ⌘Z).

       So this layer registers ONLY the chords the shared engine does not
       cover, and otherwise lets the shared command architecture do its job. */
    function installShortcuts() {
        // Capture phase: the shared handler listens on window during bubble,
        // so capturing here lets macOS claim a chord the shared layer maps
        // differently (⇧⌘Z, ⌘S) by stopping propagation for that key only.
        document.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const cmd = e.metaKey || e.ctrlKey;
            const key = e.key.toLowerCase();
            const claim = () => { e.preventDefault(); e.stopPropagation(); };

            // Split — the shared layer leaves bare S unbound.
            if (!cmd && key === 's') { claim(); call('triggerSplit'); refreshAll(); return; }
            if (!cmd) return;

            if (e.altKey && key === 'i') { claim(); toggleInspector(); }
            else if (e.altKey && key === 's') { claim(); toggleSidebar(); }
            // ⇧⌘Z is redo on macOS. The shared handler does not test shiftKey,
            // so without claiming it here ⇧⌘Z would undo instead.
            else if (e.shiftKey && key === 'z') { claim(); call('triggerRedo'); refreshAll(); }
            else if (key === 'i') { claim(); call('openImportPicker'); }
            // The shared ⌘S only raises a toast; macOS saves for real.
            else if (key === 's') { claim(); call('saveProject'); }
            else if (key === 'x') { claim(); call('timelineCut'); refreshAll(); }
            else if (key === 'd') { claim(); call('timelineDuplicate'); refreshAll(); }
            else if (key === 'e') { claim(); call('startBulkExport'); }
        }, true);

        // The shared engine's zoom commands drive state.zoom; mirror that onto
        // the macOS timeline rather than owning a second zoom implementation.
        let lastZoom = window.state ? state.zoom : null;
        setInterval(() => {
            if (!window.state) return;
            if (state.zoom !== lastZoom) {
                lastZoom = state.zoom;
                Mac.timeline.setZoom(state.zoom);
                refreshStatus();
            }
        }, 200);

        // Commands invoked by keyboard mutate shared state; the macOS surfaces
        // need to repaint. One coalesced refresh rather than a hook per key.
        document.addEventListener('keydown', () => {
            clearTimeout(installShortcuts._t);
            installShortcuts._t = setTimeout(refreshAll, 90);
        });
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */
    function boot() {
        applyAppearance(currentAppearance());
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (currentAppearance() === 'auto') applyAppearance('auto');
            });
        }

        Mac.installDialogs();
        buildMenuBar();
        buildToolbar();
        buildTransport();
        buildStatus();
        installShortcuts();

        // Start the shared editor against this shell's canvas.
        if (window.ForgeCut && typeof window.ForgeCut.initEditor === 'function') {
            window.ForgeCut.initEditor();
        }

        Mac.timeline.mount();
        refreshAll();

        // Import through the shared pipeline must refresh macOS surfaces.
        ['mediaFileInput', 'audioFileInput', 'imageFileInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => setTimeout(refreshAll, 400));
        });

        // Drop files straight onto the window, as Mac users expect.
        const stage = document.getElementById('macPreview');
        ['dragover', 'drop'].forEach(evt => {
            stage.addEventListener(evt, async (e) => {
                if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
                e.preventDefault();
                if (evt !== 'drop') return;
                for (const file of e.dataTransfer.files) {
                    const type = file.type.startsWith('audio') ? 'audio'
                        : file.type.startsWith('image') ? 'image' : 'video';
                    if (typeof handleAssetUpload === 'function') await handleAssetUpload(file, type);
                }
                refreshAll();
            });
        });

        // Playhead and timecode follow the shared clock without rebuilding
        // the timeline: one cheap style write plus a text node per frame.
        let lastTime = -1;
        (function tick() {
            requestAnimationFrame(tick);
            if (!window.state) return;
            if (state.currentTime !== lastTime) {
                lastTime = state.currentTime;
                Mac.timeline.tickPlayhead();
                refreshStatus();
            }
        })();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
