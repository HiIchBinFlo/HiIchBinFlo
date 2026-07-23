use crate::error::AppResult;
use crate::models::BinaryAssetRef;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

pub fn sha256_of_file(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Builds a `BinaryAssetRef` for a file that is known to exist on disk.
pub fn asset_ref(absolute_path: &Path, relative_path: &str) -> AppResult<BinaryAssetRef> {
    let metadata = std::fs::metadata(absolute_path)?;
    Ok(BinaryAssetRef {
        file_name: absolute_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        relative_path: relative_path.replace('\\', "/"),
        size_bytes: metadata.len(),
        sha256: sha256_of_file(absolute_path)?,
        present: true,
    })
}

/// Re-verifies an asset ref against disk (used when loading a saved project,
/// where files may have moved or been deleted outside the app).
pub fn revalidate(asset: &mut BinaryAssetRef, base_dir: &Path) {
    let path = base_dir.join(&asset.relative_path);
    asset.present = path.is_file();
}
