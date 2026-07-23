# File Formats — What's Actually Implemented

Honest, per-format breakdown of what FiveM Clothing Studio does today
(through Phase 2) vs. what's planned. No format below is faked or stubbed to
look more complete than it is — where something isn't implemented, it's
explicitly rejected/flagged rather than silently mishandled.

## `.ydd` (drawable mesh)

**Two layers, two implementations, both real:**

1. **RSC7 container** (the outer compressed wrapper every `.ydd`/`.ytd` uses)
   — decoded natively in Rust, `src-tauri/src/parsers/rage_resource.rs`.
   Header parsing, the flags→buffer-size formula, and raw-DEFLATE
   decompression, empirically verified against a real file (see below), not
   guessed from documentation. Used for fast structural
   integrity checks without needing the sidecar.
2. **Object graph** (the actual Drawable: geometry, bones, LODs, bounding
   volumes) — decoded via the `codewalker-bridge` sidecar
   (`sidecar/CodeWalkerBridge/`), which wraps the real `CodeWalker.Core`
   library. `inspect-ydd` returns, per drawable: name, bounding box/sphere,
   which LODs are present and at what distance, the full bone list
   (name/index/parent), aggregate model/geometry/vertex/triangle counts, and
   whether an embedded texture dictionary is present. Wired into the
   Inspector's on-demand "Decode" action.

Still not implemented: extracting actual vertex/index buffer *content*
(positions, normals, UVs — needed to render a mesh, not just report its
stats) and any write-back path for edited geometry. Both are Phase 3/4 scope
(3D preview needs the former; the mesh editor needs both). See
`docs/ROADMAP.md`.

Every `.ydd` is still also copied byte-for-byte into project storage and
SHA-256 hashed on import/export regardless of whether it's ever decoded —
drawable ids come from the *filename*, not the binary content, so the
never-renumber guarantee never depended on decoding working.

## `.ytd` (texture dictionary)

Same two-layer treatment as `.ydd`. The sidecar's `inspect-ytd` returns, per
texture: name, width, height, depth, mip level count, and pixel format
(`D3DFMT_DXT1`/`DXT5`/`BC7`/...), and can extract each texture as a real,
standard `.dds` file via `DDSIO.GetDDSFile` — a byte-accurate conversion with
no `System.Drawing`/GDI+ dependency, so it stays cross-platform-safe (see
`sidecar/README.md`'s platform notes).

PNG/thumbnail conversion (for inline UI previews without a DDS-aware viewer)
is deliberately not implemented yet — see Phase 3 in `docs/ROADMAP.md` for
why, and the cross-platform tradeoff involved.

### How the RSC7 formula was verified without Rockstar-produced sample files

No real GTA V asset files are available in or distributable with this
project. Instead, `sidecar/CodeWalkerBridge`'s `gen-test-ytd` command builds
a small but genuinely valid `.ytd` **using CodeWalker.Core's own writer**,
self-verifies it round-trips through CodeWalker.Core's own reader, and that
exact file is committed as `src-tauri/tests/fixtures/sample.ytd`. The Rust
RSC7 reader is tested against those real bytes
(`src-tauri/tests/rage_resource_fixture_test.rs`) — this is empirical
cross-validation against the authoritative reference implementation, not a
self-consistency check against Rust's own assumptions.

## `.ymt` (binary metadata, e.g. ped component YMT)

**Phase 1: opaque asset, explicitly flagged.** Real `.ymt` is RSC7-compressed
RAGE resource data — not plain XML. Import detects `.ymt` files, carries them
through untouched, and adds an explicit import warning noting they were not
decoded. (Many modern FiveM clothing resources don't ship a binary `.ymt` at
all — they use the plain-XML `.meta`/`content.xml` mechanism below instead,
which Phase 1 *does* parse structurally.)

## `.meta` / `.xml` (e.g. `dlc.meta`, `contentunits.meta`, `shop_ped_component.meta`)

**Phase 1: real, generic XML parsing — deliberately schema-agnostic.** These
files are plain XML, so `src-tauri/src/parsers/meta_xml.rs` parses them for
real using `quick-xml`: every element is flattened into a `tag.path -> value`
map (repeated siblings disambiguated, attributes captured), which is honest,
correct, and fully unit-tested.

What it does *not* do is hardcode assumptions about which specific tags mean
"this is drawable id 7's display name" for every one of GTA's many, partially
undocumented meta schemas — doing that without a verified spec would risk
silently mis-mapping data, which is worse than not mapping it. Instead:

- The original file is preserved byte-for-byte and carried through export.
- Well-defined, narrow cases the project *is* confident about are handled
  directly: `fxmanifest.lua` (full read + deterministic regeneration) and
  drawable/texture/component/gender identification via filename convention
  (see above).
- Deep, schema-aware mapping of specific FiveM meta schemas onto structured,
  editable clothing fields is Phase 2 work, to be built against verified
  schema documentation rather than best-effort guessing.

## `fxmanifest.lua`

**Fully implemented**, both directions. `src-tauri/src/parsers/fxmanifest.rs`
parses the well-defined subset every real clothing resource manifest uses
(`fx_version`, `game`, `name`, `author`, `description`, `version`, `files {...}`)
and regenerates a deterministic, correct manifest on export — this is Lua
*we* control the shape of on the way out, not something we're guessing at on
the way in.

## `shop_items.meta` / DLC metadata (`dlc.meta`, `content.xml`)

Recognized by filename during import (structurally parsed via the generic XML
reader above). On export, the "DLC Pack" format writes a *skeleton*
`dlc.meta`/`content.xml` (the well-known `<CDLCData>` /
`<CDataFileMgr__ContentsOfDataFileXml>` root structures) alongside a real,
working resource folder — but does not auto-populate DLC content-change-sets
per item, since that requires the same verified-schema work as above. **The
"FiveM Resource" and "ZIP" export formats are the recommended, fully
self-contained path** — modern FiveM addon clothing works by streaming
`.ydd`/`.ytd` via `fxmanifest.lua`'s `files{}` list directly, no DLC packaging
required, and that path is complete and exercised by this project's export
pipeline end to end.
