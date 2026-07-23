//! Cross-validates the BC1 decode path against a real DDS file, extracted by
//! `codewalker-bridge` (via `DDSIO.GetDDSFile`, the real CodeWalker.Core
//! writer) from `tests/fixtures/sample.ytd`. This exercises the full chain
//! end to end: DDS header parsing (`ddsfile`) -> BC1 block decode
//! (`texture2ddecoder`) -> RGBA -> PNG, against bytes produced by the
//! reference implementation rather than hand-crafted test data alone.
//!
//! Regenerate with:
//!   cd sidecar/CodeWalkerBridge && dotnet run -- inspect-ytd \
//!     ../../src-tauri/tests/fixtures/sample.ytd --extract-dir /tmp/dds-extract
//!   cp /tmp/dds-extract/test_diffuse.dds ../../src-tauri/tests/fixtures/sample_bc1.dds

use fivem_clothing_studio_lib::texture_decode;

const FIXTURE_BYTES: &[u8] = include_bytes!("fixtures/sample_bc1.dds");

#[test]
fn decodes_a_real_bc1_dds_produced_by_the_sidecar() {
    let decoded = texture_decode::decode_dds_to_rgba(FIXTURE_BYTES).expect("should decode");
    assert_eq!(decoded.width, 4);
    assert_eq!(decoded.height, 4);
    assert_eq!(decoded.rgba.len(), 4 * 4 * 4);
}

#[test]
fn encodes_the_real_fixture_as_a_valid_png() {
    let png = texture_decode::decode_dds_to_png(FIXTURE_BYTES).expect("should encode");
    assert_eq!(&png[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
}
