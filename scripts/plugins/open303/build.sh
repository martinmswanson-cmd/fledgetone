#!/bin/sh
# Build the Open303 family: build.sh <Open303 checkout> <out.wasm>   (needs emsdk's em++ on the PATH)
set -e
SRC="$1/Source/DSPCode"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"; OBJ="$(mktemp -d)"
for f in "$SRC"/*.cpp; do em++ -O2 -fno-exceptions -w -I"$SRC" -c "$f" -o "$OBJ/$(basename "$f" .cpp).o"; done
emcc -O2 -w -c "$SRC/fft4g.c" -o "$OBJ/fft4g.o"
em++ -O2 -fno-exceptions -I"$SRC" -I"$HERE/.." -c "$HERE/bb_open303.cpp" -o "$OBJ/bb.o"
em++ -O2 -fno-exceptions -I"$HERE/.." -c "$HERE/../bbplug_impl.cpp" -o "$OBJ/impl.o"
sh "$HERE/../link.sh" "$OUT" "$OBJ"/*.o
rm -rf "$OBJ"
