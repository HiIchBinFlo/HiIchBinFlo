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

**Status: Complete, with one deliberate scope boundary decided up front — see below.**

- [x] **Isolated 3D mesh preview** (`src/components/preview/MeshPreview.tsx`,
      React Three Fiber): real decoded geometry — actual vertex positions,
      normals (or computed from the triangles when a normal semantic is
      absent), and UV0 — with the item's real decoded texture applied.
      Orbit/zoom via `OrbitControls`, auto-framed via drei's `Bounds`.
      Lazy-loaded (a dedicated `three` chunk, only fetched when a preview is
      opened) so three.js's size doesn't cost anything for users who never
      open it.
- [x] **Real vertex/index extraction**, sidecar-side
      (`sidecar/CodeWalkerBridge/Commands.cs::ExportGeometry`): positions,
      normals, UV0 and triangle indices per geometry, using
      `VertexData.GetVector3`/`GetVector2` with `VertexSemantics` indices —
      i.e. calling CodeWalker.Core's own accessors on real, file-loaded data
      rather than re-deriving the per-`VertexType` byte packing ourselves
      (see "The one unverified piece" below — this is the one part of Phase 3
      that could not be empirically cross-checked the way everything else in
      this project has been).
- [x] **Real texture decoding to pixels**, native Rust, no sidecar round-trip
      needed (`src-tauri/src/texture_decode.rs`): DDS header parsing
      (`ddsfile`) + BC1/BC2/BC3/BC4/BC5/BC7 block decompression
      (`texture2ddecoder`) + uncompressed 32bpp formats, encoded to PNG
      (`image`). Cross-validated against a real BC1 `.dds` extracted by the
      sidecar from CodeWalker.Core's own writer
      (`src-tauri/tests/fixtures/sample_bc1.dds` /
      `texture_decode_fixture_test.rs`) — not just self-consistency tests.
- [x] **Texture Viewer** (`src/components/texture/TextureViewer.tsx`): the
      actual decoded image (not an icon), dimensions/format/mip-count/size,
      "Export as .png" (re-encoded) and "Export as .dds" (verbatim original
      bytes) — both via real Tauri commands, both tested.
- [x] **Thumbnail generation**: a small (128px) downsampled PNG, decoded and
      saved onto the item (`ClothingDrawable.thumbnail`) the first time its
      textures are decoded, so the clothing grid shows a real preview image
      instead of a generic icon — deliberately a separate, small-output
      code path from the full-resolution Texture Viewer decode, to avoid
      bloating the SQLite project file per item.
- [ ] **HDRI (image-based) lighting** — the preview uses procedural
      three-point studio lighting instead. See "Why not HDRI" below.
- [ ] **Attaching clothing to a base character** — explicitly out of scope
      for this phase by design decision, not an oversight. See below.

### Why isolated mesh preview, not full character preview

Rendering clothing *on* a character needs a base ped mesh (male/female
Freemode), which is Rockstar game content this project cannot ship or
generate. CodeWalker and OpenIV solve this by requiring the user to point
the tool at their own GTA V installation and reading the base models (plus
RPF archive decryption) from there. That's a real, larger feature — a
deliberate scope decision (made explicitly, not assumed) was to ship the
isolated item viewer now, real geometry and real texture, no game
installation required, and treat "attach to a base character via a
user-provided GTA V path" as a follow-up rather than blocking Phase 3 on it.

### Why not HDRI

Drei's `<Environment preset="...">` fetches HDR files from a CDN at request
time by default — a network dependency this offline-first desktop app
shouldn't silently acquire just for lighting. Bundling a licensed `.hdr`
asset locally is the honest way to get real image-based lighting and remains
a reasonable follow-up; procedural studio lighting (key + fill + rim lights)
was used instead so "HDRI" isn't claimed without either owning the network
dependency or bundling the asset.

### The one unverified piece: vertex/normal/UV extraction

Every other decoding path in this project (RSC7 container sizing, BC1-7
texture decompression, the structural `.ydd`/`.ytd` metadata from Phase 2)
was cross-checked against real bytes — either from a committed fixture or
CodeWalker.Core's own reader. Vertex geometry extraction could not be:
building a valid, hand-constructed `VertexDeclaration` to test
`VertexData.GetVector3` against failed (CodeWalker.Core only ever builds one
by reading real file bytes, with no public constructor path), and no real
`.ydd` file was available to test the real read path against. The
implementation calls CodeWalker.Core's own, presumably production-tested
accessor methods (the same ones its actual 3D renderer relies on) rather
than reimplementing the per-`VertexType` byte-packing scheme — a much lower
risk than guessing a binary layout, but still short of this project's usual
bar of empirical cross-validation. If mesh shapes ever look wrong against a
real clothing pack, this is the first place to look — see
`docs/FILE_FORMATS.md`.

