# File Formats — What's Actually Implemented

Honest, per-format breakdown of what FiveM Clothing Studio does today
(through Phase 4) vs. what's planned. No format below is faked or stubbed to
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
3. **Vertex/index geometry content** (Phase 3) — `export-geometry` returns
   real positions, normals, UV0, triangle indices, and (Phase 4) a
   per-vertex dominant bone index per geometry, powering the isolated mesh
   preview (`src/components/preview/MeshPreview.tsx`) and its bone-weight
   visualization toggle. This is the **one piece of this project's decoding
   that could not be empirically cross-validated** the way everything else
   was (no real `.ydd` file to test the read path against, and
   hand-constructing a valid `VertexDeclaration` to test in isolation turned
   out to be infeasible — CodeWalker.Core only ever builds one from real
   file bytes). The implementation calls CodeWalker.Core's own
   `VertexData.GetVector3`/`GetVector2`/`GetUByte4` accessors (the same ones
   its production 3D renderer uses) with `VertexSemantics` indices rather
   than re-deriving the binary packing itself — see `docs/ROADMAP.md`'s
   Phase 3 section for the full reasoning and what to check first if a real
   pack ever renders with a visibly wrong mesh shape.
4. **Write-back** (Phase 4) — `repair-ytd`/`repair-ydd` load a real file
   through CodeWalker.Core's reader and re-serialize it through the same
   library's writer, verifying the output reloads with matching content
   *before* writing anything to disk. This is real, not a stub: verified
   against the committed `sample.ytd` fixture (155 bytes in, 155 bytes out,
   identical content on reload) and exposed as a "Repair" action in the
   Inspector. What it does *not* do yet is apply content *edits* — it proves
   the write path with the object graph unchanged; wiring actual geometry
   edits through the same path is explicitly out of scope for this project
   (see `docs/ROADMAP.md`'s Phase 4 section for why).

Every `.ydd` is still also copied byte-for-byte into project storage and
SHA-256 hashed on import/export regardless of whether it's ever decoded —
drawable ids come from the *filename*, not the binary content, so the
never-renumber guarantee never depended on decoding working.

## `.ytd` (texture dictionary)

Same layered treatment as `.ydd`, now including real pixel decoding:

1. **Structural decode** (Phase 2) via the sidecar's `inspect-ytd`: name,
   width, height, depth, mip level count, pixel format
   (`D3DFMT_DXT1`/`DXT5`/`BC7`/...), and byte-accurate `.dds` extraction via
   `DDSIO.GetDDSFile` — no `System.Drawing`/GDI+ dependency, so it stays
   cross-platform-safe (see `sidecar/README.md`'s platform notes).
2. **Real pixel decoding to a viewable image** (Phase 3), entirely in Rust,
   no sidecar round-trip needed once the `.dds` is on disk
   (`src-tauri/src/texture_decode.rs`): DDS header parsing (`ddsfile`) +
   BC1/BC2/BC3/BC4/BC5/BC7 block decompression (`texture2ddecoder`, MIT OR
   Apache-2.0) + uncompressed 32bpp formats, encoded to PNG (`image`).
   Powers the Texture Viewer (`src/components/texture/TextureViewer.tsx`,
   real image + export-as-PNG/export-as-DDS) and card thumbnails
   (`ClothingDrawable.thumbnail`, a small downsampled PNG generated once per
   item so the SQLite project file doesn't balloon with full-resolution
   images). Cross-validated against a real BC1 `.dds` extracted by the
   sidecar (`src-tauri/tests/fixtures/sample_bc1.dds`), not just
   hand-crafted test data — see `texture_decode_fixture_test.rs`.
3. **Write-back: real pixel content editing** (Phase 6, "Design Studio",
   `src/components/design/`): recolor, replace with an uploaded image, or
   hand-paint a texture, then write the result for real into the `.ytd`.
   The edited image is encoded to a real DDS in Rust
   (`src-tauri/src/texture_encode.rs`, `D3DFMT_A8R8G8B8` uncompressed — this
   project has a BC decoder but not a BC encoder, so output isn't
   recompressed into BC1/3/7; the honest tradeoff is a larger file over an
   unverified compressor), then the sidecar's `replace-texture`
   (`Commands.cs::ReplaceTexture`) loads the real `.ytd`, swaps that
   texture's data via `DDSIO.GetTexture` (CodeWalker's own DDS-import path),
   and verifies the re-serialized output before writing — same
   verify-before-write shape as `repair-ytd`/`repair-ydd`. Empirically
   proven end to end, not just self-consistency: a Rust-encoded DDS was
   written through the real sidecar, extracted back out, and decoded again,
   with pixels matching the original exactly (CI's sidecar smoke test, plus
   `texture_encode::tests::round_trips_through_the_real_decoder`).

Mip levels beyond 0 aren't decoded/selectable yet (a natural viewer
enhancement, not implemented). Mesh/shape editing remains out of scope —
Design Studio only ever changes texture pixels, never geometry (see
`docs/ROADMAP.md`'s Phase 4 "Why raw vertex editing is out of scope").

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
