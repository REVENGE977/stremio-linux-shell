use std::{
    env, fs,
    io::{BufRead, BufReader},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{self, Child, Command},
    thread,
    time::Duration,
};

use anyhow::Context;
use tracing::{debug, info, warn};

use crate::config::IPC_KEY;

pub fn server_dir() -> PathBuf {
    let dir = if let Some(home) = dirs::home_dir() {
        let host_dir = home.join(".config").join("stremio-enhanced").join("streamingserver");
        if host_dir.exists() {
            host_dir
        } else if let Some(cfg) = dirs::config_dir() {
            let cfg_dir = cfg.join("stremio-enhanced").join("streamingserver");
            if cfg_dir.exists() {
                cfg_dir
            } else {
                host_dir
            }
        } else {
            host_dir
        }
    } else {
        dirs::config_dir()
            .map(|p| p.join("stremio-enhanced").join("streamingserver"))
            .unwrap_or_else(|| PathBuf::from("streamingserver"))
    };
    let _ = fs::create_dir_all(&dir);
    cleanup_ffmpeg_leftovers(&dir);
    dir
}

pub fn ffmpeg_download_url() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    }
}

fn clean_abs_path(path: PathBuf) -> PathBuf {
    let abs = if path.is_absolute() {
        path
    } else if let Ok(cwd) = env::current_dir() {
        cwd.join(path)
    } else {
        path
    };
    if let Ok(canon) = abs.canonicalize() {
        return canon;
    }
    abs
}

pub fn find_shipped_bin_dir() -> Option<PathBuf> {
    if let Ok(mut app_dir) = env::current_exe() {
        app_dir.pop();
        if app_dir.join("ffmpeg").exists() && app_dir.join("ffprobe").exists() {
            return Some(clean_abs_path(app_dir));
        }
    }

    let dev_bin = if cfg!(target_arch = "aarch64") {
        PathBuf::from("bin-arm64")
    } else {
        PathBuf::from("bin")
    };
    if dev_bin.join("ffmpeg").exists() && dev_bin.join("ffprobe").exists() {
        return Some(clean_abs_path(dev_bin));
    }

    if let Some(path_os) = env::var_os("PATH") {
        for dir in env::split_paths(&path_os) {
            if dir.join("ffmpeg").is_file() && dir.join("ffprobe").is_file() {
                return Some(clean_abs_path(dir));
            }
        }
    }

    for candidate in ["/app/bin", "/usr/bin", "/usr/local/bin"] {
        let dir = PathBuf::from(candidate);
        if dir.join("ffmpeg").is_file() && dir.join("ffprobe").is_file() {
            return Some(dir);
        }
    }

    None
}

pub fn is_ffmpeg_installed() -> bool {
    if find_shipped_bin_dir().is_some() {
        return true;
    }
    let dir = server_dir();
    dir.join("ffmpeg").exists() && dir.join("ffprobe").exists()
}

pub fn cleanup_ffmpeg_leftovers(dir: &Path) {
    let ffmpeg_bin = dir.join("ffmpeg");
    let ffprobe_bin = dir.join("ffprobe");
    let bin_dir = dir.join("bin");

    if bin_dir.exists() {
        let bin_ffmpeg = bin_dir.join("ffmpeg");
        let bin_ffprobe = bin_dir.join("ffprobe");
        if !ffmpeg_bin.exists() && bin_ffmpeg.exists() {
            let _ = fs::rename(&bin_ffmpeg, &ffmpeg_bin);
        }
        if !ffprobe_bin.exists() && bin_ffprobe.exists() {
            let _ = fs::rename(&bin_ffprobe, &ffprobe_bin);
        }
        if ffmpeg_bin.exists() && ffprobe_bin.exists() {
            let _ = fs::remove_dir_all(&bin_dir);
        }
    }

    for extra_dir in ["doc", "presets", "man"] {
        let p = dir.join(extra_dir);
        if p.exists() {
            let _ = fs::remove_dir_all(&p);
        }
    }

    let license_file = dir.join("LICENSE.txt");
    if license_file.exists() {
        let _ = fs::remove_file(&license_file);
    }
}

fn find_and_move_binary(dir: &Path, filename: &str, dest: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str())
                    && name.eq_ignore_ascii_case(filename)
                {
                    if fs::rename(&path, dest).is_err() {
                        let _ = fs::copy(&path, dest);
                    }
                    let _ = fs::set_permissions(dest, fs::Permissions::from_mode(0o755));
                    return;
                }
            } else if path.is_dir() {
                find_and_move_binary(&path, filename, dest);
                if dest.exists() {
                    return;
                }
            }
        }
    }
}

pub fn download_and_extract_ffmpeg() -> Result<(), String> {
    if find_shipped_bin_dir().is_some() {
        return Ok(());
    }

    let dir = server_dir();
    let _ = fs::create_dir_all(&dir);

    let ffmpeg_bin = dir.join("ffmpeg");
    let ffprobe_bin = dir.join("ffprobe");

    cleanup_ffmpeg_leftovers(&dir);

    if ffmpeg_bin.exists() && ffprobe_bin.exists() {
        return Ok(());
    }

    let url = ffmpeg_download_url();
    info!("[FFmpeg] Downloading FFmpeg from {url} to {}...", dir.display());

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_dir = env::temp_dir().join(format!("stremio_ffmpeg_{}_{}", process::id(), millis));
    let _ = fs::create_dir_all(&temp_dir);
    let archive_path = temp_dir.join("ffmpeg.tar.xz");

    let status = Command::new("curl")
        .args([
            "-sL",
            "--connect-timeout",
            "15",
            "--max-time",
            "300",
            "-o",
        ])
        .arg(&archive_path)
        .arg(url)
        .status()
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Failed to run curl to download FFmpeg: {e}")
        })?;

    if !status.success() || !archive_path.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!("FFmpeg download failed with status {status}"));
    }

    let tar_status = Command::new("tar")
        .arg("-xf")
        .arg(&archive_path)
        .arg("-C")
        .arg(&temp_dir)
        .status()
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Failed to extract FFmpeg archive: {e}")
        })?;

    if !tar_status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!("tar extraction failed with status {tar_status}"));
    }

    find_and_move_binary(&temp_dir, "ffmpeg", &ffmpeg_bin);
    find_and_move_binary(&temp_dir, "ffprobe", &ffprobe_bin);

    let _ = fs::remove_dir_all(&temp_dir);
    cleanup_ffmpeg_leftovers(&dir);

    if ffmpeg_bin.exists() && ffprobe_bin.exists() {
        info!("[FFmpeg] FFmpeg setup complete: {}", ffmpeg_bin.display());
        Ok(())
    } else {
        Err("Archive did not contain ffmpeg and ffprobe".to_string())
    }
}

