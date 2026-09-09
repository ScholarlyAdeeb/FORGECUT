class ForgeCutBulkDrawer extends HTMLElement {
    connectedCallback() {
        this.className = 'help-dialog-overlay'; // Reusing similar overlay modal behaviour for backdrop if needed, but we will override
        this.id = 'bulkDrawerOverlay';
        this.style.cssText = `
            position: absolute;
            bottom: 32px;
            left: 0;
            right: 0;
            height: 0px;
            background: #111318;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 100;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: height 200ms cubic-bezier(0.1, 0.9, 0.2, 1);
            box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
        `;

        this.innerHTML = `
            <!-- Header & Dashboard Stats -->
            <div class="h-[75px] bg-[#18181c] border-b border-outline-variant/30 flex items-center justify-between px-6 shrink-0 select-none">
                <!-- Left: CPU/GPU & Details -->
                <div class="flex items-center gap-6">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-xl" style="font-variation-settings: 'FILL' 1;">widgets</span>
                        <span class="font-bold text-sm text-white">Bulk Production Dashboard</span>
                    </div>
                    <div class="h-6 w-px bg-outline-variant/30"></div>
                    <!-- Stats Grid -->
                    <div class="flex items-center gap-4 text-xs">
                        <div class="flex items-center gap-1.5"><span class="text-outline">Total:</span><span id="bulk-stat-total" class="font-bold text-white">0</span></div>
                        <div class="flex items-center gap-1.5"><span class="text-outline">Running:</span><span id="bulk-stat-running" class="font-bold text-yellow-400">0</span></div>
                        <div class="flex items-center gap-1.5"><span class="text-outline">Completed:</span><span id="bulk-stat-completed" class="font-bold text-[#4CAF50]">0</span></div>
                        <div class="flex items-center gap-1.5"><span class="text-outline">Failed:</span><span id="bulk-stat-failed" class="font-bold text-red-500">0</span></div>
                        <div class="flex items-center gap-1.5"><span class="text-outline">Pending:</span><span id="bulk-stat-pending" class="font-bold text-cyan-400">0</span></div>
                        <div class="flex items-center gap-1.5"><span class="text-outline">ETA:</span><span id="bulk-stat-eta" class="font-bold text-white">--</span></div>
                    </div>
                </div>

                <!-- Right: Performance Activity bars -->
                <div class="flex items-center gap-4">
                    <div class="flex flex-col gap-1 items-end">
                        <span class="text-[9px] text-outline font-semibold">BATCH RENDER LOAD</span>
                        <div class="flex gap-0.5 items-end h-5" id="cpu-gpu-activity">
                            <div class="w-1.5 h-1 bg-primary rounded-full transition-all duration-150"></div>
                            <div class="w-1.5 h-2 bg-primary rounded-full transition-all duration-150"></div>
                            <div class="w-1.5 h-4 bg-primary rounded-full transition-all duration-150"></div>
                            <div class="w-1.5 h-3 bg-primary rounded-full transition-all duration-150"></div>
                            <div class="w-1.5 h-5 bg-primary rounded-full transition-all duration-150"></div>
                        </div>
                    </div>
                    <button class="p-1.5 hover:bg-surface-container-high rounded text-on-surface-variant cursor-pointer border-none bg-transparent" onclick="closeBulkDrawer()">
                        <span class="material-symbols-outlined text-lg text-white">close</span>
                    </button>
                </div>
            </div>

            <!-- Toolbar Controls -->
            <div class="h-10 bg-[#161619] border-b border-outline-variant/30 px-6 flex items-center justify-between shrink-0 select-none">
                <div class="flex items-center gap-2">
                    <button class="flex items-center gap-1 px-3 py-1 bg-primary text-white font-bold rounded hover:bg-primary-container transition-all border-none cursor-pointer text-xs" onclick="startBatchGenerate(false)">
                        <span class="material-symbols-outlined text-xs">play_arrow</span>
                        <span>Generate Selected</span>
                    </button>
                    <button class="flex items-center gap-1 px-3 py-1 bg-surface-container-highest hover:bg-outline-variant/30 text-white font-bold rounded transition-all border-none cursor-pointer text-xs" onclick="startBatchGenerate(true)">
                        <span class="material-symbols-outlined text-xs">select_all</span>
                        <span>Generate All</span>
                    </button>
                    <div class="h-4 w-px bg-outline-variant/30 mx-1"></div>
                    <button class="flex items-center gap-1 px-2.5 py-1 bg-transparent hover:bg-surface-container rounded text-on-surface-variant border-none cursor-pointer text-xs" onclick="pauseBatchQueue()">
                        <span class="material-symbols-outlined text-xs">pause</span>
                        <span>Pause</span>
                    </button>
                    <button class="flex items-center gap-1 px-2.5 py-1 bg-transparent hover:bg-surface-container rounded text-on-surface-variant border-none cursor-pointer text-xs" onclick="resumeBatchQueue()">
                        <span class="material-symbols-outlined text-xs">play_circle</span>
                        <span>Resume</span>
                    </button>
                    <button class="flex items-center gap-1 px-2.5 py-1 bg-transparent hover:bg-surface-container rounded text-on-surface-variant border-none cursor-pointer text-xs" onclick="cancelBatchQueue()">
                        <span class="material-symbols-outlined text-xs">cancel</span>
                        <span>Cancel</span>
                    </button>
                    <button class="flex items-center gap-1 px-2.5 py-1 bg-transparent hover:bg-surface-container rounded text-on-surface-variant border-none cursor-pointer text-xs" onclick="retryFailedBatch()">
                        <span class="material-symbols-outlined text-xs">refresh</span>
                        <span>Retry Failed</span>
                    </button>
                </div>
                
                <div class="flex items-center gap-2">
                    <label for="bulkExportFormat" class="text-[10px] uppercase tracking-wide text-outline">Format</label>
                    <select id="bulkExportFormat" title="Output format" class="bg-surface-container-highest text-white text-xs rounded border border-outline-variant/30 px-2 py-1 cursor-pointer outline-none"></select>
                    <div class="h-4 w-px bg-outline-variant/30 mx-1"></div>
                    <button class="flex items-center gap-1 px-3 py-1 bg-transparent hover:bg-surface-container rounded text-primary border-none cursor-pointer text-xs font-semibold" onclick="exportSelectedBatch()">
                        <span class="material-symbols-outlined text-xs">download</span>
                        <span>Export Selected</span>
                    </button>
                    <button class="flex items-center gap-1 px-3 py-1 bg-transparent hover:bg-surface-container rounded text-primary border-none cursor-pointer text-xs font-semibold" onclick="exportAllBatch()">
                        <span class="material-symbols-outlined text-xs">download_for_offline</span>
                        <span>Export All Zip</span>
                    </button>
                    <button class="flex items-center gap-1 px-2.5 py-1 bg-transparent hover:bg-surface-container rounded text-on-surface-variant border-none cursor-pointer text-xs" onclick="clearCompletedBatch()">
                        <span class="material-symbols-outlined text-xs">delete_sweep</span>
                        <span>Clear Completed</span>
                    </button>
                </div>
            </div>

            <!-- Virtualized/Scrollable Grid List of Variations -->
            <div class="flex-grow overflow-y-auto custom-scrollbar bg-[#0f0f12]" id="bulkDrawerGrid" style="content-visibility: auto;">
                <table class="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr class="border-b border-outline-variant/30 text-outline select-none sticky top-0 bg-[#0f0f12] z-10">
                            <th class="p-3 w-10 text-center"><input type="checkbox" id="bulk-select-all" onclick="toggleSelectAllBulk(this.checked)"></th>
                            <th class="p-3 w-16">#</th>
                            <th class="p-3 w-32">Project Name</th>
                            <th class="p-3 w-20">Thumbnail</th>
                            <th class="p-3">CSV Row Parameters</th>
                            <th class="p-3 w-28">Progress</th>
                            <th class="p-3 w-28">Status</th>
                            <th class="p-3 w-20">Duration</th>
                            <th class="p-3 w-24">Resolution</th>
                            <th class="p-3 w-16">FPS</th>
                        </tr>
                    </thead>
                    <tbody id="bulkDrawerTableBody" class="divide-y divide-outline-variant/10 text-on-surface-variant">
                        <!-- Dynamic lazy-rendered rows -->
                    </tbody>
                </table>
            </div>
        `;
    }
}

