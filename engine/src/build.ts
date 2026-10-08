import { isaGate, rewrittenCode } from './isa_gate.js';
import { assertBootRamWrites, readBootRamWrites } from './boot_safety.js';
import { decodeLinear } from './isa.js';
import { menuRefreshPatches } from './menu_refresh.js';
import { uwMenuPatches } from './uw_menu.js';
import { checkChromaCode, chromaPatches, chromaRanges } from './midi_chroma.js';
export { isaGate, rewrittenCode } from './isa_gate.js';
// Build orchestration: discovered base + relocatable packs -> gated OS image.
// Planning owns placement; selection.ts owns catalog/IDs; isa_gate.ts independently reads
// emitted ColdFire instructions back. The order of writing, compression and verification here
// matters: later gates read back what earlier steps produced.
//
//   DSP2      the E12 bank is re-laid with long samples' tails trimmed; the machines' code and
//             tables are linked first-fit into the freed space and the base's free regions, and
//             their dispatch entries are written; the slot is re-packed (UCL NRV2B).
//   ColdFire  the slot itself is not touched. A RAM image (knob callback, one descriptor per
//             machine, one menu list per family, the base's family table plus the added families) and a patch
//             list go in free flash after the base's add-on, with a boot routine that copies the
//             image, applies the list to the running OS and enters it. The base's own boot routine
//             is chained: its final jump enters the added routine, its add-on operand follows the add-on.
//   Layout    by default the DSP2 slot takes the re-packed stream's length and everything after it
//             moves (kept 4-aligned). A base whose flash after the DSP1 slot is named by something
//             the build cannot rewrite (discovery: a scatter table of absolute flash offsets, a
//             boot routine named from inside the packed ColdFire slot) is `keep-end`: DSP2 and DSP1
//             share the two slots' old length (DSP2's stream padded with a dead tail, less what
//             DSP1 grew), so the flash after them stays byte for byte where it was.
//   IDs       machines keep their preferred ID where the base has it free; the ID-range fixes a
//             machine needs on 124..127, 169..175 or 0x5f are applied only when one sits there.

import { be32, Buf, concat, equal, fromBase64, h, u32, wordsLE, fromWordsLE, sum32, sha256 } from './bytes.js';
import { codeImages, type Base } from './bases.js';
import { bootRoutine, hostSendCheck, HOST_SEND_STOCK, levBarJmp } from './coldfire.js';
import { parseFlash, readFirmware, OS_LIMIT, type Firmware } from './container.js';
import { records } from './dsp.js';
import { operands } from './sig.js';
import type { TrimEntry, TrimOptions } from './e12.js';
import { nrv2bDecode } from './nrv2b.js';
import { checkPack, needLines, type CorePack, type Pack } from './packs.js';
import { IND_EXT_SPAN, plan, type Plan, type Selection, type Trimmed } from './plan.js';
import { containerOf, encodeSyx } from './syx.js';
import { bestPack } from './ucl.js';
import { appendLayout, canonical, defaultLayout, encodeLayout, findLayout, type Layout } from './layout.js';
import { checkPiClean } from './pi_clean.js';
import { checkStubTrim, trimStub } from './stub_trim.js';
import { dsp2Mem } from './discover.js';
import { checkWatchdog, setWatchdog } from './watchdog.js';
import { checkRecover, recoverRecords, wdHalt } from './recover.js';
import { checkIndicator, hookPatches, HOLD, CUE, PUT, DSP1_ISR, checkTable, putTable } from './indicator.js';
import * as REC from './recover.js';
import { drivePlacementProblems } from './features.js';
import { findWatchdog } from './watchdog.js';
import { alignOf, inMask, SECTOR } from './align.js';
import {recoveryFeatures,patchRetirement,cleanDsp1Records,cleanDsp1Sites,checkCleanRecovery} from './clean_recovery.js';

export interface BuildOptions extends Selection {
  trim: TrimOptions;
  /**
   * Debug: raise DSP1's DMA0 overrun watchdog from 3 consecutive missed frames to this many, by
   * rewriting the one immediate the count lives in (engine/src/watchdog.ts). A machine that costs
   * too much then glitches through up to N-1 late blocks instead of halting DSP1 until the unit is
   * power-cycled. Absent (the default), the DSP1 upload is the base's, word for word.
   */
  dsp1Watchdog?: number;
  /**
   * Narrow the one gate that keeps FUNC + knob (control all) from reaching a machine on 124..127
   * (engine/src/ctr_controlall.ts). Off by default, so an image built without it is byte-identical
   * to one built without the option; it only has an effect when a machine sits on 124..127 and the
   * base has the gate.
   */
  ctrControlAll?: boolean;
  /**
   * Cut the DSP2 silence stub's pad from 50 passes to 1 (engine/src/stub_trim.ts): one word of the
   * base, about 460 cycles back per idle track per block. On by default; false gives the base's stub.
   */
  stubTrim?: boolean;
}

export interface Gate { name: string; ok: boolean; detail: string }

export interface BuildReport {
  model_runtime?: Base['modelRuntime'];
  base: string;
  /** hardware-proven base / emulator-gated / discovered only: a label on the output, never a gate */
  qualification: { level: string; by: string; profile: string | null };
  /** what discovery found this base supports, feature by feature */
  support: Record<string, { ok: boolean; why: string }>;
  layout_kind: 'resize' | 'keep-end';
  machines: { key: string; name: string; id: number; preferred: number; family: string; org: string; words: number;
               /** the cache offset this origin was put on, the words skipped for it, and the sectors it saves */
               align?: { offset: number; pad: number; sectors: [number, number] } }[];
  e12: { threshold_db: number; min_seconds: number; cap: number | null; bank_end: string; freed_words: number; samples: TrimEntry[];
         /** present only with sample edits: the swapped entries, those cut to their stock length, those kept whole, and firsts padded for a partner */
         edits?: { swapped: number[]; capped: number[]; no_trim: number[]; padded: { entry: number; for: number }[] } };
  dsp2: { packed: number; base_packed: number; packed_capacity: number | null; raw: number; regions: [string, string][]; machine_words: number; free_words: number;
          /** words spent on instruction-cache alignment that nothing else took (0 with --no-align) */
          align_padding: number; aligned: number };
  ext: { base: string; bytes: number; limit: number; free: number; lev_stub: string | null };
  /** machines not on their preferred ID: empty unless the build allowed moves */
  id_moves: { name: string; preferred: number; id: number; why: string }[];
  /** run-time data machines read that the firmware does not carry, one line each */
  needs: string[];
  /** the P-I clean stub, when a selected machine leaves state in its track's P-I slice */
  pi_clean: { org: string; words: number; span: [string, number]; ids: number[]; machines: string[] } | null;
  /** the DSP2 silence stub's pad: trimmed (where and from what), or why not; null with --no-stub-trim */
  stub_trim: { applied: boolean; stub: string | null; pad: string | null; from: string | null; to: string | null; note: string } | null;
  ctr: { needed: boolean; tests: number; patched: number; missed: string[]; extra: string[] };
  /** the control-all gate: whether the base has it, and whether this build narrowed it */
  ctr_control_all: { sites: string[] | null; loop_skip: string | null; patched: boolean; ids: [number, number] };
  notes: string[];
  features: { dyn_labels: { bytes: number; free: number; page_sites: number } | null; dsp1_drive: { machines: number; entry: string; laws: string[] } | null;
              host_reorder: { entry: string; bytes: number; old: string; sites: string[] } | null;
              /** --midi-chroma: where its routines are, the channel, and what a chromatic note does on each selected machine */
              midi_chroma?: { at: string; end: string; code_bytes: number; data_bytes: number; channel: string;
                              machines: { id: number; name: string; plays: string }[] } | null;
              desc_flash: string[]; notes: string[] };
  /** layout_table..os_end is the layout table, which every build appends after the boot routine */
  flash: { addon: string | null; boot_routine: string; os_end: string; headroom: number; patches: number; layout_table: string; layout_bytes: number };
  /** the menu categories this build writes after the base's own, each with its machines in order */
  menus: { name: string; machines: string[] }[];
  /** the layout this OS has and carries (with no map: the default one) */
  layout: Layout;
  /** always true: every build embeds its layout (kept for readers of older reports) */
  layout_embedded: boolean;
  /** the layout came from the user's map */
  layout_custom: boolean;
  gates: Gate[];
  sha256?: string;
}

