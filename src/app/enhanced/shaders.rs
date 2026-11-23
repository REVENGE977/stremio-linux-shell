use std::{
    fs,
    path::{Path, PathBuf},
    process::{self, Command},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tracing::{info, warn};

const ANIME4K_RELEASE_ZIP_URL: &str =
    "https://github.com/bloc97/Anime4K/releases/download/v4.0.1/Anime4K_v4.0.zip";
const ANIME4K_RAW_SUBDIRS: &[&str] = &[
    "Restore",
    "Upscale",
    "Upscale+Denoise",
    "Experimental",
    "Others",
];
const ANIME4K_RAW_BASE: &str = "https://raw.githubusercontent.com/bloc97/Anime4K/master/glsl";
const FSRCNNX_RELEASE_BASE: &str = "https://github.com/igv/FSRCNN-TensorFlow/releases/download/1.1";
const ARTCNN_RAW_BASE: &str = "https://raw.githubusercontent.com/Artoriuz/ArtCNN/main/GLSL";

const CAS_SHARPEN_BALANCED_GLSL: &str = r#"//!DESC AMD FidelityFX CAS Sharpen (Balanced, 1:1 Native)
//!HOOK MAIN
//!BIND HOOKED

#define SHARPENING 0.55

vec4 hook() {
    vec4 center = HOOKED_tex(HOOKED_pos);
    vec3 a = HOOKED_texOff(vec2(-1.0, -1.0)).rgb;
    vec3 b = HOOKED_texOff(vec2( 0.0, -1.0)).rgb;
    vec3 c = HOOKED_texOff(vec2( 1.0, -1.0)).rgb;
    vec3 d = HOOKED_texOff(vec2(-1.0,  0.0)).rgb;
    vec3 e = center.rgb;
    vec3 f = HOOKED_texOff(vec2( 1.0,  0.0)).rgb;
    vec3 g = HOOKED_texOff(vec2(-1.0,  1.0)).rgb;
    vec3 h = HOOKED_texOff(vec2( 0.0,  1.0)).rgb;
    vec3 i = HOOKED_texOff(vec2( 1.0,  1.0)).rgb;

    vec3 mnRGB = min(min(min(d, e), min(f, b)), h);
    vec3 mnRGB2 = min(mnRGB, min(min(a, c), min(g, i)));
    mnRGB += mnRGB2;

    vec3 mxRGB = max(max(max(d, e), max(f, b)), h);
    vec3 mxRGB2 = max(mxRGB, max(max(a, c), max(g, i)));
    mxRGB += mxRGB2;

    vec3 rcpMRGB = vec3(1.0) / max(mxRGB, vec3(1e-5));
    vec3 ampRGB = clamp(min(mnRGB, 2.0 - mxRGB) * rcpMRGB, 0.0, 1.0);
    ampRGB = sqrt(ampRGB);

    float peak = 8.0 - 3.0 * SHARPENING;
    vec3 wRGB = -ampRGB / peak;
    vec3 rcpWeightRGB = vec3(1.0) / (1.0 + 4.0 * wRGB);

    vec3 sharpened = clamp(((b + d + f + h) * wRGB + e) * rcpWeightRGB, 0.0, 1.0);
    return vec4(sharpened, center.a);
}
"#;

const CAS_SHARPEN_STRONG_GLSL: &str = r#"//!DESC AMD FidelityFX CAS Sharpen (Strong, 1:1 Native)
//!HOOK MAIN
//!BIND HOOKED

#define SHARPENING 0.90

vec4 hook() {
    vec4 center = HOOKED_tex(HOOKED_pos);
    vec3 a = HOOKED_texOff(vec2(-1.0, -1.0)).rgb;
    vec3 b = HOOKED_texOff(vec2( 0.0, -1.0)).rgb;
    vec3 c = HOOKED_texOff(vec2( 1.0, -1.0)).rgb;
    vec3 d = HOOKED_texOff(vec2(-1.0,  0.0)).rgb;
    vec3 e = center.rgb;
    vec3 f = HOOKED_texOff(vec2( 1.0,  0.0)).rgb;
    vec3 g = HOOKED_texOff(vec2(-1.0,  1.0)).rgb;
    vec3 h = HOOKED_texOff(vec2( 0.0,  1.0)).rgb;
    vec3 i = HOOKED_texOff(vec2( 1.0,  1.0)).rgb;

    vec3 mnRGB = min(min(min(d, e), min(f, b)), h);
    vec3 mnRGB2 = min(mnRGB, min(min(a, c), min(g, i)));
    mnRGB += mnRGB2;

    vec3 mxRGB = max(max(max(d, e), max(f, b)), h);
    vec3 mxRGB2 = max(mxRGB, max(max(a, c), max(g, i)));
    mxRGB += mxRGB2;

    vec3 rcpMRGB = vec3(1.0) / max(mxRGB, vec3(1e-5));
    vec3 ampRGB = clamp(min(mnRGB, 2.0 - mxRGB) * rcpMRGB, 0.0, 1.0);
    ampRGB = sqrt(ampRGB);

    float peak = 8.0 - 3.0 * SHARPENING;
    vec3 wRGB = -ampRGB / peak;
    vec3 rcpWeightRGB = vec3(1.0) / (1.0 + 4.0 * wRGB);

    vec3 sharpened = clamp(((b + d + f + h) * wRGB + e) * rcpWeightRGB, 0.0, 1.0);
    return vec4(sharpened, center.a);
}
"#;

fn builtin_shader_source(file: &str) -> Option<&'static str> {
    match file {
        "CAS_Sharpen_Balanced.glsl" => Some(CAS_SHARPEN_BALANCED_GLSL),
        "CAS_Sharpen_Strong.glsl" => Some(CAS_SHARPEN_STRONG_GLSL),
        _ => None,
    }
}

