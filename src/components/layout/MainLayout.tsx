import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { Inspector } from "./Inspector";
import { StatusBar } from "./StatusBar";
import { ClothingGrid } from "@/components/clothing/ClothingGrid";
import { ClothingList } from "@/components/clothing/ClothingList";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { useFilteredItems } from "@/hooks/useFilteredItems";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MainLayout() {
  const project = useProjectStore((s) => s.project);
  const viewMode = useUiStore((s) => s.viewMode);
  const setDialog = useUiStore((s) => s.setDialog);
  const items = useFilteredItems();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {!project ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">No project is open.</p>
              <Button onClick={() => setDialog("newProject", true)}>
                <FolderPlus className="h-4 w-4" /> New / Open Project
              </Button>
            </div>
          ) : viewMode === "grid" ? (
            <ClothingGrid items={items} />
          ) : (
            <ClothingList items={items} />
          )}
        </main>
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}