/**
 * A machine-readable description of the built image for external emulator checks: the
 * population, every machine's ID and descriptor address, the LEV stub, the DSP1 drive's layout and
 * linked laws, the fingerprint and recipe, and every word an option patched. Written next to the
 * image with the CLI's --gate-report, it lets a checker verify the output without re-deriving it.
 */
export type GateReport = Record<string, unknown>;

export interface BuildResult { output: Uint8Array; kind: 'flash' | 'syx'; report: BuildReport; gateReport: GateReport }

const segsLabel = (b: Base): string => (b.boot.scatter ? ', add-on and scatter entries' : b.boot.addonFlash !== null ? ' and add-on' : '');

/** Refused before anything is packed: the plan says the selection does not fit. */
export class DoesNotFit extends Error {
  constructor(readonly plan: Plan) { super(plan.problems.join('; ')); }
}

/** Runtime memory fits, but the base's fixed compressed DSP2 upload slot does not. */
export class CompressedCapacityError extends Error {
  constructor(readonly used: number, readonly capacity: number, detail: string) {
    super(`gate dsp2-slot failed: ${detail}`);
    this.name = 'CompressedCapacityError';
  }
}

/** The complete OS, including host code and metadata, exceeds its flash area. */
export class OsAreaCapacityError extends Error {
  constructor(readonly used: number, readonly capacity: number) {
    super(`gate os-area failed: OS area ends at ${h(used)}, limit ${h(capacity)}`);
    this.name = 'OsAreaCapacityError';
  }
}

/** Why a build without the user's own UW answer is refused (the page and the CLI both ask for one). */
export const UW_ANSWER_REQUIRED = 'Answer the UW question before building: does your Machinedrum have the UW option, Yes or No? ' +
  'A layout or project file that records an answer does not stand in for it.';

/** Refused before anything is read: the build was asked for without an explicit UW answer. */
export class UwAnswerRequired extends Error {
  constructor(detail = UW_ANSWER_REQUIRED) { super(detail); this.name = 'UwAnswerRequired'; }
}

/**
 * The user's UW answer, which every build needs: `opt.uw` is true or false. A layout's own `uw`
 * (what a restored file says) never satisfies it, and `noUw` must agree with it.
 */
export function requireUwAnswer(opt: { uw?: unknown; noUw?: boolean }): boolean {
  if (typeof opt.uw !== 'boolean') throw new UwAnswerRequired();
  if (opt.noUw && opt.uw) throw new UwAnswerRequired('Conflicting UW answers: noUw with uw: true. Answer Yes or No once.');
  return opt.uw;
}

/**
 * The CLI's answer: exactly one of --uw and --no-uw. Neither, or both, is refused; a restored
 * layout's answer is only reported, never used in its place.
 */
export function uwFromFlags(flags: { uw?: boolean; noUw?: boolean }): boolean {
  if (flags.uw && flags.noUw) throw new UwAnswerRequired('--uw and --no-uw: choose one.');
  if (!flags.uw && !flags.noUw) {
    throw new UwAnswerRequired('Say whether the Machinedrum has the UW option: pass --uw (it has) or --no-uw (it does not). ' +
      'Nothing is built without it; a restored layout or project does not answer for you.');
  }
  return !!flags.uw;
}

export async function build(input: Uint8Array, base: Base, packs: Pack[], core: CorePack, opt: BuildOptions,
  trimmed?: Trimmed): Promise<BuildResult> {
  requireUwAnswer(opt);
  try { return await buildAttempt(input, base, packs, core, opt, trimmed, false); }
  catch (e) {
    // Preserve existing output whenever it fits. Fixed slots can instead hold the
    // host payload after the NRV end marker, without moving any base tail data.
    if (!(e instanceof OsAreaCapacityError) || base.layout.dsp2Slot !== 'keep-end') throw e;
    return buildAttempt(input, base, packs, core, opt, trimmed, true);
  }
}

