import { menuCategory, menuOrder } from './sound_catalog.js';
import { select, allocateIds, resolveLayout, type Family, type Selected, type IdMove, type ModelFilter } from './selection.js';
export { merged, select, allocateIds, keyAliases, resolveKey, resolveLayout } from './selection.js';
export type { Family, Selected, IdMove, MergedFamily } from './selection.js';
// Planning a build without packing it: which machines, on which IDs, where each lands in DSP2,
// and how big the RAM image is. `build` runs exactly this and then packs, so what the page shows as
// room left is what the build will find. Everything here is cheap except the E12 trim, which the
// page computes once per trim setting (`trimFor`) and hands back in.

import { be32, Buf, fromBase64, h, wordsLE } from './bytes.js';
import type { Base } from './bases.js';
import { hostSendReorder, levBarStub } from './coldfire.js';
import { menuRefreshSite, menuRefreshCode, type MenuRefreshSite } from './menu_refresh.js';
import { hiddenIndex, recordName, uwMenuCode } from './uw_menu.js';
import {MODEL_SYMBOLS} from './model_runtime.js';
import type { Firmware } from './container.js';
import { records } from './dsp.js';
import { trimBank, type TrimEntry, type TrimOptions } from './e12.js';
import { applySwaps, bankRun, type SampleEdits } from './samples.js';
import { codeImages } from './bases.js';
import { handlerAt } from './recover.js';
import { findSite, stub, type Parts, type Site, type Stub } from './indicator.js';
import { callCode, drivePairs, dsp1Transport, dynSegment, linkDrive, type DriveLink, type Dsp1Law, type DynMachine } from './features.js';
import {recoveryFeatures,cleanBaseProblems,reserveRecovery} from './clean_recovery.js';
import { unmuteBlock, type UnmuteBlock } from './unmute.js';
import { assemble as chromaAssemble, buildTable as chromaTable, channelByte, type ChromaCode, type Chroma, type ChromaTable } from './midi_chroma.js';
import { assemble as labelAssemble, buildLabelTable, type LabelCode, type LabelTable, type PitchLabelSite } from './pitch_labels.js';
import { linkCode, words, type CorePack, type Pack, type PackModel, type PackNeed, type PackTable } from './packs.js';
import { ctrCoverage, type CtrCoverage } from './scan.js';
import { baseFamilies, checkLayout, listedFreeIds, LAYOUT_FORMAT, menuLimits, type Layout } from './layout.js';
import { PI_CLEAN_MODE, piCleanProgram, piSpanOf, piStubWords, type PiSpan } from './pi_clean.js';
import { alignOf, alignUp, SECTOR } from './align.js';
import { tablePool } from './table_pool.js';

/**
 * The model-facing features, each on by default where the base profile says it is supported.
 *   descFlash    where descriptors live: 'auto' moves just enough of them (machines without
 *                dynamic labels, the ones hardware has already run from flash first) into OS-area
 *                flash for the RAM image to fit; 'all' / 'none' / a list of machine names
 *                (recorded in the gate report's recipe as MD_DESC_FLASH).
 *   dynFlash     machines whose dynamic-label blocks go to flash (MD_DYN_FLASH); needs descFlash.
 *   dsp1IdSpace  the DSP1 transport's ID table size (MD_DSP1_ID_SPACE), default 0xc0.
 *   dsp1Recover  DSP1's overrun watchdog mutes and recovers instead of halting.
 *   hostReorder  the ColdFire-side host-command sender reorder (engine/src/coldfire.ts
 *                hostSendReorder): a reordered copy of the OS's DSP2 two-word sender in the RAM
 *                image, with every reference to the stock entry repointed at it.
 */
export interface Features {
  /** Clean subsequent triggers after overload; may cut existing voices/tails. */
  cleanRecovery?: boolean;
  dynLabels?: boolean;
  dsp1Drive?: boolean;
  hostReorder?: boolean;
  descFlash?: 'auto' | 'all' | 'none' | string[];
  dynFlash?: string[];
  dsp1IdSpace?: number;
  /**
   * DSP1's DMA0 overrun watchdog recovers instead of halting (engine/src/recover.ts). Off by
   * default: it is a safety net, not a stock behaviour. It takes the top of the same free DSP1
   * program window the drive links its laws into, so the drive's limit drops by its size.
   */
  dsp1Recover?: boolean;
  /**
   * With dsp1Recover: while DSP1 keeps reporting overruns the transport icons are replaced by an
   * inverted "CPU!" box (a corner block on other screens), held ~0.5 s after the last one
   * (engine/src/indicator.ts). Off by default.
   */
  cpuIndicator?: boolean;
  /**
   * An unmuted track plays its next trig instead of about two steps later (engine/src/unmute.ts):
   * five sequencer instructions call routines of ours in the label segment's RAM range. On by
   * default on the bases whose profile qualifies it; false leaves the base's sequencer as it is.
   */
  unmuteFix?: boolean;
  /**
   * MIDI chromatic note input (engine/src/midi_chroma.ts): a note on the chromatic channel plays
   * the selected track at the note's pitch, using the selected models' pitch metadata. `true` uses
   * the default channel, base+4; `{ channel }` names another ('base+4'..'base+15', 'ch:1'..'ch:16').
   * Off by default: a build without it is byte-identical to one from before the option existed.
   */
  midiChroma?: boolean | { channel: string };
  /**
   * Pitch note names (engine/src/pitch_labels.ts): the pitch knob of a model with a quarter or
   * chromatic pitch law shows its note (C-3, C#3, C+3) under the dial instead of a number, as DEV
   * shows a TONAL track's pitch. Off by default: a build without it is byte-identical to one from
   * before the option existed.
   */
  pitchLabels?: boolean;
}

/** The default chromatic channel: the first one above the four base channels (channel 5 with base channel 1). */
export const MIDI_CHROMA_CHANNEL = 'base+4';

export interface Selection extends ModelFilter {
  features?: Features;
  /**
   * Saved kits name machines by ID, so a machine whose preferred ID is taken on the base is an
   * error. With this set it takes the next free ID up instead, and the move is reported.
   */
  allowIdMove?: boolean;
  /**
   * The user's layout (engine/src/layout.ts): IDs and menu categories. A machine on its map ID is
   * where the user put it, not moved; machines the map does not name keep their preferred ID and
   * go to their default menu category (`menus`). Absent: every machine in its default category.
   */
  layout?: Layout;
  /**
   * The Machinedrum has no UW option (or the layout says so): no machine on IDs 128 and up (a
   * pinned one moves below 128 and the move is reported), and no model that plays a UW sample
   * (engine/src/selection.ts allocateIds).
   */
  noUw?: boolean;
  /** the user's answer to "does your Machinedrum have the UW option?" (false = noUw); recorded in the layout */
  uw?: boolean;
  /**
   * Default menu categories: 'sound' (the default) files each machine under its browsing
   * category's menu code (engine/src/sound_catalog.ts: KIK, SNR, ... in browsing order);
   * 'family' uses the pack families in pack order (the layout the parity tests compare against).
   */
  menus?: 'sound' | 'family';
  /**
   * Place each machine's code at the origin its measured instruction-cache offset asks for
   * (engine/src/align.ts), padding up to 127 words for an aligned machine and filling that padding
   * with the tables placed after it. On by default; `false` is the plain first-fit placement, which
   * the parity tests compare against.
   */
  align?: boolean;
  /** --dsp1-watchdog (debug; build.ts BuildOptions): here only so the plan can refuse it with --dsp1-recover */
  dsp1Watchdog?: number;
  /** --ctr-control-all (build.ts BuildOptions): here so the plan can refuse it on a base without its sites */
  ctrControlAll?: boolean;
  /**
   * The user's E12 samples (engine/src/samples.ts): swapped entries, and entries the trim leaves
   * whole. Absent or empty: the stock bank, and every output byte-identical to a build without it.
   */
  samples?: SampleEdits;
}

