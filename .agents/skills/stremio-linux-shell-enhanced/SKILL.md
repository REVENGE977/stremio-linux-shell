---
name: stremio-linux-shell-enhanced
description: >-
  Develop, build, lint, test, and package stremio-linux-shell-enhanced (Rust
  GTK4/libadwaita/WebKitGTK/libmpv shell, embedded src/app/enhanced TypeScript
  bundle, Flatpak, and AppImage). Use when editing Rust or TypeScript code,
  running cargo checks, bumping versions, or building Flatpak/AppImage releases.
---

# Stremio Linux Shell Enhanced

Native Linux desktop shell (`gtk4` + `libadwaita` + `webkit6` + `libmpv2`) with embedded Stremio Enhanced plugin/theme/marketplace integration.

## Project Overview & Key Identifiers

- **Crate / Binary**: `stremio-linux-shell-enhanced` (`Cargo.toml`, Rust edition `2024`).
- **Version format**: `<base>-enhanced.<N>[.<M>]` (e.g., `1.2.2-enhanced.5.1`).
- **App IDs** (`src/app/config.rs`, `build.rs`):
  - Debug (`cfg!(debug_assertions)`): `io.github.revenge977.StremioLinuxShellEnhanced.Devel`
  - Release: `io.github.revenge977.StremioLinuxShellEnhanced`
- **Runtime directories**:
  - App data: `~/.local/share/stremio-linux-shell-enhanced` (`DATA_DIR` in `src/config.rs`, created in `src/main.rs`)
  - Enhanced config/mods: `~/.config/stremio-enhanced/` (`plugins/`, `themes/`, `settings.json`, `skip_server_version.txt`, `skip_client_version.txt`, `streamingserver/`)
- **Ignored local checkout**: `./stremio-enhanced/` is listed in `.gitignore` as a reference Electron repo; do not treat it as a build input or commit files from it.
- **Startup URL & server** (`src/config.rs`, `src/main.rs`, `src/server.rs`):
  - If `server.js` and `ffmpeg`/`ffprobe` are available (or port `11470` is already listening), starts the streaming server via `stremio-runtime` or `node` (`127.0.0.1:11470`, `SERVER_IPC_KEY=LINUX`, `PR_SET_PDEATHSIG=SIGTERM`) and loads `http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fweb.stremio.com/`.
  - Falls back to `https://web.stremio.com/` if the server cannot start and `--url` was not overridden.

## Architecture Map

### Rust Shell (`src/`)

