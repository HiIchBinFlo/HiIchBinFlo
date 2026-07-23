//! SQLite persistence for `.fcstudio` project files.
//!
//! Each project is a single self-contained SQLite database. Structured
//! columns (drawable id, gender, component, dlc, ...) are real columns so
//! they can be indexed and queried directly; free-form nested data (tags,
//! texture variants, hashes, metadata) is stored as JSON text columns —
//! simpler than a fully normalized schema and adequate at clothing-pack
//! scale (tens of thousands of rows, not millions).

use crate::error::AppResult;
use crate::models::{
    ClothingDrawable, DlcInfo, DlcTargetGender, Framework, Gender, ItemType, LodLevel, Project,
    ProjectSettings,
};
use rusqlite::{params, Connection};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    framework TEXT NOT NULL,
    fx_server_min_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dlc (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    target_gender TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clothing_item (
    id TEXT PRIMARY KEY,
    drawable_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    component_id INTEGER NOT NULL,
    gender TEXT NOT NULL,
    dlc TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    lod TEXT NOT NULL DEFAULT 'high',
    mesh TEXT,
    textures TEXT NOT NULL DEFAULT '[]',
    hashes TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    thumbnail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clothing_item_slot
    ON clothing_item (gender, item_type, component_id, drawable_id);
"#;

pub fn open(db_path: &str) -> AppResult<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

fn gender_str(g: Gender) -> &'static str {
    g.as_str()
}

fn parse_gender(s: &str) -> Gender {
    if s == "female" {
        Gender::Female
    } else {
        Gender::Male
    }
}

fn item_type_str(t: ItemType) -> &'static str {
    t.as_str()
}

fn parse_item_type(s: &str) -> ItemType {
    if s == "prop" {
        ItemType::Prop
    } else {
        ItemType::Component
    }
}

fn lod_str(l: LodLevel) -> &'static str {
    match l {
        LodLevel::High => "high",
        LodLevel::Med => "med",
        LodLevel::Low => "low",
        LodLevel::Vlow => "vlow",
    }
}

fn parse_lod(s: &str) -> LodLevel {
    match s {
        "med" => LodLevel::Med,
        "low" => LodLevel::Low,
        "vlow" => LodLevel::Vlow,
        _ => LodLevel::High,
    }
}

fn framework_str(f: Framework) -> &'static str {
    match f {
        Framework::Standalone => "standalone",
        Framework::Esx => "esx",
        Framework::Qbcore => "qbcore",
        Framework::Qbox => "qbox",
    }
}

fn parse_framework(s: &str) -> Framework {
    match s {
        "esx" => Framework::Esx,
        "qbcore" => Framework::Qbcore,
        "qbox" => Framework::Qbox,
        _ => Framework::Standalone,
    }
}

fn target_gender_str(g: DlcTargetGender) -> &'static str {
    match g {
        DlcTargetGender::Male => "male",
        DlcTargetGender::Female => "female",
        DlcTargetGender::Unisex => "unisex",
    }
}

fn parse_target_gender(s: &str) -> DlcTargetGender {
    match s {
        "male" => DlcTargetGender::Male,
        "female" => DlcTargetGender::Female,
        _ => DlcTargetGender::Unisex,
    }
}

pub fn write_project(conn: &Connection, project: &Project) -> AppResult<()> {
    conn.execute(
        "INSERT INTO project (id, name, created_at, updated_at, resource_name, framework, fx_server_min_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at,
           resource_name = excluded.resource_name,
           framework = excluded.framework,
           fx_server_min_version = excluded.fx_server_min_version",
        params![
            project.id,
            project.name,
            project.created_at,
            project.updated_at,
            project.settings.resource_name,
            framework_str(project.settings.framework),
            project.settings.fx_server_min_version,
        ],
    )?;
    Ok(())
}

pub fn read_project(conn: &Connection) -> AppResult<Option<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, updated_at, resource_name, framework, fx_server_min_version
         FROM project LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let dlcs = read_dlcs(conn)?;
        Ok(Some(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            db_path: String::new(), // filled in by the caller, who knows the path on disk
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            dlcs,
            settings: ProjectSettings {
                resource_name: row.get(4)?,
                framework: parse_framework(&row.get::<_, String>(5)?),
                fx_server_min_version: row.get(6)?,
            },
        }))
    } else {
        Ok(None)
    }
}

pub fn replace_dlcs(conn: &Connection, dlcs: &[DlcInfo]) -> AppResult<()> {
    conn.execute("DELETE FROM dlc", [])?;
    for dlc in dlcs {
        conn.execute(
            "INSERT INTO dlc (id, name, resource_name, target_gender) VALUES (?1, ?2, ?3, ?4)",
            params![dlc.id, dlc.name, dlc.resource_name, target_gender_str(dlc.target_gender)],
        )?;
    }
    Ok(())
}

