//! Generic reader for FiveM's `.meta`/`.xml` metadata files (e.g. `dlc.meta`,
//! `contentunits.meta`, `shop_ped_component.meta`, `carcols.meta`).
//!
//! These are plain XML (the RAGE binary `.ymt`/`.ymap` equivalents, exposed
//! by FiveM in human-readable form), but every resource author's schema
//! usage differs enough — and GTA's own meta schemas are large and only
//! partially documented — that hardcoding field-level assumptions here would
//! risk silently mis-mapping data. Instead this module flattens the document
//! into a generic `tag.path -> text` / `tag.path@attr -> value` map that the
//! importer stores as free-form metadata, and preserves the original file
//! byte-for-byte for export. Deep, schema-aware mapping of specific FiveM
//! meta schemas onto structured clothing fields is tracked as Phase 2 work
//! (see docs/FILE_FORMATS.md).

use crate::error::AppResult;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::collections::HashMap;

/// Flattens an XML document into `path -> value` pairs. Repeated sibling
/// tags are suffixed with an index (`Item.1.Name`) so no data is silently
/// overwritten.
pub fn flatten(xml: &str) -> AppResult<HashMap<String, String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut out = HashMap::new();
    let mut path: Vec<String> = Vec::new();
    let mut sibling_counts: Vec<HashMap<String, usize>> = vec![HashMap::new()];
    let mut buf = Vec::new();

    fn next_segment(sibling_counts: &mut [HashMap<String, usize>], name: &str) -> String {
        let count = sibling_counts
            .last_mut()
            .unwrap()
            .entry(name.to_string())
            .and_modify(|c| *c += 1)
            .or_insert(0);
        if *count == 0 {
            name.to_string()
        } else {
            format!("{name}.{count}")
        }
    }

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Eof => break,
            Event::Start(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let segment = next_segment(&mut sibling_counts, &name);
                path.push(segment);

                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    if let Ok(value) = attr.unescape_value() {
                        out.insert(format!("{}@{}", path.join("."), key), value.to_string());
                    }
                }

                sibling_counts.push(HashMap::new());
            }
            Event::Empty(e) => {
                // Self-closing tags (<tag/>) never emit a matching End event,
                // so their scope must not be pushed onto the shared stacks.
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let segment = next_segment(&mut sibling_counts, &name);
                let element_path = if path.is_empty() {
                    segment
                } else {
                    format!("{}.{}", path.join("."), segment)
                };
                for attr in e.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    if let Ok(value) = attr.unescape_value() {
                        out.insert(format!("{element_path}@{key}"), value.to_string());
                    }
                }
            }
            Event::Text(t) => {
                let text = t.unescape().unwrap_or_default().trim().to_string();
                if !text.is_empty() && !path.is_empty() {
                    out.insert(path.join("."), text);
                }
            }
            Event::End(_) => {
                path.pop();
                sibling_counts.pop();
            }
            _ => {}
        }
    }

    Ok(out)
}

/// Returns the root element name, used to label a `.meta`/`.xml` file kind
/// (e.g. `CDLCData`, `CVehicleModelInfoVarGlobal`) without asserting
/// anything about its internal schema.
pub fn root_element_name(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf).ok()? {
            Event::Eof => return None,
            Event::Start(e) | Event::Empty(e) => {
                return Some(String::from_utf8_lossy(e.name().as_ref()).to_string());
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattens_simple_elements_and_attributes() {
        let xml = r#"<Root><Item id="1"><Name>Jacket</Name></Item></Root>"#;
        let map = flatten(xml).unwrap();
        assert_eq!(map.get("Root.Item.Name").map(String::as_str), Some("Jacket"));
        assert_eq!(map.get("Root.Item@id").map(String::as_str), Some("1"));
    }

    #[test]
    fn disambiguates_repeated_sibling_tags() {
        let xml = r#"<Root><Item><Name>First</Name></Item><Item><Name>Second</Name></Item></Root>"#;
        let map = flatten(xml).unwrap();
        assert_eq!(map.get("Root.Item.Name").map(String::as_str), Some("First"));
        assert_eq!(map.get("Root.Item.1.Name").map(String::as_str), Some("Second"));
    }

    #[test]
    fn self_closing_siblings_do_not_corrupt_later_indexing() {
        let xml = r#"<Root><Item id="a"/><Item id="b"/><Trailer><Name>X</Name></Trailer></Root>"#;
        let map = flatten(xml).unwrap();
        assert_eq!(map.get("Root.Item@id").map(String::as_str), Some("a"));
        assert_eq!(map.get("Root.Item.1@id").map(String::as_str), Some("b"));
        assert_eq!(map.get("Root.Trailer.Name").map(String::as_str), Some("X"));
    }

    #[test]
    fn reads_root_element_name() {
        let xml = r#"<CDLCData><contentChangeSets/></CDLCData>"#;
        assert_eq!(root_element_name(xml).as_deref(), Some("CDLCData"));
    }
}