- `src/main.rs`: Parses CLI flags (`--dev`/`-d`, `--url`/`-u`, `--no-window-decorations`/`-n`), loads `libepoxy.so.0` via `dlopen`, binds gettext (`GETTEXT_DIR_FLATPAK` `/app/share/locale` when `FLATPAK_ID` is set, else compile-time `env!("GETTEXT_DIR")`), starts `Server`, enters Tokio runtime, and runs `Application`.
- `src/server.rs`: `Server` process lifecycle, `server.js` discovery (`~/.config/stremio-enhanced/streamingserver/server.js`, XDG config dir, `$SERVER_PATH`, `/app/libexec/stremio/server.js`), `find_runtime_exe` (`stremio-runtime` next to executable / `bin/` / `bin-arm64/`, fallback `node`), and FFmpeg discovery + auto-download (`BtbN/FFmpeg-Builds`).
- `src/app/mod.rs` & `src/app/imp.rs`: `adw::Application` subclass, actions (`app.quit`, `app.show-preferences`, `app.show-about`), system GTK theme detection (`detect_system_gtk_theme` checking `GTK_THEME`, `gtk-4.0/settings.ini`, `org.gnome.desktop.interface`, `gtk-3.0/settings.ini`), signal wiring, and `handle_enhanced_action` IPC dispatcher.
- `src/app/window/imp.rs` (plus `src/app/window/mod.rs`, `src/app/window/window.ui`): `gtk::ApplicationWindow` with `gtk::Overlay` stacking `Video` underlay below transparent `WebView` overlay; supports CSD `adw::HeaderBar`, native SSD (`native-titlebar`), borderless (`no-window-decorations`), KDE styling, PiP mode (`set_pip`, `start_pip_drag`, `start_pip_resize`), and window state persistence.
- `src/app/video/imp.rs` & `src/app/video/thumbnailer.rs`: `Video` (`gtk::GLArea` + `libmpv2` OpenGL render context via `epoxy`, forces `LC_NUMERIC=C`, loads `mpv-config-location`, maps `RUST_LOG` to mpv `msg-level`) and `thumbnailer.rs` (software-rendered `MPV_RENDER_API_TYPE_SW` seek-bar thumbnail worker).
- `src/app/webview/imp.rs` & `src/app/webview/mod.rs`: Transparent `webkit::WebView`, browser media disabled (`enable_media=false`, etc.), WebKit `2.54` `UseSkiaForComposition` / `UseDamagingInformationForCompositing` disablement, user script/stylesheet injection, and script message handlers `ipc`, `enhanced`, and `enhancedIpc`.
- `src/app/ipc/preload.js` (with `src/app/ipc/mod.rs`, `src/app/ipc/event.rs`, `src/app/ipc/request.rs`, `src/app/ipc/response.rs`): Bridges `window.ipc`, `window.qt.webChannelTransport`, and `globalThis.chrome.webview` to WebKit message handlers; Rust pushes replies via `__postMessage(...)`.
- `src/app/enhanced/mod.rs`: Embeds `ENHANCED_SCRIPT = include_str!("enhanced.js")`, manages `EnhancedManager` (discovers `.js`/`.plugin.js` and `.css`/`.theme.css`, parses JSDoc `@name`/`@description`/`@version`/`@author`/`@updateUrl`, persists `settings.json`), defines `EnhancedAction` (`#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]`), and implements `read_shell_preferences()`.
- `src/app/dialogs/preferences/imp.rs`, `src/app/dialogs/preferences/preferences.xml`, `src/app/dialogs/about/mod.rs`: Native Adwaita `PreferencesDialog` and `AboutDialog`.
- `src/app/discord/`, `src/app/mpris/`, `src/app/tray/`: Discord Rich Presence (`discord-rich-presence`), MPRIS2 (`mpris-server`), and StatusNotifier tray (`ksni`).

### Embedded Enhanced Frontend (`src/app/enhanced/`)

- `src/app/enhanced/build.js` bundles `src/app/enhanced/src/index.ts` and `.html` templates via `npx -y esbuild --bundle --format=iife --loader:.html=text --target=es2020` into git-tracked `src/app/enhanced/enhanced.js`.
- Key modules under `src/app/enhanced/src/`:
  - `index.ts`: Startup initialization and SPA routing hooks (`hashchange`, `popstate`, `pushState`, `replaceState`).
  - `api/stremioEnhancedApi.ts`: Exposes `window.StremioEnhancedAPI` and `__createScopedPluginAPI` (batched macrotask `localStorage` settings).
  - `bridge/videoBridge.ts`, `bridge/transparencyBridge.ts`, `bridge/mediaCapabilitiesBridge.ts`: Native MPV player transparency, video element compatibility, and codec capability shims.
  - `components/settings/settingsInjector.ts` & `settingsStyles.ts`: Injects the `Stremio Enhanced` sidebar & `#/settings/enhanced` panes using hash-resilient class-prefix selectors (e.g., `[class*="settings-content-"]`) for Stremio Web 5.1+.
  - `network/fetchInterceptor.ts`: Strips `User-Agent` headers and falls back to Rust `curl` (`httpGet` IPC) for external `GET` requests hitting CORS failures, 3xx, or 403.
  - `core/permanentCore.ts`: Preserves access to Stremio's core `getState` / `dispatch`.
  - `plugins/pluginManager.ts`, `themes/themeManager.ts`, `marketplace/marketplaceManager.ts`, `server/serverManager.ts`, `player/thumbnailPreview.ts`, `updates/updateManager.ts`.

## Local Development, Build, Lint & Test

