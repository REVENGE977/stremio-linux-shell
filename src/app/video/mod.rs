mod config;
mod imp;
pub mod thumbnailer;

use std::path::PathBuf;

use adw::subclass::prelude::ObjectSubclassIsExt;
use gtk::glib::{self, Variant, closure_local, object::ObjectExt};
use itertools::Itertools;
use libmpv2::Format;
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use tracing::warn;

use crate::app::video::config::{BOOL_PROPERTIES, FLOAT_PROPERTIES, STRING_PROPERTIES};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInfo {
    pub title: String,
    pub time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStats {
    pub media_title: Option<String>,
    pub path: Option<String>,
    pub video_codec: Option<String>,
    pub video_format: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub dwidth: Option<i64>,
    pub dheight: Option<i64>,
    pub output_width: Option<i64>,
    pub output_height: Option<i64>,
    pub container_fps: Option<f64>,
    pub estimated_vf_fps: Option<f64>,
    pub display_fps: Option<f64>,
    pub hwdec_current: Option<String>,
    pub video_bitrate: Option<f64>,
    pub color_primaries: Option<String>,
    pub color_gamma: Option<String>,
    pub color_matrix: Option<String>,
    pub sig_peak: Option<f64>,
    pub pixel_format: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_channels: Option<String>,
    pub audio_sample_rate: Option<i64>,
    pub audio_bitrate: Option<f64>,
    pub dropped_frames: Option<i64>,
    pub decoder_dropped_frames: Option<i64>,
    pub mistimed_frames: Option<i64>,
    pub avsync: Option<f64>,
    pub cache_duration: Option<f64>,
    pub cache_speed: Option<f64>,
    pub paused_for_cache: bool,
    pub speed: Option<f64>,
    pub volume: Option<f64>,
    pub time_pos: Option<f64>,
    pub duration: Option<f64>,
    pub active_shaders: Vec<String>,
}

glib::wrapper! {
    pub struct Video(ObjectSubclass<imp::Video>)
        @extends gtk::GLArea, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl Default for Video {
    fn default() -> Self {
        glib::Object::builder()
            .property("hexpand", true)
            .property("vexpand", true)
            .build()
    }
}

impl Video {
    pub fn connect_mpv_property_change<T: Fn(&str, Value) + 'static>(&self, callback: T) {
        self.connect_closure(
            "property-changed",
            false,
            closure_local!(move |_: Video, name: &str, value: Variant| {
                match name {
                    name if FLOAT_PROPERTIES.contains(&name) => {
                        if let Some(value) = value.get::<f64>() {
                            callback(name, Value::Number(Number::from_f64(value).unwrap()))
                        }
                    }
                    name if BOOL_PROPERTIES.contains(&name) => {
                        if let Some(value) = value.get::<bool>() {
                            callback(name, Value::Bool(value))
                        }
                    }
                    name if STRING_PROPERTIES.contains(&name) => {
                        if let Some(value) = value.get::<String>() {
                            if let Ok(json_value) = serde_json::from_str::<Value>(&value) {
                                callback(name, json_value)
                            } else {
                                callback(name, Value::String(value))
                            }
                        }
                    }
                    _ => {}
                };
            }),
        );
    }

    pub fn connect_playback_started<T: Fn() + 'static>(&self, callback: T) {
        self.connect_closure(
            "playback-started",
            false,
            closure_local!(move |_: Video| {
                callback();
            }),
        );
    }

    pub fn connect_video_ready<T: Fn() + 'static>(&self, callback: T) {
        self.connect_closure(
            "video-ready",
            false,
            closure_local!(move |_: Video| {
                callback();
            }),
        );
    }

    pub fn connect_playback_ended<T: Fn(&str) + 'static>(&self, callback: T) {
        self.connect_closure(
            "playback-ended",
            false,
            closure_local!(move |_: Video, reason: &str| {
                callback(reason);
            }),
        );
    }

    pub fn send_mpv_command(&self, name: String, args: Vec<String>) {
        let widget = self.imp();

        let args = args.iter().map(String::as_ref).collect_vec();
        widget.send_command(&name, &args);
    }

    pub fn observe_mpv_property(&self, name: String) {
        let widget = self.imp();

        match name.as_str() {
            name if FLOAT_PROPERTIES.contains(&name) => {
                widget.observe_property(name, Format::Double);
            }
            name if BOOL_PROPERTIES.contains(&name) => {
                widget.observe_property(name, Format::Flag);
            }
            name if STRING_PROPERTIES.contains(&name) => {
                widget.observe_property(name, Format::String);
            }
            _ => warn!("Failed to observe property {name}: Unsupported"),
        };
    }

    pub fn set_mpv_property(&self, name: String, value: Value) {
        let widget = self.imp();

        match name.as_str() {
            "vo" => {
                // vo is handled by GTK GLArea mpv render context and cannot be changed at runtime
            }
            "hwdec" => {
                if let Some(value) = value.as_str() {
                    // Stremio Web requests "auto-copy", which forces GPU->RAM->GPU copy-back
                    // (e.g. vaapi-copy) and bottlenecks 4K 10-bit streams on integrated GPUs.
                    // Use "auto-safe" to prefer zero-copy EGL dmabuf interop first while still
                    // falling back automatically if zero-copy isn't supported.
                    let hwdec = if value == "auto-copy" {
                        "auto-safe"
                    } else {
                        value
                    };
                    widget.set_property("hwdec", hwdec);
                }
            }
            name if FLOAT_PROPERTIES.contains(&name) => {
                if let Some(value) = value.as_f64() {
                    widget.set_property(name, value);
                }
            }
            name if BOOL_PROPERTIES.contains(&name) => {
                if let Some(value) = value.as_bool() {
                    widget.set_property(name, value);
                }
            }
            name if STRING_PROPERTIES.contains(&name) => {
                if let Some(value) = value.as_str() {
                    widget.set_property(name, value);
                }
            }
            name => warn!("Failed to set property {name}: Unsupported"),
        };
    }

    pub fn set_glsl_shaders(&self, paths: &[PathBuf]) {
        self.imp().set_glsl_shaders(paths);
    }

    pub fn get_chapters(&self) -> Vec<ChapterInfo> {
        self.imp().get_chapters()
    }

    pub fn get_playback_stats(&self) -> PlaybackStats {
        self.imp().get_playback_stats()
    }

    pub fn is_playing(&self) -> bool {
        self.imp().is_playing.get()
    }

    pub fn set_playing(&self, playing: bool) {
        self.imp().is_playing.set(playing);
    }
}
