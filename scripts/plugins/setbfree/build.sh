#!/bin/sh
# Build the setBfree family (GPL-2.0-or-later): build.sh <setBfree checkout> <out.wasm>
# Compiles the organ's sources as its LV2 plugin does (common.mak's LV2OBJ, without JACK, ALSA
# or the convolution reverb), with bb_setbfree.cpp in place of b_synth/lv2.c. Needs emsdk's emcc.
set -e
S="$(cd "$1" && pwd)"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; OBJ="$(mktemp -d)"
I="-I$S/src -I$S/b_overdrive -I$S/b_reverb -I$S/b_whirl -I$HERE/.."
D="-DLV2SYNTH -DVERSION=\"bb\" -D_GNU_SOURCE"
for f in src/midi.c src/cfgParser.c src/program.c src/vibrato.c src/state.c src/tonegen.c src/pgmParser.c \
  src/midnam.c b_whirl/eqcomp.c b_whirl/whirl.c b_overdrive/overdrive.c b_reverb/reverb.c; do
  emcc -O2 -std=gnu99 -w $I $D -include "$HERE/quiet.h" -c "$S/$f" -o "$OBJ/$(basename "$f" .c).o"
done
em++ -O2 -std=c++17 -fno-exceptions -w $I $D -c "$HERE/bb_setbfree.cpp" -o "$OBJ/bb.o"
em++ -O2 -std=c++17 -fno-exceptions -w -I"$HERE/.." -c "$HERE/../bbplug_impl.cpp" -o "$OBJ/impl.o"
sh "$HERE/../link.sh" "$OUT" "$OBJ"/*.o
rm -rf "$OBJ"
