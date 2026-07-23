import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { validateProject } from "@/lib/validation";
import { isTauri, tauriApi, TauriUnavailableError } from "@/lib/tauri";
import type { ValidationIssue } from "@/types/clothing";

export function ValidationDialog() {
  const open = useUiStore((s) => s.isValidationDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const project = useProjectStore((s) => s.project);
  const select = useUiStore((s) => s.select);

  const [deepIssues, setDeepIssues] = useState<ValidationIssue[] | null>(null);
  const [deepChecked, setDeepChecked] = useState<{ meshes: number; textures: number } | null>(null);
  const [running, setRunning] = useState(false);

  const issues = [...validateProject(items, dlcs), ...(deepIssues ?? [])];

  async function runDeepValidate() {
    if (!project) return;
    setRunning(true);
    try {
      const report = await tauriApi.deepValidateProject(project.dbPath, items);
      setDeepIssues(report.issues);
      setDeepChecked({ meshes: report.meshesChecked, textures: report.texturesChecked });
      if (report.issues.length === 0) {
        toast.success(`Deep validate: ${report.meshesChecked} meshes and ${report.texturesChecked} textures decoded cleanly.`);
      } else {
        toast.error(`Deep validate found ${report.issues.length} file(s) that failed to decode.`);
      }
    } catch (err) {
      const message = err instanceof TauriUnavailableError ? err.message : `Deep validate failed: ${err}`;
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setDialog("validation", v);
        if (!v) {
          setDeepIssues(null);
          setDeepChecked(null);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Validation</DialogTitle>
          <DialogDescription>
            Checked for missing files, broken references, duplicate ids, and invalid metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs text-muted-foreground">
          <span>
            {deepChecked
              ? `Deep validate: ${deepChecked.meshes} mesh(es) and ${deepChecked.textures} texture(s) actually decoded.`
              : "Optional: actually decode every mesh/texture in the project to catch corrupt files (not just missing ones)."}
          </span>
          <Button variant="outline" size="sm" onClick={runDeepValidate} disabled={running || !isTauri()}>
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1.5 h-3.5 w-3.5" />}
            Deep Validate
          </Button>
        </div>

        {issues.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> No issues found. This project is ready to export.
          </p>
        ) : (
          <ScrollArea className="h-80">
            <div className="space-y-1.5 pr-3">
              {issues.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => {
                    if (issue.itemId) {
                      select(issue.itemId);
                      setDialog("validation", false);
                    }
                  }}
                  className="flex w-full items-start gap-2 rounded-md border border-border p-2 text-left text-xs hover:bg-accent"
                >
                  {issue.severity === "error" ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  )}
                  <span className="flex-1">{issue.message}</span>
                  <Badge variant="outline" className="shrink-0 font-mono">
                    {issue.code}
                  </Badge>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
