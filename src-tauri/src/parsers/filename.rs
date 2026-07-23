//! Filename-convention parsing for GTA V / FiveM ped clothing assets.
//!
//! This follows the de-facto naming convention used throughout the GTA V
//! modding community for ped component and prop streaming assets:
//!
//!   mesh:    `<component>_<drawableId:03>_<r|u>.ydd`
//!   texture: `<component>_diff_<drawableId:03>_<textureId:03>_<suffix>_<race>.ytd`
//!   prop:    `p_<anchor>_<drawableId:03>_<r|u>.ydd` / matching `.ytd`
//!
//! e.g. `uppr_diff_000_000_a_uni.ytd`, `uppr_000_u.ydd`, `p_head_003_u.ydd`.
//!
//! Packs that don't follow this convention are not silently misclassified:
//! `parse_mesh_filename`/`parse_texture_filename` return `None` and the
//! caller surfaces the file as an import warning instead of guessing.

use once_cell::sync::Lazy;
use regex::Regex;

pub struct ParsedMeshFilename {
    pub component_key: String,
    pub is_prop: bool,
    pub drawable_id: u32,
}

pub struct ParsedTextureFilename {
    pub component_key: String,
    pub is_prop: bool,
    pub drawable_id: u32,
    pub texture_id: u32,
}

static MESH_COMPONENT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^([a-z]+)_(\d{1,3})_[ru]\.ydd$").unwrap());
static MESH_PROP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^p_([a-z]+)_(\d{1,3})_[ru]\.ydd$").unwrap());
static TEXTURE_COMPONENT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^([a-z]+)_diff_(\d{1,3})_(\d{1,3})_[a-z]_[a-z]+\.ytd$").unwrap());
static TEXTURE_PROP_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^p_([a-z]+)_diff_(\d{1,3})_(\d{1,3})_[a-z]_[a-z]+\.ytd$").unwrap());

pub fn parse_mesh_filename(file_name: &str) -> Option<ParsedMeshFilename> {
    if let Some(caps) = MESH_PROP_RE.captures(file_name) {
        return Some(ParsedMeshFilename {
            component_key: caps[1].to_lowercase(),
            is_prop: true,
            drawable_id: caps[2].parse().ok()?,
        });
    }
    if let Some(caps) = MESH_COMPONENT_RE.captures(file_name) {
        return Some(ParsedMeshFilename {
            component_key: caps[1].to_lowercase(),
            is_prop: false,
            drawable_id: caps[2].parse().ok()?,
        });
    }
    None
}

pub fn parse_texture_filename(file_name: &str) -> Option<ParsedTextureFilename> {
    if let Some(caps) = TEXTURE_PROP_RE.captures(file_name) {
        return Some(ParsedTextureFilename {
            component_key: caps[1].to_lowercase(),
            is_prop: true,
            drawable_id: caps[2].parse().ok()?,
            texture_id: caps[3].parse().ok()?,
        });
    }
    if let Some(caps) = TEXTURE_COMPONENT_RE.captures(file_name) {
        return Some(ParsedTextureFilename {
            component_key: caps[1].to_lowercase(),
            is_prop: false,
            drawable_id: caps[2].parse().ok()?,
            texture_id: caps[3].parse().ok()?,
        });
    }
    None
}

/// Best-effort gender detection from a path: looks for `female`/`_f_`/`mp_f_`
/// vs `male`/`_m_`/`mp_m_` markers anywhere in the path components.
/// Returns `None` when the path gives no signal either way.
pub fn detect_gender_from_path(path: &str) -> Option<crate::models::Gender> {
    let lower = path.to_lowercase();
    let female_markers = ["female", "mp_f_", "_f_"];
    let male_markers = ["male", "mp_m_", "_m_"];
    let is_female = female_markers.iter().any(|m| lower.contains(m));
    let is_male = male_markers.iter().any(|m| lower.contains(m));
    match (is_male, is_female) {
        (true, false) => Some(crate::models::Gender::Male),
        (false, true) => Some(crate::models::Gender::Female),
        _ => None,
    }
}

pub const PED_COMPONENT_KEYS: &[(&str, u32)] = &[
    ("head", 0),
    ("berd", 1),
    ("hair", 2),
    ("uppr", 3),
    ("lowr", 4),
    ("hand", 5),
    ("feet", 6),
    ("teef", 7),
    ("accs", 8),
    ("task", 9),
    ("decl", 10),
    ("jbib", 11),
];

pub const PED_PROP_KEYS: &[(&str, u32)] = &[
    ("head", 0),
    ("eyes", 1),
    ("ears", 2),
    ("mouth", 3),
    ("lhand", 4),
    ("rhand", 5),
    ("lwrist", 6),
    ("rwrist", 7),
];

pub fn component_id_for_key(key: &str) -> Option<u32> {
    PED_COMPONENT_KEYS.iter().find(|(k, _)| *k == key).map(|(_, id)| *id)
}

pub fn prop_id_for_key(key: &str) -> Option<u32> {
    PED_PROP_KEYS.iter().find(|(k, _)| *k == key).map(|(_, id)| *id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_component_mesh_filenames() {
        let parsed = parse_mesh_filename("uppr_000_u.ydd").unwrap();
        assert_eq!(parsed.component_key, "uppr");
        assert!(!parsed.is_prop);
        assert_eq!(parsed.drawable_id, 0);
    }

    #[test]
    fn parses_prop_mesh_filenames() {
        let parsed = parse_mesh_filename("p_head_003_u.ydd").unwrap();
        assert_eq!(parsed.component_key, "head");
        assert!(parsed.is_prop);
        assert_eq!(parsed.drawable_id, 3);
    }

    #[test]
    fn parses_component_texture_filenames() {
        let parsed = parse_texture_filename("uppr_diff_000_000_a_uni.ytd").unwrap();
        assert_eq!(parsed.component_key, "uppr");
        assert!(!parsed.is_prop);
        assert_eq!(parsed.drawable_id, 0);
        assert_eq!(parsed.texture_id, 0);
    }

    #[test]
    fn parses_prop_texture_filenames() {
        let parsed = parse_texture_filename("p_head_diff_003_001_a_whi.ytd").unwrap();
        assert_eq!(parsed.component_key, "head");
        assert!(parsed.is_prop);
        assert_eq!(parsed.drawable_id, 3);
        assert_eq!(parsed.texture_id, 1);
    }

    #[test]
    fn rejects_non_conforming_filenames() {
        assert!(parse_mesh_filename("random_model.ydd").is_none());
        assert!(parse_texture_filename("random_texture.ytd").is_none());
    }

    #[test]
    fn detects_gender_from_path_markers() {
        assert_eq!(
            detect_gender_from_path("packs/mp_f_freemode_01/stream/uppr_000_u.ydd"),
            Some(crate::models::Gender::Female)
        );
        assert_eq!(
            detect_gender_from_path("packs/male/stream/uppr_000_u.ydd"),
            Some(crate::models::Gender::Male)
        );
        assert_eq!(detect_gender_from_path("packs/stream/uppr_000_u.ydd"), None);
    }
}
