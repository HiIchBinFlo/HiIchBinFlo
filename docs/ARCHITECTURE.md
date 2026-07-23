# Architecture

## Process split

Three processes as of Phase 2, not the standard Tauri two:

- **Frontend (webview)**: React + TypeScript. Owns UI state (Zustand),
  optimistic edits, undo/redo, and a TypeScript mirror of the slot system for
  instant feedback. Never touches the filesystem directly except through
  `@tauri-apps/plugin-dialog` (native open/save pickers) — all real file I/O
  goes through Tauri commands.
- **Backend (Rust)**: owns the SQLite database, the filesystem, and is the
  *authoritative* copy of the slot system. Every import/export/save round-trip
  is validated here regardless of what the frontend already checked — the
  backend does not trust the caller. Also implements the RSC7 container
  format natively (see below).
- **`codewalker-bridge` sidecar (.NET)**: a bundled, self-contained process
  the Rust backend shells out to (via `tauri-plugin-shell`'s sidecar
  mechanism) for real `.ydd`/`.ytd` object-graph decoding. See "Why a
  sidecar" in `docs/ROADMAP.md`'s Phase 2 section and `sidecar/README.md`.
  End users never see or interact with this process directly — from their
  perspective it's just part of the app.

```
┌─────────────┐   Tauri IPC    ┌──────────────┐   subprocess    ┌──────────────────┐
│  Frontend    │ ─────────────▶│  Rust        │ ───────────────▶│ codewalker-bridge │
│  (webview)   │◀───────────── │  backend     │◀─────────────── │ (.NET, sidecar)   │
└─────────────┘   JSON results └──────────────┘   JSON on stdout└──────────────────┘
                                       │
                                       ▼
                              SQLite (.fcstudio) +
                              project assets directory
```

## Where project data actually lives

A project is a single `.fcstudio` SQLite file (`src-tauri/src/db.rs`).
Structured, queryable fields (drawable id, gender, component, dlc, name, ...)
are real columns; free-form nested data (tags, texture variant lists, hashes,
metadata) is stored as JSON text columns — simpler than a fully normalized
schema and entirely adequate at clothing-pack scale.

Binary assets (`.ydd`/`.ytd`/etc.) are **copied into a project-owned assets
directory** on import — a sibling directory next to the `.fcstudio` file,
named `<db_path>.assets/<dlc-resource-name>/stream/<filename>`
(`src-tauri/src/commands/import.rs::assets_dir`). This is deliberate: a
project must remain valid and self-contained even if the user later moves or
deletes the folder/ZIP they originally imported from. `BinaryAssetRef.relativePath`
is always relative to this assets directory, never an absolute path into
wherever the import source happened to live.

## The slot system lives in two places, on purpose

`src/lib/slotSystem.ts` and `src-tauri/src/slot_system.rs` implement the same
algorithm independently (not via codegen) so the frontend gets instant
optimistic feedback while the backend remains the source of truth that every
save/export is checked against. Both are fully unit tested; see
[SLOT_SYSTEM.md](SLOT_SYSTEM.md) for the algorithm itself.

## Command surface (Tauri IPC)

| Command | Purpose |
| --- | --- |
| `project_create` / `project_open` / `project_save` | `.fcstudio` lifecycle |
| `import_source` | Scan a resource/ZIP/folder/file selection, copy assets in, return items + report |
| `export_project` | Validate, then write a Resource/ZIP/DLC/Files export |
| `import_asset_file` | Copy a user-picked file in (Inspector "Replace"/"Add file") |
| `duplicate_asset_file` | Copy an existing project asset to a new deduplicated filename |
| `sidecar_probe` | Health check: is `codewalker-bridge` present and working? |
| `inspect_ytd` | Real texture decode (dimensions/format/mips) via the sidecar, optional `.dds` extraction |
| `inspect_ydd` | Real drawable decode (bounding box, LODs, bones, geometry stats) via the sidecar |
| `export_geometry` | Real vertex/index/bone geometry for the isolated mesh preview, via the sidecar |
| `decode_texture_png` | Decodes an extracted `.dds` to a base64 PNG (native Rust, `texture_decode.rs`) |
| `decode_texture_thumbnail` | Same, downsampled — used for `ClothingDrawable.thumbnail` |
| `export_texture_png` / `copy_file` | Texture Viewer's "Export as PNG" (re-encode) / "Export as DDS" (verbatim copy) |
| `repair_ytd` / `repair_ydd` | Write-back proof: re-serialize a real file through CodeWalker.Core, verified before writing |
| `refresh_asset_ref` | Recomputes an asset's size/hash after `repair_*` changes its bytes in place |
| `deep_validate_project` | Phase 5: opt-in batched decode of every present mesh/texture in the project (bounded concurrency), vs. the on-demand per-item decode above |
| `apply_texture_edit` | Phase 6: writes an edited image (Design Studio: recolor/upload/paint) onto a real texture inside a `.ytd`, verified before writing |

