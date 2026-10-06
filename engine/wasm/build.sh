#!/bin/sh
# Rebuild ucl.mjs (UCL NRV2B as a single-file ES module with the wasm inlined).
# Needs emsdk: EMSDK=<emsdk checkout> sh engine/wasm/build.sh
set -e
cd "$(dirname "$0")"
EMCC="${EMSDK:-/path/to/emsdk}/upstream/emscripten/emcc"
[ -x "$EMCC" ] || EMCC="$EMCC.bat"
"$EMCC" -O2 -Iucl/include -Iucl/src -Iucl -DUCL_NO_ASM \
  uclpack.c ucl/src/n2b_99.c ucl/src/n2b_d.c ucl/src/ucl_init.c ucl/src/ucl_ptr.c \
  ucl/src/ucl_str.c ucl/src/ucl_util.c ucl/src/alloc.c ucl/src/ucl_crc.c \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,node -sEXPORT_NAME=createUcl \
  -sEXPORTED_FUNCTIONS=_md_init,_md_pack,_md_unpack,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8 \
  -o ucl.mjs
echo "built $(pwd)/ucl.mjs"
