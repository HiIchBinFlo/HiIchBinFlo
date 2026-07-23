import { useState } from "react";
import { toast } from "sonner";
import { ScanEye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { assetAbsolutePath, tauriApi, TauriUnavailableError } from "@/lib/tauri";
import type { ClothingDrawable, DecodedDrawableInfo, DecodedTextureInfo } from "@/types/clothing";
import { formatBytes } from "@/lib/utils";

/**
 * Real, decoded structural info for the selected item's mesh/textures, via
 * the codewalker-bridge sidecar (Phase 2). On-demand rather than automatic
 * on every import — decoding shells out to a subprocess per file, so this
 * stays bounded to what the user is actually looking at right now instead
 * of blocking a 20,000-file import (see docs/ARCHITECTURE.md).
 */
export function DecodedInfoPanel({ item, dbPath }: { item: ClothingDrawable; dbPath: string }) {
  const [busy, setBusy] = useState(false);
  const [meshInfo, setMeshInfo] = useState<DecodedDrawableInfo[] | null>(null);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [textureInfo, setTextureInfo] = useState<DecodedTextureInfo[] | null>(null);
  const [textureErrors, setTextureErrors] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);

  async function handleDecode() {
    setBusy(true);
    setAttempted(true);
    setMeshInfo(null);
    setMeshError(null);
    setTextureInfo(null);
    setTextureErrors([]);

    try {
      if (item.mesh) {
        const meshPath = assetAbsolutePath(dbPath, item.mesh.relativePath);
        const res = await tauriApi.inspectYdd(meshPath);
        if (res.ok) setMeshInfo(res.drawables);
        else setMeshError(res.error ?? "Unknown decode error");
      }

      const textureFiles = item.textures.filter((t) => t.file).map((t) => t.file!);
      const decodedTextures: DecodedTextureInfo[] = [];
      const errors: string[] = [];
      for (const file of textureFiles) {
        const texPath = assetAbsolutePath(dbPath, file.relativePath);
        const res = await tauriApi.inspectYtd(texPath);
        if (res.ok && res.textures) decodedTextures.push(...res.textures);
        else errors.push(`${file.fileName}: ${res.error ?? "Unknown decode error"}`);
      }
      setTextureInfo(decodedTextures);
      setTextureErrors(errors);
    } catch (err) {
      const message =
        err instanceof TauriUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Decode failed";
      toast.error(message);
      setMeshError((prev) => prev ?? message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1">
          <ScanEye className="h-3 w-3" /> Decoded Info
        </Label>
        <Button variant="outline" size="sm" onClick={handleDecode} disabled={busy}>
          {busy ? "Decoding…" : "Decode"}
        </Button>
      </div>

      {!attempted && (
        <p className="text-xs text-muted-foreground">
          Decodes the actual mesh/texture content via the codewalker-bridge sidecar (real bounding
          box, LODs, bones, texture dimensions/format) instead of just tracking the file as opaque.
        </p>
      )}

      {meshError && (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Mesh: {meshError}
        </p>
      )}

      {meshInfo?.map((d, i) => (
        <div key={i} className="space-y-1 rounded-md border border-border p-2 text-[11px]">
          <p className="flex items-center gap-1 font-medium text-success">
            <CheckCircle2 className="h-3 w-3" /> {d.name}
          </p>
          <Row label="Bounding box" value={`min ${fmtVec(d.boundingBoxMin)} / max ${fmtVec(d.boundingBoxMax)}`} />
          <Row label="Bounding sphere" value={`r=${d.boundingSphereRadius.toFixed(3)}`} />
          <Row label="Bones" value={String(d.boneCount)} />
          <Row
            label="LODs present"
            value={d.lods.filter((l) => l.present).map((l) => l.level).join(", ") || "none"}
          />
          <Row
            label="Geometry"
            value={`${d.totalModelCount} models, ${d.totalGeometryCount} geometries, ${d.totalVertexCount} verts, ${d.totalTriangleCount} tris`}
          />
          {d.hasEmbeddedTextureDictionary && (
            <Row label="Embedded textures" value={d.embeddedTextureNames.join(", ") || "(none named)"} />
          )}
        </div>
      ))}

      {textureErrors.map((e, i) => (
        <p key={i} className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Texture: {e}
        </p>
      ))}

      {textureInfo && textureInfo.length > 0 && (
        <div className="space-y-1">
          {textureInfo.map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border p-2 text-[11px]">
              <span className="truncate">{t.name}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="outline">{t.width}×{t.height}</Badge>
                <Badge variant="secondary">{t.format.replace("D3DFMT_", "")}</Badge>
                <span className="text-muted-foreground">{formatBytes(t.dataBytes)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {attempted && !busy && <Separator />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function fmtVec([x, y, z]: [number, number, number]): string {
  return `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
}
