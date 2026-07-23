import { Shirt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { componentLabel, propLabel, type ClothingDrawable } from "@/types/clothing";

interface ClothingCardProps {
  item: ClothingDrawable;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}

export function ClothingCard({ item, selected, onClick, onDoubleClick }: ClothingCardProps) {
  const label = item.itemType === "component" ? componentLabel(item.componentId) : propLabel(item.componentId);
  const hasIssue = !item.mesh || !item.mesh.present;

  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-border bg-secondary/40 text-left transition-colors hover:border-primary/50",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      {/* Fixed height, not aspect-square: a width-driven square would balloon
          vertically without bound if the grid ever computes a single very
          wide column (e.g. a transient 0-width measurement on first paint). */}
      <div className="flex h-[168px] items-center justify-center bg-muted">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <Shirt className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="space-y-1 p-2">
        <div className="flex items-center justify-between gap-1">
          <p className="truncate text-xs font-medium">{item.name}</p>
          <Badge variant="outline" className="shrink-0 font-mono">
            #{item.drawableId}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary">{label}</Badge>
          <Badge variant={item.gender === "male" ? "default" : "warning"}>{item.gender}</Badge>
          {hasIssue && <Badge variant="destructive">Missing file</Badge>}
        </div>
      </div>
    </button>
  );
}
