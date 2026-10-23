use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use gtk::glib;
use serde::Deserialize;
use tracing::{error, info, warn};

pub const ENHANCED_SCRIPT: &str = include_str!("enhanced.js");

/// Metadata parsed from plugin/theme file headers.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Metadata {
    pub name: String,
    pub description: String,
    pub update_url: String,
    pub version: String,
    pub author: String,
}

/// A loaded plugin with its metadata and script content.
#[derive(Debug, Clone)]
pub struct Plugin {
    pub file_name: String,
    pub metadata: Metadata,
    pub content: String,
}

/// A loaded theme with its metadata and CSS content.
#[derive(Debug, Clone)]
pub struct Theme {
    pub file_name: String,
    pub metadata: Metadata,
    pub content: String,
}

fn deserialize_enabled_plugins<'de, D>(deserializer: D) -> Result<HashMap<String, bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum PluginsRepr {
        Map(HashMap<String, bool>),
        List(Vec<String>),
    }

    match Option::<PluginsRepr>::deserialize(deserializer)? {
        Some(PluginsRepr::Map(map)) => Ok(map),
        Some(PluginsRepr::List(list)) => {
            let mut map = HashMap::new();
            for item in list {
                map.insert(item, true);
            }
            Ok(map)
        }
        None => Ok(HashMap::new()),
    }
}

/// Persistent settings stored in `settings.json`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(
        default,
        alias = "enabled_plugins",
        deserialize_with = "deserialize_enabled_plugins"
    )]
    pub enabled_plugins: HashMap<String, bool>,
    #[serde(default, alias = "active_theme")]
    pub active_theme: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled_plugins: HashMap::new(),
            active_theme: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatusUiData {
    pub exists: bool,
    pub running: bool,
    pub server_dir: String,
    pub server_path: String,
    pub current_version: Option<String>,
    pub skipped_version: Option<String>,
}

/// Incoming IPC action from the web interface.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EnhancedAction {
    GetData,
    OpenThemesFolder,
    OpenPluginsFolder,
    OpenStreamingServerFolder,
    GetServerStatus {
        id: String,
    },
    StartStreamingServer {
        id: String,
    },
    LoadUrl {
        url: String,
    },
    PrepareServerUpdate {
        version: String,
    },
    SkipServerVersion {
        version: String,
    },
    TogglePlugin {
        file_name: String,
        enabled: bool,
    },
    ApplyTheme {
        file_name: String,
    },
    Log {
        level: String,
        message: String,
    },
    HttpGet {
        id: String,
        url: String,
    },
    InstallMod {
        mod_type: String,
        file_name: String,
        content: String,
    },
    DeleteMod {
        mod_type: String,
        file_name: String,
    },
}

/// Serialized plugin information for the web UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiData {
    pub file_name: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub update_url: String,
    pub content: String,
    pub enabled: bool,
}

/// Serialized theme information for the web UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeUiData {
    pub file_name: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub update_url: String,
    pub css: String,
    pub is_active: bool,
}

/// Consolidated enhanced data sent to the web UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancedUiData {
    pub plugins: Vec<PluginUiData>,
    pub themes: Vec<ThemeUiData>,
    pub active_theme: Option<String>,
    pub server_status: ServerStatusUiData,
}

/// The main manager that handles loading plugins/themes and tracking settings.
pub struct EnhancedManager {
    #[allow(dead_code)]
    pub base_dir: PathBuf,
    pub plugins_dir: PathBuf,
    pub themes_dir: PathBuf,
    pub settings_path: PathBuf,
    pub settings: Settings,
    pub plugins: Vec<Plugin>,
    pub themes: Vec<Theme>,
}

