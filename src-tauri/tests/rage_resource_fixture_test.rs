//! Cross-validates `parsers::rage_resource` against a REAL RSC7 file — not a
//! hand-crafted byte array, but an actual resource built and saved by
//! CodeWalker.Core (via `sidecar/CodeWalkerBridge`'s `gen-test-ytd` command)
//! and reloadable by that same reference implementation. This is the closest
//! thing to ground truth available without a Rockstar-produced sample file
//! (see docs/FILE_FORMATS.md for why no such file ships with this repo).
//!
//! Regenerate the fixture with:
//!   cd sidecar/CodeWalkerBridge && dotnet run -- gen-test-ytd \
//!     ../../src-tauri/tests/fixtures/sample.ytd

use fivem_clothing_studio_lib::parsers::rage_resource;

const FIXTURE_BYTES: &[u8] = include_bytes!("fixtures/sample.ytd");

#[test]
fn parses_the_real_codewalker_generated_fixture() {
    let resource = rage_resource::decode(FIXTURE_BYTES).expect("fixture should decode cleanly");

    assert_eq!(resource.header.version, 13, "YTD resource version, confirmed via the sidecar");
    assert_eq!(resource.virtual_data.len(), 8192);
    assert_eq!(resource.physical_data.len(), 8192);
}

#[test]
fn fixture_is_reported_as_a_valid_resource() {
    assert!(rage_resource::is_valid_resource(FIXTURE_BYTES));
}

#[test]
fn truncated_fixture_is_reported_invalid() {
    let truncated = &FIXTURE_BYTES[..FIXTURE_BYTES.len() - 10];
    assert!(!rage_resource::is_valid_resource(truncated));
}

#[test]
fn corrupted_header_is_rejected() {
    let mut corrupted = FIXTURE_BYTES.to_vec();
    corrupted[0] = 0; // clobber the RSC7 magic
    assert!(!rage_resource::is_valid_resource(&corrupted));
}
