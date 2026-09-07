# Media-import test matrix

The results live in [`TESTING.csv`](../../TESTING.csv) at the repo root. This
directory holds the two things needed to reproduce them.

| File | What it is |
| --- | --- |
| `make-media.sh` | Regenerates the test corpus with ffmpeg into `public/__testmedia/` |
| `harness.js` | Browser harness that drives the app's real file inputs |

`public/__testmedia/` is gitignored — the corpus is ~2.2 GB, most of it the two
large-file cases.

## Running it

```bash
bash test/media-import/make-media.sh
npm start
```

Open the editor, create a project, then load the harness from the devtools
console:

```js
await new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = '/__testmedia/harness.js?v=' + Date.now();
  s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});
```

Then run a case, or the whole sweep:

```js
await window.__T.runOne('h264_aac.mp4', 'video');

await window.__T.runMany([
  ['h264_aac.mp4', 'video'], ['mpeg4.avi', 'video'],
  ['audio.wav', 'audio'],    ['image.webp', 'image'],
], { timeout: 25000 });
```

## How the harness imports

It does **not** call `importFile` directly. It builds a real `File`, assigns it
to the actual `<input type="file">` via `DataTransfer`, and dispatches `change`
— the same path a user's file picker takes, so `setupFileInputListeners` →
`handleAssetUpload` → `MediaEngine.importFile` all run for real.

| Method | Purpose |
| --- | --- |
| `__T.importViaUI(file, kind, timeout)` | One import through the real input; returns status bar text and elapsed ms |
| `__T.snapshot()` | Assets, per-track clips, Project Explorer counts, captured errors/warnings |
| `__T.runOne(file, kind, opts)` | reset → import → inspect explorer/timeline/preview/playback |
| `__T.runMany(list, opts)` | `runOne` over a list |
| `__T.canvasProbe()` | Samples `renderCanvas` pixels to prove the preview actually painted |
| `__T.playbackProbe(seek, ms)` | Seeks, plays, reports whether each media element advanced |
| `__T.reset()` | Clears assets, clips and Project Explorer between cases |

`kind` is `'video' | 'audio' | 'image'`, matching which of the three inputs the
user would have used.

## One caveat on playback

The automation pane runs with `document.hidden === true`, and
`PlaybackEngine._tick` deliberately freezes the clock while the tab is hidden.
So `state.currentTime` will **not** advance under `play()` in that environment —
that is correct behaviour, not a bug. To verify the clock, drive it the way the
tick would:

```js
const PE = window.ForgeCut.PlaybackEngine;
PE.bindState(state); play();
for (let i = 0; i < 10; i++) { PE.advanceTime(1 / 30); PE.syncAllMedia(); }
```

## Ribbon audit

`ribbon-audit.js` drives every ribbon control and reports whether it actually
changed anything. Load it the same way as `harness.js`, then:

```js
window.__A.installStubs({ confirm: true, prompt: '#123456' });  // auto-answer dialogs
const results = await window.__A.runAll([
  ['Home > Trim', () => triggerTrim()],
  ['Design > Brand Colors', () => uploadBrandAsset('colors')],
]);
window.__A.restoreStubs();
```

Each result is `CHANGED` / `TOAST-ONLY` / `NO-OP` / `THREW`, derived by
fingerprinting clips, canvas pixels, background, zoom, history depth, theme and
visible overlays before and after the call.

**Read NO-OP carefully — it has three known blind spots**, all of which produced
false positives during the audit:

- Controls that open a **native file picker** (`Insert > Image`, `Insert > GIF`,
  the Brand Kit buttons). `input.click()` cannot be satisfied headlessly.
- State held in **module-local variables** the fingerprint cannot reach, e.g.
  `clipboardClip` behind `Home > Copy`.
- Panels animated by **inline style** rather than a class, e.g. the bulk drawer
  opening via `style.height`.

Confirm any NO-OP against the handler itself before calling it a defect.