// Which descriptors 'auto' moves to flash first is the packs' `flash_rank` (the ones hardware has
// already run from flash): no machine name lives in the engine.

export interface Trimmed {
  opt: TrimOptions;
  bankIndex: number;               // the bank record's tag word in the DSP2 upload
  bankEndIndex: number;            // one past the last word of the record(s) holding the bank
  bankRecords: number;             // how many records held it (stock 1.63: 62, X.14: 1)
  words: number[];                 // the re-laid bank
  end: number;                     // where the bank now ends
  report: TrimEntry[];
  /** the sample edits this bank was laid with (null: stock), and swaps cut to their stock length */
  edits: SampleEdits | null;
  capped: number[];
}

export interface Placement {
  key: string; name: string; family: string; id: number; preferred: number;
  org: number; words: number;      // code words (tables are listed separately)
  total: number;                   // code + the machine's own tables
  /** the cache offset this origin was aligned to, and the words skipped to reach it */
  align?: { offset: number; pad: number; sectors: [number, number] };
}


export interface Plan {
  ok: boolean;
  problems: string[];              // why it does not fit, in words a user can act on
  fams: Family[];
  menus: Family[];                 // the added menu categories, in menu order (the pack families without a map)
  layout: Layout | null;           // the layout this build has (the map merged with every placement), with a map only
  sel: Selected[];
  moves: IdMove[];                 // machines not on their preferred ID (only with allowIdMove)
  needs: { name: string; needs: PackNeed[] }[];   // selected machines that read data the firmware does not carry
  ctr: CtrCoverage & { needed: boolean };        // the base's CTR-range tests against its profile
  notes: string[];                 // worth saying, not wrong
  trim: Trimmed;
  workspace: boolean;
  /**
   * The P-I clean stub (engine/src/pi_clean.ts): placed only when a selected machine declares
   * pi_clean; every stock P-I init word then enters it. null otherwise.
   */
  piClean: { org: number; words: number; span: PiSpan; ids: number[]; machines: string[]; marks: [number, number][] } | null;
  dsp2: {
    fits: boolean;                // code placement and E12/workspace fit, independent of other validation
    regions: [number, number][];
    capacity: number;              // words in all regions
    demand: number;                // words the selection needs (shared tables included)
    free: number;                  // left after placing, 0 if it does not fit
    /** words spent on cache alignment that nothing else took: capacity - demand - free */
    padding: number;
    records: [number, number[]][]; // (address, words), in upload order; empty unless linked and ok
    machines: Placement[];
  };
  ram: RamImage;
  features: { dynLabels: boolean; dsp1Drive: boolean; hostReorder: boolean; unmuteFix: boolean; descFlash: string[]; notes: string[] };
}

export interface RamImage {
  base: number; bytes: number; limit: number; image: Uint8Array; descs: [Selected, number][];
  family: number; levStub: number | null;
  menuRefresh: {site: MenuRefreshSite; entry: number; code: Uint8Array} | null;
  /** the non-UW menu routine (engine/src/uw_menu.ts), on a base that counts its families at init */
  uwMenu: { entry: number; code: Uint8Array } | null;
  flashBlock: Uint8Array;          // descriptors (then label blocks) that live in OS-area flash
  dyn: { blob: Uint8Array; base: number; limit: number; update: number; values: number; page: number } | null;
  dsp1: { entry: number; pairs: [number, number][]; link: DriveLink } | null;
  hostSend: { entry: number; sites: number[]; old: number; bytes: number } | null;
  /** --cpu-indicator: the stub at the end of the dynamic-label segment, and the LCD flush site it is reached from */
  indicator: { at: number; code: Uint8Array; site: Site; parts: Parts; stub: Stub; home: 'dyn' | 'ext' } | null;
  /**
   * The unmute-latency routines (engine/src/unmute.ts), in the label segment's RAM range: after the
   * labels (and the indicator) when there is a label segment, else as that range's only content
   * (`segment`, copied by the boot routine in the label segment's place).
   */
  unmute: { block: UnmuteBlock; home: 'dyn' | 'own'; segment: Uint8Array | null; base: number; limit: number } | null;
  /** --midi-chroma: the routines and their note table, at the end of the RAM image */
  chroma: { at: number; code: ChromaCode; table: ChromaTable; site: Chroma; channel: string; cfg: number } | null;
  /** --pitch-labels: the routine and its table, at the end of the RAM image (after --midi-chroma's) */
  pitchLabels: { at: number; code: LabelCode; table: LabelTable; site: PitchLabelSite } | null;
}

/**
 * Whether the host-command sender reorder is on when nothing asks either way. It changes the
 * ColdFire side of a path that runs under every machine and every kit, and its benefit on hardware
 * is small (the measurable part costs about 0.05 c/s/track), so it is opt-in with
 * --host-reorder.
 */
export const HOST_REORDER_DEFAULT = false;

/** The feature switches as this base can honour them, and why any is off. */
export function resolveFeatures(base: Base, f: Features = {}): { dyn: boolean; dsp1: boolean; host: boolean; unmute: boolean; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const want = (on: boolean | undefined, have: boolean, what: string, key?: keyof Base['support']): boolean => {
    if (on === false) return false;
    if (!have) {
      const why = key && base.support?.[key] && !base.support[key].ok ? `: ${base.support[key].why}` : ' yet';
      (on === true ? problems : notes).push(`${what}: not supported on ${base.name}${why}`);
      return false;
    }
    return true;
  };
  return {
    dyn: want(f.dynLabels, !!base.features.dynLabels, 'dynamic knob labels', 'dynLabels'),
    dsp1: want(f.dsp1Drive, !!base.features.dsp1Drive, 'the DSP1 drive', 'dsp1Drive'),
    host: want(f.hostReorder === undefined ? (HOST_REORDER_DEFAULT ? undefined : false) : f.hostReorder, !!base.features.hostSend, 'the host-command sender reorder (--host-reorder)', 'hostSend'),
    unmute: want(f.unmuteFix, !!base.features.unmute && !!base.features.dynLabels, 'the unmute-latency fix (--unmute-fix)', 'unmuteFix'),
    problems, notes,
  };
}

const DESC_LABELS = 10;
const DESC_DEFAULTS = 42;
const DESC_TYPES = 50;

