import { useMemo } from "react";
import { Boxes, Layers, Shirt, Package } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { PED_COMPONENTS, PED_PROPS } from "@/types/clothing";

const SECTIONS = [
  { id: "project", label: "Project", icon: Boxes },
  { id: "dlc", label: "DLC", icon: Layers },
  { id: "components", label: "Components", icon: Shirt },
  { id: "props", label: "Props", icon: Package },
] as const;

export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const section = useUiStore((s) => s.sidebarSection);
  const setSection = useUiStore((s) => s.setSidebarSection);
  const filters = useUiStore((s) => s.filters);
  const setFilters = useUiStore((s) => s.setFilters);

  const componentCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of items) {
      if (item.itemType !== "component") continue;
      counts.set(item.componentId, (counts.get(item.componentId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const propCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of items) {
      if (item.itemType !== "prop") continue;
      counts.set(item.componentId, (counts.get(item.componentId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const dlcCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.dlc, (counts.get(item.dlc) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="p-2">
        <Input
          placeholder="Search clothing…"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      <nav className="flex border-b border-border px-2 pb-2">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 rounded-md py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              section === id && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {section === "project" && (
            <div className="space-y-1">
              {!project ? (
                <p className="p-2 text-xs text-muted-foreground">No project open.</p>
              ) : (
                <>
                  <SidebarRow
                    label="All Items"
                    count={items.length}
                    active={filters.gender === "all" && filters.itemType === "all" && filters.dlc === "all"}
                    onClick={() => setFilters({ gender: "all", itemType: "all", dlc: "all", componentId: "all" })}
                  />
                  <SidebarRow
                    label="Male"
                    count={items.filter((i) => i.gender === "male").length}
                    active={filters.gender === "male"}
                    onClick={() => setFilters({ gender: "male" })}
                  />
                  <SidebarRow
                    label="Female"
                    count={items.filter((i) => i.gender === "female").length}
                    active={filters.gender === "female"}
                    onClick={() => setFilters({ gender: "female" })}
                  />
                </>
              )}
            </div>
          )}

          {section === "dlc" && (
            <div className="space-y-1">
              {dlcs.length === 0 && <p className="p-2 text-xs text-muted-foreground">No DLCs yet.</p>}
              {dlcs.map((dlc) => (
                <SidebarRow
                  key={dlc.id}
                  label={dlc.name}
                  count={dlcCounts.get(dlc.id) ?? 0}
                  active={filters.dlc === dlc.id}
                  onClick={() => setFilters({ dlc: filters.dlc === dlc.id ? "all" : dlc.id })}
                />
              ))}
            </div>
          )}

          {section === "components" && (
            <div className="space-y-1">
              {PED_COMPONENTS.map((c) => (
                <SidebarRow
                  key={c.id}
                  label={c.label}
                  count={componentCounts.get(c.id) ?? 0}
                  active={filters.itemType === "component" && filters.componentId === c.id}
                  onClick={() =>
                    setFilters({
                      itemType: "component",
                      componentId: filters.componentId === c.id ? "all" : c.id,
                    })
                  }
                />
              ))}
            </div>
          )}

          {section === "props" && (
            <div className="space-y-1">
              {PED_PROPS.map((p) => (
                <SidebarRow
                  key={p.id}
                  label={p.label}
                  count={propCounts.get(p.id) ?? 0}
                  active={filters.itemType === "prop" && filters.componentId === p.id}
                  onClick={() =>
                    setFilters({
                      itemType: "prop",
                      componentId: filters.componentId === p.id ? "all" : p.id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function SidebarRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 hover:bg-accent",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <Badge variant="secondary">{count}</Badge>
    </button>
  );
}
