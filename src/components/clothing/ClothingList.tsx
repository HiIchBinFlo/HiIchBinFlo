import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Shirt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { componentLabel, propLabel, type ClothingDrawable } from "@/types/clothing";
import { useUiStore } from "@/stores/uiStore";

const ROW_HEIGHT = 40;

interface ClothingListProps {
  items: ClothingDrawable[];
}

export function ClothingList({ items }: ClothingListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const select = useUiStore((s) => s.select);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No clothing items match the current filters.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Name</span>
        <span>Type</span>
        <span>Gender</span>
        <span>DLC</span>
        <span>Drawable ID</span>
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          const label = item.itemType === "component" ? componentLabel(item.componentId) : propLabel(item.componentId);
          return (
            <button
              key={row.key}
              onClick={(e) => select(item.id, { additive: e.metaKey || e.ctrlKey })}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
              className={cn(
                "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-border/50 px-3 text-left text-xs hover:bg-accent",
                selectedIds.has(item.id) && "bg-accent",
              )}
            >
              <span className="flex items-center gap-2 truncate">
                <Shirt className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {item.name}
              </span>
              <span className="truncate text-muted-foreground">{label}</span>
              <span>
                <Badge variant={item.gender === "male" ? "default" : "warning"}>{item.gender}</Badge>
              </span>
              <span className="truncate text-muted-foreground">{item.dlc || "—"}</span>
              <span className="font-mono text-muted-foreground">#{item.drawableId}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
