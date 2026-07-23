import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canvasPointerPosition, loadImage } from "./canvasUtils";

interface UploadImageTabProps {
  sourcePngUrl: string;
  onApply: (canvas: HTMLCanvasElement) => Promise<void>;
}

interface Layer {
  id: string;
  img: HTMLImageElement;
  /** Center position and size, all in canvas pixel units (the texture's native resolution). */
  x: number;
  y: number;
  width: number;
  height: number;
}

type Corner = "tl" | "tr" | "bl" | "br";
const HANDLE_SCREEN_PX = 9;
const MIN_LAYER_SIZE = 12;

/**
 * Upload one or more images and freely drag/resize them onto the texture,
 * like placing stickers — not just an automatic fit. Everything visible on
 * the canvas when "Apply" is pressed (background texture + every placed
 * image, wherever the user left it) is exactly what gets written back.
 */
export function UploadImageTab({ sourcePngUrl, onApply }: UploadImageTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLImageElement | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const dragRef = useRef<{ mode: "move"; id: string; offsetX: number; offsetY: number } | { mode: "resize"; id: string; corner: Corner } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layerVersion, setLayerVersion] = useState(0);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadImage(sourcePngUrl).then((img) => {
      if (cancelled || !canvasRef.current) return;
      backgroundRef.current = img;
      canvasRef.current.width = img.naturalWidth;
      canvasRef.current.height = img.naturalHeight;
      layersRef.current = [];
      setLayerVersion(0);
      setSelectedId(null);
      setReady(true);
      redraw();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePngUrl]);

  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, layerVersion]);

  /** Pass an explicit override (including `null`) to draw without relying on the not-yet-committed `selectedId` state, e.g. for a clean "Apply" capture. */
  function redraw(selectionIdOverride: string | null = selectedId) {
    const canvas = canvasRef.current;
    const bg = backgroundRef.current;
    if (!canvas || !bg) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    for (const layer of layersRef.current) {
      ctx.drawImage(layer.img, layer.x - layer.width / 2, layer.y - layer.height / 2, layer.width, layer.height);
    }
    const selected = layersRef.current.find((l) => l.id === selectionIdOverride);
    if (selected) drawSelection(ctx, selected);
  }

  function drawSelection(ctx: CanvasRenderingContext2D, layer: Layer) {
    const left = layer.x - layer.width / 2;
    const top = layer.y - layer.height / 2;
    ctx.save();
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = Math.max(1, layer.width / 150);
    ctx.setLineDash([Math.max(2, layer.width / 40), Math.max(2, layer.width / 40)]);
    ctx.strokeRect(left, top, layer.width, layer.height);
    ctx.setLineDash([]);
    ctx.fillStyle = "#6366f1";
    const handleSize = Math.max(4, layer.width / 30);
    for (const [cx, cy] of cornerPoints(layer)) {
      ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    }
    ctx.restore();
  }

  function cornerPoints(layer: Layer): [number, number][] {
    const left = layer.x - layer.width / 2;
    const top = layer.y - layer.height / 2;
    const right = layer.x + layer.width / 2;
    const bottom = layer.y + layer.height / 2;
    return [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ];
  }

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    return canvasPointerPosition(e, canvasRef.current!);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const point = canvasPointFromEvent(e);
    const handleRadius = HANDLE_SCREEN_PX * point.scale;

    const selected = layersRef.current.find((l) => l.id === selectedId);
    if (selected) {
      const corners: [Corner, number, number][] = [
        ["tl", ...cornerPoints(selected)[0]],
        ["tr", ...cornerPoints(selected)[1]],
        ["bl", ...cornerPoints(selected)[2]],
        ["br", ...cornerPoints(selected)[3]],
      ];
      for (const [corner, cx, cy] of corners) {
        if (Math.hypot(point.x - cx, point.y - cy) <= handleRadius) {
          dragRef.current = { mode: "resize", id: selected.id, corner };
          canvasRef.current!.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    for (let i = layersRef.current.length - 1; i >= 0; i--) {
      const layer = layersRef.current[i];
      const left = layer.x - layer.width / 2;
      const top = layer.y - layer.height / 2;
      if (point.x >= left && point.x <= left + layer.width && point.y >= top && point.y <= top + layer.height) {
        setSelectedId(layer.id);
        dragRef.current = { mode: "move", id: layer.id, offsetX: point.x - layer.x, offsetY: point.y - layer.y };
        canvasRef.current!.setPointerCapture(e.pointerId);
        return;
      }
    }

    setSelectedId(null);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = canvasPointFromEvent(e);
    const layer = layersRef.current.find((l) => l.id === drag.id);
    if (!layer) return;

    if (drag.mode === "move") {
      layer.x = point.x - drag.offsetX;
      layer.y = point.y - drag.offsetY;
    } else {
      const aspect = layer.width / layer.height;
      const fixed = fixedCornerFor(layer, drag.corner);
      const dx = point.x - fixed.x;
      const dy = point.y - fixed.y;
      const diag0 = Math.hypot(layer.width, layer.height);
      const diag = Math.max(1, Math.hypot(dx, dy));
      const scale = diag / diag0;
      let newWidth = Math.max(MIN_LAYER_SIZE, layer.width * scale);
      let newHeight = newWidth / aspect;
      if (newHeight < MIN_LAYER_SIZE) {
        newHeight = MIN_LAYER_SIZE;
        newWidth = newHeight * aspect;
      }
      const signX = drag.corner === "tl" || drag.corner === "bl" ? -1 : 1;
      const signY = drag.corner === "tl" || drag.corner === "tr" ? -1 : 1;
      layer.width = newWidth;
      layer.height = newHeight;
      layer.x = fixed.x + (signX * newWidth) / 2;
      layer.y = fixed.y + (signY * newHeight) / 2;
    }
    redraw();
  }

  function fixedCornerFor(layer: Layer, dragged: Corner): { x: number; y: number } {
    const left = layer.x - layer.width / 2;
    const top = layer.y - layer.height / 2;
    const right = layer.x + layer.width / 2;
    const bottom = layer.y + layer.height / 2;
    switch (dragged) {
      case "tl":
        return { x: right, y: bottom };
      case "tr":
        return { x: left, y: bottom };
      case "bl":
        return { x: right, y: top };
      case "br":
        return { x: left, y: top };
    }
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !canvasRef.current) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read the selected file"));
        reader.readAsDataURL(file);
      });
      const img = await loadImage(dataUrl);
      const canvas = canvasRef.current;
      const maxSize = Math.min(canvas.width, canvas.height) * 0.4;
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      const layer: Layer = {
        id: crypto.randomUUID(),
        img,
        x: canvas.width / 2,
        y: canvas.height / 2,
        width,
        height,
      };
      layersRef.current.push(layer);
      setSelectedId(layer.id);
      setLayerVersion((v) => v + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the selected image");
    }
  }

  function removeSelected() {
    if (!selectedId) return;
    layersRef.current = layersRef.current.filter((l) => l.id !== selectedId);
    setSelectedId(null);
    setLayerVersion((v) => v + 1);
  }

  async function handleApply() {
    const canvas = canvasRef.current;
    if (!canvas || layersRef.current.length === 0) return;
    setApplying(true);
    try {
      // Capture a clean frame with no selection outline/handles, without
      // touching the actual selection state (redraw's override param avoids
      // depending on a setState that wouldn't have committed synchronously).
      redraw(null);
      await onApply(canvas);
      redraw(selectedId);
      toast.success("Placed image(s) written to the .ytd.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply the placed image(s)");
    } finally {
      setApplying(false);
    }
  }

  const hasLayers = layersRef.current.length > 0;

  return (
    <div className="space-y-3">
      <div
        className="relative flex h-56 items-center justify-center overflow-hidden rounded-md border border-border p-2"
        style={{
          backgroundImage: "repeating-conic-gradient(#2a2d35 0% 25%, #33363f 0% 50%)",
          backgroundSize: "16px 16px",
        }}
      >
        {/* Always mounted (not conditional on `ready`) — the load effect below sets this canvas's
            width/height itself and needs the ref to already exist to do so. */}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="h-full w-full object-contain"
          style={{ imageRendering: "pixelated", cursor: "grab", touchAction: "none", visibility: ready ? "visible" : "hidden" }}
        />
        {!ready && <Loader2 className="absolute h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Drag an image to move it, drag a corner handle to resize (aspect ratio locked). Add as many images as you like.
      </p>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-1">
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Add Image
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={removeSelected} disabled={!selectedId}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove Selected
        </Button>
      </div>

      <Button onClick={handleApply} disabled={!hasLayers || applying} className="w-full">
        {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
        Apply
      </Button>
    </div>
  );
}
