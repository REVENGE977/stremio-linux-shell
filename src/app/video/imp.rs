use gdk_wayland::{WaylandDisplay, wayland_client::Proxy};
use gtk::{
    gdk::GLContext,
    gio::Settings,
    glib::{self, Propagation, Properties, Variant, clone, subclass::Signal},
    prelude::*,
    subclass::prelude::*,
};
use libmpv2::{
    Error, Format, Mpv, SetData,
    events::{Event, PropertyData},
    mpv_end_file_reason,
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
};
use shellexpand::tilde;
use std::{
    cell::{Cell, RefCell},
    env,
    os::raw::c_void,
    sync::OnceLock,
};
use tracing::{error, warn};

use crate::{app::config::APP_ID, spawn_local};

fn get_proc_address(_context: &GLContext, name: &str) -> *mut c_void {
    epoxy::get_proc_addr(name) as _
}

enum EventCallback {
    Render,
    Events,
}

#[derive(Properties)]
#[properties(wrapper_type = super::Video)]
pub struct Video {
    mpv: RefCell<Mpv>,
    render_context: RefCell<Option<RenderContext>>,
    file_loaded: Cell<bool>,
    video_ready_emitted: Cell<bool>,
    pub(super) is_playing: Cell<bool>,
}

impl Default for Video {
    fn default() -> Self {
        let log = env::var("RUST_LOG");
        let msg_level = match log {
            Ok(scope) => &format!("all={}", scope.as_str()),
            _ => "all=no",
        };

        // Required for libmpv to work alongside GTK
        gettextrs::setlocale(gettextrs::LocaleCategory::LcNumeric, "C")
            .expect("Failed to set LC_NUMERIC to C");

        let settings = Settings::new(APP_ID);
        let mpv_config_location = settings.string("mpv-config-location");
        let config_path = tilde(&mpv_config_location).to_string();

        let mpv = Mpv::with_initializer(|init| {
            if let Err(e) = init.set_property("include", config_path) {
                warn!("Failed to load config file: {e}");
            }

            init.set_property("vo", "libmpv")?;
            init.set_property("video-timing-offset", "0")?;
            init.set_property("video-sync", "audio")?;
            init.set_property("terminal", "yes")?;
            init.set_property("msg-level", msg_level)?;
            Ok(())
        })
        .expect("Failed to create mpv");

        mpv.disable_deprecated_events().ok();

        Self {
            mpv: RefCell::new(mpv),
            render_context: Default::default(),
            file_loaded: Cell::new(false),
            video_ready_emitted: Cell::new(false),
            is_playing: Cell::new(false),
        }
    }
}

impl Video {
    fn on_event<T: Fn(Event)>(&self, callback: T) {
        while let Some(result) = self.mpv.borrow().wait_event(0.0) {
            match result {
                Ok(event) => callback(event),
                Err(Error::Raw(e)) => {
                    error!("MPV errored with: {e}");
                    self.obj()
                        .emit_by_name::<()>("playback-ended", &[&"error".to_string()]);
                }
                Err(e) => error!("Failed to wait for event: {e}"),
            }
        }
    }

    fn unobserve_properties(&self) {
        if let Err(e) = self.mpv.borrow().unobserve_property(0) {
            error!("Failed to unobserve properties: {e}");
        }
    }

    pub fn send_command(&self, name: &str, args: &[&str]) {
        if let Err(e) = self.mpv.borrow().command(name, args) {
            error!("Failed to send command {name}: {e}");
        }
    }

    pub fn observe_property(&self, name: &str, format: Format) {
        if let Err(e) = self.mpv.borrow().observe_property(name, format, 0) {
            error!("Failed to observe property {name}: {e}");
        }
    }

    pub fn set_property<T: SetData>(&self, name: &str, value: T) {
        if let Err(e) = self.mpv.borrow().set_property(name, value) {
            error!("Failed to set property {name}: {e}");
        }
    }

    pub fn set_glsl_shaders(&self, paths: &[std::path::PathBuf]) {
        let mpv = self.mpv.borrow();
        if paths.is_empty() {
            if let Err(e) = mpv.command("change-list", &["glsl-shaders", "clr", ""])
                && let Err(e2) = mpv.set_property("glsl-shaders", String::new())
            {
                warn!("Failed to clear glsl-shaders: {e}; fallback error: {e2}");
            }
            self.obj().queue_render();
            return;
        }

        let joined = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(":");

        if let Err(e) = mpv.command("change-list", &["glsl-shaders", "set", &joined])
            && let Err(e2) = mpv.set_property("glsl-shaders", joined)
        {
            warn!("Failed to set glsl-shaders: {e}; fallback error: {e2}");
        }
        self.obj().queue_render();
    }

