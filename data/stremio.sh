#!/bin/bash

# https://github.com/Stremio/stremio-linux-shell/pull/108
export GSK_RENDERER="${GSK_RENDERER:-opengl}"

exec /app/libexec/stremio/stremio "$@"