// The machine-select menu on a Machinedrum without the UW option.
//
// Every 1.63-derived OS keeps the ROM and RAM families (the UW sample machines) in its family
// table and hides them on a unit without UW (flag 0x29f306 clear). Our families are appended after
// the base's, so how the base hides ROM and RAM decides what a non-UW unit shows. The init that
// counts the families (called from 0x22544c) also writes the reverse table at 0x28d838: for every
// machine ID, its family index and its place in the list, which the machine menu opens on.
//
//   count  OS 1.63 and DEV (init 0x22c1a0): count every record, then `subq.l #2` from the count.
//          That hides the LAST two records, two of ours once they are appended, and leaves ROM and
//          RAM showing (they load GND--: a non-UW unit takes 128 off any ID of 128 and up).
//   addon  X.14 (add-on 0x2c2402), entered through `jmp` at 0x22c1a0: find the family named ROM
//          and move the later records down over ROM and RAM, AFTER writing the reverse table, so
//          every family after ROM and RAM (NFX, and all of ours) is recorded two too high and the
//          menu opens on the wrong category.
//
// The fix is the same for both: the caller of the init enters a routine of ours, which on a
// non-UW unit moves the records after ROM and RAM down over them in our copy of the table and then
// enters the init, so the init counts, and writes the reverse table for, the menu the unit shows.
// The init's own non-UW step (1.63's -2, the add-on's move) is turned off: its `bne` on the UW
// flag becomes `bra`. The routine checks the record still holds the base's name (ROM) first, so a
// second call changes nothing.
//
// Found by signature in the base's own code, never by address.

import { be32, concat, h, hex, u32 } from './bytes.js';
import { findSig, type CodeImage } from './sig.js';
import { callSites } from './features.js';

export interface UwMenu {
  kind: 'count' | 'addon';
  /** what our routine enters when done: the init (1.63) or the thunk that jumps to the add-on's */
  entry: number;
  /** operands of every jsr/jmp to `entry`: they enter our routine instead */
  callers: number[];
  /** the init's `bne` on the UW flag, and the longword at it before and after (bne -> bra) */
  branch: number; branchOld: number; branchNew: number;
  uwFlag: number;
  /** which of the base's records a non-UW unit hides: the last two (1.63) or the one named ROM and the next */
  hides: 'last-two' | 'rom';
}

const read32 = (images: CodeImage[], at: number): number | null => {
  for (const i of images) if (at >= i.ram && at + 4 <= i.ram + i.bytes.length) return u32(i.bytes, at - i.ram);
  return null;
};