// The CTR-range scan of a base's code, once per firmware (the page plans on every click).
const ctrCache = new WeakMap<Uint8Array, CtrCoverage>();
export function baseCtrCoverage(fw: Firmware, base: Base): CtrCoverage {
  let c = ctrCache.get(fw.slots[0].raw);
  if (!c) {
    c = ctrCoverage(codeImages(fw, base).map((i) => [i.bytes, i.ram] as [Uint8Array, number]), base.os.ctrMask.sites);
    ctrCache.set(fw.slots[0].raw, c);
  }
  return c;
}

/**
 * The E12 bank re-laid for these trim options: the one expensive step, done once per setting.
 * The bank is one P record in X.14 and 62 back-to-back ones in stock 1.63 (code, table, each
 * sample and its silent pad). A run of records that follow each other in the upload and in P
 * memory loads what one record over the same words loads, so the run is re-recorded as one
 * (X.14's own upload is 1.63's re-recorded this way). Nothing else in the upload may write there.
 */
export function trimFor(fw: Firmware, base: Base, opt: TrimOptions, samples?: SampleEdits): Trimmed {
  const D = base.dsp2;
  const run = bankRun(fw, base);
  const edited = !!samples && (samples.swaps.size > 0 || samples.noTrim.size > 0);
  let bank = run.bank, bankEnd = D.bankEnd, capped: number[] = [], changed: number[] = [];
  if (samples && samples.swaps.size) {
    const s = swappedBank(fw, base, run.bank, samples);
    bank = s.words; bankEnd = s.end; capped = s.capped; changed = s.changed;
  }
  // only samples that differ from the stock ones are the user's: a swap equal to stock is stock
  const t = trimBank(bank, D.bankRecord, D.e12Table, D.e12Count, bankEnd, opt, samples?.noTrim, new Set(changed));
  // a copy of the edits, so the report says exactly what was laid even if the caller's change later
  const edits = edited ? { swaps: new Map(samples!.swaps), noTrim: new Set(samples!.noTrim) } : null;
  return { opt, bankIndex: run.bankIndex, bankEndIndex: run.bankEndIndex, bankRecords: run.bankRecords,
           words: t.words, end: t.end, report: t.report, edits, capped };
}

// The swapped bank, laid once per edits object and firmware: the page's auto trim calls trimFor for
// up to ~40 thresholds with the same edits. Callers pass a fresh SampleEdits object whenever the
// edits change (the page snapshots them per revision); one changed in place is not seen here.
const swapCache = new WeakMap<SampleEdits, WeakMap<Uint8Array, ReturnType<typeof applySwaps>>>();
function swappedBank(fw: Firmware, base: Base, bank: number[], samples: SampleEdits): ReturnType<typeof applySwaps> {
  const D = base.dsp2;
  let byFw = swapCache.get(samples);
  if (!byFw) { byFw = new WeakMap(); swapCache.set(samples, byFw); }
  let s = byFw.get(fw.slots[1].raw);
  if (!s) { s = applySwaps(bank, D.bankRecord, D.e12Table, D.e12Count, D.bankEnd, samples.swaps); byFw.set(fw.slots[1].raw, s); }
  return s;
}

/**
 * The RAM image: knob callback (with the 6-byte label call slot when dynamic labels are on),
 * descriptors, one
 * menu list per family, the family table; plus the flash block (descriptors moved to flash, then
 * label blocks moved there) at run-time address `flashAt`, the dynamic-label segment, the DSP1
 * transport and the LEV stub.
 */
/** The main RAM image's hardware-proven span from its base (0x2bc000..0x2bce14): the indicator's fallback home stays inside it. */
export const IND_EXT_SPAN = 0xe14;

