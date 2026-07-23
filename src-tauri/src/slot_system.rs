//! Authoritative slot allocator — the Rust-side mirror of `src/lib/slotSystem.ts`.
//!
//! The frontend keeps its own copy for instant UI feedback, but every
//! import/export/save round-trip goes through this implementation, which is
//! the source of truth: once a numeric drawable/texture id is assigned it is
//! never reassigned, reused for a *different* item, or shifted by deletions
//! elsewhere in the same track. See `src/lib/slotSystem.ts` for the full
//! rationale — the two implementations are kept in lockstep intentionally.

use std::collections::HashMap;

pub type SlotTrack = Vec<Option<String>>;

#[derive(Debug, Default, Clone)]
pub struct SlotTable {
    tracks: HashMap<String, SlotTrack>,
}

#[derive(Debug, thiserror::Error)]
pub enum SlotError {
    #[error("slot {id} in track \"{key}\" is already occupied by \"{existing}\" (requested for \"{requested}\")")]
    Conflict {
        key: String,
        id: u32,
        existing: String,
        requested: String,
    },
    #[error("cannot release slot {id} in track \"{key}\": out of range")]
    OutOfRange { key: String, id: u32 },
}

impl SlotTable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn key(gender: &str, item_type: &str, component_id: u32) -> String {
        format!("{gender}:{item_type}:{component_id}")
    }

    fn track_mut(&mut self, key: &str) -> &mut SlotTrack {
        self.tracks.entry(key.to_string()).or_default()
    }

    /// Allocates the lowest free/reserved id, or appends a new one.
    pub fn allocate(&mut self, key: &str, owner_id: &str) -> u32 {
        let track = self.track_mut(key);
        if let Some(free_index) = track.iter().position(|slot| slot.is_none()) {
            track[free_index] = Some(owner_id.to_string());
            free_index as u32
        } else {
            track.push(Some(owner_id.to_string()));
            (track.len() - 1) as u32
        }
    }

    /// Reserves an EXACT id coming from an imported source pack.
    pub fn reserve_exact(&mut self, key: &str, id: u32, owner_id: &str) -> Result<(), SlotError> {
        let track = self.track_mut(key);
        while track.len() <= id as usize {
            track.push(None);
        }
        match &track[id as usize] {
            Some(existing) if existing != owner_id => Err(SlotError::Conflict {
                key: key.to_string(),
                id,
                existing: existing.clone(),
                requested: owner_id.to_string(),
            }),
            _ => {
                track[id as usize] = Some(owner_id.to_string());
                Ok(())
            }
        }
    }

    /// Frees a slot. The track is never truncated — the id becomes a
    /// permanent hole that a later `allocate` call may reuse.
    pub fn release(&mut self, key: &str, id: u32) -> Result<(), SlotError> {
        let track = self.track_mut(key);
        if (id as usize) >= track.len() {
            return Err(SlotError::OutOfRange {
                key: key.to_string(),
                id,
            });
        }
        track[id as usize] = None;
        Ok(())
    }

    pub fn owner_of(&self, key: &str, id: u32) -> Option<&str> {
        self.tracks
            .get(key)
            .and_then(|track| track.get(id as usize))
            .and_then(|slot| slot.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocates_sequential_ids() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("male", "component", 3);
        assert_eq!(table.allocate(&key, "a"), 0);
        assert_eq!(table.allocate(&key, "b"), 1);
        assert_eq!(table.allocate(&key, "c"), 2);
    }

    #[test]
    fn deleting_a_middle_id_leaves_a_permanent_hole() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("male", "component", 3);
        for owner in ["a", "b", "c", "d", "e"] {
            table.allocate(&key, owner);
        }
        table.release(&key, 2).unwrap();

        assert_eq!(table.owner_of(&key, 2), None);
        assert_eq!(table.owner_of(&key, 3), Some("d"));
        assert_eq!(table.owner_of(&key, 4), Some("e"));
    }

    #[test]
    fn reuses_lowest_free_slot() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("male", "component", 3);
        for owner in ["a", "b", "c"] {
            table.allocate(&key, owner);
        }
        table.release(&key, 1).unwrap();
        let id = table.allocate(&key, "d");
        assert_eq!(id, 1);
        assert_eq!(table.owner_of(&key, 0), Some("a"));
        assert_eq!(table.owner_of(&key, 2), Some("c"));
    }

    #[test]
    fn reserve_exact_preserves_imported_ids() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("female", "prop", 0);
        table.reserve_exact(&key, 7, "hat-1").unwrap();
        assert_eq!(table.owner_of(&key, 7), Some("hat-1"));
        for id in 0..7 {
            assert_eq!(table.owner_of(&key, id), None);
        }
    }

    #[test]
    fn reserve_exact_conflict_is_rejected() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("male", "component", 3);
        table.reserve_exact(&key, 0, "a").unwrap();
        let err = table.reserve_exact(&key, 0, "b").unwrap_err();
        assert!(matches!(err, SlotError::Conflict { .. }));
    }

    #[test]
    fn release_out_of_range_is_rejected() {
        let mut table = SlotTable::new();
        let key = SlotTable::key("male", "component", 3);
        let err = table.release(&key, 0).unwrap_err();
        assert!(matches!(err, SlotError::OutOfRange { .. }));
    }

    #[test]
    fn tracks_are_independent_per_gender_and_component() {
        let mut table = SlotTable::new();
        let male_torso = SlotTable::key("male", "component", 3);
        let female_torso = SlotTable::key("female", "component", 3);
        table.allocate(&male_torso, "m1");
        table.allocate(&female_torso, "f1");
        table.allocate(&male_torso, "m2");
        assert_eq!(table.owner_of(&male_torso, 1), Some("m2"));
        assert_eq!(table.owner_of(&female_torso, 1), None);
    }
}