impl EnhancedManager {
    /// Creates a new `EnhancedManager`, creating the directory structure if needed.
    pub fn new() -> Self {
        let config_dir = dirs::config_dir().expect("Failed to get config dir");
        let base_dir = config_dir.join("stremio-enhanced");
        let plugins_dir = base_dir.join("plugins");
        let themes_dir = base_dir.join("themes");
        let settings_path = base_dir.join("settings.json");

        // Ensure directories exist
        if let Err(e) = fs::create_dir_all(&plugins_dir) {
            error!("Failed to create plugins directory: {e}");
        }
        if let Err(e) = fs::create_dir_all(&themes_dir) {
            error!("Failed to create themes directory: {e}");
        }

        let settings = Self::load_settings(&settings_path);

        let mut manager = Self {
            base_dir,
            plugins_dir,
            themes_dir,
            settings_path,
            settings,
            plugins: Vec::new(),
            themes: Vec::new(),
        };

        manager.discover_plugins();
        manager.discover_themes();
        manager.save_settings();

        manager
    }

    /// Reload plugins, themes, and settings from disk.
    pub fn reload(&mut self) {
        self.settings = Self::load_settings(&self.settings_path);
        self.plugins.clear();
        self.themes.clear();
        self.discover_plugins();
        self.discover_themes();
        self.save_settings();
    }

    /// Toggle a plugin's enabled status.
    pub fn toggle_plugin(&mut self, file_name: &str, enabled: bool) {
        self.settings
            .enabled_plugins
            .insert(file_name.to_string(), enabled);
        self.save_settings();
    }

    /// Retrieve a plugin by file name.
    #[allow(dead_code)]
    pub fn get_plugin(&self, file_name: &str) -> Option<&Plugin> {
        self.plugins.iter().find(|p| p.file_name == file_name)
    }

    /// Set or clear the active theme. Returns the CSS of the active theme if any.
    pub fn set_active_theme(&mut self, file_name: Option<&str>) -> Option<String> {
        self.settings.active_theme = file_name.map(str::to_string);
        self.save_settings();
        self.active_theme().map(|t| t.content.clone())
    }

    /// Open the themes directory in the default file manager.
    pub fn open_themes_folder(&self) {
        open_folder(&self.themes_dir);
    }

    /// Open the plugins directory in the default file manager.
    pub fn open_plugins_folder(&self) {
        open_folder(&self.plugins_dir);
    }

    /// Installs a plugin or theme file and reloads.
    pub fn install_mod(
        &mut self,
        mod_type: &str,
        file_name: &str,
        content: &str,
    ) -> std::io::Result<()> {
        let dir = if mod_type.eq_ignore_ascii_case("theme") {
            &self.themes_dir
        } else {
            &self.plugins_dir
        };
        let target = dir.join(file_name);
        fs::write(&target, content)?;
        info!("Installed {mod_type} to {}", target.display());
        self.reload();
        Ok(())
    }

    /// Deletes a plugin or theme file and reloads.
    pub fn delete_mod(&mut self, mod_type: &str, file_name: &str) -> std::io::Result<()> {
        let dir = if mod_type.eq_ignore_ascii_case("theme") {
            &self.themes_dir
        } else {
            &self.plugins_dir
        };
        let target = dir.join(file_name);
        if target.exists() {
            fs::remove_file(&target)?;
            info!("Deleted {mod_type} file {}", target.display());
        }
        if mod_type.eq_ignore_ascii_case("theme") {
            if self
                .settings
                .active_theme
                .as_deref()
                .is_some_and(|active| active.eq_ignore_ascii_case(file_name))
            {
                self.settings.active_theme = None;
                self.save_settings();
            }
        } else {
            self.settings.enabled_plugins.remove(file_name);
            self.save_settings();
        }
        self.reload();
        Ok(())
    }

