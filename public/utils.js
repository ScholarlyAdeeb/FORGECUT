/**
 * ForgeCut shared utilities.
 * Loaded early so every component can rely on these.
 */
(function () {
    'use strict';

    const HTML_ESCAPES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    /**
     * Escape a value for interpolation into an HTML string, including into
     * single- or double-quoted attribute values.
     *
     * Use this for anything derived from a user's CSV, filenames, or project
     * names. Prefer building DOM nodes and setting textContent where practical —
     * this exists for the template-literal call sites that would be invasive to
     * rewrite.
     */
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.escapeHtml = escapeHtml;
    // Short alias for the many template-literal call sites.
    window.esc = escapeHtml;
})();
