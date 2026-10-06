// The NRV2B packer: UCL 1.03's ucl_nrv2b_99_compress compiled to WebAssembly (engine/wasm).
// Level 10 reproduces Elektron's packed OS slots byte for byte, so re-packing a slot costs
// nothing against the original. bestPack takes the shorter of levels 10 and 8
// (level 10 on a tie) and verifies it with a round trip through the engine's own decoder.

import createUcl from '../../wasm/ucl.mjs';
import { equal } from './bytes.js';
import { nrv2bDecode } from './nrv2b.js';

type Ucl = Awaited<ReturnType<typeof createUcl>>;
let instance: Promise<Ucl> | null = null;

async function ucl(): Promise<Ucl> {
  if (!instance) {
    instance = createUcl().then((m) => {
      if (m._md_init() !== 0) throw new Error('ucl_init failed');
      return m;
    });
  }
  return instance;
}

export async function uclPack(data: Uint8Array, level: number): Promise<Uint8Array> {
  const m = await ucl();
  const ip = m._malloc(data.length);
  const op = m._malloc(data.length + (data.length >> 3) + 256);
  try {
    m.HEAPU8.set(data, ip);
    const n = Number(m._md_pack(ip, data.length, op, level));
    if (n < 0) throw new Error(`ucl_nrv2b_99_compress error ${n}`);
    return m.HEAPU8.slice(op, op + n);
  } finally {
    m._free(ip);
    m._free(op);
  }
}

export async function bestPack(data: Uint8Array): Promise<Uint8Array> {
  const packs = [await uclPack(data, 10), await uclPack(data, 8)];
  const comp = packs[1].length < packs[0].length ? packs[1] : packs[0];
  if (!equal(nrv2bDecode(comp).out, data)) throw new Error('NRV2B round trip failed');
  return comp;
}
