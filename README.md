# ForgeCut

### Professional video editing, forged for the web.

ForgeCut is a desktop-class, multi-track video editor built for the web.

It combines a professional non-linear editing workflow with a platform-aware interface system designed to feel native across **Windows, macOS, and Android** — while keeping the underlying editing engine shared and consistent.

ForgeCut is built around one principle:

> **Native First. ForgeCut Second.**

The editor should behave like the platform it is running on, without compromising the power of a professional editing workflow.

---

## Overview

ForgeCut is designed to provide a serious video-editing experience without requiring a traditional heavyweight desktop installation.

The application is built around a modular editing architecture containing dedicated systems for:

- Media management
- Timeline editing
- Playback
- Audio
- Animation
- Transitions
- Text rendering
- Shape rendering
- History and undo/redo
- Keyboard shortcuts
- Export
- Background media processing

The editor separates the **core editing engine** from the **platform presentation layer**, allowing ForgeCut to maintain shared editing behavior while presenting an interface appropriate to each operating system.

---

## Core Features

### 🎬 Professional Editing Workspace

ForgeCut provides a structured editing environment built around the workflow expected from a professional non-linear editor.

- Multi-track timeline
- Media/project workspace
- Preview canvas
- Playback controls
- Context-sensitive editing controls
- Export management
- Project organization
- Drag-and-drop workflows
- Keyboard-driven editing
- Undo/redo history

---

### 📁 Media Management

ForgeCut is designed to handle media throughout the complete editing workflow.

Supported media workflows include:

- Video import
- Audio import
- Image import
- Drag-and-drop media
- Project Explorer organization
- Media preview
- Timeline placement
- Playback verification
- Media compatibility testing

ForgeCut also includes an automated media-import testing workflow for validating different media types, extensions, codecs, filenames, and failure cases.

---

### ⏱️ Multi-Track Timeline

The timeline is the central editing surface of ForgeCut.

It is designed around professional NLE concepts:

- Multiple tracks
- Clip placement
- Timeline navigation
- Playback position
- Clip manipulation
- Drag-and-drop editing
- Timeline drop handling
- Track-oriented editing
- Timeline rendering
- Frame-aware playback and export

The timeline is implemented as a dedicated subsystem so it can evolve independently from the rest of the editor interface.

---

### ▶️ Playback

ForgeCut includes a dedicated playback engine responsible for synchronizing the editor's playback state.

The playback system is designed around:

- A single authoritative playback clock
- Play/pause control
- Timeline synchronization
- Media synchronization
- Playback lifecycle management
- Cleanup of playback loops
- Reliable state transitions

Playback behavior is treated as a core editing capability rather than a purely visual UI feature.

---

### 🎧 Audio

Audio is handled through a dedicated audio engine.

The architecture allows audio functionality to remain independent from the UI layer while integrating with:

- Timeline state
- Playback
- Media management
- Export
- Project state

---

### ✨ Animation & Transitions

ForgeCut includes dedicated systems for animation and transitions.

These are separated into independent engines so that effects can be expanded without coupling them directly to the editor shell.

Current architecture includes:

- Animation Engine
- Transition Engine
- Text Renderer
- Shape Renderer

---

### ↩️ Undo & Redo

ForgeCut includes a dedicated history-management system.

The architecture is designed to keep editing operations reversible while avoiding unnecessary state duplication.

This provides the foundation for:

- Undo
- Redo
- Editing history
- Command-based operations
- Future advanced editing workflows

---

### ⌨️ Keyboard Shortcuts

ForgeCut is designed for keyboard-driven editing as well as mouse interaction.

Keyboard shortcuts are treated as part of the editor's interaction architecture rather than isolated UI handlers.

Platform-specific shortcut conventions are supported through the presentation layer.

For example:

- Windows-oriented workflows can use `Ctrl`
- macOS-oriented workflows can use `Command`

---

## Export

ForgeCut includes a dedicated export pipeline designed for reliable, frame-accurate rendering.

The export architecture supports capability-based routing and validation rather than assuming that every browser environment provides identical media capabilities.

The export system includes:

- Export configuration
- Capability detection
- Pipeline routing
- Frame-accurate rendering
- WebCodecs-based export where available
- Export lifecycle management
- Validation
- Synchronization
- Error handling
- Export queue integration

The goal is to make export a deterministic part of the editor rather than a separate disconnected process.

---

## Platform-Aware UI

ForgeCut does not treat every platform as a resized version of the same interface.

Instead:

```text
                         FORGECUT
                            │
                   Shared Editing Engine
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
     Windows              macOS              Android
        │                   │                   │
     Fluent              Native              Material 3
     Office              Apple HIG            Expressive
     Desktop          Liquid Glass             Mobile
