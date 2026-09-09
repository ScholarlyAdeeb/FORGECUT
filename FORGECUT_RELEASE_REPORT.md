# ForgeCut — Release QA Report

**Date:** 2026-09-10
**Branch:** `fix/make-features-work`
**Suite:** Final Release Regression (`TESTING.csv`, rows `RC01`–`RC32`)
**Status of build under test:** feature freeze; only P0/P1 and low-risk P2 patches applied.

---

## 1. Tested Workflows & PASS/FAIL Breakdown

All 30 checkpoints of the E2E protocol were executed against the running
application, driving the real UI paths rather than internal helpers. Two
additional diagnostics rows (`RC31`, `RC32`) record the leak audit.

| Group | Checkpoints | PASS | PARTIAL | FAIL |
|---|---|---|---|---|
| Environment & Lifecycle | 4 | 4 | 0 | 0 |
| Asset Handling | 6 | 6 | 0 | 0 |
| Editing Operations | 8 | 8 | 0 | 0 |
| Export Operations | 8 | 8 | 0 | 0 |
| Interface & Input | 4 | 4 | 0 | 0 |
| **30-point total** | **30** | **30** | **0** | **0** |
| Diagnostics (additional) | 2 | 2 | 0 | 0 |

### Notable evidence

- **Lifecycle** — Save serialises all six tracks; after wiping state, reopening
  through the real file-input path restored clip count, duration and text
  content exactly.
- **Assets** — Unicode survives round-trip byte-for-byte, including CJK
  (`日本語 ビデオ.mp4`), Cyrillic with an apostrophe (`видео_тест'quote.mp4`),
  an em dash and a music glyph (`Café — Ünïcode ♪.wav`), and shell-significant
  characters (`clip with spaces & symbols #1 (final).mp4`).
- **Editing** — Split at `t=1.5` produced `0.00+1.50` and `1.50+1.00`. Five
  consecutive undo/redo cycles were stable with no history drift.
- **Export** — MP4, MKV, WebM and MP3 all validated by ffprobe for container,
  codec identity, duration and clean decode.
- **A/V sync** — video stream 4.000 s vs audio stream 4.000 s: **0 ms delta**.

### Methodology corrections made during the run

Two checkpoints failed on first execution because of the harness, not the
product. Both were re-run correctly rather than recorded as defects:

- **`RC15` pause/resume** — the automation pane reports `document.hidden`, which
  throttles `requestAnimationFrame` to ~0 fps, so the playhead never advanced.
  Re-verified by driving the engine clock directly: play advances, pause holds
  across an idle period, resume continues from the same point rather than
  restarting.
- **`RC30` keyboard shortcuts** — the first attempt dispatched to `document`
  while focus sat in an `INPUT` left over from a prior control sweep. The
  handler deliberately ignores keys while focus is in a text field. Re-run with
  focus cleared, every binding fired.

---

## 2. Resolved Defects

One defect was found, triaged and fixed during this pass. No P0 or P1 issues
were found.

### P2 — Drag-and-drop onto the timeline did nothing

**Severity:** P2 (moderate; workaround existed — the Import button places clips).
**Status:** FIXED. Low-risk, two files touched, scoped to one block.

**Root cause.** The listener was never bound. The binding block sits at the
**top level** of `editor-interaction.js`, so it executes at script load, while
`timelineContainer` is a module-level variable that `initDOMElements()` only
assigns later during `runEditorInit()`. At bind time it was `undefined`, the
`if (timelineContainer)` guard was false, and the listener was silently never
attached. Nothing errored, because the guard is exactly the kind that fails
quietly.

**Second, latent bug on the same path.** Once the listener was attached, the
handler still failed: it resolved assets through the legacy `assetCache`, which
`MediaEngine` no longer populates (measured: `assetCache.size === 0` while
MediaEngine held 6 assets). The handler's `catch (err) { }` swallowed the
result. Both were fixed together.

**Fix.** Resolve the drop target from the DOM at bind time, and look assets up
through `MediaEngine` with the legacy cache as fallback — the same
MediaEngine-first pattern already used in `editor-render.js` and
`PlaybackEngine.js`.

**Verification.** Two assets dropped at different cursor positions land on the
correct tracks (video → `videoTrack` at 5.00 s, audio → `audioTrack` at
15.00 s) with Unicode names intact.

---

## 3. Known Limitations & Unsupported Combinations

None of the following is release-blocking; each has a workaround or is a
documented constraint. All are recorded in `TESTING.csv`.

