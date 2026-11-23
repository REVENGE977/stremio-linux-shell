use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use flume::{Receiver, Sender};
use libmpv2::Mpv;
use std::{
    collections::{HashMap, VecDeque},
    ffi::{CString, c_void},
    os::raw::c_int,
    ptr,
    sync::Arc,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tracing::warn;

pub const DEFAULT_THUMB_MAX_WIDTH: u32 = 240;
const MIN_THUMB_MAX_WIDTH: u32 = 120;
const MAX_THUMB_MAX_WIDTH: u32 = 360;
const MAX_CACHE_ENTRIES: usize = 120;
const SEEK_TIMEOUT: Duration = Duration::from_secs(4);
const STREAM_LOAD_TIMEOUT: Duration = Duration::from_secs(12);

pub enum ThumbnailCmd {
    SetEnabled(bool),
    SetSource(Option<String>),
    Request { time_sec: f64, max_width: u32 },
}

enum WorkerWake {
    Cmd,
    Mpv,
    Render,
}

#[derive(Clone)]
struct CachedThumb {
    data_url: String,
    width: u32,
    height: u32,
}

struct InFlightSeek {
    requested_time: f64,
    quantized_key: i64,
    max_width: u32,
    started_at: Instant,
    seek_settled: bool,
    render_ready: bool,
}

struct SwRenderContext {
    ctx: *mut libmpv2_sys::mpv_render_context,
    _mpv: Arc<Mpv>,
    _wake_box: *mut Sender<WorkerWake>,
}

unsafe impl Send for SwRenderContext {}

impl SwRenderContext {
    fn new(mpv: Arc<Mpv>, wake_sender: Sender<WorkerWake>) -> Result<Self, String> {
        let api_type = libmpv2_sys::MPV_RENDER_API_TYPE_SW.as_ptr() as *mut c_void;
        let mut params = [
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                data: api_type,
            },
            libmpv2_sys::mpv_render_param {
                type_: 0,
                data: ptr::null_mut(),
            },
        ];

        let mut raw_ctx: *mut libmpv2_sys::mpv_render_context = ptr::null_mut();
        let err = unsafe {
            libmpv2_sys::mpv_render_context_create(
                &mut raw_ctx,
                mpv.ctx.as_ptr(),
                params.as_mut_ptr(),
            )
        };
        if err < 0 || raw_ctx.is_null() {
            return Err(format!("mpv_render_context_create(sw) failed: {err}"));
        }

        let wake_box = Box::into_raw(Box::new(wake_sender));
        unsafe {
            libmpv2_sys::mpv_render_context_set_update_callback(
                raw_ctx,
                Some(render_update_callback),
                wake_box as *mut c_void,
            );
        }

        Ok(Self {
            ctx: raw_ctx,
            _mpv: mpv,
            _wake_box: wake_box,
        })
    }

    fn update_flags(&self) -> u64 {
        unsafe { libmpv2_sys::mpv_render_context_update(self.ctx) }
    }

    fn render_bgr0(&self, width: u32, height: u32) -> Result<(Vec<u8>, usize), String> {
        let w = width as usize;
        let h = height as usize;
        // 64-byte aligned stride as recommended by libmpv for SIMD swscale fast paths.
        let stride = (w * 4 + 63) & !63;
        let mut buf = vec![0u8; stride * h];

        let mut size: [c_int; 2] = [width as c_int, height as c_int];
        let fmt = CString::new("bgr0").expect("valid format cstr");
        let mut stride_val: usize = stride;
        let mut block_target: c_int = 0;

        let mut params = [
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_SIZE,
                data: size.as_mut_ptr() as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_FORMAT,
                data: fmt.as_ptr() as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_STRIDE,
                data: (&mut stride_val as *mut usize) as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_SW_POINTER,
                data: buf.as_mut_ptr() as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME,
                data: (&mut block_target as *mut c_int) as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: 0,
                data: ptr::null_mut(),
            },
        ];

        let err = unsafe { libmpv2_sys::mpv_render_context_render(self.ctx, params.as_mut_ptr()) };
        if err < 0 {
            return Err(format!("mpv_render_context_render(sw) failed: {err}"));
        }

        Ok((buf, stride))
    }
}

