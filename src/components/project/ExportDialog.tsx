import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileArchive, FolderOutput, Layers, Files } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { validateProject, hasBlockingErrors } from "@/lib/validation";
import { isTauri, tauriApi, TauriUnavailableError, type ExportFormat } from "@/lib/tauri";

const FORMATS: Array<{ id: ExportFormat; label: string; icon: typeof FolderOutput; description: string }> = [
  {
    id: "resource",
    label: "FiveM Resource",
    icon: FolderOutput,
    description: "Ready-to-drop resource folder for your server's resources directory.",
  },
  { id: "zip", label: "ZIP Archive", icon: FileArchive, description: "Same output, packaged as a single .zip." },
  { id: "dlc", label: "DLC Pack", icon: Layers, description: "Standalone DLC (dlc.rpf-style folder layout)." },
  { id: "files", label: "Individual Files", icon: Files, description: "Flat export of every raw asset file." },
];

export function ExportDialog() {
  const open = useUiStore((s) => s.isExportDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);

  const [format, setFormat] = useState<ExportFormat>("resource");
  const [busy, setBusy] = useState(false);

  const issues = validateProject(items, dlcs);
  const blocked = hasBlockingErrors(issues);

  async function handleExport() {
    if (!project) return;
    setBusy(true);
    try {
      const { open: openDialog, save } = await import("@tauri-apps/plugin-dialog");
      const outputPath =
        format === "zip"
          ? await save({ defaultPath: `${project.settings.resourceName}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] })
          : await openDialog({ directory: true, multiple: false });

      const path = Array.isArray(outputPath) ? outputPath[0] : outputPath;
      if (!path) return;

      const result = await tauriApi.exportProject(project, items, dlcs, format, path);
      toast.success(`Exported ${result.filesWritten} files to ${result.outputPath}.`);
      setDialog("export", false);
    } catch (err) {
      if (err instanceof TauriUnavailableError) {
        toast.error(err.message);
      } else {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Export failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setDialog("export", v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            The export preserves every drawable and texture id exactly as assigned in the project — no
            renumbering, no manual post-processing needed on the server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{FORMATS.find((f) => f.id === format)?.description}</p>
        </div>

        {blocked && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {issues.filter((i) => i.severity === "error").length} blocking validation error(s) found. Fix
            them (see Validate Project) before exporting.
          </p>
        )}

        {!isTauri() && (
          <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">
            Running in browser preview mode — exporting requires the Tauri desktop shell.
          </p>
        )}

        <DialogFooter>
          <Button onClick={handleExport} disabled={busy || blocked || !project}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
