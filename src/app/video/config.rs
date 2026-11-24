pub const FLOAT_PROPERTIES: &[&str] = &[
    "time-pos",
    "duration",
    "volume",
    "speed",
    "sub-pos",
    "sub-scale",
    "sub-delay",
    "secondary-sub-pos",
    "secondary-sub-delay",
    "cache-buffering-state",
    "demuxer-cache-time",
    "panscan",
];

pub const BOOL_PROPERTIES: &[&str] = &[
    "pause",
    "buffering",
    "seeking",
    "osc",
    "input-default-bindings",
    "input-vo-keyboard",
    "eof-reached",
    "paused-for-cache",
    "keepaspect",
    "sub-ass-force-margins",
    "secondary-sub-visibility",
];

pub const INT_PROPERTIES: &[&str] = &["sid", "aid", "vid", "secondary-sid"];

pub const STRING_PROPERTIES: &[&str] = &[
    "path",
    "mpv-version",
    "ffmpeg-version",
    "hwdec",
    "track-list",
    "sub-color",
    "sub-back-color",
    "sub-border-color",
    "sid",
    "aid",
    "vid",
    "secondary-sid",
    "mute",
    "metadata",
    "video-params",
    "sub-ass-override",
    "sub-text",
    "secondary-sub-text",
];

pub const JSON_STRING_PROPERTIES: &[&str] = &[
    "track-list",
    "video-params",
    "metadata",
    "sid",
    "aid",
    "vid",
    "secondary-sid",
];
