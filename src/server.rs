use std::{
    env,
    io::{BufRead, BufReader},
    os::unix::process::CommandExt,
    path::PathBuf,
    process::{self, Child, Command},
    thread,
};

use anyhow::Context;
use tracing::{debug, info, warn};

use crate::config::IPC_KEY;

pub fn server_dir() -> PathBuf {
    dirs::config_dir()
        .map(|p| p.join("stremio-enhanced").join("streamingserver"))
        .unwrap_or_else(|| PathBuf::from("streamingserver"))
}

pub fn default_server_path() -> PathBuf {
    server_dir().join("server.js")
}

pub fn find_server_script() -> Option<PathBuf> {
    let default_path = default_server_path();
    if default_path.exists() {
        return Some(default_path);
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
        let mut command = Command::new("node");
        command
            .env("NO_CORS", (dev as i32).to_string())
            .env("SERVER_IPC_KEY", IPC_KEY)
            .arg(file.as_os_str())
            .stdout(process::Stdio::piped())
            .process_group(0);

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
