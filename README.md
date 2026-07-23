# FiveM Clothing Studio

A professional desktop editor for FiveM clothing resources — open existing clothing
packs, create and edit drawables/textures, and export server-ready resources,
**without ever changing an existing drawable or texture ID.**

Built with Tauri (Rust) + React + TypeScript + Zustand + SQLite.

> **Status: Phase 1 complete.** See [docs/ROADMAP.md](docs/ROADMAP.md) for what's
> implemented today vs. planned, and [docs/FILE_FORMATS.md](docs/FILE_FORMATS.md)
> for an honest breakdown of what is and isn't parsed at a binary level yet.

## Why this exists

FiveM clothing packs are just files (`.ydd` meshes, `.ytd` textures, `.meta`/`.xml`
metadata, `fxmanifest.lua`) glued together by numeric drawable/texture IDs. Get the
IDs wrong — e.g. by deleting item #2 out of a list of five and having #3/#4 silently
renumber — and every player's saved outfit on your server breaks. This tool exists
to make editing those packs safe: **IDs are reserved slots, never renumbered.**

## Tech stack

| Layer      | Choice                                              |
| ---------- | ---------------------------------------------------- |
| Frontend   | React 18, TypeScript, Vite, Tailwind CSS             |
| Components | Radix UI primitives, shadcn-style (`src/components/ui`) |
| Desktop    | Tauri 2 (Rust)                                       |
| State      | Zustand                                              |
| Database   | SQLite (via `rusqlite`, one `.fcstudio` file per project) |
| 3D         | React Three Fiber / Three.js (Phase 3, not yet wired up) |

## Getting started

```bash
npm install
npm run tauri dev     # full desktop app
# or, for UI-only iteration in a browser (file system features are disabled):
npm run dev
```

### Linux prerequisites

Tauri needs the WebKitGTK stack to build on Linux:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev libsoup-3.0-dev
```

### Scripts

```bash
npm run typecheck   # tsc project references, no emit
npm run lint         # eslint
npm run test         # vitest (frontend unit tests)
npm run build        # production frontend build
npm run tauri build   # full desktop installers (see src-tauri/)

cd src-tauri
cargo test           # backend unit tests (slot system, db, parsers, validation)
cargo clippy          # backend lints
```

## Project layout

```
src/                    React frontend
  components/
    ui/                 Radix-based primitives (button, dialog, select, ...)
    layout/              Toolbar, Sidebar, Inspector, MainLayout, StatusBar
    clothing/            Virtualized grid/list views for the clothing collection
    project/             New/Open project, Import, Export dialogs
    dialogs/             Validation dialog
    texture/, mesh/, preview/   Phase 3/4 placeholders (empty on purpose — see ROADMAP)
  stores/                Zustand stores: project state + undo/redo, UI state
  lib/                   slotSystem.ts (the core ID-safety algorithm), validation.ts, tauri.ts
  types/                 Shared domain model

src-tauri/               Rust backend
  src/
    commands/            Tauri commands: project, import, export, assets, validate
    parsers/             filename.rs, fxmanifest.rs, meta_xml.rs
    db.rs                 SQLite schema + CRUD for .fcstudio project files
    slot_system.rs         Authoritative Rust mirror of src/lib/slotSystem.ts
    models.rs              Domain model shared over the Tauri IPC boundary
```

## The slot system, in one paragraph

Every drawable/prop lives in a numbered "track" scoped by
`(gender, component-or-prop, component id)`. Deleting an item sets its slot to
`null` — a permanent hole — and the track is **never truncated**, so every other
item's id is untouched. A new item reuses the lowest free hole, or appends past the
end. Importing a pack reserves the *exact* ids found in its filenames, and a slot
conflict (two items claiming the same id in the same track) is reported as a hard
error, never silently resolved. See `src/lib/slotSystem.ts` and
`src-tauri/src/slot_system.rs` (kept in lockstep, both fully unit tested) plus
[docs/SLOT_SYSTEM.md](docs/SLOT_SYSTEM.md).

## License

MIT. See file headers / `LICENSE` (add your project's license before distributing).
