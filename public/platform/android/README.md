# Android presentation layer

Not yet built. See `ARCHITECTURE.md` for the boundary rules.

Material 3 Expressive, mobile-first interaction patterns.

Constraints:

- Consume the shared engine in `public/engine/`; do not fork it.
- Do NOT modify `platform/windows/` or `platform/macos/`.
- Do NOT shrink the desktop Ribbon onto a phone, and do not reuse the macOS UI.
- Behavioural/product inspiration from Instagram Edits is fine; its branding,
  assets and proprietary UI are not.

When this layer lands, delete the stopgap phone Ribbon rules in `editor.css`
(the `max-width: 768px` blocks that collapse ribbon groups into chips and turn
the side panels into drawers). They exist only so narrow windows are not broken
today and must not become the Android UI.

Verify with `node scripts/check-platform-boundaries.js` before committing.