export function ramImage(base: Base, main: Uint8Array, core: CorePack, fams: Family[], sel: Selected[],
  opt: { dyn: boolean; dsp1: DriveLink | null; host: boolean; toFlash: Set<string>; dynFlash: Set<string>; idSpace: number; flashAt: number;
         redrawValues: number; ind: Site | null; chroma?: { site: Chroma; channel: string; cfg: number } | null; unmute?: boolean;
         labels?: PitchLabelSite | null }): RamImage {
  const O = base.os;
  const E = base.ext.base;
  let cb = fromBase64(core.knob_callback);
  const ret = [0x70, 0x09, 0x4e, 0x75];                              // moveq #9,d0 ; rts
  if (Array.from(cb.slice(-4)).join() !== ret.join()) throw new Error('knob callback does not end in moveq #9,d0 / rts');
  const callAt = cb.length - 4;
  // A static-only selection has no dynSegment to fill a call slot. Leaving six zero bytes
  // here executes ori.b on a ColdFire (the ISA_A gate correctly rejects it).
  const hasDynamicLabels = opt.dyn && sel.some((s) => s.m.dyn_labels.length > 0);
  if (hasDynamicLabels) cb = Uint8Array.from([...cb.slice(0, callAt), ...new Uint8Array(core.dyn.call_size), ...ret]);
  const ext = new Buf().push(cb);
  const fimg = new Buf();
  const descs: [Selected, number][] = [];
  for (const s of sel) {
    const toFlash = opt.toFlash.has(s.m.name.trim());
    let addr: number;
    if (toFlash) {
      addr = opt.flashAt + fimg.length;
    } else {
      ext.align(2, 0);
      addr = E + ext.length;
    }
    const d = new Uint8Array(O.descriptorSize);
    d.set(be32(E), 0);
    d[4] = s.id;
    for (let i = 0; i < 5; i++) d[5 + i] = s.m.name.charCodeAt(i);
    s.m.labels.forEach((lbl, i) => {
      if (lbl) for (let k = 0; k < 4; k++) d[DESC_LABELS + 4 * i + k] = k < lbl.length ? lbl.charCodeAt(k) : 0x20;
    });
    d.set(Uint8Array.from(s.m.defaults), DESC_DEFAULTS);
    const types = s.m.labels.map((l) => (l ? 1 : 0));
    for (let i = 0; i < 4; i++) d[DESC_TYPES + i] = (types[2 * i] << 4) | types[2 * i + 1];
    if (toFlash) fimg.push(d).align(4, 0);   // every flash descriptor 4-aligned, so its +0 long read is aligned
    else ext.push(d);
    descs.push([s, addr]);
  }
  ext.align(4, 0);
  const lists: number[] = [];
  const at = new Map(descs.map(([s, a]) => [s.m.key, a]));
  for (const f of fams) {
    lists.push(E + ext.length);
    for (const m of f.models) if (at.has(m.key)) ext.push(be32(at.get(m.key)!));
    ext.push(new Uint8Array(4));
  }
  const family = E + ext.length;
  const fo = O.familyTable - O.cfBase;
  let nf = 0;
  while (main[fo + 8 * nf]) nf++;
  ext.push(main.subarray(fo, fo + 8 * nf));                       // the base's families
  fams.forEach((f, i) => {
    const name = new Uint8Array(4);
    for (let k = 0; k < f.name.length; k++) name[k] = f.name.charCodeAt(k);
    ext.push(name, be32(lists[i]));
  });
  ext.push(new Uint8Array(8));
  ext.align(4, 0);
  // on a unit without UW the base hides ROM and RAM: a routine of ours removes those two records
  // from our copy before the base counts the families (engine/src/uw_menu.ts)
  let uwMenu: RamImage['uwMenu'] = null;
  const names = Array.from({ length: nf }, (_, k) => String.fromCharCode(...Array.from(main.subarray(fo + 8 * k, fo + 8 * k + 4)).filter((c) => c)));
  const hidden = O.uwMenu ? hiddenIndex(O.uwMenu, names) : null;
  if (O.uwMenu && hidden !== null) {
    const entry = E + ext.length;
    const code = uwMenuCode(O.uwMenu, family + 8 * hidden, recordName(main, O.cfBase, O.familyTable, hidden));
    ext.push(code).align(4, 0);
    uwMenu = { entry, code };
  }
  let dyn: RamImage['dyn'] = null;
  if (opt.dyn) {
    const seg = base.features.dynLabels!.segment;
    fimg.align(4, 0);
    const dm: DynMachine[] = descs.map(([s, a]) => ({ m: s.m, id: s.id, desc: a, blocksToFlash: opt.dynFlash.has(s.m.name.trim()) }));
    const g = dynSegment(core.dyn, dm, seg[0], opt.redrawValues, O.pageDraw, opt.dynFlash.size ? opt.flashAt + fimg.length : null);
    if (g) {
      fimg.push(g.flashBlocks);
      ext.set(callAt, callCode(g.update));
      dyn = { blob: g.blob, base: seg[0], limit: seg[1] - seg[0], update: g.update, values: g.values, page: g.page };
    }
  }
  // --cpu-indicator: the stub rides at the end of the dynamic-label segment, in the same
  // hardware-proven RAM range and copied by the same loop in the boot routine
  let indicator: RamImage['indicator'] = null;
  if (opt.ind && dyn) {
    const b = new Buf().push(dyn.blob);
    b.align(4, 0);
    const at = dyn.base + b.length;
    const parts: Parts = { at, site: opt.ind };
    const st = stub(parts);
    b.push(st.bytes);
    b.align(4, 0);
    dyn = { ...dyn, blob: b.bytes() };
    indicator = { at, code: st.bytes, site: opt.ind, parts, stub: st, home: 'dyn' };
  } else if (opt.ind) {
    // no dynamic-label segment (a selection with no machine that declares labels): the stub goes in
    // the main RAM image instead, the same boot copy, inside its hardware-proven range (IND_EXT_SPAN)
    ext.align(4, 0);
    const at = E + ext.length;
    const parts: Parts = { at, site: opt.ind };
    const st = stub(parts);
    ext.push(st.bytes);
    ext.align(4, 0);
    indicator = { at, code: st.bytes, site: opt.ind, parts, stub: st, home: 'ext' };
  }
  // the unmute-latency routines: in the label segment's RAM range, after whatever the segment holds
  let unmute: RamImage['unmute'] = null;
  if (opt.unmute) {
    const seg = base.features.dynLabels!.segment;
    const b = new Buf().push(dyn ? dyn.blob : new Uint8Array(0));
    b.align(4, 0);
    const block = unmuteBlock(base.features.unmute!, seg[0] + b.length);
    b.push(block.bytes);
    if (dyn) dyn = { ...dyn, blob: b.bytes() };
    unmute = { block, home: dyn ? 'dyn' : 'own', segment: dyn ? null : b.bytes(), base: seg[0], limit: seg[1] - seg[0] };
  }
  fimg.align(4, 0);
  let dsp1: RamImage['dsp1'] = null;
  const pairs = opt.dsp1 ? drivePairs(opt.dsp1.selector, sel) : [];
  if (opt.dsp1 && pairs.length && pairs.every(([id]) => id < opt.idSpace)) {
    const t = dsp1Transport(core.dsp1, E + ext.length, opt.idSpace, pairs);
    ext.push(t.blob);
    dsp1 = { entry: t.entry, pairs, link: opt.dsp1 };
  }
  // the reordered host-command sender: 4-aligned, so the boot routine's longword copy covers it
  let hostSend: RamImage['hostSend'] = null;
  if (opt.host) {
    const H = base.features.hostSend!;
    ext.align(4, 0);
    const entry = E + ext.length;
    ext.push(hostSendReorder());
    hostSend = { entry, sites: H.sites, old: H.entry, bytes: hostSendReorder().length };
  }
  const ids = sel.map((s) => s.id);
  const inRange = (r: [number, number]): boolean => ids.some((v) => v >= r[0] && v <= r[1]);
  const lev = O.levBar;
  let levStub: number | null = null;
  if (inRange(lev.ctr.ids)) {
    ext.align(4, 0);
    levStub = E + ext.length;
    ext.push(levBarStub(inRange(lev.low.ids) ? 0x5f : 0x5e, lev.ctr.draw, lev.ctr.resume));
  }
  const menuSite=menuRefreshSite(base,main);
  let menuRefresh: RamImage['menuRefresh']=null;
  if (menuSite) {
    ext.align(4,0);
    menuRefresh={site:menuSite,entry:E+ext.length,code:menuRefreshCode(menuSite)};
    ext.push(menuRefresh.code).align(4,0);
  }
  // --midi-chroma: last in the image, so the rest of it is laid out exactly as without it
  let chroma: RamImage['chroma'] = null;
  if (opt.chroma) {
    ext.align(4, 0);
    const at = E + ext.length;
    const table = chromaTable(sel.map((s) => ({ id: s.id, name: s.m.name.trim(), pitch: s.m.pitch, dyn_labels: s.m.dyn_labels })));
    const code = chromaAssemble(at, opt.chroma.site, table, opt.chroma.cfg);
    ext.push(code.bytes).align(4, 0);
    chroma = { at, code, table, ...opt.chroma };
  }
  // --pitch-labels: after everything else, so the rest of the image is laid out exactly as without it.
  // A selection with no labelled pitch knob builds no routine (and no hook).
  let pitchLabels: RamImage['pitchLabels'] = null;
  if (opt.labels) {
    const table = buildLabelTable(sel.map((s) => ({ id: s.id, name: s.m.name.trim(), pitch: s.m.pitch, dyn_labels: s.m.dyn_labels })), !!dyn);
    if (table.entries.length) {
      ext.align(4, 0);
      const at = E + ext.length;
      const code = labelAssemble(at, opt.labels, table);
      ext.push(code.bytes).align(4, 0);
      pitchLabels = { at, code, table, site: opt.labels };
    }
  }
  return { base: E, bytes: ext.length, limit: base.ext.end - E, image: ext.bytes(), descs, family, levStub, menuRefresh, uwMenu,
           flashBlock: fimg.bytes(), dyn, dsp1, hostSend, indicator, unmute, chroma, pitchLabels };
}

/**
 * Features resolved, descriptors assigned to RAM or flash, the RAM image built. With descFlash
 * 'auto' the eligible descriptors (no dynamic labels: `update` writes into a descriptor) move to
 * flash one at a time, hardware-proven names first, until the RAM image fits.
 */
/** Every DSP1 law the core pack and the packs carry, by name (the same law twice must be the same bytes). */
export function driveLaws(core: CorePack, packs: Pack[]): Map<string, Dsp1Law> {
  const out = new Map<string, Dsp1Law>();
  for (const l of [...core.dsp1.laws, ...packs.flatMap((p) => p.dsp1_laws ?? [])]) {
    const had = out.get(l.name);
    if (had && JSON.stringify(had) !== JSON.stringify(l)) throw new Error(`DSP1 law ${l.name} is in two packs with different contents`);
    out.set(l.name, l);
  }
  return out;
}

