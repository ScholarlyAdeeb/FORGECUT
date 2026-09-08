# macOS presentation layer

ForgeCut for macOS. Open `/platform/macos/` (the Windows shell stays at `/`).

Apple HIG + Liquid Glass. Menu bar + toolbar + sidebar + inspector — **no
Ribbon**; the Ribbon is a Windows pattern and stays there.

```
index.html        macOS shell — loads the shared engine, no Windows components
macos.css         design tokens, glass materials, layout, light/dark
MacShell.js       menu bar, toolbar, sidebar, transport, status, shortcuts
MacTimeline.js    multi-track timeline presentation
MacInspector.js   contextual inspector
MacMenus.js       popovers, menus, sheets, context menus
```

## What is shared and what is not

This layer owns **presentation only**. Every command delegates to the shared
command layer (`triggerUndo`, `timelineCopy`, `setTransition`,
`handleAssetUpload`, `startBulkExport`, …). It defines no editing behaviour of
its own, and playback runs through the shared `PlaybackEngine` — there is no
second playback system.

Two shells consume the same engine and the same `state`.

## Liquid Glass placement

The HIG skill's own guidance decides this:

> **When NOT to use Liquid Glass:** Photo/video editing — glass effects compete
> with the content being edited.

So glass is on chrome that floats over content, and nowhere near the picture:

| Glass | Opaque |
| --- | --- |
| menu bar | preview stage and canvas |
| toolbar | timeline surface, lanes, clips |
| sidebar source list (HIG: translucent on macOS) | inspector body |
| floating transport | status bar |
| popovers, menus | |
| inspector sticky header | |

Exactly five glass surfaces, verified in the running app. Clips carry **no**
`backdrop-filter` — there can be hundreds, and glass there would be both wrong
and expensive.

Fallbacks: `@supports not (backdrop-filter)` and
`prefers-reduced-transparency: reduce` both drop to opaque surfaces.

## Keyboard

The shared handler in `editor/editor-interaction.js` already
treats `metaKey` as Ctrl, so ⌘Z, ⌘C, ⌘V, ⌘N, Space and Delete reach the right
commands unaided. **Re-binding those here would run each command twice.**

This layer therefore claims only what the shared layer misses or maps
differently, in the capture phase:

| Chord | Why it is claimed here |
| --- | --- |
| ⇧⌘Z | shared handler ignores `shiftKey`, so ⇧⌘Z would *undo* |
| ⌘S | shared ⌘S only raises a toast; macOS saves for real |
| ⌘X ⌘D ⌘E ⌘I, `S` | unbound in the shared layer |
| ⌥⌘S ⌥⌘I | macOS-only sidebar/inspector toggles |

Timeline zoom is **not** re-implemented: the shared zoom commands drive
`state.zoom`, and this layer mirrors that onto the timeline.

## Notes for the next person

- `updateInspector()` in the Windows layer writes to `.inspector-section`
  without a null guard. The shell provides a hidden sink element so those
  writes land harmlessly rather than throwing. Removing protected Windows code
  was not an option; delete the sink if that guard is ever added.
- The shell loads the shared command layer from `editor/`. Most of its files
  still carry Windows rendering, which is inert here because the Ribbon DOM is
  absent; the boundary checker prints that count every run as tracked debt.
- Do not introduce Material 3 or mobile patterns here. Narrow Mac windows stay
  a desktop layout: the sidebar yields first, as in Xcode and Final Cut.

Verify with `npm run check:boundaries`.
