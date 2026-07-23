import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { drawStretched, hexToRgb, loadImage, recolor } from "./canvasUtils";

interface RecolorTabProps {
  sourcePngUrl: string;
  onApply: (canvas: HTMLCanvasElement) => Promise<void>;
}

/** Recolor: pick a target color + intensity, preview live, write back on Apply. */
export function RecolorTab({ sourcePngUrl, onApply }: RecolorTabProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState("#c0392b");
  const [intensity, setIntensity] = useState(0.85);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadImage(sourcePngUrl).then((img) => {
      if (cancelled) return;
      setOriginal(drawStretched(img, img.naturalWidth, img.naturalHeight));
    });
    return () => {
      cancelled = true;
    };
  }, [sourcePngUrl]);

  useEffect(() => {
    if (!original || !previewRef.current) return;
    const recolored = recolor(original, hexToRgb(color), intensity);
    previewRef.current.width = recolored.width;
    previewRef.current.height = recolored.height;
    previewRef.current.getContext("2d")!.drawImage(recolored, 0, 0);
  }, [original, color, intensity]);

  async function handleApply() {
    if (!original) return;
    setApplying(true);
    try {
      const recolored = recolor(original, hexToRgb(color), intensity);
      await onApply(recolored);
      toast.success("Recolored texture written to the .ytd.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply recolor");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="flex h-56 items-center justify-center rounded-md border border-border p-2"
        style={{
          backgroundImage: "repeating-conic-gradient(#2a2d35 0% 25%, #33363f 0% 50%)",
          backgroundSize: "16px 16px",
        }}
      >
        {!original ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <canvas ref={previewRef} className="max-h-full max-w-full object-contain" style={{ imageRendering: "pixelated" }} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Color</Label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Intensity ({Math.round(intensity * 100)}%)</Label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="h-8 w-full"
          />
        </div>
      </div>

      <Button onClick={handleApply} disabled={!original || applying} className="w-full">
        {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Palette className="mr-1.5 h-3.5 w-3.5" />}
        Apply Recolor
      </Button>
    </div>
  );
}
