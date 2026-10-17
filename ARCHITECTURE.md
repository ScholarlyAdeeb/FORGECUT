# ForgeCut architecture

One shared editing engine, separate platform presentation layers.

**Shared logic ≠ shared UI.** A clip has the same duration, source, effects and
timeline position on every platform. The controls used to manipulate it are
expected to be completely different on Windows, macOS and Android.

```
public/
  engine/              shared editor engine — no platform UI at all
  editor/              shared command layer — state, commands, import, history
  platform/
    windows/           Microsoft Office / Fluent Ribbon  (protected baseline)
    macos/             Apple HIG + Liquid Glass
    android/           Material 3 Expressive             (not yet built)
  workers/             shared off-thread work
  index.html           the Windows shell
  platform/macos/index.html   the macOS shell
```

Every shell loads `engine/` + `editor/` and then exactly one platform's
presentation. Nothing under `platform/` is loaded by more than one shell.

## The rule

Before any UI change, ask: *am I changing shared editor behaviour, or platform
presentation?* If it is presentation, the change stays inside that platform's
directory.

1. Never redesign one platform's UI to make another platform easier.
2. Never replace a platform-specific component with a generic one purely for
   code reuse.
3. Prefer sharing behaviour and state over sharing visual components.
4. The Windows Ribbon UI is a protected baseline. It is not to be generalised,
   modernised or converted to another platform's patterns.

This is enforced, not just documented:

```bash
node scripts/check-platform-boundaries.js
```

It fails if `engine/` references an id owned by a platform layer, or if one
platform reaches into another. Run it before committing UI work.

## Shared engine — `public/engine/`

| File | DOM coupling | Notes |
| --- | --- | --- |
| `AnimationEngine.js` | none | pure |
| `AudioEngine.js` | none | pure |
| `HistoryManager.js` | none | pure — undo/redo snapshots |
| `TextRenderer.js` | none | pure |
| `TransitionEngine.js` | none | pure |
| `ShapeRenderer.js` | canvas only | draws into a 2D context |
| `MediaEngine.js` | media elements | import, decode, thumbnails, waveforms |
| `ExportEngine.js` | canvas / ffmpeg | |
| `PlaybackEngine.js` | media elements | reports transport via an event, see below |
| `Effects.js` | none | pure: effect stack model, params, CPU reference |
| `Compositor.js` | OffscreenCanvas / WebGL2 | runs effect stacks on the GPU, see below |
| `SmartEdit.js`, `Captions.js`, `Reframe.js` | none | pure: silence, scenes, captions, reframe maths |

None of these reference a platform's DOM. `PlaybackEngine` used to write
directly into the Ribbon's transport icons; it now emits:

```js
window.addEventListener('forgecut:transport', (e) => {
  e.detail; // { icon: 'pause' | 'play_arrow', isPlaying: boolean }
});
```

Each platform decides how to render that. The Windows listener lives in
`editor/editor-transport.js`.

## Effects and the GPU compositor

A video or image clip may carry `clip.effects`, an ordered stack:

```json
[{ "id": "fx_ab12", "type": "adjust", "enabled": true, "params": { "brightness": 1.2 } }]
```

- **One render path.** `renderCanvasComposition` is still the only entry
  point. For a clip with a non-empty, non-neutral stack it hands the source
  frame to `Compositor.process()`, which returns a surface **the same size as
  the source**. The existing crop/position/scale code then draws that instead
  of the raw element. A clip without effects takes exactly the old path.
- **Export-safe.** The compositor renders into an `OffscreenCanvas`, never
  needs a visible canvas or `requestAnimationFrame`, and does no `readPixels`.
- **Colour space: sRGB-encoded values, 0..1**, the same space as `ctx.filter`.
  Measured in Chrome: the GPU `adjust` matches `ctx.filter` within 3/255
  (mean 0.67). An effect that needs linear light must convert inside its own
  pass and say so.
- **Keyframes.** Every numeric param is animatable as `fx.<effectId>.<param>`
  in `clip.keyframes`, so effects split, ripple, undo and export with no extra
  code.
- **Parity gate.** `Effects.applyReference` defines each effect on the CPU.
  `Compositor.selfTest()` renders a fixed test card through both and compares
  against `Compositor.TOLERANCE` (max 3, mean 0.75 per 8-bit channel). It runs
  once per device on first use, and any effect type that fails is routed to
  the CPU on that device. Without WebGL2 the whole stack runs on the CPU:
  slower, same result.
- **Adding an effect** = an entry in `Effects.EFFECTS`, a reference function,
  a shader pass in `Compositor.js`, and a self-test case. Both inspectors build
  their controls from the param schema, so no UI work is needed per effect.

## Windows — `public/platform/windows/`

`components/` builds the Ribbon, sidebar, preview, timeline, export queue,
backstage and bulk drawer. `RibbonScaler.js` implements Office-style
progressive ribbon scaling and the Ribbon Display Options menu.

That is the whole Windows layer — 9 files. The commands its Ribbon invokes live
in the shared `editor/` layer, not here.

## Shared command layer — `public/editor/`

Project state, media import, timeline data, clip commands, undo wiring and
export. Both shells load it; neither owns it.

16 files, of which **14 still carry the Windows rendering they were split
from**. That rendering is inert on other platforms because the Ribbon DOM is
absent, which is why macOS can consume the layer unchanged. The boundary
checker prints that count on every run so the debt cannot quietly grow.

This directory briefly lived under `platform/windows/` on the grounds that most
of its files touch Windows DOM. Building the macOS layer disproved that: both
shells load all 16 files identically, so the *behaviour* is shared and only the
rendering is Windows-flavoured. It belongs in a shared location.

### Known debt

Two files here contain no Windows-specific DOM at all and are the cleanest
candidates to promote into `engine/`:

- `editor-render.js` (486 LOC) — canvas compositing, identical on every platform
- `editor-clips.js` (109 LOC)

Both depend on globals declared in `editor-core.js` (`state`, `canvas`,
`assetCache`). Promoting them to `engine/` without an explicit state handle
would invert the dependency — the engine relying on globals a sibling layer
declares — so the state handle comes first.

Also deliberately outstanding: the phone layout in `editor.css` collapses the
Ribbon into chips below 768px. That contradicts the rule against shrinking the
desktop Ribbon onto a phone, and is kept only as a stopgap so narrow windows are
not broken. **It is to be deleted when the Android layer lands**, not evolved
into the Android UI.

## macOS — `public/platform/macos/`

Built. Served at `/platform/macos/`; the Windows shell stays at `/`.

Apple HIG + Liquid Glass, in a menu bar + toolbar + sidebar + inspector model.
There is no Ribbon here — that is a Windows pattern. The shell loads the shared
engine and the shared command layer and **none** of the Windows components, so
the Ribbon's rendering functions are simply absent rather than restyled.

Liquid Glass placement follows the HIG skill's own constraint — *"When NOT to
use Liquid Glass: Photo/video editing — glass effects compete with the content
being edited"* — so glass sits only on chrome that floats over content (menu
bar, toolbar, sidebar source list, floating transport, popovers, inspector
header) and never on the preview, timeline, lanes or clips.

See `public/platform/macos/README.md` for the file map, the glass audit, and
the keyboard-ownership split between this layer and the shared handler.

## Android — `public/platform/android/`

Not yet built. Material 3 Expressive, mobile-first. Behavioural inspiration from
Instagram Edits is acceptable; its branding, assets and proprietary UI are not.

Do not shrink the desktop Ribbon onto a phone, and do not reuse the macOS UI.
