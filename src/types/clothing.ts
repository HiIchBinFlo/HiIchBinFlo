/**
 * Core domain model for FiveM Clothing Studio.
 *
 * These types are shared conceptually with the Rust side (src-tauri/src/models.rs);
 * field names match the JSON that crosses the Tauri IPC boundary 1:1 so payloads
 * can be passed through without manual re-mapping.
 */

export type Gender = "male" | "female";

export type ItemType = "component" | "prop";

/** GTA V / FiveM ped component slots (drawable "components"). */
export interface ComponentDef {
  id: number;
  key: string;
  label: string;
}

/** GTA V / FiveM ped prop anchor points (hats, glasses, watches, ...). */
export interface PropDef {
  id: number;
  key: string;
  label: string;
}

export const PED_COMPONENTS: readonly ComponentDef[] = [
  { id: 0, key: "head", label: "Head / Face" },
  { id: 1, key: "berd", label: "Masks" },
  { id: 2, key: "hair", label: "Hair" },
  { id: 3, key: "uppr", label: "Torso (Upper Body)" },
  { id: 4, key: "lowr", label: "Legs (Lower Body)" },
  { id: 5, key: "hand", label: "Parachute / Bags" },
  { id: 6, key: "feet", label: "Shoes" },
  { id: 7, key: "teef", label: "Accessories (Special Outfits)" },
  { id: 8, key: "accs", label: "Accessories (Chains, Etc.)" },
  { id: 9, key: "task", label: "Body Armor / Vests" },
  { id: 10, key: "decl", label: "Decals" },
  { id: 11, key: "jbib", label: "Tops (Shirts / Jackets)" },
] as const;

export const PED_PROPS: readonly PropDef[] = [
  { id: 0, key: "p_head", label: "Hats" },
  { id: 1, key: "p_eyes", label: "Glasses" },
  { id: 2, key: "p_ears", label: "Earrings" },
  { id: 3, key: "p_mouth", label: "Mouth" },
  { id: 4, key: "p_lhand", label: "Left Hand" },
  { id: 5, key: "p_rhand", label: "Right Hand" },
  { id: 6, key: "p_lwrist", label: "Left Wrist (Watches)" },
  { id: 7, key: "p_rwrist", label: "Right Wrist (Bracelets)" },
] as const;

export function componentLabel(id: number): string {
  return PED_COMPONENTS.find((c) => c.id === id)?.label ?? `Component ${id}`;
}

export function propLabel(id: number): string {
  return PED_PROPS.find((p) => p.id === id)?.label ?? `Prop ${id}`;
}

export type LodLevel = "high" | "med" | "low" | "vlow";

/** A binary asset reference (.ydd / .ytd). Kept opaque in Phase 1 — see docs/FILE_FORMATS.md. */
export interface BinaryAssetRef {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  /** SHA-256 of the file contents, used for duplicate/corruption detection. */
  sha256: string;
  /** True once the referenced file has been located on disk and verified readable. */
  present: boolean;
}

export interface TextureVariant {
  /** Texture id within its parent drawable. NEVER reassigned once allocated — see slotSystem.ts. */
  textureId: number;
  name: string;
  file: BinaryAssetRef | null;
}

export interface ClothingDrawable {
  /** Internal stable identifier (UUID), independent from the numeric game slot. */
  id: string;
  /** The numeric FiveM/GTA drawable id. This is the value that must never shift. */
  drawableId: number;
  itemType: ItemType;
  /** Component id (0-11) when itemType === "component", prop anchor id (0-7) when "prop". */
  componentId: number;
  gender: Gender;
  dlc: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  lod: LodLevel;
  mesh: BinaryAssetRef | null;
  textures: TextureVariant[];
  hashes: Record<string, string>;
  metadata: Record<string, string>;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DlcInfo {
  id: string;
  name: string;
  resourceName: string;
  targetGender: Gender | "unisex";
}

export type ImportSourceType = "resource" | "zip" | "folder" | "files";

export interface ImportIssue {
  file: string;
  message: string;
}

export interface ImportReport {
  sourceType: ImportSourceType;
  sourcePath: string;
  scannedFiles: number;
  drawablesFound: number;
  texturesFound: number;
  componentsFound: number;
  propsFound: number;
  dlcsDetected: string[];
  gendersDetected: Gender[];
  missingFiles: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  itemId?: string;
  file?: string;
}

export interface ProjectSettings {
  resourceName: string;
  framework: "standalone" | "esx" | "qbcore" | "qbox";
  fxServerMinVersion: string;
}

export interface Project {
  id: string;
  name: string;
  /** Absolute path to the project's .fcstudio SQLite database. */
  dbPath: string;
  createdAt: string;
  updatedAt: string;
  dlcs: DlcInfo[];
  settings: ProjectSettings;
}

export type ViewMode = "grid" | "list";

export interface ClothingFilters {
  search: string;
  gender: Gender | "all";
  itemType: ItemType | "all";
  componentId: number | "all";
  dlc: string | "all";
  tags: string[];
}

export const DEFAULT_FILTERS: ClothingFilters = {
  search: "",
  gender: "all",
  itemType: "all",
  componentId: "all",
  dlc: "all",
  tags: [],
};
