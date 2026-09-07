---
name: frontend-visual-qa
description: "Require real-browser visual QA before finalizing frontend work: apps, websites, dashboards, games, components, or design changes. Use when an agent builds or modifies UI and must confirm it actually renders well with desktop and mobile screenshots, responsive layout checks, overflow and clipping checks, loading/empty/error states, keyboard navigation and focus visibility, real assets, design-system consistency, and no decorative clutter."
---

# Frontend Visual QA

## Purpose

Catch the gap between code that looks plausible and UI that actually renders well in a browser. Verify the rendered product, not the source. Browser screenshots and interaction checks are required evidence for frontend work.

## Browser Toolchain

This skill requires a real browser or browser automation environment. Without one you cannot satisfy these checks. Do not substitute source reading for rendered UI verification.

Use whatever real-browser path is available in the environment, such as:

- Playwright, WebDriver, Cypress, Puppeteer, browser MCP tools, Chrome DevTools, or an in-app browser.
- A local browser against a running dev server, if automation is unavailable but screenshots and interaction checks can still be performed.

Confirm the browser path works before starting. If no browser-based verification path is available, stop and ask the user to provide one rather than faking the QA.

## Scale Effort To The Change

Match the depth of QA to the size and risk of the change. Do not run the full battery on a trivial edit, and do not skip it on a risky one.

- **Trivial** (single style tweak, copy change, color/spacing nudge): run the Core checklist on the affected view at desktop + mobile. One or two screenshots can suffice.
- **Feature or component** (new component, changed layout, new page): Core, plus the Context-Dependent checks that apply to what changed.
- **Large or risky** (new dashboard, responsive rework, design-system change, anything data-driven): Core plus all relevant Context-Dependent checks, with state and viewport coverage.

When in doubt, do more. State what you scoped and why in the report.

## Core (Always)

Non-negotiable for any frontend change:

1. Run the app or static page in the real browser.
2. Capture screenshots at desktop and mobile widths (see Viewports).
3. Scan each screenshot for overflow, clipping, broken/awkward spacing, bad text wrapping, layout shift, and overlapping elements.
4. Exercise the main user path with pointer or touch.
5. Confirm real assets render: images, icons, fonts, video, canvas, charts, maps, generated media — no placeholder boxes.
6. Confirm it matches the existing design system: component conventions, spacing rhythm, typography, interaction patterns.
7. Fix what you find, reload, and rerun the affected checks until clean.

If browser execution is genuinely impossible, say exactly why and give the best fallback evidence. Do not pretend source inspection equals visual QA.

## Context-Dependent Checks

Run these when the change touches the relevant area.

### Viewports

- Desktop: a common wide viewport such as `1440x900` or `1280x800`.
- Mobile: a narrow viewport such as `390x844` or `375x667`, or a device preset.
- Add tablet or extra breakpoints when the layout changes there, the product is used there, or responsive behavior is risky.

### State Coverage

Don't only screenshot the happy, full-data state. Capture the states that break layout, using mocked data or request interception when the app supports it:

- First load and loading skeletons.
- Empty lists, empty search results, first-run screens.
- Long names, long labels, long table cells, multi-line text.
- Validation errors and failed network states.
- Disabled buttons and unavailable actions.
- Modals, menus, drawers, popovers, tabs, accordions, tooltips.
- Authenticated and unauthenticated states when relevant.
- Dense data and sparse data.

### Interaction And Accessibility

For interactive UI:

- Tab reaches the expected controls in a logical order, with visible focus on buttons, links, inputs, menus, and custom controls.
- Enter, Space, Escape, and arrow keys work where users expect them.
- Menus, dialogs, popovers, and drawers open and dismiss without a mouse.
- Labels, names, and roles are present enough for accessible locators and basic screen-reader interpretation.
- No interaction requires hover-only on touch or keyboard paths.

Automated a11y scans help but do not replace manual keyboard and visual checks.

## Visual Quality Bar

The defects to flag and fix when scanning (Core step 3) — distinct from State Coverage, which is *which* states to capture:

- Horizontal overflow, clipped content, or text escaping buttons, cards, tables, inputs, tabs, nav items, or badges.
- Elements that overlap incoherently, or scrollbars caused by accidental widths.
- Spinners or skeletons that jump the layout; empty states that collapse or offer no next action.
- Inconsistent button sizing, icon alignment, border radius, shadow, color, or spacing.
- Decorative blobs, random gradients, oversized cards, generic stock imagery, or ornament that does not serve the product.
- Layouts that look fine in code but awkward in the browser.

Prefer restrained, purposeful UI. Visual interest should come from the product, content, and useful data — not filler decoration.

## Reporting (Evidence)

When claiming the work is done, include:

- Browser/automation tool and the desktop + mobile viewport sizes used.
- What you scoped and why (per Scale Effort To The Change).
- Pages and states checked, with screenshot paths or links.
- Issues found and fixed.
- Remaining visual risks for any state that could not be checked.

A claim that the UI is done must be backed by rendered browser evidence.
