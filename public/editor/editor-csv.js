/**
 * ForgeCut editor — CSV placeholders, row selector and batch gallery
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    function renderPlaceholders() {
        const container = document.getElementById('csvPlaceholdersContainer');
        if (!container) return;
        container.innerHTML = '';
        state.placeholders.forEach(ph => {
            const tag = document.createElement('span');
            tag.className = 'label-tag';
            tag.style.cursor = 'pointer';
            // Built as DOM nodes rather than an interpolated inline handler:
            // placeholder names come from CSV column headers, and a header
            // containing a quote used to break out of the onclick attribute and
            // run as script.
            const label = document.createElement('span');
            label.textContent = `{{${ph}}}`;
            label.addEventListener('click', () => window.handleLabelTagClick(ph));

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (event) => window.removePlaceholder(event, ph));

            tag.appendChild(label);
            tag.appendChild(removeBtn);
            container.appendChild(tag);
        });
    }

    window.removePlaceholder = function (event, ph) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        state.placeholders = state.placeholders.filter(p => p !== ph);
        renderPlaceholders();
        renderCanvasComposition();
    };

    window.handleLabelTagClick = function (ph) {
        const labelTextMask = document.getElementById('labelTextMask');
        if (labelTextMask) {
            labelTextMask.value = ph;
        }
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                const track = state.tracks.find(t => t.clips.includes(clip));
                if (track && track.type === 'text') {
                    clip.text = `{{${ph}}}`;
                    clip.name = ph;
                    renderTimeline();
                    updateInspector();
                }
            }
        }
    };

    function addNewTextClipWithPlaceholder(ph) {
        const track = state.tracks.find(t => t.id === 'textTrack');
        const newClip = {
            id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: ph,
            text: `{{${ph}}}`,
            startTime: state.currentTime,
            duration: 5.0,
            x: canvas.width / 2,
            y: canvas.height * 0.75,
            font: 'Arial',
            size: 72,
            color: '#ffffff',
            rotation: 0,
            opacity: 1.0
        };
        track.clips.push(newClip);
        renderTimeline();
        selectClip(newClip.id);
    }

    function renderRowSelector() {
        if (!rowSelectorList) return;
        rowSelectorList.innerHTML = '';
        if (state.csvData.length === 0) {
            rowSelectorList.innerHTML = `<div class="text-center py-4 text-xs text-on-surface-variant/50">Upload CSV to display rows</div>`;
            const wrapper = document.getElementById('csvRowFieldsWrapper');
            if (wrapper) wrapper.classList.add('hidden');
            return;
        }

        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = `row-item ${idx === state.selectedRowIndex ? 'active' : ''}`;
            item.onclick = () => selectRow(idx);

            const keys = Object.keys(row);
            const val1 = row[keys[0]] || '';
            const val2 = keys[1] ? row[keys[1]] || '' : '';
            const displayText = val2 ? `${val1} (${val2})` : val1;

            // textContent, not innerHTML: these values come straight from the
            // user's CSV and must never be parsed as markup.
            const valueEl = document.createElement('span');
            valueEl.className = 'row-text-val';
            valueEl.textContent = displayText || `Row ${idx + 1}`;

            const badgeEl = document.createElement('span');
            badgeEl.className = 'badge-id';
            badgeEl.textContent = `#${idx + 1}`;

            item.appendChild(valueEl);
            item.appendChild(badgeEl);
            rowSelectorList.appendChild(item);
        });

        const wrapper = document.getElementById('csvRowFieldsWrapper');
        if (wrapper) wrapper.classList.remove('hidden');
        updateCsvRowFieldsEditor();
    }

    function selectRow(rowIndex) {
        state.selectedRowIndex = rowIndex;
        renderRowSelector();
        renderQueueList();
        renderCanvasComposition();
    }

    function updateCsvRowFieldsEditor() {
        const container = document.getElementById('csvRowFieldsContainer');
        if (!container) return;
        container.innerHTML = '';

        const activeRow = state.csvData[state.selectedRowIndex];
        if (!activeRow) return;

        Object.keys(activeRow).forEach(key => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'control-group';
            fieldGroup.style.marginBottom = '0.5rem';

            const label = document.createElement('label');
            label.textContent = key;
            label.style.fontSize = '0.7rem';
            label.style.color = 'var(--text-secondary)';
            label.style.display = 'block';
            label.style.marginBottom = '0.2rem';

            const input = document.createElement('input');
            input.type = 'text';
            input.value = activeRow[key] || '';
            input.style.width = '100%';
            input.style.padding = '0.35rem 0.5rem';
            input.style.fontSize = '0.75rem';
            input.style.borderRadius = '4px';
            input.style.border = '1px solid var(--border)';
            input.style.background = 'var(--bg-surface)';
            input.style.color = 'var(--text-primary)';
            input.style.outline = 'none';

            input.addEventListener('input', (e) => {
                activeRow[key] = e.target.value;
                renderCanvasComposition();

                const keys = Object.keys(activeRow);
                if (key === keys[0] || key === keys[1]) {
                    const activeItemText = rowSelectorList.querySelector(`.row-item.active .row-text-val`);
                    if (activeItemText) {
                        const val1 = activeRow[keys[0]] || '';
                        const val2 = keys[1] ? activeRow[keys[1]] || '' : '';
                        activeItemText.textContent = val2 ? `${val1} (${val2})` : val1;
                    }
                }
                renderQueueList();
            });

            fieldGroup.appendChild(label);
            fieldGroup.appendChild(input);
            container.appendChild(fieldGroup);
        });
    }

    function getRowThumbnailDataUrl(rowIndex) {
        const origIndex = state.selectedRowIndex;
        state.selectedRowIndex = rowIndex;
        renderCanvasComposition();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        state.selectedRowIndex = origIndex;
        renderCanvasComposition();
        return dataUrl;
    }

    async function renderBatchGalleryGrid() {
        const grid = document.getElementById('batchGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (!state.batchSelection) {
            state.batchSelection = state.csvData.map(() => true);
        }
        if (state.batchSelection.length !== state.csvData.length) {
            state.batchSelection = state.csvData.map((_, i) => state.batchSelection[i] !== undefined ? state.batchSelection[i] : true);
        }

        state.csvData.forEach((row, idx) => {
            const card = document.createElement('div');
            card.className = 'batch-card';
            card.dataset.index = idx;

            const imgUrl = getRowThumbnailDataUrl(idx);
            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;
            const subtitleVal = keys[1] ? row[keys[1]] || '' : '';
            const titleText = `${idx + 1} - ${nameVal}`;

            card.innerHTML = `
            <div class="batch-card-top-controls">
                <input type="checkbox" class="batch-card-checkbox" ${state.batchSelection[idx] ? 'checked' : ''} onchange="toggleBatchSelection(${idx}, this.checked)">
                <button class="batch-card-menu-btn" onclick="deleteBatchVariation(event, ${idx})">&times;</button>
            </div>
            <div class="batch-card-preview">
                <img src="${imgUrl}" style="width:100%; height:100%; object-fit:contain;">
                <div class="batch-card-overlay">
                    <button class="batch-card-play-btn" onclick="playBatchVariation(event, ${idx})" title="Preview in Monitor">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
            </div>
            <div class="batch-card-info">
                <span class="batch-card-title" title="${esc(titleText)}">${esc(titleText)}</span>
                ${subtitleVal ? `<span class="batch-card-tag">${subtitleVal}</span>` : ''}
            </div>
        `;
            grid.appendChild(card);
        });

        const addCard = document.createElement('div');
        addCard.className = 'batch-card add-card';
        addCard.onclick = addNewBatchVariation;
        addCard.innerHTML = `
        <div class="add-card-content">
            <div class="add-card-icon">+</div>
            <span style="font-size:0.75rem;">Add variation</span>
        </div>
    `;
        grid.appendChild(addCard);
    }

    window.toggleBatchSelection = function (idx, isChecked) {
        state.batchSelection[idx] = isChecked;
        renderQueueList();
    };

    window.deleteBatchVariation = function (event, idx) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        state.csvData.splice(idx, 1);
        state.batchSelection.splice(idx, 1);
        if (state.selectedRowIndex >= state.csvData.length) {
            state.selectedRowIndex = Math.max(0, state.csvData.length - 1);
        }
        renderRowSelector();
        renderQueueList();
        if (document.getElementById('batchGalleryOverlay').style.display !== 'none') {
            renderBatchGalleryGrid();
        }
    };

    window.playBatchVariation = function (event, idx) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        selectRow(idx);
        const overlay = document.getElementById('batchGalleryOverlay');
        if (overlay) overlay.style.display = 'none';
        play();
    };

    window.addNewBatchVariation = function () {
        const newRow = {};
        state.placeholders.forEach(ph => {
            newRow[ph] = `New ${ph}`;
        });
        state.csvData.push(newRow);
        if (state.batchSelection) {
            state.batchSelection.push(true);
        }
        renderRowSelector();
        renderQueueList();
        if (document.getElementById('batchGalleryOverlay').style.display !== 'none') {
            renderBatchGalleryGrid();
        }
    };

    async function exportSelectedVariations() {
        if (!window.ForgeCut || !window.ForgeCut.ExportEngine) {
            console.error('[Editor] ExportEngine not loaded');
            return;
        }
        pause();
        await window.ForgeCut.ExportEngine.exportBatch(state, renderCanvasComposition, {
            canvas: canvas,
            fps: 30
        });
    }

    window.startBulkExport = async function () {
        if (state.csvData.length === 0) {
            fcToast('Please upload a populated CSV file first!');
            return;
        }
        pause();
        const overlay = document.getElementById('batchGalleryOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
        await renderBatchGalleryGrid();

        if (window.ForgeCut && window.ForgeCut.ExportEngine) {
            await window.ForgeCut.ExportEngine.exportBatch(state, renderCanvasComposition, {
                canvas: canvas,
                fps: 30
            });
        }
    };