impl Drop for SwRenderContext {
    fn drop(&mut self) {
        unsafe {
            libmpv2_sys::mpv_render_context_set_update_callback(self.ctx, None, ptr::null_mut());
            libmpv2_sys::mpv_render_context_free(self.ctx);
            drop(Box::from_raw(self._wake_box));
        }
    }
}

unsafe extern "C" fn render_update_callback(cb_ctx: *mut c_void) {
    if cb_ctx.is_null() {
        return;
    }
    let sender = unsafe { &*(cb_ctx as *const Sender<WorkerWake>) };
    let _ = sender.try_send(WorkerWake::Render);
}

struct ThumbnailEngine {
    mpv: Arc<Mpv>,
    render: SwRenderContext,
}

impl ThumbnailEngine {
    fn create(wake_sender: Sender<WorkerWake>) -> Result<Self, String> {
        let mpv = Mpv::with_initializer(|initializer| {
            let options = [
                ("vo", "libmpv"),
                ("ao", "null"),
                ("aid", "no"),
                ("sid", "no"),
                ("sub-auto", "no"),
                ("osc", "no"),
                ("osd-level", "0"),
                ("input-default-bindings", "no"),
                ("input-vo-keyboard", "no"),
                ("input-terminal", "no"),
                ("terminal", "no"),
                ("quiet", "yes"),
                ("msg-level", "all=no"),
                ("pause", "yes"),
                ("keep-open", "yes"),
                ("hwdec", "no"),
                ("hr-seek", "no"),
                ("hr-seek-framedrop", "yes"),
                ("vd-lavc-fast", "yes"),
                ("vd-lavc-skiploopfilter", "all"),
                ("vd-lavc-threads", "2"),
                ("audio-display", "no"),
                ("video-timing-offset", "0"),
                ("sws-scaler", "fast-bilinear"),
                ("demuxer-readahead-secs", "2"),
                ("cache", "yes"),
                ("demuxer-max-bytes", "16MiB"),
                ("demuxer-max-back-bytes", "8MiB"),
                (
                    "stream-lavf-o",
                    "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=5",
                ),
            ];
            for (name, value) in options {
                if let Err(err) = initializer.set_property(name, value) {
                    warn!("[ThumbFast] cannot set {name}={value}: {err:?}");
                }
            }
            Ok(())
        })
        .map_err(|e| format!("failed to initialize thumbnailer mpv: {e:?}"))?;

        let mut mpv = Arc::new(mpv);
        let wake_for_mpv = wake_sender.clone();
        Arc::get_mut(&mut mpv)
            .expect("unique mpv arc")
            .set_wakeup_callback(move || {
                let _ = wake_for_mpv.try_send(WorkerWake::Mpv);
            });

        let render = SwRenderContext::new(Arc::clone(&mpv), wake_sender)?;
        Ok(Self { mpv, render })
    }
}

pub fn compute_thumbnail_dimensions(
    video_w: Option<f64>,
    video_h: Option<f64>,
    max_width: u32,
) -> (u32, u32) {
    let clamped_max = max_width.clamp(MIN_THUMB_MAX_WIDTH, MAX_THUMB_MAX_WIDTH);
    let (vw, vh) = match (video_w, video_h) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
        _ => (16.0, 9.0),
    };

    let aspect = vw / vh;
    let (raw_w, raw_h) = if aspect >= 1.0 {
        let w = clamped_max as f64;
        let h = w / aspect;
        (w, h)
    } else {
        // Cap vertical video height at clamped_max so tall thumbnails don't overflow the player.
        let h = clamped_max as f64;
        let w = h * aspect;
        (w, h)
    };

    let width = ((raw_w.round() as u32).max(64)) & !1;
    let height = ((raw_h.round() as u32).max(36)) & !1;
    (width.max(64), height.max(36))
}

pub fn encode_bgr0_to_bmp(bgr0: &[u8], stride: usize, width: usize, height: usize) -> Vec<u8> {
    let row_bytes = width * 3;
    let bmp_stride = (row_bytes + 3) & !3;
    let pixel_data_size = bmp_stride * height;
    let file_size = 54 + pixel_data_size;

    let mut out = Vec::with_capacity(file_size);
    // BITMAPFILEHEADER (14 bytes)
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&54u32.to_le_bytes());

    // BITMAPINFOHEADER (40 bytes)
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(pixel_data_size as u32).to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());

    let pad_bytes = bmp_stride - row_bytes;
    let padding = [0u8; 3];

    // Standard bottom-up BMP: write rows from bottom to top.
    for y in (0..height).rev() {
        let row_start = y * stride;
        for x in 0..width {
            let px = row_start + x * 4;
            out.push(bgr0[px]);
            out.push(bgr0[px + 1]);
            out.push(bgr0[px + 2]);
        }
        if pad_bytes > 0 {
            out.extend_from_slice(&padding[..pad_bytes]);
        }
    }

    out
}

