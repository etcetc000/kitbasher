// Read-back ColdFire instruction validation, independent of build orchestration.
import { be32, h, u32 } from './bytes.js';
import { codeImages, type Base } from './bases.js';
import { OS_LIMIT, type Firmware } from './container.js';
import { decode, decodeLinear, type CodeMem, type Insn } from './isa.js';
import { baseScan, imageScan, isaMem } from './isa_scan.js';
import { findSite as findFlushHook, NoIndicator } from './indicator.js';
import { findLoopSkip } from './ctr_controlall.js';
import { menuRefreshSite } from './menu_refresh.js';
import { readBootRamWrites } from './boot_safety.js';
import { chromaRewritten } from './midi_chroma.js';

// ---- the ColdFire ISA_A gate (engine/src/isa.ts): our code and every patched instruction ----------

/**
 * The regions of the base's ColdFire code a build rewrites (new instructions, not a retargeted
 * operand), found by signature in the base and kept only when a patch-list site falls inside one:
 *   ctr-controlall's per-track skip (engine/src/ctr_controlall.ts findLoopSkip): 18 bytes re-encoded
 *     as one range test, so the base's instruction boundaries no longer hold there;
 *   --cpu-indicator's hook (engine/src/indicator.ts): the LCD flush's `move.l <prev>,d5` as `jsr <stub>`;
 *   the unmute-latency fix (engine/src/unmute.ts): five sequencer instructions as `jsr <routine>` (+ `nop`);
 *   --midi-chroma's hook (engine/src/midi_chroma.ts): X.14's 20-byte parser range test as
 *     `jsr hook; beq.w; bmi.w; nop x3`, or 1.63's 16-byte MIDI-task channel test as `jsr hook; bmi.w; nop x3`.
 * [lo, hi) is the replaced CODE; the ISA gate decodes it linearly from lo.
 */
export function rewrittenCode(baseFw: Firmware, base: Base, sites: number[]): [number, number][] {
  const cf = baseFw.slots[0].raw, org = base.os.cfBase;
  const hit = (lo: number, hi: number): boolean => sites.some((s) => s + 4 > lo && s < hi);
  const out: [number, number][] = [];
  const menu=menuRefreshSite(base,cf);
  if (menu && hit(menu.hook,menu.hook+6)) out.push([menu.hook,menu.hook+6]);
  for (const L of codeImages(baseFw, base).flatMap((i) => findLoopSkip(i.bytes, i.ram))) {
    if (hit(L.site, L.site + L.old.length)) out.push([L.codeAt, L.site + L.old.length]);
  }
  // the unmute-latency fix: each sequencer instruction it replaces becomes `jsr` (+ `nop`)
  for (const s of base.features.unmute?.sites ?? []) if (hit(s.at, s.at + s.old.length)) out.push([s.at, s.at + s.old.length]);
  try {
    const F = findFlushHook(cf, org);
    if (hit(F.site, F.site + 6)) out.push([F.site, F.site + 6]);
  } catch (e) { if (!(e instanceof NoIndicator)) throw e; }
  if (base.features.midiChroma) {
    const [lo, hi] = chromaRewritten(base.features.midiChroma);
    if (hit(lo, hi)) out.push([lo, hi]);
  }
  return out;
}

const baseIsaCache = new WeakMap<Uint8Array, { rej: Set<number>; starts: Set<number> }>();

/**
 * Walk the patched run-time memory of `out` (built on `base`, read from `baseFw`): the base's code
 * with the patch list applied, our RAM image and label segment where the boot routine copies them,
 * the flash our routine runs from. Every instruction in our ranges and every instruction a patched
 * word lands in must be ISA_A, and the walk may find no reject the base's own code does not have.
 */