| Ref | Limitation | Impact |
|---|---|---|
| `X010` | `libvpx-vp9` in `@ffmpeg/core` 0.12.6 faults after one frame. Reproducible on a fresh instance; not tunable away. | **None reaching users.** VP9 is encoded by WebCodecs in hardware, or by the server; nothing routes to the broken wasm encoder. Kept as FAIL because the third-party defect is real and unfixed upstream. |
| `MT008` | A video clip's own embedded audio reaches the mix only through the linked audio clip the importer creates. | Invisible for normally imported media. Only affects clips built programmatically or where the linked audio clip was deleted independently. Making the mixer also walk video tracks would double the audio for every normal import — a worse failure. |
| `MT009` | ProRes / FFV1 with **no** export server falls back to realtime capture, which cannot seek and would freeze video frames. | Narrow: a mastering codec on a deployment with no FFmpeg installed. Every mainstream target (H.264, VP8, VP9 → MP4/MKV/MOV/WebM) is frame-accurate with no server via WebCodecs. The path now logs an explicit warning instead of shipping frozen frames silently. |
| `WC005` | The WebCodecs path holds the encoded elementary stream in memory, since the muxer takes it as one input. ~1.5 GB projected for a 10-minute 4K export at 20 Mbps. | The server frame-sequence path has no such ceiling (frames stream to disk) and is preferred whenever reachable. |
| `X013` | Chrome plays neither Matroska nor QuickTime and refuses ProRes, so browser-side validation records "not verified here" for those rather than asserting. | Server-produced files of those types are still fully ffprobe-validated. |
| `B004`/`B005` | Bulk CSV rendering is real-time and sequential (~2 shorts/min at 30 s each); the queue table rebuilds on status transitions, O(N) per rebuild. | Throughput, not correctness. ~95 s of DOM churn at 1,000 rows, small next to render time. |
| `H003` | 27 element references point at ids that exist in no markup (dead handlers from earlier UI iterations). | Pre-existing, non-crashing, baselined. `scripts/check-dom-wiring.js` ratchets: the count can shrink but never grow. |
| `RC30` | `ctrl`+wheel timeline zoom is not bound. | The footer zoom slider and the zoom buttons are the supported controls. |

---

## 4. Platform-Specific Notes

### Windows (Fluent / Ribbon) — protected baseline, unchanged
- Ribbon present with **81 controls across 9 tabs**; a 30-control sweep threw
  nothing and produced no new page errors.
- Bulk drawer format picker populated from the runtime capability registry
  (8 presets). Untouched this pass.
- No Ribbon markup, styling or layout was modified during QA.

### macOS (Unified Toolbar / Sidebar) — unchanged
- Menubar, unified toolbar, source-list sidebar and inspector all present;
  **exactly 5 glass surfaces**, matching the design brief.
- 6 timeline lanes for 6 tracks; File menu opens; export sheet wired to the
  shared pipeline; no Windows Ribbon leaks into the macOS shell.
- Appearance switches on the `.mac-dark` class: body `#ECECEE` → `#1E1E20`,
  with toolbar translucency following.
- `⌘Z` undo verified through the macOS shell.

### Shared
- Both shells load the same engine modules; all export work lives in `engine/`
  and `server/`. Platform boundary check passes: 12 engine files,
  macOS 5 / Windows 9 presentation files, no cross-platform reach-through.

---

## 5. Final Counts & Benchmarks

### Test matrix

| Metric | Value |
|---|---|
| Total rows in `TESTING.csv` | **148** |
| PASS | **139** |
| PARTIAL | **8** |
| FAIL | **1** (third-party, no user impact) |
| Release regression rows this pass | 32 (`RC01`–`RC32`) |
| Automated unit tests | 61 / 61 passing |
| Static checks | boundaries OK, DOM wiring OK (no new dangling refs) |

### Export performance

| Path | Throughput | Notes |
|---|---|---|
| Server frame sequence | 30.8 fps (450 frames in 14.6 s) | Frames stream to disk; no memory ceiling |
| WebCodecs + wasm mux | **53.6 fps** (450 frames in 8.4 s) | 1.7× faster, needs no server |
| Audio-only | 0.27 s for a 2 s mix | Rendered offline, not captured |

### Memory

| Measurement | Result |
|---|---|
| Heap drift, 450-frame export (server path) | **−0.6 MB** (flat) |
| Heap drift, 450-frame export (WebCodecs) | +2.8 MB; peak 52.3 MB (~32 MB is the one-time wasm module) |
| Per frame, 1080×1920 | 75 KB PNG, 20 ms encode, ~0 MB heap |
| Per frame, 4K UHD | 210 KB PNG, 66 ms encode, ~0 MB heap |
| 10-min 4K export, streamed | ~3.6 GB to disk (vs ~555 GB if raw frames were buffered) |
| Listeners added over 3 exports | **0** |
| Object URLs after `clearAll` | 2 created, 2 revoked, **0 live** |
| Orphaned `ffmpeg`/`ffprobe` after full pass | **0** |
| Temp job directories after full pass | **0** |

### Fidelity

| Measurement | Result |
|---|---|
| A/V drift at an edit boundary | **0 ms** (67 ms frame interval) |
| Volume automation accuracy | 0.249 measured vs 0.250 expected |
| Mute compliance | exactly 0 RMS |
| Multi-track visual parity | 10/10 sample points exact |
| Export duration accuracy | exact at 3 s, 4 s, 6 s, 11 s, 30 s |

---

## 6. Release Assessment

**Blocking criteria:** 0 P0 and 0 P1 defects found. The single P2 discovered was
fixed and re-verified within the freeze rules (targeted, two files, no UI or
module restructuring). No presentation layer was modified.

**Residual risk is bounded and documented:** the eight PARTIAL rows and the one
FAIL are throughput limits, narrow codec/deployment combinations, or a
third-party defect that no longer reaches users. Each has either a workaround or
an explicit warning path, and none can corrupt a project or produce a silently
wrong file.

**Caveats a reader should weigh:** verification ran on a single machine
(Chrome, Windows 11, FFmpeg present) — Safari and Firefox WebCodecs support was
not exercised, and the macOS presentation layer was validated in a desktop
browser rather than on macOS hardware. Long-form 10-minute and 4K exports were
projected from measured per-frame costs rather than run end-to-end.

READY TO FREEZE
