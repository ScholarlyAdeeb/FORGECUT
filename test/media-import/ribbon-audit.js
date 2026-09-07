/* ForgeCut ribbon audit — invokes every ribbon control and reports whether it
   actually changed anything. Blocking dialogs are auto-answered. */
(function () {
  const A = window.__A = {};

  A.toasts = [];
  A.errors = [];
  const _err = console.error;
  console.error = function (...a) { A.errors.push(a.map(String).join(' ')); _err.apply(console, a); };
  window.addEventListener('error', e => A.errors.push('onerror: ' + (e.message || '')));
  window.addEventListener('unhandledrejection', e => A.errors.push('rejection: ' + (e.reason && (e.reason.message || e.reason) || '')));

  // Auto-answer modal helpers so the audit never blocks.
  A.installStubs = function (answers) {
    answers = answers || {};
    if (A._installed) A.restoreStubs();   // never wrap a wrapper
    A._installed = true;
    A._realPrompt = window.fcPrompt;
    A._realConfirm = window.fcConfirm;
    A._realToast = window.fcToast;
    A._realAlert = window.fcAlert;
    window.fcPrompt = async (msg, def) => (answers.prompt !== undefined ? answers.prompt : (def || 'test'));
    window.fcConfirm = async () => (answers.confirm !== undefined ? answers.confirm : true);
    window.fcAlert = async () => true;
    window.fcToast = (m) => { A.toasts.push(String(m)); if (A._realToast) A._realToast(m); };
  };
  A.restoreStubs = function () {
    A._installed = false;
    if (A._realPrompt) window.fcPrompt = A._realPrompt;
    if (A._realConfirm) window.fcConfirm = A._realConfirm;
    if (A._realToast) window.fcToast = A._realToast;
    if (A._realAlert) window.fcAlert = A._realAlert;
  };

  /* A fingerprint of everything a ribbon button could plausibly change. */
  A.fingerprint = function () {
    const s = window.state || {};
    const clips = {};
    (s.tracks || []).forEach(t => { clips[t.id] = (t.clips || []).map(c => JSON.stringify(c)).join('|'); });
    const canvas = document.getElementById('renderCanvas');
    return JSON.stringify({
      clips,
      duration: s.duration, currentTime: s.currentTime, zoom: s.zoom,
      selectedClipId: s.selectedClipId, isPlaying: s.isPlaying,
      canvasW: s.canvasWidth || (canvas && canvas.width), canvasH: s.canvasHeight || (canvas && canvas.height),
      bgType: s.bgType, bgColor: s.bgColor, bgGradientStart: s.bgGradientStart, bgImageUrl: s.bgImageUrl,
      safeArea: s.showSafeAreaGuide, safePlatform: s.safeAreaPlatform, safeZoneConfig: s.safeZoneConfig,
      selectedRowIndex: s.selectedRowIndex,
      clipboard: window.clipboard ? JSON.stringify(window.clipboard) : null,
      undoCount: window.ForgeCut && window.ForgeCut.HistoryManager ? window.ForgeCut.HistoryManager.undoCount : null,
      redoCount: window.ForgeCut && window.ForgeCut.HistoryManager ? window.ForgeCut.HistoryManager.redoCount : null,
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className,
      // visible overlays / dialogs
      overlays: Array.from(document.querySelectorAll('[id*="overlay" i],[id*="Overlay" i],[id*="dialog" i],[id*="Dialog" i],[id*="modal" i]'))
        .map(e => e.id + ':' + (e.classList.contains('hidden') ? 'hidden' : (getComputedStyle(e).display === 'none' ? 'none' : 'shown'))).join(','),
      rightTab: (document.querySelector('.right-tab-btn.active,[data-right-tab].active') || {}).dataset
        ? JSON.stringify((document.querySelector('[data-right-tab].active') || {}).dataset || {}) : null,
      canvasPixels: (function () {
        try {
          const c = document.getElementById('renderCanvas'); if (!c) return null;
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let h = 0; for (let i = 0; i < d.length; i += 4 * 701) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1e9;
          return h;
        } catch (e) { return null; }
      })()
    });
  };

  /* Run one control: fingerprint, invoke, fingerprint again. */
  A.run = async function (label, fn, opts) {
    opts = opts || {};
    A.toasts = []; A.errors = [];
    const before = A.fingerprint();
    let threw = null;
    const t0 = performance.now();
    try {
      const r = fn();
      if (r && typeof r.then === 'function') await r;
    } catch (e) {
      threw = (e && (e.message || String(e))) || 'threw';
    }
    await new Promise(r => setTimeout(r, opts.settle || 260));
    const after = A.fingerprint();
    let verdict;
    if (threw) verdict = 'THREW';
    else if (before !== after) verdict = 'CHANGED';
    else if (A.toasts.length) verdict = 'TOAST-ONLY';
    else verdict = 'NO-OP';
    return {
      control: label, verdict, threw,
      toasts: A.toasts.slice(0, 2),
      errors: A.errors.slice(0, 2),
      ms: Math.round(performance.now() - t0)
    };
  };

  A.runAll = async function (cases, opts) {
    const out = [];
    for (const [label, fn, o] of cases) out.push(await A.run(label, fn, Object.assign({}, opts, o)));
    return out;
  };

  return 'ribbon audit ready';
})();
