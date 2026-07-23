import { useRef, useState, useLayoutEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ClothingCard } from "./ClothingCard";
import type { ClothingDrawable } from "@/types/clothing";
import { useUiStore } from "@/stores/uiStore";

const CARD_MIN_WIDTH = 168;
// The thumbnail (168px, fixed - see ClothingCard.tsx) plus its name/badges
// section below (~2 lines of text and badge chips with padding). This is
// only an *estimate* for the virtualizer's initial layout - the real height
// is measured per row below, since the badges section can wrap to more
// lines than this guess and previously never got corrected (see the
// `measureElement` ref in the row below).
const CARD_HEIGHT_ESTIMATE = 168 + 64;
const GAP = 10;

interface ClothingGridProps {
  items: ClothingDrawable[];
}

/**
 * Virtualized card grid. Only renders rows within (or near) the visible
 * viewport, so packs with 20,000+ drawables stay smooth — a fixed DOM
 * node count regardless of collection size.
 */
export function ClothingGrid({ items }: ClothingGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const select = useUiStore((s) => s.select);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Measure synchronously right away rather than waiting for the
    // ResizeObserver's first (async) callback - on some platforms/embedded
    // webviews that first callback can lag behind the initial paint, which
    // would otherwise leave `width` at its 0 initial value long enough to
    // render a single very wide column instead of a real grid.
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP)));
  const rows = useMemo(() => {
    const chunks: ClothingDrawable[][] = [];
    for (let i = 0; i < items.length; i += columns) {
      chunks.push(items.slice(i, i + columns));
    }
    return chunks;
  }, [items, columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => CARD_HEIGHT_ESTIMATE + GAP,
    overscan: 6,
  });

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No clothing items match the current filters.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto p-3">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                // No fixed height here on purpose: letting the row size
                // itself to its actual content (the grid of cards below) is
                // what `measureElement` needs to observe the real height and
                // correct `estimateSize`'s guess - a fixed height here would
                // silently clip/overlap taller-than-estimated card content
                // instead, which is exactly the bug this fixes.
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: GAP,
              }}
            >
              {row.map((item) => (
                <ClothingCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onClick={(e) => select(item.id, { additive: e.metaKey || e.ctrlKey })}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