    pub fn get_chapters(&self) -> Vec<super::ChapterInfo> {
        let mpv = self.mpv.borrow();
        let Ok(raw) = mpv.get_property::<String>("chapter-list") else {
            return Vec::new();
        };
        let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(&raw)
        else {
            return Vec::new();
        };

        let mut chapters = items
            .into_iter()
            .enumerate()
            .filter_map(|(idx, item)| {
                let time = item.get("time")?.as_f64()?;
                if !time.is_finite() || time < 0.0 {
                    return None;
                }
                let title = item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Chapter {}", idx + 1));
                Some(super::ChapterInfo { title, time })
            })
            .collect::<Vec<_>>();

        chapters.sort_by(|a, b| a.time.total_cmp(&b.time));
        chapters
    }

    pub fn get_playback_stats(&self) -> super::PlaybackStats {
        let mpv = self.mpv.borrow();

        let get_str = |prop: &str| {
            mpv.get_property::<String>(prop)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let get_i64 = |prop: &str| mpv.get_property::<i64>(prop).ok();
        let get_f64 = |prop: &str| mpv.get_property::<f64>(prop).ok().filter(|v| v.is_finite());
        let get_bool = |prop: &str| mpv.get_property::<bool>(prop).unwrap_or(false);

        let active_shaders = match mpv.get_property::<String>("glsl-shaders") {
            Ok(raw) => parse_shader_list(&raw),
            Err(_) => Vec::new(),
        };

        let obj = self.obj();
        let scale_factor = i64::from(obj.scale_factor().max(1));
        let widget_w = i64::from(obj.width()) * scale_factor;
        let widget_h = i64::from(obj.height()) * scale_factor;
        let output_width = (widget_w > 0)
            .then_some(widget_w)
            .or_else(|| get_i64("osd-width").filter(|&v| v > 0));
        let output_height = (widget_h > 0)
            .then_some(widget_h)
            .or_else(|| get_i64("osd-height").filter(|&v| v > 0));

        super::PlaybackStats {
            media_title: get_str("media-title"),
            path: get_str("path"),
            video_codec: get_str("video-codec"),
            video_format: get_str("video-format"),
            width: get_i64("width"),
            height: get_i64("height"),
            dwidth: get_i64("dwidth"),
            dheight: get_i64("dheight"),
            output_width,
            output_height,
            container_fps: get_f64("container-fps"),
            estimated_vf_fps: get_f64("estimated-vf-fps"),
            display_fps: get_f64("display-fps"),
            hwdec_current: get_str("hwdec-current"),
            video_bitrate: get_f64("video-bitrate"),
            color_primaries: get_str("video-params/primaries"),
            color_gamma: get_str("video-params/gamma"),
            color_matrix: get_str("video-params/colormatrix"),
            sig_peak: get_f64("video-params/sig-peak"),
            pixel_format: get_str("video-params/pixelformat"),
            audio_codec: get_str("audio-codec-name"),
            audio_channels: get_str("audio-params/hr-channels")
                .or_else(|| get_str("audio-params/channels")),
            audio_sample_rate: get_i64("audio-params/samplerate"),
            audio_bitrate: get_f64("audio-bitrate"),
            dropped_frames: get_i64("frame-drop-count"),
            decoder_dropped_frames: get_i64("decoder-frame-drop-count"),
            mistimed_frames: get_i64("mistimed-frame-count"),
            avsync: get_f64("avsync"),
            cache_duration: get_f64("demuxer-cache-duration"),
            cache_speed: get_f64("cache-speed"),
            paused_for_cache: get_bool("paused-for-cache"),
            speed: get_f64("speed"),
            volume: get_f64("volume"),
            time_pos: get_f64("time-pos"),
            duration: get_f64("duration"),
            active_shaders,
        }
    }
}

fn parse_shader_list(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let raw_paths: Vec<String> = if let Ok(serde_json::Value::Array(arr)) =
        serde_json::from_str::<serde_json::Value>(trimmed)
    {
        arr.into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    } else {
        trimmed
            .split(':')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    };

    raw_paths
        .into_iter()
        .filter_map(|p| {
            std::path::Path::new(&p)
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_string)
                .or(Some(p))
        })
        .collect()
}

#[glib::object_subclass]
impl ObjectSubclass for Video {
    const NAME: &'static str = "Video";
    type Type = super::Video;
    type ParentType = gtk::GLArea;
}

