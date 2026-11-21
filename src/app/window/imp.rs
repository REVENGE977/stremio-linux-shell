use std::{
    cell::{Cell, RefCell},
    fs::File,
    os::fd::AsFd,
    sync::Arc,
};

use ashpd::{
    Uri,
    desktop::{
        Request,
        background::Background,
        inhibit::{InhibitFlags, InhibitOptions, InhibitProxy},
        open_uri::OpenFileRequest,
    },
    enumflags2::BitFlags,
};
use gtk::{
    gio::{Settings, prelude::SettingsExt},
    glib::{self, subclass::InitializingObject},
    prelude::*,
    subclass::prelude::*,
};
use tokio::sync::Mutex;
use tracing::error;

use crate::{
    app::{
        config::{APP_ID, APP_NAME},
        ext::ASHPDExt,
    },
    spawn_local,
    utils::IS_DESKTOP_KDE,
};

#[derive(Default, glib::Properties, gtk::CompositeTemplate)]
#[properties(wrapper_type = super::Window)]
#[template(file = "window.ui")]
pub struct Window {
    #[property(get, set)]
    pub decorations: Cell<bool>,
    pub native_titlebar: Cell<bool>,
    pub pip_mode: Cell<bool>,
    pub was_maximized: Cell<bool>,
    pub saved_size: Cell<(i32, i32)>,
    header: RefCell<Option<adw::HeaderBar>>,
    #[template_child]
    pub overlay: TemplateChild<gtk::Overlay>,
    pub inhibit_request: Arc<Mutex<Option<Request<()>>>>,
}

impl Window {
    pub fn request_backgound(&self) {
        let identifier = self.window_identifier();

        spawn_local!(async move {
            Background::request()
                .identifier(identifier.await)
                .send()
                .await
                .map_err(|e| error!("Failed to set background mode: {e}"))
                .ok();
        });
    }

    pub fn disable_idling(&self) {
        let inhibit_request = self.inhibit_request.clone();
        let identifier = self.window_identifier();

        spawn_local!(async move {
            if let Some(request) = inhibit_request.lock().await.take()
                && let Err(e) = request.close().await
            {
                error!("Failed to close the inhibit request: {e}");
            }

            if let Ok(proxy) = InhibitProxy::new().await {
                let identifier = identifier.await;

                tokio::spawn(async move {
                    let mut flags = BitFlags::empty();
                    flags.insert(InhibitFlags::Idle);

                    let options = InhibitOptions::default()
                        .set_reason("Prevent screen from going blank during media playback");

                    *inhibit_request.lock().await = proxy
                        .inhibit(identifier.as_ref(), flags, options)
                        .await
                        .map_err(|e| error!("Failed to prevent idling: {e}"))
                        .ok();
                });
            }
        });
    }

    pub fn enable_idling(&self) {
        let inhibit_request = self.inhibit_request.clone();

        spawn_local!(async move {
            let mut inhibit_request = inhibit_request.lock().await;
            if let Some(request) = inhibit_request.take() {
                request
                    .close()
                    .await
                    .map_err(|e| error!("Failed to allow idling: {e}"))
                    .ok();
            }
        });
    }

    pub fn open_uri(&self, uri: String) {
        let uri_str = uri.clone();
        if let Ok(parsed_uri) = Uri::parse(&uri) {
            let identifier = self.window_identifier();

            spawn_local!(async move {
                if let Err(e) = OpenFileRequest::default()
                    .identifier(identifier.await)
                    .send_uri(&parsed_uri)
                    .await
                {
                    error!("Failed to open uri via portal: {e}, falling back to GIO/xdg-open");
                    if gtk::gio::AppInfo::launch_default_for_uri(
                        &uri_str,
                        None::<&gtk::gio::AppLaunchContext>,
                    )
                    .is_err()
                    {
                        let _ = std::process::Command::new("xdg-open").arg(&uri_str).spawn();
                    }
                }
            });
        } else if gtk::gio::AppInfo::launch_default_for_uri(
            &uri_str,
            None::<&gtk::gio::AppLaunchContext>,
        )
        .is_err()
        {
            let _ = std::process::Command::new("xdg-open").arg(&uri_str).spawn();
        }
    }

