//! The write-side counterpart to `texture_decode.rs`: turns edited RGBA8
//! pixels (from the Design Studio's recolor/upload/paint features) back into
//! a real, valid `.dds` file that `codewalker-bridge`'s `replace-texture`
//! command can hand to `DDSIO.GetTexture` (CodeWalker.Core's own
//! DDS-to-Texture path — the same one its texture-import feature uses).
//!
//! Deliberately writes an *uncompressed* 32bpp DDS (`D3DFMT_A8R8G8B8`), not a
//! BC-recompressed one: encoding to BC1/3/7 needs a block-compression
//! encoder this project doesn't have (`texture2ddecoder` only decodes), and
//! guessing at one risked shipping a broken/artifacted compressor. The
//! honest tradeoff is a larger in-game texture than a hand-tuned BC7 export
//! would produce — correct pixels over a smaller but unverified file. See
//! docs/FILE_FORMATS.md.

use crate::error::{AppError, AppResult};
use ddsfile::{D3DFormat, Dds, NewD3dParams};

/// Encodes tightly-packed RGBA8 pixels into an uncompressed `D3DFMT_A8R8G8B8`
/// DDS file. Byte order matches `texture_decode.rs::decode_uncompressed_32bpp`'s
/// BGRA-swap branch exactly, so `decode_dds_to_rgba(encode_rgba_to_dds(x)) == x`
/// (see the round-trip test below).
pub fn encode_rgba_to_dds(width: u32, height: u32, rgba: &[u8]) -> AppResult<Vec<u8>> {
    let pixel_count = (width as usize) * (height as usize);
    let needed = pixel_count * 4;
    if rgba.len() != needed {
        return Err(AppError(format!(
            "RGBA buffer has {} bytes, expected {needed} for a {width}x{height} image.",
            rgba.len()
        )));
    }

    let mut bgra = vec![0u8; needed];
    for i in 0..pixel_count {
        let px = &rgba[i * 4..i * 4 + 4];
        bgra[i * 4] = px[2]; // B
        bgra[i * 4 + 1] = px[1]; // G
        bgra[i * 4 + 2] = px[0]; // R
        bgra[i * 4 + 3] = px[3]; // A
    }

    let mut dds = Dds::new_d3d(NewD3dParams {
        height,
        width,
        depth: None,
        format: D3DFormat::A8R8G8B8,
        mipmap_levels: None,
        caps2: None,
    })
    .map_err(|e| AppError(format!("Failed to build DDS header: {e}")))?;
    dds.data.clear();
    dds.data.extend_from_slice(&bgra);

    let mut out = Vec::new();
    dds.write(&mut out).map_err(|e| AppError(format!("Failed to write DDS: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::texture_decode::decode_dds_to_rgba;

    #[test]
    fn round_trips_through_the_real_decoder() {
        let rgba: Vec<u8> = vec![
            255, 0, 0, 255, // red
            0, 255, 0, 255, // green
            0, 0, 255, 128, // blue, half alpha
            10, 20, 30, 255, // arbitrary
        ];
        let dds_bytes = encode_rgba_to_dds(2, 2, &rgba).expect("should encode");
        let decoded = decode_dds_to_rgba(&dds_bytes).expect("should decode what we just encoded");

        assert_eq!(decoded.width, 2);
        assert_eq!(decoded.height, 2);
        assert_eq!(decoded.rgba, rgba);
    }

    #[test]
    fn rejects_a_buffer_of_the_wrong_size() {
        let err = encode_rgba_to_dds(2, 2, &[0, 0, 0, 255]).unwrap_err();
        assert!(err.0.contains("expected"));
    }
}