export function isaGate(baseFw: Firmware, base: Base, out: Firmware,
  replaced: [number, number][] = []): { ok: boolean; detail: string; rejects: Insn[] } {
  const B = base.boot;
  const fl = out.flash;
  const seeds0 = [0x200000, base.os.osMain, B.routine, ...(B.addonInit !== null ? [B.addonInit] : [])];
  const baseMem = (): CodeMem[] => [...codeImages(baseFw, base).map((i) => ({ what: i.what, ram: i.ram, bytes: i.bytes.slice() }))];
  let cached = baseIsaCache.get(baseFw.slots[0].raw);
  if (!cached) {
    const bscan = baseScan(isaMem(baseMem(), B.bootCopy, baseFw.flash), { entries: seeds0, descTable: base.os.descriptorTable });
    cached = { rej: new Set(bscan.rejects.map((i) => i.at)), starts: new Set(bscan.insns.keys()) };
    baseIsaCache.set(baseFw.slots[0].raw, cached);
  }
  const baseRej = cached.rej;
  const routine = u32(fl, B.jumpOperand);
  // Validate counts, ranges and destinations before walking or allocating from
  // the emitted routine. The builder's intended patch list is not evidence.
  const patches = readBootRamWrites(fl, routine, B.sram);
  const copies: [number, number, number][] = [];
  let o = routine;
  while (u32(fl, o) >>> 16 === 0x41f9 && u32(fl, o + 6) >>> 16 === 0x43f9 && u32(fl, o + 12) >>> 16 === 0x203c) {
    copies.push([u32(fl, o + 2), u32(fl, o + 8), u32(fl, o + 14)]);
    o += 24;
  }
  const routineEnd = o + 26;                                        // lea / move.l / loop / jmp OS_MAIN
  const mem = isaMem(baseMem(), B.bootCopy, fl).filter((m) => m.what !== 'flash');
  const codeStarts = cached.starts;
  const seeds = [...seeds0, routine];
  // code the patch list replaces rather than retargets, found in the base by signature (never taken
  // on trust from the caller): only the regions the patch list really writes into
  for (const r of rewrittenCode(baseFw, base, patches.map(([s]) => s))) {
    if (!replaced.some(([lo, hi]) => lo === r[0] && hi === r[1])) replaced = [...replaced, r];
  }
  for (const [s, v] of patches) {
    const m = mem.find((x) => s >= x.ram && s + 4 <= x.ram + x.bytes.length);
    if (!m) continue;
    const old = u32(m.bytes, s - m.ram);
    m.bytes.set(be32(v), s - m.ram);
    if (codeStarts.has(old)) seeds.push(v);                          // a code pointer retargeted: follow it
  }
  const ours: [number, number][] = [[routine, routineEnd], ...copies.map(([, d, n]) => [d, d + 4 * n] as [number, number])];
  if (B.kind === 'hook') ours.push([B.routine, B.routine + 8]);
  for (const [src, dst, n] of copies) { mem.push({ what: `ours ${h(dst)}`, ram: dst, bytes: fl.slice(src, src + 4 * n) }); seeds.push(dst); }
  mem.push({ what: 'flash', ram: 0x4000, bytes: fl.subarray(0x4000, OS_LIMIT) });
  const r = imageScan(mem, { entries: seeds, descTable: base.os.descriptorTable }, ours, patches.map(([s]) => s), baseRej);
  const badPatched = r.patchedCode.filter((p) => !p.insn.ok);
  // patched words the walk did not reach (code reached through pointers it does not follow) and
  // that are not the descriptor table's data: decoded in place, from the instruction start that
  // covers the word in the unpatched base, which must decode to the same instruction shape
  const walked = new Set(r.patchedCode.map((p) => p.site));
  const dt = base.os.descriptorTable;
  const orig = baseMem();
  const local: { site: number; insn: Insn }[] = [];
  const unplaced: number[] = [];
  for (const [s] of patches) {
    // a site inside a region whose CODE we replaced is not held to the base's instruction shape:
    // that is the point of the replacement. The new bytes are decoded linearly below instead.
    if (walked.has(s) || (s >= dt && s < dt + 4 * 193)) continue;
    if (replaced.some(([lo, hi]) => s >= lo - 4 && s < hi)) continue;
    const m = mem.find((x) => s >= x.ram && s + 4 <= x.ram + x.bytes.length);
    const m0 = orig.find((x) => s >= x.ram && s + 4 <= x.ram + x.bytes.length);
    if (!m || !m0) continue;
    let done = false;
    for (const st of [s - 2, s, s - 4]) {
      if (st < m.ram) continue;
      // the instructions from `st` through the patched longword, before and after the patch
      const seq = (b: Uint8Array, org: number): Insn[] => { const o: Insn[] = []; for (let p = st; p < s + 4;) { const i = decode(b, p - org, p); o.push(i); if (!i.ok) break; p += i.len; } return o; };
      const q0 = seq(m0.bytes, m0.ram);
      if (!q0.every((i) => i.ok)) continue;
      const q1 = seq(m.bytes, m.ram);
      const same = q1.length === q0.length && q1.every((i, k) => i.ok && i.len === q0[k].len);
      for (const i of q1) local.push({ site: s, insn: same ? i : { ...i, ok: false, why: i.why ?? `the patch changed ${q0.map((x) => x.name).join('; ')} into ${q1.map((x) => x.name).join('; ')}` } });
      done = true;
      break;
    }
    if (!done) unplaced.push(s);
  }
  const badLocal = local.filter((p) => !p.insn.ok);
  // our emitted code that is code throughout: the boot routine, and a hook routine of ours
  const linear: Insn[] = [...decodeLinear(fl.subarray(routine, routineEnd), routine), ...(B.kind === 'hook' ? decodeLinear(fl.subarray(B.routine, B.routine + 8), B.routine) : [])];
  // the code we replaced in the base's own OS, decoded from the patched image
  for (const [lo, hi] of replaced) {
    const m = mem.find((x) => lo >= x.ram && hi <= x.ram + x.bytes.length);
    if (!m) { unplaced.push(lo); continue; }
    linear.push(...decodeLinear(m.bytes.subarray(lo - m.ram, hi - m.ram), lo));
  }
  const rejects = [...r.oursRejects, ...r.newRejects, ...badPatched.map((p) => p.insn), ...badLocal.map((p) => p.insn), ...linear.filter((i) => !i.ok)];
  const covered = ours.map(([lo, hi]) => r.ours.filter((i) => i.at >= lo && i.at < hi).length);
  const ok = rejects.length === 0 && unplaced.length === 0 && baseRej.size === 0 && covered[0] > 0 && r.scan.mac.every((i) => !ours.some(([lo, hi]) => i.at >= lo && i.at < hi));
  return {
    ok, rejects,
    detail: `ISA_A (MCF5206e): ${r.ours.length} instructions of ours (${ours.map(([lo, hi], i) => `${h(lo)}..${h(hi)}: ${covered[i]}`).join(', ')}), ` +
            `${walked.size} patched words in walked code + ${new Set(local.map((p) => p.site)).size} in code decoded in place (${patches.length - walked.size - new Set(local.map((p) => p.site)).size - unplaced.length} are the descriptor table's data)` +
            (unplaced.length ? `; not inside any instruction: ${unplaced.map(h).join(', ')}` : '') + '; ' +
            `${r.scan.insns.size} instructions walked, ${rejects.length} rejects` + (baseRej.size ? `; the base itself has ${baseRej.size} rejects` : ''),
  };
}