- **Run `cargo` from the repo root**: `.cargo/config.toml` sets `SERVER_PATH="data/server.js"`, `ANV_DEBUG="video-decode,video-encode"`, `GSETTINGS_SCHEMA_DIR="target/schemas"`, and `GETTEXT_DIR="target/locale"`. `build.rs` reads `env!("GSETTINGS_SCHEMA_DIR")` and `env!("GETTEXT_DIR")` at compile time.
- **`build.rs` pipeline**:
  1. `setup_po()`: Compiles `po/*.po` into `GETTEXT_DIR` via `msgfmt`.
  2. `setup_schemas()`: Copies `data/io.github.revenge977.StremioLinuxShellEnhanced.gschema.xml` (rewriting App ID to `.Devel` on debug builds) and runs `glib-compile-schemas`.
  3. `setup_enhanced()`: Runs `node build.js` in `src/app/enhanced`.
- **Critical `build.rs` pitfall**: If `node`/`npx` fails or is offline, `build.rs` prints a warning and **silently reuses the existing `src/app/enhanced/enhanced.js`**. Always rebuild `src/app/enhanced/enhanced.js` explicitly after any TypeScript/HTML change and commit the bundle.

### Commands

```bash
# Rebuild / watch embedded Enhanced TS + HTML bundle
cd src/app/enhanced && npm run build
cd src/app/enhanced && npm run watch

# Type-check Enhanced TypeScript
cd src/app/enhanced && npx tsc --noEmit

# Run locally (dev mode enables WebKit inspector; release uses release App ID)
RUST_LOG=debug cargo run -- --dev
cargo run --release

# CI lint & build checks (.github/workflows/build.yml)
cargo fmt --all -- --check
cargo clippy --all --no-deps -- -D warnings
cargo build

# Unit tests
cargo test -- --skip test_server_discovery   # Use when no local server.js exists
cargo test app::enhanced::tests              # Enhanced IPC / metadata tests
```

Note: `server::tests::test_server_discovery` in `src/server.rs` fails unless a `server.js` exists in one of the discovery paths (`~/.config/stremio-enhanced/streamingserver/server.js`, `$SERVER_PATH`, or `/app/libexec/stremio/server.js`).

## Common Change Workflows

### 1. Adding an Enhanced IPC Action

1. Add the variant to `EnhancedAction` in `src/app/enhanced/mod.rs` (serde uses `camelCase` for tag and fields) and add a deserialization test in `app::enhanced::tests`.
2. Handle it in `handle_enhanced_action` in `src/app/imp.rs`; send async results back via `webview.evaluate_javascript("window.__receive...(...)")`.
3. Invoke `postEnhancedMessage('<camelCaseAction>', { ... })` from `src/app/enhanced/src/`.
4. Rebuild `src/app/enhanced/enhanced.js` (`cd src/app/enhanced && npm run build`), then run `cargo test app::enhanced::tests` and `cargo clippy --all --no-deps -- -D warnings`.

### 2. Adding a Shell / GSettings Preference

1. Add the `<key>` to `data/io.github.revenge977.StremioLinuxShellEnhanced.gschema.xml`.
2. If exposed in the native dialog, update `src/app/dialogs/preferences/preferences.xml` and `src/app/dialogs/preferences/imp.rs`.
3. Add the field to `ShellPreferencesUiData` and `read_shell_preferences()` in `src/app/enhanced/mod.rs`, and handle updates in `EnhancedAction::SetShellPreference` in `src/app/imp.rs`.
4. Mirror the field in `ShellPreferencesUiData` (`src/app/enhanced/src/types.ts`) and wire it in `src/app/enhanced/src/components/settings/settingsInjector.ts` (`syncShellPreferencesUI` and UI row).
5. Rebuild `src/app/enhanced/enhanced.js` and run `cargo build` so `build.rs` recompiles `target/schemas/gschemas.compiled`.

### 3. Bumping Version & Cutting a Release

