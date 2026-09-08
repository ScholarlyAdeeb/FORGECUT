/**
 * ForgeCut RibbonScaler — Office-style progressive ribbon scaling, ribbon
 * display modes and the phone layout switch.
 *
 * Groups collapse into a single labelled dropdown when the window is too
 * narrow to show them all, lowest-priority (rightmost) first, exactly like
 * Word. Collapsing MOVES the group's existing content node into a popover
 * rather than cloning it, so element ids stay unique and the inline handlers
 * the ribbon is built from keep working untouched.
 */
(function () {
    'use strict';

    const PHONE_MAX = 768;
    const MODE_KEY = 'forgecut.ribbonMode';
    const QAT_KEY = 'forgecut.qatHidden';
    const MODES = { ALWAYS: 'always', TABS: 'tabs', FULLSCREEN: 'fullscreen' };

    let ribbonRow = null;
    let ribbonScroll = null;
    let openPopover = null;
    let openMenu = null;
    let reflowQueued = false;

    /* ── group discovery ────────────────────────────────────────────────── */

    // A ribbon group is a direct child of a tab container that carries a group
    // label. Detected structurally because the markup uses three different
    // class orderings for what is the same thing.
    function groupsIn(container) {
        return Array.from(container.children).filter(
            el => el.tagName === 'DIV' && el.querySelector('.font-ribbon-group-label')
        );
    }

    function prepare(group) {
        if (group._fcReady) return;
        const labelEl = group.querySelector('.font-ribbon-group-label');
        const content = Array.from(group.children).find(c => c !== labelEl);
        if (!content) return;
        const iconEl = content.querySelector('.material-symbols-outlined');
        group._fcLabel = labelEl ? labelEl.textContent.trim() : 'More';
        group._fcIcon = iconEl ? iconEl.textContent.trim() : 'more_horiz';
        group._fcContent = content;
        group._fcLabelEl = labelEl;
        group._fcCollapsed = false;
        group.classList.add('fc-ribbon-group');
        group._fcReady = true;
    }

    /* ── collapse / expand ──────────────────────────────────────────────── */

    function closePopover() {
        if (!openPopover) return;
        const { group, popover } = openPopover;
        // Put the content back where it belongs before tearing the popover down.
        if (group._fcContent && group._fcContent.parentElement === popover) {
            group._fcHost.appendChild(group._fcContent);
        }
        popover.remove();
        if (group._fcBtn) group._fcBtn.setAttribute('aria-expanded', 'false');
        openPopover = null;
    }

    function openGroupPopover(group) {
        if (openPopover && openPopover.group === group) { closePopover(); return; }
        closePopover();

        const popover = document.createElement('div');
        popover.className = 'fc-ribbon-popover';
        popover.appendChild(group._fcContent);
        document.body.appendChild(popover);

        const r = group._fcBtn.getBoundingClientRect();
        popover.style.top = `${r.bottom + 4}px`;
        // Keep the popover on screen when the group sits near the right edge.
        const width = popover.offsetWidth;
        popover.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;

        group._fcBtn.setAttribute('aria-expanded', 'true');
        openPopover = { group, popover };
    }

    function collapse(group) {
        if (group._fcCollapsed || !group._fcContent) return;
        // Park the content in a detached host so it survives while collapsed.
        if (!group._fcHost) {
            group._fcHost = document.createElement('div');
            group._fcHost.className = 'fc-ribbon-parked';
        }
        group._fcHost.appendChild(group._fcContent);

        const btn = document.createElement('button');
        btn.className = 'fc-ribbon-collapsed';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.title = group._fcLabel;
        btn.innerHTML =
            `<span class="material-symbols-outlined fc-collapsed-icon">${group._fcIcon}</span>` +
            `<span class="fc-collapsed-label">${group._fcLabel}</span>` +
            `<span class="material-symbols-outlined fc-collapsed-chevron">expand_more</span>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); openGroupPopover(group); });

        if (group._fcLabelEl) group._fcLabelEl.style.display = 'none';
        group.insertBefore(btn, group.firstChild);
        group._fcBtn = btn;
        group.classList.add('fc-collapsed');
        group._fcCollapsed = true;
    }

    function expand(group) {
        if (!group._fcCollapsed) return;
        if (openPopover && openPopover.group === group) closePopover();
        if (group._fcBtn) { group._fcBtn.remove(); group._fcBtn = null; }
        if (group._fcContent) group.insertBefore(group._fcContent, group.firstChild);
        if (group._fcLabelEl) group._fcLabelEl.style.display = '';
        group.classList.remove('fc-collapsed');
        group._fcCollapsed = false;
    }

    /* ── reflow ─────────────────────────────────────────────────────────── */

    function activeContainer() {
        return Array.from(document.querySelectorAll('.ribbon-group-container'))
            .find(c => !c.classList.contains('hidden')) || null;
    }

    function reflow() {
        reflowQueued = false;
        if (!ribbonScroll) return;
        const container = activeContainer();
        if (!container) return;

        const groups = groupsIn(container);
        groups.forEach(prepare);
        groups.forEach(expand);

        // On phones every group is collapsed: there is never room for a full
        // Office ribbon at that width, and collapsed chips scroll comfortably.
        if (window.innerWidth <= PHONE_MAX) {
            groups.forEach(collapse);
            return;
        }

        // Reading scrollWidth forces the layout we just invalidated, so each
        // pass measures the real result of the previous collapse.
        const overflowing = () => ribbonScroll.scrollWidth > ribbonScroll.clientWidth + 1;
        for (let i = groups.length - 1; i >= 0 && overflowing(); i--) {
            collapse(groups[i]);
        }
    }

    function queueReflow() {
        if (reflowQueued) return;
        reflowQueued = true;
        requestAnimationFrame(reflow);
        // rAF does not fire while the tab is hidden; this keeps the layout
        // correct if the window is resized in the background.
        setTimeout(() => { if (reflowQueued) reflow(); }, 120);
    }

    /* ── ribbon display modes ───────────────────────────────────────────── */

    function currentMode() {
        try { return localStorage.getItem(MODE_KEY) || MODES.ALWAYS; } catch (e) { return MODES.ALWAYS; }
    }
    function qatHidden() {
        try { return localStorage.getItem(QAT_KEY) === '1'; } catch (e) { return false; }
    }
    function persist(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    }

    function applyMode(mode, opts) {
        opts = opts || {};
        const root = document.documentElement;
        root.classList.remove('fc-ribbon-tabs-only', 'fc-ribbon-fullscreen');

        if (mode === MODES.TABS) root.classList.add('fc-ribbon-tabs-only');
        if (mode === MODES.FULLSCREEN) root.classList.add('fc-ribbon-fullscreen');

        persist(MODE_KEY, mode);

        if (mode === MODES.FULLSCREEN && opts.userInitiated) {
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen().catch(() => { /* denied is fine */ });
        } else if (mode !== MODES.FULLSCREEN && document.fullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => { });
        }

        queueReflow();
        window.dispatchEvent(new CustomEvent('forgecut:ribbonmode', { detail: { mode } }));
    }

    function applyQat(hidden) {
        document.documentElement.classList.toggle('fc-qat-hidden', !!hidden);
        persist(QAT_KEY, hidden ? '1' : '0');
    }

    /* ── display-options menu ───────────────────────────────────────────── */

    function closeMenu() {
        if (!openMenu) return;
        openMenu.remove();
        openMenu = null;
        const btn = document.getElementById('fcRibbonDisplayBtn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function buildMenu(anchor) {
        const mode = currentMode();
        const menu = document.createElement('div');
        menu.className = 'fc-ribbon-menu';
        menu.setAttribute('role', 'menu');

        const title = document.createElement('div');
        title.className = 'fc-ribbon-menu-title';
        title.textContent = 'Show Ribbon';
        menu.appendChild(title);

        const item = (label, checked, onClick, opts) => {
            const b = document.createElement('button');
            b.className = 'fc-ribbon-menu-item' + (opts && opts.separated ? ' fc-menu-sep' : '');
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', checked ? 'true' : 'false');
            b.innerHTML =
                `<span class="fc-menu-check material-symbols-outlined">${checked ? 'check' : ''}</span>` +
                `<span class="fc-menu-label">${label}</span>`;
            b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onClick(); });
            menu.appendChild(b);
            return b;
        };

        item('Full-screen mode', mode === MODES.FULLSCREEN,
            () => applyMode(MODES.FULLSCREEN, { userInitiated: true }));
        item('Show tabs only', mode === MODES.TABS, () => applyMode(MODES.TABS));
        item('Always show Ribbon', mode === MODES.ALWAYS, () => applyMode(MODES.ALWAYS));
        item(qatHidden() ? 'Show Quick Access Toolbar' : 'Hide Quick Access Toolbar',
            false, () => applyQat(!qatHidden()), { separated: true });

        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const w = menu.offsetWidth;
        menu.style.top = `${r.bottom + 6}px`;
        menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
        openMenu = menu;
        anchor.setAttribute('aria-expanded', 'true');
    }

    /* ── init ───────────────────────────────────────────────────────────── */

    function init() {
        ribbonRow = document.getElementById('fcRibbonRow');
        ribbonScroll = document.getElementById('fcRibbonScroll');
        if (!ribbonRow || !ribbonScroll) return false;

        // Gives "tabs only" mode a positioned ancestor to hang the peeked
        // ribbon from, without depending on :has() support.
        const header = ribbonRow.closest('header');
        if (header) header.classList.add('fc-app-header');

        const btn = document.getElementById('fcRibbonDisplayBtn');
        if (btn && !btn._fcBound) {
            btn._fcBound = true;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (openMenu) { closeMenu(); return; }
                buildMenu(btn);
            });
        }

        // In "tabs only" mode a tab click peeks the ribbon open, and the next
        // click elsewhere closes it again — the Office behaviour.
        document.querySelectorAll('.ribbon-tab-btn').forEach(tab => {
            if (tab._fcPeek) return;
            tab._fcPeek = true;
            tab.addEventListener('click', () => {
                if (currentMode() === MODES.TABS) {
                    document.documentElement.classList.add('fc-ribbon-peek');
                }
                queueReflow();
            });
        });

        document.addEventListener('click', (e) => {
            if (openMenu && !openMenu.contains(e.target)) closeMenu();
            if (openPopover && !openPopover.popover.contains(e.target) &&
                e.target !== openPopover.group._fcBtn &&
                !openPopover.group._fcBtn.contains(e.target)) closePopover();
            if (!e.target.closest || !e.target.closest('.fc-ribbon-row, .fc-ribbon-tabs')) {
                document.documentElement.classList.remove('fc-ribbon-peek');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            // Drop stale references first: if the node was torn out from
            // elsewhere, Escape would otherwise be swallowed "closing" it.
            if (openMenu && !openMenu.isConnected) openMenu = null;
            if (openPopover && !openPopover.popover.isConnected) openPopover = null;
            if (openMenu) { closeMenu(); return; }
            if (openPopover) { closePopover(); return; }
            if (document.documentElement.classList.contains('fc-ribbon-peek')) {
                document.documentElement.classList.remove('fc-ribbon-peek');
            }
        });

        // Leaving fullscreen by any route (Esc, F11, the browser UI) must put
        // the ribbon back rather than leave the app in a stripped-down state.
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && currentMode() === MODES.FULLSCREEN) {
                applyMode(MODES.ALWAYS);
            }
        });

        if (window.ResizeObserver) {
            new ResizeObserver(queueReflow).observe(ribbonRow);
        }
        window.addEventListener('resize', queueReflow);
        window.addEventListener('orientationchange', queueReflow);

        applyMode(currentMode());
        applyQat(qatHidden());
        queueReflow();
        return true;
    }

    function boot() {
        if (init()) return;
        // The header is a custom element, so it may not have upgraded yet.
        let tries = 0;
        const t = setInterval(() => {
            if (init() || ++tries > 60) clearInterval(t);
        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* ── phone drawers ──────────────────────────────────────────────────── */

    // On phones the two side panels become overlay drawers. Only one is open
    // at a time so the preview is never squeezed between them.
    window.toggleMobilePanel = function (side) {
        const root = document.documentElement;
        const cls = side === 'right' ? 'fc-panel-right' : 'fc-panel-left';
        const other = side === 'right' ? 'fc-panel-left' : 'fc-panel-right';
        root.classList.remove(other);
        root.classList.toggle(cls);
    };

    window.closeMobilePanels = function () {
        document.documentElement.classList.remove('fc-panel-left', 'fc-panel-right');
    };

    // Returning to a desktop width must not strand a drawer open.
    window.addEventListener('resize', () => {
        if (window.innerWidth > PHONE_MAX) window.closeMobilePanels();
    });

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.RibbonScaler = {
        reflow: queueReflow,
        setMode: (m) => applyMode(m, { userInitiated: true }),
        getMode: currentMode,
        setQatHidden: applyQat,
        isQatHidden: qatHidden,
        MODES
    };
})();
