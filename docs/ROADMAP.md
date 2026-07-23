# Roadmap

Built iteratively, one phase fully completed before the next starts (per the
project brief). This document is the source of truth for "is X actually done."

## Phase 1 — Desktop App, UI, Project Management, Import, Export, Slot System

**Status: Complete.**

- [x] Tauri + React + TypeScript + Vite + Tailwind + Zustand project scaffold
- [x] Dark-theme desktop shell: Toolbar (Import/Export/Save/Undo/Redo/Settings),
      Sidebar (Project/DLC/Components/Props), center Grid/List view, Inspector
- [x] Virtualized grid & list views (`@tanstack/react-virtual`) — designed for
      20k+ item collections without a full DOM tree
- [x] SQLite-backed project files (`.fcstudio`), create/open/save
- [x] Slot system: reserved ids, never renumbered on delete, reused-or-appended
      on create, exact-id reservation on import, hard conflict detection.
      Implemented twice (TypeScript for instant UI feedback, Rust as the
      authoritative source of truth) and unit tested in both.
- [x] Import: FiveM resource folder, ZIP, plain folder, individual files.
      Multi-DLC-aware (detects nested `fxmanifest.lua`/`dlc.meta` roots).
      Filename-convention parsing for `.ydd`/`.ytd`; structural (schema-agnostic)
      parsing for `.meta`/`.xml`; `fxmanifest.lua` parsing for resource name.
      Produces a report: files scanned, drawables/textures/components/props found,
      DLCs detected, missing companions, warnings, errors.
- [x] Export: FiveM Resource folder, ZIP, DLC Pack (resource + `dlc.meta`/`content.xml`
      skeleton), flat Individual Files. Regenerates `fxmanifest.lua` deterministically.
      Blocked by validation errors; asset files are resolved and copied for real.
- [x] Editor: name, category, drawable id (locked), texture id, gender, DLC,
      description, LOD, tags, hashes, metadata — replace/remove/duplicate files,
      duplicate/delete items, multi-select batch edit (category/gender/DLC/tags/
      duplicate/delete)
- [x] Validation: missing files, broken references, duplicate ids, missing
      textures, invalid metadata — mirrored in TS (live, in the status bar and a
      dedicated dialog) and Rust (enforced again right before export)
- [x] Undo/redo (snapshot-based, 100-step history) + autosave (60s, dirty-only)
      + save-on-Ctrl/Cmd+S + unsaved-changes warning on close

## Phase 2 — Deep Parsers, Validation Hardening

**Status: Not started.** Phase 1's `.meta`/`.xml` handling is intentionally
schema-agnostic (see [FILE_FORMATS.md](FILE_FORMATS.md)) rather than guessing at
undocumented GTA V meta schemas. Phase 2 is where that gets replaced with
verified, schema-aware mapping — e.g. turning `shop_ped_component.meta` entries
into first-class editable fields instead of opaque metadata — plus a real `.ydd`/
`.ytd` binary reader (see below) once a verified spec or adapted open-source
reference (with compatible license) is integrated.

## Phase 3 — Character Preview, Texture Viewer, Thumbnail Generator

**Status: Not started.** `src/components/preview/` and `src/components/texture/`
exist as empty directories reserved for this phase. Needs the Phase 2 `.ydd`/`.ytd`
decoder before a 3D preview or texture viewer can render real content — a
placeholder mannequin with no actual game assets would violate the "no
placeholders for core functionality" rule, so this phase waits on Phase 2.

## Phase 4 — Mesh Editor, Custom Clothing Creator

**Status: Not started.** `src/components/mesh/` exists as an empty directory.
The Custom Clothing Creator's *registration* half (assigning ids, generating
metadata, integrating into a DLC) is already implemented in Phase 1 — creating
a new item via the Inspector does exactly that. What's missing is content
authoring (mesh inspection/editing), which depends on Phase 2/3.

## Phase 5 — Optimization, Testing, Release

**Status: Not started.** Phase 1 ships with unit tests for the highest-risk
logic (slot system, validation, db round-trip, parsers) on both sides of the
IPC boundary, and a CI workflow (`.github/workflows/ci.yml`) that runs them.
Broader integration/E2E tests, import/export performance profiling against real
20k+ file packs, parallelized hashing, and packaged releases are Phase 5 work.

---

## Why `.ydd`/`.ytd` binary decoding isn't in Phase 1

This is the single biggest technical gap, stated plainly: GTA V's `.ydd`
(drawable) and `.ytd` (texture dictionary) are proprietary RAGE engine binary
formats. Reading them well enough to render a mesh or preview a texture
in-app requires either a verified format specification or an existing
open-source implementation adapted under a compatible license (e.g. codebases
in the CodeWalker/RAGE modding ecosystem) — not guessed-at parsing. Phase 1
tracks these files as **opaque, hash-verified assets**: it never needs to
understand their internals to guarantee the one invariant that matters most
(drawable/texture ids never change), since that invariant lives entirely in
the *filename* and the project's own id bookkeeping, not the binary content.
Decoding them for real is Phase 2/3 work and will be integrated (with proper
license attribution) rather than faked.
