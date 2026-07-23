import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, CheckCircle2, FileArchive, FileStack, Files, FolderInput } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { isTauri, tauriApi, TauriUnavailableError, type ImportResult } from "@/lib/tauri";
import type { ImportSourceType } from "@/types/clothing";

const SOURCES: Array<{ id: ImportSourceType; label: string; icon: typeof FolderInput }> = [
  { id: "resource", label: "FiveM Resource Folder", icon: FolderInput },
  { id: "zip", label: "ZIP Archive", icon: FileArchive },
  { id: "folder", label: "Plain Folder", icon: Files },
  { id: "files", label: "Individual Files", icon: FileStack },
];

// Large packs can produce thousands of per-file warnings (e.g. every file
// skipped for an unrecognized naming convention); render a bounded number
// rather than thousands of DOM nodes in a non-virtualized list.
const WARNINGS_SHOWN_LIMIT = 200;

export function ImportDialog() {
  const open = useUiStore((s) => s.isImportDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const project = useProjectStore((s) => s.project);
  const importItem = useProjectStore((s) => s.importItem);
  const addDlc = useProjectStore((s) => s.addDlc);
  const existingDlcs = useProjectStore((s) => s.state.dlcs);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function runImport(sourceType: ImportSourceType) {
    setBusy(true);
    setResult(null);
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      let sourcePath: string | null = null;

      if (sourceType === "resource" || sourceType === "folder") {
        const picked = await openDialog({ directory: true, multiple: false });
        sourcePath = Array.isArray(picked) ? picked[0] : picked;
      } else if (sourceType === "zip") {
        const picked = await openDialog({
          multiple: false,
          filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
        });
        sourcePath = Array.isArray(picked) ? picked[0] : picked;
      } else {
        const picked = await openDialog({
          multiple: true,
          filters: [{ name: "Clothing Files", extensions: ["ydd", "ytd", "ymt", "meta", "xml"] }],
        });
        sourcePath = Array.isArray(picked) ? picked.join("|") : picked;
      }

      if (!sourcePath || !project) return;

      const importResult = await tauriApi.importSource(sourceType, sourcePath, project.dbPath);
      setResult(importResult);

      const dlcIdMap = new Map<string, string>();
      for (const dlc of importResult.dlcs) {
        const existing = existingDlcs.find((d) => d.resourceName === dlc.resourceName);
        if (existing) {
          dlcIdMap.set(dlc.id, existing.id);
        } else {
          const newId = addDlc({ name: dlc.name, resourceName: dlc.resourceName, targetGender: dlc.targetGender });
          dlcIdMap.set(dlc.id, newId);
        }
      }
      for (const item of importResult.items) {
        importItem({ ...item, dlc: dlcIdMap.get(item.dlc) ?? item.dlc });
      }

      toast.success(
        `Imported ${importResult.report.drawablesFound} drawables and ${importResult.report.texturesFound} textures.`,
      );
    } catch (err) {
      if (err instanceof TauriUnavailableError) {
        toast.error(err.message);
      } else {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Import failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setDialog("import", v)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Import an existing FiveM resource, ZIP archive, folder, or individual files. Existing drawable
            and texture ids from the source are preserved exactly.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid grid-cols-2 gap-3">
            {SOURCES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                disabled={busy || !project}
                onClick={() => runImport(id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-sm hover:border-primary/50 hover:bg-accent disabled:opacity-50",
                )}
              >
                <Icon className="h-6 w-6 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Files scanned" value={result.report.scannedFiles} />
              <Stat label="Drawables found" value={result.report.drawablesFound} />
              <Stat label="Components" value={result.report.componentsFound} />
              <Stat label="Props" value={result.report.propsFound} />
              <Stat label="DLCs detected" value={result.report.dlcsDetected.length} />
              <Stat label="Textures found" value={result.report.texturesFound} />
            </div>

            {result.report.drawablesFound === 0 && result.report.warnings.length > 0 && (
              <p className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                No drawables were found — every scanned file was skipped, see the warnings below for why (usually a
                filename that doesn't match a recognized naming convention).
              </p>
            )}

            {result.report.errors.length === 0 && result.report.missingFiles.length === 0 ? (
              <p className="flex items-center gap-1 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> No errors detected.
              </p>
            ) : (
              <ScrollArea className="h-40 rounded-md border border-border p-2">
                {result.report.missingFiles.map((f) => (
                  <p key={f} className="flex items-center gap-1 text-xs text-warning">
                    <AlertCircle className="h-3 w-3 shrink-0" /> Missing file: {f}
                  </p>
                ))}
                {result.report.errors.map((e, i) => (
                  <p key={i} className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {e.file}: {e.message}
                  </p>
                ))}
              </ScrollArea>
            )}

            {result.report.warnings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-warning">{result.report.warnings.length} warning(s)</p>
                <ScrollArea className="h-40 rounded-md border border-border p-2">
                  {result.report.warnings.slice(0, WARNINGS_SHOWN_LIMIT).map((w, i) => (
                    <p key={i} className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {w.file}: {w.message}
                    </p>
                  ))}
                  {result.report.warnings.length > WARNINGS_SHOWN_LIMIT && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      …and {result.report.warnings.length - WARNINGS_SHOWN_LIMIT} more.
                    </p>
                  )}
                </ScrollArea>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Import More
              </Button>
              <Button onClick={() => setDialog("import", false)}>Done</Button>
            </DialogFooter>
          </div>
        )}

        {!isTauri() && (
          <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">
            Running in browser preview mode — importing requires the Tauri desktop shell.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary px-2 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="outline">{value}</Badge>
    </div>
  );
}
