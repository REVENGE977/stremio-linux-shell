mod app;
mod config;
mod server;
mod utils;

use std::{env, fs, ptr};

use clap::Parser;
use gtk::glib::{ExitCode, object::ObjectExt};
use tokio::runtime::Runtime;

use crate::{
    app::Application,
    config::{DATA_DIR, GETTEXT_DIR_FLATPAK, GETTEXT_DOMAIN, STARTUP_URL},
    server::Server,
};

#[derive(Parser, Debug)]
#[command(version, ignore_errors(true), allow_hyphen_values(true))]
struct Args {
    /// Open dev tools
    #[arg(short, long)]
    dev: bool,
    /// Startup url
    #[arg(short, long, default_value = STARTUP_URL)]
    url: String,
    /// Disable window decorations
    #[arg(short, long)]
    no_window_decorations: bool,

    #[arg(trailing_var_arg = true)]
    trailing: Vec<String>,
}

fn main() -> ExitCode {
    tracing_subscriber::fmt::init();

    let data_dir = dirs::data_dir()
        .expect("Failed to get data dir")
        .join(DATA_DIR);

    fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let gettext_dir = if env::var("FLATPAK_ID").is_ok() {
        GETTEXT_DIR_FLATPAK.to_string()
    } else if let Ok(appdir) = env::var("APPDIR") {
        format!("{appdir}/usr/share/locale")
    } else if std::path::Path::new(env!("GETTEXT_DIR")).exists() {
        env!("GETTEXT_DIR").to_string()
    } else {
        "/usr/share/locale".to_string()
    };

    gettextrs::bindtextdomain(GETTEXT_DOMAIN, &gettext_dir).expect("Failed to bind text domain");
    gettextrs::bind_textdomain_codeset(GETTEXT_DOMAIN, "UTF-8")
        .expect("Failed to set the text domain encoding");
    gettextrs::textdomain(GETTEXT_DOMAIN).expect("Failed to switch text domain");

    let library = unsafe { libloading::os::unix::Library::new("libepoxy.so.0") }
        .expect("Failed to load libepoxy");

    epoxy::load_with(|name| {
        unsafe { library.get::<_>(name.as_bytes()) }
            .map(|symbol| *symbol)
            .unwrap_or(ptr::null())
    });

    let args = Args::parse();

    let server = std::rc::Rc::new(std::cell::RefCell::new(Server::new()));
    if !crate::server::is_streaming_server_online()
        && crate::server::find_server_script().is_some()
        && crate::server::is_ffmpeg_installed()
    {
        if let Err(e) = server.borrow_mut().start(args.dev) {
            tracing::warn!("Failed to start streaming server: {e}");
        } else {
            for _ in 0..50 {
                if crate::server::is_streaming_server_online() || !server.borrow_mut().is_running()
                {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }

    let mut startup_url = args.url;
    if !crate::server::is_streaming_server_online()
        && !server.borrow_mut().is_running()
        && startup_url == STARTUP_URL
    {
        tracing::info!("Streaming server is not running; falling back to direct web app URL");
        startup_url = "https://web.stremio.com/".to_string();
    }

    let app = Application::new();
    app.set_server(server.clone());
    app.set_property("dev-mode", args.dev);
    app.set_property("startup-url", startup_url);
    app.set_property("decorations", !args.no_window_decorations);

    let runtime = Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = runtime.enter();
    app.run(args.trailing)
}
