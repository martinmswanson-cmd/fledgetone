#!/bin/sh
# Build the Plateau family (GPL-3.0): build.sh <ValleyRackFree checkout> <out.wasm>
# Only the reverb (src/Plateau/Dattorro.cpp and the dsp it uses) is compiled, not the VCV module.
# Needs emsdk's em++ on the PATH.
set -e
S="$(cd "$1" && pwd)/src"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; OBJ="$(mktemp -d)"
F="-O2 -std=c++17 -fno-exceptions -w -DNDEBUG -I$S/Plateau -I$HERE/.."
em++ $F -c "$S/Plateau/Dattorro.cpp" -o "$OBJ/dattorro.o"
em++ $F -c "$S/dsp/filters/OnePoleFilters.cpp" -o "$OBJ/onepole.o"
em++ $F -c "$S/utilities/Utilities.cpp" -o "$OBJ/util.o"
em++ $F -c "$HERE/bb_plateau.cpp" -o "$OBJ/bb.o"
em++ $F -c "$HERE/../bbplug_impl.cpp" -o "$OBJ/impl.o"
sh "$HERE/../link.sh" "$OUT" "$OBJ"/*.o
rm -rf "$OBJ"
