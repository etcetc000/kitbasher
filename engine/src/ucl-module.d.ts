// engine/wasm/ucl.mjs, built by engine/wasm/build.sh (emscripten, MODULARIZE + EXPORT_ES6)
declare module '*ucl.mjs' {
  interface UclModule {
    HEAPU8: Uint8Array;
    _malloc(n: number): number;
    _free(p: number): void;
    _md_init(): number;
    _md_pack(inp: number, n: number, out: number, level: number): number;
    _md_unpack(inp: number, n: number, out: number, cap: number): number;
  }
  const createUcl: () => Promise<UclModule>;
  export default createUcl;
}
