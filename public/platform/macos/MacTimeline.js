/**
 * ForgeCut macOS — timeline presentation.
 *
 * The timeline is the heart of the editor and stays a professional multi-track
 * surface: track heads, clips, playhead, seeking, selection, drag-move,
 * edge-trim, snapping and zoom. Only the visual language is macOS.
 *
 * Performance notes, because this is the hot surface:
 *  - No backdrop-filter anywhere in here. Glass is chrome; there can be
 *    hundreds of clips. Clips are flat opaque rectangles.
 *  - Renders are coalesced into one rAF and skipped entirely when a cheap
 *    signature of the timeline state is unchanged.
 *  - The ruler is a single canvas, not per-tick DOM.
 *  - Drag and trim mutate one element's inline style per frame and only
 *    rebuild on commit.
 */
(function () {
    'use strict';

    const Mac = window.MacUI = window.MacUI || {};

    const TRACK_COLORS = {
        video: '#5E8BD8', audio: '#3FA463', text: '#D2833B',
        shape: '#9A6BD0', image: '#4EA0B8'
    };
    const LANE_H = 46;
    const MIN_CLIP = 0.1;

    let lanesEl, headsEl, rulerCanvas, playheadEl, scrollEl;
    let pxPerSec = 20;
    let rafPending = false;
    let lastSignature = '';
    let drag = null;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /* A cheap fingerprint of everything the timeline draws. Rebuilding is
       skipped when this is unchanged, so command-layer calls that do not
       affect the timeline cost nothing. */
    function signature() {
        const s = window.state;
        if (!s) return '';
        let out = pxPerSec + '|' + s.duration + '|' + s.selectedClipId + '|';
        for (const t of s.tracks || []) {
            out += t.id + ':';
            for (const c of t.clips || []) {
                out += c.id + ',' + c.startTime + ',' + c.duration + ',' + (c.name || c.text || '') + ';';
            }
            out += '|';
        }
        return out;
    }

    function drawRuler() {
        if (!rulerCanvas) return;
        const s = window.state;
        const width = Math.max(200, Math.ceil((s.duration || 30) * pxPerSec));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (rulerCanvas.width !== width * dpr || rulerCanvas.height !== 22 * dpr) {
            rulerCanvas.width = width * dpr;
            rulerCanvas.height = 22 * dpr;
        }
        rulerCanvas.style.width = width + 'px';
        const ctx = rulerCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, 22);

        const css = getComputedStyle(document.documentElement);
        const label = css.getPropertyValue('--label-2').trim() || '#666';
        const line = css.getPropertyValue('--separator-strong').trim() || '#999';

        // Choose a tick step that keeps labels legible at any zoom.
        const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
        let step = steps.find(v => v * pxPerSec >= 54) || 60;

        ctx.strokeStyle = line;
        ctx.fillStyle = label;
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.beginPath();
        for (let t = 0; t <= (s.duration || 30) + 0.001; t += step) {
            const x = Math.round(t * pxPerSec) + 0.5;
            ctx.moveTo(x, 13);
            ctx.lineTo(x, 22);
            const mm = Math.floor(t / 60);
            const ss = Math.floor(t % 60);
            ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, x + 3, 2);
        }
        ctx.stroke();
    }

    function trackIcon(type) {
        return { video: 'video', audio: 'audio', text: 'text', shape: 'shape', image: 'image' }[type] || 'video';
    }

    function buildHeads() {
        const s = window.state;
        headsEl.replaceChildren();
        const spacer = document.createElement('div');
        spacer.className = 'mac-tl-headspacer';
        headsEl.appendChild(spacer);

        for (const track of s.tracks || []) {
            const head = document.createElement('div');
            head.className = 'mac-tl-head';
            head.appendChild(Mac.icon(trackIcon(track.type)));
            const nm = document.createElement('span');
            nm.className = 'nm';
            nm.textContent = track.name || track.id;
            head.appendChild(nm);

            // Visibility and lock read the same state the shared layer uses.
            const vis = document.createElement('button');
            vis.type = 'button';
            const visible = !(s.trackVisibility && s.trackVisibility[track.id] === false);
            vis.title = visible ? 'Hide track' : 'Show track';
            vis.setAttribute('aria-label', vis.title);
            vis.appendChild(Mac.icon(visible ? 'visibility' : 'visibility_off'));
            vis.addEventListener('click', () => {
                if (!s.trackVisibility) s.trackVisibility = {};
                s.trackVisibility[track.id] = !visible;
                if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
                api.invalidate(true);
            });

            const lock = document.createElement('button');
            lock.type = 'button';
            const locked = !!(s.trackLock && s.trackLock[track.id]);
            lock.title = locked ? 'Unlock track' : 'Lock track';
            lock.setAttribute('aria-label', lock.title);
            lock.appendChild(Mac.icon(locked ? 'lock' : 'lock_open'));
            lock.addEventListener('click', () => {
                if (!s.trackLock) s.trackLock = {};
                s.trackLock[track.id] = !locked;
                api.invalidate(true);
            });

            head.append(vis, lock);
            headsEl.appendChild(head);
        }
    }

    function buildLanes() {
        const s = window.state;
        const width = Math.max(200, Math.ceil((s.duration || 30) * pxPerSec));
        lanesEl.replaceChildren();
        lanesEl.style.width = width + 'px';

        (s.tracks || []).forEach((track) => {
            const lane = document.createElement('div');
            lane.className = 'mac-tl-lane';
            lane.dataset.trackId = track.id;
            lane.style.width = width + 'px';

            // Drop target for media dragged from the sidebar.
            lane.addEventListener('dragover', (e) => {
                if (!Mac.dragAsset) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                lane.classList.add('drop-ok');
            });
            lane.addEventListener('dragleave', () => lane.classList.remove('drop-ok'));
            lane.addEventListener('drop', (e) => {
                lane.classList.remove('drop-ok');
                const assetId = Mac.dragAsset || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
                if (!assetId) return;
                e.preventDefault();
                const rect = lane.getBoundingClientRect();
                const at = Math.max(0, (e.clientX - rect.left) / pxPerSec);
                Mac.dropAssetOnTrack(assetId, track, at);
                Mac.dragAsset = null;
            });

            for (const clip of track.clips || []) {
                lane.appendChild(buildClip(clip, track));
            }
            lanesEl.appendChild(lane);
        });
    }

    function buildClip(clip, track) {
        const node = document.createElement('div');
        node.className = 'mac-clip';
        node.dataset.clipId = clip.id;
        node.style.left = (clip.startTime * pxPerSec) + 'px';
        node.style.width = Math.max(6, clip.duration * pxPerSec) + 'px';
        node.style.setProperty('--clip-bg', TRACK_COLORS[track.type] || '#6E9BE8');
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', window.state.selectedClipId === clip.id ? 'true' : 'false');
        node.tabIndex = 0;
        node.title = `${clip.name || clip.text || 'Clip'} — ${clip.duration.toFixed(2)}s`;

        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = clip.name || clip.text || track.name;
        node.appendChild(lbl);

        const tl = document.createElement('div');
        tl.className = 'trim trim-l';
        const tr = document.createElement('div');
        tr.className = 'trim trim-r';
        node.append(tl, tr);

        node.addEventListener('mousedown', (e) => {
            if (window.state.trackLock && window.state.trackLock[track.id]) return;
            e.stopPropagation();
            select(clip.id);
            const mode = e.target === tl ? 'trim-l' : e.target === tr ? 'trim-r' : 'move';
            startDrag(e, clip, track, node, mode);
        });
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(clip.id); }
        });
        node.addEventListener('contextmenu', (e) => {
            select(clip.id);
            Mac.contextMenu(e, [
                { label: 'Cut', shortcut: '⌘X', action: () => window.timelineCut && timelineCut() },
                { label: 'Copy', shortcut: '⌘C', action: () => window.timelineCopy && timelineCopy() },
                { label: 'Duplicate', shortcut: '⌘D', action: () => window.timelineDuplicate && timelineDuplicate() },
                'separator',
                { label: 'Split at Playhead', shortcut: 'S', action: () => window.triggerSplit && triggerSplit() },
                { label: 'Trim to Playhead', action: () => window.triggerTrim && triggerTrim() },
                'separator',
                { label: 'Delete', shortcut: '⌫', action: () => window.timelineDeleteSelected && timelineDeleteSelected() },
                { label: 'Ripple Delete', action: () => window.timelineRippleDelete && timelineRippleDelete() }
            ]);
        });
        return node;
    }

    function select(clipId) {
        if (typeof selectClip === 'function') selectClip(clipId);
        else window.state.selectedClipId = clipId;
        api.invalidate(true);
        if (Mac.renderInspector) Mac.renderInspector();
    }

    /* ── Drag / trim ─────────────────────────────────────────────────────
       Moves one element's inline style per frame; state is committed once on
       mouseup so history gets a single undo entry per gesture. */
    function startDrag(e, clip, track, node, mode) {
        const startX = e.clientX;
        const orig = { start: clip.startTime, dur: clip.duration, trim: clip.trimStart || 0 };
        drag = { clip, track, node, mode, startX, orig, moved: false };
        document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd, { once: true });
    }

    function snapTime(t) {
        const s = window.state;
        if (!s.snapEnabled) return t;
        // Snap to whole seconds and to other clips' edges within 6px.
        const tol = 6 / pxPerSec;
        let best = t, bestD = tol;
        const cands = [Math.round(t), s.currentTime];
        for (const tr of s.tracks || []) {
            for (const c of tr.clips || []) {
                if (drag && c === drag.clip) continue;
                cands.push(c.startTime, c.startTime + c.duration);
            }
        }
        for (const c of cands) {
            const d = Math.abs(c - t);
            if (d < bestD) { bestD = d; best = c; }
        }
        return best;
    }

    function onDragMove(e) {
        if (!drag) return;
        const dt = (e.clientX - drag.startX) / pxPerSec;
        if (Math.abs(e.clientX - drag.startX) > 2) drag.moved = true;
        const c = drag.clip, o = drag.orig;

        if (drag.mode === 'move') {
            c.startTime = Math.max(0, snapTime(o.start + dt));
        } else if (drag.mode === 'trim-l') {
            const ns = clamp(snapTime(o.start + dt), 0, o.start + o.dur - MIN_CLIP);
            const delta = ns - o.start;
            c.startTime = ns;
            c.duration = Math.max(MIN_CLIP, o.dur - delta);
            if (o.trim !== undefined) c.trimStart = Math.max(0, o.trim + delta);
        } else {
            c.duration = Math.max(MIN_CLIP, snapTime(o.start + o.dur + dt) - o.start);
        }
        drag.node.style.left = (c.startTime * pxPerSec) + 'px';
        drag.node.style.width = Math.max(6, c.duration * pxPerSec) + 'px';
    }

    function onDragEnd() {
        window.removeEventListener('mousemove', onDragMove);
        document.body.style.cursor = '';
        if (!drag) return;
        const moved = drag.moved;
        const clip = drag.clip;
        const orig = drag.orig;
        drag = null;
        if (moved) {
            // The gesture already mutated the clip, so there is nothing left to
            // snapshot. commitGesture rewinds, snapshots, then re-applies,
            // leaving one undo entry for the whole drag.
            if (typeof commitGesture === 'function') {
                const after = { start: clip.startTime, dur: clip.duration, trim: clip.trimStart };
                commitGesture('Timeline Edit',
                    () => {
                        clip.startTime = orig.start;
                        clip.duration = orig.dur;
                        if (orig.trim !== undefined) clip.trimStart = orig.trim;
                    },
                    () => {
                        clip.startTime = after.start;
                        clip.duration = after.dur;
                        if (after.trim !== undefined) clip.trimStart = after.trim;
                    });
            }
            // Keep a linked audio clip aligned, as the shared layer expects.
            if (clip.linkedClipId && typeof findClipById === 'function') {
                const linked = findClipById(clip.linkedClipId);
                if (linked) {
                    linked.startTime = clip.startTime;
                    linked.duration = clip.duration;
                    if (clip.trimStart !== undefined) linked.trimStart = clip.trimStart;
                }
            }
            if (typeof renderCanvasComposition === 'function') renderCanvasComposition();
            if (typeof syncMediaPlayback === 'function') syncMediaPlayback();
        }
        api.invalidate(true);
        if (Mac.renderInspector) Mac.renderInspector();
    }

    /* ── Playhead / seeking ─────────────────────────────────────────────── */
    function updatePlayhead() {
        if (!playheadEl || !window.state) return;
        playheadEl.style.left = (window.state.currentTime * pxPerSec) + 'px';
    }

    function seekFromEvent(e) {
        const rect = lanesEl.getBoundingClientRect();
        const t = clamp((e.clientX - rect.left) / pxPerSec, 0, window.state.duration || 30);
        if (typeof setTime === 'function') setTime(t);
        else window.state.currentTime = t;
        updatePlayhead();
    }

    /* ── Public API ─────────────────────────────────────────────────────── */
    const api = {
        setZoom(v) {
            pxPerSec = clamp(v, 4, 240);
            if (window.state) window.state.zoom = pxPerSec;
            api.invalidate(true);
        },
        getZoom: () => pxPerSec,

        /** Render now, synchronously. Used for the first paint. */
        renderNow() {
            if (!window.state || !lanesEl) return;
            const sig = signature();
            if (sig !== lastSignature) {
                lastSignature = sig;
                drawRuler();
                buildHeads();
                buildLanes();
            }
            updatePlayhead();
        },

        /** Coalesce into one frame; skip entirely if nothing visible changed. */
        invalidate(force) {
            if (force) lastSignature = '';
            if (rafPending) return;
            rafPending = true;
            const run = () => {
                if (!rafPending) return;
                rafPending = false;
                api.renderNow();
            };
            requestAnimationFrame(run);
            // rAF never fires while the window is hidden or backgrounded, which
            // would otherwise leave the timeline unbuilt until the user focuses
            // the window. Cheap because run() is idempotent and signature-gated.
            setTimeout(run, 120);
        },

        tickPlayhead: updatePlayhead,

        mount() {
            lanesEl = document.getElementById('macLanes');
            headsEl = document.getElementById('macTrackHeads');
            rulerCanvas = document.getElementById('macRulerCanvas');
            playheadEl = document.getElementById('macPlayhead');
            scrollEl = document.getElementById('macTimelineScroll');
            if (!lanesEl) return;

            pxPerSec = (window.state && window.state.zoom) || 20;

            const ruler = document.getElementById('macRuler');
            if (ruler) {
                ruler.addEventListener('mousedown', (e) => {
                    seekFromEvent(e);
                    const mv = (ev) => seekFromEvent(ev);
                    window.addEventListener('mousemove', mv);
                    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mv), { once: true });
                });
            }
            // Clicking empty timeline space deselects, as on macOS.
            lanesEl.addEventListener('mousedown', (e) => {
                if (e.target.closest('.mac-clip')) return;
                if (typeof selectClip === 'function') selectClip(null);
                else window.state.selectedClipId = null;
                api.invalidate(true);
                if (Mac.renderInspector) Mac.renderInspector();
            });

            // Trackpad pinch / ⌘-scroll zooms the timeline, as Mac users expect.
            if (scrollEl) {
                scrollEl.addEventListener('wheel', (e) => {
                    if (!(e.ctrlKey || e.metaKey)) return;
                    e.preventDefault();
                    api.setZoom(pxPerSec * (e.deltaY < 0 ? 1.12 : 0.89));
                }, { passive: false });
            }
            // First paint is synchronous so the timeline exists immediately,
            // rather than waiting on a frame that a hidden window never gives.
            api.renderNow();
        }
    };

    Mac.timeline = api;
})();