async function buildAttempt(input: Uint8Array, base: Base, packs: Pack[], core: CorePack, opt: BuildOptions,
  trimmed: Trimmed | undefined, reclaimTail: boolean): Promise<BuildResult> {
  opt={...opt,features:recoveryFeatures(opt.features)};
  checkPack(core);
  const fw = readFirmware(input);
  const rom = fw.flash;
  const gates: Gate[] = [];
  const gate = (name: string, ok: boolean, detail = '', failure?: Error): void => {
    gates.push({ name, ok, detail });
    if (!ok) throw failure ?? new Error(`gate ${name} failed: ${detail}`);
  };
  const B = base.boot;
  const O = base.os;
  const D = base.dsp2;
  const [cf, d2, d1] = fw.slots;

  // ---- the base's own boot routine, which the build chains onto
  const hasAddon = B.addonOperand !== null && B.addonFlash !== null;
  gate('boot-routine', (!hasAddon || u32(rom, B.addonOperand!) === B.addonFlash) &&
       u32(rom, B.jumpOpcodeAt) >>> 16 === 0x4ef9 && u32(rom, B.jumpOperand) === O.osMain &&
       (B.inCfTail ? cf.at + 8 + cf.length >= B.routine + 0x20 : B.routine >= d1.at + 8 + d1.length && base.layout.dsp2Slot === 'keep-end'),
       `expects ${hasAddon ? `pea $${B.addonFlash!.toString(16)} and ` : ''}jmp $${O.osMain.toString(16)} in the routine at ${h(B.routine)}`);
  const main = cf.raw;
  const segs = base.segments;                    // the add-on first, then any scatter entries
  const addon = hasAddon ? segs[0].bytes : null;
  const keep = base.layout.dsp2Slot === 'keep-end';

  // ---- which machines, on which IDs, where in DSP2, and the RAM image: the plan the page shows
  const pl = plan(fw, base, packs, core, opt, trimmed, true);
  if (!pl.ok) throw new DoesNotFit(pl);
    const { sel, trim } = pl;
    if(sel.some(s=>s.m.contract?.components.dsp2?.source) || (opt.features?.cleanRecovery && base.modelRuntime?.ok)) {
      const runtime=base.modelRuntime;
      const bound=runtime?.sourceSha256===await sha256(fw.flash.subarray(0x4000,OS_LIMIT));
      gate('model-runtime',runtime?.ok===true && bound,
        !runtime?.ok ? runtime?.why ?? 'No verified model runtime for this input' :
          bound ? runtime.why : 'Runtime evidence belongs to a different input; run discovery again');
  }
  const ids = sel.map((s) => s.id);
  // Every machine on its own ID, or the one the user's map gives it, unless moves were allowed:
  // saved kits depend on it.
  const mapped = sel.filter((s) => s.mapped && s.id !== s.preferred);
  // Without UW a machine whose ID is 128 or more must move below 128 (selection.ts allocateIds):
  // that move is the point of the answer, not a liberty taken with a saved kit.
  const noUw = opt.uw === false;                // requireUwAnswer: always the user's answer, never the layout's
  const uwMove = new Set(pl.moves.filter((m) => noUw && m.preferred >= 128 && m.id < 128).map((m) => m.name.trim()));
  gate('machine-ids', sel.every((s) => s.id === s.preferred || s.mapped || uwMove.has(s.m.name.trim())) || !!opt.allowIdMove,
       (pl.moves.length ? `moved (${pl.moves.every((m) => uwMove.has(m.name.trim())) ? 'no IDs of 128 and up without UW' : 'allowed'}): ${pl.moves.map((m) => `${m.name} ${m.preferred}->${m.id}`).join(', ')}`
                        : `${sel.length} machines, each on its preferred ID${mapped.length ? ' or its map ID' : ''}`) +
       (mapped.length ? `; on the map's ID: ${mapped.map((s) => `${s.m.name.trim()} ${s.preferred}->${s.id}`).join(', ')}` : ''));
  // The base's own CTR-range tests, found in its code, against what the profile patches.
  const c = pl.ctr;
  gate('ctr-coverage', !c.needed || (c.missed.length === 0 && c.extra.length === 0),
       `${c.found.size} CTR-range tests in ${base.name}'s code (slot${segsLabel(base)}); ` +
       (c.needed ? `a machine sits on ${base.os.ctrMask.ids.join('..')}: all ${base.os.ctrMask.sites.length} listed sites are patched` : 'no machine on 124..127, none patched') +
       (c.missed.length ? `; not in the profile: ${c.missed.map(h).join(', ')}` : '') +
       (c.extra.length ? `; listed but not a CTR-range test: ${c.extra.map(h).join(', ')}` : ''));
  const regions = pl.dsp2.regions;
  const dspRecords = pl.dsp2.records;

  // ---- DSP2: the trimmed bank in place of the stock one (one record where the base may have had
  //      several back to back), the added records before the entry record
  let w = wordsLE(d2.raw);
  w = [...w.slice(0, trim.bankIndex), 0, D.bankRecord, trim.words.length, ...trim.words, ...w.slice(trim.bankEndIndex)];
  const { entryAt } = records(w);
  const nw: number[] = w.slice(0, entryAt);
  for (const [a, data] of dspRecords) {
    nw.push(0, a, data.length);
    for (const v of data) nw.push(v & 0xffffff);
  }
  for (const v of w.slice(entryAt)) nw.push(v);
  const retired = opt.features?.cleanRecovery ? patchRetirement(nw,base.modelRuntime?.ok===true) : nw;
  // the silence stub's pad, 50 passes -> 1 (default on; --no-stub-trim keeps the base's)
  const stub = opt.stubTrim === false ? null : trimStub(retired);
  const newDsp2 = fromWordsLE(stub ? stub.words : retired);
  let comp = await bestPack(newDsp2);

  // Gate: every added record lies in a freed or free region, or in a dispatch table.
  const owned = (a: number, n: number): boolean =>
    regions.some(([lo, hi]) => a >= lo && a + n <= hi) ||
    Object.values(D.dispatch).some((t) => a > t && a + n <= t + 193);
  gate('dsp2-records', dspRecords.every(([a, d]) => owned(a, d.length)), 'every added DSP2 record is in a freed or free region, or a dispatch entry');
  if (stub?.applied) {
    const sc = checkStubTrim(wordsLE(d2.raw), wordsLE(newDsp2), true);
    gate('stub-trim', sc.ok, sc.detail);
  }

  // Gate: every machine whose pack carries a measured offset mask sits on an offset in it (or, with
  // no room for the pad, on no offset at all and said so in a note), and no machine's code overlaps
  // another's.
  {
    const al = pl.dsp2.machines.filter((m) => m.align);
    const byKey = new Map(sel.map((s) => [s.m.key, s.m]));
    const wrong = al.filter((m) => {
      const e = alignOf(byKey.get(m.key)!, m.words);
      return !e || !inMask(e.offsets, m.org) || m.org % SECTOR !== m.align!.offset;
    });
    const spans = pl.dsp2.machines.map((m) => [m.org, m.org + m.words] as [number, number]).sort((x, y) => x[0] - y[0]);
    const overlap = spans.filter((s, i) => i > 0 && s[0] < spans[i - 1][1]);
    gate('cache-align', wrong.length === 0 && overlap.length === 0,
         (al.length === 0 ? 'no machine on a measured cache offset (alignment off, or no pack carries a mask for this code)'
           : `${al.length} machine${al.length === 1 ? '' : 's'} on a measured cache offset, ` +
             `${pl.dsp2.padding} word${pl.dsp2.padding === 1 ? '' : 's'} of padding: ` +
             al.map((m) => `${m.name.trim()} ${h(m.org)} (+${m.align!.pad}, ${m.align!.sectors[0]}->${m.align!.sectors[1]} sectors)`).join(', '))
         + (wrong.length ? `; wrong offset: ${wrong.map((m) => m.name.trim()).join(', ')}` : '')
         + (overlap.length ? `; overlapping code at ${overlap.map((s) => h(s[0])).join(', ')}` : ''));
  }

  // ---- flash: boot block + ColdFire slot as is, DSP2 new, DSP1 + tag + data + add-on moved
  const sD2 = d2.at;
  const oldAfter = sD2 + 8 + d2.length;
  let img = new Buf().push(rom.subarray(0, sD2));
  const afterD1 = d1.at + 8 + d1.length;
  // DSP1: the base's slot byte for byte, unless the DSP1 drive adds its records (before the entry
  // record). The slot keeps the base's length while the re-packed stream fits in it, and otherwise
  // grows in multiples of 4 from it, so what follows keeps the base's alignment mod 4.
  let newDsp1: Uint8Array | null = null;
  let c1: Uint8Array | null = null;
  // Debug (--dsp1-watchdog): the overrun watchdog's trip count, one immediate in a record the base
  // already has. It rebuilds the slot on its own, with or without the drive.
  const wdN = opt.dsp1Watchdog;
  const baseW1 = wordsLE(d1.raw);
  const wdBase = wdN === undefined ? null : setWatchdog(baseW1, wdN);
  // --dsp1-recover: a replacement DMA0 handler in DSP1's free program RAM, and the vector's target
  // word pointed at it (engine/src/recover.ts). Off by default.
  const rec = opt.features?.dsp1Recover ? recoverRecords(wdHalt(wordsLE(d1.raw)), !!opt.features?.cleanRecovery) : null;
  if (pl.ram.dsp1) {
    const D = base.features.dsp1Drive!;
    const conflicts = drivePlacementProblems(baseW1, pl.ram.dsp1.link, D.hook, D.ret,
      [...(rec ?? []), ...(opt.features?.cleanRecovery ? cleanDsp1Records() : [])]);
    gate('dsp1-drive-layout', conflicts.length === 0, conflicts.length ? conflicts.slice(0, 8).join('; ')
      : `drive in P:${h(D.program[0])}..${h(D.program[1])}; existing base words outside P:${h(D.hook)}..${h(D.ret)} preserved; no overlap with recovery`);
  }
  if (pl.ram.dsp1 || wdN !== undefined || rec) {
    const w1 = wdBase === null ? baseW1 : wdBase.words;
    const { entryAt: e1 } = records(w1);
    const n1: number[] = w1.slice(0, e1);
    if (pl.ram.dsp1) for (const r of pl.ram.dsp1.link.records) n1.push(r.space, r.addr, r.words.length, ...r.words);
    if (rec) for (const r of rec) n1.push(r.space, r.addr, r.words.length, ...r.words);
    if (opt.features?.cleanRecovery) for (const r of cleanDsp1Records()) n1.push(r.space,r.addr,r.words.length,...r.words);
    n1.push(...w1.slice(e1));
    newDsp1 = fromWordsLE(n1);
    if (wdN !== undefined) {
      const wc = checkWatchdog(baseW1, wordsLE(newDsp1), wdN);
      gate('dsp1-watchdog (debug: overruns glitch instead of halting)', wc.ok, wc.detail);
    }
    if (rec) {
      const rc = checkRecover(baseW1, wordsLE(newDsp1), pl.ram.dsp1?.link ?? null, wordsLE(d2.raw), wordsLE(newDsp2), !!opt.features?.cleanRecovery, opt.features?.cleanRecovery?cleanDsp1Sites():[]);
      gate('dsp1-recover', rc.ok, rc.detail);
    }
    if(opt.features?.cleanRecovery) {
      const checked=checkCleanRecovery(wordsLE(newDsp1),wordsLE(newDsp2));
      gate('clean-recovery',checked.ok,checked.detail);
    }
    c1 = await bestPack(newDsp1);
    const len1 = c1.length <= d1.length ? d1.length : d1.length + ((c1.length - d1.length + 3) & ~3);
    c1 = concat([c1, new Uint8Array(len1 - c1.length)]);
  }
  // keep-end: DSP2's slot gives up what DSP1 grew, so the DSP1 slot ends where it did
  const grow = c1 ? c1.length - d1.length : 0;
  const room = d2.length - grow;
  if (keep) {
    const overflow = `the re-packed DSP2 upload is ${comp.length} bytes and this base keeps its slots' end: ${room} bytes left for it` +
      (grow ? ` (DSP1 grew ${grow})` : '') + `, ${comp.length - room} over: trim the E12 samples harder or untick a machine`;
    gate('dsp2-slot', comp.length <= room, comp.length <= room
      ? `re-packed DSP2 upload ${comp.length} bytes in ${room} of the base's ${d2.length}-byte slot (dead tail ${room - comp.length}` +
        (grow ? `; ${grow} bytes to the DSP1 slot, which grew)` : ')')
      : overflow, comp.length > room ? new CompressedCapacityError(comp.length, room, overflow) : undefined);
  }
  const pad = keep ? room - comp.length : (((oldAfter - (sD2 + 8 + comp.length)) % 4) + 4) % 4;   // dead tail, or the base's alignment mod 4
  comp = concat([comp, new Uint8Array(pad)]);
  img.push(be32(comp.length), be32(sum32(comp)), comp);
  if (c1) img.push(be32(c1.length), be32(sum32(c1)), c1);
  else img.push(rom.subarray(oldAfter, afterD1));                   // DSP1 slot, byte for byte
  const delta = img.length - afterD1;
  if (delta % 4) throw new Error('slot shift is not a multiple of 4');
  img.push(rom.subarray(afterD1, fw.osEnd));
  const addonAt = hasAddon ? B.addonFlash! + delta : null;
  if (addonAt !== null) gate('addon-moved', equal(img.slice(addonAt, addonAt + 8), new Uint8Array(8)), `add-on header at ${h(addonAt)}`);
  if (keep) {
    gate('tail-in-place', delta === 0 && equal(img.slice(afterD1, fw.osEnd), rom.subarray(afterD1, fw.osEnd)),
         `tag, data slots${hasAddon ? ', add-on' : ''}${B.scatter ? ', scatter table and entries' : ''}${B.inCfTail ? '' : ', the boot routine'} ` +
         `byte for byte at their flash offsets (${h(afterD1)}..${h(fw.osEnd)})`);
  }

  // ---- the flash block (descriptors and label blocks that live in flash), then the RAM image.
  // Their run-time addresses are the flash alias plus where the block lands, known only now: plan
  // again at that address. The plan's choices depend on sizes alone, so they cannot change.
  const container = img;
  // the layout this build embeds, with the user's UW answer (decodeLayout reads it back)
  const layout = pl.layout ?? { ...defaultLayout(base, pl.menus, (k) => sel.find((s) => s.m.key === k)!.id), uw: opt.uw! };
  const streamEnd = sD2 + 8 + comp.length - pad;
  const payloadAt = (streamEnd + 3) & ~3;
  if (reclaimTail) {
    // Build at its final flash address in a separate buffer, then insert only
    // the payload. The packed stream and every following slot retain their offsets.
    img = new Buf().fill(0, payloadAt);
  }
  img.align(4, 0xff);
  const flashAt = img.length;
  const alias = base.features.descFlash?.alias ?? 0;
  const pr = plan(fw, base, packs, core, opt, trim, false, alias + flashAt);
  if (!pr.ok || pr.ram.bytes !== pl.ram.bytes || pr.features.descFlash.join() !== pl.features.descFlash.join()) {
    throw new Error('the RAM image changed when its flash block got its address');
  }
  const ram = pr.ram;
  img.push(ram.flashBlock);
  const E = base.ext.base;
  const extBytes = ram.image;
  const ext = { length: extBytes.length, bytes: () => extBytes };
  const { descs, family, levStub } = ram;
  const inRange = (r: [number, number]): boolean => ids.some((v) => v >= r[0] && v <= r[1]);
  const lev = O.levBar;
  gate('ext-ram', ext.length % 4 === 0 && E + ext.length <= base.ext.end,
       `RAM image ${ext.length.toLocaleString('en')} of ${(base.ext.end - E).toLocaleString('en')} bytes ` +
       `(${h(E)}..${h(E + ext.length)}, the base's window ends at ${h(base.ext.end)}: ${base.qualification.level === 'hardware-proven' ? 'hardware-proven on this base' : 'free by discovery, not hardware-proven on this base'})` +
       (ram.flashBlock.length ? `; ${pr.features.descFlash.length} descriptors in flash at ${h(alias + flashAt)}` : ''));
  const extSrc = img.length;
  img.push(ext.bytes());
  let segment: [number, number, number] | undefined;
  if (ram.dyn) {
    gate('dyn-segment', ram.dyn.blob.length % 4 === 0 && ram.dyn.blob.length <= ram.dyn.limit,
         `dynamic-label segment ${h(ram.dyn.base)}..${h(ram.dyn.base + ram.dyn.blob.length)} of ${ram.dyn.limit} bytes`);
    const blob = ram.dyn.blob;
    // Use the remaining OS tail for this independently copied segment when it
    // fits together with the layout, leaving more DSP2 padding for the host payload.
    const dynHome = reclaimTail && ((container.length + 3) & ~3) + blob.length + encodeLayout(layout).length <= OS_LIMIT
      ? container : img;
    dynHome.align(4, 0xff);
    segment = [dynHome.length, ram.dyn.base, blob.length / 4];
    dynHome.push(blob);
  }

  // ---- the patch list, and what each site must hold before it
  const patches: [number, number][] = [[O.heap.site, E]];
  const checks: [number, number][] = [[O.heap.site, O.heap.old]];
  if (ram.menuRefresh) {
    const {site,entry}=ram.menuRefresh;
    patches.push(...menuRefreshPatches(site,entry));
    checks.push([site.patch,u32(site.original,0)],[site.patch+4,u32(site.original,4)]);
  }
  if (inRange(O.highDefaults.ids)) {
    patches.push([O.highDefaults.site, O.highDefaults.new]);
    checks.push([O.highDefaults.site, O.highDefaults.old]);
  }
  if (inRange(O.ctrMask.ids)) {
    for (const s of O.ctrMask.sites) { patches.push([s, O.ctrMask.new]); checks.push([s, O.ctrMask.old]); }
    patches.push([O.ctrMask.defaultsLow.site, O.ctrMask.defaultsLow.new]);
    checks.push([O.ctrMask.defaultsLow.site, O.ctrMask.defaultsLow.old]);
  }
  // FUNC + knob (control all) on 124..127: one mask byte, $f0 -> $f4, which excludes 0x7c..0x7f and
  // 0x74..0x77 and leaves 0x70..0x73 and the four stock control machines 0x78..0x7b as they were.
  // Applied only with the option, and only when a machine is on 124..127.
  const caFix = !!opt.ctrControlAll && inRange(O.ctrMask.ids)
    && O.ctrControlAll !== null && O.ctrLoopSkip !== null;
  if (caFix) {
    for (const s of O.ctrControlAll!.sites) {
      patches.push([s, O.ctrControlAll!.new]);
      checks.push([s, O.ctrControlAll!.old]);
    }
    const L = O.ctrLoopSkip!;
    if (L.site % 4 || L.old.length % 4 || L.old.length !== L.new.length) throw new Error('the loop skip is not whole longwords');
    for (let i = 0; i < L.new.length; i += 4) {
      patches.push([L.site + i, u32(L.new, i)]);
      checks.push([L.site + i, u32(L.old, i)]);
    }
  }
  if (levStub !== null) {
    patches.push(...levBarJmp(lev.ctr.jmpSites, levStub));
    lev.ctr.jmpSites.forEach((s, i) => checks.push([s, lev.ctr.old[i]]));
  } else if (inRange(lev.low.ids)) {
    patches.push([lev.low.site, lev.low.new]);
    checks.push([lev.low.site, lev.low.old]);
  }
  if (inRange(lev.high.ids)) {
    patches.push([lev.high.site, lev.high.new]);
    checks.push([lev.high.site, lev.high.old]);
  }
  const pv = O.preview;
  if (pv && pv.ids.some(inRange)) {                    // the machine-select preview's ID test, whole
    if (pv.old.length !== pv.new.length || pv.old.length % 4 || pv.site % 4) throw new Error('preview fix is not whole longwords');
    for (let i = 0; i < pv.new.length; i += 4) {
      patches.push([pv.site + i, u32(pv.new, i)]);
      checks.push([pv.site + i, u32(pv.old, i)]);
    }
  }
  for (const [s, a] of descs) patches.push([O.descriptorTable + 4 * s.id, a]);
  for (const v of ids) checks.push([O.descriptorTable + 4 * v, O.freeDescriptor]);
  let pageSites: number[] = [];
  if (ram.dyn) {
    // The knob-turn refresh enters the added value trampoline (which ends in what it ran before:
    // the base's stub target, or the stock routine whose calls these were), and every call of the
    // 1.63 page draw, in the OS and in the base's own RAM code, enters the added page routine.
    const R = base.features.dynLabels!.redraw;
    pageSites = base.features.dynLabels!.pageSites;
    patches.push(...R.sites.map((s) => [s, ram.dyn!.values] as [number, number]), ...pageSites.map((s) => [s, ram.dyn!.page] as [number, number]));
    checks.push(...R.sites.map((s) => [s, R.old] as [number, number]), ...pageSites.map((s) => [s, O.pageDraw] as [number, number]));
  }
  for (const s of O.familyBaseSites) { patches.push([s, family]); checks.push([s, O.familyTable]); }
  for (const s of O.familyListSites) { patches.push([s, family + 4]); checks.push([s, O.familyTable + 4]); }
  // a Machinedrum without UW hides ROM and RAM, not two of our categories (engine/src/uw_menu.ts)
  // Without the fix a non-UW unit shows the wrong categories (1.63, DEV), or opens the machine menu
  // on the wrong one and, on X.13, hangs at boot. A build for a Machinedrum without UW must have
  // it; a build for a UW unit still builds without it and says so.
  let uwWhy: string;
  let uwOk = true;
  if (!O.uwMenu || !ram.uwMenu) {
    uwWhy = !O.uwMenu ? `not found (${base.support.uwMenu?.why ?? 'not discovered'})` : "the base's table has no ROM and RAM records to remove";
    uwOk = !noUw;
    if (noUw) uwWhy += ': a Machinedrum without UW would show the wrong categories';
  } else {
    try {
      const u = uwMenuPatches(O.uwMenu, ram.uwMenu.entry);
      patches.push(...u.patches); checks.push(...u.checks);
      uwWhy = `without UW, ${h(ram.uwMenu.entry)} removes ROM and RAM from the family table before ${O.uwMenu.kind === 'count' ? 'the count' : "the add-on's family routine"} ` +
        `(${h(O.uwMenu.entry)}, entered from ${O.uwMenu.callers.map((c) => h(c - 2)).join(', ')}); the base's own non-UW step at ${h(O.uwMenu.branch)} is skipped`;
    } catch (e) { uwOk = false; uwWhy = (e as Error).message; }
  }
  gate('uw-menu', uwOk, uwWhy);
  if (ram.dsp1) {
    const F = base.features.dsp1Drive!;
    for (const s of F.senderSites) { patches.push([s, ram.dsp1.entry]); checks.push([s, F.sender]); }
  }
  // the host-command sender reorder: every reference to the base's DSP2 entry names the reordered copy
  if (ram.hostSend) {
    for (const s of ram.hostSend.sites) { patches.push([s, ram.hostSend.entry]); checks.push([s, ram.hostSend.old]); }
  }
  // --cpu-indicator: the LCD flush's `move.l <prev>,d5` becomes `jsr <stub>`, six bytes for six
  const cfOrig = (a: number): number => u32(fw.slots[0].raw, a - base.os.cfBase);
  let indPatches: [number, number][] = [];
  if (ram.indicator) {
    const hp = hookPatches(ram.indicator.site, ram.indicator.stub, cfOrig);
    indPatches = hp.patches;
    patches.push(...hp.patches);
    checks.push(...hp.checks);
  }
  // --midi-chroma: the parser's range test rewritten, three calls retargeted; no other write may touch them
  let chromaWrites: [number, number][] = [];
  if (ram.chroma) {
    const cp = chromaPatches(ram.chroma.site, ram.chroma.code.labels);
    const ranges = chromaRanges(ram.chroma.site);
    const clash = patches.filter(([s]) => ranges.some(([lo, hi]) => s + 4 > lo && s < hi));
    gate('midi-chroma-sites', clash.length === 0, clash.length ? `other patches write ${clash.map(([s]) => h(s)).join(', ')}, inside the hook sites`
      : `${cp.patches.length} longwords at ${ranges.map(([lo, hi]) => `${h(lo)}..${h(hi)}`).join(', ')}, written by nothing else`);
    chromaWrites = cp.patches;
    patches.push(...cp.patches);
    checks.push(...cp.checks);
  }
  // Each site is read where the base's boot puts it: the ColdFire slot (below the BSS its reset
  // code clears), the SRAM copy, the add-on, a scatter entry.
  const live = codeImages(fw, base);
  const holder = (site: number): [Uint8Array, number] | null => {
    for (const s of live) if (site >= s.ram && site + 4 <= s.ram + s.bytes.length) return [s.bytes, s.ram];
    return null;
  };
  const bad = checks.filter(([site, old]) => {
    const at = holder(site);
    return !at || u32(at[0], site - at[1]) !== old;
  });
  gate('patch-sites', bad.length === 0, bad.length ? `unexpected words at ${bad.map(([s]) => h(s)).join(', ')}` :
       `${checks.length} sites hold what this base's profile says`);
  const patchSrc = img.length;
  assertBootRamWrites(patches, base.boot.sram);
  for (const [a, v] of patches) img.push(be32(a), be32(v));
  const routine = img.length;
  img.push(bootRoutine(extSrc, E, ext.length / 4, patchSrc, patches.length, O.osMain, segment));
  const payloadEnd = img.length;
  if (reclaimTail) {
    const slotEnd = sD2 + 8 + comp.length;
    gate('dsp2-tail-capacity', payloadEnd <= slotEnd,
      `host payload ends at ${h(payloadEnd)}, DSP2 slot ends at ${h(slotEnd)}`,
      new CompressedCapacityError(payloadEnd - sD2 - 8, room,
        `DSP2 upload plus host payload needs ${payloadEnd - sD2 - 8} bytes in its ${room}-byte slot: trim the E12 samples harder or untick a machine`));
    container.set(payloadAt, img.slice(payloadAt, payloadEnd));
    container.set(sD2 + 4, be32(sum32(container.slice(sD2 + 8, slotEnd))));
    img = container;
  }
  // the layout, as a table after the routine: inert data in flash, read back by findLayout when
  // this OS is patched again. Every build carries one (the user's map merged with every placement,
  // or with no map the default: pack families, pack order, preferred IDs), so any OS this engine
  // patched can be restored. Nothing reads it at run time.
  const layoutAt = appendLayout(img, layout);
  const osEnd = img.length;
  gate('os-area', osEnd <= OS_LIMIT, `OS area ends at ${h(osEnd)}, limit ${h(OS_LIMIT)}`,
    new OsAreaCapacityError(osEnd, OS_LIMIT));
  img.fill(0xff, OS_LIMIT - osEnd);
  img.push(rom.subarray(OS_LIMIT));
  if (addonAt !== null) img.set(B.addonOperand!, be32(addonAt));
  img.set(B.jumpOperand, be32(routine));
  const image = img.bytes();
  if (image.length !== rom.length) throw new Error('image length changed');

  // ---- read the result back the way the unit will
  const back = parseFlash(image, fw.kind);
  if (reclaimTail) {
    const slot = back.slots[1];
    gate('dsp2-tail-payload', slot.sumOk && slot.at === sD2 && slot.length === comp.length &&
      slot.at + 8 + slot.used <= payloadAt && payloadEnd <= slot.at + 8 + slot.length &&
      equal(image.subarray(sD2 + 8, streamEnd), comp.subarray(0, comp.length - pad)) &&
      equal(image.subarray(flashAt, flashAt + ram.flashBlock.length), ram.flashBlock) &&
      equal(image.subarray(extSrc, extSrc + ext.length), ext.bytes()) &&
      (!segment || equal(image.subarray(segment[0], segment[0] + segment[2] * 4),
        ram.dyn!.blob)),
      `host payload ${h(payloadAt)}..${h(payloadEnd)} lies after the decoded DSP2 stream; checksum, descriptors and boot-copy sources read back unchanged`);
  }
  {
    const got = findLayout(back);
    gate('layout-table', !!got && got.at === layoutAt && canonical(got.layout) === canonical(layout),
         `the ${pl.layout ? "user's" : 'default'} layout table at ${h(layoutAt)} (${osEnd - layoutAt} bytes, ${layout.categories.length} categories, ` +
         `${Object.keys(layout.machines).length} machines) reads back as built`);
  }
  // scatter entries: the table in place and every entry unpacking to what it did
  const tableOk = !B.scatter || Array.from({ length: B.scatter.count }, (_, k) =>
    u32(image, B.scatter!.table + 8 * k) === segs[k + 1].flash && u32(image, B.scatter!.table + 8 * k + 4) === segs[k + 1].ram &&
    equal(nrv2bDecode(image.subarray(segs[k + 1].flash + 8, OS_LIMIT)).out, segs[k + 1].bytes)).every(Boolean);
  gate('readback', equal(back.slots[0].raw, main) && equal(back.slots[1].raw, newDsp2) && equal(back.slots[2].raw, newDsp1 ?? d1.raw) &&
       back.slots[1].length === comp.length && (addonAt === null || equal(nrv2bDecode(image.subarray(addonAt + 8, OS_LIMIT)).out, addon!)) &&
       tableOk && u32(image, B.jumpOperand) === routine,
       `ColdFire${newDsp1 ? '' : ', DSP1'}${addon ? ' and the add-on' : ''}${B.scatter ? ' and scatter entries' : ''} unpack unchanged; ` +
       `DSP2${newDsp1 ? ' and DSP1 unpack' : ' unpacks'} to the new upload; the base's routine enters the added one`);

  // ---- the P-I clean stub: every stock P-I init enters it, it jumps to the
  //      base's own init, and it clears exactly the declared span
  if (pl.piClean) {
    const P = D.pi!;
    const pc = checkPiClean(dsp2Mem(back.slots[1].raw), dsp2Mem(d2.raw), D.dispatch, P, pl.piClean.span,
                            [pl.piClean.org, pl.piClean.org + pl.piClean.words], pl.piClean.marks);
    gate('pi-clean', pc.ok, `${pl.piClean.machines.join(', ')}: ${pc.detail}`);
  }

  // ---- the ColdFire host-command sender reorder: the copy sends word 1, the count and word 2,
  //      writes CVR, then runs the stock data loop
  if (ram.hostSend) {
    const H = base.features.hostSend!;
    const code = ext.bytes().subarray(ram.hostSend.entry - E, ram.hostSend.entry - E + ram.hostSend.bytes);
    const why: string[] = hostSendCheck(code);
    // the base's own body at the entry discovery found, byte for byte
    const at = live.find((i) => H.entry >= i.ram && H.entry + HOST_SEND_STOCK.length / 2 <= i.ram + i.bytes.length);
    const stock = at ? Array.from(at.bytes.subarray(H.entry - at.ram, H.entry - at.ram + HOST_SEND_STOCK.length / 2),
                                 (b) => b.toString(16).padStart(2, '0')).join('') : '';
    if (stock !== HOST_SEND_STOCK) why.push(`the base's sender at ${h(H.entry)} is not the stock routine`);
    // only the intended sites: every reference to the stock entry in the base's live code is in the
    // site list, each is patched exactly once, and nothing else in the patch list writes the new entry
    const refs = operands(live, (v) => v === H.entry);
    const want = new Set(ram.hostSend.sites);
    const missed = refs.filter((o) => !want.has(o.at)).map((o) => o.at);
    if (missed.length) why.push(`references to ${h(H.entry)} the build does not repoint at ${missed.map(h).join(', ')}`);
    const mine = patches.filter(([, v]) => v === ram.hostSend!.entry).map(([a]) => a);
    if (mine.length !== ram.hostSend.sites.length || !mine.every((a) => want.has(a))) {
      why.push(`${mine.length} patch-list entries name the reordered sender, for ${ram.hostSend.sites.length} sites`);
    }
    if (ram.hostSend.entry % 4) why.push(`the reordered sender is at ${h(ram.hostSend.entry)}, not 4-aligned`);
    if (ram.hostSend.entry < E || ram.hostSend.entry + ram.hostSend.bytes > E + ram.bytes) why.push('the reordered sender is outside the RAM image');
    // ColdFire ISA_A, decoded straight through (the isa gate walks it as well, from the retargeted sites)
    const insns = decodeLinear(code, ram.hostSend.entry);
    for (const i of insns.filter((i) => !i.ok)) why.push(`${h(i.at)} ${i.name}: ${i.why}`);
    gate('host-reorder', why.length === 0, why.length ? why.join('; ') :
      `${ram.hostSend.bytes} bytes at ${h(ram.hostSend.entry)}, ${insns.length} ISA_A instructions: word 1, count, word 2, CVR = $89, ` +
      `then stock's data loop; the base's ${HOST_SEND_STOCK.length / 2}-byte sender at ${h(H.entry)} is stock and stays; ` +
      `${ram.hostSend.sites.length} of ${refs.length} references repointed (${ram.hostSend.sites.map(h).join(', ')}); ` +
      `DSP1's entry ${h(H.dsp1Entry)} and every DSP2 word untouched`);
  }

  // --cpu-indicator asked for and not built is never silent (the plan refuses it first, by name)
  if (opt.features?.cpuIndicator && !ram.indicator) gate('cpu-indicator', false, 'asked for, and the plan built no stub');
  // --cpu-indicator: the stub read back out of the segment the image really carries, the one
  // operand it is reached from, and the routine it jmps back to
  if (ram.indicator) {
    const I = ram.indicator;
    const inSeg = I.home === 'ext' ? ram.image.subarray(I.at - ram.base, I.at - ram.base + I.code.length)
      : ram.dyn!.blob.subarray(I.at - ram.dyn!.base, I.at - ram.dyn!.base + I.code.length);
    const ic = checkIndicator(inSeg, I.site, I.at, I.stub, indPatches, cfOrig);
    const insns = decodeLinear(I.code.subarray(0, I.stub.codeBytes), I.at);
    const bad = insns.filter((i) => !i.ok).map((i) => `${h(i.at)} ${i.name}: ${i.why}`);
    gate('cpu-indicator', ic.ok && bad.length === 0,
         ic.ok && bad.length === 0
           ? `${ic.detail}; ${insns.length} instructions, all ISA_A`
           : [ic.ok ? '' : ic.detail, ...bad].filter(Boolean).join('; '));
  }

  // ---- control-all on 124..127: asked for, found, and the site held what it must
  if (opt.ctrControlAll) {
    gate('ctr-controlall', !inRange(O.ctrMask.ids) || (O.ctrControlAll !== null && O.ctrLoopSkip !== null),
         !inRange(O.ctrMask.ids) ? 'no machine on 124..127: nothing to narrow'
           : O.ctrControlAll === null || O.ctrLoopSkip === null
             ? `${base.name}: control-all gates ${O.ctrControlAll ? 'found' : 'not found'}, per-track skip ${O.ctrLoopSkip ? 'found' : 'not found'}`
           : `masks at ${O.ctrControlAll.sites.map(h).join(', ')} narrowed ${h(O.ctrControlAll.old)} -> ${h(O.ctrControlAll.new)} and the ` +
             `per-track skip at ${h(O.ctrLoopSkip.site)} (${O.ctrLoopSkip.old.length} bytes) rewritten as (id - 0x60) <=u 0x1b: ` +
             'FUNC + knob reaches 124..127; 0x60..0x6f, 0x70..0x73 and the four stock control machines 0x78..0x7b unchanged');
  }

  // ---- --midi-chroma: the routines as the image carries them, and the writes that enter them
  if (ram.chroma) {
    const C = ram.chroma;
    const inImage = image.subarray(extSrc + (C.at - E), extSrc + (C.at - E) + C.code.bytes.length);
    const cc = checkChromaCode(inImage, C.code.codeLen, C.at, C.site);
    const listed = readBootRamWrites(image, routine, base.boot.sram);
    const entered = chromaWrites.every(([a, v]) => listed.some(([b, w]) => a === b && v === w));
    gate('midi-chroma', equal(inImage, C.code.bytes) && cc.ok && entered && C.at + C.code.bytes.length <= E + IND_EXT_SPAN,
      !cc.ok ? cc.detail : !entered ? 'the patch list does not carry every hook write'
        : C.at + C.code.bytes.length > E + IND_EXT_SPAN ? `the routines end at ${h(C.at + C.code.bytes.length)}, past the proven ${h(E + IND_EXT_SPAN)}`
        : `${C.code.codeLen} bytes of routines (${cc.insns.length} ISA_A instructions, calls only to the OS routines they name) and ` +
          `${C.code.bytes.length - C.code.codeLen} bytes of data at ${h(C.at)}..${h(C.at + C.code.bytes.length)}, channel ${C.channel}; ` +
          `${C.table.entries.length} of ${sel.length} machines play notes, the others are triggered`);
  }

  // ---- every added instruction, and every one a patched word lands in, is ColdFire ISA_A
  const isa = isaGate(fw, base, back);
  gate('isa', isa.ok, isa.detail + (isa.rejects.length ? `; ${isa.rejects.slice(0, 3).map((i) => `${h(i.at)} ${i.name}: ${i.why}`).join('; ')}` : ''));

  const report: BuildReport = {
    model_runtime:base.modelRuntime,
    base: base.id,
    qualification: base.qualification,
    support: base.support,
    layout_kind: base.layout.dsp2Slot,
    machines: pl.dsp2.machines.map((m) => ({ key: m.key, name: m.name, id: m.id, preferred: m.preferred, family: m.family,
                                              org: h(m.org), words: m.words, ...(m.align ? { align: m.align } : {}) })),
    e12: { threshold_db: opt.trim.db, min_seconds: opt.trim.minSeconds, cap: opt.trim.cap, bank_end: h(trim.end),
           freed_words: D.bankEnd - trim.end, samples: trim.report.filter((r) => r.kept < r.seconds),
           ...(trim.edits ? { edits: { swapped: [...trim.edits.swaps.keys()].sort((a, b) => a - b), capped: trim.capped,
             no_trim: [...trim.edits.noTrim].sort((a, b) => a - b),
             padded: trim.report.filter((r) => r.padded_for !== undefined).map((r) => ({ entry: r.entry, for: r.padded_for! })) } } : {}) },
    dsp2: { packed: comp.length - (keep ? pad : 0), base_packed: d2.length, packed_capacity: keep ? room - (reclaimTail ? payloadEnd - streamEnd : 0) : null, raw: newDsp2.length, regions: regions.map(([a, b]) => [h(a), h(b)]),
            machine_words: pl.dsp2.capacity - pl.dsp2.free, free_words: pl.dsp2.free,
            align_padding: pl.dsp2.padding, aligned: pl.dsp2.machines.filter((m) => m.align).length },
    ext: { base: h(E), bytes: ram.bytes, limit: base.ext.end - E, free: base.ext.end - E - ram.bytes, lev_stub: levStub === null ? null : h(levStub) },
    id_moves: pl.moves.map((m) => ({ name: m.name, preferred: m.preferred, id: m.id, why: m.why })),
    needs: sel.flatMap((s) => needLines(s.m)),
    pi_clean: pl.piClean ? { org: h(pl.piClean.org), words: pl.piClean.words, span: [h(pl.piClean.span.offset), pl.piClean.span.words],
                             ids: pl.piClean.ids, machines: pl.piClean.machines } : null,
    stub_trim: stub === null ? null : { applied: stub.applied, stub: stub.stub ? h(stub.stub.at) : null, pad: stub.stub ? h(stub.stub.pad) : null,
                                        from: stub.stub ? h(stub.stub.word) : null, to: stub.applied ? h(stub.to) : null, note: stub.note },
    ctr_control_all: { sites: O.ctrControlAll ? O.ctrControlAll.sites.map(h) : null,
                       loop_skip: O.ctrLoopSkip ? h(O.ctrLoopSkip.site) : null, patched: caFix, ids: O.ctrMask.ids },
    ctr: { needed: c.needed, tests: c.found.size, patched: c.needed ? O.ctrMask.sites.length : 0,
           missed: c.missed.map(h), extra: c.extra.map(h) },
    notes: [...pl.notes, ...(stub && !stub.applied ? [stub.note] : [])],
    features: {
      dyn_labels: ram.dyn ? { bytes: ram.dyn.blob.length, free: ram.dyn.limit - ram.dyn.blob.length, page_sites: pageSites.length } : null,
      dsp1_drive: ram.dsp1 ? { machines: ram.dsp1.pairs.length, entry: h(ram.dsp1.entry), laws: ram.dsp1.link.laws } : null,
      host_reorder: ram.hostSend ? { entry: h(ram.hostSend.entry), bytes: ram.hostSend.bytes, old: h(ram.hostSend.old), sites: ram.hostSend.sites.map(h) } : null,
      ...(ram.chroma ? { midi_chroma: { at: h(ram.chroma.at), end: h(ram.chroma.at + ram.chroma.code.bytes.length), code_bytes: ram.chroma.code.codeLen,
        data_bytes: ram.chroma.code.bytes.length - ram.chroma.code.codeLen, channel: ram.chroma.channel,
        machines: ram.chroma.table.perModel.map((p) => ({ id: p.id, name: p.name, plays: p.kind })) } } : {}),
      desc_flash: pr.features.descFlash, notes: pr.features.notes,
    },
    flash: { addon: addonAt === null ? null : h(addonAt), boot_routine: h(routine), os_end: h(osEnd), headroom: OS_LIMIT - osEnd, patches: patches.length,
             layout_table: h(layoutAt), layout_bytes: osEnd - layoutAt },
    layout,
    layout_embedded: true,
    layout_custom: !!pl.layout,
    menus: pl.menus.map((f) => ({ name: f.name, machines: f.models.filter((m) => sel.some((s) => s.m.key === m.key)).map((m) => m.name.trim()) })),
    gates,
  };
  const output = fw.kind === 'flash' ? image : encodeSyx(containerOf(image));
  const names = sel.map((s) => s.m.name.trim());
  const idSpace = opt.features?.dsp1IdSpace ?? 0xc0;
  const gateReport: GateReport = {
    format: 'kitbasher gate report',
    workspace: pl.workspace ? { base: h(D.workspace.base) } : null,
    pi_slices: D.pi && sel.some((s) => s.m.workspace_kind === 'pi')
      ? { base: h(D.pi.ws), slice: D.pi.slice, machines: sel.filter((s) => s.m.workspace_kind === 'pi').map((s) => s.m.name.trim()) } : null,
    pi_clean: pl.piClean ? { stub: h(pl.piClean.org), words: pl.piClean.words, offset: h(pl.piClean.span.offset), span: pl.piClean.span.words,
                             ids: pl.piClean.ids, machines: pl.piClean.machines } : null,
    overlay: null,
    df: { ids: Object.fromEntries(sel.map((s) => [s.m.key, s.id])), ext_ram: h(E), ext_bytes: ext.length, lev_stub: levStub === null ? null : h(levStub) },
    descriptors: Object.fromEntries(descs.map(([s, a]) => [s.m.name.trim(), h(a)])),
    population: { machines: names, count: names.length, excluded: {} },
    dsp1: ram.dsp1 ? { id_space: idSpace, cf_code: idSpace + core.dsp1.cache_bytes, transport: h(ram.dsp1.entry),
                       drive: Object.fromEntries(ram.dsp1.pairs.map(([id, v]) => [String(id), v])), laws: ram.dsp1.link.laws }
                   : { drive: {}, laws: [] },
    dyn_labels: ram.dyn ? { base: h(ram.dyn.base), end: h(ram.dyn.base + ram.dyn.blob.length), bytes: ram.dyn.blob.length } : null,
    fingerprint: { overlay: false, dynamic: !!ram.dyn, probe: false, flash_high: '0x0', tick_tail_jmp: null, loader_bytes: null },
    recipe: {
      ...(pr.features.descFlash.length ? { MD_DESC_FLASH: pr.features.descFlash.join(',') } : {}),
      ...(ram.dsp1 ? { MD_DSP1_ID_SPACE: h(idSpace), MD_DSP1_NO_COUNTER: '1' } : {}),
      ...(opt.features?.dynFlash?.length ? { MD_DYN_FLASH: opt.features.dynFlash.join(',') } : {}),
    },
    args: { trim_db: opt.trim.db, trim_min: opt.trim.minSeconds, trim_cap: opt.trim.cap, dsp1_drive: [], no_overlay: true,
            no_dyn_labels: !ram.dyn, clock_fix: false, host_reorder: !!ram.hostSend,
            ...(wdN === undefined ? {} : { dsp1_watchdog: wdN }),
            ...(rec === null ? {} : { dsp1_recover: true }),
            ...(ram.indicator === null ? {} : { cpu_indicator: true }),
            ...(opt.ctrControlAll ? { ctr_control_all: true } : {}),
            ...(ram.chroma ? { midi_chroma: ram.chroma.channel } : {}) },
    // present only with --host-reorder: the reordered DSP2 host-command sender, so a checker can
    // allow those patched words and verify the routine itself
    ...(ram.hostSend === null ? {} : { host_reorder: { entry: h(ram.hostSend.entry), bytes: ram.hostSend.bytes, old: h(ram.hostSend.old),
                                                       dsp1_entry: h(base.features.hostSend!.dsp1Entry), sites: ram.hostSend.sites.map(h) } }),
    // debug, present only with --dsp1-watchdog: the one DSP1 word this build rewrote, so a checker
    // can allow it and verify it
    ...(wdN === undefined ? {} : { dsp1_watchdog: { count: wdN, base_count: wdBase!.wd.count, p: h(wdBase!.wd.countAt),
                                                    handler: h(wdBase!.wd.at), words: wdBase!.wd.words,
                                                    from: h(wdBase!.from), to: h(wdBase!.to) } }),
    // present only with --dsp1-recover: the DSP1 records this option adds, so a checker can allow
    // them and verify them
    ...(rec === null ? {} : { dsp1_recover: { handler: h(REC.handlerAt(!!opt.features?.cleanRecovery)), words: REC.handlerWords(!!opt.features?.cleanRecovery),
                                              window: [h(0xa08), h(REC.P_FREE_END)],
                                              vector: h(REC.VECTOR), scratch: h(REC.SCRATCH),
                                              base_handler: h(findWatchdog(baseW1).at),
                                              trip: REC.RECOVER_COUNT, base_trip: REC.BASE_COUNT,
                                              feed: [h(REC.FEED), h(REC.FEED + REC.FEED_WORDS)] } }),
    // present only with --cpu-indicator: the one site it patches and what it draws, so a checker can
    // classify that patched word and verify the stub
    ...(ram.indicator === null ? {} : { cpu_indicator: {
      stub: h(ram.indicator.at), bytes: ram.indicator.code.length, site: h(ram.indicator.site.site), home: ram.indicator.home,
      patches: indPatches.map(([a, v]) => [h(a), h(v)]), prev: h(ram.indicator.site.prev), next: h(ram.indicator.site.next),
      flush: h(ram.indicator.site.flush), swap: h(ram.indicator.site.swap),
      poll: h(ram.indicator.stub.poll), draw: h(ram.indicator.stub.draw), code_bytes: ram.indicator.stub.codeBytes,
      chk: h(ram.indicator.stub.chk), chk_entries: checkTable().length, put: h(ram.indicator.stub.put), put_entries: putTable().length,
      put_box: [PUT.x0, PUT.y0, PUT.x1, PUT.y1],
      timer_operand: h(ram.indicator.site.timerOperand), timer_handler: h(ram.indicator.site.timerHandler),
      timer_install: h(ram.indicator.site.timerInstall),
      trap_operand: ram.indicator.site.trapOperand === null ? null : h(ram.indicator.site.trapOperand),
      isr: h(DSP1_ISR), hold_flushes: HOLD, cue: [CUE.x0, CUE.y0, CUE.x1, CUE.y1] } }),
    // present only with --midi-chroma: its routines and every word it patched, so a checker can
    // allow those words and verify the routines
    ...(ram.chroma === null ? {} : { midi_chroma: { at: h(ram.chroma.at), bytes: ram.chroma.code.bytes.length, code_bytes: ram.chroma.code.codeLen,
      channel: ram.chroma.channel, cfg: h(ram.chroma.cfg), labels: Object.fromEntries(Object.entries(ram.chroma.code.labels).map(([k, v]) => [k, h(v)])),
      patches: chromaWrites.map(([a, v]) => [h(a), h(v)]), table: ram.chroma.table.perModel } }),
    // present when the silence stub was trimmed: the one changed DSP2 word, so a checker that
    // compares the upload against the base can allow that word and verify the stub separately
    ...(stub?.applied ? { stub_trim: { stub: h(stub.stub.at), pad: h(stub.stub.pad), from: h(stub.from), to: h(stub.to) } } : {}),
    ...(opt.features?.cleanRecovery?{clean_recovery:{version:1,threshold:64,diagnostics:false,modelCodeUnchanged:true}}:{}),
    flash: { addon: addonAt === null ? null : h(addonAt), os_end: h(osEnd), headroom: OS_LIMIT - osEnd },
  };
  return { output, kind: fw.kind, report, gateReport };
}