function placeRam(base: Base, main: Uint8Array, core: CorePack, laws: Map<string, Dsp1Law>, fams: Family[], sel: Selected[], f: Features, flashAt: number):
  { ram: RamImage; feats: { dyn: boolean; dsp1: boolean; host: boolean; unmute: boolean; descFlash: string[]; problems: string[]; notes: string[] } } {
  const r = resolveFeatures(base, f);
  const problems = [...r.problems];
  const notes = [...r.notes];
  let redrawValues = 0;
  let dyn = r.dyn;
  // Dynamic labels with no selected machine that declares any: nothing to label, and the knob
  // callback's call slot would stay an empty hole (ori.b #0 -- not ISA_A, and nothing to call).
  // Off, as if the base had none; the base's page draw and refresh keep their own calls.
  if (dyn && !sel.some((s) => s.m.dyn_labels.length)) {
    dyn = false;
    if (f.dynLabels === true) notes.push('dynamic labels: no selected machine declares any, so none are built');
  }
  if (dyn) redrawValues = base.features.dynLabels!.redraw.values;   // what the knob-turn refresh ran: the added trampoline ends there
  if (!r.dsp1) {
    const lose = sel.filter((s) => s.m.dsp1_drive).map((s) => s.m.name.trim());
    if (lose.length) notes.push(`without the DSP1 drive, DIST uses the stock curve on ${lose.join(', ')}`);
  }
  if (!dyn) {
    const lose = sel.filter((s) => s.m.dyn_labels.length).map((s) => s.m.name.trim());
    if (lose.length) notes.push(`without dynamic labels, knob names stay fixed on ${lose.join(', ')}`);
  }
  const idSpace = f.dsp1IdSpace ?? 0xc0;
  const names = sel.map((s) => s.m.name.trim());
  const eligible = sel.filter((s) => !(dyn && s.m.dyn_labels.length)).map((s) => s.m.name.trim());
  const mode = f.descFlash ?? 'auto';
  const canFlash = !!base.features.descFlash;
  let toFlash = new Set<string>();
  if (mode !== 'none' && mode !== 'auto') {
    if (!canFlash) problems.push(`descriptors in flash: not supported on ${base.name}`);
    toFlash = new Set(mode === 'all' ? eligible : mode.filter((n) => names.includes(n)));
    for (const n of toFlash) if (!eligible.includes(n)) problems.push(`${n} declares dynamic labels, so its descriptor must stay in RAM`);
  }
  const dynFlash = new Set((f.dynFlash ?? []).filter((n) => names.includes(n)));
  if (dynFlash.size && !canFlash) problems.push(`label blocks in flash: not supported on ${base.name}`);
  // the drive laws the selected machines ask for, and only those, linked here
  let drive: DriveLink | null = null;
  const wanted = r.dsp1 ? [...new Set(sel.map((s) => s.m.dsp1_drive).filter((x): x is string => !!x))] : [];
  if (wanted.length) {
    try { drive = linkDrive(core.dsp1, laws, wanted, f.dsp1Recover ? handlerAt(!!f.cleanRecovery) : undefined,
      base.features.dsp1Drive!.program); }
    catch (e) { problems.push(`the DSP1 drive: ${(e as Error).message}`); }
  }
  // --cpu-indicator: the site, from the base's own ColdFire code (engine/src/indicator.ts)
  let ind: Site | null = null;
  if (f.cpuIndicator) {
    if (!f.dsp1Recover) problems.push('--cpu-indicator needs --dsp1-recover: the flag it reads is the one DSP1 raises');
    else if (!base.features.lcdFlush) problems.push(`--cpu-indicator: not supported on ${base.name}: ${base.support.cpuIndicator?.why ?? 'the LCD flush was not found'}`);
    else ind = base.features.lcdFlush;
  }
  // --midi-chroma: the base's real-time MIDI path, verified by discovery (engine/src/midi_chroma.ts)
  let chroma: { site: Chroma; channel: string; cfg: number } | null = null;
  if (f.midiChroma) {
    const channel = typeof f.midiChroma === 'object' ? f.midiChroma.channel : MIDI_CHROMA_CHANNEL;
    if (!base.features.midiChroma) problems.push(`MIDI chromatic note input: not supported on ${base.name}: ${base.support.midiChroma?.why ?? 'its MIDI path was not found'}`);
    else {
      try { chroma = { site: base.features.midiChroma, channel, cfg: channelByte(channel) }; }
      catch (e) { problems.push((e as Error).message); }
    }
  }
  // --pitch-labels: the knob-value painter's string draw, verified by discovery (engine/src/pitch_labels.ts)
  let labels: PitchLabelSite | null = null;
  if (f.pitchLabels) {
    if (!base.features.pitchLabels) problems.push(`pitch note names: not supported on ${base.name}: ${base.support.pitchLabels?.why ?? 'the knob-value painter was not found'}`);
    else labels = base.features.pitchLabels;
  }
  // --dsp1-recover: the base's DSP1/DSP2 code the handler is written against, word for word
  if (f.dsp1Recover && base.support.dsp1Recover && !base.support.dsp1Recover.ok) {
    problems.push(`--dsp1-recover: not supported on ${base.name}: ${base.support.dsp1Recover.why}`);
  }
  const make = (): RamImage => ramImage(base, main, core, fams, sel,
    { dyn, dsp1: drive, host: r.host, toFlash, dynFlash, idSpace, flashAt, redrawValues, ind, chroma, unmute: r.unmute, labels });
  // --midi-chroma's and --pitch-labels' routines sit at the end of the RAM image, which then has to
  // stay inside the span earlier images ran from on hardware (IND_EXT_SPAN), not just the base's window
  const pastProven = (x: RamImage): boolean => (!!x.chroma || !!x.pitchLabels) && x.bytes > IND_EXT_SPAN;
  const tooBig = (x: RamImage): boolean => x.bytes > x.limit || pastProven(x);
  let ram = make();
  if (labels && !ram.pitchLabels) notes.push('pitch note names: no selected machine has a pitch knob with a note law, so none are built');
  // the unmute fix is on by default, so a selection whose labels leave no room for it builds without
  // it (said so); asked for explicitly, the overflow is a problem below
  const over = (x: RamImage): boolean => !!x.unmute && (x.unmute.segment ?? x.dyn!.blob).length > x.unmute.limit;
  if (r.unmute && f.unmuteFix === undefined && over(ram)) {
    r.unmute = false;
    notes.push('the unmute-latency fix: no room left after the knob labels in their RAM range, so it is not built');
    ram = make();
  }
  if (mode === 'auto' && canFlash && tooBig(ram)) {
    const rank = new Map(sel.map((s) => [s.m.name.trim(), s.m.flash_rank ?? null]));
    const ranked = eligible.filter((n) => rank.get(n) != null).sort((a, b) => rank.get(a)! - rank.get(b)!);
    const order = [...ranked, ...eligible.filter((n) => rank.get(n) == null)];
    for (const n of order) {
      if (!tooBig(ram)) break;
      toFlash.add(n);
      ram = make();
    }
    if (toFlash.size) notes.push(`descriptors in flash (auto, for the RAM image to fit its ${ram.chroma || ram.pitchLabels ? Math.min(ram.limit, IND_EXT_SPAN) : ram.limit}-byte window): ${[...toFlash].join(', ')}`);
  }
  const outside = drive ? drivePairs(drive.selector, sel).filter(([id]) => id >= idSpace) : [];
  if (outside.length) problems.push(`machine IDs ${outside.map(([id]) => id).join(', ')} are outside the DSP1 ID table (0..${idSpace - 1})`);
  if (ram.indicator?.home === 'ext' && ram.indicator.at + ram.indicator.code.length > ram.base + IND_EXT_SPAN) {
    problems.push(`--cpu-indicator: with no dynamic-label segment its stub goes in the RAM image, and ends at ` +
                  `${(ram.indicator.at + ram.indicator.code.length).toString(16)}, past the proven ${(ram.base + IND_EXT_SPAN).toString(16)}`);
  }
  if (pastProven(ram) && ram.bytes <= ram.limit) {
    const over = ram.bytes - IND_EXT_SPAN;
    const both = !!ram.chroma && !!ram.pitchLabels;
    const what = both ? 'MIDI chromatic note input and pitch note names' : ram.chroma ? 'MIDI chromatic note input' : 'pitch note names';
    const off = both ? 'turn MIDI chromatic note input or pitch note names off' : `turn ${what} off`;
    const bytes = (ram.chroma?.code.bytes.length ?? 0) + (ram.pitchLabels?.code.bytes.length ?? 0);
    const fix = mode === 'auto' && canFlash
      ? `untick a machine (one with dynamic knob labels frees the most) or ${off}`
      : canFlash ? `let descriptors move to flash (descriptors in flash: auto${mode === 'none' ? ', not none' : ''}), untick a machine, or ${off}`
      : `untick a machine or ${off}`;
    problems.push(`${what} need${both ? '' : 's'} ${over} more byte${over === 1 ? '' : 's'} of RAM: ${both ? 'their' : 'its'} ${bytes}-byte routines ` +
                  `go at the end of the RAM image, which then ends at ${(ram.base + ram.bytes).toString(16)}, past the hardware-proven ` +
                  `${(ram.base + IND_EXT_SPAN).toString(16)}${mode === 'auto' && canFlash && toFlash.size ? `, even with ${toFlash.size} descriptors moved to flash` : ''}: ${fix}`);
  }
  if (ram.bytes > ram.limit) {
    problems.push(`the RAM image needs ${ram.bytes} bytes and the base's proven window holds ${ram.limit}: ` +
                  `${ram.bytes - ram.limit} bytes too many` + (canFlash ? ' even with descriptors in flash' : ''));
  }
  if (ram.dyn && ram.dyn.blob.length > ram.dyn.limit) {
    const um = ram.unmute?.home === 'dyn' ? ram.unmute.block.bytes.length : 0;
    problems.push(um
      ? `the knob labels (${ram.dyn.blob.length - um} bytes) and the unmute-latency fix (${um} bytes) need ${ram.dyn.blob.length} bytes ` +
        `and their RAM range holds ${ram.dyn.limit}: turn the unmute-latency fix off (--no-unmute-fix) or untick a machine with dynamic knob labels`
      : `the dynamic-label segment needs ${ram.dyn.blob.length} bytes and its RAM range holds ${ram.dyn.limit}`);
  }
  if (ram.unmute?.segment && ram.unmute.segment.length > ram.unmute.limit) {
    problems.push(`the unmute-latency fix needs ${ram.unmute.segment.length} bytes and the label RAM range holds ${ram.unmute.limit}`);
  }
  return { ram, feats: { dyn, dsp1: r.dsp1, host: r.host, unmute: r.unmute, descFlash: [...toFlash], problems, notes } };
}