#[glib::derived_properties]
impl ObjectImpl for Video {
    fn signals() -> &'static [Signal] {
        static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
        SIGNALS.get_or_init(|| {
            vec![
                Signal::builder("property-changed")
                    .param_types([str::static_type(), Variant::static_type()])
                    .build(),
                Signal::builder("playback-started").build(),
                Signal::builder("video-ready").build(),
                Signal::builder("playback-ended")
                    .param_types([str::static_type()])
                    .build(),
            ]
        })
    }
}

impl WidgetImpl for Video {
    fn realize(&self) {
        self.parent_realize();

        let object = self.obj();
        object.make_current();

        if object.error().is_some() {
            return;
        }

        if let Some(context) = object.context() {
            let mut mpv = self.mpv.borrow_mut();
            let (sender, receiver) = flume::unbounded::<EventCallback>();

            spawn_local!(clone!(
                #[weak(rename_to = video)]
                self,
                #[weak]
                object,
                async move {
                    while let Ok(event) = receiver.recv_async().await {
                        match event {
                            EventCallback::Render => {
                                if video.is_playing.get() || object.is_visible() {
                                    object.queue_render();
                                }
                            }
                            EventCallback::Events => {
                                video.on_event(|event| match event {
                                    Event::StartFile => {
                                        video.file_loaded.set(false);
                                        video.video_ready_emitted.set(false);
                                        video.is_playing.set(true);
                                        object.emit_by_name::<()>("playback-started", &[]);
                                    }
                                    Event::FileLoaded => {
                                        video.file_loaded.set(true);
                                    }
                                    Event::PlaybackRestart => {
                                        if video.file_loaded.get()
                                            && !video.video_ready_emitted.get()
                                        {
                                            video.video_ready_emitted.set(true);
                                            object.emit_by_name::<()>("video-ready", &[]);
                                        }
                                    }
                                    Event::PropertyChange { name, change, .. } => {
                                        let value = match change {
                                            PropertyData::Str(v) => Some(v.to_variant()),
                                            PropertyData::Flag(v) => Some(v.to_variant()),
                                            PropertyData::Double(v) => Some(v.to_variant()),
                                            _ => None,
                                        };

                                        if let Some(value) = value {
                                            object.emit_by_name::<()>(
                                                "property-changed",
                                                &[&name, &value],
                                            );
                                        }
                                    }
                                    Event::EndFile(reason) => {
                                        video.file_loaded.set(false);
                                        video.video_ready_emitted.set(false);
                                        video.is_playing.set(false);
                                        let reason = match reason {
                                            mpv_end_file_reason::Eof => "eof".to_string(),
                                            mpv_end_file_reason::Stop => "stop".to_string(),
                                            mpv_end_file_reason::Redirect => "redirect".to_string(),
                                            mpv_end_file_reason::Error => "error".to_string(),
                                            mpv_end_file_reason::Quit => "quit".to_string(),
                                            _ => "other".to_string(),
                                        };

                                        object.emit_by_name::<()>("playback-ended", &[&reason]);
                                        video.unobserve_properties();
                                    }
                                    _ => {}
                                });
                            }
                        }
                    }
                }
            ));

            let wakeup_sender = sender.clone();
            mpv.set_wakeup_callback(move || {
                wakeup_sender.send(EventCallback::Events).ok();
            });

            let mut render_params = vec![
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams {
                    get_proc_address,
                    ctx: context,
                }),
            ];

            let display = object.display();
            if let Ok(display) = display.downcast::<WaylandDisplay>()
                && let Some(display) = display.wl_display()
            {
                render_params.push(RenderParam::WaylandDisplay(
                    display.id().as_ptr() as *const c_void
                ));
            }

            let mpv_handle = unsafe { mpv.ctx.as_mut() };
            let mut render_context = RenderContext::new(mpv_handle, render_params)
                .expect("Failed to create render context");

            let render_sender = sender.clone();
            render_context.set_update_callback(move || {
                render_sender.send(EventCallback::Render).ok();
            });

            *self.render_context.borrow_mut() = Some(render_context);
        }
    }

    fn unrealize(&self) {
        self.obj().make_current();
        if let Some(render_context) = self.render_context.borrow_mut().take() {
            drop(render_context);
        }

        self.parent_unrealize();
    }
}

impl GLAreaImpl for Video {
    fn render(&self, _context: &GLContext) -> Propagation {
        let object = self.obj();

        let mut fbo = 0;
        unsafe {
            epoxy::GetIntegerv(epoxy::FRAMEBUFFER_BINDING, &mut fbo);
        }

        let scale_factor = object.scale_factor();
        let width = object.width() * scale_factor;
        let height = object.height() * scale_factor;

        if let Some(ref render_context) = *self.render_context.borrow() {
            render_context
                .render::<GLContext>(fbo, width, height, true)
                .expect("Failed to render");
        }

        Propagation::Stop
    }
}
