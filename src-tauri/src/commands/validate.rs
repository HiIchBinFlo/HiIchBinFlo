//! Server-side mirror of `src/lib/validation.ts`, used as the final safety
//! net before export (the frontend already blocks the Export button on
//! errors, but a backend command must not trust the caller).

use crate::models::{ClothingDrawable, DlcInfo, ItemType, ValidationIssue, ValidationSeverity};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

fn issue(severity: ValidationSeverity, code: &str, message: String, item_id: Option<String>) -> ValidationIssue {
    ValidationIssue {
        id: Uuid::new_v4().to_string(),
        severity,
        code: code.to_string(),
        message,
        item_id,
        file: None,
    }
}

pub fn validate_project(items: &[ClothingDrawable], dlcs: &[DlcInfo]) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let dlc_ids: HashSet<&str> = dlcs.iter().map(|d| d.id.as_str()).collect();
    let mut track_owners: HashMap<(String, ItemType, u32, u32), String> = HashMap::new();

    for item in items {
        let track_key = (item.gender.as_str().to_string(), item.item_type, item.component_id, item.drawable_id);
        if let Some(existing) = track_owners.get(&track_key) {
            if existing != &item.id {
                issues.push(issue(
                    ValidationSeverity::Error,
                    "DUPLICATE_ID",
                    format!(
                        "Drawable id {} is used by both \"{}\" and \"{}\" in the same slot track.",
                        item.drawable_id, existing, item.name
                    ),
                    Some(item.id.clone()),
                ));
            }
        } else {
            track_owners.insert(track_key, item.id.clone());
        }

        match &item.mesh {
            None => issues.push(issue(
                ValidationSeverity::Error,
                "MISSING_MESH",
                format!("\"{}\" has no .ydd mesh file assigned.", item.name),
                Some(item.id.clone()),
            )),
            Some(mesh) if !mesh.present => issues.push(issue(
                ValidationSeverity::Error,
                "MISSING_MESH",
                format!("\"{}\" references \"{}\" but it is missing from disk.", item.name, mesh.file_name),
                Some(item.id.clone()),
            )),
            _ => {}
        }

        if item.textures.is_empty() {
            issues.push(issue(
                ValidationSeverity::Warning,
                "MISSING_TEXTURE",
                format!("\"{}\" has no texture variants.", item.name),
                Some(item.id.clone()),
            ));
        }
        for tex in &item.textures {
            match &tex.file {
                None => issues.push(issue(
                    ValidationSeverity::Error,
                    "MISSING_TEXTURE",
                    format!("\"{}\" texture #{} has no .ytd file assigned.", item.name, tex.texture_id),
                    Some(item.id.clone()),
                )),
                Some(file) if !file.present => issues.push(issue(
                    ValidationSeverity::Error,
                    "BROKEN_REFERENCE",
                    format!(
                        "\"{}\" texture #{} references \"{}\" but it is missing from disk.",
                        item.name, tex.texture_id, file.file_name
                    ),
                    Some(item.id.clone()),
                )),
                _ => {}
            }
        }

        if !item.dlc.is_empty() && !dlc_ids.contains(item.dlc.as_str()) {
            issues.push(issue(
                ValidationSeverity::Error,
                "BROKEN_REFERENCE",
                format!("\"{}\" references a DLC that does not exist in this project.", item.name),
                Some(item.id.clone()),
            ));
        }

        if item.name.trim().is_empty() {
            issues.push(issue(
                ValidationSeverity::Error,
                "INVALID_METADATA",
                "Item has an empty name.".to_string(),
                Some(item.id.clone()),
            ));
        }
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Gender, LodLevel};
    use std::collections::HashMap as StdHashMap;

    fn base_item() -> ClothingDrawable {
        ClothingDrawable {
            id: "item-1".into(),
            drawable_id: 0,
            item_type: ItemType::Component,
            component_id: 3,
            gender: Gender::Male,
            dlc: "dlc-1".into(),
            name: "Jacket".into(),
            category: String::new(),
            description: String::new(),
            tags: vec![],
            lod: LodLevel::High,
            mesh: None,
            textures: vec![],
            hashes: StdHashMap::new(),
            metadata: StdHashMap::new(),
            thumbnail: None,
            created_at: "now".into(),
            updated_at: "now".into(),
        }
    }

    #[test]
    fn flags_missing_mesh_and_missing_dlc() {
        let item = base_item();
        let issues = validate_project(&[item], &[]);
        let codes: Vec<&str> = issues.iter().map(|i| i.code.as_str()).collect();
        assert!(codes.contains(&"MISSING_MESH"));
        assert!(codes.contains(&"BROKEN_REFERENCE"));
    }

    #[test]
    fn clean_item_with_valid_dlc_has_no_errors() {
        let mut item = base_item();
        item.mesh = Some(crate::models::BinaryAssetRef {
            file_name: "uppr_000_u.ydd".into(),
            relative_path: "dlc/stream/uppr_000_u.ydd".into(),
            size_bytes: 10,
            sha256: "abc".into(),
            present: true,
        });
        item.textures.push(crate::models::TextureVariant {
            texture_id: 0,
            name: "default".into(),
            file: Some(crate::models::BinaryAssetRef {
                file_name: "uppr_diff_000_000_a_uni.ytd".into(),
                relative_path: "dlc/stream/uppr_diff_000_000_a_uni.ytd".into(),
                size_bytes: 10,
                sha256: "def".into(),
                present: true,
            }),
        });
        let dlc = DlcInfo {
            id: "dlc-1".into(),
            name: "Main".into(),
            resource_name: "main".into(),
            target_gender: crate::models::DlcTargetGender::Unisex,
        };
        let issues = validate_project(&[item], &[dlc]);
        assert!(issues.iter().all(|i| i.severity != ValidationSeverity::Error));
    }
}