customElements.define('forgecut-bulk-drawer', ForgeCutBulkDrawer);

// Background batch processing states
window.batchQueueState = {
    isRunning: false,
    isPaused: false,
    currentIndex: 0,
    activeJobs: [],
    timer: null,
    // Rendering is real-time, so a job costs one second of wall clock per
    // second of output. startBatchGenerate sets this from the real clip length.
    averageRenderTime: 30.0,
    // rowIndex -> { index, name, blob } for every variation actually rendered.
    outputs: new Map(),
    // Chosen export preset, resolved to a real backend by CapabilityRegistry.
    preset: 'web-compat',
    // Handle for the export currently running, so Cancel can stop it.
    current: null
};

/**
 * Fill the format picker from what this environment can ACTUALLY produce.
 *
 * The list is not hardcoded: it comes from CapabilityRegistry, which probes
 * the server encoder, ffmpeg.wasm and MediaRecorder at runtime. A preset no
 * reachable backend can deliver is shown disabled with the reason attached,
 * rather than being offered and then silently producing the wrong container.
 */
window.populateExportFormats = async function() {
    const sel = document.getElementById('bulkExportFormat');
    if (!sel) return;
    const CR = window.ForgeCut && window.ForgeCut.CapabilityRegistry;
    if (!CR) return;

    const previous = sel.value;
    await CR.probe();
    const presets = CR.availablePresets();
    sel.replaceChildren();

    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.available ? p.label : `${p.label} (unavailable)`;
        opt.disabled = !p.available;
        opt.title = p.available
            ? `${p.description} — via ${p.direct ? 'direct capture' : p.backend}`
            : (p.advice || 'Not supported in this environment.');
        sel.appendChild(opt);
    });

    const stillThere = presets.some(p => p.name === previous && p.available);
    const firstUsable = presets.find(p => p.available);
    sel.value = stillThere ? previous : (firstUsable ? firstUsable.name : '');
    window.batchQueueState.preset = sel.value;
    sel.onchange = () => { window.batchQueueState.preset = sel.value; };
};

