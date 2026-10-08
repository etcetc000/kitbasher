// The prepared 1.63 base: stock OS 1.63 with a boot hook, made once, offline.
//
// Stock 1.63 has no add-on, so nothing of its own runs between the reset code and the OS, and the
// patcher has nothing to chain onto. 1.63 is a fixed release, so rather than re-pack arbitrary
// ColdFire slots in the browser, this makes one fixed base from it:
//
//   * the OS jump at 0x20003a (jmp $213a0c, the last instruction of the reset code, just below the
//     bootstrap-rewrite routine at 0x200040, which stays byte for byte) names a hook routine
//     in flash instead;
//   * the hook routine is `jmp $213a0c` (and a nop): it does nothing but continue into the OS, so
//     the prepared base behaves exactly as 1.63 does. It sits right after the container, where
//     X.14 keeps its add-on (flash 0xe96e0);
//   * the ColdFire slot is re-packed (UCL NRV2B, the shorter of levels 10 and 8) with that one
//     operand changed. The stream fits the stock slot's length, so the slot header keeps it and
//     nothing after it moves; the slot's checksum is rewritten.
//
// The patcher then treats it as a base with a hook (discover kind 'hook'): its build chains
// through the hook's jmp, as it chains through X.14's routine. The flash after the DSP1 slot is
// pinned (the jump naming the hook is inside the packed ColdFire slot), so the build is keep-end.
// Further base code can later be added as an add-on behind the same hook.

import { be32, concat, equal, h, sha256, sum32, u32 } from './bytes.js';
import { parseFlash, readFirmware, OS_LIMIT } from './container.js';
import { nrv2bDecode } from './nrv2b.js';
import { containerOf, encodeSyx } from './syx.js';
import { bestPack } from './ucl.js';

/** Stock SPS-1UW OS 1.63: the unpacked slots' sha256 (tag '163 '). */
export const STOCK_163 = {
  coldfire: '95d74ace951af86777d1deeb2b6c993213344d7d8ae64a985c5df36f3b499e12',
  dsp2: 'e1d845a772f87b04e1681130f3e3eab2db20dc4d047489375a3be93870c591bc',
  dsp1: '0fd8b64a4cef976c07f246ab543294c263b08f543ebff8f8415811d29e434c06',
};

export const HOOK_OS_JUMP = 0x20003a;      // operand of the reset code's jmp to the OS
export const OS_MAIN = 0x213a0c;

export interface Prepared { output: Uint8Array; kind: 'flash' | 'syx'; recipe: Record<string, string | number> }

export async function prepare163(input: Uint8Array): Promise<Prepared> {
  const fw = readFirmware(input);
  const cf = fw.slots[0];
  const cfSha = await sha256(cf.raw);
  if (fw.tag !== '163 ' || cfSha !== STOCK_163.coldfire || (await sha256(fw.slots[1].raw)) !== STOCK_163.dsp2 || (await sha256(fw.slots[2].raw)) !== STOCK_163.dsp1) {
    throw new Error(`not stock OS 1.63 (tag '${fw.tag}', ColdFire ${cfSha.slice(0, 16)}): only stock 1.63 is prepared`);
  }
  const o = HOOK_OS_JUMP - 0x200000;
  if (u32(cf.raw, o - 2) >>> 16 !== 0x4ef9 || u32(cf.raw, o) !== OS_MAIN) throw new Error(`no jmp $${OS_MAIN.toString(16)} at ${h(HOOK_OS_JUMP - 2)}`);
  if (fw.osEnd !== fw.tailAt - 1 && fw.osEnd !== fw.tailAt) throw new Error(`stock 1.63 carries something after its container (${h(fw.tailAt)}..${h(fw.osEnd)})`);
  const hook = (fw.tailAt + 3) & ~3;                                   // right after the container
  const routine = Uint8Array.from([0x4e, 0xf9, ...be32(OS_MAIN), 0x4e, 0x71]);   // jmp $213a0c ; nop
  const raw = cf.raw.slice();
  raw.set(be32(hook), o);
  let comp = await bestPack(raw);
  if (!equal(nrv2bDecode(comp).out, raw)) throw new Error('ColdFire round trip');
  if (comp.length > cf.length) throw new Error(`the re-packed ColdFire slot is ${comp.length} bytes, the stock slot ${cf.length}`);
  const packed = comp.length;
  comp = concat([comp, new Uint8Array(cf.length - comp.length)]);
  const img = new Uint8Array(fw.flash);
  img.set(be32(comp.length), cf.at);
  img.set(be32(sum32(comp)), cf.at + 4);
  img.set(comp, cf.at + 8);
  img.set(routine, hook);
  // read back: every slot unpacks, the ColdFire slot to stock but for the operand, all else stock
  const back = parseFlash(img, fw.kind);
  if (!equal(back.slots[0].raw, raw) || !back.slots.slice(1).every((s, i) => equal(s.raw, fw.slots[i + 1].raw)) ||
      back.slots[0].length !== cf.length || !equal(img.subarray(cf.at + 8 + cf.length, fw.tailAt), fw.flash.subarray(cf.at + 8 + cf.length, fw.tailAt)) ||
      img.subarray(hook + routine.length, OS_LIMIT).some((b) => b !== 0xff) ||
      (fw.kind === 'flash' && !equal(img.subarray(0, cf.at), fw.flash.subarray(0, cf.at))) ||
      (fw.kind === 'flash' && !equal(img.subarray(OS_LIMIT), fw.flash.subarray(OS_LIMIT)))) {
    throw new Error('the prepared image does not read back as intended');
  }
  const recipe = {
    from: `stock OS 1.63, ColdFire sha256 ${cfSha}`,
    os_jump: `${h(HOOK_OS_JUMP)}: ${h(OS_MAIN)} -> ${h(hook)}`,
    hook: `${h(hook)}: 4ef9${OS_MAIN.toString(16).padStart(8, '0')} 4e71 (jmp $${OS_MAIN.toString(16)}; nop)`,
    coldfire_packed: packed,
    coldfire_slot: cf.length,
    coldfire_sha256: await sha256(raw),
    packer: 'UCL 1.03 NRV2B, the shorter of levels 10 and 8 (engine/src/ucl.ts)',
  };
  return { output: fw.kind === 'flash' ? img : encodeSyx(containerOf(img)), kind: fw.kind, recipe };
}
