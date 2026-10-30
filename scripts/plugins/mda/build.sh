#!/bin/sh
# Build the mda family: build.sh <mda-vst source folder (the src/ inside mda-vst-src-2015-06-18.zip)> <out.wasm> [object dir]
# Uses this folder's audioeffectx.h in place of the plug-in SDK. Needs emsdk's em++ and patch on the PATH.
# A source with a patch here (mdaPiano-loud.patch: <file name>-<what>.patch) is built from a patched
# copy; the source folder itself is left as it is.
set -e
SRC="$1"; OUT="$2"; OBJ="${3:-/tmp/bb-mda-obj}"; HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OBJ"
for f in "$SRC"/*.cpp; do
  b=$(basename "$f" .cpp)
  case $b in mdaSpecMeter*|mdaLooplex) continue;; esac
  id=$(echo "$b" | sed 's/^mda//; s/[^A-Za-z0-9]//g')
  for p in "$HERE/$b"-*.patch; do
    [ -f "$p" ] || continue
    mkdir -p "$OBJ/patched"
    cp "$f" "$OBJ/patched/$b.cpp"
    patch -s "$OBJ/patched/$b.cpp" "$p"
    f="$OBJ/patched/$b.cpp"
  done
  em++ -O2 -fno-exceptions -w -I"$HERE" -I"$SRC" -DcreateEffectInstance=createEffectInstance_$id -Dfloat2strng=float2strng_$id -Dint2strng=int2strng_$id -c "$f" -o "$OBJ/$id.o"
done
em++ -O2 -fno-exceptions -I"$HERE" -c "$HERE/bb_mda.cpp" -o "$OBJ/bb.o"
em++ -O2 -fno-exceptions "$OBJ"/*.o -o "$OUT" --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=16MB -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_bb_count,_bb_info,_bb_create,_bb_destroy,_bb_params,_bb_get,_bb_set,_bb_param_name,_bb_param_display,_bb_buffer,_bb_process,_bb_midi,_bb_programs,_bb_program_name,_bb_set_program,_bb_get_program
ls -l "$OUT"
