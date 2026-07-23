//! Domain model shared over the Tauri IPC boundary. Field names use camelCase
//! to match `src/types/clothing.ts` 1:1 so the frontend can consume command
//! results without any manual re-mapping.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Male,
    Female,
}

impl Gender {
    pub fn as_str(&self) -> &'static str {
        match self {
            Gender::Male => "male",
            Gender::Female => "female",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Component,
    Prop,
}

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemType::Component => "component",
            ItemType::Prop => "prop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LodLevel {
    #[default]
    High,
    Med,
    Low,
    Vlow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryAssetRef {
    pub file_name: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureVariant {
    pub texture_id: u32,
    pub name: String,
    pub file: Option<BinaryAssetRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClothingDrawable {
    pub id: String,
    pub drawable_id: u32,
    pub item_type: ItemType,
    pub component_id: u32,
    pub gender: Gender,
    pub dlc: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub tags: Vec<String>,
    pub lod: LodLevel,
    pub mesh: Option<BinaryAssetRef>,
    pub textures: Vec<TextureVariant>,
    pub hashes: HashMap<String, String>,
    pub metadata: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DlcTargetGender {
    Male,
    Female,
    Unisex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlcInfo {
    pub id: String,
    pub name: String,
    pub resource_name: String,
    pub target_gender: DlcTargetGender,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportSourceType {
    Resource,
    Zip,
    Folder,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub source_type: ImportSourceType,
    pub source_path: String,
    pub scanned_files: u32,
    pub drawables_found: u32,
    pub textures_found: u32,
    pub components_found: u32,
    pub props_found: u32,
    pub dlcs_detected: Vec<String>,
    pub genders_detected: Vec<Gender>,
    pub missing_files: Vec<String>,
    pub errors: Vec<ImportIssue>,
    pub warnings: Vec<ImportIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub report: ImportReport,
    pub items: Vec<ClothingDrawable>,
    pub dlcs: Vec<DlcInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValidationSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub id: String,
    pub severity: ValidationSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    Standalone,
    Esx,
    Qbcore,
    Qbox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub resource_name: String,
    pub framework: Framework,
    pub fx_server_min_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub db_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub dlcs: Vec<DlcInfo>,
    pub settings: ProjectSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Resource,
    Zip,
    Dlc,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub files_written: u32,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectResult {
    pub project: Project,
    pub items: Vec<ClothingDrawable>,
    pub dlcs: Vec<DlcInfo>,
}
