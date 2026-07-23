import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { isTauri, tauriApi, TauriUnavailableError } from "@/lib/tauri";
import type { ProjectSettings } from "@/types/clothing";

export function NewProjectDialog() {
  const open = useUiStore((s) => s.isNewProjectDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const newProject = useProjectStore((s) => s.newProject);
  const loadProject = useProjectStore((s) => s.loadProject);

  const [name, setName] = useState("my-clothing-pack");
  const [resourceName, setResourceName] = useState("my-clothing-pack");
  const [framework, setFramework] = useState<ProjectSettings["framework"]>("standalone");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dbPath = await save({
        title: "Choose a location for the new project",
        defaultPath: `${name}.fcstudio`,
        filters: [{ name: "FiveM Clothing Studio Project", extensions: ["fcstudio"] }],
      });
      if (!dbPath) return;

      const settings: ProjectSettings = { resourceName, framework, fxServerMinVersion: "6497" };
      const project = await tauriApi.createProject(name, dbPath, settings);
      newProject(project);
      setDialog("newProject", false);
      toast.success(`Project "${name}" created.`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    setBusy(true);
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const dbPath = await openDialog({
        title: "Open a FiveM Clothing Studio project",
        multiple: false,
        filters: [{ name: "FiveM Clothing Studio Project", extensions: ["fcstudio"] }],
      });
      if (!dbPath || Array.isArray(dbPath)) return;

      const result = await tauriApi.openProject(dbPath);
      loadProject(result.project, result.items, result.dlcs);
      setDialog("newProject", false);
      toast.success(`Project "${result.project.name}" loaded (${result.items.length} items).`);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  function reportError(err: unknown) {
    if (err instanceof TauriUnavailableError) {
      toast.error(err.message);
      return;
    }
    console.error(err);
    toast.error(err instanceof Error ? err.message : "Unknown error");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setDialog("newProject", v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project</DialogTitle>
          <DialogDescription>Create a new clothing pack project or open an existing one.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="new">
          <TabsList>
            <TabsTrigger value="new">New Project</TabsTrigger>
            <TabsTrigger value="open">Open Existing</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-3">
            <div className="space-y-1">
              <Label>Project Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Resource Name (fxmanifest)</Label>
              <Input value={resourceName} onChange={(e) => setResourceName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Framework</Label>
              <Select value={framework} onValueChange={(v) => setFramework(v as ProjectSettings["framework"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone</SelectItem>
                  <SelectItem value="esx">ESX</SelectItem>
                  <SelectItem value="qbcore">QBCore</SelectItem>
                  <SelectItem value="qbox">QBox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={busy || !name.trim()}>
                Create Project
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="open" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select an existing <code>.fcstudio</code> project file to continue working on it.
            </p>
            <DialogFooter>
              <Button onClick={handleOpen} disabled={busy}>
                Browse…
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>

        {!isTauri() && (
          <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">
            Running in browser preview mode — file system access requires the Tauri desktop shell
            (<code>npm run tauri dev</code>).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
