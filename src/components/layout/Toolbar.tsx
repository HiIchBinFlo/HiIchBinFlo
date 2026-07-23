import {
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Redo2,
  Save,
  Settings,
  ShieldCheck,
  Undo2,
  Upload,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const setDialog = useUiStore((s) => s.setDialog);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
      <ToolbarButton label="New Project" onClick={() => setDialog("newProject", true)}>
        <FolderPlus className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Open Project" onClick={() => setDialog("newProject", true)}>
        <FolderOpen className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Save Project"
        disabled={!project || !isDirty}
        onClick={() => {
          window.dispatchEvent(new CustomEvent("fcstudio:save"));
        }}
      >
        <Save className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <ToolbarButton label="Import" disabled={!project} onClick={() => setDialog("import", true)}>
        <Upload className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Export" disabled={!project} onClick={() => setDialog("export", true)}>
        <Download className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Validate Project"
        disabled={!project}
        onClick={() => setDialog("validation", true)}
      >
        <ShieldCheck className="h-4 w-4" />
      </ToolbarButton>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <ToolbarButton label="Undo" disabled={!canUndo} onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!canRedo} onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <div className="flex-1" />

      <div className="flex items-center rounded-md border border-border p-0.5">
        <button
          className={cn(
            "flex h-6 w-7 items-center justify-center rounded-sm text-muted-foreground",
            viewMode === "grid" && "bg-accent text-accent-foreground",
          )}
          onClick={() => setViewMode("grid")}
          aria-label="Grid view"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          className={cn(
            "flex h-6 w-7 items-center justify-center rounded-sm text-muted-foreground",
            viewMode === "list" && "bg-accent text-accent-foreground",
          )}
          onClick={() => setViewMode("list")}
          aria-label="List view"
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <ToolbarButton label="Settings">
        <Settings className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
