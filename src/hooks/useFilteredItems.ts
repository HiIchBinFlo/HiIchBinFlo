import { useMemo } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import type { ClothingDrawable } from "@/types/clothing";

function matches(item: ClothingDrawable, filters: ReturnType<typeof useUiStore.getState>["filters"]): boolean {
  if (filters.gender !== "all" && item.gender !== filters.gender) return false;
  if (filters.itemType !== "all" && item.itemType !== filters.itemType) return false;
  if (filters.componentId !== "all" && item.componentId !== filters.componentId) return false;
  if (filters.dlc !== "all" && item.dlc !== filters.dlc) return false;
  if (filters.tags.length > 0 && !filters.tags.every((t) => item.tags.includes(t))) return false;
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const haystack = `${item.name} ${item.category} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function useFilteredItems(): ClothingDrawable[] {
  const items = useProjectStore((s) => s.state.items);
  const filters = useUiStore((s) => s.filters);

  return useMemo(() => items.filter((item) => matches(item, filters)), [items, filters]);
}
