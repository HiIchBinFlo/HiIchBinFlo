import { invoke } from "@tauri-apps/api/core";
import type {
  BinaryAssetRef,
  ClothingDrawable,
  DlcInfo,
  ImportReport,
  ImportSourceType,
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
};
