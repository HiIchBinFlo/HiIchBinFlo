import { create } from "zustand";
import type { ClothingDrawable, DlcInfo, Project } from "@/types/clothing";
import {
  allocateSlot,
  createSlotTable,
  releaseSlot,
  reserveExactSlot,
  slotKey,
  type SlotTable,
} from "@/lib/slotSystem";
import { generateId, nowIso } from "@/lib/utils";

export interface ProjectState {
  items: ClothingDrawable[];
  dlcs: DlcInfo[];
  slotTable: SlotTable;
}

function emptyState(): ProjectState {
  return { items: [], dlcs: [], slotTable: createSlotTable() };
}

const MAX_HISTORY = 100;

interface ProjectStore {
  project: Project | null;
  state: ProjectState;
  past: ProjectState[];
  future: ProjectState[];
  isDirty: boolean;
  lastSavedAt: string | null;

  newProject: (project: Project) => void;
  loadProject: (project: Project, items: ClothingDrawable[], dlcs: DlcInfo[]) => void;
  closeProject: () => void;

  addDlc: (dlc: Omit<DlcInfo, "id">) => string;
  removeDlc: (id: string) => void;

  /** Creates a brand-new clothing item and allocates it a fresh numeric slot. */
  addItem: (
    partial: Omit<
      ClothingDrawable,
      "id" | "drawableId" | "createdAt" | "updatedAt" | "textures" | "hashes" | "metadata" | "tags"
    > &
      Partial<Pick<ClothingDrawable, "textures" | "hashes" | "metadata" | "tags">>,
  ) => string;

  /** Registers an item at an EXACT preexisting numeric id (used by the importer). */
  importItem: (item: ClothingDrawable) => void;

  updateItem: (id: string, patch: Partial<ClothingDrawable>) => void;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => string | null;

  replaceState: (next: ProjectState) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  markSaved: () => void;
}

function pushHistory(get: () => ProjectStore, set: (partial: Partial<ProjectStore>) => void) {
  const { state, past } = get();
  const nextPast = [...past, state].slice(-MAX_HISTORY);
  set({ past: nextPast, future: [] });
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  state: emptyState(),
  past: [],
  future: [],
  isDirty: false,
  lastSavedAt: null,

  newProject: (project) => {
    set({
      project,
      state: emptyState(),
      past: [],
      future: [],
      isDirty: false,
      lastSavedAt: null,
    });
  },

  loadProject: (project, items, dlcs) => {
    let table = createSlotTable();
    for (const item of items) {
      const key = slotKey(item.gender, item.itemType, item.componentId);
      table = reserveExactSlot(table, key, item.drawableId, item.id);
    }
    set({
      project,
      state: { items, dlcs, slotTable: table },
      past: [],
      future: [],
      isDirty: false,
      lastSavedAt: nowIso(),
    });
  },

  closeProject: () => {
    set({ project: null, state: emptyState(), past: [], future: [], isDirty: false, lastSavedAt: null });
  },

  addDlc: (dlc) => {
    pushHistory(get, set);
    const id = generateId();
    const { state } = get();
    set({
      state: { ...state, dlcs: [...state.dlcs, { ...dlc, id }] },
      isDirty: true,
    });
    return id;
  },

  removeDlc: (id) => {
    pushHistory(get, set);
    const { state } = get();
    set({
      state: { ...state, dlcs: state.dlcs.filter((d) => d.id !== id) },
      isDirty: true,
    });
  },

  addItem: (partial) => {
    pushHistory(get, set);
    const { state } = get();
    const id = generateId();
    const key = slotKey(partial.gender, partial.itemType, partial.componentId);
    const { table, id: drawableId } = allocateSlot(state.slotTable, key, id);
    const timestamp = nowIso();
    const item: ClothingDrawable = {
      ...partial,
      id,
      drawableId,
      tags: partial.tags ?? [],
      textures: partial.textures ?? [],
      hashes: partial.hashes ?? {},
      metadata: partial.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    set({
      state: { ...state, items: [...state.items, item], slotTable: table },
      isDirty: true,
    });
    return id;
  },

  importItem: (item) => {
    const { state } = get();
    const key = slotKey(item.gender, item.itemType, item.componentId);
    const table = reserveExactSlot(state.slotTable, key, item.drawableId, item.id);
    set({
      state: { ...state, items: [...state.items, item], slotTable: table },
    });
  },

  updateItem: (id, patch) => {
    pushHistory(get, set);
    const { state } = get();
    set({
      state: {
        ...state,
        items: state.items.map((item) =>
          item.id === id ? { ...item, ...patch, id: item.id, updatedAt: nowIso() } : item,
        ),
      },
      isDirty: true,
    });
  },

  removeItem: (id) => {
    pushHistory(get, set);
    const { state } = get();
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    const key = slotKey(item.gender, item.itemType, item.componentId);
    const table = releaseSlot(state.slotTable, key, item.drawableId);
    set({
      state: { ...state, items: state.items.filter((i) => i.id !== id), slotTable: table },
      isDirty: true,
    });
  },

  duplicateItem: (id) => {
    const { state } = get();
    const source = state.items.find((i) => i.id === id);
    if (!source) return null;
    pushHistory(get, set);
    const newId = generateId();
    const key = slotKey(source.gender, source.itemType, source.componentId);
    const { table, id: drawableId } = allocateSlot(state.slotTable, key, newId);
    const timestamp = nowIso();
    const copy: ClothingDrawable = {
      ...source,
      id: newId,
      drawableId,
      name: `${source.name} (Copy)`,
      textures: source.textures.map((t) => ({ ...t })),
      hashes: { ...source.hashes },
      metadata: { ...source.metadata },
      tags: [...source.tags],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    set({
      state: { ...state, items: [...state.items, copy], slotTable: table },
      isDirty: true,
    });
    return newId;
  },

  replaceState: (next) => {
    pushHistory(get, set);
    set({ state: next, isDirty: true });
  },

  undo: () => {
    const { past, future, state } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      state: previous,
      past: past.slice(0, -1),
      future: [state, ...future].slice(0, MAX_HISTORY),
      isDirty: true,
    });
  },

  redo: () => {
    const { past, future, state } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      state: next,
      past: [...past, state].slice(-MAX_HISTORY),
      future: future.slice(1),
      isDirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  markSaved: () => set({ isDirty: false, lastSavedAt: nowIso() }),
}));
