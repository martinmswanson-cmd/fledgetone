#!/bin/sh
# Build Fledge Synth for the browser: WebAssembly with 128-bit SIMD (every current browser has it;
# the relaxed kind isn't safe yet), written where the app's plugin host finds it. Then refresh the
# plugin catalog: node ../../scripts/plugins/catalog.mjs
set -e
cd "$(dirname "$0")"
RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/fledge_synth.wasm ../../public/fledgetone-plugins/fledge.wasm
ls -l ../../public/fledgetone-plugins/fledge.wasm