    /// Returns the current streaming server status and paths.
    pub fn get_server_status(&self, running: bool) -> ServerStatusUiData {
        let server_dir = crate::server::server_dir();
        let server_path = crate::server::default_server_path();
        let exists = crate::server::find_server_script().is_some();

        let current_version_file = server_dir.join("version.txt");
        let current_version = fs::read_to_string(&current_version_file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let skip_version_file = self.base_dir.join("skip_server_version.txt");
        let skipped_version = fs::read_to_string(&skip_version_file)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        ServerStatusUiData {
            exists,
            running,
            server_dir: server_dir.to_string_lossy().to_string(),
            server_path: server_path.to_string_lossy().to_string(),
            current_version,
            skipped_version,
        }
    }

    /// Open the streaming server directory in the default file manager.
    pub fn open_streaming_server_folder(&self) {
        let dir = crate::server::server_dir();
        let _ = fs::create_dir_all(&dir);
        open_folder(&dir);
    }

    /// Prepares for a server.js update by deleting old files and recording the new version.
    pub fn prepare_server_update(&self, new_version: &str) -> std::io::Result<()> {
        let dir = crate::server::server_dir();
        let _ = fs::create_dir_all(&dir);
        let server_file = dir.join("server.js");
        let version_file = dir.join("version.txt");

        if server_file.exists() {
            let _ = fs::remove_file(&server_file);
        }
        fs::write(&version_file, new_version)?;
        Ok(())
    }

    /// Saves a version string to skip future update prompts for that version.
    pub fn skip_server_version(&self, version: &str) -> std::io::Result<()> {
        let skip_file = self.base_dir.join("skip_server_version.txt");
        fs::write(&skip_file, version)?;
        Ok(())
    }

    /// Formats plugins, themes, and server status for the web interface.
    pub fn ui_data(&self, server_running: bool) -> EnhancedUiData {
        let plugins = self
            .plugins
            .iter()
            .map(|p| {
                let enabled = self
                    .settings
                    .enabled_plugins
                    .get(&p.file_name)
                    .copied()
                    .unwrap_or(false);
                PluginUiData {
                    file_name: p.file_name.clone(),
                    name: p.metadata.name.clone(),
                    description: p.metadata.description.clone(),
                    version: p.metadata.version.clone(),
                    author: p.metadata.author.clone(),
                    update_url: p.metadata.update_url.clone(),
                    content: p.content.clone(),
                    enabled,
                }
            })
            .collect();

        let themes = self
            .themes
            .iter()
            .map(|t| {
                let is_active = self
                    .settings
                    .active_theme
                    .as_deref()
                    .is_some_and(|active| active.eq_ignore_ascii_case(&t.file_name));
                ThemeUiData {
                    file_name: t.file_name.clone(),
                    name: t.metadata.name.clone(),
                    description: t.metadata.description.clone(),
                    version: t.metadata.version.clone(),
                    author: t.metadata.author.clone(),
                    update_url: t.metadata.update_url.clone(),
                    css: t.content.clone(),
                    is_active,
                }
            })
            .collect();

        EnhancedUiData {
            plugins,
            themes,
            active_theme: self.settings.active_theme.clone(),
            server_status: self.get_server_status(server_running),
        }
    }

    /// Loads settings from disk, or returns defaults if the file doesn't exist.
    fn load_settings(path: &Path) -> Settings {
        match fs::read_to_string(path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_else(|e| {
                warn!("Failed to parse settings.json, using defaults: {e}");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    /// Persists the current settings to disk.
    pub fn save_settings(&self) {
        match serde_json::to_string_pretty(&self.settings) {
            Ok(data) => {
                if let Err(e) = fs::write(&self.settings_path, data) {
                    error!("Failed to write settings.json: {e}");
                }
            }
            Err(e) => error!("Failed to serialize settings: {e}"),
        }
    }

    /// Discover all `.plugin.js` or `.js` files in the plugins directory.
    fn discover_plugins(&mut self) {
        let entries = match fs::read_dir(&self.plugins_dir) {
            Ok(entries) => entries,
            Err(e) => {
                error!("Failed to read plugins directory: {e}");
                return;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_file() && path.extension().is_some_and(|ext| ext == "js") {
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                match fs::read_to_string(&path) {
                    Ok(content) => {
                        let metadata = parse_metadata(&content).unwrap_or_else(|| {
                            let name = file_name
                                .strip_suffix(".plugin.js")
                                .or_else(|| file_name.strip_suffix(".js"))
                                .unwrap_or(&file_name)
                                .to_string();
                            Metadata {
                                name,
                                description: String::new(),
                                update_url: String::new(),
                                version: "1.0.0".to_string(),
                                author: "Unknown".to_string(),
                            }
                        });

                        info!("Loaded plugin: {} ({})", metadata.name, file_name);

                        // If this plugin isn't in settings yet, default to disabled
                        self.settings
                            .enabled_plugins
                            .entry(file_name.clone())
                            .or_insert(false);

                        self.plugins.push(Plugin {
                            file_name,
                            metadata,
                            content,
                        });
                    }
                    Err(e) => error!("Failed to read plugin file '{}': {e}", file_name),
                }
            }
        }
    }

    /// Discover all `.theme.css` or `.css` files in the themes directory.
    fn discover_themes(&mut self) {
        let entries = match fs::read_dir(&self.themes_dir) {
            Ok(entries) => entries,
            Err(e) => {
                error!("Failed to read themes directory: {e}");
                return;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_file() && path.extension().is_some_and(|ext| ext == "css") {
                let file_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                match fs::read_to_string(&path) {
                    Ok(content) => {
                        let metadata = parse_metadata(&content).unwrap_or_else(|| {
                            let name = file_name
                                .strip_suffix(".theme.css")
                                .or_else(|| file_name.strip_suffix(".css"))
                                .unwrap_or(&file_name)
                                .to_string();
                            Metadata {
                                name,
                                description: String::new(),
                                update_url: String::new(),
                                version: "1.0.0".to_string(),
                                author: "Unknown".to_string(),
                            }
                        });

                        info!("Loaded theme: {} ({})", metadata.name, file_name);

                        self.themes.push(Theme {
                            file_name,
                            metadata,
                            content,
                        });
                    }
                    Err(e) => error!("Failed to read theme file '{}': {e}", file_name),
                }
            }
        }

        // Validate that the active theme still exists on disk
        if let Some(ref active) = self.settings.active_theme {
            if let Some(matched) = self
                .themes
                .iter()
                .find(|t| t.file_name.eq_ignore_ascii_case(active))
            {
                // Normalize casing to actual file name on disk
                if &matched.file_name != active {
                    self.settings.active_theme = Some(matched.file_name.clone());
                }
            } else {
                warn!(
                    "Active theme '{}' not found in themes directory, clearing selection",
                    active
                );
                self.settings.active_theme = None;
            }
        }
    }

    /// Returns only the plugins that are currently enabled in settings.
    #[allow(dead_code)]
    pub fn enabled_plugins(&self) -> Vec<&Plugin> {
        self.plugins
            .iter()
            .filter(|p| {
                self.settings
                    .enabled_plugins
                    .get(&p.file_name)
                    .copied()
                    .unwrap_or(false)
            })
            .collect()
    }

    /// Returns the currently active theme, if any.
    pub fn active_theme(&self) -> Option<&Theme> {
        self.settings
            .active_theme
            .as_ref()
            .and_then(|active| {
                self.themes
                    .iter()
                    .find(|t| t.file_name.eq_ignore_ascii_case(active))
            })
    }
}

/// Opens a directory in the user's default file manager.
pub fn open_folder(path: &Path) {
    let uri = format!("file://{}", path.display());
    let path_buf = path.to_path_buf();

    if let Err(e) =
        gtk::gio::AppInfo::launch_default_for_uri(&uri, None::<&gtk::gio::AppLaunchContext>)
    {
        warn!("Failed to open folder via GIO: {e}, attempting xdg-open fallback");
        let _ = std::process::Command::new("xdg-open").arg(&path_buf).spawn();
    }

    crate::spawn_local!(async move {
        if let Ok(portal_uri) = ashpd::Uri::parse(&format!("file://{}", path_buf.display())) {
            let _ = ashpd::desktop::open_uri::OpenFileRequest::default()
                .send_uri(&portal_uri)
                .await;
        }
    });
}

/// Parses the metadata block from the top of a plugin/theme file.
fn parse_metadata(content: &str) -> Option<Metadata> {
    let start = content.find("/**")?;
    let end = content[start..].find("*/")? + start + 2;
    let block = &content[start..end];

    let name = extract_tag(block, "name")?;
    let description = extract_tag(block, "description").unwrap_or_default();
    let update_url = extract_tag(block, "updateUrl").unwrap_or_default();
    let version = extract_tag(block, "version").unwrap_or_default();
    let author = extract_tag(block, "author").unwrap_or_default();

    Some(Metadata {
        name,
        description,
        update_url,
        version,
        author,
    })
}

/// Extracts the value of a `@tag` from a metadata comment block.
fn extract_tag(block: &str, tag: &str) -> Option<String> {
    let target = format!("@{tag}").to_lowercase();
    for line in block.lines() {
        let trimmed = line.trim().trim_start_matches('*').trim();
        let trimmed_lower = trimmed.to_lowercase();
        if trimmed_lower.starts_with(&target) {
            let rest = trimmed[target.len()..].trim();
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_actions() {
        let get_data = r#"{"action":"getData"}"#;
        let action: EnhancedAction = serde_json::from_str(get_data).unwrap();
        assert!(matches!(action, EnhancedAction::GetData));

        let toggle = r#"{"action":"togglePlugin","fileName":"tidb.plugin.js","enabled":true}"#;
        let action: EnhancedAction = serde_json::from_str(toggle).unwrap();
        match action {
            EnhancedAction::TogglePlugin { file_name, enabled } => {
                assert_eq!(file_name, "tidb.plugin.js");
                assert_eq!(enabled, true);
            }
            _ => panic!("Wrong action"),
        }

        let theme = r#"{"action":"applyTheme","fileName":"amoled.theme.css"}"#;
        let action: EnhancedAction = serde_json::from_str(theme).unwrap();
        match action {
            EnhancedAction::ApplyTheme { file_name } => {
                assert_eq!(file_name, "amoled.theme.css");
            }
            _ => panic!("Wrong action"),
        }

        let install = r#"{"action":"installMod","modType":"plugin","fileName":"test.js","content":"console.log(1);"}"#;
        let action: EnhancedAction = serde_json::from_str(install).unwrap();
        match action {
            EnhancedAction::InstallMod { mod_type, file_name, content } => {
                assert_eq!(mod_type, "plugin");
                assert_eq!(file_name, "test.js");
                assert_eq!(content, "console.log(1);");
            }
            _ => panic!("Wrong action"),
        }

        let delete = r#"{"action":"deleteMod","modType":"theme","fileName":"dark.css"}"#;
        let action: EnhancedAction = serde_json::from_str(delete).unwrap();
        match action {
            EnhancedAction::DeleteMod { mod_type, file_name } => {
                assert_eq!(mod_type, "theme");
                assert_eq!(file_name, "dark.css");
            }
            _ => panic!("Wrong action"),
        }
    }

    #[test]
    fn test_deserialize_settings() {
        // Snake case map
        let json1 = r#"{"enabled_plugins":{"test.js":true},"active_theme":"dark.css"}"#;
        let s1: Settings = serde_json::from_str(json1).unwrap();
        assert_eq!(s1.enabled_plugins.get("test.js"), Some(&true));
        assert_eq!(s1.active_theme.as_deref(), Some("dark.css"));

        // Camel case map
        let json2 = r#"{"enabledPlugins":{"test.js":false},"activeTheme":"amoled.css"}"#;
        let s2: Settings = serde_json::from_str(json2).unwrap();
        assert_eq!(s2.enabled_plugins.get("test.js"), Some(&false));
        assert_eq!(s2.active_theme.as_deref(), Some("amoled.css"));

        // Array list of enabled plugins
        let json3 = r#"{"enabledPlugins":["test1.js","test2.js"],"activeTheme":null}"#;
        let s3: Settings = serde_json::from_str(json3).unwrap();
        assert_eq!(s3.enabled_plugins.get("test1.js"), Some(&true));
        assert_eq!(s3.enabled_plugins.get("test2.js"), Some(&true));
        assert_eq!(s3.active_theme, None);

        // Empty json
        let json4 = r#"{}"#;
        let s4: Settings = serde_json::from_str(json4).unwrap();
        assert!(s4.enabled_plugins.is_empty());
        assert_eq!(s4.active_theme, None);
    }
}

