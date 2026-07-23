# FiveM Clothing Studio

A professional desktop editor for FiveM clothing resources — open existing clothing
packs, create and edit drawables/textures, and export server-ready resources,
**without ever changing an existing drawable or texture ID.**

Built with Tauri (Rust) + React + TypeScript + Zustand + SQLite, plus a small
bundled .NET sidecar (`sidecar/CodeWalkerBridge`) wrapping the real
CodeWalker.Core library for genuine `.ydd`/`.ytd` decoding.

> **Status: Phases 1-6 complete**, except packaged installers (deliberately
> not built — see `docs/ROADMAP.md`'s Phase 5). Phase 6 added a **Design
> Studio**: take an existing item's texture as a template and recolor it,
> replace it with an uploaded image, or hand-paint it, then write the result
> for real into the `.ytd` — see `docs/ROADMAP.md`'s Phase 6. See
> [docs/ROADMAP.md](docs/ROADMAP.md) for what's implemented today vs. planned
> (including two documented corrections to earlier versions of that
> document — one in Phase 4, one a real bug Phase 5's scale test caught),
> and [docs/FILE_FORMATS.md](docs/FILE_FORMATS.md) for an honest breakdown of
> what is and isn't parsed at a binary level.

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
| Binary decoding | `codewalker-bridge` (.NET 8, bundled sidecar) wrapping `CodeWalker.Core` — see `sidecar/README.md` |
| Texture decode  | Native Rust: `ddsfile` + `texture2ddecoder` (BC1-7) + `image` (PNG) — `src-tauri/src/texture_decode.rs` |
| 3D         | React Three Fiber / Three.js / drei — isolated mesh preview, lazy-loaded |

## Getting started

```bash
npm install
npm run tauri dev     # full desktop app (also publishes the sidecar automatically)
# or, for UI-only iteration in a browser (file system + decoding features are disabled):
npm run dev
```

### Prerequisites

- **Linux**: Tauri needs the WebKitGTK stack:
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev libssl-dev libsoup-3.0-dev
  ```
- **All platforms**: the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
  is required to build the `codewalker-bridge` sidecar (`npm run tauri dev`/`build`
  do this automatically via `npm run build:sidecar`; see `sidecar/README.md`).

### Scripts

```bash
npm run typecheck    # tsc project references, no emit
npm run lint          # eslint
npm run test          # vitest (frontend unit tests)
npm run build         # production frontend build
npm run build:sidecar # publish the codewalker-bridge sidecar for the current platform
npm run tauri build   # full desktop installers (see src-tauri/)

cd src-tauri
cargo test            # backend unit tests (slot system, db, parsers, RSC7 codec, validation)
cargo clippy           # backend lints

cd sidecar/CodeWalkerBridge
dotnet run -- probe    # sidecar health check
```

## Project layout

```
src/                    React frontend
  components/
    ui/                 Radix-based primitives (button, dialog, select, ...)
    layout/              Toolbar, Sidebar, Inspector, MainLayout, StatusBar, DecodedInfoPanel
    clothing/            Grid/list views, NewClothingItemDialog (Custom Clothing Creator)
    project/             New/Open project, Import, Export dialogs
    dialogs/             Validation dialog
    preview/             Isolated 3D mesh preview (React Three Fiber, lazy-loaded): LOD switch, bone viz
    texture/             Real decoded Texture Viewer (image + export), entry point to Design Studio
    design/              Design Studio (Phase 6): recolor / upload-image / paint, all writing real texture content
    mesh/                Intentionally empty — see its README (raw vertex/mesh editing is out of scope)
  stores/                Zustand stores: project state + undo/redo, UI state
  lib/                   slotSystem.ts (the core ID-safety algorithm), validation.ts, tauri.ts
  types/                 Shared domain model

src-tauri/               Rust backend
  src/
    commands/            Tauri commands: project, import, export, assets, validate, inspect, preview, repair, deep_validate, texture_edit
    parsers/             filename.rs, fxmanifest.rs, meta_xml.rs, rage_resource.rs (RSC7 codec)
    sidecar.rs            Invokes the codewalker-bridge sidecar, parses its JSON output
    texture_decode.rs      BC1-7 DDS decode -> PNG/thumbnail, native Rust
    texture_encode.rs      RGBA -> real DDS encode (Design Studio's write side), native Rust
    db.rs                 SQLite schema + CRUD for .fcstudio project files
    slot_system.rs         Authoritative Rust mirror of src/lib/slotSystem.ts
    models.rs              Domain model shared over the Tauri IPC boundary
  tests/                        Integration tests: import, import->export round trip, large-pack scale test,
                                 RSC7 fixture, BC1 texture fixture
  tests/fixtures/              Real RSC7 (sample.ytd) and BC1 DDS (sample_bc1.dds) fixtures

sidecar/CodeWalkerBridge/    .NET 8 sidecar wrapping CodeWalker.Core for real .ydd/.ytd decoding
scripts/publish-sidecar.mjs   Builds the sidecar for Tauri bundling
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
