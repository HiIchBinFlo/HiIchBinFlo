//! Reader for the RSC7 container format that wraps every GTA V/RAGE binary
//! resource (`.ydd`, `.ytd`, `.yft`, ...).
//!
//! This module deliberately does NOT decode the object graph inside the
//! container (Drawable geometry, TextureDictionary entries, etc.) — that
//! requires resolving virtual/physical pointer references, which
//! `codewalker-bridge` (the .NET sidecar wrapping the real, proven
//! CodeWalker.Core library) does instead. See docs/FILE_FORMATS.md for why.
//!
//! What this module DOES do, natively and dependency-free: read the 16-byte
//! RSC7 header, compute the virtual/physical buffer sizes from its bit-packed
//! flags fields, and decompress the DEFLATE-compressed payload into those two
//! flat buffers — enough to answer "is this actually a valid, uncorrupted
//! RAGE resource" without shelling out to the sidecar, and a real, useful,
//! independently-verifiable building block.
//!
//! The flags→size formula and the "raw DEFLATE, not zlib-wrapped" detail
//! were empirically verified against a real RSC7 file produced by
//! CodeWalker.Core itself (see `src-tauri/tests/fixtures/sample.ytd` and
//! `rage_resource_fixture_test.rs`), not guessed from documentation alone.

use flate2::read::DeflateDecoder;
use std::io::Read;
use thiserror::Error;

pub const RSC7_MAGIC: u32 = 0x3743_5352; // "RSC7" read little-endian as u32
const HEADER_LEN: usize = 16;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RageResourceError {
    #[error("file is too short to contain an RSC7 header ({0} bytes, need at least {HEADER_LEN})")]
    TooShort(usize),
    #[error("not an RSC7 resource (magic was 0x{0:08X}, expected 0x{RSC7_MAGIC:08X})")]
    BadMagic(u32),
    #[error("failed to decompress resource payload: {0}")]
    Decompress(String),
    #[error(
        "decompressed payload length ({actual}) does not match the size computed from the \
         header's flags fields (expected {expected} = {virtual_size} virtual + {physical_size} \
         physical); the file is likely corrupt or truncated"
    )]
    SizeMismatch {
        expected: u64,
        actual: u64,
        virtual_size: u64,
        physical_size: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RageResourceHeader {
    pub version: u32,
    pub system_flags: u32,
    pub graphics_flags: u32,
}

impl RageResourceHeader {
    pub fn parse(bytes: &[u8]) -> Result<Self, RageResourceError> {
        if bytes.len() < HEADER_LEN {
            return Err(RageResourceError::TooShort(bytes.len()));
        }
        let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
        if magic != RSC7_MAGIC {
            return Err(RageResourceError::BadMagic(magic));
        }
        Ok(Self {
            version: u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            system_flags: u32::from_le_bytes(bytes[8..12].try_into().unwrap()),
            graphics_flags: u32::from_le_bytes(bytes[12..16].try_into().unwrap()),
        })
    }

    pub fn virtual_size(&self) -> u64 {
        size_from_flags(self.system_flags)
    }

    pub fn physical_size(&self) -> u64 {
        size_from_flags(self.graphics_flags)
    }
}

/// The RAGE resource page-size bit-packing scheme: a 32-bit flags value
/// encodes a base block size (bits 0-3, `0x200 << shift`) and nine
/// independently-sized bit fields (`s0..s8`) that each contribute a multiple
/// of `baseSize * 2^k` to the total buffer size. Verified byte-for-byte
/// against CodeWalker.Core's own implementation and cross-checked against a
/// real generated fixture (see the fixture test in this crate).
pub fn size_from_flags(flags: u32) -> u64 {
    let s0 = (flags >> 27) & 0x1;
    let s1 = ((flags >> 26) & 0x1) << 1;
    let s2 = ((flags >> 25) & 0x1) << 2;
    let s3 = ((flags >> 24) & 0x1) << 3;
    let s4 = ((flags >> 17) & 0x7F) << 4;
    let s5 = ((flags >> 11) & 0x3F) << 5;
    let s6 = ((flags >> 7) & 0xF) << 6;
    let s7 = ((flags >> 5) & 0x3) << 7;
    let s8 = ((flags >> 4) & 0x1) << 8;
    let ss = flags & 0xF;

    let base_size: u64 = 0x200u64 << ss;
    let units = (s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8) as u64;
    base_size * units
}

#[derive(Debug, Clone)]
pub struct RageResource {
    pub header: RageResourceHeader,
    pub virtual_data: Vec<u8>,
    pub physical_data: Vec<u8>,
}

/// Parses an RSC7 header and decompresses its payload into virtual/physical
/// buffers, validating the decompressed length against the header's own
/// declared sizes. An `Err` here reliably means the file is not a valid,
/// intact RAGE resource — this is real corruption/format detection, not a
/// heuristic.
pub fn decode(bytes: &[u8]) -> Result<RageResource, RageResourceError> {
    let header = RageResourceHeader::parse(bytes)?;
    let payload = &bytes[HEADER_LEN..];

    let mut decoder = DeflateDecoder::new(payload);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| RageResourceError::Decompress(e.to_string()))?;

    let virtual_size = header.virtual_size();
    let physical_size = header.physical_size();
    let expected = virtual_size + physical_size;
    let actual = decompressed.len() as u64;
    if actual != expected {
        return Err(RageResourceError::SizeMismatch {
            expected,
            actual,
            virtual_size,
            physical_size,
        });
    }

    let virtual_data = decompressed[..virtual_size as usize].to_vec();
    let physical_data = decompressed[virtual_size as usize..].to_vec();

    Ok(RageResource {
        header,
        virtual_data,
        physical_data,
    })
}

/// Quick structural check for import scanning / validation: is this a
/// well-formed, uncorrupted RSC7 resource? Does not care about the specific
/// object graph inside (Drawable vs TextureDictionary vs anything else).
pub fn is_valid_resource(bytes: &[u8]) -> bool {
    decode(bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_input() {
        let err = RageResourceHeader::parse(&[0u8; 4]).unwrap_err();
        assert_eq!(err, RageResourceError::TooShort(4));
    }

    #[test]
    fn rejects_bad_magic() {
        let bytes = [0u8; 16];
        let err = RageResourceHeader::parse(&bytes).unwrap_err();
        assert_eq!(err, RageResourceError::BadMagic(0));
    }

    #[test]
    fn size_from_flags_matches_empirically_verified_fixture_values() {
        // From src-tauri/tests/fixtures/sample.ytd: systemFlags=0x00020000,
        // graphicsFlags=0xD0020000, both computed (and independently
        // confirmed via decompression) to be exactly 8192 bytes each.
        assert_eq!(size_from_flags(0x0002_0000), 8192);
        assert_eq!(size_from_flags(0xD002_0000), 8192);
    }

    #[test]
    fn size_from_flags_zero_is_zero() {
        assert_eq!(size_from_flags(0), 0);
    }
}
