#!/bin/sh
# Build the Airwindows family: build.sh <airwin2rack checkout> <out.wasm> [object dir]
# (airwin2rack at the commit in ../README.md; needs emsdk's em++ on the PATH)
set -e
SRC="$1"; OUT="$2"; OBJ="${3:-/tmp/bb-airwin-obj}"; HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OBJ"
# Compile each effect on its own (in parallel; kept between runs), then link
ls "$SRC"/src/autogen_airwin/*.cpp | xargs -P "$(nproc)" -I{} sh -c 'o="'"$OBJ"'/$(basename "{}" .cpp).o"; [ -f "$o" ] || em++ -O2 -fno-exceptions -I"'"$SRC"'/src" -c "{}" -o "$o"'
em++ -O2 -fno-exceptions -I"$SRC/src" -c "$SRC/src/airwin_consolidated_base.cpp" -o "$OBJ/base.o"
em++ -O2 -fno-exceptions -I"$SRC/src" -c "$HERE/bb_airwin.cpp" -o "$OBJ/bb.o"
em++ -O2 -fno-exceptions "$OBJ"/*.o -o "$OUT" --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=16MB -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_bb_count,_bb_info,_bb_create,_bb_destroy,_bb_params,_bb_get,_bb_set,_bb_param_name,_bb_param_display,_bb_buffer,_bb_process,_bb_midi,_bb_programs,_bb_program_name,_bb_set_program,_bb_get_program
ls -l "$OUT"
