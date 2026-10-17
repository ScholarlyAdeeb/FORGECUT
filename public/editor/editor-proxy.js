/**
 * ForgeCut editor — proxy editing toggle.
 *
 * One switch: turning proxies on builds any missing proxies for large clips
 * in the timeline (in the background, cached per browser), then previews
 * from them. Export always uses the originals — see ProxyEngine.js.
 */
(function () {
    'use strict';

    const PE = () => window.ForgeCut && window.ForgeCut.ProxyEngine;
    const ME = () => window.ForgeCut && window.ForgeCut.MediaEngine;
    let building = null;

    function syncUI() {
        const chk = document.getElementById('chkUseProxies');
        if (chk) chk.checked = !!state.useProxies;
    }

    function assetsNeedingProxies() {
        const seen = new Set(), out = [];
        state.tracks.forEach(t => t.clips.forEach(c => {
            const a = ME() && ME().getAsset(c.assetId);
            if (a && !seen.has(a.id) && PE().needsProxy(a) && !(a.proxy && a.proxy.ready)) { seen.add(a.id); out.push(a); }
        }));
        return out;
    }

    async function buildMissing() {
        const todo = assetsNeedingProxies();
        for (let i = 0; i < todo.length; i++) {
            const a = todo[i];
            const label = todo.length > 1 ? ` ${i + 1}/${todo.length}` : '';
            let last = -1;
            try {
                const res = await PE().build(a, {
                    onProgress: (f) => {
                        const pct = Math.floor(f * 10) * 10;
                        if (pct !== last) { last = pct; fcToast(`Building proxy${label}: ${pct}%`); }
                    }
                });
                await PE().attach(a, res);
                fcToast(res.cached ? `Proxy${label} loaded from cache.` : `Proxy${label} ready.`);
                renderCanvasComposition();
                syncMediaPlayback();
            } catch (e) {
                console.warn('[ForgeCut] proxy build failed', e);
                fcToast(`Proxy${label} failed: ${e && e.message || e}. Previewing the original.`);
            }
        }
    }

    window.setUseProxies = async function (on) {
        state.useProxies = !!on;
        syncUI();
        renderCanvasComposition();
        syncMediaPlayback();
        if (!on || !PE()) return;
        if (assetsNeedingProxies().length === 0) {
            fcToast('Using proxies. No clips in this project are larger than 1080p.');
            return;
        }
        if (!building) building = buildMissing().finally(() => { building = null; });
        return building;
    };

    window.proxyStatus = function () {
        const all = [];
        state.tracks.forEach(t => t.clips.forEach(c => {
            const a = ME() && ME().getAsset(c.assetId);
            if (a && a.type === 'video' && !all.some(x => x.id === a.id)) {
                all.push({ id: a.id, name: a.name, size: `${a.width}x${a.height}`, needs: PE() ? PE().needsProxy(a) : false, ready: !!(a.proxy && a.proxy.ready) });
            }
        }));
        return { on: !!state.useProxies, building: !!building, assets: all };
    };
})();
