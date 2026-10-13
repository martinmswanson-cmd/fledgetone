#!/bin/sh
# Build the Mutable Instruments family: build.sh <eurorack checkout, with its stmlib submodule> <out.wasm> [object dir]
# (needs emsdk's em++ on the PATH)
set -e
SRC="$1"; OUT="$2"; OBJ="${3:-/tmp/bb-mutable-obj}"; HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OBJ"
FLAGS="-O2 -fno-exceptions -w -DTEST -I$HERE/override -I$SRC -I$HERE/.."
compile() { o="$OBJ/$(echo "$1" | sed "s|$SRC/||; s|/|_|g; s|\.cc$||; s|\.cpp$||").o"; [ -f "$o" ] && [ "$o" -nt "$1" ] || em++ $FLAGS -c "$1" -o "$o"; }
for f in $(find "$SRC/plaits/dsp" "$SRC/rings/dsp" "$SRC/elements/dsp" "$SRC/clouds/dsp" -name '*.cc') \
    "$SRC/braids/macro_oscillator.cc" "$SRC/braids/analog_oscillator.cc" "$SRC/braids/digital_oscillator.cc" "$SRC/braids/resources.cc" \
    "$SRC/plaits/resources.cc" "$SRC/rings/resources.cc" "$SRC/elements/resources.cc" "$SRC/clouds/resources.cc" \
    "$SRC/stmlib/dsp/units.cc" "$SRC/stmlib/dsp/atan.cc" "$SRC/stmlib/utils/random.cc"; do compile "$f"; done
for f in "$HERE"/bb_*.cpp "$HERE/../bbplug_impl.cpp"; do compile "$f"; done
sh "$HERE/../link.sh" "$OUT" "$OBJ"/*.o