fn quantize_time(time_sec: f64, duration: Option<f64>) -> i64 {
    let step = match duration {
        Some(d) if d > 0.0 && d <= 120.0 => 0.5,
        _ => 1.0,
    };
    (time_sec / step).round() as i64
}

fn read_video_dimensions(mpv: &Mpv) -> (Option<f64>, Option<f64>) {
    if let (Ok(dw), Ok(dh)) = (
        mpv.get_property::<f64>("dwidth"),
        mpv.get_property::<f64>("dheight"),
    ) && dw > 0.0
        && dh > 0.0
    {
        return (Some(dw), Some(dh));
    }
    if let Ok(params_str) = mpv.get_property::<String>("video-params")
        && let Ok(val) = serde_json::from_str::<serde_json::Value>(&params_str)
    {
        let w = val.get("w").and_then(|v| v.as_f64());
        let h = val.get("h").and_then(|v| v.as_f64());
        if w.is_some_and(|v| v > 0.0) && h.is_some_and(|v| v > 0.0) {
            return (w, h);
        }
    }
    (None, None)
}

fn send_thumbnail_to_webview(
    script_tx: &Sender<String>,
    time: f64,
    data_url: &str,
    width: u32,
    height: u32,
) {
    let payload = serde_json::json!({
        "time": time,
        "dataUrl": data_url,
        "width": width,
        "height": height,
    });
    if let Ok(payload_json) = serde_json::to_string(&payload) {
        let script = format!(
            "window.__receiveThumbnailPreview && window.__receiveThumbnailPreview({payload_json});"
        );
        let _ = script_tx.send(script);
    }
}

pub fn spawn_thumbnail_worker(
    script_tx: Sender<String>,
    initial_enabled: bool,
) -> (Sender<ThumbnailCmd>, JoinHandle<()>) {
    let (cmd_tx, cmd_rx) = flume::unbounded::<ThumbnailCmd>();
    let (wake_tx, wake_rx) = flume::bounded::<WorkerWake>(16);

    let cmd_wake_tx = wake_tx.clone();
    let (proxy_tx, proxy_rx) = flume::unbounded::<ThumbnailCmd>();

    // Forwarder notifies worker wake channel immediately whenever a command arrives.
    thread::Builder::new()
        .name("thumbfast-dispatch".to_string())
        .spawn(move || {
            while let Ok(cmd) = proxy_rx.recv() {
                if cmd_tx.send(cmd).is_err() {
                    break;
                }
                let _ = cmd_wake_tx.try_send(WorkerWake::Cmd);
            }
        })
        .expect("failed to start thumbfast dispatcher");

    let handle = thread::Builder::new()
        .name("thumbfast-worker".to_string())
        .spawn(move || {
            run_thumbnail_loop(cmd_rx, wake_rx, wake_tx, script_tx, initial_enabled);
        })
        .expect("failed to start thumbfast worker");

    (proxy_tx, handle)
}

