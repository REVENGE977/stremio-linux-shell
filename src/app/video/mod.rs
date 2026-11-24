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

use crate::app::video::config::{
    BOOL_PROPERTIES, FLOAT_PROPERTIES, INT_PROPERTIES, JSON_STRING_PROPERTIES, STRING_PROPERTIES,
};

#[derive(Debug, PartialEq)]
enum MpvPropertyValue<'a> {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(&'a str),
}

fn is_supported_property(name: &str) -> bool {
    FLOAT_PROPERTIES.contains(&name)
        || BOOL_PROPERTIES.contains(&name)
        || INT_PROPERTIES.contains(&name)
        || STRING_PROPERTIES.contains(&name)
}

fn observe_format_for_property(name: &str) -> Option<Format> {
    match name {
        name if FLOAT_PROPERTIES.contains(&name) => Some(Format::Double),
        name if BOOL_PROPERTIES.contains(&name) => Some(Format::Flag),
        name if STRING_PROPERTIES.contains(&name) => Some(Format::String),
        _ => None,
    }
}

fn parse_observed_string_property(name: &str, value: String) -> Value {
    if JSON_STRING_PROPERTIES.contains(&name)
        && let Ok(json_value) = serde_json::from_str::<Value>(&value)
    {
        json_value
    } else {
        Value::String(value)
    }
}

fn resolve_mpv_set_value<'a>(name: &str, value: &'a Value) -> Option<MpvPropertyValue<'a>> {
    if !is_supported_property(name) {
        return None;
    }

    match value {
        Value::Bool(v) => Some(MpvPropertyValue::Bool(*v)),
        Value::String(v) => Some(MpvPropertyValue::Str(v.as_str())),
        Value::Number(n) => {
            if INT_PROPERTIES.contains(&name) {
                if let Some(v) = n.as_i64() {
                    return Some(MpvPropertyValue::Int(v));
                }
                if let Some(v) = n.as_f64()
                    && v.is_finite()
                    && v.fract() == 0.0
                    && v >= i64::MIN as f64
                    && v <= i64::MAX as f64
                {
                    return Some(MpvPropertyValue::Int(v as i64));
                }
            }
            n.as_f64()
                .filter(|v| v.is_finite())
                .map(MpvPropertyValue::Float)
        }
        _ => None,
    }
}

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
                        if let Some(value) = value.get::<f64>()
                            && let Some(num) = Number::from_f64(value)
                        {
                            callback(name, Value::Number(num))
                        }
                    }
                    name if BOOL_PROPERTIES.contains(&name) => {
                        if let Some(value) = value.get::<bool>() {
                            callback(name, Value::Bool(value))
                        }
                    }
                    name if STRING_PROPERTIES.contains(&name) => {
                        if let Some(value) = value.get::<String>() {
                            callback(name, parse_observed_string_property(name, value))
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

        if let Some(format) = observe_format_for_property(&name) {
            widget.observe_property(&name, format);
        } else {
            warn!("Failed to observe property {name}: Unsupported");
        }
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
            name if is_supported_property(name) => match resolve_mpv_set_value(name, &value) {
                Some(MpvPropertyValue::Bool(v)) => widget.set_property(name, v),
                Some(MpvPropertyValue::Int(v)) => widget.set_property(name, v),
                Some(MpvPropertyValue::Float(v)) => widget.set_property(name, v),
                Some(MpvPropertyValue::Str(v)) => widget.set_property(name, v),
                None => warn!("Failed to set property {name}: Invalid value {value}"),
            },
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn secondary_subtitle_properties_observe_formats() {
        assert_eq!(
            observe_format_for_property("secondary-sub-visibility"),
            Some(Format::Flag)
        );
        assert_eq!(
            observe_format_for_property("secondary-sub-delay"),
            Some(Format::Double)
        );
        assert_eq!(
            observe_format_for_property("secondary-sub-pos"),
            Some(Format::Double)
        );
        assert_eq!(
            observe_format_for_property("secondary-sid"),
            Some(Format::String)
        );
        assert_eq!(
            observe_format_for_property("secondary-sub-text"),
            Some(Format::String)
        );
        assert_eq!(
            observe_format_for_property("sub-text"),
            Some(Format::String)
        );
        assert_eq!(observe_format_for_property("unsupported-prop"), None);
    }

    #[test]
    fn secondary_subtitle_properties_set_values() {
        let sid_str = json!("2");
        assert_eq!(
            resolve_mpv_set_value("secondary-sid", &sid_str),
            Some(MpvPropertyValue::Str("2"))
        );

        let sid_no = json!("no");
        assert_eq!(
            resolve_mpv_set_value("secondary-sid", &sid_no),
            Some(MpvPropertyValue::Str("no"))
        );

        let sid_int = json!(2);
        assert_eq!(
            resolve_mpv_set_value("secondary-sid", &sid_int),
            Some(MpvPropertyValue::Int(2))
        );

        let sid_float_whole = json!(2.0);
        assert_eq!(
            resolve_mpv_set_value("secondary-sid", &sid_float_whole),
            Some(MpvPropertyValue::Int(2))
        );

        let vis = json!(false);
        assert_eq!(
            resolve_mpv_set_value("secondary-sub-visibility", &vis),
            Some(MpvPropertyValue::Bool(false))
        );

        let delay = json!(-0.5);
        assert_eq!(
            resolve_mpv_set_value("secondary-sub-delay", &delay),
            Some(MpvPropertyValue::Float(-0.5))
        );

        let pos = json!(12.0);
        assert_eq!(
            resolve_mpv_set_value("secondary-sub-pos", &pos),
            Some(MpvPropertyValue::Float(12.0))
        );

        let unknown = json!(1);
        assert_eq!(resolve_mpv_set_value("unsupported-prop", &unknown), None);
    }

    #[test]
    fn observed_subtitle_text_is_not_json_parsed() {
        assert_eq!(
            parse_observed_string_property("sub-text", "42".to_string()),
            json!("42")
        );
        assert_eq!(
            parse_observed_string_property("secondary-sub-text", "true".to_string()),
            json!("true")
        );
        assert_eq!(
            parse_observed_string_property("secondary-sid", "2".to_string()),
            json!(2)
        );
        assert_eq!(
            parse_observed_string_property("secondary-sid", "no".to_string()),
            json!("no")
        );
        assert_eq!(
            parse_observed_string_property("track-list", r#"[{"id":1}]"#.to_string()),
            json!([{"id": 1}])
        );
    }
}