export function findUwMenu(images: CodeImage[], table: number): { menu: UwMenu | null; why: string } {
  const t = table.toString(16).padStart(8, '0');
  const pairs = images.map((i) => [i.bytes, i.ram] as [Uint8Array, number]);
  const whys: string[] = [];
  // count: the 1.63 init. Its entry names the table; its tail stores the count, tests the UW flag
  // and takes 2 off. A partial match falls through to the other shapes.
  const entry = findSig(images, `2f0a 2f02 4282 43f9 ${t}`);
  if (entry.length === 1) {
    const e = entry[0].at;
    const near = findSig(images, '23c2 <count> 4ab9 <uw> 6608 5582 23c2 <count2>')
      .filter((x) => x.at > e && x.at < e + 0x80 && x.caps.count.value === x.caps.count2.value);
    const callers = callSites(pairs, e);
    if (near.length === 1 && callers.length) {
      const branch = near[0].at + 12;
      return {
        menu: { kind: 'count', entry: e, callers, branch, branchOld: 0x66085582, branchNew: 0x60085582, uwFlag: near[0].caps.uw.value, hides: 'last-two' },
        why: `the family count at ${h(e)} (called from ${callers.map((c) => h(c - 2)).join(', ')}) takes the last two families off on a unit without UW (flag ${h(near[0].caps.uw.value)}, at ${h(branch)})`,
      };
    }
    whys.push(near.length !== 1 ? `the family count at ${h(e)} has ${near.length} UW tails` : `no call of the family count at ${h(e)}`);
  } else if (entry.length > 1) whys.push(`${entry.length} family counts`);
  // addon: X.14's routine, by its entry and its store-count / test-UW / bne
  const shapes: { name: string; entry: string; branch: string }[] = [
    { name: 'X.14', entry: '2039 <uw> 4fefffe4 2f400018 1039 <table>', branch: '23c1 0028c2d4 4aaf0018 @br 66' },
  ];
  for (const s of shapes) {
    const es = findSig(images, s.entry).filter((x) => !x.caps.table || x.caps.table.value === table);
    if (es.length !== 1) continue;
    const e = es[0].at;
    const bs = findSig(images, s.branch).filter((x) => x.at > e && x.at < e + 0x140);
    // the routine is entered through a thunk (`jmp e` at 0x22c1a0), whose callers enter ours
    const thunks = callSites(pairs, e).map((c) => c - 2);
    const callers = thunks.flatMap((th) => callSites(pairs, th));
    if (bs.length !== 1 || thunks.length !== 1 || !callers.length) {
      whys.push(`${s.name}-style family routine at ${h(e)}: ${bs.length} UW branches, ${thunks.length} thunks, ${callers.length} callers`);
      continue;
    }
    const sig = s.branch.split(/\s+/);
    const branch = bs[0].at + sig.slice(0, sig.indexOf('@br')).join('').length / 2;
    const old = read32(images, branch)!;
    return {
      menu: { kind: 'addon', entry: thunks[0], callers, branch, branchOld: old, branchNew: ((0x60 << 24) | (old & 0xffffff)) >>> 0, uwFlag: es[0].caps.uw.value, hides: 'rom' },
      why: `the ${s.name}-style family routine at ${h(e)} (through ${h(thunks[0])}, called from ${callers.map((c) => h(c - 2)).join(', ')}) moves the families after ROM and RAM down after writing the reverse table (its move at ${h(branch)})`,
    };
  }
  return { menu: null, why: whys.length ? whys.join('; ') : 'no family count with a UW test found' };
}

/** The base's record index a non-UW unit starts hiding at (ROM), or null when the table does not have it. */
export function hiddenIndex(m: UwMenu, names: string[]): number | null {
  if (m.hides === 'last-two') return names.length >= 2 ? names.length - 2 : null;
  const i = names.indexOf('ROM');
  return i >= 0 && i + 1 < names.length && names[i + 1] === 'RAM' ? i : null;
}

/**
 * The routine every caller of the init enters. `hidden` is the run-time address of the first of
 * the two records a non-UW unit hides (ROM, in our copy of the table), `name` the four bytes the
 * base has there.
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
 * d0, a0 and a1 are free on entry: the init sets them before it reads them.
 */
export function uwMenuCode(m: UwMenu, hidden: number, name: number): Uint8Array {
  return concat([
    hex('4ab9'), be32(m.uwFlag), hex('6624'),
    hex('2039'), be32(hidden), hex('0c80'), be32(name), hex('6616'),
    hex('41f9'), be32(hidden), hex('43f9'), be32(hidden + 16),
    hex('101120d920d94a0066f6'),
    hex('4ef9'), be32(m.entry),
  ]);
}

/** Patch-list writes and the values each site must hold first. */
export function uwMenuPatches(m: UwMenu, routine: number | null): { patches: [number, number][]; checks: [number, number][] } {
  if (routine === null) throw new Error('the non-UW menu routine was not placed');
  const patches: [number, number][] = [];
  const checks: [number, number][] = [];
  for (const c of m.callers) { patches.push([c, routine]); checks.push([c, m.entry]); }
  patches.push([m.branch, m.branchNew]); checks.push([m.branch, m.branchOld]);
  return { patches, checks };
}

/** The record name the routine compares against, read from the base's own table. */
export const recordName = (main: Uint8Array, cfBase: number, table: number, index: number): number =>
  u32(main, table - cfBase + 8 * index);
