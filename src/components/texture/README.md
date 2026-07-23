# `texture/` — reserved for Phase 3 (Texture Viewer)

Intentionally empty in Phase 1. Viewing/converting `.ytd` texture dictionary
contents (DDS/PNG, mipmaps) requires the same `.ytd` binary reader referenced
in `docs/FILE_FORMATS.md`. Phase 1's Inspector already handles `.ytd` files as
opaque assets (replace/remove/duplicate, hash-verified) — this directory is
for actually decoding and rendering their pixel content, which is Phase 3 work.