All commands return `Result<T, AppError>`; `AppError` serializes to a plain
string the frontend surfaces via `sonner` toasts (`src/lib/tauri.ts`).

## The sidecar: what Rust does vs. what the sidecar does

Rust (`src-tauri/src/parsers/rage_resource.rs`) decodes the RSC7 *container*
only — header, compression, buffer sizing — natively, with zero external
process cost. It's used for fast "is this file even structurally intact"
checks. `src-tauri/src/sidecar.rs` is the thin bridge: it resolves the
bundled `codewalker-bridge` binary, spawns it with CLI args
(`inspect-ytd <path>`, `inspect-ydd <path>`, ...), and deserializes its JSON
stdout into the same Rust structs used everywhere else
(`src-tauri/src/commands/inspect.rs`). Rust has no knowledge of the Drawable/
TextureDictionary object graph itself — that logic lives entirely in
`sidecar/CodeWalkerBridge/Commands.cs`, calling into the real
`CodeWalker.Core` library. See `docs/FILE_FORMATS.md` and `docs/ROADMAP.md`
(Phase 2) for the reasoning behind this split.

## The write-back pattern (Phase 4)

`repair_ytd`/`repair_ydd` follow a "verify before write" shape worth naming
explicitly, since it's the pattern any future write-back feature in this
project should reuse: (1) load the real file through
`RpfFile.GetResourceFile<T>` — this is CodeWalker.Core's own reader
populating the *entire* object graph, so every pointer/skeleton/shader-group
reference is already correctly wired by construction, unlike building a
resource from scratch (see `GenTestYtd`'s doc comment for why that path is
harder); (2) call `.Save()` to re-serialize; (3) reload the *output* bytes
and check they still contain the same number of textures/drawables; (4) only
then write to disk. A failure at any step returns `ok:false` with no file
written — the on-disk file is never left in a partially-written or
unverified state.

Every write-back command sits on top of this. Phase 6's `replace-texture`
(`Commands.cs::ReplaceTexture`) is the first command that actually mutates
the loaded object graph between steps 1 and 2 — it finds the target texture
in `TextureDict.Textures.data_items`, replaces it with one built from a real
DDS via `DDSIO.GetTexture` (preserving the original's Name/NameHash/Usage so
nothing else that references it by name breaks), then follows the same
verify-before-write steps as above, checking both the texture count *and*
the replaced texture's new dimensions before writing. See `docs/ROADMAP.md`'s
Phase 6 section and `docs/FILE_FORMATS.md` for the full picture, including
the native Rust DDS encoder (`texture_encode.rs`) that feeds it.

The sidecar binary itself is built by `scripts/publish-sidecar.mjs`
(self-contained `dotnet publish`, one per target platform) and is **not**
committed to the repository (see `.gitignore`) — both local dev
(`beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json`) and CI publish
it fresh before any Tauri build.

## Validation

`src/lib/validation.ts` (frontend, live — drives the status bar and Validation
dialog) and `src-tauri/src/commands/validate.rs` (backend, enforced right
before export regardless of what the frontend showed) implement the same
checks: missing mesh/texture files, broken DLC references, duplicate ids
within a slot track, invalid metadata. Kept as two independent
implementations for the same reason as the slot system above.

## Performance posture (Phase 1)

- Grid/list views are virtualized (`@tanstack/react-virtual`) — a fixed DOM
  node count regardless of collection size, which is what actually matters for
  20k+-item packs staying responsive while scrolling/filtering.
