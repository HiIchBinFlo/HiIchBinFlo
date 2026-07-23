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
| `export_geometry` | Real vertex/index geometry for the isolated mesh preview, via the sidecar |
| `decode_texture_png` | Decodes an extracted `.dds` to a base64 PNG (native Rust, `texture_decode.rs`) |
| `decode_texture_thumbnail` | Same, downsampled — used for `ClothingDrawable.thumbnail` |
| `export_texture_png` / `copy_file` | Texture Viewer's "Export as PNG" (re-encode) / "Export as DDS" (verbatim copy) |

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
- Import hashing (SHA-256 per asset file) is currently sequential. For very
  large packs this is the most likely first bottleneck; parallelizing it
  (e.g. with `rayon`) is tracked as Phase 5 work rather than premature
  optimization in Phase 1.

## Performance posture (Phase 3 additions)

- The 3D preview and its `three`/`@react-three/fiber`/`@react-three/drei`
  dependencies are lazy-loaded (`React.lazy` + a dedicated Vite
  `manualChunks` bundle) — opening the app never pays for three.js; only
  opening a preview does.
- Texture thumbnails are generated once per item (cached onto
  `ClothingDrawable.thumbnail`) and downsampled before storage, not
  regenerated on every render and not stored at full resolution.

## Testing

- Rust: `cargo test` in `src-tauri/` — slot system, DB round-trip, filename
  parsing, `fxmanifest.lua` parse/generate round-trip, generic XML flattening,
  validation logic, the RSC7 container codec, and BC1-7 texture decoding
  (unit tests plus integration tests cross-validated against real, committed
  fixture files — see `docs/FILE_FORMATS.md`). 31 unit + 6 integration tests
  as of Phase 3.
- TypeScript: `npm run test` (Vitest) — slot system, mirroring the Rust suite's
  scenarios exactly (including the spec's own delete-id-2-of-5 example).
- `codewalker-bridge`: no separate unit test project (it's a thin wrapper
  around a well-tested external library); CI runs a smoke test exercising
  every command, including verifying that feeding it the wrong resource type
  fails gracefully (`ok:false`) instead of crashing.
- CI (`.github/workflows/ci.yml`): typecheck + lint + test + build for the
  frontend; a sidecar build + smoke test job; `cargo check`/`clippy -D
  warnings`/`test` for the backend (which requires the sidecar to be
  published first — Tauri's build script validates `externalBin` paths even
  for `cargo check`); and a full Tauri release build — on every push/PR.
