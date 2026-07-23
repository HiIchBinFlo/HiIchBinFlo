# `mesh/` — intentionally empty

Real mesh *viewing* and *structural editing* both now exist, just not here:

- Geometry/texture/LOD/bone-assignment viewing:
  `src/components/preview/MeshPreview.tsx` + `MeshPreviewDialog.tsx`.
- Item creation, DLC assignment, file replace/duplicate/repair:
  `src/components/clothing/NewClothingItemDialog.tsx`,
  `src/components/layout/Inspector.tsx`.

What's deliberately not built is interactive vertex/UV *content* editing
(dragging vertices, hand-painting weights) — a full 3D-modeling-tool feature
set that doesn't match how clothing modders actually work (they sculpt in
Blender/3ds Max and export). See the "Why raw vertex editing is out of
scope" note in `docs/ROADMAP.md`'s Phase 4 section for the reasoning. The
write-back path this would need is proven and ready
(`sidecar/CodeWalkerBridge/Commands.cs::RepairYtd`/`RepairYdd`) if that scope
decision is ever revisited.

This scope boundary is specifically about *mesh geometry* — the shape never
changes. *Texture* content editing (recolor, replace with an uploaded image,
hand-paint) is a separate, much lower-risk kind of edit (2D pixels, not 3D
topology) and does exist: see `src/components/design/` (Phase 6, "Design
Studio").