- Undo/redo snapshots are shallow (new arrays, not deep clones) since items are
  already treated immutably on every edit — an undo step is cheap regardless
  of collection size.
- Import hashing (SHA-256 per asset file) is parallelized with `rayon`
  (Phase 5, `commands::import::copy_pending_items_parallel`): classification
  and slot reservation stay sequential (cheap, and slot assignment is
  inherently order-dependent), but the copy+hash step — the actual
  bottleneck for large packs — runs across all of a resource's items at
  once. See `docs/ROADMAP.md`'s Phase 5 section for the before/after and the
  scale test that exercises it.

## Performance posture (Phase 3 additions)

- The 3D preview and its `three`/`@react-three/fiber`/`@react-three/drei`
  dependencies are lazy-loaded (`React.lazy` + a dedicated Vite
  `manualChunks` bundle) — opening the app never pays for three.js; only
  opening a preview does.
- Texture thumbnails are generated once per item (cached onto
  `ClothingDrawable.thumbnail`) and downsampled before storage, not
  regenerated on every render and not stored at full resolution.

## Performance posture (Phase 5 additions)

- Import's copy+hash step is parallelized with `rayon` (see above) — the one
  concrete "will this hold up at 20k+ files" question this project could
  actually test without a real 20k-file pack in hand:
  `src-tauri/tests/large_pack_import_perf_test.rs` builds and imports a
  synthetic ~9,600-file pack and asserts both correctness and a generous
  wall-clock ceiling.
- Deep validation (`deep_validate_project`) is deliberately *not* parallelized
  without bound the way import copy/hash is: each check spawns a real .NET
  sidecar subprocess, so concurrency is capped
  (`MAX_CONCURRENT_SIDECAR_CALLS = 8`) rather than firing off one process per
  file at once — the failure mode for an unbounded version would be
  resource exhaustion on large projects, not just slowness.

## Testing

- Rust: `cargo test` in `src-tauri/` — slot system, DB round-trip, filename
  parsing, `fxmanifest.lua` parse/generate round-trip, generic XML flattening,
  validation logic, the RSC7 container codec, and BC1-7 texture decoding
  (unit tests plus integration tests cross-validated against real, committed
  fixture files — see `docs/FILE_FORMATS.md`), plus (Phase 5) end-to-end
  import and import→export integration tests and a large-synthetic-pack
  scale test, plus (Phase 6) `texture_encode`'s real round-trip test (Rust
  encode → real sidecar decode, exact pixel match — see below). 34 unit + 15
  integration tests as of Phase 6
  (`repair_ytd`/`repair_ydd`/`refresh_asset_ref`/`deep_validate_project`/
  `apply_texture_edit` are thin passthroughs to the sidecar with no
  independent Rust-side logic to unit test — their correctness is the
  sidecar smoke test below).
- TypeScript: `npm run test` (Vitest) — slot system, mirroring the Rust suite's
  scenarios exactly (including the spec's own delete-id-2-of-5 example). The
  Design Studio's canvas-based pixel math (`src/components/design/
  canvasUtils.ts`) isn't unit tested — jsdom has no real `<canvas>` 2D
  context without the native `canvas` npm package, which this project
  doesn't depend on — so it's covered by real usage instead (typecheck +
  build) and by the fact that the actual pixel data it produces is proven
  correct end to end on the Rust/sidecar side.
- `codewalker-bridge`: no separate unit test project (it's a thin wrapper
  around a well-tested external library); CI runs a smoke test exercising
  every command, including the write-back path (`repair-ytd` round-tripped
  and re-inspected), `replace-texture` (a real DDS swapped into a real
  `.ytd`, re-inspected to confirm the new dimensions took effect), and
  verifying that feeding a command the wrong resource type fails gracefully
  (`ok:false`) instead of crashing.
- CI (`.github/workflows/ci.yml`): typecheck + lint + test + build for the
  frontend; a sidecar build + smoke test job; `cargo check`/`clippy -D
  warnings`/`test` for the backend (which requires the sidecar to be
  published first — Tauri's build script validates `externalBin` paths even
  for `cargo check`); and a full Tauri release build — on every push/PR.
