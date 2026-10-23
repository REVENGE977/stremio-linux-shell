<div align="center">

![Stremio icon](data/icons/io.github.revenge977.StremioLinuxShellEnhanced.svg "Stremio icon")

# Stremio on Linux 
### This is a fork of [stremio-linux-shell](https://github.com/Stremio/stremio-linux-shell) with added [stremio-enhanced](https://github.com/REVENGE977/stremio-enhanced) features.

### This is a community project and is not affiliated with Stremio
Client for Stremio on Linux using [`gtk4`](https://docs.gtk.org/gtk4/) + [`libadwaita`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.8/) + [`WebKitGTK`](https://webkitgtk.org/) + [`libmpv`](https://github.com/mpv-player/mpv/blob/master/DOCS/man/libmpv.rst)

<img src="data/screenshots/screenshot1.png" alrt="Screenshot" width="800" />

</div>

## Installation

```bash
flatpak install com.stremio.Stremio
```

## Development

```bash
git clone --recurse-submodules https://github.com/Stremio/stremio-linux-shell
```

#### Fedora
```bash
dnf install gtk4-devel libadwaita-devel webkitgtk6.0-devel mpv-devel libepoxy-devel nodejs flatpak-builder
dnf install python3 && python3 -m pip install aiohttp toml # Needed for Flatpak build
```

```bash
cargo run --release # RUST_LOG=debug to print debug logs
```

#### Debian-based (Ubuntu, etc.)
```bash
apt install build-essential pkg-config libgtk-4-dev libadwaita-1-dev libwebkitgtk-6.0-dev libmpv-dev gettext nodejs flatpak-builder
apt install python3 python3-aiohttp python3-toml elfutils # Needed for Flatpak build
```

```bash
cargo run --release # RUST_LOG=debug to print debug logs
```

#### Flatpak
```bash
flatpak install -y \
    org.gnome.Sdk//50 \
    org.gnome.Platform//50 \
    org.freedesktop.Sdk.Extension.rust-stable//25.08 \
    org.freedesktop.Platform.codecs-extra//25.08-extra \
    org.freedesktop.Platform.VAAPI.Intel//25.08
```

```bash
./flatpak/build.sh
flatpak install ./flatpak/io.github.revenge977.StremioLinuxShellEnhanced.Devel.flatpak
flatpak run io.github.revenge977.StremioLinuxShellEnhanced.Devel.flatpak
```