pub fn read_dlcs(conn: &Connection) -> AppResult<Vec<DlcInfo>> {
    let mut stmt = conn.prepare("SELECT id, name, resource_name, target_gender FROM dlc")?;
    let rows = stmt.query_map([], |row| {
        Ok(DlcInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            resource_name: row.get(2)?,
            target_gender: parse_target_gender(&row.get::<_, String>(3)?),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn replace_items(conn: &mut Connection, items: &[ClothingDrawable]) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM clothing_item", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO clothing_item
             (id, drawable_id, item_type, component_id, gender, dlc, name, category, description,
              tags, lod, mesh, textures, hashes, metadata, thumbnail, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        )?;
        for item in items {
            stmt.execute(params![
                item.id,
                item.drawable_id,
                item_type_str(item.item_type),
                item.component_id,
                gender_str(item.gender),
                item.dlc,
                item.name,
                item.category,
                item.description,
                serde_json::to_string(&item.tags)?,
                lod_str(item.lod),
                item.mesh.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&item.textures)?,
                serde_json::to_string(&item.hashes)?,
                serde_json::to_string(&item.metadata)?,
                item.thumbnail,
                item.created_at,
                item.updated_at,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn read_items(conn: &Connection) -> AppResult<Vec<ClothingDrawable>> {
    let mut stmt = conn.prepare(
        "SELECT id, drawable_id, item_type, component_id, gender, dlc, name, category, description,
                tags, lod, mesh, textures, hashes, metadata, thumbnail, created_at, updated_at
         FROM clothing_item",
    )?;
    let rows = stmt.query_map([], |row| {
        let mesh_json: Option<String> = row.get(11)?;
        let tags_json: String = row.get(9)?;
        let textures_json: String = row.get(12)?;
        let hashes_json: String = row.get(13)?;
        let metadata_json: String = row.get(14)?;

        Ok(ClothingDrawable {
            id: row.get(0)?,
            drawable_id: row.get(1)?,
            item_type: parse_item_type(&row.get::<_, String>(2)?),
            component_id: row.get(3)?,
            gender: parse_gender(&row.get::<_, String>(4)?),
            dlc: row.get(5)?,
            name: row.get(6)?,
            category: row.get(7)?,
            description: row.get(8)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            lod: parse_lod(&row.get::<_, String>(10)?),
            mesh: mesh_json.and_then(|s| serde_json::from_str(&s).ok()),
            textures: serde_json::from_str(&textures_json).unwrap_or_default(),
            hashes: serde_json::from_str(&hashes_json).unwrap_or_default(),
            metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
            thumbnail: row.get(15)?,
            created_at: row.get(16)?,
            updated_at: row.get(17)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BinaryAssetRef, TextureVariant};
    use std::collections::HashMap;

    fn sample_item() -> ClothingDrawable {
        ClothingDrawable {
            id: "item-1".into(),
            drawable_id: 0,
            item_type: ItemType::Component,
            component_id: 3,
            gender: Gender::Male,
            dlc: "dlc-1".into(),
            name: "Test Jacket".into(),
            category: "Jackets".into(),
            description: "A jacket".into(),
            tags: vec!["summer".into()],
            lod: LodLevel::High,
            mesh: Some(BinaryAssetRef {
                file_name: "uppr_000_u.ydd".into(),
                relative_path: "stream/uppr_000_u.ydd".into(),
                size_bytes: 1024,
                sha256: "abc".into(),
                present: true,
            }),
            textures: vec![TextureVariant {
                texture_id: 0,
                name: "default".into(),
                file: None,
            }],
            hashes: HashMap::new(),
            metadata: HashMap::new(),
            thumbnail: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn round_trips_project_dlcs_and_items() {
        let mut conn = open(":memory:").unwrap();

        let project = Project {
            id: "proj-1".into(),
            name: "Test Project".into(),
            db_path: String::new(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            dlcs: vec![],
            settings: ProjectSettings {
                resource_name: "test_pack".into(),
                framework: Framework::Standalone,
                fx_server_min_version: "6497".into(),
            },
        };
        write_project(&conn, &project).unwrap();

        let dlcs = vec![DlcInfo {
            id: "dlc-1".into(),
            name: "Main DLC".into(),
            resource_name: "mp_test".into(),
            target_gender: DlcTargetGender::Unisex,
        }];
        replace_dlcs(&conn, &dlcs).unwrap();

        let items = vec![sample_item()];
        replace_items(&mut conn, &items).unwrap();

        let loaded_project = read_project(&conn).unwrap().unwrap();
        assert_eq!(loaded_project.name, "Test Project");

        let loaded_dlcs = read_dlcs(&conn).unwrap();
        assert_eq!(loaded_dlcs.len(), 1);
        assert_eq!(loaded_dlcs[0].resource_name, "mp_test");

        let loaded_items = read_items(&conn).unwrap();
        assert_eq!(loaded_items.len(), 1);
        assert_eq!(loaded_items[0].name, "Test Jacket");
        assert_eq!(loaded_items[0].tags, vec!["summer".to_string()]);
        assert!(loaded_items[0].mesh.is_some());
    }
}
