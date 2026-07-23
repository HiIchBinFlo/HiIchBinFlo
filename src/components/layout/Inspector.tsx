import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2, FileUp, FileX, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { PED_COMPONENTS, PED_PROPS, type BinaryAssetRef, type ClothingDrawable, type LodLevel } from "@/types/clothing";
import { formatBytes } from "@/lib/utils";
import { tauriApi, TauriUnavailableError } from "@/lib/tauri";
import { DecodedInfoPanel } from "./DecodedInfoPanel";

async function pickAndImportAsset(
  dbPath: string,
  dlcResourceName: string,
  extensions: string[],
): Promise<BinaryAssetRef | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: "Asset File", extensions }],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  return tauriApi.importAssetFile(dbPath, dlcResourceName, path);
}

const LOD_LEVELS: LodLevel[] = ["high", "med", "low", "vlow"];

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const items = useProjectStore((s) => s.state.items);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const updateItem = useProjectStore((s) => s.updateItem);
  const removeItem = useProjectStore((s) => s.removeItem);
  const duplicateItem = useProjectStore((s) => s.duplicateItem);

  const selectedIds = useUiStore((s) => s.selectedIds);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const select = useUiStore((s) => s.select);

  const selected = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );

  if (selected.length === 0) {
    return (
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Select an item to inspect its properties.
        </div>
      </aside>
    );
  }

  if (selected.length > 1) {
    return <BatchInspector items={selected} />;
  }

  const item = selected[0];
  const label = item.itemType === "component" ? "Component" : "Prop";
  const options = item.itemType === "component" ? PED_COMPONENTS : PED_PROPS;
  const dlcResourceName = dlcs.find((d) => d.id === item.dlc)?.resourceName ?? "unassigned";

  async function handleReplaceMesh() {
    if (!project) return;
    try {
      const asset = await pickAndImportAsset(project.dbPath, dlcResourceName, ["ydd"]);
      if (asset) updateItem(item.id, { mesh: asset });
    } catch (err) {
      reportAssetError(err);
    }
  }

  async function handleDuplicateMesh() {
    if (!project || !item.mesh) return;
    try {
      const asset = await tauriApi.duplicateAssetFile(project.dbPath, item.mesh.relativePath);
      updateItem(item.id, { mesh: asset });
      toast.success(`Duplicated as "${asset.fileName}".`);
    } catch (err) {
      reportAssetError(err);
    }
  }

  async function handleReplaceTexture(textureId: number) {
    if (!project) return;
    try {
      const asset = await pickAndImportAsset(project.dbPath, dlcResourceName, ["ytd"]);
      if (asset) {
        updateItem(item.id, {
          textures: item.textures.map((t) => (t.textureId === textureId ? { ...t, file: asset } : t)),
        });
      }
    } catch (err) {
      reportAssetError(err);
    }
  }

  async function handleDuplicateTexture(textureId: number) {
    if (!project) return;
    const tex = item.textures.find((t) => t.textureId === textureId);
    if (!tex?.file) return;
    try {
      const asset = await tauriApi.duplicateAssetFile(project.dbPath, tex.file.relativePath);
      updateItem(item.id, {
        textures: item.textures.map((t) => (t.textureId === textureId ? { ...t, file: asset } : t)),
      });
      toast.success(`Duplicated as "${asset.fileName}".`);
    } catch (err) {
      reportAssetError(err);
    }
  }

  function reportAssetError(err: unknown) {
    if (err instanceof TauriUnavailableError) {
      toast.error(err.message);
    } else {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "File operation failed");
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Inspector</h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Duplicate"
            onClick={() => {
              const newId = duplicateItem(item.id);
              if (newId) select(newId);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Delete"
            onClick={() => {
              removeItem(item.id);
              clearSelection();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="flex items-center justify-between rounded-md bg-secondary px-2 py-1.5">
            <span className="text-xs text-muted-foreground">Drawable ID (locked)</span>
            <Badge variant="outline" className="font-mono">
              #{item.drawableId}
            </Badge>
          </div>

          <Field label="Name">
            <Input value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
          </Field>

          <Field label="Category">
            <Input
              value={item.category}
              onChange={(e) => updateItem(item.id, { category: e.target.value })}
              placeholder="e.g. Jackets"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Gender">
              <Select
                value={item.gender}
                onValueChange={(v) => updateItem(item.id, { gender: v as "male" | "female" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label={label}>
              <Select
                value={String(item.componentId)}
                onValueChange={(v) => updateItem(item.id, { componentId: Number(v) })}
              >
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
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="DLC">
              <Select value={item.dlc} onValueChange={(v) => updateItem(item.id, { dlc: v })}>
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
            </Field>
            <Field label="LOD">
              <Select value={item.lod} onValueChange={(v) => updateItem(item.id, { lod: v as LodLevel })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOD_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Description">
            <Textarea
              rows={3}
              value={item.description}
              onChange={(e) => updateItem(item.id, { description: e.target.value })}
            />
          </Field>

          <Field label="Tags (comma separated)">
            <Input
              value={item.tags.join(", ")}
              onChange={(e) =>
                updateItem(item.id, {
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>

          <Separator />

          <div>
            <Label className="mb-2 block">Mesh File (.ydd)</Label>
            <AssetRow
              fileName={item.mesh?.fileName ?? null}
              size={item.mesh?.sizeBytes}
              present={item.mesh?.present ?? false}
              disabled={!project}
              onClear={() => updateItem(item.id, { mesh: null })}
              onReplace={handleReplaceMesh}
              onDuplicate={item.mesh ? handleDuplicateMesh : undefined}
            />
          </div>

          <div>
            <Label className="mb-2 block">Textures (.ytd)</Label>
            <div className="space-y-1.5">
              {item.textures.length === 0 && (
                <p className="text-xs text-muted-foreground">No textures assigned.</p>
              )}
              {item.textures.map((tex) => (
                <div key={tex.textureId} className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    #{tex.textureId}
                  </Badge>
                  <div className="flex-1">
                    <AssetRow
                      fileName={tex.file?.fileName ?? null}
                      size={tex.file?.sizeBytes}
                      present={tex.file?.present ?? false}
                      disabled={!project}
                      onClear={() =>
                        updateItem(item.id, {
                          textures: item.textures.map((t) =>
                            t.textureId === tex.textureId ? { ...t, file: null } : t,
                          ),
                        })
                      }
                      onReplace={() => handleReplaceTexture(tex.textureId)}
                      onDuplicate={tex.file ? () => handleDuplicateTexture(tex.textureId) : undefined}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {project && <DecodedInfoPanel item={item} dbPath={project.dbPath} />}

          <div>
            <Label className="mb-2 flex items-center gap-1">
              <Hash className="h-3 w-3" /> Hashes
            </Label>
            <div className="space-y-1 rounded-md border border-border p-2 font-mono text-[11px]">
              {Object.entries(item.hashes).length === 0 && (
                <p className="text-muted-foreground">No hashes recorded.</p>
              )}
              {Object.entries(item.hashes).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Metadata</Label>
            <div className="space-y-1 rounded-md border border-border p-2 font-mono text-[11px]">
              {Object.entries(item.metadata).length === 0 && (
                <p className="text-muted-foreground">No extra metadata.</p>
              )}
              {Object.entries(item.metadata).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AssetRow({
  fileName,
  size,
  present,
  disabled,
  onClear,
  onReplace,
  onDuplicate,
}: {
  fileName: string | null;
  size?: number;
  present: boolean;
  disabled?: boolean;
  onClear: () => void;
  onReplace?: () => void;
  onDuplicate?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-dashed border-border px-2 py-1.5 text-xs">
      {fileName ? (
        <div className="min-w-0 flex-1">
          <p className={present ? "truncate" : "truncate text-destructive"}>{fileName}</p>
          {typeof size === "number" && <p className="text-[10px] text-muted-foreground">{formatBytes(size)}</p>}
        </div>
      ) : (
        <p className="text-muted-foreground">No file assigned</p>
      )}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          title={fileName ? "Replace" : "Add file"}
          className="h-6 w-6"
          disabled={disabled}
          onClick={onReplace}
        >
          <FileUp className="h-3 w-3" />
        </Button>
        {fileName && onDuplicate && (
          <Button
            variant="ghost"
            size="icon"
            title="Duplicate file"
            className="h-6 w-6"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <Copy className="h-3 w-3" />
          </Button>
        )}
        {fileName && (
          <Button variant="ghost" size="icon" title="Remove" className="h-6 w-6" onClick={onClear}>
            <FileX className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function BatchInspector({ items }: { items: ClothingDrawable[] }) {
  const updateItem = useProjectStore((s) => s.updateItem);
  const removeItem = useProjectStore((s) => s.removeItem);
  const duplicateItem = useProjectStore((s) => s.duplicateItem);
  const dlcs = useProjectStore((s) => s.state.dlcs);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const [tagsInput, setTagsInput] = useState("");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Batch Edit</h2>
        <p className="text-xs text-muted-foreground">{items.length} items selected</p>
      </div>
      <div className="space-y-4 p-3">
        <Field label="Set Category">
          <Input
            placeholder="Category for all selected"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const value = (e.target as HTMLInputElement).value;
                items.forEach((i) => updateItem(i.id, { category: value }));
              }
            }}
          />
        </Field>

        <Field label="Set Gender">
          <Select onValueChange={(v) => items.forEach((i) => updateItem(i.id, { gender: v as "male" | "female" }))}>
            <SelectTrigger>
              <SelectValue placeholder="Choose gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Set DLC">
          <Select onValueChange={(v) => items.forEach((i) => updateItem(i.id, { dlc: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="Choose DLC" />
            </SelectTrigger>
            <SelectContent>
              {dlcs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Add Tag">
          <div className="flex gap-2">
            <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="e.g. summer" />
            <Button
              size="sm"
              onClick={() => {
                if (!tagsInput.trim()) return;
                items.forEach((i) =>
                  updateItem(i.id, { tags: Array.from(new Set([...i.tags, tagsInput.trim()])) }),
                );
                setTagsInput("");
              }}
            >
              Add
            </Button>
          </div>
        </Field>

        <Separator />

        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              items.forEach((i) => duplicateItem(i.id));
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate All
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              items.forEach((i) => removeItem(i.id));
              clearSelection();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete All
          </Button>
        </div>
      </div>
    </aside>
  );
}
