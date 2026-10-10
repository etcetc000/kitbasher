// Offline checks of an X.20 recipe against a decoded X.20 OS image (the ColdFire image the loader
// rebuilds at boot; never shipped, never read by the build). Run by engine/test/x20.test.ts when
// KB_X20_OS names such an image.
//
//  - anchors: every site holds the bytes the recipe says it holds;
//  - relocation audit: every instruction that can reach what the recipe moves or resizes -- the
//    old record table, menu struct and new-machine list, the stack region and the RAM above the heap,
//    the record cap, and the fields of the globals block the USR routines reach base-relative --
//    is one the recipe patches or one its audit allowlist explains. A table the recipe moves but some
//    code still reaches by an address or offset nobody patched is how the first X.20 build broke USR
//    machine installs (RECV FAIL): those routines reached the records as $800(base) with a cap of 159.

import { decode } from './isa.js';
import type { X20Recipe } from './x20_recipe.js';

export const OS_BASE = 0x200000;

export function anchorMismatches(R: X20Recipe, os: Uint8Array): string[] {
  const out: string[] = [];
  for (const s of R.sites) {
    const o = s.at - OS_BASE;
    const got = os.subarray(o, o + s.old.length);
    if (got.length !== s.old.length || got.some((b, k) => b !== s.old[k]))
      out.push(`${s.at.toString(16)} (${s.what}): ${Buffer.from(got).toString('hex')}, recipe ${Buffer.from(s.old).toString('hex')}`);
  }
  return out;
}

export interface AuditSpec {
  code_end: string;
  /** [lo, hi) address ranges whose 32-bit references count */
  regions: { what: string; lo: string; hi: string }[];
  /** 16-bit displacements off the globals base that reach moved fields */
  displacements: string[];
  /** long immediates that are the record cap */
  constants: string[];
  /** instruction (start) address -> why it needs no patch */
  allow: Record<string, string>;
}

/** Instruction starts by a linear sweep (an unknown word counts as a 2-byte instruction). */
function starts(os: Uint8Array, end: number): number[] {
  const out: number[] = [];
  for (let a = OS_BASE; a < end;) {
    out.push(a);
    let len = 2;
    try { len = Math.max(2, decode(os, a - OS_BASE, a).len); } catch { len = 2; }
    a += len;
  }
  return out;
}

export function relocationAudit(R: X20Recipe, os: Uint8Array, spec: AuditSpec): { checked: number; unexplained: string[] } {
  const end = parseInt(spec.code_end, 16);
  const st = starts(os, end);
  const lenAt = new Map<number, number>();
  st.forEach((a, k) => lenAt.set(a, (st[k + 1] ?? end) - a));
  const insnOf = (a: number): number => {   // the instruction containing byte a
    let lo = 0, hi = st.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m] <= a) lo = m; else hi = m - 1; }
    return st[lo];
  };
  const patched = new Set<number>();
  for (const s of R.sites) for (let k = 0; k < s.old.length; k++) patched.add(s.at + k);
  const allow = new Set(Object.keys(spec.allow).map((k) => parseInt(k, 16)));
  const regions = spec.regions.map((r) => ({ what: r.what, lo: parseInt(r.lo, 16), hi: parseInt(r.hi, 16) }));
  const disps = new Set(spec.displacements.map((d) => parseInt(d, 16)));
  const consts = new Set(spec.constants.map((d) => parseInt(d, 16)));
  const seen = new Set<number>();
  const unexplained: string[] = [];
  const hit = (kind: string, at: number): void => {
    const s = insnOf(at);
    if (seen.has(s)) return;
    seen.add(s);
    const n = lenAt.get(s) ?? 2;
    for (let k = 0; k < n; k++) if (patched.has(s + k)) return;
    if (allow.has(s)) return;
    unexplained.push(`${kind} ${s.toString(16)} ${Buffer.from(os.subarray(s - OS_BASE, s - OS_BASE + n)).toString('hex')}`);
  };
  for (let o = 0; o + 4 <= end - OS_BASE; o += 2) {
    const v = ((os[o] << 24) | (os[o + 1] << 16) | (os[o + 2] << 8) | os[o + 3]) >>> 0;
    for (const r of regions) if (v >= r.lo && v < r.hi) hit(r.what, OS_BASE + o);
    if (consts.has(v) && o >= 2) {
      // a long immediate: the word before it opens a cmpi.l/move.l #imm form (or it is an extension of one)
      const s = insnOf(OS_BASE + o);
      if (s < OS_BASE + o) hit('cap constant', OS_BASE + o);
    }
    const w = (os[o] << 8) | os[o + 1];
    if (disps.has(w) && o >= 2) {
      const s = insnOf(OS_BASE + o);
      if (s < OS_BASE + o) hit('base displacement', OS_BASE + o);
    }
  }
  return { checked: seen.size, unexplained };
}
