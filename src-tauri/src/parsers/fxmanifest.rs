//! `fxmanifest.lua` reader/generator.
//!
//! `fxmanifest.lua` is a small Lua table, not a data-interchange format, so
//! there's no library to parse it "correctly" — resource authors write
//! arbitrary Lua. This module handles the well-defined subset every clothing
//! resource actually uses (`fx_version`, `game`, `files { ... }`, single-line
//! `key 'value'` declarations) and ignores anything else verbatim rather
//! than failing on it.

use once_cell::sync::Lazy;
use regex::Regex;

#[derive(Debug, Default, Clone)]
pub struct FxManifest {
    pub fx_version: Option<String>,
    pub game: Option<String>,
    pub files: Vec<String>,
    pub name: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
}

static SINGLE_QUOTED: Lazy<Regex> = Lazy::new(|| Regex::new(r"'([^']*)'").unwrap());
static DOUBLE_QUOTED: Lazy<Regex> = Lazy::new(|| Regex::new(r#""([^"]*)""#).unwrap());

fn quoted_strings(line: &str) -> Vec<String> {
    let mut out: Vec<String> = SINGLE_QUOTED.captures_iter(line).map(|c| c[1].to_string()).collect();
    out.extend(DOUBLE_QUOTED.captures_iter(line).map(|c| c[1].to_string()));
    out
}

/// Parses the subset of Lua that real-world clothing resource manifests use.
pub fn parse(source: &str) -> FxManifest {
    let mut manifest = FxManifest::default();
    let mut in_files_block = false;

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.starts_with("--") || line.is_empty() {
            continue;
        }

        if in_files_block {
            if line.starts_with('}') {
                in_files_block = false;
                continue;
            }
            manifest.files.extend(quoted_strings(line));
            continue;
        }

        if line.starts_with("files") && line.contains('{') {
            // Entries may be declared inline: files { 'a.ydd', 'b.ytd' }
            manifest.files.extend(quoted_strings(line));
            if !line.contains('}') {
                in_files_block = true;
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("fx_version") {
            manifest.fx_version = quoted_strings(rest).into_iter().next();
        } else if let Some(rest) = line.strip_prefix("game") {
            manifest.game = quoted_strings(rest).into_iter().next();
        } else if let Some(rest) = line.strip_prefix("name") {
            manifest.name = quoted_strings(rest).into_iter().next();
        } else if let Some(rest) = line.strip_prefix("author") {
            manifest.author = quoted_strings(rest).into_iter().next();
        } else if let Some(rest) = line.strip_prefix("description") {
            manifest.description = quoted_strings(rest).into_iter().next();
        } else if let Some(rest) = line.strip_prefix("version") {
            manifest.version = quoted_strings(rest).into_iter().next();
        }
    }

    manifest
}

/// Generates a deterministic `fxmanifest.lua` for export. `stream_files`
/// should be paths relative to the resource root (e.g. `stream/uppr_000_u.ydd`).
/// `dlc_meta_file` is only set for the "DLC Pack" export format, which also
/// writes a `dlc.meta` skeleton alongside the manifest (see export.rs);
/// resource/zip/files exports stream assets directly and must NOT reference
/// a `dlc.meta` that doesn't exist, or the resource fails to start.
pub fn generate(
    resource_name: &str,
    description: &str,
    stream_files: &[String],
    dlc_meta_file: Option<&str>,
) -> String {
    let mut out = String::new();
    out.push_str("fx_version 'cerulean'\n");
    out.push_str("game 'gta5'\n\n");
    out.push_str(&format!("name '{resource_name}'\n"));
    out.push_str(&format!("description '{}'\n", description.replace('\'', "\\'")));
    out.push_str("author 'FiveM Clothing Studio'\n");
    out.push_str("version '1.0.0'\n\n");
    out.push_str("files {\n");
    for file in stream_files {
        out.push_str(&format!("    '{file}',\n"));
    }
    out.push_str("}\n");
    if let Some(dlc_meta_file) = dlc_meta_file {
        out.push_str(&format!("\ndata_file 'DLC_ITYP_REQUEST' '{dlc_meta_file}'\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_typical_manifest() {
        let source = r#"
fx_version 'cerulean'
game 'gta5'

-- comment
name 'my_clothes'

files {
    'stream/uppr_000_u.ydd',
    'stream/uppr_diff_000_000_a_uni.ytd',
}
"#;
        let manifest = parse(source);
        assert_eq!(manifest.fx_version.as_deref(), Some("cerulean"));
        assert_eq!(manifest.game.as_deref(), Some("gta5"));
        assert_eq!(manifest.name.as_deref(), Some("my_clothes"));
        assert_eq!(
            manifest.files,
            vec!["stream/uppr_000_u.ydd", "stream/uppr_diff_000_000_a_uni.ytd"]
        );
    }

    #[test]
    fn generates_a_manifest_that_reparses_to_the_same_files() {
        let files = vec!["stream/a.ydd".to_string(), "stream/b.ytd".to_string()];
        let generated = generate("my_pack", "Test pack", &files, None);
        let reparsed = parse(&generated);
        assert_eq!(reparsed.files, files);
        assert_eq!(reparsed.fx_version.as_deref(), Some("cerulean"));
        assert_eq!(reparsed.name.as_deref(), Some("my_pack"));
        assert!(!generated.contains("dlc.meta"));
    }

    #[test]
    fn dlc_format_references_dlc_meta_when_requested() {
        let files = vec!["stream/a.ydd".to_string()];
        let generated = generate("my_pack", "Test pack", &files, Some("dlc.meta"));
        assert!(generated.contains("data_file 'DLC_ITYP_REQUEST' 'dlc.meta'"));
    }
}
