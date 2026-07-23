import { invoke } from "@tauri-apps/api/core";
import type {
  BinaryAssetRef,
  ClothingDrawable,
  DecodedDrawableInfo,
  DecodedTextureInfo,
  DlcInfo,
  ImportReport,
  ImportSourceType,
  MeshPart,
  Project,
  ProjectSettings,
  ValidationIssue,
} from "@/types/clothing";

/** True when running inside the Tauri webview (vs. plain `vite dev` in a browser for UI iteration). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenProjectResult {
  project: Project;
  items: ClothingDrawable[];
  dlcs: DlcInfo[];
}

export interface ImportResult {
  report: ImportReport;
  items: ClothingDrawable[];
  dlcs: DlcInfo[];
}

export type ExportFormat = "resource" | "zip" | "dlc" | "files";

export interface ExportResult {
  outputPath: string;
  filesWritten: number;
  issues: ValidationIssue[];
}

export interface SidecarProbeResult {
  ok: boolean;
  bridgeVersion: string;
  codeWalkerCoreVersion: string;
}

export interface InspectYtdResult {
  ok: boolean;
  error: string | null;
  textures: DecodedTextureInfo[] | null;
}

export interface InspectYddResult {
  ok: boolean;
  error: string | null;
  drawables: DecodedDrawableInfo[] | null;
}

export interface ExportGeometryResult {
  ok: boolean;
  error: string | null;
  drawableName: string | null;
  lodUsed: string | null;
  parts: MeshPart[] | null;
}

export interface RepairResult {
  ok: boolean;
  error: string | null;
  outputPath: string | null;
  inputBytes: number;
  outputBytes: number;
}

export interface DeepValidationReport {
  meshesChecked: number;
  texturesChecked: number;
  issues: ValidationIssue[];
}

export interface GenerateThumbnailsReport {
  generated: number;
  skipped: number;
  errors: string[];
  /** item id -> base64 PNG (no `data:` URL prefix) */
  thumbnails: Record<string, string>;
}

/** Thrown when a Tauri command is invoked outside of the desktop shell (e.g. `vite dev` in a browser). */
export class TauriUnavailableError extends Error {
  constructor(command: string) {
    super(
      `"${command}" requires the Tauri desktop shell and is unavailable in a plain browser preview. ` +
        `Run via \`npm run tauri dev\`.`,
    );
    this.name = "TauriUnavailableError";
  }
}

function requireTauri(command: string) {
  if (!isTauri()) throw new TauriUnavailableError(command);
}

/**
 * Absolute path to a project asset on disk, given its BinaryAssetRef.relativePath.
 * Mirrors `assets_dir()` in src-tauri/src/commands/import.rs exactly — keep in sync.
 */
export function assetAbsolutePath(dbPath: string, relativePath: string): string {
  return `${dbPath}.assets/${relativePath}`;
}

/** Cache directory for extracted .dds files used by the mesh/texture preview (Phase 3). */
export function previewCacheDir(dbPath: string): string {
  return `${dbPath}.assets/.preview-cache`;
}

