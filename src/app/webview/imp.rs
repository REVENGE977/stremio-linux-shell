use std::cell::Cell;

use adw::subclass::prelude::*;
use gtk::{
    GestureClick,
    gdk::RGBA,
    glib::{self, clone},
    prelude::*,
};
use webkit::{HardwareAccelerationPolicy, WebView as WebKitWebView, prelude::*};

use super::ext::SettingsExt;

#[derive(Default)]
pub struct WebView {
    pub webview: WebKitWebView,
    pub transparent: Cell<bool>,
}

#[glib::object_subclass]
impl ObjectSubclass for WebView {
    const NAME: &'static str = "WebView";
    type Type = super::WebView;
    type ParentType = gtk::Box;
}

impl ObjectImpl for WebView {
    fn constructed(&self) {
        self.parent_constructed();

        let object = self.obj();

        self.webview.set_vexpand(true);
        self.webview.set_hexpand(true);
        self.webview
            .set_background_color(&RGBA::new(0.047, 0.043, 0.071, 1.0));

        if let Some(settings) = WebViewExt::settings(&self.webview) {
            settings.set_enable_media(false);
            settings.set_enable_media_capabilities(false);
            settings.set_enable_media_stream(false);
            settings.set_enable_webaudio(false);
            settings.set_javascript_can_access_clipboard(true);
            settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Always);
            settings.set_enable_smooth_scrolling(true);
            settings.set_enable_page_cache(true);
            settings.set_enable_back_forward_navigation_gestures(false);

            // https://github.com/Stremio/stremio-linux-shell/issues/170
            if webkit::functions::major_version() == 2 && webkit::functions::minor_version() == 54 {
                // Use TextureMapper instead of Skia for layer composition
                if let Some(compositor) = settings.find_feature("UseSkiaForComposition") {
                    settings.set_feature_enabled(&compositor, false);
                }

                // Disable damage tracking for compositing to repaint the entire view.
                if let Some(damage_tracking) =
                    settings.find_feature("UseDamagingInformationForCompositing")
                {
                    settings.set_feature_enabled(&damage_tracking, false);
                }
            }
        }

        let gesture = GestureClick::new();
        gesture.set_button(0);
        gesture.connect_pressed(clone!(
            #[weak(rename_to = webview)]
            self.webview,
            move |gesture, _, _, _| {
                let button = gesture.current_button();
                match button {
                    8 => webview.go_back(),
                    9 => webview.go_forward(),
                    _ => {}
                }
            }
        ));
        self.webview.add_controller(gesture);

        object.append(&self.webview);
    }
}

impl WidgetImpl for WebView {}
impl BoxImpl for WebView {}