/**
 * Plan a build. `link` = false only sizes things (the page asks this for every checkbox); `true`
 * also links every machine's code, which is what `build` uses.
 */
export function plan(fw: Firmware, base: Base, packs: Pack[], core: CorePack, opt: Selection & { trim: TrimOptions },
  trimmed?: Trimmed, link = false, flashAt?: number): Plan {
  opt={...opt,features:recoveryFeatures(opt.features)};
  const D = base.dsp2;
  const main = fw.slots[0].raw;
  const { fams, shared, aliases } = select(packs, opt);
  const problems: string[] = [];
  // a map saved before a model was renamed names it by its former key
  const lay = opt.layout && resolveLayout(opt.layout, aliases);
  const noUw = !!opt.noUw || opt.uw === false || (opt.uw === undefined && lay?.uw === false);
  const { sel, moves, problems: idProblems, reused } = allocateIds(base, main, fams, !!opt.allowIdMove, lay, listedFreeIds(fw, base),
    // bottom-up in menu order (the sound categories by default), so a selection always gets the same IDs
    { noUw, rank: opt.menus === 'family' ? undefined : (m) => menuOrder(menuCategory(m)) });
  problems.push(...idProblems);
  const byFamily = opt.menus === 'family';
  const menus = lay ? menusFor(sel, lay, byFamily) : byFamily ? fams : soundMenus(sel);
  const stock = baseFamilies(fw, base);
  if (lay) problems.push(...checkLayout(lay, base, stock));
  const lim = menuLimits(base);
  // without UW the unit shows two fewer of the base's own (ROM and RAM): their places are ours
  const shown = stock.length - (noUw ? 2 : 0);
  if (shown + menus.length > lim.maxFamilies) {
    problems.push(`the machine-select menu takes ${lim.maxFamilies} categories and this build has ${shown + menus.length} ` +
                  `(${shown} of ${base.name}'s own): merge or delete ${shown + menus.length - lim.maxFamilies}`);
  }
  for (const f of menus) {
    const n = f.models.filter((m) => sel.some((s) => s.m.key === m.key)).length;
    if (n > lim.maxPerList) problems.push(`category ${f.name} has ${n} machines and a menu list takes ${lim.maxPerList}`);
  }
  const notes: string[] = [];
  if (reused.length) {
    notes.push(`IDs kept for machines of your restored session that are not selected were the only ones left, so they were given to new models: ` +
      `${reused.map((r) => `ID ${r.id} (was ${r.key})`).join(', ')}; kits that use those machines will find another machine there`);
  }
  if (moves.length) {
    notes.push(`moved off their preferred ID: ${moves.map((m) => `${m.name} ${m.preferred}->${m.id} (${m.why})`).join(', ')}; ` +
               'kits saved with these machines on another firmware will not find them');
  }
  // Every CTR-range test in the base's own code must be in the profile's list when a machine sits
  // on 124..127, whatever the list says: the list is what the build patches.
  const cov = baseCtrCoverage(fw, base);
  const [c0, c1] = base.os.ctrMask.ids;
  const ctrIds = sel.filter((s) => s.id >= c0 && s.id <= c1);
  const ctr = { ...cov, needed: ctrIds.length > 0 };
  if (ctr.needed && (cov.missed.length || cov.extra.length)) {
    problems.push(`${base.name}: the profile does not cover the base's CTR-range tests, which ` +
                  `${ctrIds.map((s) => `${s.m.name.trim()} (${s.id})`).join(', ')} need tightened` +
                  (cov.missed.length ? `; tests at ${cov.missed.map(h).join(', ')} are not patched` : '') +
                  (cov.extra.length ? `; listed sites ${cov.extra.map(h).join(', ')} are not CTR-range tests` : '') +
                  ` (fix the base profile, or leave out the machines on ${c0}..${c1})`);
  }
  // the options that go into the base's own code: asked for on a base that lacks what they are
  // written against is an error, never a silent skip
  if (opt.ctrControlAll && base.support.ctrControlAll && !base.support.ctrControlAll.ok && ctr.needed) {
    problems.push(`--ctr-control-all: not supported on ${base.name}: ${base.support.ctrControlAll.why}`);
  }
  if (opt.features?.dsp1Recover && opt.dsp1Watchdog !== undefined) {
    problems.push('--dsp1-watchdog and --dsp1-recover cannot be combined: --dsp1-recover replaces the watchdog handler ' +
                  '(it mutes and never halts), so there is no trip count left to raise');
  }
  const needs = sel.filter((s) => s.m.needs?.length).map((s) => ({ name: s.m.name.trim(), needs: s.m.needs! }));
  const commits = [...new Set(packs.map((p) => p.source?.commit).filter(Boolean))];
  if (commits.length > 1) notes.push(`packs built from ${commits.length} different source commits: ${commits.map((c) => c.slice(0, 7)).join(', ')}`);
  const trim = trimmed ?? trimFor(fw, base, opt.trim, opt.samples);
  const workspace = sel.some((s) => s.m.workspace);
  const wsNames = sel.filter((s) => s.m.workspace).map((s) => s.m.name.trim()).join(', ');
  if (workspace && trim.end > D.workspace.base) {
    problems.push(`${wsNames} need${sel.filter((s) => s.m.workspace).length === 1 ? 's' : ''} the per-track workspace at ` +
                  `${h(D.workspace.base)}, and the E12 bank ends at ${h(trim.end)}: trim harder`);
  }
  const first: [number, number] = [trim.end, workspace ? Math.max(trim.end, D.workspace.base) : D.bankEnd];
  const regions: [number, number][] = opt.features?.cleanRecovery ? reserveRecovery([first,...D.freeRegions]) : [first, ...D.freeRegions];
  if(opt.features?.cleanRecovery)problems.push(...cleanBaseProblems(fw,base));
  const capacity = regions.reduce((n, [a, b]) => n + b - a, 0);
  const cursors = regions.map(([a, b]) => [a, b]);
  // Words skipped to put an aligned machine on its cache offset. They are handed back as gaps and
  // taken first by whatever is placed next -- which is that machine's own tables -- so a machine
  // with tables of its own usually costs nothing to align. With alignment off no gap is ever made
  // and `alloc` is a plain first-fit bump.
  const gaps: number[][] = [];
  let overflow: string | null = null;
  const alloc = (n: number, what: string): number => {
    for (const g of gaps) {
      if (g[0] + n <= g[1]) { const a = g[0]; g[0] += n; return a; }
    }
    for (const c of cursors) {
      if (c[0] + n <= c[1]) { const a = c[0]; c[0] += n; return a; }
    }
    if (!overflow) overflow = what;
    return -1;
  };
  /** `n` words with the origin on one of `mask`'s cache offsets; null when no region has the room. */
  const allocAligned = (n: number, mask: string): { org: number; pad: number } | null => {
    for (const span of [...gaps, ...cursors]) {
      const a = alignUp(span[0], mask);
      if (a + n <= span[1]) {
        const pad = a - span[0];
        if (pad) gaps.push([span[0], a]);
        span[0] = a + n;
        return { org: a, pad };
      }
    }
    return null;
  };
  const recs: [number, number[]][] = [];
  const placed: Record<string, number> = { ws: D.workspace.base, ws_slice: D.workspace.slice };
  // Qualify the interface from its components, not the firmware's version label.
  // P-I geometry is independently discovered below; never infer it from these constants.
  if (sel.some(s => s.m.contract?.components.dsp2?.source)) {
    if (!base.modelRuntime?.ok) problems.push(`assembly md-voice/1: runtime ABI not qualified: ${base.modelRuntime?.why ?? 'component evidence missing'}`);
    Object.assign(placed, MODEL_SYMBOLS);
  }
  const assemblyPi = sel.filter(s => s.m.contract?.components.dsp2?.source && s.m.workspace_kind === 'pi');
  const assemblyScratch = sel.filter(s => s.m.contract?.components.dsp2?.source && s.m.workspace_kind === 'private');
  if (assemblyScratch.length && (D.workspace.slice !== 2048 || D.workspace.base % 2048 ||
      D.workspace.base + 16 * D.workspace.slice > D.bankEnd))
    problems.push('assembly scratch workspace requires 16 isolated, 2048-word aligned slices inside the carved E12 bank');
  if (assemblyPi.length) {
    if (!D.pi || D.pi.slice !== 1536 || D.pi.ws % 512)
      problems.push('assembly P-I users require discovered 1536-word, 512-aligned track slices');
    else placed.pi_ws = D.pi.ws;
  }
  const wanted = new Set(sel.flatMap((s) => s.m.wants_shared));
  let demand = 0;
  for (const t of shared) {
    if (!t.always && !wanted.has(t.name)) continue;
    const tw = words(t.words);
    demand += tw.length;
    placed[t.name] = alloc(tw.length, t.name);
    if (link) recs.push([placed[t.name], tw]);
  }
  const machines: Placement[] = [];
  const tableAlloc = tablePool(alloc);
  let sharedTableWords = 0;
  const doAlign = opt.align !== false;
  for (const s of sel) {
    const n = atob(s.m.code.words).length / 3;
    const a = doAlign ? alignOf(s.m, n) : null;
    let org = -1;
    let at: Placement['align'];
    if (a) {
      const got = allocAligned(n, a.offsets);
      if (got) { org = got.org; at = { offset: got.org % SECTOR, pad: got.pad, sectors: [a.sectors[0], a.sectors[1]] }; }
      else notes.push(`${s.m.name.trim()}: no room to put its code on one of its measured cache offsets, placed as ` +
                      `before (up to ${a.sectors[2]} cache sectors instead of ${a.sectors[1]}, up to ${a.metric[2]} c/s instead of ${a.metric[1]})`);
    }
    if (org < 0) org = alloc(n, `${s.m.name.trim()}`);
    const tab: Record<string, number> = { ...placed };
    let total = n;
    for (const t of s.m.tables) {
      const tw = words(t.words);
      const placedTable = tableAlloc(t.words, tw.length, `${s.m.name.trim()} (table ${t.name})`,
        !!s.m.contract?.components.dsp2?.source);
      tab[t.name] = placedTable.address;
      if (placedTable.fresh) {
        total += tw.length;
        if (link) recs.push([tab[t.name], tw]);
      } else sharedTableWords += tw.length;
    }
    demand += total;
    for (const u of s.m.uses_shared) if (placed[u] === undefined) throw new Error(`${s.m.name} reads shared table ${u}, which no pack placed`);
    if (link && !overflow) {
      recs.push([org, linkCode(s.m, org, tab)]);
      for (const k of ['init', 'trigger', 'render'] as const) recs.push([D.dispatch[k] + s.id + 1, [org + s.m.code.entry[k]]]);
    }
    machines.push({ key: s.m.key, name: s.m.name, family: s.family, id: s.id, preferred: s.preferred, org, words: n, total, align: at });
  }
  if (sharedTableWords) notes.push(`Shared ${sharedTableWords.toLocaleString('en-US')} identical immutable assembly table words; per-track scratch is never shared`);

  // The P-I clean stub, placed after every machine, only when a selected machine leaves state in
  // its P-I slice.
  let piClean: Plan['piClean'] = null;
  const piUsers = sel.filter((s) => s.m.pi_clean);
  if (piUsers.length) {
    const names = piUsers.map((s) => s.m.name.trim());
    const who = `${names.join(', ')} ${names.length === 1 ? 'leaves' : 'leave'} state in the track's P-I slice`;
    const P = D.pi;
    const wrong = P ? piUsers.filter((s) => s.m.pi_clean!.pi_ws !== P.ws || s.m.pi_clean!.pi_slice !== P.slice) : [];
    if (!P) {
      problems.push(`${who}, and the build cannot clear it for the stock P-I machines on ${base.name} ` +
                    `(${base.support.piClean?.why ?? 'not discovered'}): leave ${names.length === 1 ? 'it' : 'them'} out`);
    } else if (wrong.length) {
      problems.push(`${wrong.map((s) => s.m.name.trim()).join(', ')}: built for the P-I workspace at ${h(wrong[0].m.pi_clean!.pi_ws)} ` +
                    `(${h(wrong[0].m.pi_clean!.pi_slice)} per track), and ${base.name}'s is at ${h(P.ws)} (${h(P.slice)} per track)`);
    } else {
      const span = piSpanOf(piUsers.map((s) => ({ offset: s.m.pi_clean!.offset, words: s.m.pi_clean!.words })))!;
      // In 'dirty' mode each slice-using machine's own init marks its track (pi_clean.ts)
      const markIds = PI_CLEAN_MODE === 'irq' ? [] : piUsers.map((s) => s.id);
      const n = piStubWords(P.ids.length, markIds.length, span.words);
      demand += n;
      const org = alloc(n, 'the P-I clean stub');
      let marks: [number, number][] = [];
      if (link && !overflow) {
        marks = markIds.map((id) => {
          const r = recs.filter(([a]) => a === D.dispatch.init + id + 1);
          if (r.length !== 1 || r[0][1].length !== 1) throw new Error(`P-I clean: machine ${id} has ${r.length} init dispatch records`);
          return [id, r[0][1][0]] as [number, number];
        });
        const prog = piCleanProgram(org, P, span, marks);
        recs.push([org, prog.words]);
        P.ids.forEach((id, k) => recs.push([D.dispatch.init + id + 1, [prog.entries[k]]]));
        marks.forEach(([id], j) => { recs.find(([a]) => a === D.dispatch.init + id + 1)![1] = [prog.markEntries[j]]; });
      }
      piClean = { org, words: n, span, ids: P.ids, machines: names, marks };
    }
  }
  if (overflow) {
    const over = demand - capacity;
    problems.push(over > 0
      ? `DSP2 is ${over.toLocaleString('en')} words short: untick machines or trim the E12 samples harder`
      : `DSP2 has ${(-over).toLocaleString('en')} words left in total, but not in one piece big enough for ${overflow}: untick a machine or trim harder`);
  }
  const free = overflow ? 0 : cursors.reduce((n, c) => n + c[1] - c[0], 0) + gaps.reduce((n, g) => n + g[1] - g[0], 0);
  const { ram, feats } = placeRam(base, main, core, driveLaws(core, packs), menus, sel, opt.features ?? {}, flashAt ?? base.features.descFlash?.alias ?? 0);
  problems.push(...feats.problems);
  return {
    ok: problems.length === 0, problems, fams, menus, layout: lay ? effectiveLayout(base, lay, menus, sel, noUw ? false : opt.uw ?? lay.uw) : null, sel, moves, needs, ctr, notes, trim, workspace, piClean,
    dsp2: { fits: !overflow && (!workspace || trim.end <= D.workspace.base),
      regions, capacity, demand, free, padding: overflow ? 0 : capacity - demand - free, records: problems.length ? [] : recs, machines },
    ram, features: { dynLabels: feats.dyn, dsp1Drive: feats.dsp1, hostReorder: feats.host, unmuteFix: feats.unmute, descFlash: feats.descFlash, notes: feats.notes },
  };
}

