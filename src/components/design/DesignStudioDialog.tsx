import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tauriApi } from "@/lib/tauri";
import { canvasToPngBase64 } from "./canvasUtils";
import { RecolorTab } from "./RecolorTab";
import { UploadImageTab } from "./UploadImageTab";
import { PaintTab } from "./PaintTab";
import type { DecodedTextureInfo } from "@/types/clothing";

interface DesignStudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The decoded texture to edit — its `.extractedDds` is what's loaded as the starting image. */
  texture: DecodedTextureInfo;
  /** Absolute path to the real .ytd file this texture lives in (write target). */
  ytdPath: string;
  /** Called after a successful write, so the caller can re-decode/refresh its view. */
  onApplied?: () => void;
}

/**
 * Design Studio (Phase 6): take an existing item's texture as a template and
 * change its look — recolor, replace with an uploaded image, or paint by
 * hand — then write the result back into the real .ytd. The mesh/shape is
 * never touched (see `src/components/mesh/README.md` for why raw geometry
 * editing stays out of scope); this only ever changes pixels.
 */
export function DesignStudioDialog({ open, onOpenChange, texture, ytdPath, onApplied }: DesignStudioDialogProps) {
  const [sourcePngUrl, setSourcePngUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !texture.extractedDds) return;
    let cancelled = false;
    setSourcePngUrl(null);
    setLoadError(null);
    tauriApi
      .decodeTexturePng(texture.extractedDds)
      .then((base64) => {
        if (!cancelled) setSourcePngUrl(`data:image/png;base64,${base64}`);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load the texture");
      });
    return () => {
      cancelled = true;
    };
  }, [open, texture.extractedDds]);

  async function applyCanvas(canvas: HTMLCanvasElement) {
    const base64 = canvasToPngBase64(canvas);
    const result = await tauriApi.applyTextureEdit(ytdPath, texture.name, base64, ytdPath);
    if (!result.ok) {
      throw new Error(result.error ?? "The sidecar refused to write the edited texture.");
    }
    onApplied?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Design Studio — {texture.name}</DialogTitle>
          <DialogDescription>
            Changes are written for real into the .ytd file, verified before saving — same write-back path as
            "Repair". The mesh shape never changes, only this texture's pixels.
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <p className="flex items-center gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {loadError}
          </p>
        )}
        {!loadError && !sourcePngUrl && (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {sourcePngUrl && (
          <Tabs defaultValue="recolor">
            <TabsList>
              <TabsTrigger value="recolor">Recolor</TabsTrigger>
              <TabsTrigger value="upload">Upload Image</TabsTrigger>
              <TabsTrigger value="paint">Paint</TabsTrigger>
            </TabsList>
            <TabsContent value="recolor" className="mt-3">
              <RecolorTab sourcePngUrl={sourcePngUrl} onApply={applyCanvas} />
            </TabsContent>
            <TabsContent value="upload" className="mt-3">
              <UploadImageTab sourcePngUrl={sourcePngUrl} onApply={applyCanvas} />
            </TabsContent>
            <TabsContent value="paint" className="mt-3">
              <PaintTab sourcePngUrl={sourcePngUrl} onApply={applyCanvas} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
