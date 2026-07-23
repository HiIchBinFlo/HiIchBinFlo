import type { ClothingDrawable, DlcInfo, ValidationIssue } from "@/types/clothing";
import { generateId } from "./utils";

function issue(
  severity: ValidationIssue["severity"],
  code: string,
  message: string,
  extra?: Partial<Pick<ValidationIssue, "itemId" | "file">>,
): ValidationIssue {
  return { id: generateId(), severity, code, message, ...extra };
}

/**
 * Runs the full pre-export validation pass described in the spec:
 * missing files, broken references, duplicate ids, missing textures,
 * invalid metadata. Pure function — safe to call on every keystroke in
 * the inspector as well as right before export.
 */
export function validateProject(items: ClothingDrawable[], dlcs: DlcInfo[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dlcIds = new Set(dlcs.map((d) => d.id));

  const idTracker = new Map<string, Map<number, string>>();

  for (const item of items) {
    const trackKey = `${item.gender}:${item.itemType}:${item.componentId}`;
    if (!idTracker.has(trackKey)) idTracker.set(trackKey, new Map());
    const track = idTracker.get(trackKey)!;

    // Duplicate numeric id within the same (gender, itemType, component) track.
    const existingOwner = track.get(item.drawableId);
    if (existingOwner && existingOwner !== item.id) {
      issues.push(
        issue(
          "error",
          "DUPLICATE_ID",
          `Drawable id ${item.drawableId} is used by both "${existingOwner}" and "${item.name}" ` +
            `in the same slot track (${trackKey}). Export would overwrite one with the other.`,
          { itemId: item.id },
        ),
      );
    } else {
      track.set(item.drawableId, item.id);
    }

    // Missing mesh file.
    if (!item.mesh) {
      issues.push(
        issue("error", "MISSING_MESH", `"${item.name}" has no .ydd mesh file assigned.`, {
          itemId: item.id,
        }),
      );
    } else if (!item.mesh.present) {
      issues.push(
        issue(
          "error",
          "MISSING_MESH",
          `"${item.name}" references "${item.mesh.fileName}" but the file could not be found on disk.`,
          { itemId: item.id, file: item.mesh.relativePath },
        ),
      );
    }

    // Missing / broken textures.
    if (item.textures.length === 0) {
      issues.push(
        issue("warning", "MISSING_TEXTURE", `"${item.name}" has no texture variants.`, {
          itemId: item.id,
        }),
      );
    }
    for (const tex of item.textures) {
      if (!tex.file) {
        issues.push(
          issue(
            "error",
            "MISSING_TEXTURE",
            `"${item.name}" texture #${tex.textureId} ("${tex.name}") has no .ytd file assigned.`,
            { itemId: item.id },
          ),
        );
      } else if (!tex.file.present) {
        issues.push(
          issue(
            "error",
            "BROKEN_REFERENCE",
            `"${item.name}" texture #${tex.textureId} references "${tex.file.fileName}" ` +
              `but the file could not be found on disk.`,
            { itemId: item.id, file: tex.file.relativePath },
          ),
        );
      }
    }

    // Broken DLC reference.
    if (item.dlc && !dlcIds.has(item.dlc)) {
      issues.push(
        issue(
          "error",
          "BROKEN_REFERENCE",
          `"${item.name}" references DLC "${item.dlc}" which does not exist in this project.`,
          { itemId: item.id },
        ),
      );
    }

    // Invalid metadata.
    if (!item.name.trim()) {
      issues.push(issue("error", "INVALID_METADATA", "Item has an empty name.", { itemId: item.id }));
    }
    if (item.drawableId < 0) {
      issues.push(
        issue("error", "INVALID_METADATA", `"${item.name}" has a negative drawable id.`, {
          itemId: item.id,
        }),
      );
    }
    if (item.componentId < 0) {
      issues.push(
        issue("error", "INVALID_METADATA", `"${item.name}" has an invalid component/prop id.`, {
          itemId: item.id,
        }),
      );
    }
  }

  return issues;
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