window.openBulkDrawer = function() {
    const drawer = document.getElementById('bulkDrawerOverlay');
    if (drawer) {
        drawer.style.height = '380px';
        window.initBatchJobs();
        window.updateBulkDrawerList();
        window.populateExportFormats();
        window.startCpuGpuSimulation();
    }
};

window.closeBulkDrawer = function() {
    const drawer = document.getElementById('bulkDrawerOverlay');
    if (drawer) {
        drawer.style.height = '0px';
        window.stopCpuGpuSimulation();
    }
};

window.initBatchJobs = function() {
    if (!state.csvData) return;
    const projName = document.getElementById('footerProjectName')?.textContent || 'Untitled Project';
    const canvasEl = document.getElementById('renderCanvas');
    const res = canvasEl ? `${canvasEl.width}x${canvasEl.height}` : '1920x1080';
    
    // Initialize batchJobs matching state.csvData
    state.batchJobs = state.csvData.map((row, idx) => {
        const existing = state.batchJobs && state.batchJobs[idx];
        return {
            id: idx,
            variationNumber: idx + 1,
            projectName: projName,
            csvRow: JSON.stringify(row),
            thumbnail: existing ? existing.thumbnail : '',
            progress: existing ? existing.progress : 0,
            status: existing ? existing.status : 'Pending',
            duration: state.duration || 30.0,
            resolution: res,
            fps: 25,
            selected: existing ? existing.selected : true
        };
    });
};