/**
 * The menu categories a layout gives: its categories in its order, then the pack family of any
 * selected machine the map does not name; in each, the map's order, unnamed machines last in pack
 * order. A category with no selected machine gets no menu entry (it stays in the map).
 */
function menusFor(sel: Selected[], l: Layout, byFamily: boolean): Family[] {
  const cats = [...l.categories];
  const rows = new Map<string, { m: PackModel; order: number; seq: number }[]>();
  sel.forEach((s, seq) => {
    const p = l.machines[s.m.key];
    const cat = s.mapped || byFamily ? s.family : menuCategory(s.m);
    if (!cats.includes(cat)) cats.push(cat);
    const r = rows.get(cat) ?? [];
    r.push({ m: s.m, order: p ? p.order : Number.MAX_SAFE_INTEGER, seq });
    rows.set(cat, r);
  });
  return cats.map((name) => ({ name, models: (rows.get(name) ?? []).sort((a, b) => a.order - b.order || a.seq - b.seq).map((r) => r.m) }))
    .filter((f) => f.models.length);
}

/** No map: each machine under its sound category's menu code, categories in browsing order, pack order within. */
function soundMenus(sel: Selected[]): Family[] {
  const rows = new Map<string, PackModel[]>();
  for (const s of sel) {
    const cat = menuCategory(s.m);
    rows.set(cat, [...(rows.get(cat) ?? []), s.m]);
  }
  return [...rows].sort(([a], [b]) => menuOrder(a) - menuOrder(b)).map(([name, models]) => ({ name, models }));
}

/** The layout this build has: the map, with every selected machine where the build put it. */
export function effectiveLayout(base: Base, l: Layout, menus: Family[], sel: Selected[], uw: boolean | undefined): Layout {
  // the session's machines that are not selected keep their entries, but never on an ID a machine
  // of this build has: this build's machines win, and no ID is listed twice
  const used = new Set(sel.map((s) => s.id));
  const selected = new Set(sel.map((s) => s.m.key));
  const machines = Object.fromEntries(Object.entries(l.machines).filter(([k, p]) => selected.has(k) || !used.has(p.id)));
  const cats = [...l.categories];
  for (const f of menus) {
    if (!cats.includes(f.name)) cats.push(f.name);
    f.models.forEach((m, i) => {
      const s = sel.find((x) => x.m.key === m.key)!;
      machines[m.key] = { id: s.id, category: f.name, order: i };
    });
  }
  return { format: LAYOUT_FORMAT, base: base.id, categories: cats, machines, ...(uw === undefined ? {} : { uw }) };
}

