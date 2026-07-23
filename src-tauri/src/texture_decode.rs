//! Decodes a standard `.dds` file (as extracted by the codewalker-bridge
//! sidecar via `DDSIO.GetDDSFile`) into RGBA pixels and re-encodes them as
//! PNG — entirely in pure Rust, no OS imaging APIs involved, so this stays
//! cross-platform-safe (see `sidecar/README.md` for why that mattered for
//! the sidecar itself).
//!
//! Only decodes the top-level (mip 0) image for now — enough for a texture
//! viewer and thumbnails; a mip-level selector is a natural follow-up, not
//! implemented here yet.

use crate::error::{AppError, AppResult};
use ddsfile::{D3DFormat, Dds, DxgiFormat};
use std::io::Cursor;

#[derive(Debug)]
pub struct DecodedTexture {
    pub width: u32,
    pub height: u32,
    /// Tightly packed RGBA8 pixels, width * height * 4 bytes.
    pub rgba: Vec<u8>,
}

/// Converts texture2ddecoder's packed-u32 pixel buffer (byte order B,G,R,A
/// per pixel — see `texture2ddecoder::color::color`) into a flat RGBA8 byte
/// buffer.
fn u32_buffer_to_rgba_bytes(buffer: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(buffer.len() * 4);
    for &pixel in buffer {
        let [b, g, r, a] = pixel.to_le_bytes();
        out.extend_from_slice(&[r, g, b, a]);
    }
    out
}

pub fn decode_dds_to_rgba(dds_bytes: &[u8]) -> AppResult<DecodedTexture> {
    let dds = Dds::read(Cursor::new(dds_bytes))
        .map_err(|e| AppError(format!("Failed to parse DDS header: {e}")))?;

    let width = dds.get_width();
    let height = dds.get_height();
    let main_size = dds
        .get_main_texture_size()
        .ok_or_else(|| AppError("DDS file has no usable texture data.".to_string()))?
        as usize;
    let data = dds
        .get_data(0)
        .map_err(|e| AppError(format!("Failed to read DDS pixel data: {e}")))?;
    let mip0 = &data[..main_size.min(data.len())];

    let pixel_count = (width as usize) * (height as usize);
    let mut buffer = vec![0u32; pixel_count];

    let dxgi = dds.get_dxgi_format();
    let d3d = dds.get_d3d_format();

    let decode_result = match (dxgi, d3d) {
        (Some(DxgiFormat::BC1_UNorm | DxgiFormat::BC1_UNorm_sRGB), _) | (_, Some(D3DFormat::DXT1)) => {
            texture2ddecoder::decode_bc1(mip0, width as usize, height as usize, &mut buffer)
        }
        (Some(DxgiFormat::BC2_UNorm | DxgiFormat::BC2_UNorm_sRGB), _) | (_, Some(D3DFormat::DXT3)) => {
            texture2ddecoder::decode_bc2(mip0, width as usize, height as usize, &mut buffer)
        }
        (Some(DxgiFormat::BC3_UNorm | DxgiFormat::BC3_UNorm_sRGB), _) | (_, Some(D3DFormat::DXT5)) => {
            texture2ddecoder::decode_bc3(mip0, width as usize, height as usize, &mut buffer)
        }
        (Some(DxgiFormat::BC4_UNorm | DxgiFormat::BC4_SNorm | DxgiFormat::BC4_Typeless), _) => {
            texture2ddecoder::decode_bc4(mip0, width as usize, height as usize, &mut buffer)
        }
        (Some(DxgiFormat::BC5_UNorm | DxgiFormat::BC5_SNorm | DxgiFormat::BC5_Typeless), _) => {
            texture2ddecoder::decode_bc5(mip0, width as usize, height as usize, &mut buffer)
        }
        (Some(DxgiFormat::BC7_UNorm | DxgiFormat::BC7_UNorm_sRGB | DxgiFormat::BC7_Typeless), _) => {
            texture2ddecoder::decode_bc7(mip0, width as usize, height as usize, &mut buffer)
        }
        _ => {
            // Uncompressed 32bpp formats (A8R8G8B8/A8B8G8R8/X8R8G8B8): copy directly.
            return decode_uncompressed_32bpp(mip0, width, height, dxgi, d3d);
        }
    };

    decode_result.map_err(|e| AppError(format!("Failed to decode compressed texture data: {e}")))?;

    Ok(DecodedTexture {
        width,
        height,
        rgba: u32_buffer_to_rgba_bytes(&buffer),
    })
}

fn decode_uncompressed_32bpp(
    data: &[u8],
    width: u32,
    height: u32,
    dxgi: Option<DxgiFormat>,
    d3d: Option<D3DFormat>,
) -> AppResult<DecodedTexture> {
    let pixel_count = (width as usize) * (height as usize);
    let needed = pixel_count * 4;
    if data.len() < needed {
        return Err(AppError(format!(
            "Uncompressed texture data too short: have {} bytes, need {needed}.",
            data.len()
        )));
    }

    // BGRA byte order (D3DFMT_A8R8G8B8 / DXGI B8G8R8A8) is the common case for
    // GTA's uncompressed textures; swap to RGBA. A8B8G8R8/R8G8B8A8 variants are
    // already in the right order.
    let is_already_rgba = matches!(dxgi, Some(DxgiFormat::R8G8B8A8_UNorm | DxgiFormat::R8G8B8A8_UNorm_sRGB))
        || matches!(d3d, Some(D3DFormat::A8B8G8R8));

    let mut rgba = vec![0u8; needed];
    if is_already_rgba {
        rgba.copy_from_slice(&data[..needed]);
    } else {
        for i in 0..pixel_count {
            let px = &data[i * 4..i * 4 + 4];
            rgba[i * 4] = px[2]; // R
            rgba[i * 4 + 1] = px[1]; // G
            rgba[i * 4 + 2] = px[0]; // B
            rgba[i * 4 + 3] = px[3]; // A
        }
    }

    Ok(DecodedTexture { width, height, rgba })
}

