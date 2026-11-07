mod imp;

use adw::subclass::prelude::*;
use gtk::{
    Widget, gio,
    glib::{
        self,
        object::{Cast, IsA},
    },
    prelude::{
        DisplayExt, GtkWindowExt, MonitorExt, NativeExt, SeatExt, SurfaceExt, ToplevelExt,
        WidgetExt,
    },
};

use crate::app::Application;

glib::wrapper! {
    pub struct Window(ObjectSubclass<imp::Window>)
    @extends gtk::Window, gtk::ApplicationWindow, adw::ApplicationWindow, gtk::Widget,
    @implements gio::ActionGroup, gio::ActionMap, gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget, gtk::ShortcutManager, gtk::Native, gtk::Root;
}

impl Window {
    pub fn new(application: &Application) -> Self {
        glib::Object::builder()
            .property("application", application)
            .build()
    }

    pub fn set_underlay(&self, widget: &impl IsA<Widget>) {
        let window = self.imp();

        window.overlay.set_child(Some(widget));
    }

    pub fn set_overlay(&self, widget: &impl IsA<Widget>) {
        let window = self.imp();

        window.overlay.add_overlay(&graphics_offload(widget));
    }

    pub fn is_pip(&self) -> bool {
        self.imp().pip_mode.get()
    }

    pub fn set_fullscreen(&self, fullscreen: bool) {
        if fullscreen && self.imp().pip_mode.get() {
            self.set_pip(false);
        }
        self.imp().show_header(!fullscreen);
        self.set_fullscreened(fullscreen);
    }

    pub fn set_pip(&self, pip: bool) -> bool {
        let imp = self.imp();
        if imp.pip_mode.get() == pip {
            return pip;
        }

        if !pip {
            imp.pip_mode.set(false);
            self.remove_css_class("pip-mode");
            self.set_size_request(400, 406);
            imp.show_header(!self.is_fullscreen());

            let (w, h) = imp.saved_size.get();
            if w > 0 && h > 0 {
                self.set_default_size(w - 1, h - 1);
                self.set_default_size(w, h);
            }

            if imp.was_maximized.replace(false) {
                self.maximize();
            }
        } else {
            if self.is_fullscreen() {
                self.set_fullscreen(false);
            }

            let was_max = self.is_maximized();
            imp.was_maximized.set(was_max);
            if was_max {
                self.unmaximize();
            }

            let cur_w = self.width().max(self.default_width()).max(400);
            let cur_h = self.height().max(self.default_height()).max(406);
            imp.saved_size.set((cur_w, cur_h));

            let work_w = self
                .surface()
                .and_then(|s| s.display().monitor_at_surface(&s))
                .map(|m| m.geometry().width())
                .unwrap_or(1920);
            let pip_w = (work_w * 28 / 100).clamp(400, 640);
            let pip_h = pip_w * 9 / 16;

            imp.pip_mode.set(true);
            self.add_css_class("pip-mode");
            imp.show_header(false);
            self.set_size_request(280, 158);
            self.set_default_size(pip_w - 1, pip_h - 1);
            self.set_default_size(pip_w, pip_h);
        }

        imp.pip_mode.get()
    }

    pub fn start_pip_drag(&self) {
        if !self.imp().pip_mode.get() {
            return;
        }
        let Some(surface) = self.surface() else {
            return;
        };
        let Ok(toplevel) = surface.clone().downcast::<gtk::gdk::Toplevel>() else {
            return;
        };
        let Some(seat) = surface.display().default_seat() else {
            return;
        };
        let Some(pointer) = seat.pointer() else {
            return;
        };
        let (x, y) = surface
            .device_position(&pointer)
            .map(|(x, y, _)| (x, y))
            .unwrap_or((0.0, 0.0));
        toplevel.begin_move(
            &pointer,
            gtk::gdk::BUTTON_PRIMARY as i32,
            x,
            y,
            gtk::gdk::CURRENT_TIME,
        );
    }

    pub fn start_pip_resize(&self, direction: u32) {
        if !self.imp().pip_mode.get() {
            return;
        }
        let edge = match direction {
            10 => gtk::gdk::SurfaceEdge::West,
            11 => gtk::gdk::SurfaceEdge::East,
            12 => gtk::gdk::SurfaceEdge::North,
            13 => gtk::gdk::SurfaceEdge::NorthWest,
            14 => gtk::gdk::SurfaceEdge::NorthEast,
            15 => gtk::gdk::SurfaceEdge::South,
            16 => gtk::gdk::SurfaceEdge::SouthWest,
            17 => gtk::gdk::SurfaceEdge::SouthEast,
            _ => return,
        };
        let Some(surface) = self.surface() else {
            return;
        };
        let Ok(toplevel) = surface.clone().downcast::<gtk::gdk::Toplevel>() else {
            return;
        };
        let Some(seat) = surface.display().default_seat() else {
            return;
        };
        let Some(pointer) = seat.pointer() else {
            return;
        };
        let (x, y) = surface
            .device_position(&pointer)
            .map(|(x, y, _)| (x, y))
            .unwrap_or((0.0, 0.0));
        toplevel.begin_resize(
            edge,
            Some(&pointer),
            gtk::gdk::BUTTON_PRIMARY as i32,
            x,
            y,
            gtk::gdk::CURRENT_TIME,
        );
    }

    pub fn connect_visibility<T: Fn(bool) + 'static>(&self, callback: T) {
        self.connect_visible_notify(move |window| {
            callback(window.is_visible());
        });
    }

    fn request_backgound(&self) {
        self.imp().request_backgound();
    }

    pub fn disable_idling(&self) {
        self.imp().disable_idling();
    }

    pub fn enable_idling(&self) {
        self.imp().enable_idling();
    }

    pub fn open_uri(&self, uri: String) {
        self.imp().open_uri(uri);
    }

    pub fn open_file(&self, file_path: String) {
        self.imp().open_file(file_path);
    }
}

fn graphics_offload(widget: &impl IsA<Widget>) -> gtk::GraphicsOffload {
    gtk::GraphicsOffload::builder()
        .vexpand(true)
        .hexpand(true)
        .child(widget)
        .build()
}
