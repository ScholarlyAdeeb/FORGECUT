---
name: ForgeCut Fluent Enterprise
colors:
  surface: '#f8f9ff'
  surface-dim: '#d7dae2'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3fc'
  surface-container: '#ebeef6'
  surface-container-high: '#e6e8f0'
  surface-container-highest: '#e0e2ea'
  on-surface: '#181c22'
  on-surface-variant: '#404752'
  inverse-surface: '#2d3137'
  inverse-on-surface: '#eef0f9'
  outline: '#717783'
  outline-variant: '#c0c7d4'
  surface-tint: '#0060ab'
  primary: '#005faa'
  on-primary: '#ffffff'
  primary-container: '#0078d4'
  on-primary-container: '#ffffff'
  inverse-primary: '#a3c9ff'
  secondary: '#5c5f60'
  on-secondary: '#ffffff'
  secondary-container: '#dee0e2'
  on-secondary-container: '#606365'
  tertiary: '#974700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc5b00'
  on-tertiary-container: '#ffffff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d3e3ff'
  primary-fixed-dim: '#a3c9ff'
  on-primary-fixed: '#001c39'
  on-primary-fixed-variant: '#004883'
  secondary-fixed: '#e1e2e4'
  secondary-fixed-dim: '#c5c7c8'
  on-secondary-fixed: '#191c1e'
  on-secondary-fixed-variant: '#444749'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb689'
  on-tertiary-fixed: '#311300'
  on-tertiary-fixed-variant: '#743500'
  background: '#f8f9ff'
  on-background: '#181c22'
  surface-variant: '#e0e2ea'
typography:
  ribbon-tab:
    fontFamily: Libre Franklin
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  ribbon-group-label:
    fontFamily: Libre Franklin
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.02em
  panel-header:
    fontFamily: Libre Franklin
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Libre Franklin
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-sm:
    fontFamily: Libre Franklin
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  timeline-timecode:
    fontFamily: Libre Franklin
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.05em
  status-bar:
    fontFamily: Libre Franklin
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  ribbon_height: 140px
  sidebar_width: 240px
  export_queue_width: 320px
  timeline_height: 300px
  gutter: 1px
  panel_padding: 16px
  element_gap: 8px
  ribbon_group_padding: 12px
---

## Brand & Style

This design system is built on the principles of **Productivity-First Enterprise Design**, specifically emulating the Microsoft Office/Fluent ecosystem. It prioritizes familiarity, muscle memory, and functional density over decorative trends. 

The aesthetic is **Corporate & Systematic**, utilizing a rigid layout of non-overlapping panels that define clear zones for specialized tasks. The design avoids "floating" elements or excessive shadows, opting instead for a flat, layered approach where hierarchy is established through subtle tonal shifts and structural borders. The emotional response is one of reliability, professional capability, and efficiency.

## Colors

The palette is strictly functional, utilizing a high-key light mode to maximize legibility. 

- **Primary:** Microsoft Blue (#0078D4) is used exclusively for primary actions, active tab indicators, and selection states.
- **Backgrounds:** The main application backdrop uses a cool neutral gray (#F5F6F8). Work surfaces (Canvas, Ribbon, Sidebar) are pure White (#FFFFFF) to create a clear "paper-like" focus.
- **Borders:** All panel separations and UI component outlines use a light gray (#E0E0E0) to maintain a rigid, structured look without heavy visual weight.
- **Tonal Layers:** Secondary UI surfaces like the Status Bar and inactive Timeline tracks use a subtle off-white or very light gray to differentiate them from the primary workspace.

## Typography

The typography system uses **Libre Franklin** (as a web-standard alternative to Segoe UI) to achieve a neutral, systematic feel. 

Scaling is intentionally conservative. Headings do not exceed 16px in standard views to maintain information density. 
- **Ribbon Tabs:** Use medium weight with a 14px size for primary navigation.
- **Labels:** Small 11px labels are used for Ribbon group categories and status bar metadata to provide context without distracting from the primary task.
- **Functional Text:** Body text and input values are kept at a highly readable 13px.

## Layout & Spacing

This design system utilizes a **Fixed-Panel Grid** layout. Components are docked to specific screen regions, preventing overlapping windows and ensuring the workspace remains predictable.

- **Ribbon:** A fixed-height top container spanning 100% width. It is divided into logical "Groups" separated by vertical 1px rules.
- **Work Area:** A three-column split featuring a fixed-width left Sidebar (Project Assets), a flexible Center Canvas (Preview), and a fixed-width right Sidebar (Export Queue).
- **Timeline:** A bottom-anchored panel spanning the full width of the center/right columns.
- **Gutters:** Instead of large margins, panels are separated by 1px borders, creating a seamless but clearly defined "grid" of productivity tools.

## Elevation & Depth

This design system avoids physical shadows. Depth is communicated through **Tonal Layering** and **Contained Borders**:

1.  **Level 0 (Backdrop):** #F5F6F8. The foundation visible between panels or in the margins.
2.  **Level 1 (Panels):** #FFFFFF. All primary work panels (Ribbon, Sidebar, Timeline) are pure white with a 1px #E0E0E0 border.
3.  **Level 2 (Active Elements):** Primary blue highlights indicate active tabs or selected timeline clips.
4.  **Interactive States:** Hover states utilize a subtle tonal shift (Level 1 to #F3F3F3) or a primary-tinted background (#E1F1FF) for buttons.

## Shapes

The shape language is primarily squared-off to reflect professional software of the Windows 11 era.

- **Standard Elements:** Buttons, input fields, and panels use a "Soft" (0.25rem / 4px) corner radius.
- **Container Panels:** The main application window and primary workspace panels maintain sharp corners or very slight 4px rounding to maximize screen real estate.
- **Interactive Controls:** Checkboxes and toggle sliders maintain a slight 2px rounding to distinguish them from structural layout elements.

## Components

### Ribbon Tabs & Groups
- **Tabs:** Horizontal labels at the top. Active tab features a 2px primary blue bottom border.
- **Groups:** Labeled at the bottom with a 11px label. Vertical dividers separate groups. Buttons within groups are stacked or large-icon format.

### Timeline Tracks
- **Track Headers:** Fixed-width left-aligned labels containing track name, "Lock," and "Visibility" icons.
- **Track Body:** Alternating very light gray background for row separation. 
- **Playhead:** A 1px primary blue vertical line with a geometric handle at the top time-ruler.

### Buttons & Inputs
- **Primary Button:** Solid #0078D4 background with White text. 4px rounded corners.
- **Secondary Button:** White background with 1px #E0E0E0 border.
- **Inputs:** White background, 1px gray border. On focus, the border changes to 2px primary blue.

### Export Queue Sidebar
- **Cards:** Vertical list of media thumbnails. Selected state features a primary blue stroke and a checked checkbox in the top-left corner.
- **Scrollbars:** Narrow, "overlay-style" gray bars that appear on hover, consistent with Windows 11 Fluent UI.