pub fn encode_png(texture: &DecodedTexture) -> AppResult<Vec<u8>> {
    let image = image::RgbaImage::from_raw(texture.width, texture.height, texture.rgba.clone())
        .ok_or_else(|| AppError("Decoded pixel buffer does not match declared dimensions.".to_string()))?;

    let mut out = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| AppError(format!("Failed to encode PNG: {e}")))?;
    Ok(out)
}

pub fn decode_dds_to_png(dds_bytes: &[u8]) -> AppResult<Vec<u8>> {
    let decoded = decode_dds_to_rgba(dds_bytes)?;
    encode_png(&decoded)
}

/// Decodes and downsamples to a small PNG thumbnail (longest side <=
/// `max_size`), for the clothing grid's cards — storing the full-resolution
/// decode in every project item would bloat the SQLite project file, so this
/// exists as a distinct, deliberately small output.
pub fn decode_dds_to_png_thumbnail(dds_bytes: &[u8], max_size: u32) -> AppResult<Vec<u8>> {
    let decoded = decode_dds_to_rgba(dds_bytes)?;
    let image = image::RgbaImage::from_raw(decoded.width, decoded.height, decoded.rgba)
        .ok_or_else(|| AppError("Decoded pixel buffer does not match declared dimensions.".to_string()))?;
    let thumbnail = image::DynamicImage::ImageRgba8(image).thumbnail(max_size, max_size);

    let mut out = Vec::new();
    thumbnail
        .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| AppError(format!("Failed to encode thumbnail PNG: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a minimal, valid, uncompressed 2x2 BGRA DDS file in memory (no
    /// external dependency needed - this exercises the header parsing +
    /// uncompressed-path byte swap without needing a real BC-compressed
    /// sample). BC1-7 decode correctness relies on `texture2ddecoder` itself
    /// (a third-party crate) plus the DDS header parsing on `ddsfile` (also
    /// third-party) — both widely used, not reimplemented here.
    fn build_uncompressed_bgra_dds(width: u32, height: u32, pixels_bgra: &[u8]) -> Vec<u8> {
        use ddsfile::{AlphaMode, D3DFormat, Dds, NewD3dParams};
        let mut dds = Dds::new_d3d(NewD3dParams {
            height,
            width,
            depth: None,
            format: D3DFormat::A8R8G8B8,
            mipmap_levels: None,
            caps2: None,
        })
        .unwrap();
        dds.data.clear();
        dds.data.extend_from_slice(pixels_bgra);
        let _ = AlphaMode::Straight; // silence unused import if feature-gated differently across versions
        let mut out = Vec::new();
        dds.write(&mut out).unwrap();
        out
    }

    #[test]
    fn decodes_uncompressed_bgra_to_rgba() {
        // 2x2 image: red, green, blue, white, each as BGRA bytes.
        let pixels_bgra = [
            0, 0, 255, 255, // red   -> B=0 G=0 R=255 A=255
            0, 255, 0, 255, // green -> B=0 G=255 R=0 A=255
            255, 0, 0, 255, // blue  -> B=255 G=0 R=0 A=255
            255, 255, 255, 255, // white
        ];
        let dds_bytes = build_uncompressed_bgra_dds(2, 2, &pixels_bgra);

        let decoded = decode_dds_to_rgba(&dds_bytes).expect("should decode");
        assert_eq!(decoded.width, 2);
        assert_eq!(decoded.height, 2);
        assert_eq!(&decoded.rgba[0..4], &[255, 0, 0, 255]); // red pixel now R,G,B,A
        assert_eq!(&decoded.rgba[4..8], &[0, 255, 0, 255]); // green
        assert_eq!(&decoded.rgba[8..12], &[0, 0, 255, 255]); // blue
        assert_eq!(&decoded.rgba[12..16], &[255, 255, 255, 255]); // white
    }

    #[test]
    fn encodes_decoded_texture_as_valid_png() {
        let pixels_bgra = [0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255];
        let dds_bytes = build_uncompressed_bgra_dds(2, 2, &pixels_bgra);
        let decoded = decode_dds_to_rgba(&dds_bytes).unwrap();
        let png_bytes = encode_png(&decoded).unwrap();
        // PNG magic number.
        assert_eq!(&png_bytes[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn rejects_truncated_dds() {
        let err = decode_dds_to_rgba(&[1, 2, 3]).unwrap_err();
        assert!(err.0.contains("DDS header"));
    }

    #[test]
    fn thumbnail_is_downsampled_and_still_a_valid_png() {
        // 8x8 image, larger than the requested 4px thumbnail max.
        let mut pixels_bgra = Vec::new();
        for _ in 0..64 {
            pixels_bgra.extend_from_slice(&[10, 20, 30, 255]);
        }
        let dds_bytes = build_uncompressed_bgra_dds(8, 8, &pixels_bgra);
        let thumb_png = decode_dds_to_png_thumbnail(&dds_bytes, 4).unwrap();
        assert_eq!(&thumb_png[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        let decoded_thumb = image::load_from_memory(&thumb_png).unwrap();
        assert!(decoded_thumb.width() <= 4);
        assert!(decoded_thumb.height() <= 4);
    }
}
