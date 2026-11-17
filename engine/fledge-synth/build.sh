#!/bin/sh
# Build Fledge Synth for the browser (see ../build.sh, which builds every Rust plugin family).
set -e
exec "$(dirname "$0")/../build.sh" fledge-synth
