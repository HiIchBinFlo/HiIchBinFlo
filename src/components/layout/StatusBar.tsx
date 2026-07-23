import { AlertTriangle, CheckCircle2, Save } from "lucide-react";
import { useMemo } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { validateProject } from "@/lib/validation";
import { formatDate } from "@/lib/utils";

export function StatusBar() {
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const isDirty = useProjectStore((s) => s.isDirty);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);

  const issues = useMemo(() => validateProject(items, dlcs), [items, dlcs]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span>{project ? project.name : "No project open"}</span>
      <span>{items.length.toLocaleString()} items</span>
      <span>{dlcs.length} DLCs</span>
      <div className="flex-1" />
      {errorCount === 0 && warningCount === 0 ? (
        <span className="flex items-center gap-1 text-success">
          <CheckCircle2 className="h-3 w-3" /> No issues
        </span>
      ) : (
        <span className="flex items-center gap-1 text-warning">
          <AlertTriangle className="h-3 w-3" />
          {errorCount} errors, {warningCount} warnings
        </span>
      )}
      {project && (
        <span className="flex items-center gap-1">
          <Save className="h-3 w-3" />
          {isDirty ? "Unsaved changes" : lastSavedAt ? `Saved ${formatDate(lastSavedAt)}` : "Not saved yet"}
        </span>
      )}
    </div>
  );
}
