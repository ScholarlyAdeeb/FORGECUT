# ForgeCut architecture

One shared editing engine, separate platform presentation layers.

**Shared logic ≠ shared UI.** A clip has the same duration, source, effects and
timeline position on every platform. The controls used to manipulate it are
expected to be completely different on Windows, macOS and Android.

```
public/
  engine/              shared editor engine — no platform UI
  platform/
    windows/           Microsoft Office / Fluent Ribbon  (protected baseline)
    macos/             Apple HIG + Liquid Glass          (not yet built)
    android/           Material 3 Expressive             (not yet built)
  workers/             shared off-thread work
  index.html           currently the Windows shell
```

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
| `KeyboardShortcuts.js` | key events | command *semantics*; platform layers own the chords they surface |

None of these reference a platform's DOM. `PlaybackEngine` used to write
directly into the Ribbon's transport icons; it now emits:

```js
window.addEventListener('forgecut:transport', (e) => {
  e.detail; // { icon: 'pause' | 'play_arrow', isPlaying: boolean }
});
```

Each platform decides how to render that. The Windows listener lives in
`platform/windows/editor/editor-transport.js`.

## Windows — `public/platform/windows/`

`components/` builds the Ribbon, sidebar, preview, timeline, export queue,
backstage and bulk drawer. `editor/` is the Windows controller layer: it owns
the Ribbon command handlers, the inspector, timeline interaction and the
Windows-specific DOM. `RibbonScaler.js` implements Office-style progressive
ribbon scaling and the Ribbon Display Options menu.

### Known debt

`platform/windows/editor/` is shared behaviour wearing Windows rendering. The
macOS shell consumes it (its Windows rendering no-ops when the Ribbon DOM is
absent), which the boundary checker reports on every run as a tracked
exception. Extracting the command layer into `engine/` is the natural next
structural step, and would remove that exception.

Two files there contain no Windows-specific DOM at all and are the first
candidates to move into the shared engine:

- `editor-render.js` (486 LOC) — canvas compositing, identical on every platform
- `editor-clips.js` (109 LOC)

They are not extracted yet because both depend on globals declared in
`editor-core.js` (`state`, `canvas`, `assetCache`). Extracting them means giving
the engine an explicit state handle first. Until then they stay with the Windows
layer rather than being falsely advertised as shared.

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
