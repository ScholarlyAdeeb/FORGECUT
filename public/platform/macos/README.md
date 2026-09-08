# macOS presentation layer

Not yet built. See `ARCHITECTURE.md` for the boundary rules.

Apple Human Interface Guidelines and Liquid Glass guidance: toolbar, sidebar,
inspector, menus, popovers, sheets, SF Symbols, Command-key shortcuts, trackpad
interaction, and macOS-appropriate spacing and motion.

Constraints:

- Consume the shared engine in `public/engine/`; do not fork it.
- Do NOT modify `platform/windows/`. The Ribbon is a protected baseline.
- Do NOT introduce a Ribbon here, and do not port Windows controls across.

Verify with `node scripts/check-platform-boundaries.js` before committing.
