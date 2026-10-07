// The machine-select menu on a Machinedrum without the UW option.
//
// Every 1.63-derived OS keeps the ROM and RAM families (the UW sample machines) as the last two
// records of its family table, and hides them on a unit without UW. Our families are appended
// after the base's, so they come after ROM and RAM, and how the base hides them decides what a
// non-UW unit shows:
//
//   count    OS 1.63 and DEV (init 0x22c1a0): count every record, then `subq.l #2` from the count
//            when the UW flag (0x29f306) is clear. That hides the LAST two records, which with our
//            families appended are two of ours, and leaves ROM and RAM showing (they load GND--
//            there, since a non-UW unit cannot play them). The fix: the caller of the count routine
//            enters a routine of ours instead, which on a non-UW unit moves our records down over
//            ROM and RAM, as Elektron's X.05A fix does on X.13, then enters the count; the count's
//            `bne` past its `subq.l #2` becomes `bra`, since the records are gone already. The
//            routine checks the record still holds the base's name first, so a second call
//            changes nothing.
//   shift    X.13's add-on (0x2c239c): finds the family named ROM and moves the later records
//            down over ROM and RAM. It ends that loop on an absolute address, `addi.l
//            #<table - 0x10>,d0`, which has to follow the table we build, or the loop never meets
//            it and copies through memory until the unit hangs at boot.
//   relative X.14's add-on does the same move with an index count: nothing to repoint.
//
// Found by signature in the base's own code, never by address.

import { be32, concat, h, hex, u32 } from './bytes.js';
import { findSig, type CodeImage } from './sig.js';
import { callSites } from './features.js';

export type UwMenu =
  | { kind: 'count'; entry: number; callers: number[]; branch: number; branchOld: number; uwFlag: number }
  | { kind: 'shift'; endSites: number[] }
  | { kind: 'relative' };

const BNE_SUBQ = 0x66085582;                   // bne.b +8 ; subq.l #2,d2
const BRA_SUBQ = 0x60085582;                   // bra.b +8 ; subq.l #2,d2

export function findUwMenu(images: CodeImage[], table: number): { menu: UwMenu | null; why: string } {
  const t = table.toString(16).padStart(8, '0');
  // count: the 1.63 init. Its entry names the table; its tail stores the count, tests the UW flag
  // and takes 2 off.
  const entry = findSig(images, `2f0a 2f02 4282 43f9 ${t}`);
  const tail = findSig(images, '23c2 <count> 4ab9 <uw> 6608 5582 23c2 <count2>');
  if (entry.length === 1) {
    const e = entry[0].at;
    const near = tail.filter((x) => x.at > e && x.at < e + 0x80 && x.caps.count.value === x.caps.count2.value);
    if (near.length !== 1) return { menu: null, why: `the family count at ${h(e)} has ${near.length} UW tails` };
    const callers = callSites(images.map((i) => [i.bytes, i.ram] as [Uint8Array, number]), e);
    if (!callers.length) return { menu: null, why: `no call of the family count at ${h(e)}` };
    const branch = near[0].at + 12;
    return {
      menu: { kind: 'count', entry: e, callers, branch, branchOld: BNE_SUBQ, uwFlag: near[0].caps.uw.value },
      why: `the family count at ${h(e)} (called from ${callers.map((c) => h(c - 2)).join(', ')}) takes the last two families off on a unit without UW (flag ${h(near[0].caps.uw.value)}, at ${h(branch)})`,
    };
  }
  // shift: X.13's add-on, the move loop's end as an absolute address
  const shift = findSig(images, 'd1fc <base> 0680 <end> 2168 0014 0004 10a8 0010')
    .filter((x) => x.caps.base.value === table && x.caps.end.value === table - 0x10);
  if (shift.length) {
    return { menu: { kind: 'shift', endSites: shift.map((x) => x.caps.end.at) },
             why: `the base removes ROM and RAM on a unit without UW; its loop ends at ${h(table - 0x10)}, named at ${shift.map((x) => h(x.caps.end.at)).join(', ')}` };
  }
  // relative: the same move, counted by index
  const rel = findSig(images, `d1fc ${t}`).filter((x) => {
    const img = images.find((i) => i.what === x.image)!;
    const o = x.at - img.ram;
    return Array.from(img.bytes.subarray(o + 6, o + 0x18)).map((b) => b.toString(16).padStart(2, '0')).join('').includes('21680014000410a80010');
  });
  if (rel.length) return { menu: { kind: 'relative' }, why: `the base removes ROM and RAM on a unit without UW, counting by index (${rel.map((x) => h(x.at)).join(', ')}): nothing to repoint` };
  return { menu: null, why: 'no family count with a UW test found' };
}

/**
 * The routine a `count` base's caller enters (`count` only). `hidden` is the run-time address of
 * the first of the two records a non-UW unit hides (ROM, in our copy of the table), `name` the
 * first four bytes the base has there.
 *
 *     tst.l   uw.l
 *     bne.b   go
 *     move.l  hidden.l,d0
 *     cmpi.l  #name,d0
 *     bne.b   go                 ; already moved
 *     lea     hidden.l,a0
 *     lea     hidden+16.l,a1
 * mv: move.b  (a1),d0
 *     move.l  (a1)+,(a0)+         ; name
 *     move.l  (a1)+,(a0)+         ; list
 *     tst.b   d0                  ; up to and including the ending 0 record
 *     bne.b   mv
 * go: jmp     entry.l
 *
 * d0, a0 and a1 are free on entry: the count routine sets them before it reads them.
 */
export function uwMenuCode(m: Extract<UwMenu, { kind: 'count' }>, hidden: number, name: number): Uint8Array {
  return concat([
    hex('4ab9'), be32(m.uwFlag), hex('6624'),
    hex('2039'), be32(hidden), hex('0c80'), be32(name), hex('6616'),
    hex('41f9'), be32(hidden), hex('43f9'), be32(hidden + 16),
    hex('101120d920d94a0066f6'),
    hex('4ef9'), be32(m.entry),
  ]);
}

/** Patch-list writes and the values each site must hold first. */
export function uwMenuPatches(m: UwMenu, table: number, newTable: number, routine: number | null): { patches: [number, number][]; checks: [number, number][] } {
  const patches: [number, number][] = [];
  const checks: [number, number][] = [];
  if (m.kind === 'count') {
    if (routine === null) throw new Error('the non-UW menu routine was not placed');
    for (const c of m.callers) { patches.push([c, routine]); checks.push([c, m.entry]); }
    patches.push([m.branch, BRA_SUBQ]); checks.push([m.branch, m.branchOld]);
  } else if (m.kind === 'shift') {
    for (const s of m.endSites) { patches.push([s, newTable - 0x10]); checks.push([s, table - 0x10]); }
  }
  return { patches, checks };
}

/** The record name the routine compares against, read from the base's own table. */
export const recordName = (main: Uint8Array, cfBase: number, table: number, index: number): number =>
  u32(main, table - cfBase + 8 * index);
