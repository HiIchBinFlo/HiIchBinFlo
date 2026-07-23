/** Loads an `<img>` element from a data URL (or any src) and resolves once it's decoded. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/** Draws `img` into a freshly-sized canvas at `width`x`height`, stretching to fill. */
export function drawStretched(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** Draws `img` into a `width`x`height` canvas, scaled to cover (crop overflow) or contain (letterbox). */
export function drawFitted(
  img: HTMLImageElement,
  width: number,
  height: number,
  mode: "cover" | "contain" | "stretch",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  if (mode === "stretch") {
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  }

  const scale =
    mode === "cover"
      ? Math.max(width / img.width, height / img.height)
      : Math.min(width / img.width, height / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const dx = (width - drawWidth) / 2;
  const dy = (height - drawHeight) / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
  return canvas;
}

/**
 * Luminance-preserving recolor ("tint"): replaces each pixel's hue with
 * `targetRgb` while keeping its original brightness, then blends that result
 * back with the original by `intensity` (0 = unchanged, 1 = fully recolored).
 * This is the standard game-modding "recolor" technique — shading/highlights
 * survive, only the base color changes.
 */
export function recolor(
  source: HTMLCanvasElement,
  targetRgb: [number, number, number],
  intensity: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const srcCtx = source.getContext("2d")!;
  const outCtx = out.getContext("2d")!;
  const imageData = srcCtx.getImageData(0, 0, source.width, source.height);
  const data = imageData.data;
  const [tr, tg, tb] = targetRgb;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const recoloredR = tr * luminance;
    const recoloredG = tg * luminance;
    const recoloredB = tb * luminance;
    data[i] = r + (recoloredR - r) * intensity;
    data[i + 1] = g + (recoloredG - g) * intensity;
    data[i + 2] = b + (recoloredB - b) * intensity;
    // alpha (data[i + 3]) is left untouched.
  }

  outCtx.putImageData(imageData, 0, 0);
  return out;
}

/** `#rrggbb` -> `[r, g, b]` in 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

/** Canvas -> base64 PNG (without the `data:image/png;base64,` prefix). */
export function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
