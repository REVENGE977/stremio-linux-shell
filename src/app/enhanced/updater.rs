use std::{
    env, fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    time::Duration,
};

use serde::Serialize;
use tracing::info;

const ELF_MAGIC: [u8; 4] = [0x7f, b'E', b'L', b'F'];
const MIN_APPIMAGE_SIZE_BYTES: u64 = 1_048_576;

const ALLOWED_UPDATE_URL_PREFIXES: &[&str] = &[
    "https://github.com/REVENGE977/",
    "https://objects.githubusercontent.com/",
    "https://release-assets.githubusercontent.com/",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub install_type: String,
    pub can_self_update: bool,
    pub appimage_path: Option<String>,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub phase: String,
    pub percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
    pub error: Option<String>,
}

fn is_dir_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(format!(".stremio-write-probe-{}", process::id()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

pub fn detect_install_info() -> InstallInfo {
    let arch = env::consts::ARCH.to_string();

    if let Ok(appimage) = env::var("APPIMAGE")
        && !appimage.trim().is_empty()
    {
        let path = PathBuf::from(&appimage);
        let can_self_update = path.parent().is_some_and(is_dir_writable);
        return InstallInfo {
            install_type: "appimage".to_string(),
            can_self_update,
            appimage_path: Some(appimage),
            arch,
        };
    }

    if env::var("FLATPAK_ID").is_ok() {
        return InstallInfo {
            install_type: "flatpak".to_string(),
            can_self_update: false,
            appimage_path: None,
            arch,
        };
    }

    InstallInfo {
        install_type: "native".to_string(),
        can_self_update: false,
        appimage_path: None,
        arch,
    }
}

pub fn validate_update_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if ALLOWED_UPDATE_URL_PREFIXES
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
    {
        Ok(())
    } else {
        Err(format!(
            "Refused untrusted update URL (must originate from REVENGE977 GitHub Releases): {trimmed}"
        ))
    }
}

pub fn verify_appimage_file(path: &Path) -> Result<(), String> {
    let meta =
        fs::metadata(path).map_err(|e| format!("Failed to inspect downloaded AppImage: {e}"))?;
    if meta.len() < MIN_APPIMAGE_SIZE_BYTES {
        return Err(format!(
            "Downloaded AppImage is unexpectedly small ({} bytes)",
            meta.len()
        ));
    }

    use std::io::Read;
    let mut file =
        fs::File::open(path).map_err(|e| format!("Failed to open downloaded AppImage: {e}"))?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|e| format!("Failed to read AppImage header: {e}"))?;
    if magic != ELF_MAGIC {
        return Err("Downloaded file is not a valid ELF executable/AppImage".to_string());
    }

    Ok(())
}

async fn probe_content_length(url: &str) -> u64 {
    let Ok(output) = tokio::process::Command::new("curl")
        .args(["-fsSLI", "--connect-timeout", "10", "--max-time", "20", url])
        .output()
        .await
    else {
        return 0;
    };

    if !output.status.success() {
        return 0;
    }

    let headers = String::from_utf8_lossy(&output.stdout);
    let mut last_len = 0u64;
    for line in headers.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:")
            && let Ok(parsed) = rest.trim().parse::<u64>()
        {
            last_len = parsed;
        }
    }
    last_len
}

