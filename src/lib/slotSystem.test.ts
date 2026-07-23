import { describe, expect, it } from "vitest";
import {
  allocateSlot,
  createSlotTable,
  diffPreservesIds,
  freeSlots,
  isSlotOccupied,
  occupiedSlots,
  ownerOfSlot,
  releaseSlot,
  reserveExactSlot,
  slotKey,
  SlotConflictError,
} from "./slotSystem";

const KEY = slotKey("male", "component", 3);

describe("slotSystem", () => {
  it("allocates sequential ids starting at 0", () => {
    let table = createSlotTable();
    let res = allocateSlot(table, KEY, "item-a");
    expect(res.id).toBe(0);
    table = res.table;
    res = allocateSlot(table, KEY, "item-b");
    expect(res.id).toBe(1);
    table = res.table;
    res = allocateSlot(table, KEY, "item-c");
    expect(res.id).toBe(2);
  });

  it("reproduces the exact scenario from the spec: deleting id 2 of [0,1,2,3,4] leaves a permanent hole", () => {
    let table = createSlotTable();
    const owners = ["a", "b", "c", "d", "e"];
    for (const owner of owners) {
      table = allocateSlot(table, KEY, owner).table;
    }
    expect(occupiedSlots(table, KEY).map((s) => s.id)).toEqual([0, 1, 2, 3, 4]);

    // Delete drawable id 2 ("c")
    table = releaseSlot(table, KEY, 2);

    expect(isSlotOccupied(table, KEY, 2)).toBe(false);
    // Ids 3 and 4 must NOT shift down to 2 and 3.
    expect(ownerOfSlot(table, KEY, 3)).toBe("d");
    expect(ownerOfSlot(table, KEY, 4)).toBe("e");
    expect(occupiedSlots(table, KEY).map((s) => s.id)).toEqual([0, 1, 3, 4]);
  });

  it("reuses the lowest free slot for the next new item", () => {
    let table = createSlotTable();
    for (const owner of ["a", "b", "c", "d", "e"]) {
      table = allocateSlot(table, KEY, owner).table;
    }
    table = releaseSlot(table, KEY, 2);

    const res = allocateSlot(table, KEY, "f");
    expect(res.id).toBe(2);
    expect(ownerOfSlot(res.table, KEY, 2)).toBe("f");
    // Untouched neighbors still hold their original ids.
    expect(ownerOfSlot(res.table, KEY, 1)).toBe("b");
    expect(ownerOfSlot(res.table, KEY, 3)).toBe("d");
  });

  it("appends to the end when there is no free slot", () => {
    let table = createSlotTable();
    table = allocateSlot(table, KEY, "a").table;
    table = allocateSlot(table, KEY, "b").table;
    const res = allocateSlot(table, KEY, "c");
    expect(res.id).toBe(2);
  });

  it("freeing the last slot still never shrinks the track (no id ever renumbers)", () => {
    let table = createSlotTable();
    table = allocateSlot(table, KEY, "a").table;
    table = allocateSlot(table, KEY, "b").table;
    table = releaseSlot(table, KEY, 1);
    // Track length stays 2; slot 1 is a hole, not removed.
    expect(freeSlots(table, KEY)).toEqual([1]);
    const res = allocateSlot(table, KEY, "c");
    expect(res.id).toBe(1);
  });

  it("keeps separate numbering per gender/itemType/component track", () => {
    let table = createSlotTable();
    const maleTorso = slotKey("male", "component", 3);
    const femaleTorso = slotKey("female", "component", 3);
    table = allocateSlot(table, maleTorso, "m1").table;
    table = allocateSlot(table, femaleTorso, "f1").table;
    table = allocateSlot(table, maleTorso, "m2").table;
    expect(ownerOfSlot(table, maleTorso, 1)).toBe("m2");
    expect(ownerOfSlot(table, femaleTorso, 0)).toBe("f1");
    expect(ownerOfSlot(table, femaleTorso, 1)).toBeNull();
  });

  it("reserveExactSlot preserves ids coming from an imported pack", () => {
    let table = createSlotTable();
    table = reserveExactSlot(table, KEY, 5, "imported-item");
    expect(ownerOfSlot(table, KEY, 5)).toBe("imported-item");
    // Slots 0-4 exist as untouched holes, not allocated.
    expect(freeSlots(table, KEY)).toEqual([0, 1, 2, 3, 4]);
  });

  it("reserveExactSlot throws on conflicting ownership", () => {
    let table = createSlotTable();
    table = reserveExactSlot(table, KEY, 0, "item-a");
    expect(() => reserveExactSlot(table, KEY, 0, "item-b")).toThrow(SlotConflictError);
  });

  it("releaseSlot rejects out-of-range ids", () => {
    const table = createSlotTable();
    expect(() => releaseSlot(table, KEY, 0)).toThrow(RangeError);
  });

  it("diffPreservesIds detects a violated invariant", () => {
    let before = createSlotTable();
    before = allocateSlot(before, KEY, "a").table;
    before = allocateSlot(before, KEY, "b").table;

    // Simulate a bad rewrite that renumbers "b" from 1 to 0 after "a" was removed.
    let after = createSlotTable();
    after = reserveExactSlot(after, KEY, 0, "b");

    const diff = diffPreservesIds(before, after);
    expect(diff.preserved).toBe(false);
    // Slot 0 changed owner (a -> b) and slot 1 ("b") disappeared entirely — both are violations.
    expect(diff.violations).toEqual([
      { key: KEY, id: 0 },
      { key: KEY, id: 1 },
    ]);
  });

  it("diffPreservesIds passes when only free slots change", () => {
    let before = createSlotTable();
    before = allocateSlot(before, KEY, "a").table;
    before = allocateSlot(before, KEY, "b").table;
    before = releaseSlot(before, KEY, 0);

    let after = before;
    after = allocateSlot(after, KEY, "c").table; // reuses slot 0

    const diff = diffPreservesIds(before, after);
    expect(diff.preserved).toBe(true);
  });
});
