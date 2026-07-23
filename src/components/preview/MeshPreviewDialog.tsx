import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MeshPreview } from "./MeshPreview";
import { assetAbsolutePath, previewCacheDir, tauriApi, TauriUnavailableError } from "@/lib/tauri";
import type { ClothingDrawable, MeshPart } from "@/types/clothing";

interface MeshPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ClothingDrawable;
  dbPath: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; parts: MeshPart[]; textureDataUrl: string | null };

export function MeshPreviewDialog({ open, onOpenChange, item, dbPath }: MeshPreviewDialogProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });

    async function load() {
      try {
        if (!item.mesh) {
          throw new Error("This item has no mesh file assigned.");
        }
        const meshPath = assetAbsolutePath(dbPath, item.mesh.relativePath);
        const geometryResult = await tauriApi.exportGeometry(meshPath);
        if (!geometryResult.ok || !geometryResult.parts || geometryResult.parts.length === 0) {
          throw new Error(geometryResult.error ?? "No geometry could be decoded from this mesh.");
        }

        let textureDataUrl: string | null = null;
        const firstTexture = item.textures.find((t) => t.file)?.file;
        if (firstTexture) {
          const texPath = assetAbsolutePath(dbPath, firstTexture.relativePath);
          const extractDir = previewCacheDir(dbPath);
          const inspectResult = await tauriApi.inspectYtd(texPath, extractDir);
          const ddsPath = inspectResult.textures?.[0]?.extractedDds;
          if (ddsPath) {
            const base64 = await tauriApi.decodeTexturePng(ddsPath);
            textureDataUrl = `data:image/png;base64,${base64}`;
          }
        }

        if (!cancelled) {
          setState({ status: "ready", parts: geometryResult.parts, textureDataUrl });
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof TauriUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to load preview";
          setState({ status: "error", message });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, item, dbPath]);

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

        <div className="h-[420px] overflow-hidden rounded-md border border-border bg-secondary/30">
          {state.status === "loading" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Decoding mesh and texture…
            </div>
          )}
          {state.status === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {state.message}
            </div>
          )}
          {state.status === "ready" && <MeshPreview parts={state.parts} textureDataUrl={state.textureDataUrl} />}
        </div>

        {state.status === "ready" && (
          <div className="flex flex-wrap gap-1.5">
            {state.parts.map((p, i) => (
              <Badge key={i} variant="outline">
                {p.shaderName} · {p.vertexCount}v / {p.indexCount / 3}t
              </Badge>
            ))}
            {!state.textureDataUrl && <Badge variant="warning">No texture applied</Badge>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
