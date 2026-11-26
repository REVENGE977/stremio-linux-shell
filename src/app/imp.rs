use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::{prelude::*, subclass::prelude::*};
use gtk::{
    gio::prelude::SettingsExt,
    glib::{self, Properties, clone},
};
use tracing::{error, info, warn};

use crate::{
    app::{
        config::URI_SCHEME,
        discord::Discord,
        enhanced::EnhancedManager,
        ipc::{
            self,
            event::{IpcEvent, IpcEventDiscord, IpcEventMpv},
        },
        mpris::Mpris,
        tray::Tray,
        video::{
            Video,
            thumbnailer::{DEFAULT_THUMB_MAX_WIDTH, ThumbnailCmd, spawn_thumbnail_worker},
        },
        webview::WebView,
        window::Window,
    },
    spawn_local, utils,
};

const PRELOAD_SCRIPT: &str = include_str!("ipc/preload.js");

#[derive(Properties, Default)]
#[properties(wrapper_type = super::Application)]
pub struct Application {
    #[property(get, set)]
    dev_mode: Cell<bool>,
    #[property(get, set)]
    startup_url: RefCell<String>,
    #[property(get, set)]
    decorations: Cell<bool>,
    tray: RefCell<Option<Tray>>,
    mpris: RefCell<Option<Mpris>>,
    window: RefCell<Option<Window>>,
    webview: RefCell<Option<WebView>>,
    deeplink: RefCell<Option<String>>,
    enhanced: RefCell<Option<Rc<RefCell<EnhancedManager>>>>,
    server: RefCell<Option<Rc<RefCell<crate::server::Server>>>>,
    thumbnail_tx: RefCell<Option<flume::Sender<ThumbnailCmd>>>,
    pub system_theme_provider: RefCell<Option<gtk::CssProvider>>,
    pub app_settings: RefCell<Option<gtk::gio::Settings>>,
}

fn is_server_running(server: &Option<Rc<RefCell<crate::server::Server>>>) -> bool {
    server
        .as_ref()
        .map(|s| s.borrow_mut().is_running())
        .unwrap_or(false)
        || crate::server::is_streaming_server_online()
}

struct EnhancedActionContext<'a> {
    app: &'a super::Application,
    window: &'a Window,
    webview: &'a WebView,
    video: &'a Video,
    enhanced: &'a Rc<RefCell<EnhancedManager>>,
    server: &'a Option<Rc<RefCell<crate::server::Server>>>,
    thumbnail_tx: &'a flume::Sender<ThumbnailCmd>,
    active_stream_url: &'a Rc<RefCell<Option<String>>>,
    dev_mode: bool,
}