pub async fn download_and_replace_appimage(
    download_url: String,
    progress_tx: flume::Sender<UpdateProgressEvent>,
) -> Result<PathBuf, String> {
    validate_update_url(&download_url)?;

    let appimage_str = env::var("APPIMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "APPIMAGE environment variable is not set; self-update requires running inside an AppImage".to_string())?;
    let target_path = PathBuf::from(&appimage_str);
    let parent_dir = target_path
        .parent()
        .ok_or_else(|| "Invalid APPIMAGE path".to_string())?;

    if !is_dir_writable(parent_dir) {
        return Err(format!(
            "AppImage directory '{}' is not writable",
            parent_dir.display()
        ));
    }

    let part_path = parent_dir.join(format!(".stremio-update-{}.AppImage.part", process::id()));
    let _ = fs::remove_file(&part_path);

    let total_bytes = probe_content_length(&download_url).await;

    let _ = progress_tx.send(UpdateProgressEvent {
        phase: "downloading".to_string(),
        percent: 0,
        downloaded_bytes: 0,
        total_bytes,
        message: "Downloading AppImage update...".to_string(),
        error: None,
    });

    info!(
        "[SelfUpdate] Downloading {download_url} -> {}",
        part_path.display()
    );

    let mut child = tokio::process::Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "600",
            "-o",
        ])
        .arg(&part_path)
        .arg(&download_url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;

    let mut last_reported_bytes = u64::MAX;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err_msg = format!("Download failed with exit status {status}");
                    if let Some(mut stderr) = child.stderr.take() {
                        use tokio::io::AsyncReadExt;
                        let mut buf = String::new();
                        let _ = stderr.read_to_string(&mut buf).await;
                        let trimmed = buf.trim();
                        if !trimmed.is_empty() {
                            err_msg = format!("Download failed: {trimmed}");
                        }
                    }
                    let _ = fs::remove_file(&part_path);
                    return Err(err_msg);
                }
                break;
            }
            Ok(None) => {
                let downloaded = tokio::fs::metadata(&part_path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                if downloaded != last_reported_bytes {
                    last_reported_bytes = downloaded;
                    let percent = downloaded
                        .saturating_mul(100)
                        .checked_div(total_bytes)
                        .map_or(0, |p| p.min(99) as u8);
                    let _ = progress_tx.send(UpdateProgressEvent {
                        phase: "downloading".to_string(),
                        percent,
                        downloaded_bytes: downloaded,
                        total_bytes,
                        message: "Downloading AppImage update...".to_string(),
                        error: None,
                    });
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            Err(e) => {
                let _ = fs::remove_file(&part_path);
                return Err(format!("Failed while waiting for curl: {e}"));
            }
        }
    }

    let final_size = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
    let _ = progress_tx.send(UpdateProgressEvent {
        phase: "verifying".to_string(),
        percent: 99,
        downloaded_bytes: final_size,
        total_bytes: total_bytes.max(final_size),
        message: "Verifying downloaded AppImage...".to_string(),
        error: None,
    });

    if let Err(err) = verify_appimage_file(&part_path) {
        let _ = fs::remove_file(&part_path);
        return Err(err);
    }

    fs::set_permissions(&part_path, fs::Permissions::from_mode(0o755)).map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("Failed to make new AppImage executable: {e}")
    })?;

    fs::rename(&part_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&part_path);
        format!("Failed to replace existing AppImage: {e}")
    })?;

    info!(
        "[SelfUpdate] Replaced AppImage at {}",
        target_path.display()
    );
    let _ = progress_tx.send(UpdateProgressEvent {
        phase: "ready".to_string(),
        percent: 100,
        downloaded_bytes: final_size,
        total_bytes: final_size,
        message: "Update installed! Restart to launch the new version.".to_string(),
        error: None,
    });

    Ok(target_path)
}

pub fn relaunch_appimage() -> Result<(), String> {
    let appimage_path = env::var("APPIMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "Cannot relaunch: APPIMAGE environment variable not set".to_string())?;

    let mut cmd = Command::new(&appimage_path);
    for var in [
        "APPDIR",
        "APPIMAGE",
        "ARGV0",
        "OWD",
        "LD_LIBRARY_PATH",
        "GSETTINGS_SCHEMA_DIR",
        "GIO_MODULE_DIR",
        "GIO_EXTRA_MODULES",
        "GDK_PIXBUF_MODULEDIR",
        "GDK_PIXBUF_MODULE_FILE",
        "WEBKIT_EXEC_PATH",
        "WEBKIT_INJECTED_BUNDLE_PATH",
    ] {
        cmd.env_remove(var);
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to relaunch AppImage '{}': {e}", appimage_path))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn test_validate_update_url() {
        assert!(validate_update_url(
            "https://github.com/REVENGE977/stremio-linux-shell/releases/download/1.2.2/App.AppImage"
        )
        .is_ok());
        assert!(
            validate_update_url(
                "https://objects.githubusercontent.com/github-production-release-asset/123"
            )
            .is_ok()
        );
        assert!(
            validate_update_url(
                "https://release-assets.githubusercontent.com/github-production-release-asset/123"
            )
            .is_ok()
        );
        assert!(validate_update_url("http://github.com/REVENGE977/foo").is_err());
        assert!(validate_update_url("https://evil.example.com/payload.AppImage").is_err());
    }

    #[test]
    fn test_verify_appimage_file() {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dir =
            std::env::temp_dir().join(format!("stremio_updater_test_{}_{}", process::id(), millis));
        fs::create_dir_all(&dir).unwrap();

        let small_bad = dir.join("small.AppImage");
        fs::write(&small_bad, b"\x7fELFtiny").unwrap();
        assert!(verify_appimage_file(&small_bad).is_err());

        let non_elf = dir.join("nonelf.AppImage");
        let mut bad_buf = vec![b'P'; (MIN_APPIMAGE_SIZE_BYTES + 16) as usize];
        bad_buf[0] = b'H';
        fs::write(&non_elf, bad_buf).unwrap();
        assert!(verify_appimage_file(&non_elf).is_err());

        let valid_elf = dir.join("valid.AppImage");
        let mut good_buf = vec![0u8; (MIN_APPIMAGE_SIZE_BYTES + 16) as usize];
        good_buf[..4].copy_from_slice(&ELF_MAGIC);
        fs::write(&valid_elf, good_buf).unwrap();
        assert!(verify_appimage_file(&valid_elf).is_ok());

        let _ = fs::remove_dir_all(&dir);
    }
}
