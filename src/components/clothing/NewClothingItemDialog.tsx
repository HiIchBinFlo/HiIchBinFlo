import { useState } from "react";
import { toast } from "sonner";
import { FileUp, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { isTauri, tauriApi, TauriUnavailableError, previewCacheDir } from "@/lib/tauri";
import { PED_COMPONENTS, PED_PROPS, type BinaryAssetRef, type Gender, type ItemType } from "@/types/clothing";

/**
 * The Custom Clothing Creator, per the project brief: import .ydd/.ytd,
 * automatic slot registration (via the project's slot system — no manual id
 * bookkeeping), thumbnail generation, integrated into a chosen DLC. There is
 * deliberately no "manual editing required" step beyond picking files and
 * basic metadata.
 */
export function NewClothingItemDialog() {
  const open = useUiStore((s) => s.isNewItemDialogOpen);
  const setDialog = useUiStore((s) => s.setDialog);
  const project = useProjectStore((s) => s.project);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const addItem = useProjectStore((s) => s.addItem);
  const select = useUiStore((s) => s.select);

  const [name, setName] = useState("New Item");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [itemType, setItemType] = useState<ItemType>("component");
  const [componentId, setComponentId] = useState(3);
  const [dlcId, setDlcId] = useState<string>(dlcs[0]?.id ?? "");
  const [tagsInput, setTagsInput] = useState("");
  const [mesh, setMesh] = useState<BinaryAssetRef | null>(null);
  const [textures, setTextures] = useState<BinaryAssetRef[]>([]);
  const [busy, setBusy] = useState(false);

  const options = itemType === "component" ? PED_COMPONENTS : PED_PROPS;
  const selectedDlc = dlcs.find((d) => d.id === dlcId);

  function reset() {
    setName("New Item");
    setCategory("");
    setDescription("");
    setGender("male");
    setItemType("component");
    setComponentId(3);
    setTagsInput("");
    setMesh(null);
    setTextures([]);
  }

  function reportError(err: unknown) {
    const message = err instanceof TauriUnavailableError ? err.message : err instanceof Error ? err.message : "Failed";
    toast.error(message);
  }

  async function handlePickMesh() {
    if (!project || !selectedDlc) return;
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({ multiple: false, filters: [{ name: "Drawable", extensions: ["ydd"] }] });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const asset = await tauriApi.importAssetFile(project.dbPath, selectedDlc.resourceName, path);
      setMesh(asset);
    } catch (err) {
      reportError(err);
    }
  }

  async function handlePickTexture() {
    if (!project || !selectedDlc) return;
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({ multiple: true, filters: [{ name: "Texture Dictionary", extensions: ["ytd"] }] });
      const paths = picked == null ? [] : Array.isArray(picked) ? picked : [picked];
      const newAssets: BinaryAssetRef[] = [];
      for (const path of paths) {
        const asset = await tauriApi.importAssetFile(project.dbPath, selectedDlc.resourceName, path);
        newAssets.push(asset);
      }
      setTextures((prev) => [...prev, ...newAssets]);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleCreate() {
    if (!project || !selectedDlc) {
      toast.error("Choose a DLC first.");
      return;
    }
    if (!mesh) {
      toast.error("A .ydd mesh file is required.");
      return;
    }
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }

    setBusy(true);
    try {
      const newId = addItem({
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        gender,
        itemType,
        componentId,
        dlc: selectedDlc.id,
        lod: "high",
        mesh,
        thumbnail: undefined,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        textures: textures.map((file, i) => ({ textureId: i, name: `Variant ${i}`, file })),
      });

      // Opportunistic thumbnail, same pipeline as DecodedInfoPanel — best
      // effort, never blocks item creation if the sidecar can't decode it.
      if (textures[0]) {
        try {
          const inspectResult = await tauriApi.inspectYtd(
            `${project.dbPath}.assets/${textures[0].relativePath}`,
            previewCacheDir(project.dbPath),
          );
          const ddsPath = inspectResult.textures?.[0]?.extractedDds;
          if (ddsPath) {
            const base64 = await tauriApi.decodeTextureThumbnail(ddsPath);
            useProjectStore.getState().updateItem(newId, { thumbnail: `data:image/png;base64,${base64}` });
          }
        } catch {
          // non-fatal
        }
      }

      toast.success(`"${name}" created.`);
      select(newId);
      reset();
      setDialog("newItem", false);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setDialog("newItem", v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Clothing Item</DialogTitle>
          <DialogDescription>
            Import a mesh and textures — the drawable id is assigned automatically by the project's
            slot system, and the item is registered into the chosen DLC. No manual file editing needed.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Jackets" />
            </div>
            <div className="space-y-1">
              <Label>DLC</Label>
              <Select value={dlcId} onValueChange={setDlcId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select DLC" />
                </SelectTrigger>
                <SelectContent>
                  {dlcs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dlcs.length === 0 && <p className="text-[11px] text-warning">No DLC exists yet — create one first.</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Gender</Label>
              <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={itemType}
                onValueChange={(v) => {
                  setItemType(v as ItemType);
                  setComponentId(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="component">Component</SelectItem>
                  <SelectItem value="prop">Prop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>{itemType === "component" ? "Component" : "Prop"}</Label>
            <Select value={String(componentId)} onValueChange={(v) => setComponentId(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Tags (comma separated)</Label>
            <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. summer, dlc1" />
          </div>

          <div className="space-y-1">
            <Label>Mesh (.ydd)</Label>
            {mesh ? (
              <div className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
                <span className="truncate">{mesh.fileName}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMesh(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={handlePickMesh} disabled={!selectedDlc}>
                <FileUp className="h-3.5 w-3.5" /> Choose .ydd file
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <Label>Textures (.ytd)</Label>
            <div className="space-y-1">
              {textures.map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
                  <span className="flex items-center gap-2 truncate">
                    <Badge variant="outline" className="font-mono">
                      #{i}
                    </Badge>
                    {t.fileName}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setTextures((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={handlePickTexture} disabled={!selectedDlc}>
              <FileUp className="h-3.5 w-3.5" /> Add .ytd file(s)
            </Button>
          </div>
        </div>

        {!isTauri() && (
          <p className="rounded-md bg-warning/10 p-2 text-xs text-warning">
            Running in browser preview mode — file import requires the Tauri desktop shell.
          </p>
        )}

        <DialogFooter>
          <Button onClick={handleCreate} disabled={busy || !mesh || !selectedDlc}>
            Create Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
