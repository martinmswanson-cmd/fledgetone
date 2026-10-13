#!/bin/sh
# Build the Dragonfly Reverb family (GPL-3.0): build.sh <dragonfly-reverb checkout> <out.wasm>
# Each reverb's DSP.cpp is compiled in a namespace of its own with adapter.inc; override/ stands
# in for the two bits of the plugin framework the DSP uses. Needs emsdk's em++ on the PATH.
set -e
S="$(cd "$1" && pwd)"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; OBJ="$(mktemp -d)"
F="-O2 -std=c++14 -fwasm-exceptions -w -DLIBFV3_FLOAT -I$HERE/override -I$S/common -I$HERE/.."
# (Freeverb modules that need other libraries, FFTW or a resampler, aren't used by these reverbs:
# the ones that don't compile here are left out, and the link says if one was needed)
for f in "$S"/common/freeverb/*.cpp; do em++ $F -c "$f" -o "$OBJ/fv_$(basename "$f" .cpp).o" 2>/dev/null || echo "(left out: $(basename "$f"))"; done
emcc -O2 -fwasm-exceptions -w -c "$S/common/kiss_fft/kiss_fft.c" -o "$OBJ/kiss_fft.o"
emcc -O2 -fwasm-exceptions -w -c "$S/common/kiss_fft/kiss_fftr.c" -o "$OBJ/kiss_fftr.o"
for spec in hall-reverb:Hall:1 room-reverb:Room:1 plate-reverb:Plate:2 early-reflections:Early:0; do
  dir=${spec%%:*}; rest=${spec#*:}; name=${rest%%:*}; kind=${rest#*:}
  cat > "$OBJ/bb_$name.cpp" <<CPP
#include "bbplug_impl.h"
#include <math.h>
#include <string.h>
#include <string>
#include <stdint.h>
#include <cstdint>
#include "Param.hpp"
#include "AbstractDSP.hpp"
#include "DistrhoPlugin.hpp"
#include "extra/ScopedDenormalDisable.hpp"
#include "freeverb/earlyref.hpp"
#include "freeverb/zrev2.hpp"
#include "freeverb/nrev.hpp"
#include "freeverb/nrevb.hpp"
#include "freeverb/strev.hpp"
#include "freeverb/progenitor2.hpp"
#include "freeverb/biquad.hpp"
namespace df_$name {
#include "DistrhoPluginInfo.h"
#include "DSP.cpp"
#define DF_PRESETS $kind
#include "$HERE/adapter.inc"
}
BBPlugin *make$name(float sr) { return new df_$name::Plugin(sr); }
CPP
  em++ $F -I"$S/plugins/dragonfly-$dir" -include "$HERE/../bbplug_impl.h" -c "$OBJ/bb_$name.cpp" -o "$OBJ/bb_$name.o"
done
em++ $F -c "$HERE/bb_dragonfly.cpp" -o "$OBJ/bb.o"
em++ $F -c "$HERE/../bbplug_impl.cpp" -o "$OBJ/impl.o"
BB_LINK_FLAGS=-fwasm-exceptions sh "$HERE/../link.sh" "$OUT" "$OBJ"/*.o
rm -rf "$OBJ"
