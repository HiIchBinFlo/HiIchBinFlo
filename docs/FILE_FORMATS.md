# File Formats — What's Actually Implemented

Honest, per-format breakdown of what FiveM Clothing Studio does today (Phase 1)
vs. what's planned. No format below is faked or stubbed to look more complete
than it is — where something isn't implemented, it's explicitly rejected/flagged
rather than silently mishandled.

## `.ydd` (drawable mesh)

**Phase 1: opaque, hash-verified asset.** GTA V's `.ydd` is a proprietary RAGE
engine binary format (compressed resource container, embedded geometry, bones,
LODs). Reading its internals — parsing geometry, letting you inspect/edit
vertices, normals, UVs — is real reverse-engineering/format work that this
project has not yet done and will not fake.

What Phase 1 *does* do, and does correctly: recognizes `.ydd` files by the
standard naming convention (`<component>_<drawableId>_<r|u>.ydd`), copies them
byte-for-byte into project storage, SHA-256 hashes them for integrity/duplicate
detection, tracks presence on disk, and copies them byte-for-byte again on
export. The file's *content* is never touched or reinterpreted — which is
exactly why drawable ids (extracted from the filename, not the binary) are
guaranteed stable across import/edit/export.

**Phase 2/3/4** will add real decoding — integrating or adapting an existing
open-source RAGE-format reader (properly licensed and attributed) rather than
reverse-engineering from scratch — to enable the mesh editor and 3D preview.

## `.ytd` (texture dictionary)

**Phase 1: opaque, hash-verified asset,** same treatment as `.ydd` above.
Recognized via `<component>_diff_<drawableId>_<textureId>_<suffix>_<race>.ytd`,
copied/hashed/tracked, never decoded.

**Phase 3** adds real decoding for the texture viewer (DDS/PNG export,
mipmap generation) — see `src/components/texture/README.md`.

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