fn run_thumbnail_loop(
    cmd_rx: Receiver<ThumbnailCmd>,
    wake_rx: Receiver<WorkerWake>,
    wake_tx: Sender<WorkerWake>,
    script_tx: Sender<String>,
    initial_enabled: bool,
) {
    let mut enabled = initial_enabled;
    let mut engine: Option<ThumbnailEngine> = None;
    let mut current_url: Option<String> = None;
    let mut file_ready = false;
    let mut load_failed = false;
    let mut load_started_at: Option<Instant> = None;
    let mut duration: Option<f64> = None;
    let mut pending_request: Option<(f64, u32)> = None;
    let mut in_flight: Option<InFlightSeek> = None;
    let mut cache: HashMap<(i64, u32), CachedThumb> = HashMap::new();
    let mut cache_order: VecDeque<(i64, u32)> = VecDeque::new();

    let reset_cache = |cache: &mut HashMap<(i64, u32), CachedThumb>,
                       cache_order: &mut VecDeque<(i64, u32)>| {
        cache.clear();
        cache_order.clear();
    };

    loop {
        // 1. Drain all pending commands (latest-wins for thumbnail requests).
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                ThumbnailCmd::SetEnabled(next_enabled) => {
                    if enabled != next_enabled {
                        enabled = next_enabled;
                        if !enabled {
                            pending_request = None;
                            in_flight = None;
                            file_ready = false;
                            load_failed = false;
                            load_started_at = None;
                            duration = None;
                            reset_cache(&mut cache, &mut cache_order);
                            if let Some(eng) = engine.take() {
                                let _ = eng.mpv.command("stop", &[]);
                                drop(eng);
                            }
                        } else if let Some(ref url) = current_url {
                            // Re-warm current stream when toggled back on.
                            if engine.is_none() {
                                match ThumbnailEngine::create(wake_tx.clone()) {
                                    Ok(e) => engine = Some(e),
                                    Err(err) => {
                                        warn!("[ThumbFast] {err}");
                                        load_failed = true;
                                        continue;
                                    }
                                }
                            }
                            if let Some(ref eng) = engine {
                                file_ready = false;
                                load_failed = false;
                                load_started_at = Some(Instant::now());
                                duration = None;
                                in_flight = None;
                                if let Err(err) =
                                    eng.mpv.command("loadfile", &[url.as_str(), "replace"])
                                {
                                    warn!("[ThumbFast] loadfile failed: {err:?}");
                                    load_failed = true;
                                }
                            }
                        }
                    }
                }
                ThumbnailCmd::SetSource(maybe_url) => {
                    if maybe_url == current_url
                        && (!enabled || engine.is_some() || maybe_url.is_none())
                    {
                        continue;
                    }
                    current_url = maybe_url.clone();
                    file_ready = false;
                    load_failed = false;
                    load_started_at = None;
                    duration = None;
                    pending_request = None;
                    in_flight = None;
                    reset_cache(&mut cache, &mut cache_order);

                    match maybe_url {
                        None => {
                            if let Some(ref eng) = engine {
                                let _ = eng.mpv.command("stop", &[]);
                            }
                        }
                        Some(url) if enabled => {
                            if engine.is_none() {
                                match ThumbnailEngine::create(wake_tx.clone()) {
                                    Ok(e) => engine = Some(e),
                                    Err(err) => {
                                        warn!("[ThumbFast] {err}");
                                        load_failed = true;
                                        continue;
                                    }
                                }
                            }
                            if let Some(ref eng) = engine {
                                load_started_at = Some(Instant::now());
                                if let Err(err) =
                                    eng.mpv.command("loadfile", &[url.as_str(), "replace"])
                                {
                                    warn!("[ThumbFast] loadfile failed: {err:?}");
                                    load_failed = true;
                                }
                            }
                        }
                        Some(_) => {}
                    }
                }
                ThumbnailCmd::Request {
                    time_sec,
                    max_width,
                } => {
                    if !enabled || current_url.is_none() || !time_sec.is_finite() || time_sec < 0.0
                    {
                        continue;
                    }
                    let clamped_width = max_width.clamp(MIN_THUMB_MAX_WIDTH, MAX_THUMB_MAX_WIDTH);
                    pending_request = Some((time_sec, clamped_width));
                }
            }
        }

        // 2. Drain mpv events if engine is active.
        if let Some(ref eng) = engine {
            loop {
                let raw_ev = unsafe { &*libmpv2_sys::mpv_wait_event(eng.mpv.ctx.as_ptr(), 0.0) };
                match raw_ev.event_id {
                    libmpv2_sys::mpv_event_id_MPV_EVENT_NONE => break,
                    libmpv2_sys::mpv_event_id_MPV_EVENT_SHUTDOWN => {
                        file_ready = false;
                        load_failed = true;
                        break;
                    }
                    libmpv2_sys::mpv_event_id_MPV_EVENT_FILE_LOADED => {
                        file_ready = true;
                        load_failed = false;
                        load_started_at = None;
                        if let Ok(d) = eng.mpv.get_property::<f64>("duration")
                            && d.is_finite()
                            && d > 0.0
                        {
                            duration = Some(d);
                        }
                    }
                    libmpv2_sys::mpv_event_id_MPV_EVENT_PLAYBACK_RESTART => {
                        if let Some(ref mut seek) = in_flight {
                            seek.seek_settled = true;
                        }
                    }
                    libmpv2_sys::mpv_event_id_MPV_EVENT_END_FILE => {
                        if !file_ready {
                            load_failed = true;
                        }
                        if let Some(ref mut seek) = in_flight {
                            seek.seek_settled = true;
                        }
                    }
                    _ => {}
                }
            }

            // Check render update flags so we know if a frame is ready.
            let update_flags = eng.render.update_flags();
            if (update_flags & (libmpv2_sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME as u64))
                != 0
                && let Some(ref mut seek) = in_flight
            {
                seek.render_ready = true;
            }

            if !file_ready
                && !load_failed
                && load_started_at.is_some_and(|t| t.elapsed() > STREAM_LOAD_TIMEOUT)
            {
                load_failed = true;
            }

            // 3. Complete in-flight seek & render frame when ready.
            if let Some(ref seek) = in_flight {
                let elapsed = seek.started_at.elapsed();
                let ready_to_render =
                    seek.seek_settled && (seek.render_ready || elapsed > Duration::from_millis(80));
                if ready_to_render {
                    let (vw, vh) = read_video_dimensions(&eng.mpv);
                    let (tw, th) = compute_thumbnail_dimensions(vw, vh, seek.max_width);
                    match eng.render.render_bgr0(tw, th) {
                        Ok((bgr0, stride)) => {
                            let bmp = encode_bgr0_to_bmp(&bgr0, stride, tw as usize, th as usize);
                            let data_url =
                                format!("data:image/bmp;base64,{}", BASE64_STANDARD.encode(&bmp));
                            let cache_key = (seek.quantized_key, seek.max_width);
                            if !cache.contains_key(&cache_key) {
                                if cache_order.len() >= MAX_CACHE_ENTRIES
                                    && let Some(old_key) = cache_order.pop_front()
                                {
                                    cache.remove(&old_key);
                                }
                                cache_order.push_back(cache_key);
                            }
                            cache.insert(
                                cache_key,
                                CachedThumb {
                                    data_url: data_url.clone(),
                                    width: tw,
                                    height: th,
                                },
                            );
                            send_thumbnail_to_webview(
                                &script_tx,
                                seek.requested_time,
                                &data_url,
                                tw,
                                th,
                            );
                        }
                        Err(err) => {
                            warn!("[ThumbFast] render failed: {err}");
                        }
                    }
                    in_flight = None;
                } else if elapsed > SEEK_TIMEOUT {
                    in_flight = None;
                }
            }

            // 4. Start next pending request if idle.
            if enabled
                && file_ready
                && !load_failed
                && in_flight.is_none()
                && let Some((req_time, req_width)) = pending_request.take()
            {
                let qkey = quantize_time(req_time, duration);
                if let Some(hit) = cache.get(&(qkey, req_width)) {
                    send_thumbnail_to_webview(
                        &script_tx,
                        req_time,
                        &hit.data_url,
                        hit.width,
                        hit.height,
                    );
                } else {
                    let clamped_time = match duration {
                        Some(d) if d > 0.5 => req_time.clamp(0.0, d - 0.25),
                        _ => req_time.max(0.0),
                    };
                    let time_arg = format!("{clamped_time:.3}");
                    if let Err(err) = eng
                        .mpv
                        .command("seek", &[time_arg.as_str(), "absolute+keyframes"])
                    {
                        warn!("[ThumbFast] seek({time_arg}) failed: {err:?}");
                    } else {
                        in_flight = Some(InFlightSeek {
                            requested_time: req_time,
                            quantized_key: qkey,
                            max_width: req_width,
                            started_at: Instant::now(),
                            seek_settled: false,
                            render_ready: false,
                        });
                    }
                }
            }
        }

        // 5. Wait for next command, mpv event, or render update (or short poll while seeking).
        let wait_timeout =
            if in_flight.is_some() || (!file_ready && !load_failed && load_started_at.is_some()) {
                Duration::from_millis(20)
            } else {
                Duration::from_secs(60)
            };

        match wake_rx.recv_timeout(wait_timeout) {
            Ok(_) => {
                // Drain extra queued wakes so we don't spin unnecessarily.
                while wake_rx.try_recv().is_ok() {}
            }
            Err(flume::RecvTimeoutError::Timeout) => {}
            Err(flume::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::TryInto;

    #[test]
    fn test_compute_thumbnail_dimensions() {
        assert_eq!(
            compute_thumbnail_dimensions(Some(1920.0), Some(1080.0), 240),
            (240, 134)
        );
        assert_eq!(
            compute_thumbnail_dimensions(Some(1280.0), Some(720.0), 240),
            (240, 134)
        );
        assert_eq!(
            compute_thumbnail_dimensions(Some(1080.0), Some(1920.0), 240),
            (134, 240)
        );
        assert_eq!(compute_thumbnail_dimensions(None, None, 240), (240, 134));
    }

    #[test]
    fn test_encode_bgr0_to_bmp_header_and_pixels() {
        // 2x2 image in bgr0, stride = 16 (padded)
        let mut bgr0 = vec![0u8; 16 * 2];
        // Top row (y=0): pixel(0,0)=(10,20,30), pixel(1,0)=(40,50,60)
        bgr0[0..4].copy_from_slice(&[10, 20, 30, 255]);
        bgr0[4..8].copy_from_slice(&[40, 50, 60, 255]);
        // Bottom row (y=1): pixel(0,1)=(70,80,90), pixel(1,1)=(100,110,120)
        bgr0[16..20].copy_from_slice(&[70, 80, 90, 255]);
        bgr0[20..24].copy_from_slice(&[100, 110, 120, 255]);

        let bmp = encode_bgr0_to_bmp(&bgr0, 16, 2, 2);
        // 2px * 3 = 6 bytes per row -> padded to 8 bytes -> 54 + 16 = 70 bytes
        assert_eq!(bmp.len(), 70);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()), 70);
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 54);
        assert_eq!(i32::from_le_bytes(bmp[18..22].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(bmp[22..26].try_into().unwrap()), 2);
        // Bottom-up: row y=1 first
        assert_eq!(&bmp[54..60], &[70, 80, 90, 100, 110, 120]);
        assert_eq!(&bmp[60..62], &[0, 0]); // padding
        // Top row y=0 second
        assert_eq!(&bmp[62..68], &[10, 20, 30, 40, 50, 60]);
    }

    #[test]
    fn test_sw_render_context_creation() {
        let (wake_tx, _wake_rx) = flume::bounded(4);
        let engine = ThumbnailEngine::create(wake_tx);
        assert!(engine.is_ok(), "SwRenderContext failed: {:?}", engine.err());
    }

    #[test]
    fn test_thumbnail_worker_renders_real_video_frame() {
        let ffmpeg_check = std::process::Command::new("ffmpeg")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if !matches!(ffmpeg_check, Ok(s) if s.success()) {
            return;
        }

        let temp_mp4 =
            std::env::temp_dir().join(format!("stremio_thumbfast_test_{}.mp4", std::process::id()));
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x2288ee:s=320x180:d=2:r=25",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                temp_mp4.to_str().unwrap(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("failed to run ffmpeg");
        if !status.success() {
            // Fallback to mpeg4 if libx264 isn't built into ffmpeg
            let status2 = std::process::Command::new("ffmpeg")
                .args([
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x2288ee:s=320x180:d=2:r=25",
                    "-c:v",
                    "mpeg4",
                    "-pix_fmt",
                    "yuv420p",
                    temp_mp4.to_str().unwrap(),
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .expect("failed to run ffmpeg fallback");
            assert!(status2.success(), "ffmpeg test fixture failed");
        }

        let (script_tx, script_rx) = flume::unbounded();
        let (thumb_tx, _handle) = spawn_thumbnail_worker(script_tx, true);
        thumb_tx
            .send(ThumbnailCmd::SetSource(Some(
                temp_mp4.to_string_lossy().to_string(),
            )))
            .unwrap();
        thumb_tx
            .send(ThumbnailCmd::Request {
                time_sec: 1.0,
                max_width: 160,
            })
            .unwrap();

        let script = script_rx
            .recv_timeout(Duration::from_secs(8))
            .expect("expected thumbnail script callback within timeout");
        let _ = std::fs::remove_file(&temp_mp4);

        assert!(script.contains("__receiveThumbnailPreview"));
        assert!(script.contains("data:image/bmp;base64,Qk"));
        assert!(script.contains("\"width\":160"));
        assert!(script.contains("\"height\":90"));
    }
}
