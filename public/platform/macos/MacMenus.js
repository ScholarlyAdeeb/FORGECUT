/**
 * ForgeCut macOS — menus, popovers, sheets and context menus.
 *
 * macOS presents secondary content in popovers rather than dialogs (HIG:
 * "Popovers: preferred over sheets for secondary content"), and confirmations
 * as sheets that drop from the top of the window. This module supplies those
 * presentations and re-points the shared fcConfirm/fcPrompt helpers at them,
 * so shared business logic keeps calling the same functions and simply looks
 * native here.
 */
(function () {
    'use strict';

    const Mac = window.MacUI = window.MacUI || {};

    let openPopover = null;
    let openOwner = null;

    /* ── Symbols ──────────────────────────────────────────────────────────
       SF Symbols cannot be embedded on the web, so each command maps to the
       closest semantically equivalent Material Symbol. The mapping is kept in
       one place so the intent stays reviewable rather than scattered. */
    Mac.sym = {
        newProject: 'note_add', open: 'folder_open', save: 'save',
        importMedia: 'add_photo_alternate', importAudio: 'library_music',
        importImage: 'image', undo: 'undo', redo: 'redo',
        cut: 'content_cut', copy: 'content_copy', paste: 'content_paste',
        duplicate: 'file_copy', split: 'content_cut', trim: 'straighten',
        deleteClip: 'delete', rippleDelete: 'delete_sweep',
        play: 'play_arrow', pause: 'pause', start: 'skip_previous',
        end: 'skip_next', back: 'chevron_left', forward: 'chevron_right',
        share: 'ios_share', inspector: 'view_sidebar', sidebar: 'dock_to_right',
        text: 'title', shape: 'category', transition: 'transition_fade',
        animation: 'auto_awesome', zoomIn: 'zoom_in', zoomOut: 'zoom_out',
        fit: 'fit_screen', video: 'movie', audio: 'graphic_eq',
        image: 'photo', folder: 'folder', help: 'help',
        settings: 'settings', appearance: 'contrast', info: 'info'
    };

    Mac.icon = function (name, cls) {
        const s = document.createElement('span');
        s.className = 'material-symbols-outlined sym' + (cls ? ' ' + cls : '');
        s.setAttribute('aria-hidden', 'true');
        s.textContent = Mac.sym[name] || name;
        return s;
    };

    /* ── Popover ─────────────────────────────────────────────────────────── */

    Mac.closePopover = function () {
        if (!openPopover) return;
        openPopover.remove();
        if (openOwner) openOwner.setAttribute('aria-expanded', 'false');
        openPopover = null;
        openOwner = null;
    };

    /**
     * items: [{ label, shortcut, action, enabled, checked }] or 'separator'
     */
    Mac.popover = function (owner, items, opts) {
        opts = opts || {};
        const wasOpen = openOwner === owner;
        Mac.closePopover();
        if (wasOpen) return null;

        const pop = document.createElement('div');
        pop.className = 'mac-popover';
        pop.setAttribute('role', 'menu');

        for (const item of items) {
            if (item === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'mac-msep';
                pop.appendChild(sep);
                continue;
            }
            const b = document.createElement('button');
            b.className = 'mac-mi';
            b.setAttribute('role', 'menuitem');
            b.type = 'button';
            if (item.enabled === false) b.disabled = true;

            const nm = document.createElement('span');
            nm.className = 'nm';
            nm.textContent = (item.checked ? '✓  ' : '') + item.label;
            b.appendChild(nm);

            if (item.shortcut) {
                const k = document.createElement('span');
                k.className = 'key';
                k.textContent = item.shortcut;
                b.appendChild(k);
            }
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                Mac.closePopover();
                if (item.action) item.action();
            });
            pop.appendChild(b);
        }

        document.body.appendChild(pop);
        const r = owner.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let left = opts.alignRight ? r.right - w : r.left;
        left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
        let top = opts.atPoint ? opts.atPoint.y : r.bottom + 4;
        if (top + h > window.innerHeight - 6) top = Math.max(6, window.innerHeight - h - 6);
        if (opts.atPoint) left = Math.max(6, Math.min(opts.atPoint.x, window.innerWidth - w - 6));
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';

        openPopover = pop;
        openOwner = owner;
        owner.setAttribute && owner.setAttribute('aria-expanded', 'true');
        return pop;
    };

    /** Right-click menu anchored at the pointer. */
    Mac.contextMenu = function (event, items) {
        event.preventDefault();
        const anchor = { getBoundingClientRect: () => ({ left: event.clientX, right: event.clientX, bottom: event.clientY }) };
        Mac.popover(anchor, items, { atPoint: { x: event.clientX, y: event.clientY } });
    };

    document.addEventListener('mousedown', (e) => {
        if (openPopover && !openPopover.contains(e.target) && e.target !== openOwner) Mac.closePopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openPopover) { e.stopPropagation(); Mac.closePopover(); }
    });

    /* ── Sheet ───────────────────────────────────────────────────────────── */

    /**
     * A macOS sheet: descends from the top of the window, modal to it.
     * Returns a promise resolving to the chosen value.
     */
    Mac.sheet = function (message, opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const scrim = document.createElement('div');
            scrim.className = 'mac-sheet-scrim';

            const sheet = document.createElement('div');
            sheet.className = 'mac-sheet';
            sheet.setAttribute('role', 'dialog');
            sheet.setAttribute('aria-modal', 'true');

            if (opts.title) {
                const h = document.createElement('h2');
                h.textContent = opts.title;
                sheet.appendChild(h);
            }
            const p = document.createElement('p');
            p.textContent = message;
            sheet.appendChild(p);

            let input = null;
            if (opts.prompt) {
                input = document.createElement('input');
                input.className = 'mac-input';
                input.style.height = '24px';
                input.style.marginBottom = 'var(--s4)';
                input.value = opts.defaultValue == null ? '' : String(opts.defaultValue);
                sheet.appendChild(input);
            }

            const actions = document.createElement('div');
            actions.className = 'mac-sheet-actions';
            const cancel = document.createElement('button');
            cancel.className = 'mac-btn';
            cancel.textContent = opts.cancelLabel || 'Cancel';
            const ok = document.createElement('button');
            ok.className = 'mac-btn mac-btn-default';
            ok.textContent = opts.okLabel || 'OK';
            actions.append(cancel, ok);
            sheet.appendChild(actions);
            scrim.appendChild(sheet);
            document.body.appendChild(scrim);

            let settled = false;
            const close = (v) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                scrim.remove();
                resolve(v);
            };
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(opts.cancelValue); }
                else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(input ? input.value : true); }
            }
            document.addEventListener('keydown', onKey, true);
            cancel.addEventListener('click', () => close(opts.cancelValue));
            ok.addEventListener('click', () => close(input ? input.value : true));
            scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(opts.cancelValue); });
            (input || ok).focus();
            if (input) input.select();
        });
    };

    /**
     * Re-point the shared dialog helpers at macOS presentations. The shared
     * code keeps calling fcConfirm/fcPrompt; only what the user sees changes.
     */
    Mac.installDialogs = function () {
        window.fcConfirm = (message, o) => Mac.sheet(message, {
            okLabel: (o && o.okLabel) || 'OK',
            cancelLabel: (o && o.cancelLabel) || 'Cancel',
            cancelValue: false
        }).then(v => v === true);

        window.fcPrompt = (message, def) => Mac.sheet(message, {
            prompt: true, defaultValue: def, okLabel: 'OK', cancelValue: null
        });
    };
})();
