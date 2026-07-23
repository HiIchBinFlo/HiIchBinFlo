# codewalker-bridge

A small, standalone .NET 8 console application that decodes real GTA V/RAGE
`.ydd` (drawable) and `.ytd` (texture dictionary) binary resources, using the
[CodeWalker.Core](https://www.nuget.org/packages/CodeWalker.Core) NuGet
package — the same resource-reading code that powers
[dexyfex/CodeWalker](https://github.com/dexyfex/CodeWalker).

## Why a sidecar, and why not reimplement this in Rust?

FiveM Clothing Studio's Rust backend implements the outer RSC7 *container*
format itself (`src-tauri/src/parsers/rage_resource.rs` — header, compression,
buffer sizing), which is well-documented and was empirically verified against
real output from this very sidecar. The *inner* object graph — how a
Drawable's vertex buffers, bone hierarchy, or a TextureDictionary's texture
list are laid out and pointer-resolved inside that container — is
under-documented enough that a from-scratch Rust reimplementation would be
guesswork with no real files available to validate it against (see
`docs/FILE_FORMATS.md`). Wrapping the real, actively-used CodeWalker.Core
library instead means Phase 2's decoding is correct because it's the same
code thousands of GTA V modders already rely on, not a bet on getting an
undocumented pointer-resolution scheme right on the first try.

**End users never install or run CodeWalker themselves.** This binary is
published self-contained (bundles its own .NET runtime) and shipped as a
[Tauri sidecar](https://v2.tauri.app/develop/sidecar/) alongside the app —
from the user's perspective it's just part of FiveM Clothing Studio.

## Building

Requires the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).

```bash
# Quick local build + run (framework-dependent, for development):
cd sidecar/CodeWalkerBridge
dotnet run -- probe

# Self-contained publish for Tauri bundling (what `npm run tauri dev/build` does automatically):
npm run build:sidecar
```

`scripts/publish-sidecar.mjs` publishes a self-contained, single-file
executable for the current platform and places it at
`src-tauri/binaries/codewalker-bridge-<rust-target-triple>[.exe]`, matching
Tauri's sidecar naming convention. It is **not** committed to git (see
`.gitignore`) — CI and local dev both build it fresh.

## Commands (JSON on stdout, always — `{"ok": true, ...}` or `{"ok": false, "error": "..."}`)

| Command | Purpose |
| --- | --- |
| `probe` | Health check: bridge + CodeWalker.Core version |
| `inspect-ytd <path> [--extract-dir <dir>]` | Decode a `.ytd`: texture name/dimensions/format/mip levels; optionally extract each as a real `.dds` file |
| `inspect-ydd <path>` | Decode a `.ydd`: per-drawable bounding box, LOD presence/distances, bone list, geometry/vertex/triangle counts, embedded texture dictionary |
| `gen-test-ytd <outputPath>` | Dev/test utility: builds and saves a small but real, valid `.ytd` (used to produce `src-tauri/tests/fixtures/sample.ytd` — see that directory for why) |

Deliberately NOT implemented yet (tracked as later-phase work, not silently
faked): PNG/thumbnail conversion (would need either a cross-platform-unsafe
`System.Drawing`/GDI+ dependency here, or a pure decoder on the Rust side —
see `docs/FILE_FORMATS.md`), full vertex buffer extraction (needed for the
Phase 3 3D preview, not Phase 2's parsing/validation scope), and any write-back
path (editing a `.ydd`'s geometry is Phase 4 — Mesh Editor).

## Platform support

Tested and confirmed working on **Linux** (this project's dev sandbox — see
the probe program history in the repo's development notes) in addition to its
intended **Windows** target. `CodeWalker.Core` depends on `SharpDX`/
`SharpDX.Mathematics` for math types (`Vector3`, `Matrix`, `Quaternion`, ...);
these turned out to be pure managed code with no P/Invoke into native
DirectX, so no actual Windows-only rendering API is touched by the
resource-parsing code paths this bridge uses. macOS is expected to work by
the same reasoning (`dotnet publish -r osx-x64/osx-arm64 --self-contained`)
but has not been empirically verified in this project yet.

## License

`CodeWalkerBridge`'s own code (this directory) is MIT-licensed, same as the
rest of this repository. It depends on the `CodeWalker.Core` NuGet package,
whose licensing is summarized in `NOTICE.md` — please read it before
redistributing builds that include this sidecar.
