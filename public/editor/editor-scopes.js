/**
 * ForgeCut editor — scopes view (waveform, vectorscope, histogram).
 *
 * Shared drawing; each shell supplies the host element and its own button
 * classes, so the panel looks native in both. The frame is sampled from the
 * composition canvas at a small size, at most SAMPLE_HZ times a second, and
 * only while the panel is visible: one small readback on a throttle, never
 * per frame.
 */
(function () {
    'use strict';

    const SAMPLE_HZ = 5;
    const SW = 192;                       // sample width; height follows the canvas aspect
    const MODES = [['waveform', 'Waveform'], ['vectorscope', 'Vectorscope'], ['histogram', 'Histogram']];

    const SC = () => window.ForgeCut && window.ForgeCut.Scopes;

    function create(host, opts) {
        const o = Object.assign({ tabClass: '', activeClass: '', canvasClass: '' }, opts || {});
        let mode = 'waveform', timer = null;
        const sample = document.createElement('canvas');
        const sctx = sample.getContext('2d', { willReadFrequently: true });

        host.replaceChildren();
        const bar = document.createElement('div');
        bar.setAttribute('role', 'tablist');
        bar.style.display = 'flex';
        bar.style.gap = '4px';
        const tabs = MODES.map(([id, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.className = o.tabClass;
            b.setAttribute('role', 'tab');
            b.addEventListener('click', () => { mode = id; sync(); tick(); });
            bar.append(b);
            return [id, b];
        });
        const view = document.createElement('canvas');
        view.width = 256; view.height = 160;
        view.className = o.canvasClass;
        view.setAttribute('role', 'img');
        view.style.display = 'block';
        view.style.width = '100%';
        view.style.imageRendering = 'auto';
        host.append(bar, view);
        const vctx = view.getContext('2d');

        function sync() {
            tabs.forEach(([id, b]) => {
                const on = id === mode;
                b.setAttribute('aria-selected', String(on));
                if (o.activeClass) o.activeClass.split(/\s+/).filter(Boolean).forEach(c => b.classList.toggle(c, on));
            });
            view.setAttribute('aria-label', MODES.find(m => m[0] === mode)[1] + ' of the current frame');
        }

        /** Map a count to brightness so faint traces stay visible. */
        const glow = (n, max) => n ? Math.min(255, Math.round(40 + 215 * Math.log1p(n) / Math.log1p(max))) : 0;

        function drawWaveform(px, w, h) {
            const L = 128, wf = SC().waveform(px, w, h, L);
            view.width = w; view.height = L;
            const img = vctx.createImageData(w, L);
            let max = 1;
            for (let i = 0; i < wf.data.length; i++) if (wf.data[i] > max) max = wf.data[i];
            for (let lv = 0; lv < L; lv++) for (let x = 0; x < w; x++) {
                const v = glow(wf.data[lv * w + x], max);
                const j = ((L - 1 - lv) * w + x) * 4;     // white at the top
                img.data[j] = v * 0.55; img.data[j + 1] = v; img.data[j + 2] = v * 0.6; img.data[j + 3] = 255;
            }
            vctx.putImageData(img, 0, 0);
            vctx.strokeStyle = 'rgba(255,255,255,0.18)';
            [0.25, 0.5, 0.75].forEach(f => { const y = Math.round((1 - f) * (L - 1)) + 0.5; vctx.beginPath(); vctx.moveTo(0, y); vctx.lineTo(w, y); vctx.stroke(); });
        }

        function drawVectorscope(px) {
            const S = 128, vs = SC().vectorscope(px, S);
            view.width = S; view.height = S;
            const img = vctx.createImageData(S, S);
            let max = 1;
            for (let i = 0; i < vs.data.length; i++) if (vs.data[i] > max) max = vs.data[i];
            for (let i = 0; i < vs.data.length; i++) {
                const v = glow(vs.data[i], max);
                img.data[4 * i] = v * 0.6; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v * 0.7; img.data[4 * i + 3] = 255;
            }
            vctx.putImageData(img, 0, 0);
            vctx.strokeStyle = 'rgba(255,255,255,0.2)';
            vctx.beginPath(); vctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); vctx.stroke();
            vctx.beginPath(); vctx.moveTo(S / 2, 0); vctx.lineTo(S / 2, S); vctx.moveTo(0, S / 2); vctx.lineTo(S, S / 2); vctx.stroke();
            // 75% colour-bar targets: R, Y, G, C, B, M.
            vctx.font = '8px sans-serif';
            vctx.fillStyle = 'rgba(255,255,255,0.55)';
            [['R', [0.75, 0, 0]], ['Yl', [0.75, 0.75, 0]], ['G', [0, 0.75, 0]], ['Cy', [0, 0.75, 0.75]], ['B', [0, 0, 0.75]], ['Mg', [0.75, 0, 0.75]]]
                .forEach(([n, c]) => { const t = SC().vectorTarget(c[0], c[1], c[2], S); vctx.strokeRect(t.x - 3, t.y - 3, 6, 6); vctx.fillText(n, t.x + 5, t.y + 3); });
        }

        function drawHistogram(px) {
            const W = 256, H = 128, hs = SC().histogram(px);
            view.width = W; view.height = H;
            vctx.fillStyle = '#000'; vctx.fillRect(0, 0, W, H);
            let max = 1;
            for (const ch of [hs.r, hs.g, hs.b]) for (let i = 0; i < 256; i++) if (ch[i] > max) max = ch[i];
            vctx.globalCompositeOperation = 'lighter';
            [[hs.r, 'rgba(255,60,60,0.85)'], [hs.g, 'rgba(60,255,90,0.85)'], [hs.b, 'rgba(70,120,255,0.85)']].forEach(([ch, col]) => {
                vctx.fillStyle = col;
                for (let i = 0; i < 256; i++) {
                    const hgt = Math.round(Math.sqrt(ch[i] / max) * (H - 2));
                    if (hgt) vctx.fillRect(i, H - hgt, 1, hgt);
                }
            });
            vctx.globalCompositeOperation = 'source-over';
        }

        function tick() {
            const src = window.canvas || document.getElementById('renderCanvas');
            if (!src || !src.width || !SC()) return;
            if (!host.getClientRects().length) return;   // hidden: no readback at all
            // No "unchanged frame" shortcut: an effect edit changes the image
            // without moving the playhead. At SW px and SAMPLE_HZ the
            // readback is well under a millisecond.
            const sw = SW, sh = Math.max(1, Math.round(SW * src.height / src.width));
            if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh; }
            sctx.clearRect(0, 0, sw, sh);
            sctx.drawImage(src, 0, 0, sw, sh);
            const px = sctx.getImageData(0, 0, sw, sh).data;
            if (mode === 'waveform') drawWaveform(px, sw, sh);
            else if (mode === 'vectorscope') drawVectorscope(px);
            else drawHistogram(px);
        }

        sync();
        return {
            start() { if (!timer) { timer = setInterval(tick, 1000 / SAMPLE_HZ); tick(); } },
            stop() { if (timer) { clearInterval(timer); timer = null; } },
            refresh() { tick(); },
            setMode(m) { if (MODES.some(x => x[0] === m)) { mode = m; sync(); tick(); } },
            get mode() { return mode; }
        };
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.ScopesView = { create, SAMPLE_HZ };
})();