pub struct ShaderPresetDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub tier: &'static str,
    pub description: &'static str,
    pub files: &'static [&'static str],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderPresetUiData {
    pub id: String,
    pub name: String,
    pub category: String,
    pub tier: String,
    pub description: String,
    pub installed: bool,
    pub file_count: usize,
}

pub const PRESETS: &[ShaderPresetDef] = &[
    ShaderPresetDef {
        id: "off",
        name: "Off (Default)",
        category: "Default",
        tier: "Off",
        description: "Disable GLSL upscaling shaders and use standard MPV scaling.",
        files: &[],
    },
    ShaderPresetDef {
        id: "cas-balanced",
        name: "AMD CAS Sharpen (Balanced)",
        category: "Sharpening (1:1)",
        tier: "Fast",
        description: "Contrast-adaptive sharpening that works at 1:1 native 1080p/4K without halos.",
        files: &["CAS_Sharpen_Balanced.glsl"],
    },
    ShaderPresetDef {
        id: "cas-strong",
        name: "AMD CAS Sharpen (Strong)",
        category: "Sharpening (1:1)",
        tier: "Fast",
        description: "Stronger contrast-adaptive sharpening at 1:1 native resolution for crisp detail.",
        files: &["CAS_Sharpen_Strong.glsl"],
    },
    ShaderPresetDef {
        id: "fsrcnnx-8-cas",
        name: "FSRCNNX x2 + CAS Sharpen",
        category: "Sharpening (1:1)",
        tier: "Fast",
        description: "Upscales low-res video (>1.3x) with FSRCNNX and sharpens native 1080p/4K with AMD CAS.",
        files: &["FSRCNNX_x2_8-0-4-1.glsl", "CAS_Sharpen_Balanced.glsl"],
    },
    ShaderPresetDef {
        id: "anime4k-a-fast",
        name: "Anime4K Mode A (Fast)",
        category: "Anime4K",
        tier: "Fast",
        description: "Optimized for most 1080p anime with compression artifacts; light GPU load.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_M.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_S.glsl",
        ],
    },
    ShaderPresetDef {
        id: "anime4k-a-hq",
        name: "Anime4K Mode A (HQ)",
        category: "Anime4K",
        tier: "HQ",
        description: "High-quality Mode A restoration and upscaling for mid/high-end GPUs.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_VL.glsl",
            "Anime4K_Upscale_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
    },
    ShaderPresetDef {
        id: "anime4k-b-fast",
        name: "Anime4K Mode B (Fast)",
        category: "Anime4K",
        tier: "Fast",
        description: "Softer restoration for clean/soft anime (720p/1080p) with minimal ringing.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_Soft_M.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_S.glsl",
        ],
    },
    ShaderPresetDef {
        id: "anime4k-b-hq",
        name: "Anime4K Mode B (HQ)",
        category: "Anime4K",
        tier: "HQ",
        description: "High-quality soft restoration for clean anime sources.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Restore_CNN_Soft_VL.glsl",
            "Anime4K_Upscale_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
    },
    ShaderPresetDef {
        id: "anime4k-c-fast",
        name: "Anime4K Mode C (Fast)",
        category: "Anime4K",
        tier: "Fast",
        description: "Upscale + denoise chain for noisy/low-bitrate anime; fast preset.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Upscale_Denoise_CNN_x2_M.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_S.glsl",
        ],
    },
    ShaderPresetDef {
        id: "anime4k-c-hq",
        name: "Anime4K Mode C (HQ)",
        category: "Anime4K",
        tier: "HQ",
        description: "High-quality upscale + denoise chain for noisy anime sources.",
        files: &[
            "Anime4K_Clamp_Highlights.glsl",
            "Anime4K_Upscale_Denoise_CNN_x2_VL.glsl",
            "Anime4K_AutoDownscalePre_x2.glsl",
            "Anime4K_AutoDownscalePre_x4.glsl",
            "Anime4K_Upscale_CNN_x2_M.glsl",
        ],
    },
    ShaderPresetDef {
        id: "fsrcnnx-8",
        name: "FSRCNNX x2 (Fast)",
        category: "FSRCNNX",
        tier: "Fast",
        description: "General-purpose 2x luma super-resolution shader (8-0-4-1, lightweight).",
        files: &["FSRCNNX_x2_8-0-4-1.glsl"],
    },
    ShaderPresetDef {
        id: "fsrcnnx-16",
        name: "FSRCNNX x2 (HQ)",
        category: "FSRCNNX",
        tier: "HQ",
        description: "Higher-accuracy 2x luma super-resolution shader (16-0-4-1) for movies & shows.",
        files: &["FSRCNNX_x2_16-0-4-1.glsl"],
    },
    ShaderPresetDef {
        id: "artcnn-c4f16",
        name: "ArtCNN C4F16 (Fast)",
        category: "ArtCNN",
        tier: "Fast",
        description: "Lightweight CNN 2x luma doubler (~12k params) ideal for laptops and handhelds.",
        files: &["ArtCNN_C4F16.glsl"],
    },
    ShaderPresetDef {
        id: "artcnn-c4f32",
        name: "ArtCNN C4F32 (HQ)",
        category: "ArtCNN",
        tier: "HQ",
        description: "Balanced high-quality CNN 2x luma doubler (~48k params).",
        files: &["ArtCNN_C4F32.glsl"],
    },
    ShaderPresetDef {
        id: "artcnn-c4f32-ds",
        name: "ArtCNN C4F32 DS (Denoise + Sharpen)",
        category: "ArtCNN",
        tier: "HQ",
        description: "ArtCNN C4F32 variant trained to simultaneously denoise and sharpen.",
        files: &["ArtCNN_C4F32_DS.glsl"],
    },
];

