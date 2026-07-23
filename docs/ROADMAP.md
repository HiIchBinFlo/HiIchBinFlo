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

**Status: Complete** (with one documented, deliberate scope boundary — see below).

- [x] **RSC7 container codec, native Rust** (`src-tauri/src/parsers/rage_resource.rs`):
      header parsing, the flags→buffer-size bit-packing formula, raw-DEFLATE
      decompression, virtual/physical buffer reconstruction. No guessing: the
      formula and the "raw DEFLATE, not zlib" detail were empirically verified
      against a real RSC7 file (see the fixture test below), not taken on faith
      from documentation.
- [x] **`codewalker-bridge` sidecar** (`sidecar/CodeWalkerBridge/`): a small,
      self-contained .NET 8 executable wrapping the real `CodeWalker.Core`
      library to decode the actual `.ydd`/`.ytd` *object graph* — the part
      that needs precise pointer resolution this project chose not to guess
      at from scratch (see "Why a sidecar" below). Bundled as a Tauri
      sidecar; end users never install or interact with CodeWalker directly.
      Empirically confirmed to run correctly on Linux (not just its intended
      Windows target) — see `sidecar/README.md`.
- [x] Real `.ytd` decoding: texture name, width, height, depth, mip levels,
      pixel format, byte-accurate `.dds` extraction (`DDSIO.GetDDSFile`, no
      GDI+/`System.Drawing` dependency, so it stays cross-platform-safe).
- [x] Real `.ydd` decoding: per-drawable bounding box/sphere, LOD
      presence + distances, full bone list (name/index/parent), aggregate
      geometry/vertex/triangle counts, embedded texture dictionary detection.
      A file that fails to decode here is a genuinely corrupt/invalid RAGE
      resource — real structural validation, not a heuristic.
- [x] Wired into the Inspector as an on-demand "Decode" action per item
      (`src/components/layout/DecodedInfoPanel.tsx`) and a sidecar health
      check in the status bar — **deliberately not** a mandatory blocking
      step during import (see "Why decoding is on-demand" below).
- [x] A committed, empirically-verified test fixture
      (`src-tauri/tests/fixtures/sample.ytd`) generated and self-verified by
      the sidecar itself, cross-validating the Rust container reader against
      real CodeWalker.Core-produced bytes — see `docs/FILE_FORMATS.md` for
      why this exists (no Rockstar-produced sample files are available or
      distributable in this repo).
- [ ] Schema-aware mapping of specific FiveM `.meta` schemas (e.g.
      `shop_ped_component.meta`) onto structured, editable fields is still
      the schema-agnostic generic-XML approach from Phase 1 — deferred, not
      forgotten; see `docs/FILE_FORMATS.md`.

### Why a sidecar instead of a from-scratch Rust decoder

The RSC7 *container* format (above) is well-documented and self-contained
enough to implement and verify natively. The *object graph* inside it
(Drawable geometry, TextureDictionary entries) needs a precise
pointer-resolution scheme this project could not fully verify from available
documentation, and there were no real Rockstar-produced sample files to test
a guess against. Rather than ship a parser that looks plausible but might
silently corrupt data on real files, this project integrates the real,
actively-used `CodeWalker.Core` library (MIT-majority licensed; see
`sidecar/NOTICE.md` for the full picture) via a bundled sidecar process —
matching the project brief's own guidance to integrate existing open-source
libraries, under their licenses, rather than reimplement blind.

### Why decoding is on-demand, not automatic on import

Each decode is a subprocess invocation. That's fine for "the user clicked an
item and wants to see its real dimensions/bounding box," but running it
automatically for every file during import would not stay smooth for the
20,000+-file packs this project is explicitly designed to handle — so import
stays fast (filename-convention classification, as in Phase 1) and decoding
is an explicit, bounded, per-item action instead. A batched/background
"deep-validate everything" pass is a reasonable Phase 5 (Optimization)
addition once there's a performance budget to design it against.

## Phase 3 — Character Preview, Texture Viewer, Thumbnail Generator

**Status: Not started.** `src/components/preview/` and `src/components/texture/`
exist as empty (documented) directories reserved for this phase. Phase 2 now
provides real decoded texture data (dimensions/format + extracted `.dds`)
and drawable structure (bounding box, LODs, bones, geometry counts) — enough
to build a texture viewer and populate a 3D scene's metadata. What's still
missing: actual vertex/index buffer extraction (geometry *content*, not just
counts) for real mesh rendering, and DDS→canvas/WebGL texture decoding on the
frontend. Both are scoped for this phase rather than Phase 2 (parsing) or
faked with placeholder geometry.

## Phase 4 — Mesh Editor, Custom Clothing Creator

**Status: Not started.** `src/components/mesh/` exists as an empty directory.
The Custom Clothing Creator's *registration* half (assigning ids, generating
metadata, integrating into a DLC) is already implemented in Phase 1 — creating
a new item via the Inspector does exactly that, and Phase 2 adds real
structural validation of the files involved. What's missing is content
authoring (mesh vertex/UV editing) and a write-back path through the sidecar
(CodeWalker.Core can build valid resources — confirmed via `gen-test-ytd` —
but no UI or write-back Tauri command exists yet), which depends on Phase 3's
rendering pipeline to be useful.

## Phase 5 — Optimization, Testing, Release

**Status: Not started.** Phase 1 and 2 ship with unit tests for the
highest-risk logic (slot system, validation, db round-trip, parsers, RSC7
container codec) on both sides of the IPC boundary, plus a sidecar smoke test,
and a CI workflow (`.github/workflows/ci.yml`) that runs all of it. Broader
integration/E2E tests, import/export performance profiling against real
20k+ file packs, parallelized hashing, a batched deep-validation pass (see
Phase 2 above), and packaged releases are Phase 5 work.

---

## Why full `.ydd`/`.ytd` *editing* still isn't done

Phase 2 closes the biggest Phase-1-era gap: real decoding now exists and is
wired into the UI. What's still open is the *write* path for edited geometry
(Phase 4) and rendering actual mesh content rather than metadata (Phase 3).
Both build directly on Phase 2's sidecar rather than needing a new integration
strategy — the hard architectural question (native Rust vs. wrapping a proven
library) is answered and documented above.
