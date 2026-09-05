/**
 * ForgeCut HistoryManager — Deep clone state snapshots for undo/redo.
 * Configurable max stack depth, debounced continuous operations.
 */
(function() {
    'use strict';

    const MAX_STACK_SIZE = Infinity;
    let _undoStack = [];
    let _redoStack = [];
    let _stateRef = null;
    let _restoreCallback = null;
    let _debounceTimer = null;
    const DEBOUNCE_MS = 300;

    function bindState(stateRef, restoreCallback) {
        _stateRef = stateRef;
        _restoreCallback = restoreCallback;
    }

    /**
     * Deep clone the essential state properties (exclude DOM elements, media blobs).
     */
    function cloneState(state) {
        const snapshot = {};
        // Clone tracks
        snapshot.tracks = state.tracks.map(track => ({
            id: track.id,
            type: track.type,
            name: track.name,
            locked: track.locked,
            visible: track.visible,
            clips: track.clips.map(clip => Object.assign({}, clip, {
                // Deep clone sub-objects
                shapeProps: clip.shapeProps ? Object.assign({}, clip.shapeProps, {
                    shadow: clip.shapeProps.shadow ? Object.assign({}, clip.shapeProps.shadow) : null
                }) : undefined,
                animations: clip.animations ? Object.assign({}, clip.animations) : undefined
            }))
        }));

        // Clone timeline metadata
        snapshot.currentTime = state.currentTime;
        snapshot.duration = state.duration;
        snapshot.selectedClipId = state.selectedClipId;
        snapshot.selectedTrackId = state.selectedTrackId;
        snapshot.canvasWidth = state.canvasWidth;
        snapshot.canvasHeight = state.canvasHeight;
        snapshot.backgroundColor = state.backgroundColor;
        snapshot.backgroundGradient = state.backgroundGradient;
        snapshot.backgroundType = state.backgroundType;

        return snapshot;
    }

    /**
     * Restore state from a snapshot.
     */
    function restoreSnapshot(snapshot) {
        if (!_stateRef || !snapshot) return;

        // Restore tracks
        _stateRef.tracks = snapshot.tracks.map(track => ({
            id: track.id,
            type: track.type,
            name: track.name,
            locked: track.locked,
            visible: track.visible,
            clips: track.clips.map(clip => Object.assign({}, clip, {
                shapeProps: clip.shapeProps ? Object.assign({}, clip.shapeProps, {
                    shadow: clip.shapeProps && clip.shapeProps.shadow ? Object.assign({}, clip.shapeProps.shadow) : null
                }) : undefined,
                animations: clip.animations ? Object.assign({}, clip.animations) : undefined
            }))
        }));

        _stateRef.currentTime = snapshot.currentTime;
        _stateRef.duration = snapshot.duration;
        _stateRef.selectedClipId = snapshot.selectedClipId;
        _stateRef.selectedTrackId = snapshot.selectedTrackId;

        if (snapshot.canvasWidth) _stateRef.canvasWidth = snapshot.canvasWidth;
        if (snapshot.canvasHeight) _stateRef.canvasHeight = snapshot.canvasHeight;
        if (snapshot.backgroundColor) _stateRef.backgroundColor = snapshot.backgroundColor;
        if (snapshot.backgroundGradient) _stateRef.backgroundGradient = snapshot.backgroundGradient;
        if (snapshot.backgroundType !== undefined) _stateRef.backgroundType = snapshot.backgroundType;

        if (_restoreCallback) _restoreCallback();
    }

    /**
     * Push current state onto the undo stack.
     */
    function pushState(label) {
        if (!_stateRef) return;
        const snapshot = cloneState(_stateRef);
        snapshot._label = label || 'Action';
        snapshot._timestamp = Date.now();

        _undoStack.push(snapshot);
        if (_undoStack.length > MAX_STACK_SIZE) {
            _undoStack.shift();
        }

        // Clear redo stack on new action
        _redoStack = [];
    }

    /**
     * Push state with debouncing for continuous operations (e.g., dragging).
     */
    function pushStateDebounced(label) {
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            pushState(label);
            _debounceTimer = null;
        }, DEBOUNCE_MS);
    }

    /**
     * Undo: pop from undo stack, push current to redo.
     */
    function undo() {
        if (_undoStack.length === 0 || !_stateRef) return false;

        // Save current state to redo
        const current = cloneState(_stateRef);
        current._label = 'Redo Point';
        _redoStack.push(current);

        // Restore from undo
        const snapshot = _undoStack.pop();
        restoreSnapshot(snapshot);
        return true;
    }

    /**
     * Redo: pop from redo stack, push current to undo.
     */
    function redo() {
        if (_redoStack.length === 0 || !_stateRef) return false;

        // Save current state to undo
        const current = cloneState(_stateRef);
        current._label = 'Undo Point';
        _undoStack.push(current);

        // Restore from redo
        const snapshot = _redoStack.pop();
        restoreSnapshot(snapshot);
        return true;
    }

    function canUndo() { return _undoStack.length > 0; }
    function canRedo() { return _redoStack.length > 0; }

    function clearHistory() {
        _undoStack = [];
        _redoStack = [];
    }

    function getUndoLabel() {
        return _undoStack.length > 0 ? _undoStack[_undoStack.length - 1]._label : null;
    }

    function getRedoLabel() {
        return _redoStack.length > 0 ? _redoStack[_redoStack.length - 1]._label : null;
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.HistoryManager = {
        bindState,
        pushState, pushStateDebounced,
        undo, redo,
        canUndo, canRedo,
        clearHistory,
        getUndoLabel, getRedoLabel,
        get undoCount() { return _undoStack.length; },
        get redoCount() { return _redoStack.length; }
    };
})();
