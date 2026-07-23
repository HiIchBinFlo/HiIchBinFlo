# Architecture

## Process split

Standard Tauri two-process model:

- **Frontend (webview)**: React + TypeScript. Owns UI state (Zustand),
  optimistic edits, undo/redo, and a TypeScript mirror of the slot system for
  instant feedback. Never touches the filesystem directly except through
  `@tauri-apps/plugin-dialog` (native open/save pickers) — all real file I/O
  goes through Tauri commands.
- **Backend (Rust)**: owns the SQLite database, the filesystem, and is the
  *authoritative* copy of the slot system. Every import/export/save round-trip
  is validated here regardless of what the frontend already checked — the
  backend does not trust the caller.

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

All commands return `Result<T, AppError>`; `AppError` serializes to a plain
string the frontend surfaces via `sonner` toasts (`src/lib/tauri.ts`).

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

## Testing

- Rust: `cargo test` in `src-tauri/` — slot system, DB round-trip, filename
  parsing, `fxmanifest.lua` parse/generate round-trip, generic XML flattening,
  validation logic. 23 tests as of Phase 1.
- TypeScript: `npm run test` (Vitest) — slot system, mirroring the Rust suite's
  scenarios exactly (including the spec's own delete-id-2-of-5 example).
- CI (`.github/workflows/ci.yml`): typecheck + lint + test + build for the
  frontend, `cargo check`/`clippy -D warnings`/`test` for the backend, and a
  full Tauri release build, on every push/PR.
