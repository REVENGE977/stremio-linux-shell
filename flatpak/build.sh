#!/usr/bin/env bash
#
# Build Stremio Enhanced Shell as a Flatpak bundle.
#
# Usage:
#   ./flatpak/build.sh [--devel]
#

set -euo pipefail

APP_ID="io.github.revenge977.StremioLinuxShellEnhanced"
if [[ "${1:-}" == "--devel" ]]; then
    APP_ID="io.github.revenge977.StremioLinuxShellEnhanced.Devel"
fi

CWD="flatpak"

python3 "$CWD/flatpak-builder-tools/cargo/flatpak-cargo-generator.py" Cargo.lock -o "$CWD/cargo-sources.json"

flatpak-builder --repo="$CWD/repo" --force-clean "$CWD/build" "$CWD/$APP_ID.json"
flatpak build-bundle "$CWD/repo" "$CWD/$APP_ID.flatpak" "$APP_ID"
