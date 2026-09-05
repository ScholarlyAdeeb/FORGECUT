/**
 * ForgeCut KeyboardShortcuts — Centralized keyboard handler with context awareness.
 * Disabled when text inputs are focused.
 */
(function() {
    'use strict';

    let _enabled = true;
    let _stateRef = null;
    const _handlers = {};
    const _customBindings = {};

    function init(stateRef) {
        _stateRef = stateRef;
        document.addEventListener('keydown', handleKeyDown);
    }

    function isTextFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    function getKey(e) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');

        // Normalize key
        let key = e.key;
        if (key === ' ') key = 'Space';
        else if (key === 'ArrowLeft') key = 'Left';
        else if (key === 'ArrowRight') key = 'Right';
        else if (key === 'ArrowUp') key = 'Up';
        else if (key === 'ArrowDown') key = 'Down';
        else key = key.length === 1 ? key.toUpperCase() : key;

        parts.push(key);
        return parts.join('+');
    }

    function handleKeyDown(e) {
        if (!_enabled) return;
        if (isTextFocused()) return;

        const combo = getKey(e);

        // Check custom bindings first
        if (_customBindings[combo]) {
            e.preventDefault();
            e.stopPropagation();
            _customBindings[combo]();
            return;
        }

        // Built-in shortcuts
        switch (combo) {
            // ─── Transport ───
            case 'Space':
                e.preventDefault();
                callGlobal('togglePlay');
                break;
            case 'K':
                e.preventDefault();
                callGlobal('togglePlay');
                break;
            case 'J':
                e.preventDefault();
                adjustSpeed(-0.25);
                break;
            case 'L':
                e.preventDefault();
                adjustSpeed(0.25);
                break;
            case 'Left':
                e.preventDefault();
                if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
                    window.ForgeCut.PlaybackEngine.stepBackward();
                } else {
                    callGlobal('setTime', [(_stateRef ? _stateRef.currentTime : 0) - (1/30)]);
                }
                break;
            case 'Right':
                e.preventDefault();
                if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
                    window.ForgeCut.PlaybackEngine.stepForward();
                } else {
                    callGlobal('setTime', [(_stateRef ? _stateRef.currentTime : 0) + (1/30)]);
                }
                break;
            case 'Home':
                e.preventDefault();
                callGlobal('setTime', [0]);
                break;
            case 'End':
                e.preventDefault();
                callGlobal('setTime', [_stateRef ? _stateRef.duration : 0]);
                break;

            // ─── History ───
            case 'Ctrl+Z':
                e.preventDefault();
                callGlobal('triggerUndo');
                break;
            case 'Ctrl+Y':
            case 'Ctrl+Shift+Z':
                e.preventDefault();
                callGlobal('triggerRedo');
                break;

            // ─── Clipboard ───
            case 'Ctrl+C':
                e.preventDefault();
                callGlobal('timelineCopy');
                break;
            case 'Ctrl+V':
                e.preventDefault();
                callGlobal('timelinePaste');
                break;
            case 'Ctrl+X':
                e.preventDefault();
                callGlobal('timelineCut');
                break;
            case 'Ctrl+D':
                e.preventDefault();
                callGlobal('timelineDuplicate');
                break;
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                callGlobal('timelineDeleteSelected');
                break;

            // ─── Timeline ───
            case 'S':
                e.preventDefault();
                callGlobal('triggerSplit');
                break;
            case 'Ctrl+A':
                e.preventDefault();
                callGlobal('selectAllClips');
                break;
            case 'Escape':
                e.preventDefault();
                callGlobal('deselectAll');
                break;

            // ─── Project ───
            case 'Ctrl+N':
                e.preventDefault();
                callGlobal('triggerNewProject', ['16_9']);
                break;
            case 'Ctrl+O':
                e.preventDefault();
                callGlobal('openBackstage');
                break;
            case 'Ctrl+S':
                e.preventDefault();
                callGlobal('saveProject');
                break;
            case 'Ctrl+Shift+S':
                e.preventDefault();
                callGlobal('saveProjectAs');
                break;
            case 'Ctrl+E':
                e.preventDefault();
                callGlobal('startBulkExport');
                break;

            // ─── Zoom ───
            case 'Ctrl+=':
            case 'Ctrl++':
                e.preventDefault();
                callGlobal('adjustZoom', [5]);
                break;
            case 'Ctrl+-':
                e.preventDefault();
                callGlobal('adjustZoom', [-5]);
                break;
            case 'Ctrl+0':
                e.preventDefault();
                callGlobal('zoomFitToScreen');
                break;

            // ─── View ───
            case 'F11':
                e.preventDefault();
                callGlobal('toggleCanvasFullScreen');
                break;
        }
    }

    function callGlobal(funcName, args) {
        const fn = window[funcName];
        if (typeof fn === 'function') {
            fn.apply(null, args || []);
        }
    }

    function adjustSpeed(delta) {
        const PE = window.ForgeCut && window.ForgeCut.PlaybackEngine;
        if (PE) {
            const current = PE.getPlaybackRate();
            PE.setPlaybackRate(current + delta);
        }
    }

    function bindKey(combo, handler) {
        _customBindings[combo] = handler;
    }

    function unbindKey(combo) {
        delete _customBindings[combo];
    }

    function setEnabled(enabled) {
        _enabled = !!enabled;
    }

    function destroy() {
        document.removeEventListener('keydown', handleKeyDown);
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.KeyboardShortcuts = {
        init, destroy,
        bindKey, unbindKey,
        setEnabled,
        get enabled() { return _enabled; }
    };
})();
