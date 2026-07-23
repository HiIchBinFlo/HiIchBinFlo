/**
 * Slot System
 * ===========
 *
 * The single invariant this module exists to guarantee:
 *
 *   Once a drawable (or texture) has been assigned a numeric id, that id
 *   NEVER changes for the lifetime of the project — not on delete, not on
 *   reorder, not on export. Deleting item #2 leaves a permanent hole at #2;
 *   it does not shift #3 and #4 down.
 *
 * Slots are scoped independently per (gender, itemType, componentId) —
 * male torsos, female torsos, male "hat" props etc. each have their own
 * 0..N numbering sequence, exactly like the game engine expects.
 *
 * A `SlotTrack<T>` is a sparse array: index === the numeric game id,
 * value === the owning item's internal id, or `null` for a free/reserved
 * slot (either never allocated, or freed by a delete). The array only ever
 * grows; it is never truncated, so a hole can never be observed to "heal".
 */

export type SlotTrack = (string | null)[];

export interface SlotTable {
  tracks: Record<string, SlotTrack>;
}

export function createSlotTable(): SlotTable {
  return { tracks: {} };
}

export function slotKey(gender: string, itemType: string, componentId: number): string {
  return `${gender}:${itemType}:${componentId}`;
}

function getTrack(table: SlotTable, key: string): SlotTrack {
  return table.tracks[key] ?? [];
}

export interface AllocationResult {
  table: SlotTable;
  id: number;
}

/**
 * Allocates a numeric id for a new item: reuses the lowest free/reserved
 * slot if one exists, otherwise appends a new slot at the end.
 */
export function allocateSlot(table: SlotTable, key: string, ownerId: string): AllocationResult {
  const track = getTrack(table, key);
  const freeIndex = track.indexOf(null);
  const nextTrack = track.slice();
  let id: number;
  if (freeIndex !== -1) {
    nextTrack[freeIndex] = ownerId;
    id = freeIndex;
  } else {
    nextTrack.push(ownerId);
    id = nextTrack.length - 1;
  }
  return {
    table: { tracks: { ...table.tracks, [key]: nextTrack } },
    id,
  };
}

/**
 * Reserves an EXACT id (used when importing an existing pack — the id
 * already exists in the source files and must be preserved verbatim).
 * Throws if the slot is already occupied by a different owner.
 */
export function reserveExactSlot(
  table: SlotTable,
  key: string,
  id: number,
  ownerId: string,
): SlotTable {
  const track = getTrack(table, key).slice();
  while (track.length <= id) track.push(null);
  const existing = track[id];
  if (existing !== null && existing !== ownerId) {
    throw new SlotConflictError(key, id, existing, ownerId);
  }
  track[id] = ownerId;
  return { tracks: { ...table.tracks, [key]: track } };
}

/**
 * Frees a slot. The array is never truncated — the id becomes a permanent
 * hole (`null`) that a future allocateSlot() call may reuse, but no other
 * id in the track is ever touched.
 */
export function releaseSlot(table: SlotTable, key: string, id: number): SlotTable {
  const track = getTrack(table, key);
  if (id < 0 || id >= track.length) {
    throw new RangeError(`Cannot release slot ${id} in track "${key}": out of range`);
  }
  const nextTrack = track.slice();
  nextTrack[id] = null;
  return { tracks: { ...table.tracks, [key]: nextTrack } };
}

export function isSlotOccupied(table: SlotTable, key: string, id: number): boolean {
  const track = getTrack(table, key);
  return id >= 0 && id < track.length && track[id] !== null;
}

export function ownerOfSlot(table: SlotTable, key: string, id: number): string | null {
  const track = getTrack(table, key);
  return id >= 0 && id < track.length ? track[id] : null;
}

/** All occupied (id, ownerId) pairs in a track, in ascending id order. */
export function occupiedSlots(table: SlotTable, key: string): Array<{ id: number; ownerId: string }> {
  const track = getTrack(table, key);
  const result: Array<{ id: number; ownerId: string }> = [];
  track.forEach((ownerId, id) => {
    if (ownerId !== null) result.push({ id, ownerId });
  });
  return result;
}

/** Ids that are free to reuse (reserved holes) in ascending order. */
export function freeSlots(table: SlotTable, key: string): number[] {
  const track = getTrack(table, key);
  const result: number[] = [];
  track.forEach((ownerId, id) => {
    if (ownerId === null) result.push(id);
  });
  return result;
}

export class SlotConflictError extends Error {
  constructor(
    public readonly key: string,
    public readonly id: number,
    public readonly existingOwnerId: string,
    public readonly requestedOwnerId: string,
  ) {
    super(
      `Slot ${id} in track "${key}" is already occupied by "${existingOwnerId}" ` +
        `(requested for "${requestedOwnerId}"). Drawable/texture ids must be unique per track.`,
    );
    this.name = "SlotConflictError";
  }
}

/**
 * Verifies that a full set of (key -> id -> ownerId) assignments, produced
 * before an edit, is still fully reproducible after the edit — i.e. no
 * previously-occupied id changed owner or disappeared. Used by the
 * validation engine and by export as a final safety net.
 */
export function diffPreservesIds(
  before: SlotTable,
  after: SlotTable,
): { preserved: boolean; violations: Array<{ key: string; id: number }> } {
  const violations: Array<{ key: string; id: number }> = [];
  for (const [key, track] of Object.entries(before.tracks)) {
    const afterTrack = after.tracks[key] ?? [];
    track.forEach((ownerId, id) => {
      if (ownerId === null) return;
      if (afterTrack[id] !== ownerId) {
        violations.push({ key, id });
      }
    });
  }
  return { preserved: violations.length === 0, violations };
}