pub fn find_preset(id: &str) -> Option<&'static ShaderPresetDef> {
    PRESETS.iter().find(|p| p.id == id)
}

/// Validates that a downloaded shader payload looks like a real mpv GLSL hook file.
pub fn is_valid_glsl_shader(bytes: &[u8]) -> bool {
    if bytes.len() <= 64 {
        return false;
    }
    let text = String::from_utf8_lossy(bytes);
    text.contains("//!HOOK")
}

pub fn is_preset_installed(shaders_dir: &Path, preset: &ShaderPresetDef) -> bool {
    preset
        .files
        .iter()
        .all(|file| shaders_dir.join(file).is_file())
}

pub fn resolve_preset_paths(shaders_dir: &Path, preset_id: &str) -> Vec<PathBuf> {
    if preset_id == "off" {
        return Vec::new();
    }
    let Some(preset) = find_preset(preset_id) else {
        return Vec::new();
    };
    let paths: Vec<PathBuf> = preset.files.iter().map(|f| shaders_dir.join(f)).collect();
    if paths.iter().all(|p| p.is_file()) {
        paths
    } else {
        Vec::new()
    }
}

pub fn ui_presets(shaders_dir: &Path) -> Vec<ShaderPresetUiData> {
    PRESETS
        .iter()
        .map(|p| ShaderPresetUiData {
            id: p.id.to_string(),
            name: p.name.to_string(),
            category: p.category.to_string(),
            tier: p.tier.to_string(),
            description: p.description.to_string(),
            installed: is_preset_installed(shaders_dir, p),
            file_count: p.files.len(),
        })
        .collect()
}

