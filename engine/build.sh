#!/bin/sh
# Build Fledgetone's Rust plugin families for the browser: WebAssembly with 128-bit SIMD (every
# current browser has it; the relaxed kind isn't safe yet), each written where the app's plugin
# host finds it. With no arguments it builds every family below; or name the crates to build:
#   ./build.sh fledge-synth
# Then refresh the plugin catalog: node ../scripts/plugins/catalog.mjs > /dev/null
set -e
cd "$(dirname "$0")"

# Each family: its crate, and its file in public/fledgetone-plugins/ (as scripts/plugins/families.json names it)
FAMILIES="fledge-synth:fledge.wasm fledge-compressor:fledge-compressor.wasm fledge-gate:fledge-gate.wasm fledge-vocoder:fledge-vocoder.wasm fledge-repeat:fledge-repeat.wasm fledge-harmony:fledge-harmony.wasm fledge-shifter:fledge-shifter.wasm"

for family in $FAMILIES; do
  crate=${family%%:*}
  file=${family##*:}
  if [ $# -gt 0 ]; then
    case " $* " in *" $crate "*) ;; *) continue ;; esac
  fi
  RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown -p "$crate"
  built=target/wasm32-unknown-unknown/release/$(echo "$crate" | tr - _).wasm
  if [ -d ../public/fledgetone-plugins ]; then
    cp "$built" "../public/fledgetone-plugins/$file"
    ls -l "../public/fledgetone-plugins/$file"
  else
    # (Outside Fledgetone's repository: the Fledge Synth download's source/ folder)
    ls -l "$built"
  fi
done