    pub fn open_file(&self, file_path: String) {
        if let Ok(file) = File::open(&file_path) {
            let identifier = self.window_identifier();

            spawn_local!(async move {
                OpenFileRequest::default()
                    .identifier(identifier.await)
                    .send_file(&file.as_fd())
                    .await
                    .map_err(|e| error!("Failed to open file: {e}"))
                    .ok();
            });
        }
    }

    pub fn show_header(&self, state: bool) {
        if let Some(ref header) = *self.header.borrow() {
            header.set_visible(self.decorations.get() && state && !self.pip_mode.get());
        }
    }
}

#[glib::object_subclass]
impl ObjectSubclass for Window {
    const NAME: &'static str = "Window";
    type Type = super::Window;
    type ParentType = gtk::ApplicationWindow;

    fn class_init(klass: &mut Self::Class) {
        klass.bind_template();
    }

    fn instance_init(obj: &InitializingObject<Self>) {
        obj.init_template();
    }
}

#[glib::derived_properties]
impl ObjectImpl for Window {
    fn constructed(&self) {
        self.parent_constructed();

        self.obj().set_title(Some(APP_NAME));

        if cfg!(debug_assertions) {
            self.obj().add_css_class("devel");
        }

        self.obj().connect_fullscreened_notify(|window| {
            window.imp().show_header(!window.is_fullscreen());
        });
    }
}

impl WidgetImpl for Window {
    fn realize(&self) {
        let widget = self.obj();
        let settings = Settings::new(APP_ID);

        let no_window_decorations = settings.boolean("no-window-decorations");
        if no_window_decorations {
            self.decorations.set(false);
        }

        let native_titlebar = settings.boolean("native-titlebar");
        self.native_titlebar.set(native_titlebar);

        // Configure titlebar / CSD vs SSD before parent_realize() creates the surface.
        if !self.decorations.get() {
            widget.set_titlebar(None::<&gtk::Widget>);
            widget.set_decorated(false);
        } else if native_titlebar {
            widget.set_titlebar(None::<&gtk::Widget>);
            widget.set_decorated(true);
        } else {
            let header = adw::HeaderBar::new();
            header.add_css_class("flat");
            if *IS_DESKTOP_KDE && settings.boolean("kde-theme") {
                header.add_css_class("kde");
            }
            widget.set_titlebar(Some(&header));
            widget.set_decorated(true);
            *self.header.borrow_mut() = Some(header);
        }

        self.parent_realize();

        if !self.decorations.get() {
            widget.remove_css_class("csd");
        }

        let remember_window_state = settings.boolean("remember-window-state");
        if remember_window_state {
            let maximized = settings.boolean("window-maximized");
            widget.set_maximized(maximized);

            let fullscreen = settings.boolean("window-fullscreen");
            widget.set_fullscreen(fullscreen);

            if !maximized && !fullscreen {
                let height = settings.int("window-height");
                widget.set_default_height(height);

                let width = settings.int("window-width");
                widget.set_default_width(width);
            }
        }
    }

    fn unrealize(&self) {
        let widget = self.obj();
        let settings = Settings::new(APP_ID);

        let remember_window_state = settings.boolean("remember-window-state");
        if remember_window_state {
            let maximized = widget.is_maximized() || self.was_maximized.get();
            settings.set_boolean("window-maximized", maximized).ok();

            let fullscreen = widget.is_fullscreen();
            settings.set_boolean("window-fullscreen", fullscreen).ok();

            if !maximized && !fullscreen {
                let (width, height) = if self.pip_mode.get() {
                    let (w, h) = self.saved_size.get();
                    if w > 0 && h > 0 {
                        (w, h)
                    } else {
                        (widget.default_width(), widget.default_height())
                    }
                } else {
                    (widget.default_width(), widget.default_height())
                };
                settings.set_int("window-height", height).ok();

                settings.set_int("window-width", width).ok();
            }
        }

        self.parent_unrealize();
    }
}

impl WindowImpl for Window {
    fn activate_default(&self) {
        self.parent_activate_default();

        let widget = self.obj();
        widget.request_backgound();
    }

    fn close_request(&self) -> glib::Propagation {
        self.parent_close_request();

        let widget = self.obj();
        widget.set_visible(false);

        glib::Propagation::Stop
    }
}

impl ApplicationWindowImpl for Window {}
