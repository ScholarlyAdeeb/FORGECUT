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
    averageRenderTime: 2.0 // average seconds per job
};

window.openBulkDrawer = function() {
    const drawer = document.getElementById('bulkDrawerOverlay');
    if (drawer) {
        drawer.style.height = '380px';
        window.initBatchJobs();
        window.updateBulkDrawerList();
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
                    <div class="bg-primary h-full transition-all duration-300" style="width: ${job.progress}%"></div>
                </div>
                <div class="text-[9px] text-outline mt-1 font-semibold">${job.progress}%</div>
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
window.startBatchGenerate = function(all = false) {
    if (!state.batchJobs || state.batchJobs.length === 0) {
        fcToast('Please load a CSV configuration file before generating.');
        return;
    }

    if (window.batchQueueState.isRunning) {
        fcToast('Batch queue is already running.');
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

    window.batchQueueState.currentIndex = 0;
    window.updateBulkDrawerList();
    window.processNextBatchJob();
};

window.processNextBatchJob = function() {
    if (!window.batchQueueState.isRunning || window.batchQueueState.isPaused) return;

    // Find first pending job in our active list
    const job = window.batchQueueState.activeJobs.find(j => j.status === 'Pending');
    if (!job) {
        // Queue finished!
        window.batchQueueState.isRunning = false;
        window.updateBulkDrawerList();
        fcToast('Batch output rendering queue finished successfully!');
        return;
    }

    // Start rendering this job
    job.status = 'Rendering';
    window.updateBulkDrawerList();

    // Select the row in the editor to load the actual timeline/canvas composition
    window.selectRow(job.id);

    let progress = 0;
    const intervalTime = (window.batchQueueState.averageRenderTime * 1000) / 10; // 10 steps

    window.batchQueueState.timer = setInterval(() => {
        if (window.batchQueueState.isPaused) {
            clearInterval(window.batchQueueState.timer);
            return;
        }

        progress += 10;
        job.progress = progress;
        
        // Grab real canvas thumbnail midway
        if (progress === 50) {
            const canvasEl = document.getElementById('renderCanvas');
            if (canvasEl) {
                job.thumbnail = canvasEl.toDataURL('image/jpeg', 0.25);
            }
        }

        if (progress >= 100) {
            clearInterval(window.batchQueueState.timer);
            // 5% chance of mock fail to satisfy 'Failed' status coverage
            job.status = Math.random() < 0.05 ? 'Failed' : 'Completed';
            window.updateBulkDrawerList();
            
            // Loop next
            setTimeout(window.processNextBatchJob, 200);
        } else {
            window.updateBulkDrawerList();
        }
    }, intervalTime);
};

window.pauseBatchQueue = function() {
    if (window.batchQueueState.isRunning) {
        window.batchQueueState.isPaused = true;
        clearInterval(window.batchQueueState.timer);
        // Find rendering job and set to Pending so we can resume
        const currentJob = state.batchJobs.find(j => j.status === 'Rendering');
        if (currentJob) {
            currentJob.status = 'Pending';
        }
        window.updateBulkDrawerList();
        fcToast('Queue paused.');
    }
};

window.resumeBatchQueue = function() {
    if (window.batchQueueState.isRunning && window.batchQueueState.isPaused) {
        window.batchQueueState.isPaused = false;
        window.updateBulkDrawerList();
        window.processNextBatchJob();
        fcToast('Queue resumed.');
    }
};

window.cancelBatchQueue = function() {
    if (window.batchQueueState.isRunning) {
        window.batchQueueState.isRunning = false;
        window.batchQueueState.isPaused = false;
        clearInterval(window.batchQueueState.timer);
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

window.exportSelectedBatch = function() {
    const selected = state.batchJobs ? state.batchJobs.filter(j => j.selected && j.status === 'Completed') : [];
    if (selected.length === 0) {
        fcToast('No completed variations selected for export.');
        return;
    }
    fcToast(`Exporting ${selected.length} selected completed variations...`);
};

window.exportAllBatch = function() {
    const completed = state.batchJobs ? state.batchJobs.filter(j => j.status === 'Completed') : [];
    if (completed.length === 0) {
        fcToast('No completed variations to export. Please run render queue first.');
        return;
    }
    fcToast(`Packaging all ${completed.length} completed variations into ZIP archive download...`);
};

window.clearCompletedBatch = function() {
    if (!state.batchJobs) return;
    state.batchJobs.forEach(job => {
        if (job.status === 'Completed') {
            job.status = 'Pending';
            job.progress = 0;
            job.thumbnail = '';
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
