#!/usr/bin/env bash
#
# Automate building Stremio Enhanced Shell as a Linux AppImage.
#
# Usage:
#   ./appimage/build.sh [OPTIONS]
#
# Options:
#   -h, --help            Show this help message
#   --debug               Build debug profile (.Devel App ID) instead of release
#   --skip-build          Skip `cargo build` and reuse existing compiled binary
#   --no-bundle-node      Do not bundle Node.js runtime for the streaming server
#   --verify-appstream    Run appstreamcli validation during appimagetool packaging
#   --clean               Remove cached tools, Node.js tarball, and AppDir first
#   -o, --output <path>   Custom output path for the generated .AppImage
#
# Environment variables:
#   ARCH                  Target architecture (default: uname -m; x86_64 or aarch64)
#   CARGO_FLAGS           Additional flags passed to `cargo build`
#   LINUXDEPLOY           Path to a pre-installed linuxdeploy binary/AppImage
#   APPIMAGETOOL          Path to a pre-installed appimagetool binary/AppImage
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="$SCRIPT_DIR"
APPDIR="$WORK_DIR/AppDir"
CACHE_DIR="$WORK_DIR/.cache"
TOOLS_DIR="$CACHE_DIR/tools"

BASE_APP_ID="io.github.revenge977.StremioLinuxShellEnhanced"
BIN_NAME="stremio-linux-shell-enhanced"
GETTEXT_DOMAIN="stremio"

BUILD_PROFILE="release"
SKIP_BUILD=0
BUNDLE_NODE=1
VERIFY_APPSTREAM=0
CLEAN_ALL=0
OUTPUT_PATH=""

# Pinned Node.js versions & checksums (kept in sync with flatpak manifest)
NODE_VERSION_X64="v22.15.0"
NODE_SHA256_X64="dafe2e8f82cb97de1bd10db9e2ec4c07bbf53389b0799b1e095a918951e78fd4"
NODE_VERSION_ARM64="v22.23.1"
NODE_SHA256_ARM64="0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1"

log() {
    printf '[appimage] %s\n' "$*"
}

warn() {
    printf '[appimage] WARNING: %s\n' "$*" >&2
}

die() {
    printf '[appimage] ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --debug)
            BUILD_PROFILE="debug"
            shift
            ;;
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        --no-bundle-node)
            BUNDLE_NODE=0
            shift
            ;;
        --verify-appstream)
            VERIFY_APPSTREAM=1
            shift
            ;;
        --clean)
            CLEAN_ALL=1
            shift
            ;;
        -o|--output)
            [[ $# -ge 2 ]] || die "Option $1 requires an argument"
            OUTPUT_PATH="$2"
            shift 2
            ;;
        *)
            die "Unknown option: $1 (run with --help for usage)"
            ;;
    esac
done

# Ensure we are running on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
    die "AppImage builds must be run on Linux (detected: $(uname -s))"
fi

# Detect and normalize architecture
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
    x86_64|amd64)
        ARCH="x86_64"
        MULTIARCH="x86_64-linux-gnu"
        NODE_ARCH="x64"
        NODE_VERSION="$NODE_VERSION_X64"
        NODE_SHA256="$NODE_SHA256_X64"
        ;;
    aarch64|arm64)
        ARCH="aarch64"
        MULTIARCH="aarch64-linux-gnu"
        NODE_ARCH="arm64"
        NODE_VERSION="$NODE_VERSION_ARM64"
        NODE_SHA256="$NODE_SHA256_ARM64"
        ;;
    *)
        die "Unsupported architecture: $ARCH (supported: x86_64, aarch64)"
        ;;
esac

