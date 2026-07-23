import { useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MainLayout } from "@/components/layout/MainLayout";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";
import { ImportDialog } from "@/components/project/ImportDialog";
import { ExportDialog } from "@/components/project/ExportDialog";
import { ValidationDialog } from "@/components/dialogs/ValidationDialog";
import { useProjectStore } from "@/stores/projectStore";
import { isTauri, tauriApi, TauriUnavailableError } from "@/lib/tauri";

const AUTOSAVE_INTERVAL_MS = 60_000;

export default function App() {
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const isDirty = useProjectStore((s) => s.isDirty);
  const markSaved = useProjectStore((s) => s.markSaved);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const handleSave = useCallback(async () => {
    if (!project) return;
    try {
      await tauriApi.saveProject(project, items, dlcs);
      markSaved();
      toast.success("Project saved.");
    } catch (err) {
      if (err instanceof TauriUnavailableError) {
        toast.error(err.message);
      } else {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    }
  }, [project, items, dlcs, markSaved]);

  // Toolbar dispatches this event so save logic lives in one place (also reused by autosave/shortcuts).
  useEffect(() => {
    const listener = () => void handleSave();
    window.addEventListener("fcstudio:save", listener);
    return () => window.removeEventListener("fcstudio:save", listener);
  }, [handleSave]);

  // Keyboard shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl+Y redo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void handleSave();
      } else if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, undo, redo]);

  // Autosave: only when there is an open project with unsaved changes, and only inside Tauri
  // (a plain browser preview has nowhere durable to write to).
  useEffect(() => {
    if (!isTauri()) return;
    const interval = setInterval(() => {
      if (project && isDirty) void handleSave();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [project, isDirty, handleSave]);

  // Warn before closing the webview with unsaved changes.
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);

  return (
    <TooltipProvider delayDuration={300}>
      <MainLayout />
      <NewProjectDialog />
      <ImportDialog />
      <ExportDialog />
      <ValidationDialog />
      <Toaster theme="dark" position="bottom-right" richColors />
    </TooltipProvider>
  );
}
