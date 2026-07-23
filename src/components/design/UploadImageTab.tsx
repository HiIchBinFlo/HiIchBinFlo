import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { drawFitted, loadImage } from "./canvasUtils";

interface UploadImageTabProps {
  sourcePngUrl: string;
  onApply: (canvas: HTMLCanvasElement) => Promise<void>;
}

type FitMode = "cover" | "contain" | "stretch";

/** Upload a custom image (logo/pattern/photo) and fit it into the texture's original dimensions. */
export function UploadImageTab({ sourcePngUrl, onApply }: UploadImageTabProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [targetSize, setTargetSize] = useState<{ width: number; height: number } | null>(null);
  const [uploaded, setUploaded] = useState<HTMLImageElement | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>("cover");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    loadImage(sourcePngUrl).then((img) => setTargetSize({ width: img.naturalWidth, height: img.naturalHeight }));
  }, [sourcePngUrl]);

  useEffect(() => {
    if (!uploaded || !targetSize || !previewRef.current) return;
    const fitted = drawFitted(uploaded, targetSize.width, targetSize.height, fitMode);
    previewRef.current.width = fitted.width;
    previewRef.current.height = fitted.height;
    previewRef.current.getContext("2d")!.drawImage(fitted, 0, 0);
  }, [uploaded, targetSize, fitMode]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read the selected file"));
        reader.readAsDataURL(file);
      });
      setUploaded(await loadImage(dataUrl));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the selected image");
    }
  }

  async function handleApply() {
    if (!uploaded || !targetSize) return;
    setApplying(true);
    try {
      const fitted = drawFitted(uploaded, targetSize.width, targetSize.height, fitMode);
      await onApply(fitted);
      toast.success("Uploaded image written to the .ytd.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply the uploaded image");
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
        {!uploaded ? (
          <p className="text-xs text-muted-foreground">Choose an image below to preview it here.</p>
        ) : (
          <canvas ref={previewRef} className="max-h-full max-w-full object-contain" style={{ imageRendering: "pixelated" }} />
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Image file</Label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-secondary-foreground"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Fit</Label>
        <div className="flex gap-1.5">
          {(["cover", "contain", "stretch"] as FitMode[]).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={fitMode === mode ? "default" : "outline"}
              onClick={() => setFitMode(mode)}
              className="flex-1 capitalize"
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>

      <Button onClick={handleApply} disabled={!uploaded || applying} className="w-full">
        {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
        Apply Uploaded Image
      </Button>
    </div>
  );
}
