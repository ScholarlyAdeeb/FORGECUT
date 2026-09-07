/**
 * ForgeCut non-blocking dialogs.
 *
 * window.alert/confirm/prompt freeze the whole page: the render loop stops,
 * media elements keep playing against a frozen playhead, and any in-flight
 * export or CSV parse stalls until the user clicks. These replacements are
 * async and leave the loop running.
 *
 *   ForgeCut.toast(msg, type)      -> void      (replaces alert)
 *   ForgeCut.confirm(msg, opts)    -> Promise<boolean>
 *   ForgeCut.prompt(msg, value)    -> Promise<string|null>
 */
(function () {
    'use strict';

    const TOAST_MS = 4200;

    /**
     * Add the entrance class without depending solely on requestAnimationFrame.
     * rAF does not fire while the tab is hidden, which would otherwise leave a
     * dialog stuck at opacity:0 while still blocking the UI.
     */
    function reveal(el) {
        const show = () => el.classList.add('fc-in');
        requestAnimationFrame(show);
        setTimeout(show, 50);
    }

    function injectStyles() {
        if (document.getElementById('fc-dialog-styles')) return;
        const style = document.createElement('style');
        style.id = 'fc-dialog-styles';
        style.textContent = `
        #fc-toast-stack{position:fixed;bottom:20px;right:20px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none}
        .fc-toast{pointer-events:auto;max-width:min(420px,80vw);padding:10px 14px;border-radius:8px;font:500 12px/1.5 system-ui,sans-serif;
            background:var(--inverse-surface,#2d3137);color:var(--surface,#f8f9ff);box-shadow:0 6px 20px rgba(0,0,0,.28);
            display:flex;gap:10px;align-items:flex-start;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;
            white-space:pre-wrap;word-break:break-word;cursor:pointer}
        .fc-toast.fc-in{opacity:1;transform:translateY(0)}
        .fc-toast.fc-error{background:var(--error,#ba1a1a);color:#fff}
        .fc-toast.fc-success{background:#1b5e20;color:#fff}
        .fc-modal-backdrop{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;
            opacity:0;transition:opacity .15s ease}
        .fc-modal-backdrop.fc-in{opacity:1}
        .fc-modal{background:var(--surface-container,#ebeef6);color:var(--on-surface,#181c22);border-radius:12px;padding:20px;
            width:min(460px,90vw);box-shadow:0 16px 48px rgba(0,0,0,.35);font:14px/1.55 system-ui,sans-serif;
            transform:scale(.97);transition:transform .15s ease}
        .fc-modal-backdrop.fc-in .fc-modal{transform:scale(1)}
        .fc-modal-msg{margin:0 0 14px;white-space:pre-wrap;word-break:break-word}
        .fc-modal input{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:14px;border-radius:6px;
            border:1px solid var(--outline-variant,#c0c7d4);background:var(--surface,#f8f9ff);color:var(--on-surface,#181c22);font:14px system-ui,sans-serif}
        .fc-modal-actions{display:flex;gap:8px;justify-content:flex-end}
        .fc-modal button{padding:7px 16px;border-radius:6px;border:none;cursor:pointer;font:600 13px system-ui,sans-serif}
        .fc-btn-cancel{background:var(--surface-container-highest,#e0e2ea);color:var(--on-surface,#181c22)}
        .fc-btn-ok{background:var(--primary-container,#0078d4);color:var(--on-primary-container,#fff)}
        .fc-btn-ok.fc-danger{background:var(--error,#ba1a1a);color:#fff}
        `;
        document.head.appendChild(style);
    }

    // Severity is inferred from the text when the caller does not pass one, so
    // the many converted alert() sites get sensible colouring without each
    // needing an extra argument.
    const ERROR_RE = /\b(fail(ed|s|ure)?|error|invalid|unable|cannot|can't|denied|quota|exceeded)\b/i;
    const SUCCESS_RE = /\b(success(fully)?|saved|completed|finished|restored|imported|applied)\b/i;

    function inferType(message) {
        const text = String(message);
        if (ERROR_RE.test(text)) return 'error';
        if (SUCCESS_RE.test(text)) return 'success';
        return '';
    }

    function toast(message, type) {
        injectStyles();
        if (type === undefined) type = inferType(message);
        let stack = document.getElementById('fc-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'fc-toast-stack';
            document.body.appendChild(stack);
        }
        const el = document.createElement('div');
        el.className = 'fc-toast' + (type ? ` fc-${type}` : '');
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        el.textContent = String(message);
        el.title = 'Click to dismiss';

        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            el.classList.remove('fc-in');
            setTimeout(() => el.remove(), 200);
        };
        el.addEventListener('click', remove);

        stack.appendChild(el);
        reveal(el);
        setTimeout(remove, TOAST_MS);
        return el;
    }

    /**
     * Shared modal shell. `build` populates the body and returns a function
     * producing the resolved value for the OK button.
     */
    function openModal(message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false, build = null, cancelValue = false }) {
        injectStyles();
        return new Promise((resolve) => {
            const backdrop = document.createElement('div');
            backdrop.className = 'fc-modal-backdrop';

            const modal = document.createElement('div');
            modal.className = 'fc-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            const msg = document.createElement('p');
            msg.className = 'fc-modal-msg';
            msg.textContent = String(message);
            modal.appendChild(msg);

            const getValue = build ? build(modal) : () => true;

            const actions = document.createElement('div');
            actions.className = 'fc-modal-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'fc-btn-cancel';
            cancelBtn.textContent = cancelLabel;

            const okBtn = document.createElement('button');
            okBtn.className = 'fc-btn-ok' + (danger ? ' fc-danger' : '');
            okBtn.textContent = okLabel;

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            modal.appendChild(actions);
            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);
            reveal(backdrop);

            let settled = false;
            const close = (value) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                backdrop.classList.remove('fc-in');
                setTimeout(() => backdrop.remove(), 160);
                resolve(value);
            };

            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); }
                else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(getValue()); }
            }
            // Capture phase so the editor's global keyboard shortcuts do not
            // act on keys typed while a dialog is open.
            document.addEventListener('keydown', onKey, true);

            cancelBtn.addEventListener('click', () => close(cancelValue));
            okBtn.addEventListener('click', () => close(getValue()));
            backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(cancelValue); });

            const focusTarget = modal.querySelector('input') || okBtn;
            focusTarget.focus();
            if (focusTarget.select) focusTarget.select();
        });
    }

    function confirmDialog(message, opts = {}) {
        return openModal(message, {
            okLabel: opts.okLabel || 'OK',
            cancelLabel: opts.cancelLabel || 'Cancel',
            danger: !!opts.danger,
            cancelValue: false
        });
    }

    function promptDialog(message, defaultValue = '') {
        return openModal(message, {
            okLabel: 'OK',
            cancelValue: null,
            build(modal) {
                const input = document.createElement('input');
                input.type = 'text';
                input.value = defaultValue == null ? '' : String(defaultValue);
                modal.appendChild(input);
                return () => input.value;
            }
        });
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.toast = toast;
    window.ForgeCut.confirm = confirmDialog;
    window.ForgeCut.prompt = promptDialog;
    // Exposed so ribbon features that need more than a text field (a column
    // mapper, a capture-source picker) get the same focus handling, Escape
    // trapping and styling as the built-in dialogs instead of hand-rolling one.
    window.ForgeCut.modal = openModal;

    // Short aliases for the many call sites.
    window.fcToast = toast;
    window.fcConfirm = confirmDialog;
    window.fcPrompt = promptDialog;
    window.fcModal = openModal;
})();
