/**
 * ForgeCut editor — Project/track operations, export queue and undo history
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    window.newProject = function () {
        state.tracks.forEach(track => track.clips = []);
        state.selectedClipId = null;
        state.csvData = [];
        state.batchSelection = [];
        renderTimeline();
        renderRowSelector();
        renderQueueList();
        renderCanvasComposition();
    };

    // openProject / saveProject / saveProjectAs used to be defined here as
    // toast-only mocks. Nothing called them, and editor-lifecycle.js — which
    // loads later — defines the real saveProject (it serialises the project)
    // and aliases saveProjectAs to it. The mocks only survived by losing the
    // load-order race; reordering the scripts would have swapped real project
    // saving for a toast that claims success. Removed.

    window.addNewTrack = function (type) {
        const trackId = `${type}Track_${Date.now()}`;
        state.tracks.push({
            id: trackId,
            type: type,
            name: `${type.toUpperCase()} Track`,
            clips: []
        });
        // Dynamically insert track markup
        const tracksContainer = document.getElementById('tracksContainer');
        const newTrackDiv = document.createElement('div');
        newTrackDiv.className = 'timeline-track';
        newTrackDiv.id = trackId;
        newTrackDiv.innerHTML = `
        <div class="track-header">
            <span>${type.toUpperCase()} Track</span>
            <div class="track-icons">
                <span class="track-lock-icon" onclick="toggleTrackLock('${trackId}')">lock_open</span>
                <span class="track-eye-icon" onclick="toggleTrackVisibility('${trackId}')">visibility</span>
            </div>
        </div>
        <div class="track-content" id="${trackId}Content"></div>
    `;
        tracksContainer.appendChild(newTrackDiv);
        state.trackVisibility[trackId] = true;
        state.trackLock[trackId] = false;
        renderTimeline();
    };

    window.insertShape = function (shapeType) {
        let track = state.tracks.find(t => t.id === 'shapeTrack');
        if (!track) {
            track = { id: 'shapeTrack', type: 'shape', name: 'Shapes Track 1', clips: [] };
            state.tracks.push(track);
            state.trackVisibility['shapeTrack'] = true;
            state.trackLock['shapeTrack'] = false;
        }
        const newClip = window.ForgeCut.ShapeRenderer.createShapeClip(shapeType, canvas.width, canvas.height, state.currentTime);
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };

    window.insertSymbol = function (symbolType) {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const today = new Date().toLocaleDateString();
        const newClip = {
            id: `clip_${Date.now()}`,
            name: symbolType,
            text: symbolType === 'DateTime' ? today : 'Page 1',
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * 0.9,
            font: 'Arial',
            size: 48,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    };

    window.toggleTrackLock = function (trackId) {
        state.trackLock[trackId] = !state.trackLock[trackId];
        const el = document.querySelector(`#${trackId} .track-lock-icon`);
        if (el) {
            el.textContent = state.trackLock[trackId] ? 'lock' : 'lock_open';
            el.classList.toggle('text-primary', state.trackLock[trackId]);
        }
    };

    window.toggleTrackVisibility = function (trackId) {
        state.trackVisibility[trackId] = !state.trackVisibility[trackId];
        const el = document.querySelector(`#${trackId} .track-eye-icon`);
        if (el) {
            el.textContent = state.trackVisibility[trackId] ? 'visibility' : 'visibility_off';
            el.classList.toggle('text-primary', !state.trackVisibility[trackId]);
        }
        renderCanvasComposition();
    };

    window.setAspectRatio = function (w, h) {
        state.canvasPanX = 0;
        state.canvasPanY = 0;
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) wrapper.style.transform = '';

        if (w === 16 && h === 9) {
            canvas.width = 1920;
            canvas.height = 1080;
        } else if (w === 9 && h === 16) {
            canvas.width = 1080;
            canvas.height = 1920;
        } else if (w === 1 && h === 1) {
            canvas.width = 1080;
            canvas.height = 1080;
        } else if (w === 4 && h === 3) {
            canvas.width = 1440;
            canvas.height = 1080;
        } else if (w === 3 && h === 4) {
            canvas.width = 1080;
            canvas.height = 1440;
        } else if (w === 21 && h === 9) {
            canvas.width = 2560;
            canvas.height = 1080;
        } else {
            // Custom resolution support
            if (w >= h) {
                canvas.height = 1080;
                canvas.width = Math.round(1080 * (w / h));
            } else {
                canvas.width = 1080;
                canvas.height = Math.round(1080 * (h / w));
            }
        }

        const resLabel = document.getElementById('footerResolution');
        if (resLabel) resLabel.textContent = `${canvas.width}x${canvas.height}`;

        recalculateCanvasDisplaySize();
        renderCanvasComposition();
    };

    function renderQueueList() {
        const queueList = document.getElementById('queueList');
        if (!queueList) return;
        queueList.innerHTML = '';

        if (state.csvData.length === 0) {
            queueList.innerHTML = `<div class="empty-msg text-xs text-on-surface-variant/50 text-center py-8">Export queue is currently empty</div>`;
            const selCount = document.getElementById('queueSelectedCount');
            if (selCount) selCount.textContent = '0';
            const totCount = document.getElementById('queueTotalCount');
            if (totCount) totCount.textContent = '0';
            return;
        }

        if (!state.batchSelection) {
            state.batchSelection = state.csvData.map(() => true);
        }
        if (state.batchSelection.length !== state.csvData.length) {
            state.batchSelection = state.csvData.map((_, i) => state.batchSelection[i] !== undefined ? state.batchSelection[i] : true);
        }

        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = `file-item ${idx === state.selectedRowIndex ? 'active' : ''}`;

            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;

            item.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem; flex:1;">
                <input type="checkbox" class="queue-item-checkbox" ${state.batchSelection[idx] ? 'checked' : ''} onchange="toggleQueueSelection(${idx}, this.checked)">
                <span style="font-size:0.75rem; cursor:pointer;" onclick="selectRow(${idx})">${idx + 1} - ${esc(nameVal)}</span>
            </div>
            <div style="display:flex; gap:0.25rem;">
                <button onclick="selectRow(${idx})" style="padding:0.1rem 0.3rem; font-size:0.7rem; cursor:pointer; background:none; border:none; color:inherit;">👁️</button>
                <button onclick="deleteBatchVariation(null, ${idx})" style="color:var(--red); padding:0.1rem 0.3rem; font-size:0.7rem; cursor:pointer; background:none; border:none;">&times;</button>
            </div>
        `;
            queueList.appendChild(item);
        });

        const selectedCount = state.batchSelection.filter(Boolean).length;
        const selCountEl = document.getElementById('queueSelectedCount');
        if (selCountEl) selCountEl.textContent = selectedCount;
        const totCountEl = document.getElementById('queueTotalCount');
        if (totCountEl) totCountEl.textContent = state.csvData.length;
    }

    window.toggleQueueSelection = function (idx, isChecked) {
        state.batchSelection[idx] = isChecked;
        const selectedCount = state.batchSelection.filter(Boolean).length;
        const selCountEl = document.getElementById('queueSelectedCount');
        if (selCountEl) selCountEl.textContent = selectedCount;

        const cardCheckbox = document.querySelector(`.batch-card[data-index="${idx}"] .batch-card-checkbox`);
        if (cardCheckbox) {
            cardCheckbox.checked = isChecked;
        }
    };

    window.renderQueueList = renderQueueList;
    window.exportSelectedVariations = exportSelectedVariations;

    // Real Undo / Redo history system using HistoryManager
    if (window.ForgeCut && window.ForgeCut.HistoryManager) {
        window.ForgeCut.HistoryManager.bindState(state, () => {
            renderTimeline();
            updateInspector();
            renderCanvasComposition();
            syncMediaPlayback();
        });
    }

    function saveStateToHistory(label) {
        state.isDirty = true;
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.pushState(label || 'Action');
        }
    }

    window.saveStateToHistory = saveStateToHistory;

    window.triggerUndo = function () {
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.undo();
        }
    };

    window.triggerRedo = function () {
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.redo();
        }
    };