/// Ensures every `.glsl` file required by `preset_id` is present on disk and valid.
pub fn ensure_preset_downloaded(
    shaders_dir: &Path,
    preset_id: &str,
) -> Result<Vec<PathBuf>, String> {
    let preset =
        find_preset(preset_id).ok_or_else(|| format!("Unknown shader preset: {preset_id}"))?;

    if preset.id == "off" || preset.files.is_empty() {
        return Ok(Vec::new());
    }

    fs::create_dir_all(shaders_dir)
        .map_err(|e| format!("Failed to create shaders directory: {e}"))?;

    let missing: Vec<&str> = preset
        .files
        .iter()
        .copied()
        .filter(|f| !shaders_dir.join(f).is_file())
        .collect();

    if missing.is_empty() {
        return Ok(resolve_preset_paths(shaders_dir, preset.id));
    }

    if preset.category == "Anime4K"
        && let Err(err) = download_anime4k_archive(shaders_dir)
    {
        warn!("[Shaders] Anime4K archive download failed, falling back to per-file fetch: {err}");
    }

    for file in preset.files {
        let dest = shaders_dir.join(file);
        if dest.is_file() {
            continue;
        }
        download_single_shader(preset.category, file, &dest)?;
    }

    let resolved = resolve_preset_paths(shaders_dir, preset.id);
    if resolved.len() != preset.files.len() {
        return Err("Some shader files failed to install cleanly".to_string());
    }
    Ok(resolved)
}

fn download_bytes(url: &str, max_time_secs: &str) -> Result<Vec<u8>, String> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            max_time_secs,
            url,
        ])
        .output()
        .map_err(|e| format!("Failed to invoke curl for {url}: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("HTTP download failed for {url}: {}", stderr.trim()));
    }

    Ok(output.stdout)
}

fn write_atomic_shader(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    if !is_valid_glsl_shader(bytes) {
        return Err(format!(
            "Downloaded file {} is not a valid mpv GLSL shader (missing //!HOOK)",
            dest.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("shader")
        ));
    }

    let tmp = dest.with_extension(format!("glsl.tmp.{}", process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("Failed to write temp shader: {e}"))?;
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to finalize shader file: {e}")
    })?;
    Ok(())
}

fn download_single_shader(category: &str, file: &str, dest: &Path) -> Result<(), String> {
    if let Some(builtin) = builtin_shader_source(file) {
        return write_atomic_shader(dest, builtin.as_bytes());
    }

    let resolved_category = if file.starts_with("FSRCNNX_") {
        "FSRCNNX"
    } else if file.starts_with("ArtCNN_") {
        "ArtCNN"
    } else if file.starts_with("Anime4K_") {
        "Anime4K"
    } else {
        category
    };

    let candidate_urls: Vec<String> = match resolved_category {
        "Anime4K" => ANIME4K_RAW_SUBDIRS
            .iter()
            .map(|sub| format!("{ANIME4K_RAW_BASE}/{sub}/{file}"))
            .collect(),
        "FSRCNNX" => vec![format!("{FSRCNNX_RELEASE_BASE}/{file}")],
        "ArtCNN" => vec![format!("{ARTCNN_RAW_BASE}/{file}")],
        other => return Err(format!("Unsupported shader category: {other}")),
    };

    let mut last_err = String::from("No download URLs available");
    for url in candidate_urls {
        info!("[Shaders] Downloading {file} from {url}");
        match download_bytes(&url, "60") {
            Ok(bytes) => match write_atomic_shader(dest, &bytes) {
                Ok(()) => return Ok(()),
                Err(e) => last_err = e,
            },
            Err(e) => last_err = e,
        }
    }

    Err(format!("Failed to download {file}: {last_err}"))
}

fn download_anime4k_archive(shaders_dir: &Path) -> Result<(), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_dir =
        std::env::temp_dir().join(format!("stremio_anime4k_{}_{}", process::id(), millis));
    let extract_dir = temp_dir.join("extracted");
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create temp extraction dir: {e}"))?;

    let archive_path = temp_dir.join("Anime4K_v4.0.zip");
    info!("[Shaders] Downloading Anime4K shader pack from {ANIME4K_RELEASE_ZIP_URL}");

    let status = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "120",
            "-o",
        ])
        .arg(&archive_path)
        .arg(ANIME4K_RELEASE_ZIP_URL)
        .status()
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Failed to run curl for Anime4K archive: {e}")
        })?;

    if !status.success() || !archive_path.is_file() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Anime4K archive download failed with status {status}"
        ));
    }

    let extracted = extract_zip_glsls(&archive_path, &extract_dir);
    if let Err(err) = extracted {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(err);
    }

    let mut installed_count = 0usize;
    copy_valid_glsl_recursive(&extract_dir, shaders_dir, &mut installed_count);

    let _ = fs::remove_dir_all(&temp_dir);
    if installed_count == 0 {
        return Err("Archive did not contain any valid .glsl shader files".to_string());
    }
    info!("[Shaders] Installed {installed_count} Anime4K shader file(s)");
    Ok(())
}