window.updateBulkDrawerList = function() {
    const tableBody = document.getElementById('bulkDrawerTableBody');
    if (!tableBody) return;

    if (!state.batchJobs || state.batchJobs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="p-8 text-center text-outline">
                    <span class="material-symbols-outlined text-4xl block mb-2">video_library</span>
                    <span>No variations loaded. Upload a CSV to get started.</span>
                </td>
            </tr>
        `;
        window.updateDashboardStats();
        return;
    }

    // Lazy rendering: only construct elements to prevent DOM bloat
    const fragment = document.createDocumentFragment();
    state.batchJobs.forEach((job) => {
        const tr = document.createElement('tr');
        tr.className = `hover:bg-white/5 cursor-pointer transition-colors ${state.selectedRowIndex === job.id ? 'bg-[#6200ee]/15' : ''}`;
        tr.dataset.jobId = job.id;
        
        tr.addEventListener('dblclick', () => {
            window.selectRow(job.id);
            window.updateBulkDrawerList();
        });

        // Status Badge color mapping
        let badgeColor = 'bg-gray-500/20 text-gray-400';
        if (job.status === 'Rendering') badgeColor = 'bg-yellow-500/20 text-yellow-400 animate-pulse';
        else if (job.status === 'Completed') badgeColor = 'bg-[#4CAF50]/20 text-[#4CAF50]';
        else if (job.status === 'Failed') badgeColor = 'bg-red-500/20 text-red-500';
        else if (job.status === 'Cancelled') badgeColor = 'bg-orange-500/20 text-orange-400';

        tr.innerHTML = `
            <td class="p-3 text-center" onclick="event.stopPropagation();"><input type="checkbox" ${job.selected ? 'checked' : ''} onchange="toggleJobSelection(${job.id}, this.checked)"></td>
            <td class="p-3 font-semibold text-white">#${esc(job.variationNumber)}</td>
            <td class="p-3 text-white truncate max-w-[120px]">${esc(job.projectName)}</td>
            <td class="p-3">
                ${job.thumbnail ? `<img src="${esc(job.thumbnail)}" class="w-12 h-8 object-cover rounded border border-white/10">` : `<div class="w-12 h-8 bg-surface-container rounded border border-white/5 flex items-center justify-center text-[10px] text-outline">No Img</div>`}
            </td>
            <td class="p-3 font-mono text-[10px] truncate max-w-[200px]" title="${esc(job.csvRow)}">${esc(job.csvRow)}</td>
            <td class="p-3">
                <div class="w-20 bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div class="bg-primary h-full transition-all duration-300 js-job-bar" style="width: ${job.progress}%"></div>
                </div>
                <div class="text-[9px] text-outline mt-1 font-semibold js-job-pct">${job.progress}%</div>
            </td>
            <td class="p-3">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}">${esc(job.status)}</span>
            </td>
            <td class="p-3">${Number(job.duration).toFixed(1)}s</td>
            <td class="p-3 font-mono">${esc(job.resolution)}</td>
            <td class="p-3 font-semibold">${esc(job.fps)}</td>
        `;
        fragment.appendChild(tr);
    });

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);

    window.updateDashboardStats();
};

window.toggleJobSelection = function(id, checked) {
    if (state.batchJobs && state.batchJobs[id]) {
        state.batchJobs[id].selected = checked;
    }
    window.updateDashboardStats();
};

window.toggleSelectAllBulk = function(checked) {
    if (state.batchJobs) {
        state.batchJobs.forEach(job => job.selected = checked);
        window.updateBulkDrawerList();
    }
};

window.updateDashboardStats = function() {
    if (!state.batchJobs) return;
    const total = state.batchJobs.length;
    const running = state.batchJobs.filter(j => j.status === 'Rendering').length;
    const completed = state.batchJobs.filter(j => j.status === 'Completed').length;
    const failed = state.batchJobs.filter(j => j.status === 'Failed').length;
    const pending = state.batchJobs.filter(j => j.status === 'Pending').length;
    
    document.getElementById('bulk-stat-total').textContent = total;
    document.getElementById('bulk-stat-running').textContent = running;
    document.getElementById('bulk-stat-completed').textContent = completed;
    document.getElementById('bulk-stat-failed').textContent = failed;
    document.getElementById('bulk-stat-pending').textContent = pending;

    const etaEl = document.getElementById('bulk-stat-eta');
    if (running || pending) {
        const remainingSeconds = (pending + (running ? 0.5 : 0)) * window.batchQueueState.averageRenderTime;
        const mins = Math.floor(remainingSeconds / 60);
        const secs = Math.floor(remainingSeconds % 60);
        etaEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        etaEl.textContent = '--';
    }
};

// Queue control execution loops
/**
 * Repaint just the progress cell of one job.
 *
 * A real render emits a progress event per frame (30/s), and
 * updateBulkDrawerList rebuilds the entire tbody, so calling it per frame would
 * be O(frames x rows). Only the two nodes that actually changed are touched.
 */
function updateJobProgressCell(job) {
    const tableBody = document.getElementById('bulkDrawerTableBody');
    if (!tableBody) return;
    const tr = tableBody.querySelector(`tr[data-job-id="${job.id}"]`);
    if (!tr) return;
    const bar = tr.querySelector('.js-job-bar');
    const pct = tr.querySelector('.js-job-pct');
    if (bar) bar.style.width = `${job.progress}%`;
    if (pct) pct.textContent = `${job.progress}%`;
}

window.startBatchGenerate = async function(all = false) {
    if (!state.batchJobs || state.batchJobs.length === 0) {
        fcToast('Please load a CSV configuration file before generating.');
        return;
    }

    if (window.batchQueueState.isRunning) {
        fcToast('Batch queue is already running.');
        return;
    }

    if (!window.ForgeCut || !window.ForgeCut.ExportEngine) {
        fcToast('Export engine unavailable - cannot render.');
        return;
    }

    window.batchQueueState.isRunning = true;
    window.batchQueueState.isPaused = false;

    // Determine active jobs list
    window.batchQueueState.activeJobs = state.batchJobs.filter(job => {
        if (all) {
            job.selected = true; // force select
            return true;
        }
        return job.selected;
    });

    if (window.batchQueueState.activeJobs.length === 0) {
        fcToast('No variations selected to generate.');
        window.batchQueueState.isRunning = false;
        return;
    }

    // Set active jobs status to Pending
    window.batchQueueState.activeJobs.forEach(job => {
        if (job.status !== 'Completed') {
            job.status = 'Pending';
            job.progress = 0;
        }
    });

    window.batchQueueState.averageRenderTime = Math.max(0.5, state.duration || 30);
    window.batchQueueState.currentIndex = 0;
    window.updateBulkDrawerList();

    await window.runBatchQueue();
};

/**
 * Render pending jobs one at a time through the real export engine.
 *
 * Each variation is a genuine MediaRecorder capture of the canvas composed for
 * that CSV row, so the queue advances in real time. Pause is checked between
 * jobs - a render in flight is allowed to finish rather than be thrown away,
 * since restarting it would cost its full duration again. Cancel aborts the
 * in-flight render as well as the queue.
 */
window.runBatchQueue = async function() {
    const qs = window.batchQueueState;
    const P = window.ForgeCut && window.ForgeCut.ExportPipeline;
    const EC = window.ForgeCut && window.ForgeCut.ExportConfig;
    if (!P || !EC) return;
    const canvasEl = document.getElementById('renderCanvas');

    while (qs.isRunning && !qs.isPaused) {
        const job = qs.activeJobs.find(j => j.status === 'Pending');
        if (!job) break;

        job.status = 'Rendering';
        job.progress = 0;
        window.updateBulkDrawerList();

        let lastPaint = 0;
        let thumbTaken = false;

        // Each variation is rendered by selecting its CSV row and running the
        // full export pipeline, so a batch produces the SAME real container the
        // single-export path does rather than the WebM the old engine always
        // emitted regardless of the chosen format.
        const previousRow = state.selectedRowIndex;
        window.selectRow(job.id);

        // Name the file from the row's first column, the way a user would
        // expect. The display name is left untouched; only the filename is
        // sanitised, and duplicates are resolved when the ZIP is built.
        let rowName = `variation_${job.variationNumber}`;
        try {
            const row = state.csvData && state.csvData[job.id];
            if (row) {
                const first = Object.keys(row)[0];
                if (first && row[first]) rowName = String(row[first]);
            }
        } catch (e) { /* fall back to the variation number */ }

        try {
            const result = await P.runExport(state, renderCanvasComposition, {
                canvas: canvasEl,
                preset: qs.preset || 'web-compat',
                name: rowName,
                fps: job.fps || 30,
                duration: state.duration,
                onJob: (handle) => { qs.current = handle; },
                onUpdate: ({ job: view }) => {
                    job.progress = Math.round((view.progress || 0) * 100);
                    job.stage = view.stage;
                    if (!thumbTaken && view.progress >= 0.4 && canvasEl) {
                        thumbTaken = true;
                        job.thumbnail = canvasEl.toDataURL('image/jpeg', 0.25);
                    }
                    const now = performance.now();
                    if (now - lastPaint > 100) {
                        lastPaint = now;
                        updateJobProgressCell(job);
                    }
                }
            });

            qs.current = null;
            state.selectedRowIndex = previousRow;
            if (!qs.isRunning) break; // cancelled mid-render; statuses already set

            job.progress = 100;
            job.status = 'Completed';
            job.backend = result.backend;
            job.validation = result.validation;
            qs.outputs.set(job.id, {
                index: job.id,
                name: result.filename || EC.sanitiseFilename(rowName, EC.CONTAINERS[result.config.container].ext),
                blob: result.blob
            });
        } catch (e) {
            qs.current = null;
            state.selectedRowIndex = previousRow;
            if (e && e.code === 'ECANCELLED') {
                job.status = 'Cancelled';
                job.progress = 0;
                break;
            }
            job.status = 'Failed';
            job.error = (e && e.message) ? e.message : String(e);
        }
        window.updateBulkDrawerList();
    }

    if (qs.isRunning && !qs.isPaused) {
        qs.isRunning = false;
        window.updateBulkDrawerList();
        const done = state.batchJobs.filter(j => j.status === 'Completed').length;
        const failed = state.batchJobs.filter(j => j.status === 'Failed').length;
        fcToast(failed
            ? `Rendering finished: ${done} rendered, ${failed} failed.`
            : `Rendering finished: ${done} variation${done === 1 ? '' : 's'} ready to export.`);
    }
};

window.pauseBatchQueue = function() {
    if (window.batchQueueState.isRunning && !window.batchQueueState.isPaused) {
        // The in-flight render is left to finish rather than discarded: it is a
        // real capture, and restarting it would cost its full duration again.
        window.batchQueueState.isPaused = true;
        window.updateBulkDrawerList();
        fcToast('Pausing after the current variation finishes...');
    }
};

window.resumeBatchQueue = async function() {
    if (window.batchQueueState.isRunning && window.batchQueueState.isPaused) {
        window.batchQueueState.isPaused = false;
        window.updateBulkDrawerList();
        fcToast('Queue resumed.');
        await window.runBatchQueue();
    }
};

window.cancelBatchQueue = function() {
    if (window.batchQueueState.isRunning) {
        window.batchQueueState.isRunning = false;
        window.batchQueueState.isPaused = false;
        // Abort the export in flight too, not just the queue that schedules
        // them. The pipeline handle stops the capture, aborts the upload and
        // kills the server's FFmpeg process.
        if (window.batchQueueState.current) {
            try { window.batchQueueState.current.cancel(); } catch (e) { /* already gone */ }
            window.batchQueueState.current = null;
        }
        if (window.ForgeCut && window.ForgeCut.ExportEngine) {
            window.ForgeCut.ExportEngine.cancelExport();
        }
        // Set all Pending/Rendering jobs to Cancelled
        state.batchJobs.forEach(job => {
            if (job.status === 'Pending' || job.status === 'Rendering') {
                job.status = 'Cancelled';
                job.progress = 0;
            }
        });
        window.updateBulkDrawerList();
        fcToast('Queue cancelled.');
    }
};

window.retryFailedBatch = function() {
    if (!state.batchJobs) return;
    state.batchJobs.forEach(job => {
        if (job.status === 'Failed' || job.status === 'Cancelled') {
            job.status = 'Pending';
            job.progress = 0;
            job.selected = true;
        }
    });
    window.startBatchGenerate(false);
};

/** Collect the rendered files for the completed jobs matching `pick`. */
function collectRenderedOutputs(pick) {
    const outputs = window.batchQueueState.outputs;
    if (!state.batchJobs) return [];
    const entries = state.batchJobs
        .filter(j => j.status === 'Completed' && pick(j) && outputs.has(j.id))
        .map(j => outputs.get(j.id));

    // Two CSV rows can easily share a first column, and a duplicate entry name
    // silently overwrites inside a ZIP. Uniquify at packaging time so the
    // stored display names are left alone.
    const EC = window.ForgeCut && window.ForgeCut.ExportConfig;
    if (EC && entries.length > 1) {
        const unique = EC.dedupeFilenames(entries.map(e => e.name));
        return entries.map((e, i) => ({ index: e.index, name: unique[i], blob: e.blob }));
    }
    return entries;
}

window.exportSelectedBatch = async function() {
    const entries = collectRenderedOutputs(j => j.selected);
    if (entries.length === 0) {
        fcToast('No rendered variations selected. Run the render queue first.');
        return;
    }
    fcToast(`Packaging ${entries.length} variation${entries.length === 1 ? '' : 's'}...`);
    await window.ForgeCut.ExportEngine.downloadZip(entries, 'ForgeCut_Selected_Variations.zip');
};

window.exportAllBatch = async function() {
    const entries = collectRenderedOutputs(() => true);
    if (entries.length === 0) {
        fcToast('No rendered variations to export. Please run the render queue first.');
        return;
    }
    fcToast(`Packaging all ${entries.length} variation${entries.length === 1 ? '' : 's'}...`);
    await window.ForgeCut.ExportEngine.downloadZip(entries, 'ForgeCut_Batch_Export.zip');
};

window.clearCompletedBatch = function() {
    if (!state.batchJobs) return;
    state.batchJobs.forEach(job => {
        if (job.status === 'Completed') {
            job.status = 'Pending';
            job.progress = 0;
            job.thumbnail = '';
            window.batchQueueState.outputs.delete(job.id);
        }
    });
    window.updateBulkDrawerList();
    fcToast('Cleared completed status from variations.');
};

// Activity simulation
let activityInterval = null;
window.startCpuGpuSimulation = function() {
    const container = document.getElementById('cpu-gpu-activity');
    if (!container) return;
    activityInterval = setInterval(() => {
        const bars = container.children;
        for (let bar of bars) {
            const h = Math.floor(Math.random() * 20) + 4; // height 4px to 24px
            bar.style.height = `${h}px`;
        }
    }, 150);
};

window.stopCpuGpuSimulation = function() {
    if (activityInterval) {
        clearInterval(activityInterval);
        activityInterval = null;
    }
};
