import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Paintbrush, Pipette, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { loadImage } from "./canvasUtils";

interface PaintTabProps {
  sourcePngUrl: string;
  onApply: (canvas: HTMLCanvasElement) => Promise<void>;
}

const MAX_HISTORY = 20;

/** Free-hand paint editor: brush, eyedropper, undo/redo, background pre-loaded with the current texture. */
export function PaintTab({ sourcePngUrl, onApply }: PaintTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const strokeStartRef = useRef<ImageData | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [eyedropper, setEyedropper] = useState(false);
  const [historyLength, setHistoryLength] = useState(0);
  const [redoLength, setRedoLength] = useState(0);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadImage(sourcePngUrl).then((img) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      historyRef.current = [];
      redoRef.current = [];
      setHistoryLength(0);
      setRedoLength(0);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sourcePngUrl]);

  function canvasPointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const point = canvasPointFromEvent(e);

    if (eyedropper) {
      const pixel = ctx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
      setBrushColor(`#${[pixel[0], pixel[1], pixel[2]].map((c) => c.toString(16).padStart(2, "0")).join("")}`);
      setEyedropper(false);
      return;
    }

    strokeStartRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    lastPointRef.current = point;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    canvas.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || !lastPointRef.current || eyedropper) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const point = canvasPointFromEvent(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = brushColor;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePointerUp() {
    if (!strokeStartRef.current) return;
    historyRef.current.push(strokeStartRef.current);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoRef.current = [];
    strokeStartRef.current = null;
    lastPointRef.current = null;
    setHistoryLength(historyRef.current.length);
    setRedoLength(0);
  }

  function undo() {
    const canvas = canvasRef.current;
    const previous = historyRef.current.pop();
    if (!canvas || !previous) return;
    const ctx = canvas.getContext("2d")!;
    redoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(previous, 0, 0);
    setHistoryLength(historyRef.current.length);
    setRedoLength(redoRef.current.length);
  }

  function redo() {
    const canvas = canvasRef.current;
    const next = redoRef.current.pop();
    if (!canvas || !next) return;
    const ctx = canvas.getContext("2d")!;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(next, 0, 0);
    setHistoryLength(historyRef.current.length);
    setRedoLength(redoRef.current.length);
  }

  async function handleApply() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setApplying(true);
    try {
      await onApply(canvas);
      toast.success("Painted texture written to the .ytd.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply the painted texture");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="flex h-56 items-center justify-center overflow-hidden rounded-md border border-border p-2"
        style={{
          backgroundImage: "repeating-conic-gradient(#2a2d35 0% 25%, #33363f 0% 50%)",
          backgroundSize: "16px 16px",
        }}
      >
        {!ready ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="h-full w-full object-contain"
            style={{ imageRendering: "pixelated", cursor: eyedropper ? "crosshair" : "cell", touchAction: "none" }}
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Color</Label>
          <input
            type="color"
            value={brushColor}
            onChange={(e) => setBrushColor(e.target.value)}
            className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Brush size ({brushSize}px)</Label>
          <input
            type="range"
            min={1}
            max={64}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Opacity ({Math.round(opacity * 100)}%)</Label>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="h-8 w-full"
          />
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant={eyedropper ? "default" : "outline"} onClick={() => setEyedropper((v) => !v)}>
          <Pipette className="mr-1.5 h-3.5 w-3.5" /> Eyedropper
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={undo} disabled={historyLength === 0}>
          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={redo} disabled={redoLength === 0}>
          <Redo2 className="mr-1.5 h-3.5 w-3.5" /> Redo
        </Button>
      </div>

      <Button onClick={handleApply} disabled={!ready || applying} className="w-full">
        {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Paintbrush className="mr-1.5 h-3.5 w-3.5" />}
        Apply Painted Texture
      </Button>
    </div>
  );
}
