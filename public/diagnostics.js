/**
 * ForgeCut diagnostics — global error surfacing.
 *
 * Loaded before every other script so it catches failures during startup.
 *
 * The editor leans heavily on optional-wiring patterns (`callIfExists`,
 * `typeof fn === 'function'` guards). Those stop a missing function from
 * throwing, but they also mean a broken wire-up produces no symptom at all —
 * which is how the playback loop shipped without ever being started. Anything
 * that does throw now gets reported loudly instead of vanishing.
 */
(function () {
    'use strict';

    const MAX_LOG = 50;
    const _errors = [];

    function record(kind, detail) {
        const entry = {
            kind,
            message: detail && detail.message ? detail.message : String(detail),
            stack: detail && detail.stack ? detail.stack : null,
            at: new Date().toISOString()
        };
        _errors.push(entry);
        if (_errors.length > MAX_LOG) _errors.shift();
        console.error(`[ForgeCut:${kind}]`, entry.message, detail);
        showBanner(entry.message);
    }

    let _bannerTimer = null;
    function showBanner(message) {
        if (typeof document === 'undefined' || !document.body) return;
        let el = document.getElementById('fc-error-banner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fc-error-banner';
            el.setAttribute('role', 'alert');
            el.style.cssText = [
                'position:fixed', 'bottom:16px', 'left:50%',
                'transform:translateX(-50%)', 'z-index:99999',
                'max-width:min(640px,90vw)', 'padding:10px 14px',
                'background:#7f1d1d', 'color:#fff', 'border-radius:6px',
                'font:12px/1.5 system-ui,sans-serif', 'box-shadow:0 4px 16px rgba(0,0,0,.35)',
                'cursor:pointer', 'white-space:pre-wrap', 'word-break:break-word'
            ].join(';');
            el.title = 'Click to dismiss';
            el.addEventListener('click', () => el.remove());
            document.body.appendChild(el);
        }
        el.textContent = `Something went wrong: ${message}`;
        clearTimeout(_bannerTimer);
        _bannerTimer = setTimeout(() => el.remove(), 10000);
    }

    window.addEventListener('error', (event) => {
        // Resource load failures (bad <script src>) surface here with no error object.
        if (event.target && event.target !== window && event.target.src) {
            record('resource', { message: `Failed to load ${event.target.src}` });
            return;
        }
        record('error', event.error || { message: event.message });
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
        record('unhandledrejection', event.reason || { message: 'Unknown rejection' });
    });

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.Diagnostics = {
        getErrors: () => _errors.slice(),
        clear: () => { _errors.length = 0; },
        report: record
    };
})();
