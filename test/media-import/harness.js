/* ForgeCut media-import test harness — drives the real file inputs. */
(function () {
  window.__T = { errors: [], warns: [] };
  const _err = console.error, _warn = console.warn;
  console.error = function (...a) { window.__T.errors.push(a.map(x => x && x.stack ? x.stack : String(x)).join(' ')); _err.apply(console, a); };
  console.warn = function (...a) { window.__T.warns.push(a.map(String).join(' ')); _warn.apply(console, a); };
  window.addEventListener('error', e => window.__T.errors.push('window.onerror: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', e => window.__T.errors.push('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason.message) || String(e.reason))));

  const inputFor = t => ({ video: 'mediaFileInput', audio: 'audioFileInput', image: 'imageFileInput' })[t];

  window.__T.importViaUI = async function (fileName, kind, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    window.__T.errors = []; window.__T.warns = [];
    const res = await fetch('/__testmedia/' + encodeURIComponent(fileName));
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: blob.type });
    const input = document.getElementById(inputFor(kind));
    if (!input) throw new Error('no input for ' + kind);
    const dt = new DataTransfer(); dt.items.add(file);
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    const statusEl = document.querySelector('footer .font-status-bar');
    if (statusEl) statusEl.textContent = '__PENDING__';
    const t0 = performance.now();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    while (performance.now() - t0 < timeoutMs) {
      const s = statusEl ? statusEl.textContent : '';
      if (s !== '__PENDING__' && !/^Processing /.test(s)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return {
      status: statusEl ? statusEl.textContent : null,
      ms: Math.round(performance.now() - t0),
      timedOut: performance.now() - t0 >= timeoutMs,
      fileSize: file.size, fileType: blob.type
    };
  };

  window.__T.snapshot = function () {
    const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
    const assets = ME ? ME.getAllAssets().map(a => ({
      id: a.id, name: a.name, type: a.type,
      fmt: a.metadata && a.metadata.format, cat: a.metadata && a.metadata.category,
      valid: a.metadata && a.metadata.valid,
      dur: a.duration, w: a.width, h: a.height, loaded: a.loaded,
      thumb: !!a.thumbnail, wave: a.waveform ? a.waveform.length : 0,
      elErr: a.element && a.element.error ? (a.element.error.code + ':' + (a.element.error.message || '')) : null
    })) : [];
    const clips = {};
    (window.state && state.tracks || []).forEach(t => {
      if (t.clips && t.clips.length) clips[t.id] = t.clips.map(c => ({ name: c.name, assetId: c.assetId, dur: +(c.duration || 0).toFixed(2), start: c.startTime }));
    });
    return {
      assets, clips,
      explorerMedia: document.querySelectorAll('#catalog-media-grid > div').length,
      explorerAudio: document.querySelectorAll('#catalog-audio-list > div').length,
      duration: window.state && state.duration,
      errors: window.__T.errors, warns: window.__T.warns
    };
  };

  window.__T.reset = function () {
    const ME = window.ForgeCut && window.ForgeCut.MediaEngine;
    if (ME) ME.getAllAssets().forEach(a => { try { ME.removeAsset(a.id); } catch (e) { } });
    (window.state && state.tracks || []).forEach(t => t.clips = []);
    const g = document.getElementById('catalog-media-grid'); if (g) g.innerHTML = '';
    const l = document.getElementById('catalog-audio-list'); if (l) l.innerHTML = '';
    if (window.assetCache) assetCache.clear();
    window.__T.errors = []; window.__T.warns = [];
    try { renderTimeline(); } catch (e) { }
    return 'reset';
  };

  /* Playback probe: seek to t, let the engine sync, report what the media elements actually did. */
  window.__T.playbackProbe = async function (seekTo, playMs) {
    seekTo = seekTo == null ? 1 : seekTo;
    playMs = playMs || 1200;
    const ME = window.ForgeCut.MediaEngine;
    try { setTime(seekTo); } catch (e) { return { error: 'setTime threw: ' + e.message }; }
    await new Promise(r => setTimeout(r, 400));
    const before = ME.getAllAssets().map(a => ({ id: a.id, ct: a.element && a.element.currentTime }));
    try { play(); } catch (e) { return { error: 'play threw: ' + e.message }; }
    await new Promise(r => setTimeout(r, playMs));
    const after = ME.getAllAssets().map(a => ({
      id: a.id, type: a.type, ct: a.element && a.element.currentTime,
      paused: a.element && a.element.paused, err: a.element && a.element.error ? a.element.error.code : null
    }));
    try { pause(); } catch (e) { }
    const advanced = after.map((a, i) => ({ id: a.id, type: a.type, from: before[i] && before[i].ct, to: a.ct, moved: (a.ct - (before[i] ? before[i].ct : 0)) > 0.15, paused: a.paused, err: a.err }));
    return { timelineTime: window.state && state.currentTime, advanced, errors: window.__T.errors };
  };

  /* Canvas probe: is the preview actually painting non-blank pixels? */
  window.__T.canvasProbe = function () {
    const c = document.getElementById('renderCanvas');
    if (!c) return { error: 'no canvas' };
    try {
      const cx = c.getContext('2d');
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let nonBlank = 0; const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) {
        const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
        seen.add(k);
        if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) nonBlank++;
      }
      return { w: c.width, h: c.height, nonBlankSamples: nonBlank, distinctColors: seen.size };
    } catch (e) { return { error: e.message }; }
  };

  return 'ok';
})();

/* Full per-file test: reset -> import via real UI -> inspect explorer/timeline/preview/playback. */
window.__T.runOne = async function (fileName, kind, opts) {
  opts = opts || {};
  window.__T.reset();
  await new Promise(r => setTimeout(r, 120));
  const rec = { file: fileName, kind: kind };
  try {
    rec.import = await window.__T.importViaUI(fileName, kind, opts.timeout || 30000);
  } catch (e) {
    rec.import = { status: 'HARNESS_ERROR: ' + e.message };
    rec.snap = window.__T.snapshot();
    return rec;
  }
  const snap = window.__T.snapshot();
  rec.assets = snap.assets;
  rec.clips = snap.clips;
  rec.explorerMedia = snap.explorerMedia;
  rec.explorerAudio = snap.explorerAudio;
  rec.errors = snap.errors;
  rec.warns = snap.warns;

  const clipCount = Object.values(snap.clips).reduce((n, a) => n + a.length, 0);
  if (clipCount > 0 && !opts.skipPreview) {
    const seek = opts.seek == null ? 1 : opts.seek;
    try { setTime(seek); renderCanvasComposition(); } catch (e) { rec.previewError = e.message; }
    await new Promise(r => setTimeout(r, 500));
    rec.preview = window.__T.canvasProbe();
    if (!opts.skipPlayback) rec.playback = await window.__T.playbackProbe(seek, opts.playMs || 1200);
  }
  return rec;
};

window.__T.runMany = async function (list, opts) {
  const out = [];
  for (const [f, k] of list) out.push(await window.__T.runOne(f, k, opts));
  return out;
};
