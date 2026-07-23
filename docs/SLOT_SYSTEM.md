# The Slot System

This is the single most important guarantee this project makes:

> Once a drawable or texture has a numeric id, that id never changes for the
> lifetime of the project — not on delete, not on reorder, not on export.

## The exact scenario from the spec

```
Before:  [0] [1] [2] [3] [4]
Delete drawable 2.
After:   [0] [1]  ·  [3] [4]     <- correct: a permanent hole at 2
NOT:     [0] [1] [2] [3]          <- wrong: 3 and 4 silently renumbered
```

`src/lib/slotSystem.test.ts` and `src-tauri/src/slot_system.rs`'s test module
both encode this exact scenario as a test, byte-for-byte matching the spec's
own example.

## How it works

A **track** is one numbering sequence, keyed by `(gender, itemType, componentId)`
— e.g. "male torsos" and "female torsos" are independent tracks, each starting
its own `0, 1, 2, ...` sequence. A track is represented as a sparse array where
index = the numeric id and value = the owning item's internal (UUID) id, or
`null` for a free/reserved slot.

Four operations, and only four:

- **`allocateSlot`** — used when creating a brand-new item. Reuses the lowest
  `null` slot if one exists; otherwise appends. This is how a hole left by a
  delete gets reused by the *next* new item, without ever touching anyone
  else's id.
- **`reserveExactSlot`** — used when importing an existing pack, where the id
  is already fixed by the source filenames. Grows the track with holes up to
  that id if needed, and **throws/errors on conflict** rather than silently
  picking a different id — a real id collision in imported data is a bug to
  surface, never to paper over.
- **`releaseSlot`** — used when deleting an item. Sets that one index to
  `null`. The array is never truncated, even if the freed slot happens to be
  the last one — no operation in this module ever shrinks a track, so no id
  can ever be observed to shift.
- **`diffPreservesIds`** (TS only, used in tests/validation) — given a
  before/after pair of tracks, asserts every previously-occupied id still
  resolves to the same owner. This is the invariant, expressed as code you can
  assert against directly.

## Why two implementations

`src/lib/slotSystem.ts` (frontend) and `src-tauri/src/slot_system.rs` (backend)
implement this independently — not generated from one source — so the UI can
give instant optimistic feedback on every edit while the backend remains the
authoritative check on every save/import/export. Both are fully unit tested
(11 TS tests, 6 Rust tests) against the same scenarios.

## What this does *not* cover (yet)

The slot system guarantees numeric-id stability. It does not by itself
guarantee the *content* referenced by an id is valid (e.g. that the `.ydd`
file still exists on disk) — that's what `src/lib/validation.ts` /
`src-tauri/src/commands/validate.rs` check, as a separate, complementary
layer, right before export.
