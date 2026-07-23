import { AlertTriangle, CheckCircle2, Save, Cpu, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { validateProject } from "@/lib/validation";
import { formatDate } from "@/lib/utils";
import { isTauri, tauriApi } from "@/lib/tauri";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SidecarStatus = { state: "checking" } | { state: "ok"; version: string } | { state: "unavailable"; message: string };

function useSidecarStatus(): SidecarStatus {
  const [status, setStatus] = useState<SidecarStatus>({ state: "checking" });

  useEffect(() => {
    if (!isTauri()) {
      setStatus({ state: "unavailable", message: "Not running in the Tauri desktop shell." });
      return;
    }
    let cancelled = false;
    tauriApi
      .sidecarProbe()
      .then((res) => {
        if (!cancelled) setStatus({ state: "ok", version: res.codeWalkerCoreVersion });
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus({
            state: "unavailable",
            message: err instanceof Error ? err.message : "codewalker-bridge sidecar unavailable",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

export function StatusBar() {
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const isDirty = useProjectStore((s) => s.isDirty);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const sidecarStatus = useSidecarStatus();

  const issues = useMemo(() => validateProject(items, dlcs), [items, dlcs]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span>{project ? project.name : "No project open"}</span>
      <span>{items.length.toLocaleString()} items</span>
      <span>{dlcs.length} DLCs</span>

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex cursor-default items-center gap-1">
            {sidecarStatus.state === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
            {sidecarStatus.state === "ok" && <Cpu className="h-3 w-3 text-success" />}
            {sidecarStatus.state === "unavailable" && <Cpu className="h-3 w-3 text-warning" />}
            Decoder{" "}
            {sidecarStatus.state === "ok"
              ? "ready"
              : sidecarStatus.state === "checking"
                ? "checking…"
                : "unavailable"}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {sidecarStatus.state === "ok" && `codewalker-bridge ready (CodeWalker.Core ${sidecarStatus.version})`}
          {sidecarStatus.state === "checking" && "Checking the codewalker-bridge sidecar…"}
          {sidecarStatus.state === "unavailable" &&
            `Real .ydd/.ytd decoding unavailable: ${sidecarStatus.message}`}
        </TooltipContent>
      </Tooltip>

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
