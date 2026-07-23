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
  // The most recent successfully-decoded geometry, kept around independent of
  // `geometry`'s current status. Switching LOD (or reloading for any reason)
  // used to fully unmount <MeshPreview> while status was briefly "loading",
  // tearing down and recreating the WebGL canvas every time - and
  // react-three-fiber only releases a canvas's WebGL context 500ms after
  // unmount (see its unmountComponentAtNode), so switching LODs a few times
  // in a row could pile up more live contexts than the browser/webview
  // allows, silently failing to create a new one (a blank preview) or
  // rendering a context mid-loss (a garbled frame) - exactly what got
  // reported. Keeping one <MeshPreview> mounted and just swapping its
  // `parts` prop avoids the churn entirely.
  const [lastReadyParts, setLastReadyParts] = useState<MeshPart[] | null>(null);
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
    setLastReadyParts(null);

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
          setLastReadyParts(result.parts);
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

        <div className="relative h-[420px] overflow-hidden rounded-md border border-border bg-secondary/30">
          {/* Kept mounted across LOD switches / reloads once we have a first
              successful decode - see the lastReadyParts comment above for why. */}
          {lastReadyParts && (
            <MeshPreview parts={lastReadyParts} textureDataUrl={textureDataUrl} showBoneWeights={showBoneWeights} />
          )}
          {geometry.status === "loading" && (
            <div
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground",
                lastReadyParts && "bg-background/70 backdrop-blur-sm",
              )}
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              Decoding mesh and texture…
            </div>
          )}
          {geometry.status === "error" && !lastReadyParts && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {geometry.message}
            </div>
          )}
          {geometry.status === "error" && lastReadyParts && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-destructive/90 p-2 text-xs text-destructive-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {geometry.message}
            </div>
          )}
        </div>

        {lastReadyParts && (
          <div className="flex flex-wrap gap-1.5">
            {lastReadyParts.map((p, i) => (
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