1. Update `version` in `Cargo.toml` (`<base>-enhanced.<N>[.<M>]`; parsed by `src/app/enhanced/src/updates/updateManager.ts` from GitHub `main` and by `appimage/build.sh`).
2. Sync `Cargo.lock` (e.g., `cargo build` or `cargo update -w`) — Flatpak compiles offline against `Cargo.lock`.
3. Ensure `src/app/enhanced/enhanced.js` is freshly rebuilt and committed.
4. Optionally add a `<release>` entry in `data/io.github.revenge977.StremioLinuxShellEnhanced.metainfo.xml`.
5. Publishing a GitHub Release triggers `.github/workflows/release.yml` (Flatpak) and `.github/workflows/appimage.yml` (AppImage; also supports `workflow_dispatch` with optional `release_tag`).

## Building Flatpak Packages

### Prerequisites

```bash
# Ensure flatpak/flatpak-builder-tools submodule is initialized
git submodule update --init --recursive

# System tools (install flatpak, flatpak-builder, python3, aiohttp, toml)
python3 -m pip install aiohttp toml

# Flathub runtimes & SDKs
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y \
    org.gnome.Sdk//50 \
    org.gnome.Platform//50 \
    org.freedesktop.Sdk.Extension.rust-stable//25.08 \
    org.freedesktop.Platform.codecs-extra//25.08-extra \
    org.freedesktop.Platform.VAAPI.Intel//25.08
```

Rebuild `src/app/enhanced/enhanced.js` and ensure `Cargo.lock` is up to date **before** running `./flatpak/build.sh` — the `stremio` module in `flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.json` runs `cargo --offline build` without network access and before the `nodejs` module is built.

### Build, Install & Verify

```bash
./flatpak/build.sh
ls -lh flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.flatpak
flatpak install --user -y ./flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.flatpak
flatpak run io.github.revenge977.StremioLinuxShellEnhanced.Devel
```

What `flatpak/build.sh` does:
1. Generates `flatpak/cargo-sources.json` from `Cargo.lock` via `flatpak/flatpak-builder-tools/cargo/flatpak-cargo-generator.py`.
2. Runs `flatpak-builder --repo=flatpak/repo --force-clean flatpak/build flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.json` (builds `libXpresent`, `libplacebo`, `libass`, `libmpv` from mpv `v0.41.0`, `stremio` offline debug binary, and bundles Node.js `v22.15.0` x64 / `v22.23.1` arm64).
3. Bundles `flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.flatpak`.

### Flatpak Gotchas

- `flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.json` builds the `.Devel` debug profile (`target/debug/stremio-linux-shell-enhanced`, `RUST_LOG=debug`).
- Adding a new `po/<lang>.po` translation requires manually adding an `install -Dm644 target/locale/<lang>/LC_MESSAGES/stremio.mo ...` line in `post-install` of `flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.json` (currently only `es` and `fr` are installed).
- Keep pinned Node.js versions & SHA256 checksums synchronized between `flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.json` and `appimage/build.sh`.
- Gitignored build artifacts (`flatpak/.gitignore`, `.gitignore`): `flatpak/build`, `flatpak/repo`, `flatpak/cargo-sources.json`, `flatpak/*.flatpak`, `.flatpak-builder`.

## Building AppImage Packages

### Prerequisites

- **Build tools**: `cargo`, `pkg-config`, `glib-compile-schemas`, `msgfmt`, `file`, `curl`, `tar`, `sha256sum`, `python3` (for WebKitGTK path relocation), `node` + `npm`, and GTK4 / libadwaita / WebKitGTK 6.0 / libmpv / libepoxy development packages.
- **Host runtime packages bundled into `AppDir`**: `glib-networking` (TLS GIO modules), `dconf-gsettings-backend` / `dconf` (`libdconfsettings.so`), `librsvg2-common` (SVG GdkPixbuf loader), `hicolor-icon-theme`.

### Build Commands & Options