fn extract_zip_glsls(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
    if let Ok(status) = Command::new("unzip")
        .args(["-o", "-q", "-j"])
        .arg(archive_path)
        .arg("*.glsl")
        .arg("-d")
        .arg(extract_dir)
        .status()
        && status.success()
    {
        return Ok(());
    }

    if let Ok(status) = Command::new("python3")
        .args([
            "-c",
            "import os, sys, zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n    for info in z.infolist():\n        if not info.is_dir() and info.filename.lower().endswith('.glsl'):\n            name = os.path.basename(info.filename)\n            if name:\n                with z.open(info) as src, open(os.path.join(sys.argv[2], name), 'wb') as dst:\n                    dst.write(src.read())\n",
        ])
        .arg(archive_path)
        .arg(extract_dir)
        .status()
        && status.success()
    {
        return Ok(());
    }

    if let Ok(status) = Command::new("bsdtar")
        .arg("-xf")
        .arg(archive_path)
        .arg("-C")
        .arg(extract_dir)
        .status()
        && status.success()
    {
        return Ok(());
    }

    Err("No working zip extractor found (tried unzip, python3, bsdtar)".to_string())
}

fn copy_valid_glsl_recursive(src_dir: &Path, dest_dir: &Path, count: &mut usize) {
    let Ok(entries) = fs::read_dir(src_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            copy_valid_glsl_recursive(&path, dest_dir, count);
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("glsl"))
            && let Some(file_name) = path.file_name()
            && let Ok(bytes) = fs::read(&path)
        {
            let target = dest_dir.join(file_name);
            if write_atomic_shader(&target, &bytes).is_ok() {
                *count += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_preset_and_categories() {
        assert!(find_preset("off").is_some());
        let a4k = find_preset("anime4k-a-fast").expect("anime4k-a-fast missing");
        assert_eq!(a4k.category, "Anime4K");
        assert_eq!(a4k.files.len(), 6);
        assert!(find_preset("fsrcnnx-16").is_some());
        assert!(find_preset("artcnn-c4f32").is_some());
        assert!(find_preset("nonexistent").is_none());
    }

    #[test]
    fn test_is_valid_glsl_shader() {
        assert!(!is_valid_glsl_shader(b"<!DOCTYPE html><html>404</html>"));
        assert!(!is_valid_glsl_shader(b"//!HOOK MAIN"));
        let valid = format!(
            "//!HOOK MAIN\n//!BIND HOOKED\nvec4 hook() {{ return HOOKED_tex(HOOKED_pos); }}\n{}",
            "// padding".repeat(10)
        );
        assert!(is_valid_glsl_shader(valid.as_bytes()));
    }

    #[test]
    fn test_resolve_preset_paths() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dir =
            std::env::temp_dir().join(format!("stremio_shader_test_{}_{}", process::id(), millis));
        fs::create_dir_all(&dir).unwrap();

        assert!(resolve_preset_paths(&dir, "off").is_empty());
        assert!(resolve_preset_paths(&dir, "fsrcnnx-8").is_empty());

        fs::write(dir.join("FSRCNNX_x2_8-0-4-1.glsl"), "//!HOOK LUMA\n").unwrap();
        let resolved = resolve_preset_paths(&dir, "fsrcnnx-8");
        assert_eq!(resolved, vec![dir.join("FSRCNNX_x2_8-0-4-1.glsl")]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_builtin_cas_presets() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dir =
            std::env::temp_dir().join(format!("stremio_cas_test_{}_{}", process::id(), millis));
        fs::create_dir_all(&dir).unwrap();

        let paths = ensure_preset_downloaded(&dir, "cas-balanced").expect("cas-balanced failed");
        assert_eq!(paths.len(), 1);
        assert!(paths[0].is_file());
        let bytes = fs::read(&paths[0]).unwrap();
        assert!(is_valid_glsl_shader(&bytes));

        let strong = ensure_preset_downloaded(&dir, "cas-strong").expect("cas-strong failed");
        assert_eq!(strong.len(), 1);
        assert!(is_valid_glsl_shader(&fs::read(&strong[0]).unwrap()));

        let _ = fs::remove_dir_all(&dir);
    }
}
