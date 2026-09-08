/**
 * ForgeCut editor — Project lifecycle, background, theme, safe zones, bulk CSV
 *
 * Split out of the original editor.js. These files are plain classic
 * scripts sharing one global scope and MUST be loaded in the order listed
 * in index.html; the concatenation is byte-identical to the original file.
 */
    // Production-Grade Lifecycle & State Purging
    window.triggerNewProject = async function (ratio) {
        if (!(await fcConfirm('Start a new project? All unsaved tracks and cached assets will be purged.', { okLabel: 'Discard and start new', danger: true }))) return;

        // Purge cached files and references. MediaEngine owns the object URLs
        // and media elements; clearing only assetCache used to strand its
        // library for the rest of the session.
        if (window.ForgeCut && window.ForgeCut.MediaEngine) {
            window.ForgeCut.MediaEngine.clearAll();
        } else {
            assetCache.forEach(asset => {
                if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
            });
        }
        assetCache.clear();
        if (window.ForgeCut && window.ForgeCut.PlaybackEngine) {
            window.ForgeCut.PlaybackEngine.clearPool();
        }

        // Reset state vectors
        state.duration = 30;
        state.currentTime = 0;
        state.isPlaying = false;
        state.selectedClipId = null;
        state.csvData = [];
        state.placeholders = ['name', 'class'];
        state.selectedRowIndex = 0;
        state.batchSelection = [];
        state.tracks.forEach(track => {
            track.clips = [];
        });

        // Clean history trees
        if (window.ForgeCut && window.ForgeCut.HistoryManager) {
            window.ForgeCut.HistoryManager.clearHistory();
        }

        // Clear catalog DOM elements
        const grid = document.getElementById('catalog-media-grid');
        if (grid) grid.innerHTML = '';
        const list = document.getElementById('catalog-audio-list');
        if (list) list.innerHTML = '';
        const queueList = document.getElementById('rowSelectorList');
        if (queueList) queueList.innerHTML = '';

        // Reset aspect ratio
        if (ratio === '16_9') {
            window.setAspectRatio(16, 9);
        } else if (ratio === '9_16') {
            window.setAspectRatio(9, 16);
        } else {
            window.setAspectRatio(16, 9);
        }

        // Update interfaces
        setTime(0);
        renderTimeline();
        updateInspector();
        renderCanvasComposition();
        closeBackstage();
        // Clear autosave so restored session won't overwrite new project
        localStorage.removeItem('forgecut_autosave');
        // Reset project name
        window._isResettingProject = true;
        state.projectName = 'Untitled Project';
        const nameEl = document.getElementById('footerProjectName');
        if (nameEl) nameEl.textContent = 'Untitled Project';
        setTimeout(() => { window._isResettingProject = false; }, 500);
        fcToast('Clean project workspace initialized.');
    };

    window.saveProject = function () {
        const projectData = {
            version: "1.0",
            timestamp: new Date().toISOString(),
            duration: state.duration,
            currentTime: state.currentTime,
            zoom: state.zoom,
            tracks: state.tracks,
            bgType: state.bgType,
            bgColor: state.bgColor,
            bgGradientStart: state.bgGradientStart,
            bgGradientEnd: state.bgGradientEnd,
            bgImageUrl: state.bgImageUrl,
            safeZoneConfig: state.safeZoneConfig,
            safeAreaPlatform: state.safeAreaPlatform
        };
        const jsonStr = JSON.stringify(projectData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ForgeCut_Project_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        fcToast('Project saved successfully.');
    };

    window.saveProjectAs = window.saveProject;

    window.triggerOpenProject = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.tracks) {
                    state.tracks = data.tracks;
                    state.duration = data.duration || 30;
                    state.currentTime = data.currentTime || 0;
                    state.zoom = data.zoom || 20;
                    renderTimeline();
                    updateInspector();
                    renderCanvasComposition();
                    closeBackstage();
                    fcToast('Project configuration loaded successfully.');
                }
            } catch (err) {
                fcToast('Failed to parse project file.');
            }
        };
        reader.readAsText(file);
    };

    // Canvas Custom Design Background Types
    window.changeBackgroundType = async function (type) {
        state.bgType = type;
        if (type === 'solid') {
            state.bgColor = (await fcPrompt('Enter Solid Hex Color Code (e.g. #005faa):', state.bgColor || '#005faa')) || '#005faa';
        } else if (type === 'gradient') {
            state.bgGradientStart = (await fcPrompt('Gradient Start Hex Color Code:', state.bgGradientStart || '#005faa')) || '#005faa';
            state.bgGradientEnd = (await fcPrompt('Gradient End Hex Color Code:', state.bgGradientEnd || '#dee0e2')) || '#dee0e2';
        } else if (type === 'image') {
            state.bgImageUrl = (await fcPrompt('Enter Background Image URL:', state.bgImageUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080')) || '';
        }
        renderCanvasComposition();
    };

    window.applyThemePreset = function (preset) {
        state.bgType = 'solid';
        if (preset === 'default') {
            state.bgColor = '#0f172a';
        } else if (preset === 'classic') {
            state.bgColor = '#1e293b';
        } else if (preset === 'modern') {
            state.bgColor = '#020617';
        }
        renderCanvasComposition();
        fcToast(`Applied theme preset: ${preset}`);
    };

    window.applyBrandKit = function () {
        state.bgType = 'solid';
        state.bgColor = '#005faa';
        renderCanvasComposition();
        fcToast('Applied brand kit settings.');
    };

    /**
     * Brand Kit imports. These three buttons only announced themselves before.
     *
     * Fonts go through MediaEngine's font path, which already loads a FontFace
     * and registers it — it simply had no UI entry point anywhere in the app
     * until now. Logos are imported as ordinary image assets, so they land on
     * the timeline and can be positioned like any other overlay rather than
     * needing a separate watermark subsystem.
     */
    window.uploadBrandAsset = async function (type) {
        if (type === 'colors') {
            const hex = await fcPrompt('Brand colour (hex), applied as the canvas background:', state.bgColor || '#005faa');
            if (!hex) return;
            const value = hex.trim();
            if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
                fcToast(`"${value}" is not a valid hex colour.`, 'error');
                return;
            }
            state.brandColor = value;
            state.bgType = 'solid';
            state.bgColor = value;
            renderCanvasComposition();
            fcToast(`Brand colour set to ${value}.`);
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'font' ? '.ttf,.otf,.woff,.woff2,font/*' : 'image/*';
        input.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            if (type === 'font') {
                const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
                if (!ME) return;
                const result = await ME.loadFont(file);
                if (!result.loaded) {
                    fcToast(`Could not load font: ${file.name}`, 'error');
                    return;
                }
                state.brandFont = result.fontName;
                // Offer the freshly loaded family to the inspector's font picker.
                document.querySelectorAll('select#textFontSelect, select[id*="ontSelect"]').forEach(selectEl => {
                    if (Array.from(selectEl.options).some(o => o.value === result.fontName)) return;
                    const opt = document.createElement('option');
                    opt.value = result.fontName;
                    opt.textContent = result.fontName;
                    selectEl.appendChild(opt);
                });
                updateInspector();
                fcToast(`Brand font "${result.fontName}" loaded and available to text clips.`);
                return;
            }

            // Logo: reuse the media import pipeline so it becomes a real asset.
            if (typeof handleAssetUpload === 'function') {
                await handleAssetUpload(file, 'image');
                state.brandLogoName = file.name;
                fcToast(`Brand logo "${file.name}" imported onto the timeline.`);
            }
        });
        input.click();
    };

    // Safe Guide platform overlays
    window.selectSafeZonePlatform = function (platform) {
        state.safeAreaPlatform = platform;
        const label = document.getElementById('safeAreaLabelText');
        if (label) label.textContent = `${platform} Safe Area`;
        renderCanvasComposition();
    };

    window.toggleSafeAreaGuide = function () {
        state.showSafeAreaGuide = !state.showSafeAreaGuide;
        renderCanvasComposition();
    };

    window.toggleSafeZoneItem = function (zone, bool) {
        if (!state.safeZoneConfig) state.safeZoneConfig = { title: true, action: true, caption: true, danger: true };
        state.safeZoneConfig[zone] = bool;
        renderCanvasComposition();
    };

    // Transitions preview & controls
    window.playTransitionPreview = function () {
        if (!state.selectedClipId) {
            fcToast('Please select a clip to preview its transition.');
            return;
        }
        const clip = findClipById(state.selectedClipId);
        if (clip) {
            setTime(Math.max(0, clip.startTime - 1));
            play();
            setTimeout(() => {
                pause();
            }, 3000);
        }
    };

    window.applyTransitionToSelected = function () {
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                const durationInput = document.getElementById('transitionDurationInput');
                clip.transitionDuration = parseFloat(durationInput.value) || 1.5;
                fcToast(`Applied transition settings to selected clip.`);
            }
        } else {
            fcToast('Please select a clip first.');
        }
    };

    window.applyTransitionToAll = function () {
        const durationInput = document.getElementById('transitionDurationInput');
        const dur = parseFloat(durationInput.value) || 1.5;
        state.tracks.forEach(track => {
            track.clips.forEach(clip => {
                clip.transitionDuration = dur;
            });
        });
        fcToast('Applied transition settings to all clips in timeline.');
    };

    window.applyTransitionSound = function (sound) {
        if (state.selectedClipId) {
            const clip = findClipById(state.selectedClipId);
            if (clip) {
                clip.transitionSound = sound;
                console.log(`Transition sound set to ${sound} on selected clip.`);
            }
        }
    };

    // Animations drawer & configurations
    /**
     * The animation controls live in the Inspector's Animation section, not in
     * the Export Queue — this used to open the queue tab while claiming to have
     * opened an animation list, so the button appeared to do nothing relevant.
     */
    window.toggleAnimationPane = function () {
        const inspectorTab = document.querySelector('[data-right-tab="inspector"]');
        if (inspectorTab) inspectorTab.click();

        if (!state.selectedClipId) {
            fcToast('Select a clip to edit its animations in the Inspector.');
            return;
        }
        updateInspector();
        // Expand the Animation section and bring it into view.
        const section = document.querySelector('[data-section="animation"]')
            || document.getElementById('inspector-section-animation');
        if (section) {
            section.classList.remove('hidden');
            const header = section.previousElementSibling;
            if (header && section.classList.contains('collapsed')) header.click();
            section.scrollIntoView({ block: 'nearest' });
        }
        fcToast('Animation controls are in the Inspector.');
    };

    window.updateAnimationParameters = function () {
        if (!state.selectedClipId) return;
        const clip = findClipById(state.selectedClipId);
        if (clip) {
            const delayVal = document.getElementById('animationDelayInput').value;
            const durVal = document.getElementById('animationDurationInput').value;
            if (!clip.animations) clip.animations = {};
            clip.animations.delay = parseFloat(delayVal) || 0;
            clip.animations.duration = parseFloat(durVal) || 0.5;

            // Sync to inspector fields if visible
            const delaySlider = document.getElementById('insp_anim_delay');
            if (delaySlider) delaySlider.value = clip.animations.delay;
            const durSlider = document.getElementById('insp_anim_duration');
            if (durSlider) durSlider.value = clip.animations.duration;

            renderTimeline();
            renderCanvasComposition();
        }
    };

    window.changeClipAnimation = function (clipId, phase, value) {
        const clip = findClipById(clipId);
        if (clip) {
            if (!clip.animations) {
                clip.animations = { duration: 0.5, delay: 0, easing: 'easeInOut' };
            }
            clip.animations[phase] = value;
            renderTimeline();
            renderCanvasComposition();
        }
    };

    window.changeClipAnimationParam = function (clipId, param, value) {
        const clip = findClipById(clipId);
        if (clip) {
            if (!clip.animations) {
                clip.animations = { duration: 0.5, delay: 0, easing: 'easeInOut' };
            }
            clip.animations[param] = parseFloat(value) || 0;

            const el = document.getElementById(`insp_anim_${param}`);
            if (el) {
                const label = el.previousElementSibling;
                if (label) {
                    const span = label.querySelector('span:last-child');
                    if (span) span.textContent = `${parseFloat(value).toFixed(1)}s`;
                }
            }

            if (param === 'delay') {
                const delayInput = document.getElementById('animationDelayInput');
                if (delayInput) delayInput.value = `${parseFloat(value).toFixed(2)}s`;
            } else if (param === 'duration') {
                const durationInput = document.getElementById('animationDurationInput');
                if (durationInput) durationInput.value = `${parseFloat(value).toFixed(2)}s`;
            }

            renderTimeline();
            renderCanvasComposition();
        }
    };

    // App layouts & theme modes
    window.setAppTheme = function (theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        fcToast(`Theme set to ${theme}`);
    };

    window.toggleViewElement = function (element, visible) {
        if (element === 'grid') {
            state.showGridlines = visible;
        } else if (element === 'guides') {
            state.showGuides = visible;
        } else if (element === 'layers') {
            const listContainer = document.getElementById('timelineTrackHeadersContainer');
            if (listContainer) {
                if (visible) listContainer.classList.remove('hidden');
                else listContainer.classList.add('hidden');
            }
        }
        renderCanvasComposition();
    };

    window.zoomFitToScreen = function () {
        const container = document.getElementById('timelineContainer');
        const containerW = container ? container.clientWidth - 24 : 800;
        state.zoom = Math.max(5, Math.min(100, Math.round(containerW / (state.duration || 30))));
        const label = document.getElementById('footerZoomLabel');
        if (label) label.textContent = `${state.zoom}%`;
        const slider = document.getElementById('footerZoomSlider');
        if (slider) slider.value = state.zoom;
        renderTimeline();
    };

    // Bulk Production & CSV dynamic configuration
    /**
     * Map CSV columns onto text clips.
     *
     * Previously this only listed the placeholder names in a toast, so there
     * was no way to actually map anything from the ribbon. The underlying
     * primitives already existed (handleLabelTagClick binds a column to the
     * selected text clip, addNewTextClipWithPlaceholder creates one), so this
     * is a real surface over them rather than a new mechanism.
     */
    window.openColumnMapper = function () {
        if (!state.csvData || state.csvData.length === 0) {
            fcToast('Import a CSV configuration first.');
            return;
        }
        // Take the columns from state.placeholders: that is the canonical list
        // the CSV parser derives from the header row (trimmed, blanks dropped)
        // and the one removePlaceholder edits. Reading Object.keys() off a
        // parsed row instead kept the header's original padding, so a file
        // written as "name , title" produced {{name }} — a placeholder the
        // renderer substitutes nothing for — and deleted columns lingered here.
        const columns = (state.placeholders && state.placeholders.length)
            ? state.placeholders.slice()
            : Object.keys(state.csvData[0] || {}).map(k => k.trim()).filter(Boolean);
        if (columns.length === 0) {
            fcToast('That CSV has no columns to map.');
            return;
        }

        const textTrack = state.tracks.find(t => t.id === 'textTrack');
        const usedIn = (col) => (textTrack ? textTrack.clips : [])
            .filter(c => typeof c.text === 'string' && c.text.indexOf(`{{${col}}}`) !== -1).length;

        const selected = state.selectedClipId ? findClipById(state.selectedClipId) : null;
        const selectedIsText = !!(selected && textTrack && textTrack.clips.includes(selected));

        window.fcModal('Map CSV columns to text clips', {
            okLabel: 'Done',
            cancelLabel: 'Close',
            cancelValue: null,
            build(modal) {
                const hint = document.createElement('div');
                hint.style.cssText = 'margin:-6px 0 12px;font-size:12px;opacity:.75';
                hint.textContent = selectedIsText
                    ? `Bind applies to the selected text clip "${selected.name || selected.text}".`
                    : 'No text clip selected — use "New clip" to create one per column.';
                modal.appendChild(hint);

                const list = document.createElement('div');
                list.style.cssText = 'max-height:46vh;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:14px';

                columns.forEach(col => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface,#f8f9ff)';

                    const name = document.createElement('span');
                    // min-width:0 lets a long header ellipsise instead of
                    // stretching the row past the dialog's edge.
                    name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px';
                    name.textContent = `{{${col}}}`;
                    name.title = col;

                    const count = document.createElement('span');
                    count.style.cssText = 'font-size:11px;opacity:.7;min-width:58px;text-align:right';
                    const n = usedIn(col);
                    count.textContent = n ? `${n} clip${n > 1 ? 's' : ''}` : 'unused';

                    const mkBtn = (label, onClick) => {
                        const b = document.createElement('button');
                        b.textContent = label;
                        b.style.cssText = 'padding:4px 10px;font:600 11px system-ui,sans-serif;border-radius:5px;border:none;cursor:pointer;background:var(--surface-container-highest,#e0e2ea);color:inherit';
                        b.addEventListener('click', (ev) => { ev.preventDefault(); onClick(); });
                        return b;
                    };

                    const bindBtn = mkBtn('Bind', () => {
                        window.handleLabelTagClick(col);
                        count.textContent = `${usedIn(col)} clip(s)`;
                        fcToast(`Bound {{${col}}} to the selected clip.`);
                    });
                    bindBtn.disabled = !selectedIsText;
                    if (!selectedIsText) bindBtn.style.opacity = '.45';

                    const newBtn = mkBtn('New clip', () => {
                        if (state.placeholders.indexOf(col) === -1) state.placeholders.push(col);
                        window.addNewTextClipWithPlaceholder(col);
                        count.textContent = `${usedIn(col)} clip(s)`;
                        fcToast(`Added a text clip for {{${col}}}.`);
                    });

                    row.append(name, count, bindBtn, newBtn);
                    list.appendChild(row);
                });

                modal.appendChild(list);
                return () => true;
            }
        });
    };

    window.validateCsvMapping = function () {
        if (state.csvData.length === 0) {
            fcToast('Please import a CSV configuration first.');
            return;
        }
        fcToast(`CSV mapping validation: Success! ${state.csvData.length} records parsed successfully.`);
    };

    window.generateSampleVariation = function () {
        if (state.csvData.length === 0) {
            fcToast('Please import a CSV configuration first.');
            return;
        }
        state.selectedRowIndex = Math.floor(Math.random() * state.csvData.length);
        renderCanvasComposition();
        fcToast(`Generated variation preview for Row Index: ${state.selectedRowIndex + 1}`);
    };

    window.openBatchGalleryOverlay = function () {
        window.openBulkDrawer();
    };

    window.closeBatchGalleryOverlay = function () {
        window.closeBulkDrawer();
    };

    function renderBatchGalleryGrid() {
        const grid = document.getElementById('batchGalleryGridList');
        if (!grid) return;
        grid.innerHTML = '';

        if (state.csvData.length === 0) {
            grid.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-outline gap-2">
                <span class="material-symbols-outlined text-4xl">video_library</span>
                <span class="text-xs font-semibold">No batch variations generated yet. Upload a CSV to begin.</span>
            </div>
        `;
            return;
        }

        const container = document.createElement('div');
        container.className = 'grid grid-cols-3 gap-6';
        state.csvData.forEach((row, idx) => {
            const item = document.createElement('div');
            item.className = 'p-3 bg-surface border border-outline-variant/30 rounded-xl flex flex-col gap-3';
            const keys = Object.keys(row);
            const nameVal = row[keys[0]] || `Row ${idx + 1}`;
            item.innerHTML = `
            <div class="aspect-video bg-black rounded-lg flex items-center justify-center relative overflow-hidden">
                <span class="material-symbols-outlined text-white/40 text-4xl">video_library</span>
                <span class="absolute bottom-2 left-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded font-bold">Variation #${idx + 1}</span>
            </div>
            <div class="flex flex-col gap-1">
                <span class="text-xs font-bold text-on-surface truncate">${esc(nameVal)}</span>
                <span class="text-[10px] text-outline truncate">${esc(keys.map(k => `${k}: ${row[k]}`).join(' | '))}</span>
            </div>
        `;
            container.appendChild(item);
        });
        grid.appendChild(container);

        const progressLabel = document.getElementById('batchGalleryRenderedProgressLabel');
        if (progressLabel) {
            progressLabel.textContent = `Rendered: ${state.csvData.length} / ${state.csvData.length} variations`;
        }
    }

    let batchExportTimeout = null;
    // This deliberately shadows the startBulkExport defined in editor-csv.js,
    // which drives the older batch-gallery overlay. That overlay is dead — its
    // renderer looks up #batchGalleryGrid while the markup declares
    // #batchGalleryGridList — so the bulk drawer is the live UI and wins by
    // load order (index.html loads editor-csv.js before this file).
    //
    // The override is now only a UI choice: startBatchGenerate renders through
    // ForgeCut.ExportEngine, the same engine editor-csv.js would have used.
    // Do not "fix" this by deleting it without first reviving that overlay.
    window.startBulkExport = function () {
        window.openBulkDrawer();
        return window.startBatchGenerate(true);
    };

    window.cancelBatchExport = function () {
        window.cancelBatchQueue();
    };

    window.retryFailedBatchJobs = function () {
        window.retryFailedBatch();
    };

    window.downloadAllRenderedBatchOutputs = function () {
        window.exportAllBatch();
    };

