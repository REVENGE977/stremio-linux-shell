pub const APP_ID: &str = match cfg!(debug_assertions) {
    true => "io.github.revenge977.StremioLinuxShellEnhanced.Devel",
    false => "io.github.revenge977.StremioLinuxShellEnhanced",
};
pub const APP_NAME: &str = "Stremio Enhanced Shell";
pub const MPRIS_NAME: &str = "StremioLinuxShellEnhanced";
pub const URI_SCHEME: &str = "stremio://";
pub const STYLE: &str = include_str!("style.css");