export const tauriApi = {
  async createProject(name: string, dbPath: string, settings: ProjectSettings): Promise<Project> {
    requireTauri("project_create");
    return invoke<Project>("project_create", { name, dbPath, settings });
  },

  async openProject(dbPath: string): Promise<OpenProjectResult> {
    requireTauri("project_open");
    return invoke<OpenProjectResult>("project_open", { dbPath });
  },

  async saveProject(
    project: Project,
    items: ClothingDrawable[],
    dlcs: DlcInfo[],
  ): Promise<void> {
    requireTauri("project_save");
    return invoke<void>("project_save", { project, items, dlcs });
  },

  async importSource(
    sourceType: ImportSourceType,
    sourcePath: string,
    dbPath: string,
  ): Promise<ImportResult> {
    requireTauri("import_source");
    return invoke<ImportResult>("import_source", { sourceType, sourcePath, dbPath });
  },

  async exportProject(
    project: Project,
    items: ClothingDrawable[],
    dlcs: DlcInfo[],
    format: ExportFormat,
    outputPath: string,
  ): Promise<ExportResult> {
    requireTauri("export_project");
    return invoke<ExportResult>("export_project", { project, items, dlcs, format, outputPath });
  },

  /** Copies a user-picked file into the project's asset storage (used by "Replace" / "Add file"). */
  async importAssetFile(dbPath: string, dlcResourceName: string, sourcePath: string): Promise<BinaryAssetRef> {
    requireTauri("import_asset_file");
    return invoke<BinaryAssetRef>("import_asset_file", { dbPath, dlcResourceName, sourcePath });
  },

  /** Copies an already-imported asset to a new deduplicated filename (used by "Duplicate file"). */
  async duplicateAssetFile(dbPath: string, relativePath: string): Promise<BinaryAssetRef> {
    requireTauri("duplicate_asset_file");
    return invoke<BinaryAssetRef>("duplicate_asset_file", { dbPath, relativePath });
  },

  /** Health check for the codewalker-bridge sidecar (real .ydd/.ytd decoding). */
  async sidecarProbe(): Promise<SidecarProbeResult> {
    requireTauri("sidecar_probe");
    return invoke<SidecarProbeResult>("sidecar_probe");
  },

  /** Real, decoded texture info (dimensions/format/mips) + optional .dds extraction. Phase 2. */
  async inspectYtd(path: string, extractDir?: string): Promise<InspectYtdResult> {
    requireTauri("inspect_ytd");
    return invoke<InspectYtdResult>("inspect_ytd", { path, extractDir: extractDir ?? null });
  },

  /** Real, decoded drawable structure (bounding box, LODs, bones, geometry stats). Phase 2. */
  async inspectYdd(path: string): Promise<InspectYddResult> {
    requireTauri("inspect_ydd");
    return invoke<InspectYddResult>("inspect_ydd", { path });
  },

  /** Real vertex/index geometry (positions/normals/uv0) for the isolated mesh preview. Phase 3/4. */
  async exportGeometry(path: string, drawable?: string, lod?: string): Promise<ExportGeometryResult> {
    requireTauri("export_geometry");
    return invoke<ExportGeometryResult>("export_geometry", {
      path,
      drawable: drawable ?? null,
      lod: lod ?? null,
    });
  },

  /** Decodes an already-extracted .dds file to a base64 PNG (pure Rust, no sidecar). Phase 3. */
  async decodeTexturePng(path: string): Promise<string> {
    requireTauri("decode_texture_png");
    return invoke<string>("decode_texture_png", { path });
  },

  /** Small downsampled base64 PNG thumbnail for the clothing grid's cards. Phase 3. */
  async decodeTextureThumbnail(path: string, maxSize = 128): Promise<string> {
    requireTauri("decode_texture_thumbnail");
    return invoke<string>("decode_texture_thumbnail", { path, maxSize });
  },

  /** Decodes a .dds and writes a real .png file at outputPath (Texture Viewer "Export as PNG"). */
  async exportTexturePng(ddsPath: string, outputPath: string): Promise<void> {
    requireTauri("export_texture_png");
    return invoke<void>("export_texture_png", { ddsPath, outputPath });
  },

  /** Verbatim file copy (Texture Viewer "Export as DDS"). */
  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    requireTauri("copy_file");
    return invoke<void>("copy_file", { sourcePath, destPath });
  },

  /**
   * Write-back proof (Phase 4): re-serializes a .ytd/.ydd through
   * CodeWalker.Core, verifying the result reloads correctly before writing.
   * `inputPath`/`outputPath` may be the same path for an in-place repair.
   */
  async repairYtd(inputPath: string, outputPath: string): Promise<RepairResult> {
    requireTauri("repair_ytd");
    return invoke<RepairResult>("repair_ytd", { inputPath, outputPath });
  },
  async repairYdd(inputPath: string, outputPath: string): Promise<RepairResult> {
    requireTauri("repair_ydd");
    return invoke<RepairResult>("repair_ydd", { inputPath, outputPath });
  },

  /** Recomputes an asset's size/hash from disk after `repairYtd`/`repairYdd` changes its bytes. */
  async refreshAssetRef(dbPath: string, relativePath: string): Promise<BinaryAssetRef> {
    requireTauri("refresh_asset_ref");
    return invoke<BinaryAssetRef>("refresh_asset_ref", { dbPath, relativePath });
  },

  /**
   * Phase 5: opt-in "deep validate everything" — actually decodes every
   * present mesh/texture in the project through the sidecar (bounded
   * concurrency on the Rust side), unlike the Inspector's per-item on-demand
   * decode. Can take a while on a large project; callers should show
   * progress/a busy state rather than call this implicitly.
   */
  async deepValidateProject(dbPath: string, items: ClothingDrawable[]): Promise<DeepValidationReport> {
    requireTauri("deep_validate_project");
    return invoke<DeepValidationReport>("deep_validate_project", { dbPath, items });
  },

  /**
   * Design Studio (Phase 6): writes an edited image (recolored, uploaded, or
   * hand-painted) back onto a named texture inside a real .ytd — verified
   * before anything is written to disk (same shape as repairYtd/repairYdd).
   * `editedPngBase64` is the full edited image as a base64 PNG; it does not
   * need to match the original texture's pixel dimensions.
   */
  async applyTextureEdit(
    inputPath: string,
    textureName: string,
    editedPngBase64: string,
    outputPath: string,
  ): Promise<RepairResult> {
    requireTauri("apply_texture_edit");
    return invoke<RepairResult>("apply_texture_edit", { inputPath, textureName, editedPngBase64, outputPath });
  },

  /**
   * Batched thumbnail generation: for every item that doesn't already have
   * one and has a present texture, decodes it through the sidecar (bounded
   * concurrency) and produces a small downsampled PNG — the bulk complement
   * to the Inspector's per-item on-demand "Decode" thumbnail generation.
   * Returns a map of item id -> base64 PNG; callers apply it onto each
   * item's `thumbnail` field themselves (this command never touches the
   * project's SQLite file).
   */
  async generateThumbnails(dbPath: string, items: ClothingDrawable[]): Promise<GenerateThumbnailsReport> {
    requireTauri("generate_thumbnails");
    return invoke<GenerateThumbnailsReport>("generate_thumbnails", { dbPath, items });
  },
};
