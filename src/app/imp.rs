use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::{prelude::*, subclass::prelude::*};
use gtk::glib::{self, Properties, clone};
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
        video::Video,
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
}

fn handle_enhanced_action(
    webview: &WebView,
    enhanced: &Rc<RefCell<EnhancedManager>>,
    server: &Option<Rc<RefCell<crate::server::Server>>>,
    dev_mode: bool,
    action: crate::app::enhanced::EnhancedAction,
) {
    match action {
        crate::app::enhanced::EnhancedAction::GetData => {
            let mut mgr = enhanced.borrow_mut();
            mgr.reload();
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
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
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
            let status = enhanced.borrow().get_server_status(running);
            if let Ok(json) = serde_json::to_string(&status) {
                let script = format!(
                    "window.__receiveServerStatus && window.__receiveServerStatus({id:?}, {json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::StartStreamingServer { id } => {
            let mut success = false;
            if let Some(s_rc) = server {
                success = s_rc.borrow_mut().restart(dev_mode).unwrap_or(false);
            }
            let script = format!(
                "window.__receiveServerStartResult && window.__receiveServerStartResult({id:?}, {success});"
            );
            webview.evaluate_javascript(&script);
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
        crate::app::enhanced::EnhancedAction::TogglePlugin {
            file_name,
            enabled,
        } => {
            info!("Toggling plugin {file_name}: {enabled}");
            enhanced.borrow_mut().toggle_plugin(&file_name, enabled);
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
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
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
            let data = enhanced.borrow().ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
        crate::app::enhanced::EnhancedAction::Log { level, message } => {
            match level.as_str() {
                "error" => error!("{message}"),
                "warn" => warn!("{message}"),
                _ => info!("{message}"),
            }
        }
        crate::app::enhanced::EnhancedAction::HttpGet { id, url } => {
            let webview = webview.clone();
            spawn_local!(async move {
                let res = tokio::process::Command::new("curl")
                    .args(["-4", "-sL", "--connect-timeout", "10", "--max-time", "25", "-w", "\n%{http_code}", &url])
                    .output()
                    .await;

                let output = match res {
                    Ok(out) if out.status.success() => Ok(out),
                    _ => {
                        tokio::process::Command::new("curl")
                            .args(["-sL", "--connect-timeout", "10", "--max-time", "25", "-w", "\n%{http_code}", &url])
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
                            let body_json = serde_json::to_string(body).unwrap_or_else(|_| "\"\"".to_string());
                            let script = format!("window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, {status}, {body_json});");
                            webview.evaluate_javascript(&script);
                        } else {
                            let body_json = serde_json::to_string(&stdout).unwrap_or_else(|_| "\"\"".to_string());
                            let script = format!("window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 200, {body_json});");
                            webview.evaluate_javascript(&script);
                        }
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        error!("Curl failed for {url}: {stderr}");
                        let script = format!("window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 500, \"Curl error\");");
                        webview.evaluate_javascript(&script);
                    }
                    Err(e) => {
                        error!("Failed to execute curl for {url}: {e}");
                        let script = format!("window.__receiveHttpResponse && window.__receiveHttpResponse({id:?}, 500, \"Exec error\");");
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
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
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
            let running = server
                .as_ref()
                .map(|s| s.borrow_mut().is_running())
                .unwrap_or(false);
            let data = mgr.ui_data(running);
            if let Ok(json) = serde_json::to_string(&data) {
                let script = format!(
                    "window.__receiveEnhancedData && window.__receiveEnhancedData({json});"
                );
                webview.evaluate_javascript(&script);
            }
        }
    }
}

impl Application {
    pub fn set_server(&self, server: Rc<RefCell<crate::server::Server>>) {
        *self.server.borrow_mut() = Some(server);
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

        let server_running = self
            .server
            .borrow()
            .as_ref()
            .map(|s| s.borrow_mut().is_running())
            .unwrap_or(false);

        // Load plugins and themes from ~/.config/stremio-enhanced/
        let enhanced = Rc::new(RefCell::new(EnhancedManager::new()));

        let webview = WebView::default();
        webview.inject_script(PRELOAD_SCRIPT);

        // Inject initial enhanced data so the active theme and plugins are known immediately
        let initial_data =
            serde_json::to_string(&enhanced.borrow().ui_data(server_running)).unwrap_or_default();
        let init_script = format!("window.__INITIAL_ENHANCED_DATA__ = {initial_data};\n");
        webview.inject_script(&init_script);

        webview.inject_script(crate::app::enhanced::ENHANCED_SCRIPT);

        if let Some(theme) = enhanced.borrow().active_theme() {
            webview.inject_theme_css(&theme.content);
            info!(
                "Theme loaded: {} v{} by {} ({})",
                theme.metadata.name,
                theme.metadata.version,
                theme.metadata.author,
                theme.file_name
            );
        }

        webview.dev_mode(dev_mode);

        let window = Window::new(&app);
        window.set_property("decorations", self.decorations.get());
        window.set_underlay(&video);
        window.set_overlay(&webview);

        video.connect_playback_started(clone!(
            #[weak]
            mpris,
            move || {
                mpris.start();
            }
        ));

        video.connect_playback_ended(clone!(
            #[weak]
            window,
            #[weak]
            webview,
            #[weak]
            mpris,
            move |reason| {
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
                if let Ok(action) = serde_json::from_str::<crate::app::enhanced::EnhancedAction>(message) {
                    handle_enhanced_action(&webview, &enhanced_for_ipc, &server_for_ipc, dev_mode_for_ipc, action);
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
            move |fullscreen: bool| {
                window.set_fullscreen(fullscreen);
            }
        ));

        let enhanced_ref = enhanced.clone();
        let server_ref = self.server.borrow().clone();
        let dev_mode_flag = dev_mode;
        webview.connect_enhanced_ipc(clone!(
            #[weak]
            webview,
            move |_webview: WebView, message: &str| {
                match serde_json::from_str::<crate::app::enhanced::EnhancedAction>(message) {
                    Ok(action) => {
                        handle_enhanced_action(&webview, &enhanced_ref, &server_ref, dev_mode_flag, action);
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

        *self.tray.borrow_mut() = Some(tray);
        *self.mpris.borrow_mut() = Some(mpris);
        *self.window.borrow_mut() = Some(window);
        *self.webview.borrow_mut() = Some(webview);
        *self.enhanced.borrow_mut() = Some(enhanced.clone());
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
