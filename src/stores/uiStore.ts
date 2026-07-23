import { create } from "zustand";
import { DEFAULT_FILTERS, type ClothingFilters, type ViewMode } from "@/types/clothing";

interface UiStore {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  filters: ClothingFilters;
  setFilters: (patch: Partial<ClothingFilters>) => void;
  resetFilters: () => void;

  selectedIds: Set<string>;
  activeId: string | null;
  select: (id: string, opts?: { additive?: boolean; range?: boolean }) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;

  sidebarSection: "project" | "dlc" | "components" | "props";
  setSidebarSection: (s: UiStore["sidebarSection"]) => void;

  isImportDialogOpen: boolean;
  isExportDialogOpen: boolean;
  isValidationDialogOpen: boolean;
  isNewProjectDialogOpen: boolean;
  isNewItemDialogOpen: boolean;
  setDialog: (dialog: "import" | "export" | "validation" | "newProject" | "newItem", open: boolean) => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  viewMode: "grid",
  setViewMode: (mode) => set({ viewMode: mode }),

  filters: DEFAULT_FILTERS,
  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  selectedIds: new Set(),
  activeId: null,
  select: (id, opts) => {
    const { selectedIds } = get();
    if (opts?.additive) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ selectedIds: next, activeId: id });
      return;
    }
    set({ selectedIds: new Set([id]), activeId: id });
  },
  selectMany: (ids) => set({ selectedIds: new Set(ids), activeId: ids[ids.length - 1] ?? null }),
  clearSelection: () => set({ selectedIds: new Set(), activeId: null }),
  toggleSelection: (id) => {
    const next = new Set(get().selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selectedIds: next });
  },

  sidebarSection: "project",
  setSidebarSection: (s) => set({ sidebarSection: s }),

  isImportDialogOpen: false,
  isExportDialogOpen: false,
  isValidationDialogOpen: false,
  isNewProjectDialogOpen: false,
  isNewItemDialogOpen: false,
  setDialog: (dialog, open) => {
    switch (dialog) {
      case "import":
        set({ isImportDialogOpen: open });
        break;
      case "export":
        set({ isExportDialogOpen: open });
        break;
      case "validation":
        set({ isValidationDialogOpen: open });
        break;
      case "newProject":
        set({ isNewProjectDialogOpen: open });
        break;
      case "newItem":
        set({ isNewItemDialogOpen: open });
        break;
    }
  },
}));
