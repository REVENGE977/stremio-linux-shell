mod config;
mod dialogs;
mod discord;
pub mod enhanced;
mod ext;
mod imp;
mod ipc;
mod mpris;
mod tray;
mod video;
mod webview;
mod window;

use std::{env, fs, path::Path};

use adw::subclass::prelude::ObjectSubclassIsExt;
use gtk::{
    CssProvider,
    gdk::Display,
    gio::{self, ActionEntry, ApplicationFlags, Settings, SettingsSchemaSource, prelude::*},
    glib::{self, ExitCode, Object, clone},
    prelude::*,
};
use itertools::Itertools;
use tracing::info;

use crate::app::{
    config::{APP_ID, APP_NAME, STYLE},
    dialogs::{about::AboutDialog, preferences::PreferencesDialog},
};

glib::wrapper! {
    pub struct Application(ObjectSubclass<imp::Application>)
    @extends gio::Application, gtk::Application, adw::Application,
    @implements gio::ActionGroup, gio::ActionMap;
}

impl Default for Application {
    fn default() -> Self {
        Self::new()
    }
}

impl Application {
    pub fn new() -> Self {
        glib::set_application_name(APP_NAME);

        Object::builder()
            .property("application-id", APP_ID)
            .property("flags", ApplicationFlags::HANDLES_OPEN)
            .build()
    }

    pub fn set_server(&self, server: std::rc::Rc<std::cell::RefCell<crate::server::Server>>) {
        self.imp().set_server(server);
    }

    pub fn run(&self, args: Vec<String>) -> ExitCode {
        let mut program = std::env::args().take(1).collect_vec();
        program.extend(args);
        self.run_with_args(&program)
    }

    fn setup_actions(&self) {
        let quit_action = ActionEntry::builder("quit")
            .activate(|app: &Self, _, _| {
                app.quit();
            })
            .build();

        let show_preferences_action = ActionEntry::builder("show-preferences")
            .activate(|app: &Self, _, _| {
                if let Some(window) = app.active_window() {
                    let dialog = PreferencesDialog::new();
                    dialog.show(&window);
                }
            })
            .build();

        let show_about_action = ActionEntry::builder("show-about")
            .activate(|app: &Self, _, _| {
                if let Some(window) = app.active_window() {
                    let dialog = AboutDialog::new();
                    dialog.show(&window);
                }
            })
            .build();

        self.add_action_entries([quit_action, show_preferences_action, show_about_action]);
    }

    fn setup_accels(&self) {
        self.set_accels_for_action("app.quit", &["<Control>q"]);
        self.set_accels_for_action("app.show-preferences", &["<Control>comma"]);
    }

    fn setup_css(&self) {
        let provider = CssProvider::new();
        provider.load_from_string(STYLE);

        let display = Display::default().expect("Failed to connect to a display");
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        let settings = Settings::new(APP_ID);
        settings.connect_changed(
            Some("system-theme"),
            clone!(
                #[weak(rename_to = app)]
                self,
                move |_, _| {
                    app.apply_system_theme();
                }
            ),
        );
        *self.imp().app_settings.borrow_mut() = Some(settings);

        adw::StyleManager::default().connect_dark_notify(clone!(
            #[weak(rename_to = app)]
            self,
            move |_| {
                app.apply_system_theme();
            }
        ));

        self.apply_system_theme();
    }

    pub fn apply_system_theme(&self) {
        let Some(display) = Display::default() else {
            return;
        };

        if let Some(prev) = self.imp().system_theme_provider.borrow_mut().take() {
            gtk::style_context_remove_provider_for_display(&display, &prev);
        }

        let enabled = Settings::new(APP_ID).boolean("system-theme");
        if !enabled {
            return;
        }

        let Some((theme_name, variant)) = detect_system_gtk_theme() else {
            return;
        };

        info!(
            "Applying system GTK theme: {} (variant: {:?})",
            theme_name, variant
        );
        let provider = CssProvider::new();
        provider.load_named(&theme_name, variant.as_deref());
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION - 1,
        );
        *self.imp().system_theme_provider.borrow_mut() = Some(provider);
    }
}

fn parse_gtk_settings_ini(path: &Path) -> (Option<String>, Option<bool>) {
    let Ok(content) = fs::read_to_string(path) else {
        return (None, None);
    };

    let mut theme = None;
    let mut prefer_dark = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('[') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            if key == "gtk-theme-name" && !value.is_empty() {
                theme = Some(value.to_string());
            } else if key == "gtk-application-prefer-dark-theme" {
                prefer_dark = Some(matches!(value.to_lowercase().as_str(), "1" | "true" | "yes"));
            }
        }
    }

    (theme, prefer_dark)
}

fn detect_system_gtk_theme() -> Option<(String, Option<String>)> {
    let style_is_dark = adw::StyleManager::default().is_dark();

    // 1. Respect explicit GTK_THEME env var (e.g. "Breeze:dark" or "Mint-Y-Dark")
    if let Ok(raw) = env::var("GTK_THEME") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let (name, explicit_variant) = match trimmed.split_once(':') {
                Some((n, v)) if !v.is_empty() => (n.trim(), Some(v.trim().to_string())),
                _ => (trimmed, None),
            };
            if !name.is_empty() && name != "Adwaita-empty" {
                let variant =
                    explicit_variant.or_else(|| style_is_dark.then(|| "dark".to_string()));
                return Some((name.to_string(), variant));
            }
        }
    }

    let mut prefer_dark = None;
    let mut theme_name = None;

    // 2. Check ~/.config/gtk-4.0/settings.ini
    if let Some(cfg_dir) = dirs::config_dir() {
        let (ini_theme, ini_dark) = parse_gtk_settings_ini(&cfg_dir.join("gtk-4.0/settings.ini"));
        if ini_theme.is_some() {
            theme_name = ini_theme;
        }
        if ini_dark.is_some() {
            prefer_dark = ini_dark;
        }
    }

    // 3. Check gsettings org.gnome.desktop.interface gtk-theme (if schema is installed)
    if theme_name.is_none()
        && SettingsSchemaSource::default()
            .and_then(|src| src.lookup("org.gnome.desktop.interface", true))
            .is_some()
    {
        let iface = Settings::new("org.gnome.desktop.interface");
        let val = iface.string("gtk-theme");
        let val = val.trim();
        if !val.is_empty() && val != "Adwaita-empty" {
            theme_name = Some(val.to_string());
        }
    }

    // 4. Fallback to ~/.config/gtk-3.0/settings.ini
    if theme_name.is_none()
        && let Some(cfg_dir) = dirs::config_dir()
    {
        let (ini_theme, ini_dark) = parse_gtk_settings_ini(&cfg_dir.join("gtk-3.0/settings.ini"));
        if ini_theme.is_some() {
            theme_name = ini_theme;
        }
        if prefer_dark.is_none() {
            prefer_dark = ini_dark;
        }
    }

    let name = theme_name.filter(|n| !n.is_empty() && n != "Adwaita-empty")?;
    let use_dark = style_is_dark || prefer_dark.unwrap_or(false);
    let variant = use_dark.then(|| "dark".to_string());
    Some((name, variant))
}
