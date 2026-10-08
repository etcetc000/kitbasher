// The ISA gate over a base and over what we put into it (engine/src/isa.ts decodes).
//
//   baseScan   the base's own code as it runs, walked from its entry points: the reset code, the OS
//              entry, the base's boot routine and add-on init, every descriptor's knob callback,
//              every jsr/jmp abs.l target in its code. Stock X.14 and 1.63 must come out with 0
//              rejects: that is the decoder's positive control.
//   imageScan  the same walk over the patched run-time memory (patch list applied, our RAM image
//              and label segment in place, our boot routine in flash), seeded as well with every
//              entry of ours; every instruction in our ranges, and every instruction a patched word
//              lands in, must be ISA_A.

import { u32 } from './bytes.js';
import { decode, scanCode, type CodeMem, type Insn, type Scan } from './isa.js';
import { operands } from './sig.js';

export interface IsaSeeds { entries: number[]; descTable?: number; freeDesc?: number }

/** Seeds from the code itself: every jsr/jmp abs.l target that lies in the memory. */
function callTargets(mem: CodeMem[]): number[] {
  const code = mem.filter((m) => m.what !== 'flash');               // packed slots in flash are not code
  const inMem = (v: number): boolean => code.some((m) => v >= m.ram && v < m.ram + m.bytes.length) && !(v & 1);
  return operands(code, inMem).filter((o) => o.op === 0x4eb9 || o.op === 0x4ef9).map((o) => o.value);
}

/**
 * The base's code memory for the walk: its run-time images with the boot block's copy cut out of
 * the OS image (it is data there: the boot block's code, which runs from flash 0), and the flash
 * from 0x4000 on, where boot routines run (the boot block itself is not the base's to check).
 */
export function isaMem(images: CodeMem[], bootCopy: [number, number], flash: Uint8Array): CodeMem[] {
  const out: CodeMem[] = [];
  for (const i of images) {
    const [lo, hi] = bootCopy;
    if (lo >= i.ram && hi <= i.ram + i.bytes.length) {
      out.push({ what: i.what, ram: i.ram, bytes: i.bytes.subarray(0, lo - i.ram) });
      out.push({ what: i.what, ram: hi, bytes: i.bytes.subarray(hi - i.ram) });
    } else out.push(i);
  }
  out.push({ what: 'flash', ram: 0x4000, bytes: flash.subarray(0x4000, 0x100000) });
  return out;
}

export function baseScan(mem: CodeMem[], s: IsaSeeds): Scan {
  const r32 = (a: number): number | null => {
    const m = mem.find((x) => a >= x.ram && a + 4 <= x.ram + x.bytes.length);
    return m ? u32(m.bytes, a - m.ram) : null;
  };
  const seeds = [...s.entries, ...callTargets(mem)];
  if (s.descTable !== undefined) {
    for (let i = 0; i < 192; i++) {
      const d = r32(s.descTable + 4 * i);
      const cb = d === null ? null : r32(d);
      if (cb !== null) seeds.push(cb);
    }
  }
  return scanCode(mem, seeds);
}

export interface ImageIsa {
  scan: Scan;
  ours: Insn[];                          // instructions in our own ranges
  oursRejects: Insn[];
  patchedCode: { site: number; insn: Insn }[];   // patched words that land in an instruction
  newRejects: Insn[];                    // rejects in the patched memory the base did not have
}

/**
 * The patched run-time memory: `mem` (the base's code with the patch list applied, our RAM image,
 * our label segment, the flash our routine runs from), `ours` our ranges, `entries` our entry
 * points and the base's, `patches` the sites the patch list wrote, `baseRejects` the addresses the
 * unpatched base's own walk rejected (none, for a base that passes the control).
 */
export function imageScan(mem: CodeMem[], s: IsaSeeds, ours: [number, number][], patches: number[], baseRejects: Set<number>): ImageIsa {
  const scan = baseScan(mem, s);
  const inOurs = (a: number): boolean => ours.some(([lo, hi]) => a >= lo && a < hi);
  const all = [...scan.insns.values()];
  const mine = all.filter((i) => inOurs(i.at));
  const patchedCode: ImageIsa['patchedCode'] = [];
  for (const site of patches) {
    for (const i of all) if (i.at < site + 4 && site < i.at + i.len) patchedCode.push({ site, insn: i });
  }
  return { scan, ours: mine, oursRejects: mine.filter((i) => !i.ok), patchedCode,
           newRejects: scan.rejects.filter((i) => !baseRejects.has(i.at)) };
}

/** A planted-fault check of the decoder itself: `movem.l d0-d1,-(sp)` and `bfextu d0{0:8},d1`. */
export function negativeControl(): { movem: Insn; bfextu: Insn } {
  const movem = decode(Uint8Array.of(0x48, 0xe7, 0xc0, 0x00), 0, 0);
  const bfextu = decode(Uint8Array.of(0xe9, 0xc0, 0x10, 0x08), 0, 0);
  return { movem, bfextu };
}
