import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { tauriApi, TauriUnavailableError } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import type { DecodedTextureInfo } from "@/types/clothing";

interface TextureViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  texture: DecodedTextureInfo;
}

/**
 * Real decoded texture display (Phase 3): the actual pixel content, decoded
 * from the .dds the sidecar already extracted, via pure-Rust BC1-7 decoding
 * (src-tauri/src/texture_decode.rs) — not a placeholder icon.
 */
export function TextureViewer({ open, onOpenChange, texture }: TextureViewerProps) {
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !texture.extractedDds) return;
    let cancelled = false;
    setPngDataUrl(null);
    setError(null);
    tauriApi
      .decodeTexturePng(texture.extractedDds)
      .then((base64) => {
        if (!cancelled) setPngDataUrl(`data:image/png;base64,${base64}`);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to decode texture");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, texture.extractedDds]);

  async function handleExport(kind: "png" | "dds") {
    if (!texture.extractedDds) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `${texture.name}.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!path) return;
      if (kind === "png") {
        await tauriApi.exportTexturePng(texture.extractedDds, path);
      } else {
        await tauriApi.copyFile(texture.extractedDds, path);
      }
      toast.success(`Exported ${path}`);
    } catch (err) {
      const message = err instanceof TauriUnavailableError ? err.message : err instanceof Error ? err.message : "Export failed";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{texture.name}</DialogTitle>
        </DialogHeader>

        <div
          className="flex h-64 items-center justify-center rounded-md border border-border p-2"
          style={{
            backgroundImage:
              "repeating-conic-gradient(#2a2d35 0% 25%, #33363f 0% 50%)",
            backgroundSize: "16px 16px",
          }}
        >
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          {!error && !pngDataUrl && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {pngDataUrl && (
            <img
              src={pngDataUrl}
              alt={texture.name}
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: texture.width <= 64 ? "pixelated" : "auto" }}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <Row label="Dimensions" value={`${texture.width} × ${texture.height}`} />
          <Row label="Format" value={texture.format.replace("D3DFMT_", "")} />
          <Row label="Mip levels" value={String(texture.levels)} />
          <Row label="Data size" value={formatBytes(texture.dataBytes)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleExport("dds")} disabled={!texture.extractedDds}>
            <Download className="h-3.5 w-3.5" /> Export .dds
          </Button>
          <Button onClick={() => handleExport("png")} disabled={!texture.extractedDds}>
            <Download className="h-3.5 w-3.5" /> Export .png
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