fn handle_enhanced_action(
    ctx: EnhancedActionContext<'_>,
    action: crate::app::enhanced::EnhancedAction,
) {
    let EnhancedActionContext {
        app,
        window,
        webview,
        video,
        enhanced,
        server,
        thumbnail_tx,
        active_stream_url,
        dev_mode,
    } = ctx;
    match action {
        crate::app::enhanced::EnhancedAction::GetData => {
            let mut mgr = enhanced.borrow_mut();
            mgr.reload();
            let running = is_server_running(server);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::OpenThemesFolder => {
            enhanced.borrow().open_themes_folder();
        }
        crate::app::enhanced::EnhancedAction::OpenPluginsFolder => {
            enhanced.borrow().open_plugins_folder();
        }
        crate::app::enhanced::EnhancedAction::OpenStreamingServerFolder => {
            enhanced.borrow().open_streaming_server_folder();
        }
        crate::app::enhanced::EnhancedAction::GetServerStatus { id } => {
            let running = is_server_running(server);
            let status = enhanced.borrow().get_server_status(running);
            if let Ok(json) = serde_json::to_string(&status) {
                let script = format!(
                    "window.__receiveServerStatus && window.__receiveServerStatus({id:?}, {json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::StartStreamingServer { id } => {
            if let Some(s_rc) = server {
                let _ = s_rc.borrow_mut().restart(dev_mode);
            }
            let webview = webview.clone();
            spawn_local!(async move {
                let mut running = false;
                for _ in 0..40 {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    if crate::server::is_streaming_server_online() {
                        running = true;
                        break;
                    }
                }
                let script = format!(
                    "window.__receiveServerStartResult && window.__receiveServerStartResult({id:?}, {running});"
                );
                webview.evaluate_javascript(&script);
            });
        }
        crate::app::enhanced::EnhancedAction::LoadUrl { url } => {
            info!("Loading URL in webview: {url}");
            webview.load_uri(&url);
        }
        crate::app::enhanced::EnhancedAction::PrepareServerUpdate { version } => {
            if let Some(s_rc) = server {
                let _ = s_rc.borrow_mut().stop();
            }
            if let Err(e) = enhanced.borrow().prepare_server_update(&version) {
                error!("Failed to prepare server update: {e}");
            }
        }
        crate::app::enhanced::EnhancedAction::SkipServerVersion { version } => {
            if let Err(e) = enhanced.borrow().skip_server_version(&version) {
                error!("Failed to skip server version: {e}");
            }
        }
        crate::app::enhanced::EnhancedAction::SkipClientVersion { version } => {
            if let Err(e) = enhanced.borrow().skip_client_version(&version) {
                error!("Failed to skip client version: {e}");
            }
        }
        crate::app::enhanced::EnhancedAction::TogglePlugin { file_name, enabled } => {
            info!("Toggling plugin {file_name}: {enabled}");
            enhanced.borrow_mut().toggle_plugin(&file_name, enabled);
            let running = is_server_running(server);
            let data = enhanced.borrow().ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::ApplyTheme { file_name } => {
            info!("Applying theme: {file_name}");
            let new_theme = if file_name == "Default" {
                None
            } else {
                Some(file_name.as_str())
            };
            let css = enhanced.borrow_mut().set_active_theme(new_theme);
            webview.set_theme_css(css.as_deref());
            let running = is_server_running(server);
            let data = enhanced.borrow().ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::Log { level, message } => match level.as_str() {
            "error" => error!("{message}"),
            "warn" => warn!("{message}"),
            _ => info!("{message}"),
        },
        crate::app::enhanced::EnhancedAction::HttpGet { id, url } => {
            let webview = webview.clone();
            spawn_local!(async move {
                let res = tokio::process::Command::new("curl")
                    .args([
                        "-4",
                        "-sL",
                        "--connect-timeout",
                        "10",
                        "--max-time",
                        "25",
                        "-w",
                        "\n%{http_code}",
                        &url,
                    ])
                    .output()
                    .await;

                let output = match res {
                    Ok(out) if out.status.success() => Ok(out),
                    _ => {
                        tokio::process::Command::new("curl")
                            .args([
                                "-sL",
                                "--connect-timeout",
                                "10",
                                "--max-time",
                                "25",
                                "-w",
                                "\n%{http_code}",
                                &url,
                            ])
                            .output()
                            .await
                    }
                };

                match output {
                    Ok(output) if output.status.success() => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if let Some(pos) = stdout.rfind('\n') {
                            let body = &stdout[..pos];
                            let code_str = stdout[pos + 1..].trim();
                            let status: u16 = code_str.parse().unwrap_or(200);
                            let body_json =
                                serde_json::to_string(body).unwrap_or_else(|_| "\"\"".to_string());
                            let script = format!(
                                "window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, {status}, {body_json});"
                            );
                            webview.evaluate_javascript(&script);
                        } else {
                            let body_json = serde_json::to_string(&stdout)
                                .unwrap_or_else(|_| "\"\"".to_string());
                            let script = format!(
                                "window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 200, {body_json});"
                            );
                            webview.evaluate_javascript(&script);
                        }
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        error!("Curl failed for {url}: {stderr}");
                        let script = format!(
                            "window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 500, \"Curl error\");"
                        );
                        webview.evaluate_javascript(&script);
                    }
                    Err(e) => {
                        error!("Failed to execute curl for {url}: {e}");
                        let script = format!(
                            "window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 500, \"Exec error\");"
                        );
                        webview.evaluate_javascript(&script);
                    }
                }
            });
        }
        crate::app::enhanced::EnhancedAction::InstallMod {
            mod_type,
            file_name,
            content,
        } => {
            info!("Installing mod {mod_type} {file_name}");
            let mut mgr = enhanced.borrow_mut();
            if let Err(e) = mgr.install_mod(&mod_type, &file_name, &content) {
                error!("Failed to install mod {file_name}: {e}");
            }
            let running = is_server_running(server);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::DeleteMod {
            mod_type,
            file_name,
        } => {
            info!("Deleting mod {mod_type} {file_name}");
            let mut mgr = enhanced.borrow_mut();
            if let Err(e) = mgr.delete_mod(&mod_type, &file_name) {
                error!("Failed to delete mod {file_name}: {e}");
            }
            let css = mgr.active_theme().map(|t| t.content.clone());
            webview.set_theme_css(css.as_deref());
            let running = is_server_running(server);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::DownloadFfmpeg { id } => {
            let webview = webview.clone();
            spawn_local!(async move {
                let success =
                    tokio::task::spawn_blocking(
                        || match crate::server::download_and_extract_ffmpeg() {
                            Ok(()) => true,
                            Err(e) => {
                                error!("[FFmpeg] Setup failed: {e}");
                                false
                            }
                        },
                    )
                    .await
                    .unwrap_or(false);
                let script = format!(
                    "window.__receiveFfmpegResult && window.__receiveFfmpegResult({id:?}, {success});"
                );
                webview.evaluate_javascript(&script);
            });
        }
        crate::app::enhanced::EnhancedAction::SetPictureInPicture { enabled } => {
            let pip_active = window.set_pip(enabled);
            let script = format!("window.__syncPipState && window.__syncPipState({pip_active});");
            webview.evaluate_javascript(&script);
        }
        crate::app::enhanced::EnhancedAction::StartPipDrag => {
            window.start_pip_drag();
        }
        crate::app::enhanced::EnhancedAction::StartPipResize { direction } => {
            window.start_pip_resize(direction);
        }
        crate::app::enhanced::EnhancedAction::RequestThumbnail { time, max_width } => {
            let _ = thumbnail_tx.send(ThumbnailCmd::Request {
                time_sec: time,
                max_width: max_width.unwrap_or(DEFAULT_THUMB_MAX_WIDTH),
            });
        }
        crate::app::enhanced::EnhancedAction::SetThumbnailPreview { enabled } => {
            let mut mgr = enhanced.borrow_mut();
            mgr.set_thumbnail_preview(enabled);
            let _ = thumbnail_tx.send(ThumbnailCmd::SetEnabled(enabled));
            if enabled && let Some(url) = active_stream_url.borrow().clone() {
                let _ = thumbnail_tx.send(ThumbnailCmd::SetSource(Some(url)));
            }
            let running = is_server_running(server);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::SetShellPreference { key, value } => {
            let settings = gtk::gio::Settings::new(crate::app::config::APP_ID);
            match key.as_str() {
                "rememberWindowState" => {
                    if let Some(v) = value.as_bool() {
                        settings.set_boolean("remember-window-state", v).ok();
                    }
                }
                "noWindowDecorations" => {
                    if let Some(v) = value.as_bool() {
                        settings.set_boolean("no-window-decorations", v).ok();
                    }
                }
                "nativeTitlebar" => {
                    if let Some(v) = value.as_bool() {
                        settings.set_boolean("native-titlebar", v).ok();
                    }
                }
                "systemTheme" => {
                    if let Some(v) = value.as_bool() {
                        settings.set_boolean("system-theme", v).ok();
                    }
                }
                "kdeTheme" => {
                    if let Some(v) = value.as_bool() {
                        settings.set_boolean("kde-theme", v).ok();
                    }
                }
                "mpvConfigLocation" => {
                    if let Some(v) = value.as_str() {
                        settings.set_string("mpv-config-location", v).ok();
                    }
                }
                other => {
                    warn!("Unknown shell preference key: {other}");
                }
            }
            let running = is_server_running(server);
            let data = enhanced.borrow().ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::BrowseMpvConfigFile => {
            let choose_file = window.choose_mpv_config_file();
            let webview = webview.clone();
            let enhanced = enhanced.clone();
            let server = server.clone();
            spawn_local!(async move {
                if let Some(path) = choose_file.await {
                    let value = path.to_string_lossy().to_string();
                    let settings = gtk::gio::Settings::new(crate::app::config::APP_ID);
                    settings.set_string("mpv-config-location", &value).ok();

                    let running = is_server_running(&server);
                    let data = enhanced.borrow().ui_data(running);
                    if let Ok(json) = serde_json::to_string(&data) {
                        let script = format!(
                            "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                        );
                        webview.evaluate_javascript(&script);
                    }
                }
            });
        }
        crate::app::enhanced::EnhancedAction::OpenShadersFolder => {
            enhanced.borrow().open_shaders_folder();
        }
        crate::app::enhanced::EnhancedAction::SetShaderPreset { id, preset } => {
            let shaders_dir = enhanced.borrow().shaders_dir.clone();
            let preset_def = crate::app::enhanced::shaders::find_preset(&preset);
            let is_off_or_installed = preset == "off"
                || preset_def.is_some_and(|def| {
                    crate::app::enhanced::shaders::is_preset_installed(&shaders_dir, def)
                });

            if is_off_or_installed {
                let paths =
                    crate::app::enhanced::shaders::resolve_preset_paths(&shaders_dir, &preset);
                video.set_glsl_shaders(&paths);
                enhanced.borrow_mut().set_shader_preset(&preset);

                let id_json = serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_string());
                let preset_json =
                    serde_json::to_string(&preset).unwrap_or_else(|_| "\"off\"".to_string());
                webview.evaluate_javascript(&format!(
                    "window.__receiveShaderPresetResult && window.__receiveShaderPresetResult({id_json}, true, {preset_json}, null);"
                ));

                let running = is_server_running(server);
                let data = enhanced.borrow().ui_data(running);
                if let Ok(json) = serde_json::to_string(&data) {
                    webview.evaluate_javascript(&format!(
                        "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                    ));
                }
            } else {
                let webview = webview.clone();
                let video = video.clone();
                let enhanced = enhanced.clone();
                let server = server.clone();
                spawn_local!(async move {
                    let preset_dl = preset.clone();
                    let shaders_dir_dl = shaders_dir.clone();
                    let result = tokio::task::spawn_blocking(move || {
                        crate::app::enhanced::shaders::ensure_preset_downloaded(
                            &shaders_dir_dl,
                            &preset_dl,
                        )
                    })
                    .await
                    .unwrap_or_else(|e| Err(format!("Shader task panicked: {e}")));

                    let id_json = serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".to_string());
                    let preset_json =
                        serde_json::to_string(&preset).unwrap_or_else(|_| "\"off\"".to_string());

                    match result {
                        Ok(paths) => {
                            video.set_glsl_shaders(&paths);
                            enhanced.borrow_mut().set_shader_preset(&preset);
                            webview.evaluate_javascript(&format!(
                                "window.__receiveShaderPresetResult && window.__receiveShaderPresetResult({id_json}, true, {preset_json}, null);"
                            ));

                            let running = is_server_running(&server);
                            let data = enhanced.borrow().ui_data(running);
                            if let Ok(json) = serde_json::to_string(&data) {
                                webview.evaluate_javascript(&format!(
                                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                                ));
                            }
                        }
                        Err(err) => {
                            error!("[Shaders] Failed to apply preset {preset}: {err}");
                            let err_json = serde_json::to_string(&err)
                                .unwrap_or_else(|_| "\"Error\"".to_string());
                            webview.evaluate_javascript(&format!(
                                "window.__receiveShaderPresetResult && window.__receiveShaderPresetResult({id_json}, false, {preset_json}, {err_json});"
                            ));
                        }
                    }
                });
            }
        }
        crate::app::enhanced::EnhancedAction::GetPlaybackStats { id } => {
            let stats = video.get_playback_stats();
            if let Ok(json) = serde_json::to_string(&stats) {
                let script = format!(
                    "window.__receivePlaybackStats && window.__receivePlaybackStats({id:?}, {json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::GetChapters => {
            let chapters = video.get_chapters();
            if let Ok(json) = serde_json::to_string(&chapters) {
                let script =
                    format!("window.__receiveChapters && window.__receiveChapters({json});");
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::SetChapterMarkers { enabled } => {
            let mut mgr = enhanced.borrow_mut();
            mgr.set_chapter_markers(enabled);
            let running = is_server_running(server);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::SelfUpdateAppImage {
            id,
            download_url,
            expected_version,
        } => {
            info!("[SelfUpdate] Starting self-update to v{expected_version}");
            let (tx, rx) = flume::unbounded::<crate::app::enhanced::updater::UpdateProgressEvent>();
            let webview_prog = webview.clone();
            let id_prog = id.clone();
            spawn_local!(async move {
                while let Ok(evt) = rx.recv_async().await {
                    if let Ok(json) = serde_json::to_string(&evt) {
                        let script = format!(
                            "window.__receiveAppImageUpdateProgress && window.__receiveAppImageUpdateProgress({id_prog:?}, {json});"
                        );
                        webview_prog.evaluate_javascript(&script);
                    }
                }
            });

            let webview_done = webview.clone();
            let id_done = id.clone();
            spawn_local!(async move {
                let tx_dl = tx.clone();
                if let Err(err) = crate::app::enhanced::updater::download_and_replace_appimage(
                    download_url,
                    tx_dl,
                )
                .await
                {
                    error!("[SelfUpdate] {err}");
                    let evt = crate::app::enhanced::updater::UpdateProgressEvent {
                        phase: "error".to_string(),
                        percent: 0,
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        message: err.clone(),
                        error: Some(err),
                    };
                    if let Ok(json) = serde_json::to_string(&evt) {
                        let script = format!(
                            "window.__receiveAppImageUpdateProgress && window.__receiveAppImageUpdateProgress({id_done:?}, {json});"
                        );
                        webview_done.evaluate_javascript(&script);
                    }
                }
                drop(tx);
            });
        }
        crate::app::enhanced::EnhancedAction::RestartApp => {
            if let Err(err) = crate::app::enhanced::updater::relaunch_appimage() {
                error!("[SelfUpdate] {err}");
            } else {
                app.quit();
            }
        }
    }
}

impl Application {
    pub fn set_server(&self, server: Rc<RefCell<crate::server::Server>>) {
        *self.server.borrow_mut() = Some(server);
    }

    pub fn reload_webview(&self, bypass_cache: bool) {
        let Some(ref webview) = *self.webview.borrow() else {
            return;
        };

        if let Some(ref enhanced_rc) = *self.enhanced.borrow() {
            let mut mgr = enhanced_rc.borrow_mut();
            mgr.reload();
            let running = is_server_running(&self.server.borrow());
            let initial_data = serde_json::to_string(&mgr.ui_data(running)).unwrap_or_default();
            let init_script = format!("window.__INITIAL_ENHANCED_DATA__ = {initial_data};\n");
            webview.set_initial_data_script(&init_script);
            let theme_css = mgr.active_theme().map(|t| t.content.clone());
            webview.set_theme_css(theme_css.as_deref());
        }

        webview.reload(bypass_cache);
    }

    pub fn toggle_devtools(&self) {
        if let Some(ref webview) = *self.webview.borrow() {
            webview.toggle_devtools();
        }
    }
}

#[glib::object_subclass]
impl ObjectSubclass for Application {
    const NAME: &'static str = "Application";
    type Type = super::Application;
    type ParentType = adw::Application;
}

#[glib::derived_properties]
impl ObjectImpl for Application {}

impl ApplicationImpl for Application {
    fn startup(&self) {
        self.parent_startup();

        let app = self.obj();
        app.setup_actions();
        app.setup_accels();
        app.setup_css();
    }

    fn activate(&self) {
        self.parent_activate();

        let app = self.obj();

        if let Some(window) = app.active_window() {
            window.present();
            return;
        }

        let tray = Tray::default();
        let video = Video::default();
        let mpris = Mpris::default();
        let discord = Discord::new();

        let startup_url = self.startup_url.borrow();
        let dev_mode = self.dev_mode.get();

        let server_running = is_server_running(&self.server.borrow());

        // Load plugins and themes from ~/.config/stremio-enhanced/
        let enhanced = Rc::new(RefCell::new(EnhancedManager::new()));

        {
            let mgr = enhanced.borrow();
            if mgr.settings.shader_preset != "off" {
                let paths = crate::app::enhanced::shaders::resolve_preset_paths(
                    &mgr.shaders_dir,
                    &mgr.settings.shader_preset,
                );
                if !paths.is_empty() {
                    video.set_glsl_shaders(&paths);
                }
            }
        }

        let webview = WebView::default();
        webview.inject_script(PRELOAD_SCRIPT);

        // Inject initial enhanced data so the active theme and plugins are known immediately
        let initial_data =
            serde_json::to_string(&enhanced.borrow().ui_data(server_running)).unwrap_or_default();
        let init_script = format!("window.__INITIAL_ENHANCED_DATA__ = {initial_data};\n");
        webview.set_initial_data_script(&init_script);

        webview.inject_script(crate::app::enhanced::ENHANCED_SCRIPT);

        if let Some(theme) = enhanced.borrow().active_theme() {
            webview.inject_theme_css(&theme.content);
            info!(
                "Theme loaded: {} v{} by {} ({})",
                theme.metadata.name, theme.metadata.version, theme.metadata.author, theme.file_name
            );
        }

        webview.dev_mode(dev_mode);

        let window = Window::new(&app);
        window.set_property("decorations", self.decorations.get());
        window.set_underlay(&video);
        window.set_overlay(&webview);

        let key_controller = gtk::EventControllerKey::new();
        key_controller.set_propagation_phase(gtk::PropagationPhase::Capture);
        key_controller.connect_key_pressed(clone!(
            #[weak]
            app,
            #[upgrade_or]
            glib::Propagation::Proceed,
            move |_, key, _, state| {
                let mods = state
                    & (gtk::gdk::ModifierType::CONTROL_MASK
                        | gtk::gdk::ModifierType::SHIFT_MASK
                        | gtk::gdk::ModifierType::ALT_MASK
                        | gtk::gdk::ModifierType::SUPER_MASK);

                if key == gtk::gdk::Key::F12 && mods.is_empty() {
                    app.toggle_devtools();
                    return glib::Propagation::Stop;
                }

                if matches!(key, gtk::gdk::Key::r | gtk::gdk::Key::R) {
                    if mods == gtk::gdk::ModifierType::CONTROL_MASK {
                        app.reload_webview(false);
                        return glib::Propagation::Stop;
                    }
                    if mods
                        == (gtk::gdk::ModifierType::CONTROL_MASK
                            | gtk::gdk::ModifierType::SHIFT_MASK)
                    {
                        app.reload_webview(true);
                        return glib::Propagation::Stop;
                    }
                }

                glib::Propagation::Proceed
            }
        ));
        window.add_controller(key_controller);

        let (thumb_script_tx, thumb_script_rx) = flume::unbounded::<String>();
        let initial_thumb_enabled = enhanced.borrow().settings.thumbnail_preview;
        let (thumbnail_tx, _thumbnail_handle) =
            spawn_thumbnail_worker(thumb_script_tx, initial_thumb_enabled);
        let active_stream_url: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));

        spawn_local!(clone!(
            #[weak]
            webview,
            async move {
                while let Ok(script) = thumb_script_rx.recv_async().await {
                    webview.evaluate_javascript(&script);
                }
            }
        ));

        video.connect_playback_started(clone!(
            #[weak]
            video,
            #[weak]
            webview,
            #[weak]
            mpris,
            move || {
                video.set_visible(true);
                webview.set_transparent(true);
                mpris.start();
            }
        ));

        let thumbnail_tx_ready = thumbnail_tx.clone();
        let active_stream_url_ready = active_stream_url.clone();
        video.connect_video_ready(clone!(
            #[weak]
            video,
            #[weak]
            webview,
            move || {
                let url = active_stream_url_ready.borrow().clone();
                let _ = thumbnail_tx_ready.send(ThumbnailCmd::SetSource(url));
                let chapters = video.get_chapters();
                if let Ok(json) = serde_json::to_string(&chapters) {
                    let script =
                        format!("window.__receiveChapters && window.__receiveChapters({json});");
                    webview.evaluate_javascript(&script);
                }
            }
        ));

        let thumbnail_tx_ended = thumbnail_tx.clone();
        video.connect_playback_ended(clone!(
            #[weak]
            window,
            #[weak]
            video,
            #[weak]
            webview,
            #[weak]
            mpris,
            move |reason| {
                video.set_visible(false);
                webview.set_transparent(false);
                let _ = thumbnail_tx_ended.send(ThumbnailCmd::SetSource(None));
                webview.evaluate_javascript(
                    "window.__receiveChapters && window.__receiveChapters([]);",
                );
                mpris.stop();
                window.enable_idling();

                let error = (reason == "error").then(|| "Stream failed to load".to_string());
                let message = ipc::create_response(IpcEvent::Mpv(IpcEventMpv::Ended((
                    reason.to_string(),
                    error,
                ))));
                webview.send(&message);
            }
        ));

        video.connect_mpv_property_change(clone!(
            #[weak]
            webview,
            move |name, value| {
                let message = ipc::create_response(IpcEvent::Mpv(IpcEventMpv::Change((
                    name.to_string(),
                    value,
                ))));

                webview.send(&message);
            }
        ));

        let deeplink = self.deeplink.clone();
        let enhanced_for_ipc = enhanced.clone();
        let server_for_ipc = self.server.borrow().clone();
        let thumbnail_tx_for_ipc = thumbnail_tx.clone();
        let active_stream_url_for_ipc = active_stream_url.clone();
        let dev_mode_for_ipc = dev_mode;
        webview.connect_ipc(clone!(
            #[weak]
            app,
            #[weak]
            window,
            #[weak]
            video,
            #[weak]
            mpris,
            move |webview: WebView, message: &str| {
                if let Ok(action) =
                    serde_json::from_str::<crate::app::enhanced::EnhancedAction>(message)
                {
                    handle_enhanced_action(
                        EnhancedActionContext {
                            app: &app,
                            window: &window,
                            webview: &webview,
                            video: &video,
                            enhanced: &enhanced_for_ipc,
                            server: &server_for_ipc,
                            thumbnail_tx: &thumbnail_tx_for_ipc,
                            active_stream_url: &active_stream_url_for_ipc,
                            dev_mode: dev_mode_for_ipc,
                        },
                        action,
                    );
                    return;
                }
                if let Ok(event) = ipc::parse_request(message) {
                    match event {
                        IpcEvent::Init => {
                            let message = ipc::create_response(IpcEvent::Init);
                            webview.send(&message);
                        }
                        IpcEvent::Ready => {
                            if let Some(ref uri) = *deeplink.borrow() {
                                let message =
                                    ipc::create_response(IpcEvent::OpenMedia(uri.to_string()));
                                webview.send(&message);
                            }
                        }
                        IpcEvent::Fullscreen(state) => {
                            if state && window.is_pip() {
                                window.set_pip(false);
                                webview.evaluate_javascript(
                                    "window.__syncPipState && window.__syncPipState(false);",
                                );
                            }
                            window.set_fullscreen(state);

                            let message = ipc::create_response(IpcEvent::Fullscreen(state));
                            webview.send(&message);
                        }
                        IpcEvent::MediaStatus(status) => {
                            mpris.set_status(status);

                            if status {
                                window.enable_idling();
                            } else {
                                window.disable_idling();
                            }
                        }
                        IpcEvent::MediaMetadata((title, artist, artwork)) => {
                            mpris.set_metadata(title, artist, artwork);
                        }
                        IpcEvent::Quit => {
                            app.quit();
                        }
                        IpcEvent::Discord(event) => match event {
                            IpcEventDiscord::Connect => {
                                let connected = discord.connect();
                                let message = ipc::create_response(IpcEvent::Discord(
                                    IpcEventDiscord::Status(connected),
                                ));
                                webview.send(&message);
                            }
                            IpcEventDiscord::Disconnect => discord.disconnect(),
                            IpcEventDiscord::SetActivity((details, state, image)) => {
                                discord.set_activity(details, state, image)
                            }
                            IpcEventDiscord::ClearActivity => discord.clear_activity(),
                            _ => {}
                        },
                        IpcEvent::Mpv(event) => match event {
                            IpcEventMpv::Observe(name) => video.observe_mpv_property(name),
                            IpcEventMpv::Command((name, args)) => {
                                match name.as_str() {
                                    "loadfile" => {
                                        if let Some(url) = args.first() {
                                            *active_stream_url_for_ipc.borrow_mut() =
                                                Some(url.clone());
                                            let _ = thumbnail_tx_for_ipc
                                                .send(ThumbnailCmd::SetSource(None));
                                        }
                                        video.set_playing(true);
                                        video.set_visible(true);
                                        webview.set_transparent(true);
                                    }
                                    "stop" => {
                                        *active_stream_url_for_ipc.borrow_mut() = None;
                                        let _ = thumbnail_tx_for_ipc
                                            .send(ThumbnailCmd::SetSource(None));
                                        video.set_playing(false);
                                        video.set_visible(false);
                                        webview.set_transparent(false);
                                    }
                                    _ => {}
                                }
                                video.send_mpv_command(name, args)
                            }
                            IpcEventMpv::Set((name, value)) => video.set_mpv_property(name, value),
                            _ => {}
                        },
                        _ => {}
                    }
                }
            }
        ));

        webview.connect_fullscreen(clone!(
            #[weak]
            window,
            #[weak]
            webview,
            move |fullscreen: bool| {
                if fullscreen && window.is_pip() {
                    window.set_pip(false);
                    webview.evaluate_javascript(
                        "window.__syncPipState && window.__syncPipState(false);",
                    );
                }
                window.set_fullscreen(fullscreen);
            }
        ));

        let enhanced_ref = enhanced.clone();
        let server_ref = self.server.borrow().clone();
        let thumbnail_tx_ref = thumbnail_tx.clone();
        let active_stream_url_ref = active_stream_url.clone();
        let dev_mode_flag = dev_mode;
        webview.connect_enhanced_ipc(clone!(
            #[weak]
            app,
            #[weak]
            window,
            #[weak]
            video,
            move |webview: WebView, message: &str| {
                match serde_json::from_str::<crate::app::enhanced::EnhancedAction>(message) {
                    Ok(action) => {
                        handle_enhanced_action(
                            EnhancedActionContext {
                                app: &app,
                                window: &window,
                                webview: &webview,
                                video: &video,
                                enhanced: &enhanced_ref,
                                server: &server_ref,
                                thumbnail_tx: &thumbnail_tx_ref,
                                active_stream_url: &active_stream_url_ref,
                                dev_mode: dev_mode_flag,
                            },
                            action,
                        );
                    }
                    Err(e) => {
                        error!("Failed to parse enhanced IPC message '{message}': {e}");
                    }
                }
            }
        ));

        webview.connect_open_external(clone!(
            #[weak]
            window,
            move |data| {
                if data.starts_with("application/octet-stream") {
                    spawn_local!(async move {
                        match utils::download_file("playlist.m3u8", data).await {
                            Ok(file_path) => window.open_file(file_path),
                            Err(e) => error!("Failed to download file: {e}"),
                        }
                    });
                } else {
                    window.open_uri(data);
                }
            }
        ));

        window.connect_visibility(clone!(
            #[weak]
            webview,
            #[weak]
            tray,
            move |state| {
                let message = ipc::create_response(IpcEvent::Visibility(state));
                webview.send(&message);

                tray.update(state);
            }
        ));
        tray.connect_show(clone!(
            #[weak]
            window,
            move || {
                window.set_visible(true);
            }
        ));

        tray.connect_hide(clone!(
            #[weak]
            window,
            move || {
                window.set_visible(false);
            }
        ));

        tray.connect_quit(clone!(
            #[weak]
            app,
            move || {
                app.quit();
            }
        ));

        mpris.connect_paused(clone!(
            #[weak]
            webview,
            move |paused| {
                let message = ipc::create_response(IpcEvent::MediaStatus(paused));
                webview.send(&message);
            }
        ));

        mpris.connect_raise(clone!(
            #[weak]
            window,
            move || {
                window.activate();
            }
        ));

        webview.load_uri(&startup_url);

        window.present();

        gtk::glib::idle_add_local_once(clone!(
            #[weak]
            video,
            #[weak]
            webview,
            move || {
                if !video.is_playing() {
                    video.set_visible(false);
                    webview.set_transparent(false);
                }
            }
        ));

        *self.tray.borrow_mut() = Some(tray);
        *self.mpris.borrow_mut() = Some(mpris);
        *self.window.borrow_mut() = Some(window);
        *self.webview.borrow_mut() = Some(webview);
        *self.enhanced.borrow_mut() = Some(enhanced.clone());
        *self.thumbnail_tx.borrow_mut() = Some(thumbnail_tx);
    }

    fn open(&self, files: &[gtk::gio::File], hint: &str) {
        self.parent_open(files, hint);

        if let Some(file) = files.first() {
            let uri = file.uri().to_string();
            if uri.starts_with(URI_SCHEME) {
                let mut deeplink = self.deeplink.borrow_mut();
                *deeplink = Some(uri.clone());

                if let Some(ref webview) = *self.webview.borrow() {
                    let message = ipc::create_response(IpcEvent::OpenMedia(uri));
                    webview.send(&message);
                }
            }
        }

        self.activate();
    }

    fn shutdown(&self) {
        if let Some(tx) = self.thumbnail_tx.borrow_mut().take() {
            let _ = tx.send(ThumbnailCmd::SetEnabled(false));
        }

        if let Some(ref server_rc) = *self.server.borrow() {
            let _ = server_rc.borrow_mut().stop();
        }

        if let Some(window) = self.window.take() {
            window.destroy();
        }

        self.parent_shutdown();
    }
}

impl GtkApplicationImpl for Application {}
impl AdwApplicationImpl for Application {}
