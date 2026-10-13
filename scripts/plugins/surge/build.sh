#!/bin/sh
# Build the Surge XT family (GPL-3.0): build.sh <surge checkout, with submodules> <out.wasm>
# Configures Surge's engine library (no JUCE, no Lua) for WebAssembly, builds it, and links it
# with bb_surge.cpp. Needs emsdk (emcmake, em++) and CMake.
set -e
S="$(cd "$1" && pwd)"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"
python3 "$HERE/prepare.py" "$S"
B="$S/build-wasm"
FLAGS="-fwasm-exceptions -msimd128 -msse4.1"
emcmake cmake -S "$S" -B "$B" -DCMAKE_BUILD_TYPE=Release -DSURGE_BUILD_32BIT_LINUX=ON -DSURGE_SKIP_JUCE_FOR_RACK=TRUE \
  -DSURGE_SKIP_LUA=TRUE -DSURGE_BUILD_TESTRUNNER=OFF -DSURGE_SKIP_ODDSOUND_MTS=TRUE -DSURGE_SKIP_WERROR=TRUE -DENABLE_LTO=OFF \
  -DCMAKE_CXX_FLAGS="$FLAGS" -DCMAKE_C_FLAGS="$FLAGS" > /dev/null
(cd "$B" && emmake make -j"$(nproc)" surge-common > /dev/null)
DEFS=$(sed -n 's/^CXX_DEFINES = //p' "$B/src/common/CMakeFiles/surge-common.dir/flags.make")
INCS=$(sed -n 's/^CXX_INCLUDES = //p' "$B/src/common/CMakeFiles/surge-common.dir/flags.make")
CXXF=$(sed -n 's/^CXX_FLAGS = //p' "$B/src/common/CMakeFiles/surge-common.dir/flags.make" | sed 's/-Werror=[a-z-]*//g')
em++ $CXXF $DEFS $INCS -I"$HERE/.." -c "$HERE/bb_surge.cpp" -o "$B/bb_surge.o"
em++ -O2 $FLAGS -I"$HERE/.." -c "$HERE/../bbplug_impl.cpp" -o "$B/bb_impl.o"
emcc -O2 -c "$HERE/nofiles.c" -o "$B/bb_nofiles.o"
LIBS=$(cd "$B" && find "$B" -name '*.a' | grep -v lua | sort)
BB_LINK_FLAGS="$FLAGS" sh "$HERE/../link.sh" "$OUT" "$B/bb_surge.o" "$B/bb_impl.o" "$B/bb_nofiles.o" -Wl,--start-group $LIBS -Wl,--end-group