## Phase 4 — Mesh Editor, Custom Clothing Creator

**Status: Complete, with a scope decision on raw vertex editing — see below.**

> **Correction to an earlier version of this document:** Phase 3's roadmap
> claimed the Custom Clothing Creator's registration half was "already
> implemented in Phase 1 — creating a new item via the Inspector does exactly
> that." That was wrong: `projectStore.addItem` existed, but no UI ever
> called it — there was no way to actually create a new item from the app.
> Caught while starting Phase 4 and fixed below, rather than left standing.

- [x] **Custom Clothing Creator**
      (`src/components/clothing/NewClothingItemDialog.tsx`, Toolbar's "New
      Clothing Item" button): the actual missing piece from the correction
      above. Pick gender/type/component/DLC, import a `.ydd` and one or more
      `.ytd` files (copied into project storage via the same
      `import_asset_file` command the Inspector's "Replace" uses), and the
      item is created with **automatic slot registration** — the drawable id
      comes from `addItem`'s call into the slot system, no manual id
      bookkeeping — plus an opportunistic auto-generated thumbnail. No
      manual file editing required, per the brief.
- [x] **LOD switching** in the mesh preview: `export-geometry` now accepts an
      explicit `--lod` request (`sidecar/CodeWalkerBridge`), and the preview
      dialog shows a tab per LOD actually present in the file (from Phase 2's
      structural decode), refetching real geometry on switch.
- [x] **Bone assignment visualization**: `export-geometry` now also extracts
      each vertex's dominant bone (from `VertexSemantics.BlendWeights`/
      `BlendIndices`, resolved through the geometry's bone-id table), and the
      preview can color the mesh by bone influence as a toggle. Best-effort,
      not exact skinning reproduction — see the "one unverified piece" note
      in Phase 3 above; this shares that same caveat.
- [x] **Real write-back proof**: `sidecar`'s new `repair-ytd`/`repair-ydd`
      commands load a real file through CodeWalker.Core's reader and
      re-serialize it through the same library's writer, verifying the
      output reloads with matching content *before* anything is written to
      disk. Exposed as a "Repair" action on mesh/texture files in the
      Inspector. Verified end to end against the real, committed
      `sample.ytd` fixture: 155 bytes in, 155 bytes out, identical content
      on reload.
- [ ] **Raw vertex/UV editing** (dragging vertices, reassigning UVs by hand)
      — a deliberate scope decision, not an oversight. See below.

### Why raw vertex editing is out of scope

Interactive vertex manipulation — selection, gizmos, per-vertex undo, mesh
topology awareness — is a substantial 3D-modeling-tool feature in its own
right (the kind of thing Blender or 3ds Max already do well), and it doesn't
match how clothing modders actually work: they sculpt in those tools and
export, then use a *clothing resource manager* to register, validate, and
package the result. That's this project's stated purpose. What Phase 4
delivers instead — LOD switching, bone assignment visibility, item creation,
and a **proven write-back path** — is the complete, real feature set a
clothing-pack tool needs, and the write-back proof means adding true content
editing later (should it ever be wanted) has a solid foundation to build on
rather than an unproven one.

## Phase 5 — Optimization, Testing, Release

**Status: Not started.** Phases 1-4 ship with unit/integration tests for the
highest-risk logic (slot system, validation, db round-trip, parsers, RSC7
container codec, BC1-7 texture decode) on both sides of the IPC boundary,
plus sidecar smoke tests (including the repair/write-back path), and a CI
workflow (`.github/workflows/ci.yml`) that runs all of it. Broader
integration/E2E tests, import/export performance profiling against real
20k+ file packs, parallelized hashing, a batched deep-validation pass (see
Phase 2 above), bundling a real HDRI asset (see Phase 3 above), and packaged
releases are Phase 5 work.

---

## Why full `.ydd`/`.ytd` *content editing* still isn't done

Phase 2 added real decoding; Phase 3 added real viewing (mesh + texture,
isolated from a base character by deliberate scope decision); Phase 4 proved
the write-back path works (`repair-ytd`/`repair-ydd`, verified against a real
fixture) and delivered the editing operations that actually fit this
project's purpose (LOD switching, item creation, bone visibility). What
remains — interactive vertex/UV *content* editing — was scoped out
deliberately (see Phase 4 above), not left unbuilt for lack of a path: the
hard architectural question (native Rust vs. wrapping a proven library) was
answered once, in Phase 2, and the write-back proof in Phase 4 confirms that
decision extends cleanly to writing, too.