pub fn find_runtime_exe() -> PathBuf {
    if let Ok(mut path) = env::current_exe() {
        path.pop();
        let runtime = path.join("stremio-runtime");
        if runtime.exists() {
            return clean_abs_path(runtime);
        }
    }

    let dev_bin = if cfg!(target_arch = "aarch64") {
        PathBuf::from("bin-arm64").join("stremio-runtime")
    } else {
        PathBuf::from("bin").join("stremio-runtime")
    };
    if dev_bin.exists() {
        return clean_abs_path(dev_bin);
    }

    PathBuf::from("node")
}

pub fn is_streaming_server_online() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:11470".parse().unwrap(),
        Duration::from_millis(150),
    )
    .is_ok()
}

pub fn default_server_path() -> PathBuf {
    server_dir().join("server.js")
}

pub fn find_server_script() -> Option<PathBuf> {
    let default_path = default_server_path();
    if default_path.exists() {
        return Some(default_path);
    }

    if let Some(home) = dirs::home_dir() {
        let host_path = home.join(".config").join("stremio-enhanced").join("streamingserver").join("server.js");
        if host_path.exists() {
            return Some(host_path);
        }
    }

    if let Some(cfg) = dirs::config_dir() {
        let cfg_path = cfg.join("stremio-enhanced").join("streamingserver").join("server.js");
        if cfg_path.exists() {
            return Some(cfg_path);
        }
    }

    if let Ok(path_str) = env::var("SERVER_PATH") {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            return Some(path);
        }
    }

    let flatpak_path = PathBuf::from("/app/libexec/stremio/server.js");
    if flatpak_path.exists() {
        return Some(flatpak_path);
    }

    None
}

pub struct Server {
    process: Option<Child>,
    file: Option<PathBuf>,
}

impl Server {
    pub fn new() -> Self {
        let file = find_server_script();

        Self {
            process: None,
            file,
        }
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(None) => true,
                _ => {
                    self.process = None;
                    false
                }
            }
        } else {
            false
        }
    }

    pub fn start(&mut self, dev: bool) -> anyhow::Result<bool> {
        if self.is_running() {
            return Ok(true);
        }

        if self.file.is_none() || !self.file.as_ref().map(|p| p.exists()).unwrap_or(false) {
            self.file = find_server_script();
        }

        let Some(ref file) = self.file else {
            warn!("server.js not found in expected locations. Server will remain unstarted until setup.");
            return Ok(false);
        };

        info!("Starting streaming server with {}", file.display());
        if !is_ffmpeg_installed() {
            info!("[StreamingServer] ffmpeg missing, downloading ffmpeg...");
            let _ = download_and_extract_ffmpeg();
        }

        let s_dir = server_dir();
        let runtime = find_runtime_exe();
        let mut command = Command::new(runtime);
        command
            .env("NO_CORS", (dev as i32).to_string())
            .env("SERVER_IPC_KEY", IPC_KEY)
            .arg(file.as_os_str())
            .current_dir(&s_dir)
            .stdout(process::Stdio::piped())
            .process_group(0);

        let mut path_entries = Vec::new();
        if let Some(bin_dir) = find_shipped_bin_dir() {
            command.env("FFMPEG_BIN", bin_dir.join("ffmpeg"));
            command.env("FFPROBE_BIN", bin_dir.join("ffprobe"));
            path_entries.push(bin_dir.display().to_string());
        } else if s_dir.join("ffmpeg").exists() && s_dir.join("ffprobe").exists() {
            command.env("FFMPEG_BIN", s_dir.join("ffmpeg"));
            command.env("FFPROBE_BIN", s_dir.join("ffprobe"));
        }
        path_entries.push(s_dir.display().to_string());
        if let Ok(path_var) = env::var("PATH") {
            path_entries.push(path_var);
        }
        command.env("PATH", path_entries.join(":"));

        unsafe {
            command.pre_exec(move || {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                Ok(())
            });
        }

        let mut child = command.spawn().context("Failed to spawn node process for server.js")?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            thread::spawn(move || {
                while let Some(Ok(line)) = lines.next() {
                    debug!(target: "server", "{}", line);
                }
            });
        }

        self.process = Some(child);

        Ok(true)
    }

    pub fn restart(&mut self, dev: bool) -> anyhow::Result<bool> {
        let _ = self.stop();
        self.file = find_server_script();
        self.start(dev)
    }

    pub fn stop(&mut self) -> anyhow::Result<()> {
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
        }

        Ok(())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_discovery() {
        let path = find_server_script();
        assert!(path.is_some(), "Expected server.js to be discovered");
        assert!(path.unwrap().exists());
    }
}
