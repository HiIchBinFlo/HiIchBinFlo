# `mesh/` — reserved for Phase 4 (Mesh Editor)

Still empty as of Phase 3. *Viewing* real mesh geometry now works — see
`src/components/preview/MeshPreview.tsx` (real decoded vertices/normals/UVs,
orbit/zoom, real texture applied). What's not implemented yet, and what this
directory is reserved for, is *editing*: moving vertices/UVs, reassigning
bone weights, switching LOD content, and writing the result back to a valid
`.ydd`. The write-back path is the harder half — CodeWalker.Core can build
valid resources (confirmed via the sidecar's `gen-test-ytd`), but no UI or
Tauri command exists yet to construct an *edited* Drawable's object graph and
save it.
