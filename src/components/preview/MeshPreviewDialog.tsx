import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Bone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MeshPreview } from "./MeshPreview";
import { assetAbsolutePath, previewCacheDir, tauriApi, TauriUnavailableError } from "@/lib/tauri";
import type { ClothingDrawable, DecodedLodInfo, MeshPart } from "@/types/clothing";
import { cn } from "@/lib/utils";

interface MeshPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ClothingDrawable;
  dbPath: string;
}

type GeometryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; parts: MeshPart[] };

export function MeshPreviewDialog({ open, onOpenChange, item, dbPath }: MeshPreviewDialogProps) {
  const [geometry, setGeometry] = useState<GeometryState>({ status: "loading" });
  const [textureDataUrl, setTextureDataUrl] = useState<string | null>(null);
  const [availableLods, setAvailableLods] = useState<DecodedLodInfo[]>([]);
  const [selectedLod, setSelectedLod] = useState<string | null>(null);
  const [boneCount, setBoneCount] = useState(0);
  const [showBoneWeights, setShowBoneWeights] = useState(false);

  // Texture + available-LOD list: fetched once per open, independent of which LOD is selected.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTextureDataUrl(null);
    setAvailableLods([]);
    setSelectedLod(null);
    setBoneCount(0);
    setShowBoneWeights(false);

    async function loadSideData() {
      if (item.mesh) {
        const meshPath = assetAbsolutePath(dbPath, item.mesh.relativePath);
        const ydd = await tauriApi.inspectYdd(meshPath).catch(() => null);
        const lods = ydd?.drawables?.[0]?.lods.filter((l) => l.present) ?? [];
        if (!cancelled) {
          setAvailableLods(lods);
          setBoneCount(ydd?.drawables?.[0]?.boneCount ?? 0);
        }
      }

      const firstTexture = item.textures.find((t) => t.file)?.file;
      if (firstTexture) {
        const texPath = assetAbsolutePath(dbPath, firstTexture.relativePath);
        const inspectResult = await tauriApi.inspectYtd(texPath, previewCacheDir(dbPath)).catch(() => null);
        const ddsPath = inspectResult?.textures?.[0]?.extractedDds;
        if (ddsPath && !cancelled) {
          const base64 = await tauriApi.decodeTexturePng(ddsPath);
          if (!cancelled) setTextureDataUrl(`data:image/png;base64,${base64}`);
        }
      }
    }

    void loadSideData();
    return () => {
      cancelled = true;
    };
  }, [open, item, dbPath]);

  // Geometry: re-fetched whenever the selected LOD changes (undefined = let the sidecar pick the best one).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGeometry({ status: "loading" });

    async function loadGeometry() {
      try {
        if (!item.mesh) throw new Error("This item has no mesh file assigned.");
        const meshPath = assetAbsolutePath(dbPath, item.mesh.relativePath);
        const result = await tauriApi.exportGeometry(meshPath, undefined, selectedLod ?? undefined);
        if (!result.ok || !result.parts || result.parts.length === 0) {
          throw new Error(result.error ?? "No geometry could be decoded from this mesh.");
        }
        if (!cancelled) {
          setGeometry({ status: "ready", parts: result.parts });
          if (result.lodUsed && !selectedLod) setSelectedLod(result.lodUsed);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof TauriUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to load preview";
          setGeometry({ status: "error", message });
        }
      }
    }

    void loadGeometry();
    return () => {
      cancelled = true;
    };
  }, [open, item, dbPath, selectedLod]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>3D Preview — {item.name}</DialogTitle>
          <DialogDescription>
            Isolated mesh view (real decoded geometry + texture). No base character is attached — see
            docs/ROADMAP.md.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          {availableLods.length > 1 ? (
            <Tabs value={selectedLod ?? availableLods[0].level} onValueChange={setSelectedLod}>
              <TabsList>
                {availableLods.map((l) => (
                  <TabsTrigger key={l.level} value={l.level}>
                    {l.level.toUpperCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <div />
          )}
          {boneCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className={cn(showBoneWeights && "border-primary text-primary")}
              onClick={() => setShowBoneWeights((v) => !v)}
              title={`${boneCount} bones`}
            >
              <Bone className="h-3.5 w-3.5" /> Bone Assignments
            </Button>
          )}
        </div>

        <div className="h-[420px] overflow-hidden rounded-md border border-border bg-secondary/30">
          {geometry.status === "loading" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Decoding mesh and texture…
            </div>
          )}
          {geometry.status === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {geometry.message}
            </div>
          )}
          {geometry.status === "ready" && (
            <MeshPreview parts={geometry.parts} textureDataUrl={textureDataUrl} showBoneWeights={showBoneWeights} />
          )}
        </div>

        {geometry.status === "ready" && (
          <div className="flex flex-wrap gap-1.5">
            {geometry.parts.map((p, i) => (
              <Badge key={i} variant="outline">
                {p.shaderName} · {p.vertexCount}v / {p.indexCount / 3}t
              </Badge>
            ))}
            {!textureDataUrl && <Badge variant="warning">No texture applied</Badge>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