```bash
./appimage/build.sh                    # Release build with bundled Node.js
./appimage/build.sh --debug            # Debug (.Devel App ID) build
./appimage/build.sh --skip-build       # Reuse existing target/{release,debug} binary
./appimage/build.sh --no-bundle-node   # Use host 'node' instead of bundling Node.js
./appimage/build.sh --verify-appstream # Run appstreamcli validation in appimagetool
./appimage/build.sh --clean            # Remove appimage/AppDir and appimage/.cache first
./appimage/build.sh -o /custom/path.AppImage
```

Environment overrides supported by `appimage/build.sh`: `ARCH` (`x86_64` or `aarch64`), `CARGO_FLAGS`, `LINUXDEPLOY`, `APPIMAGETOOL`.

Outputs (gitignored via `appimage/.gitignore`):
- Release: `appimage/Stremio-Enhanced-Shell-<VERSION>-<ARCH>.AppImage`
- Debug: `appimage/Stremio-Enhanced-Shell-<VERSION>-devel-<ARCH>.AppImage`

### Cross-Distro Mechanics in `appimage/build.sh`

Preserve these behaviors if modifying `appimage/build.sh`:
- Downloads/caches `linuxdeploy` and `appimagetool` into `appimage/.cache/tools/` and exports `APPIMAGE_EXTRACT_AND_RUN=1` and `APPIMAGELAUNCHER_DISABLE=1` so packaging works in FUSE-less containers/CI.
- Explicitly bundles `libepoxy.so.0` (loaded via `dlopen` in `src/main.rs`), `WebKit*Process` helpers + `injected-bundle/*.so`, GIO modules (`gio-querymodules`), and GdkPixbuf loaders (`loaders.cache.in` with `@APPDIR@` rewritten at launch by `AppRun`).
- Strips `DBusActivatable=` from the `.desktop` file and compiles app + GTK4/portal GSettings schemas.
- Binary-patches hardcoded `/usr/...` WebKitGTK helper/bundle prefixes inside `libwebkitgtk-6.0.so*` to same-length `usr//...` with matching relative symlinks and `cd "$APPDIR"` in `AppRun` so Ubuntu-built AppImages run on Fedora/Arch.
- Bundles Node.js as `usr/bin/node` with symlink `usr/bin/stremio-runtime -> node` (matched by `find_runtime_exe` in `src/server.rs`).
- Generated `AppRun` exports `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`, `ANV_DEBUG=video-decode,video-encode`, and `GSK_RENDERER=opengl` when `/dev/nvidia0` is present.
- `.github/workflows/appimage.yml` intentionally builds on `ubuntu-24.04` (glibc 2.39) for broader distro compatibility.

### AppImage Verification

Check build logs for warnings (missing TLS/dconf GIO modules, missing `python3`, or `node` fallback), then verify the artifact:

```bash
ls -lh appimage/Stremio-Enhanced-Shell-*.AppImage
APPIMAGE_EXTRACT_AND_RUN=1 ./appimage/Stremio-Enhanced-Shell-*.AppImage --version
```

## Quick Troubleshooting & Pitfalls

- **Stale `enhanced.js`**: `build.rs` silently reuses `src/app/enhanced/enhanced.js` if `node`/`npx` fails; always run `cd src/app/enhanced && npm run build` and check `git diff src/app/enhanced/enhanced.js`.
- **Debug vs Release GSettings schema**: Debug builds (`cargo run` / `cargo test` / `--debug`) use `io.github.revenge977.StremioLinuxShellEnhanced.Devel`; release builds (`--release`) drop `.Devel`.
- **`LC_NUMERIC=C` for libmpv**: `src/app/video/imp.rs` calls `gettextrs::setlocale(..., "C")` before `Mpv::with_initializer`; keep this invariant when changing GTK/mpv init order.
- **NVIDIA rendering**: `data/stremio.sh` and AppImage `AppRun` force `GSK_RENDERER=opengl` when `/dev/nvidia0` exists.
- **WebKit 2.54 glitches**: `src/app/webview/imp.rs` disables `UseSkiaForComposition` and `UseDamagingInformationForCompositing` on WebKit `2.54`.
- **Clean-env `cargo test`**: Skip `test_server_discovery` when no `server.js` is present (`cargo test -- --skip test_server_discovery`).