# Extract package version from Cargo.toml
VERSION="$(awk '
    /^\[package\]/ { in_pkg=1; next }
    /^\[/ { in_pkg=0 }
    in_pkg && /^version[[:space:]]*=/ {
        gsub(/^[^"]*"|".*$/, "")
        print
        exit
    }
' "$ROOT_DIR/Cargo.toml")"
[[ -n "$VERSION" ]] || die "Failed to parse version from Cargo.toml"

if [[ "$BUILD_PROFILE" == "debug" ]]; then
    APP_ID="${BASE_APP_ID}.Devel"
    BINARY_PATH="$ROOT_DIR/target/debug/$BIN_NAME"
    ICON_SVG_SOURCE="$ROOT_DIR/data/icons/${APP_ID}.svg"
    ICON_PNG_SOURCE="$ROOT_DIR/data/icons/${APP_ID}.png"
else
    APP_ID="$BASE_APP_ID"
    BINARY_PATH="$ROOT_DIR/target/release/$BIN_NAME"
    ICON_SVG_SOURCE="$ROOT_DIR/data/icons/${APP_ID}.svg"
    ICON_PNG_SOURCE="$ROOT_DIR/data/icons/${APP_ID}.png"
fi

if [[ -z "$OUTPUT_PATH" ]]; then
    if [[ "$BUILD_PROFILE" == "debug" ]]; then
        OUTPUT_PATH="$WORK_DIR/Stremio-Enhanced-Shell-${VERSION}-devel-${ARCH}.AppImage"
    else
        OUTPUT_PATH="$WORK_DIR/Stremio-Enhanced-Shell-${VERSION}-${ARCH}.AppImage"
    fi
fi

# Check required host tools
check_command() {
    command -v "$1" >/dev/null 2>&1 || die "Required command '$1' not found in PATH"
}

check_command pkg-config
check_command glib-compile-schemas
check_command msgfmt
check_command file
check_command curl

if [[ "$SKIP_BUILD" -eq 0 ]]; then
    check_command cargo
    if ! command -v node >/dev/null 2>&1; then
        warn "'node' not found in PATH; build.rs will reuse prebuilt src/app/enhanced/enhanced.js if present"
    fi
fi

if [[ "$BUNDLE_NODE" -eq 1 ]]; then
    check_command tar
    check_command sha256sum
fi

# Handle cleanup
if [[ "$CLEAN_ALL" -eq 1 ]]; then
    log "Cleaning $APPDIR and $CACHE_DIR"
    rm -rf "$APPDIR" "$CACHE_DIR"
fi

mkdir -p "$TOOLS_DIR"

# Download helper with atomic rename
download_file() {
    local url="$1"
    local dest="$2"
    local tmp="${dest}.tmp.$$"

    log "Downloading $(basename "$dest") from $url"
    curl -fL --retry 3 --retry-delay 2 -o "$tmp" "$url"
    mv -f "$tmp" "$dest"
}

# Resolve or download linuxdeploy & appimagetool
LINUXDEPLOY="${LINUXDEPLOY:-$TOOLS_DIR/linuxdeploy-${ARCH}.AppImage}"
if [[ ! -x "$LINUXDEPLOY" ]]; then
    download_file \
        "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-${ARCH}.AppImage" \
        "$LINUXDEPLOY"
    chmod +x "$LINUXDEPLOY"
fi

APPIMAGETOOL="${APPIMAGETOOL:-$TOOLS_DIR/appimagetool-${ARCH}.AppImage}"
if [[ ! -x "$APPIMAGETOOL" ]]; then
    download_file \
        "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" \
        "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
fi

# Allow downloaded AppImage tools to run inside Docker/CI containers without FUSE
# and prevent host AppImageLauncher (binfmt_misc) from intercepting them.
export APPIMAGE_EXTRACT_AND_RUN=1
export APPIMAGELAUNCHER_DISABLE=1

# Step 1: Build the Rust binary
if [[ "$SKIP_BUILD" -eq 0 ]]; then
    log "Building $BIN_NAME ($BUILD_PROFILE profile)..."
    CARGO_ARGS=(build --manifest-path "$ROOT_DIR/Cargo.toml")
    if [[ "$BUILD_PROFILE" == "release" ]]; then
        CARGO_ARGS+=(--release)
    fi
    if [[ -n "${CARGO_FLAGS:-}" ]]; then
        # shellcheck disable=SC2206
        CARGO_ARGS+=($CARGO_FLAGS)
    fi
    (cd "$ROOT_DIR" && cargo "${CARGO_ARGS[@]}")
else
    log "Skipping cargo build (--skip-build)"
fi

[[ -x "$BINARY_PATH" ]] || die "Compiled binary not found at $BINARY_PATH"

# Step 2: Prepare fresh AppDir layout and temporary staging dir
log "Preparing AppDir at $APPDIR..."
rm -rf "$APPDIR"
mkdir -p \
    "$APPDIR/usr/bin" \
    "$APPDIR/usr/lib" \
    "$APPDIR/usr/share/applications" \
    "$APPDIR/usr/share/glib-2.0/schemas" \
    "$APPDIR/usr/share/icons/hicolor/256x256/apps" \
    "$APPDIR/usr/share/icons/hicolor/scalable/apps" \
    "$APPDIR/usr/share/licenses/stremio" \
    "$APPDIR/usr/share/locale" \
    "$APPDIR/usr/share/man/man1" \
    "$APPDIR/usr/share/metainfo"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

install -Dm755 "$BINARY_PATH" "$STAGE_DIR/stremio"

# Step 3: Install desktop entry, icon, metainfo, manpage, license, locales
log "Installing application metadata and assets..."
DESKTOP_STAGED="$STAGE_DIR/${APP_ID}.desktop"
install -Dm644 "$ROOT_DIR/data/${BASE_APP_ID}.desktop" "$DESKTOP_STAGED"
if [[ "$BUILD_PROFILE" == "debug" ]]; then
    sed -i "s/${BASE_APP_ID}/${APP_ID}/g" "$DESKTOP_STAGED"
fi
# AppImages should not use D-Bus activation via a host .service file
sed -i '/^DBusActivatable=/d' "$DESKTOP_STAGED"

METAINFO_DEST="$APPDIR/usr/share/metainfo/${APP_ID}.metainfo.xml"
install -Dm644 "$ROOT_DIR/data/${BASE_APP_ID}.metainfo.xml" "$METAINFO_DEST"
if [[ "$BUILD_PROFILE" == "debug" ]]; then
    sed -i "s/${BASE_APP_ID}/${APP_ID}/g" "$METAINFO_DEST"
fi

if [[ -f /usr/share/icons/hicolor/index.theme ]]; then
    install -Dm644 /usr/share/icons/hicolor/index.theme "$APPDIR/usr/share/icons/hicolor/index.theme"
fi

install -Dm644 "$ROOT_DIR/data/stremio.1" "$APPDIR/usr/share/man/man1/stremio.1"
install -Dm644 "$ROOT_DIR/LICENSE" "$APPDIR/usr/share/licenses/stremio/LICENSE"

# Translations (.mo files)
if [[ -d "$ROOT_DIR/target/locale" ]]; then
    cp -a "$ROOT_DIR/target/locale/." "$APPDIR/usr/share/locale/"
else
    for po_file in "$ROOT_DIR"/po/*.po; do
        [[ -f "$po_file" ]] || continue
        lang="$(basename "$po_file" .po)"
        mkdir -p "$APPDIR/usr/share/locale/${lang}/LC_MESSAGES"
        msgfmt -o "$APPDIR/usr/share/locale/${lang}/LC_MESSAGES/${GETTEXT_DOMAIN}.mo" "$po_file"
    done
fi

# Step 4: Compile GSettings schemas (app schema + GTK4/GLib schemas)
log "Compiling GSettings schemas..."
SCHEMA_DEST="$APPDIR/usr/share/glib-2.0/schemas/${APP_ID}.gschema.xml"
install -Dm644 "$ROOT_DIR/data/${BASE_APP_ID}.gschema.xml" "$SCHEMA_DEST"
if [[ "$BUILD_PROFILE" == "debug" ]]; then
    sed -i "s/${BASE_APP_ID}/${APP_ID}/g" "$SCHEMA_DEST"
fi

for sys_schema in \
    /usr/share/glib-2.0/schemas/gschema.dtd \
    /usr/share/glib-2.0/schemas/org.gtk.gtk4.*.gschema.xml \
    /usr/share/glib-2.0/schemas/org.gtk.Settings.*.gschema.xml \
    /usr/share/glib-2.0/schemas/org.freedesktop.portal.*.gschema.xml; do
    if [[ -f "$sys_schema" ]]; then
        cp -f "$sys_schema" "$APPDIR/usr/share/glib-2.0/schemas/"
    fi
done

glib-compile-schemas "$APPDIR/usr/share/glib-2.0/schemas"

# Step 5: Collect extra binaries/modules that linuxdeploy should inspect
DEPLOY_ARGS=()

# 5a. Ensure libepoxy.so.0 (loaded via dlopen in src/main.rs) is bundled
LIBEPOXY_PATH=""
EPOXY_LIBDIR="$(pkg-config --variable=libdir epoxy 2>/dev/null || true)"
for candidate in \
    "${EPOXY_LIBDIR:+$EPOXY_LIBDIR/libepoxy.so.0}" \
    "/usr/lib/${MULTIARCH}/libepoxy.so.0" \
    "/usr/lib64/libepoxy.so.0" \
    "/usr/lib/libepoxy.so.0"; do
    if [[ -n "$candidate" && -e "$candidate" ]]; then
        LIBEPOXY_PATH="$(readlink -f "$candidate")"
        break
    fi
done
if [[ -z "$LIBEPOXY_PATH" ]]; then
    LIBEPOXY_PATH="$(ldconfig -p 2>/dev/null | awk '/libepoxy\.so\.0/ { print $NF; exit }' || true)"
fi
if [[ -n "$LIBEPOXY_PATH" && -f "$LIBEPOXY_PATH" ]]; then
    log "Including dynamically loaded libepoxy: $LIBEPOXY_PATH"
    DEPLOY_ARGS+=(--library "$LIBEPOXY_PATH")
else
    warn "Could not locate libepoxy.so.0 explicitly; relying on transitive GTK4 dependency"
fi

# 5b. WebKitGTK 6.0 helper processes & injected bundle
log "Bundling WebKitGTK 6.0 helper processes..."
WEBKIT_LIBEXEC_PC="$(pkg-config --variable=libexecdir webkitgtk-6.0 2>/dev/null || true)"
WEBKIT_LIB_PC="$(pkg-config --variable=libdir webkitgtk-6.0 2>/dev/null || true)"

WEBKIT_EXEC_DIR=""
for candidate in \
    "${WEBKIT_LIBEXEC_PC:+$WEBKIT_LIBEXEC_PC/webkitgtk-6.0}" \
    "${WEBKIT_LIB_PC:+$WEBKIT_LIB_PC/webkitgtk-6.0}" \
    "/usr/libexec/webkitgtk-6.0" \
    "/usr/lib/${MULTIARCH}/webkitgtk-6.0" \
    "/usr/lib64/webkitgtk-6.0" \
    "/usr/lib/webkitgtk-6.0"; do
    if [[ -n "$candidate" && -x "$candidate/WebKitWebProcess" ]]; then
        WEBKIT_EXEC_DIR="$candidate"
        break
    fi
done

[[ -n "$WEBKIT_EXEC_DIR" ]] || die "Could not find WebKitGTK 6.0 helper binaries (WebKitWebProcess)"

mkdir -p "$APPDIR/usr/libexec/webkitgtk-6.0"
for helper in "$WEBKIT_EXEC_DIR"/WebKit*Process; do
    [[ -f "$helper" && -x "$helper" ]] || continue
    dest="$APPDIR/usr/libexec/webkitgtk-6.0/$(basename "$helper")"
    install -Dm755 "$helper" "$dest"
    DEPLOY_ARGS+=(--deploy-deps-only "$dest")
done

WEBKIT_BUNDLE_DIR=""
for candidate in \
    "${WEBKIT_LIB_PC:+$WEBKIT_LIB_PC/webkitgtk-6.0/injected-bundle}" \
    "$WEBKIT_EXEC_DIR/injected-bundle" \
    "/usr/lib/${MULTIARCH}/webkitgtk-6.0/injected-bundle" \
    "/usr/lib64/webkitgtk-6.0/injected-bundle" \
    "/usr/lib/webkitgtk-6.0/injected-bundle"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
        WEBKIT_BUNDLE_DIR="$candidate"
        break
    fi
done

if [[ -n "$WEBKIT_BUNDLE_DIR" ]]; then
    mkdir -p "$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle"
    for bundle_so in "$WEBKIT_BUNDLE_DIR"/*.so; do
        [[ -f "$bundle_so" ]] || continue
        dest="$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle/$(basename "$bundle_so")"
        install -Dm755 "$bundle_so" "$dest"
        DEPLOY_ARGS+=(--deploy-deps-only "$dest")
    done
fi

# 5c. GIO modules (TLS / glib-networking & dconf GSettings backend)
log "Bundling GIO modules..."
GIO_MODULE_SRC="$(pkg-config --variable=giomoduledir gio-2.0 2>/dev/null || true)"
for candidate in \
    "$GIO_MODULE_SRC" \
    "/usr/lib/${MULTIARCH}/gio/modules" \
    "/usr/lib64/gio/modules" \
    "/usr/lib/gio/modules"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
        GIO_MODULE_SRC="$candidate"
        break
    fi
done

if [[ -n "$GIO_MODULE_SRC" && -d "$GIO_MODULE_SRC" ]]; then
    mkdir -p "$APPDIR/usr/lib/gio/modules"
    for mod in libgiognutls.so libgioopenssl.so libgiolibproxy.so libgiognomeproxy.so libgioenvironmentproxy.so libdconfsettings.so; do
        if [[ -f "$GIO_MODULE_SRC/$mod" ]]; then
            dest="$APPDIR/usr/lib/gio/modules/$mod"
            install -Dm755 "$GIO_MODULE_SRC/$mod" "$dest"
            DEPLOY_ARGS+=(--deploy-deps-only "$dest")
        fi
    done

    if [[ ! -f "$APPDIR/usr/lib/gio/modules/libgiognutls.so" && ! -f "$APPDIR/usr/lib/gio/modules/libgioopenssl.so" ]]; then
        warn "No GLib TLS GIO module found (install 'glib-networking' so HTTPS works across distros)"
    fi
    if [[ ! -f "$APPDIR/usr/lib/gio/modules/libdconfsettings.so" ]]; then
        warn "libdconfsettings.so not found (install 'dconf-gsettings-backend' / 'dconf' to bundle persistent GSettings)"
    fi

    GIO_QUERYMODULES="$(pkg-config --variable=gio_querymodules gio-2.0 2>/dev/null || true)"
    if [[ -z "$GIO_QUERYMODULES" || ! -x "$GIO_QUERYMODULES" ]]; then
        for candidate in \
            "$(command -v gio-querymodules 2>/dev/null || true)" \
            "$(command -v gio-querymodules-64 2>/dev/null || true)" \
            "/usr/lib/${MULTIARCH}/glib-2.0/gio-querymodules" \
            "/usr/lib64/glib-2.0/gio-querymodules" \
            "/usr/lib/glib-2.0/gio-querymodules"; do
            if [[ -n "$candidate" && -x "$candidate" ]]; then
                GIO_QUERYMODULES="$candidate"
                break
            fi
        done
    fi
    if [[ -n "$GIO_QUERYMODULES" && -x "$GIO_QUERYMODULES" ]]; then
        "$GIO_QUERYMODULES" "$APPDIR/usr/lib/gio/modules"
    fi
fi

# 5d. GdkPixbuf loaders (SVG, PNG, JPEG, etc.)
log "Bundling GdkPixbuf loaders..."
PIXBUF_MODULE_SRC="$(pkg-config --variable=gdk_pixbuf_moduledir gdk-pixbuf-2.0 2>/dev/null || true)"
PIXBUF_QUERY="$(pkg-config --variable=gdk_pixbuf_query_loaders gdk-pixbuf-2.0 2>/dev/null || true)"
if [[ -z "$PIXBUF_QUERY" || ! -x "$PIXBUF_QUERY" ]]; then
    for candidate in \
        "$(command -v gdk-pixbuf-query-loaders 2>/dev/null || true)" \
        "$(command -v gdk-pixbuf-query-loaders-64 2>/dev/null || true)" \
        "/usr/lib/${MULTIARCH}/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" \
        "/usr/lib64/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" \
        "/usr/lib/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders"; do
        if [[ -n "$candidate" && -x "$candidate" ]]; then
            PIXBUF_QUERY="$candidate"
            break
        fi
    done
fi

if [[ -n "$PIXBUF_MODULE_SRC" && -d "$PIXBUF_MODULE_SRC" ]]; then
    mkdir -p "$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders"
    for loader in "$PIXBUF_MODULE_SRC"/*.so; do
        [[ -f "$loader" ]] || continue
        dest="$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders/$(basename "$loader")"
        install -Dm755 "$loader" "$dest"
        DEPLOY_ARGS+=(--deploy-deps-only "$dest")
    done

    if [[ -n "$PIXBUF_QUERY" && -x "$PIXBUF_QUERY" ]]; then
        ESCAPED_APPDIR="${APPDIR//\\/\\\\}"
        ESCAPED_APPDIR="${ESCAPED_APPDIR//&/\\&}"
        ESCAPED_APPDIR="${ESCAPED_APPDIR//|/\\|}"
        GDK_PIXBUF_MODULEDIR="$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders" \
            "$PIXBUF_QUERY" \
            | sed "s|${ESCAPED_APPDIR}|@APPDIR@|g" \
            > "$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders.cache.in"
    else
        warn "gdk-pixbuf-query-loaders not found; skipping loaders.cache generation"
    fi
fi

# Step 6: Run linuxdeploy to bundle shared libraries & patch RPATHs
log "Running linuxdeploy..."
"$LINUXDEPLOY" \
    --appdir "$APPDIR" \
    --executable "$STAGE_DIR/stremio" \
    --desktop-file "$DESKTOP_STAGED" \
    --icon-file "$ICON_PNG_SOURCE" \
    ${DEPLOY_ARGS[@]+"${DEPLOY_ARGS[@]}"}

# Ensure both scalable SVG and 256x256 PNG icons + Type 2 AppImage .DirIcon are installed cleanly
rm -f "$APPDIR/${APP_ID}.svg" "$APPDIR/${APP_ID}.png" "$APPDIR/.DirIcon"
if [[ -f "$ICON_SVG_SOURCE" ]]; then
    install -Dm644 "$ICON_SVG_SOURCE" "$APPDIR/usr/share/icons/hicolor/scalable/apps/${APP_ID}.svg"
fi
if [[ -f "$ICON_PNG_SOURCE" ]]; then
    install -Dm644 "$ICON_PNG_SOURCE" "$APPDIR/usr/share/icons/hicolor/256x256/apps/${APP_ID}.png"
    install -Dm644 "$ICON_PNG_SOURCE" "$APPDIR/${APP_ID}.png"
    install -Dm644 "$ICON_PNG_SOURCE" "$APPDIR/.DirIcon"
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$APPDIR/usr/share/icons/hicolor" || true
fi

# Step 6b: Relocate hardcoded WebKitGTK helper/bundle paths inside libwebkitgtk-6.0.so*
# Release builds of WebKitGTK ignore WEBKIT_EXEC_PATH and hardcode the build distro's path
# (e.g. /usr/lib/x86_64-linux-gnu/webkitgtk-6.0 on Ubuntu), which crashes on other distros
# like Fedora/Arch. Rewrite the leading "/usr/" (5 bytes) to "usr//" (5 bytes) for the
# WebKit path prefix and create matching relative symlinks inside $APPDIR.
if [[ -d "$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle" && ! -e "$APPDIR/usr/libexec/webkitgtk-6.0/injected-bundle" ]]; then
    ln -sfn "../../lib/webkitgtk-6.0/injected-bundle" "$APPDIR/usr/libexec/webkitgtk-6.0/injected-bundle"
fi

if [[ "$WEBKIT_EXEC_DIR" == /usr/* ]]; then
    REL_WEBKIT_EXEC_DIR="${WEBKIT_EXEC_DIR#/}"
    if [[ "$REL_WEBKIT_EXEC_DIR" != "usr/libexec/webkitgtk-6.0" ]]; then
        mkdir -p "$APPDIR/$(dirname "$REL_WEBKIT_EXEC_DIR")"
        rm -rf "$APPDIR/$REL_WEBKIT_EXEC_DIR"
        REL_TARGET="$(realpath --relative-to="$APPDIR/$(dirname "$REL_WEBKIT_EXEC_DIR")" "$APPDIR/usr/libexec/webkitgtk-6.0")"
        ln -sfn "$REL_TARGET" "$APPDIR/$REL_WEBKIT_EXEC_DIR"
    fi
fi

if [[ -n "$WEBKIT_BUNDLE_DIR" && "$WEBKIT_BUNDLE_DIR" == /usr/* && "$WEBKIT_BUNDLE_DIR" != "$WEBKIT_EXEC_DIR"* ]]; then
    REL_WEBKIT_BUNDLE_DIR="${WEBKIT_BUNDLE_DIR#/}"
    if [[ "$REL_WEBKIT_BUNDLE_DIR" != "usr/lib/webkitgtk-6.0/injected-bundle" ]]; then
        mkdir -p "$APPDIR/$(dirname "$REL_WEBKIT_BUNDLE_DIR")"
        rm -rf "$APPDIR/$REL_WEBKIT_BUNDLE_DIR"
        REL_BUNDLE_TARGET="$(realpath --relative-to="$APPDIR/$(dirname "$REL_WEBKIT_BUNDLE_DIR")" "$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle")"
        ln -sfn "$REL_BUNDLE_TARGET" "$APPDIR/$REL_WEBKIT_BUNDLE_DIR"
    fi
fi

if command -v python3 >/dev/null 2>&1; then
    PATCH_PREFIXES=("$WEBKIT_EXEC_DIR")
    if [[ -n "$WEBKIT_BUNDLE_DIR" && "$WEBKIT_BUNDLE_DIR" != "$WEBKIT_EXEC_DIR"* ]]; then
        PATCH_PREFIXES+=("$WEBKIT_BUNDLE_DIR")
    fi
    for prefix in "${PATCH_PREFIXES[@]}"; do
        [[ "$prefix" == /usr/* ]] || continue
        old_str="$prefix"
        new_str="usr//${prefix#/usr/}"
        python3 - "$old_str" "$new_str" "$APPDIR/usr/lib" <<'PY'
import glob, os, sys

old_b = sys.argv[1].encode("utf-8")
new_b = sys.argv[2].encode("utf-8")
assert len(old_b) == len(new_b), f"Length mismatch: {len(old_b)} vs {len(new_b)}"
lib_dir = sys.argv[3]

for path in glob.glob(os.path.join(lib_dir, "libwebkitgtk-6.0.so*")):
    if os.path.islink(path) or not os.path.isfile(path):
        continue
    with open(path, "rb") as f:
        data = f.read()
    count = data.count(old_b)
    if count > 0:
        with open(path, "wb") as f:
            f.write(data.replace(old_b, new_b))
        print(f"[appimage] Patched {count} occurrence(s) of {old_b.decode()} -> {new_b.decode()} in {os.path.basename(path)}")
PY
    done
else
    warn "python3 not found; skipping libwebkitgtk-6.0 hardcoded path relocation"
fi

# Step 7: Optionally bundle official Node.js binary as stremio-runtime for the streaming server
if [[ "$BUNDLE_NODE" -eq 1 ]]; then
    NODE_TARBALL="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    NODE_CACHE_FILE="$CACHE_DIR/$NODE_TARBALL"

    if [[ ! -f "$NODE_CACHE_FILE" ]]; then
        download_file "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}" "$NODE_CACHE_FILE"
    fi

    log "Verifying Node.js checksum ($NODE_TARBALL)..."
    if ! printf '%s  %s\n' "$NODE_SHA256" "$NODE_CACHE_FILE" | sha256sum -c --status; then
        rm -f "$NODE_CACHE_FILE"
        die "SHA256 verification failed for $NODE_TARBALL"
    fi

    log "Extracting Node.js binary into AppDir..."
    tar -xJf "$NODE_CACHE_FILE" \
        --strip-components=2 \
        -C "$APPDIR/usr/bin" \
        "node-${NODE_VERSION}-linux-${NODE_ARCH}/bin/node"
    chmod 755 "$APPDIR/usr/bin/node"
    # src/server.rs checks for `stremio-runtime` alongside the main executable
    ln -sf node "$APPDIR/usr/bin/stremio-runtime"
else
    log "Skipping Node.js bundling (--no-bundle-node); host 'node' will be used for streaming server"
fi

# Step 8: Write custom AppRun launcher (remove any symlink created by linuxdeploy first!)
log "Writing AppRun..."
rm -f "$APPDIR/AppRun"
cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
set -e

HERE="$(dirname "$(readlink -f "$0")")"
export APPDIR="${APPDIR:-$HERE}"

# Append bundled bin dir so host tools are not shadowed, while bundled node stays available as fallback
export PATH="${PATH}:$APPDIR/usr/bin"

# Data directories (icons, themes, schemas)
export XDG_DATA_DIRS="$APPDIR/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

# Compiled GSettings schemas (app schema + GTK4 schemas)
export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:$GSETTINGS_SCHEMA_DIR}"

# GIO modules (TLS / glib-networking & dconf)
if [ -d "$APPDIR/usr/lib/gio/modules" ]; then
    if [ -f "$APPDIR/usr/lib/gio/modules/libdconfsettings.so" ]; then
        export GIO_MODULE_DIR="$APPDIR/usr/lib/gio/modules"
    else
        export GIO_EXTRA_MODULES="$APPDIR/usr/lib/gio/modules${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
    fi
fi

# GdkPixbuf loaders with runtime-resolved AppDir paths
if [ -f "$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders.cache.in" ]; then
    export GDK_PIXBUF_MODULEDIR="$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders"
    _pixbuf_cache="${XDG_RUNTIME_DIR:-/tmp}/stremio-appimage-pixbuf-$(basename "$APPDIR").cache"
    _escaped_appdir="${APPDIR//\\/\\\\}"
    _escaped_appdir="${_escaped_appdir//&/\\&}"
    _escaped_appdir="${_escaped_appdir//|/\\|}"
    sed "s|@APPDIR@|${_escaped_appdir}|g" "$APPDIR/usr/lib/gdk-pixbuf-2.0/loaders.cache.in" > "$_pixbuf_cache"
    export GDK_PIXBUF_MODULE_FILE="$_pixbuf_cache"
fi

# WebKitGTK 6.0 helper processes & injected bundle
if [ -d "$APPDIR/usr/libexec/webkitgtk-6.0" ]; then
    export WEBKIT_EXEC_PATH="$APPDIR/usr/libexec/webkitgtk-6.0"
fi
if [ -d "$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle" ]; then
    export WEBKIT_INJECTED_BUNDLE_PATH="$APPDIR/usr/lib/webkitgtk-6.0/injected-bundle"
fi
# WebKitGTK's bubblewrap sandbox often fails inside FUSE-mounted AppImages
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS="${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-1}"

# Intel Vulkan video acceleration (matches .cargo/config.toml & Flatpak manifest)
export ANV_DEBUG="${ANV_DEBUG:-video-decode,video-encode}"

# Prefer GSK OpenGL renderer to avoid GL<->Vulkan copies with WebKitGTK and libmpv GLArea (matches data/stremio.sh)
export GSK_RENDERER="${GSK_RENDERER:-opengl}"

# Run from $APPDIR so relocated relative WebKitGTK paths (usr//...) resolve inside the AppImage
cd "$APPDIR"
exec "$APPDIR/usr/bin/stremio" "$@"
EOF
chmod 755 "$APPDIR/AppRun"

# Step 9: Package AppDir into the final AppImage
log "Packaging AppImage -> $OUTPUT_PATH"
mkdir -p "$(dirname "$OUTPUT_PATH")"
APPIMAGETOOL_ARGS=()
if [[ "$VERIFY_APPSTREAM" -eq 0 ]]; then
    APPIMAGETOOL_ARGS+=(--no-appstream)
fi

ARCH="$ARCH" "$APPIMAGETOOL" ${APPIMAGETOOL_ARGS[@]+"${APPIMAGETOOL_ARGS[@]}"} "$APPDIR" "$OUTPUT_PATH"
chmod +x "$OUTPUT_PATH"

log "Done! AppImage created at: $OUTPUT_PATH"
