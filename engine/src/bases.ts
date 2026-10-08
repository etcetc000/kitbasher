// Base firmwares. The engine patches any OS 1.63-derived build: `discover` (engine/src/discover.ts)
// finds every place it goes into in the base's own code. A profile (bases/*.json, format md-base/2)
// is an optional cache for a known base: identification hashes, how far it has been qualified
// (hardware-proven, emulator-gated), and the values discovery found when it was qualified. The cache is never the source of an address: discovery runs on every build, and when
// a cached value disagrees the report says so and discovery wins.
//
// The lineage file (bases/lineage-163.json, md-lineage/1) is what the engine knows about 1.63:
// signatures, shapes and the fixes' constants.

import { h, sha256 } from './bytes.js';
import { OS_LIMIT, type Firmware } from './container.js';
import { discover, type Discovery, type Finding, type Support } from './discover.js';
import { nrv2bDecode } from './nrv2b.js';
import type { CodeImage } from './sig.js';
import type { PiSlices } from './pi_clean.js';
import type {RuntimeEvidence,RuntimeQualification} from './model_runtime.js';

type Hex = string;

export interface LineageFile {
  format: string; id: string; about?: string;
  identify: {
    cf_base: Hex;
    bootstrap_rewrite: { at: Hex; length: number; copy_operands: number[]; sha256: string };
    boot_block_copy: { length: number; sha256: string };
    boot_block: { sha256: string };
  };
  signatures: Record<string, string>;
  modelRuntimes?: RuntimeEvidence[];
  anchors: Record<string, Hex>;
  os: {
    descriptor: { size: number };
    dead_ids: { from: Hex; to: Hex };
    menu: { name_bytes: number; name_shown: number; charset: string; max_families: number; max_per_list: number };
    id_fixes: {
      high_defaults: { ids: Hex[]; old: Hex; new: Hex };
      ctr_mask: { ids: Hex[]; old: Hex; new: Hex; defaults_low: { old: Hex; new: Hex } };
      lev_bar: { low: { ids: Hex[]; old: Hex; new: Hex }; high: { ids: Hex[]; old: Hex; new: Hex }; ctr: { ids: Hex[]; old: Hex[] } };
      preview: { ids: Hex[][]; new: string };
    };
  };
  ram: { window: { image: Hex[]; labels: Hex[] }; heap_peak: Hex };
  dsp2: { bank_record: Hex; e12_table: Hex; e12_count: number; bank_end: Hex; free_regions: Hex[][];
          workspace: { base: Hex; slice: Hex }; dispatch: { init: Hex; trigger: Hex; render: Hex };
          pi?: { family: string; init_signature: string; window: number } };
}

export type Qualification = 'hardware-proven' | 'emulator-gated' | 'discovered';

export interface BaseProfileFile {
  format: string;
  id: string;
  name?: string;
  about?: string;
  identify: { tag: string; coldfire_sha256: string; dsp2_sha256: string; dsp1_sha256: string; addon_sha256?: string;
              scatter_sha256?: string; flash_sha256?: string };
  /** what this base has been shown to do, and by what */
  qualification?: { level: Qualification; by: string; evidence?: string[]; unproven?: string };
  /** a base the engine refuses as it is, and what to use instead (stock 1.63) */
  refuse?: string;
  /** the values discovery found when this base was qualified (discover().values) */
  cache?: Record<string, string>;
  /**
   * Options that discovery can place but that are allowed only on a base whose profile says they
   * were run on it (PROFILE_GATED): `{ ok: true, evidence }` lets the option through, `{ ok: false,
   * why }` refuses it with that reason. A base without a profile, or a profile that does not name
   * the option, is refused it as unqualified.
   */
  options?: Record<string, { ok: boolean; why?: string; evidence?: string }>;
  [k: string]: unknown;
}

/**
 * Options whose correctness discovery cannot establish from the base's code alone, so each needs a
 * profile that qualified it. --host-reorder: the sender is found and every reference to it is
 * repointed exactly, but whether the base's own host traffic tolerates the reorder depends on how
 * the base schedules its senders, which no signature shows. In the emulator the prepared 1.63 base
 * goes silent with it while the DEV base plays. --unmute-fix: the sequencer is found and checked,
 * but whether the base's own code around it (its add-on, its other users of the queues) leaves the
 * queues as the routines expect is shown only by running it, so it is given to the bases it was
 * run on (X.14 and prepared 1.63).
 */
export const PROFILE_GATED: Record<string, string> = { hostSend: '--host-reorder', unmuteFix: '--unmute-fix' };

export interface BaseSet { lineage: LineageFile; profiles: BaseProfileFile[] }

/** A piece of the base's code in RAM, as its boot puts it: the add-on, a scatter entry. */
export interface RamSegment { what: string; flash: number; used: number; ram: number; bytes: Uint8Array }

/** A base as discovery found it, labelled with what its profile (if any) says of it. */
export interface Base {
  id: string;
  name: string;
  qualified: boolean;                              // hardware-proven
  modelRuntime?: RuntimeQualification;
  qualification: { level: Qualification; by: string; profile: string | null };
  identify: { tag: string; coldfire_sha256: string; dsp2_sha256: string; dsp1_sha256: string };
  boot: {
    kind: 'addon' | 'hook';
    routine: number; jumpOperand: number; jumpOpcodeAt: number;
    addonOperand: number | null; addonFlash: number | null; addonRam: number | null; addonInit: number | null;
    scatter: { table: number; count: number } | null;
    sram: { src: number; dst: number; len: number };
    bss: [number, number];
    entry: number;                                 // the OS jump's operand (in the ColdFire slot)
    inCfTail: boolean;                             // the routine sits in the ColdFire slot's dead tail
    bootCopy: [number, number];                    // the boot block's copy inside the OS: data here (code at flash 0)
  };
  /** resize: the flash after DSP1 moves with DSP2's size; keep-end: it stays, DSP1 growth comes out of DSP2's slot */
  layout: { dsp2Slot: 'resize' | 'keep-end' };
  ext: { base: number; end: number };
  features: {
    dynLabels: { segment: [number, number]; redraw: { mode: 'stub' | 'callers'; sites: number[]; old: number; values: number }; pageSites: number[] } | null;
    dsp1Drive: { senderSites: number[]; sender: number; hook: number; ret: number; program: [number, number] } | null;
    /** the two-word host-command sender: the DSP2 entry, the DSP1 entry they share a body with,
     *  every reference to the DSP2 entry, and where the CVR write and the second word are in it */
    hostSend: { entry: number; dsp1Entry: number; sites: number[]; body: number; bytes: number;
                cvrAt: number; word2At: number; tailAt: number } | null;
    descFlash: { alias: number } | null;
    /** --cpu-indicator: the LCD flush's diff (engine/src/indicator.ts), once in the base's code */
    lcdFlush: import('./indicator.js').Site | null;
    /** the unmute-latency fix's sequencer sites (engine/src/unmute.ts); null: not found, or no label RAM range */
    unmute: import('./unmute.js').Unmute | null;
  };
  os: {
    cfBase: number; osMain: number; descriptorTable: number; freeDescriptor: number; descriptorSize: number;
    familyTable: number; familyBaseSites: number[]; familyListSites: number[];
    /** how a unit without UW hides ROM and RAM (engine/src/uw_menu.ts); null: not found */
    uwMenu: import('./uw_menu.js').UwMenu | null;
    pageDraw: number; redrawStub: number;
    heap: { site: number; old: number };
    heapStart: number;
    deadIds: [number, number];
    highDefaults: { ids: [number, number]; site: number; old: number; new: number };
    ctrMask: { ids: [number, number]; sites: number[]; old: number; new: number; defaultsLow: { site: number; old: number; new: number } };
    /**
     * FUNC + knob (control all) for a machine on 124..127: the one gate that is not a CTR-range
     * mask (engine/src/ctr_controlall.ts). Null when the base does not have it.
     */
    ctrControlAll: { ids: [number, number]; sites: number[]; old: number; new: number } | null;
    /** the per-track skip in the broadcast loop, rewritten as a range test (ctr_controlall.ts) */
    ctrLoopSkip: { site: number; codeAt: number; old: Uint8Array; new: Uint8Array } | null;
    levBar: {
      low: { ids: [number, number]; site: number; old: number; new: number };
      high: { ids: [number, number]; site: number; old: number; new: number };
      ctr: { ids: [number, number]; jmpSites: number[]; old: number[]; resume: number; draw: number };
    };
    menu: { nameBytes: number; nameShown: number; charset: string; maxFamilies: number; maxPerList: number };
    preview: { ids: [number, number][]; site: number; old: Uint8Array; new: Uint8Array } | null;
  };
  dsp2: {
    bankRecord: number; e12Table: number; e12Count: number; bankEnd: number;
    freeRegions: [number, number][];
    workspace: { base: number; slice: number };
    dispatch: { init: number; trigger: number; render: number };
    /** the stock P-I IDs, their own inits and the P-I slices (null: not found, support.piClean says why) */
    pi: PiSlices | null;
    bootWrites?: {known:boolean;ranges:[number,number][]};
  };
  /** the base's own code in RAM other than the ColdFire slot (add-on, scatter entries) */
  segments: RamSegment[];
  support: Discovery['support'];
  findings: Finding[];
}

/**
 * The base's code as it is in RAM when our boot routine runs: the ColdFire slot below the BSS the
 * reset code cleared, the SRAM copy it made, and the base's own pieces.
 */
export function codeImages(fw: Firmware, base: Base): CodeImage[] {
  const main = fw.slots[0].raw;
  const O = base.os;
  const S = base.boot.sram;
  return [
    { what: 'ColdFire slot', ram: O.cfBase, bytes: main.subarray(0, Math.min(main.length, base.boot.bss[0] - O.cfBase)) },
    { what: 'SRAM', ram: S.dst, bytes: main.subarray(S.src - O.cfBase, S.src - O.cfBase + S.len) },
    ...base.segments.map((s) => ({ what: s.what, ram: s.ram, bytes: s.bytes })),
  ];
}

export interface Identity { tag: string; coldfire: string; dsp2: string; dsp1: string; addon?: string; flash?: string }

/** The base's RAM code other than the ColdFire slot: its add-on, then its scatter entries. */
export function ramSegments(_fw: Firmware, base: Base): RamSegment[] {
  return base.segments;
}

export async function identity(fw: Firmware, addonFlash?: number | null): Promise<Identity> {
  const id: Identity = {
    tag: fw.tag,
    coldfire: await sha256(fw.slots[0].raw),
    dsp2: await sha256(fw.slots[1].raw),
    dsp1: await sha256(fw.slots[2].raw),
  };
  if (addonFlash != null && addonFlash + 8 < fw.flash.length) {
    try { id.addon = await sha256(nrv2bDecode(fw.flash.subarray(addonFlash + 8, OS_LIMIT)).out); } catch { /* no add-on */ }
  }
  if (fw.kind === 'flash') id.flash = await sha256(fw.flash);
  return id;
}

export interface Resolved {
  base: Base;
  id: Identity;
  discovery: Discovery;
  profile: BaseProfileFile | null;
  /** cached values that disagree with discovery (discovery wins) */
  disagreements: string[];
}

/** Base could not be patched: `discovery` says why (a stock OS, an already patched one, not 1.63). */
export class NotPatchable extends Error {
  constructor(message: string, readonly discovery: Discovery | null, readonly profile: BaseProfileFile | null) { super(message); }
}

/**
 * OS tags Kitbasher does not support, and what it says. Refused before discovery, so such an OS
 * (stock, or a build made on it) is never patched or taken for another base.
 */
const UNSUPPORTED: Record<string, string> = { 'X13 ': 'OS X.13 is not supported. Load an OS X.14 file.' };

/** Why an OS with this tag is not supported, or null. */
export function unsupported(tag: string): string | null {
  return UNSUPPORTED[tag] ?? null;
}

/**
 * Identify and discover. A profile matches by its slot hashes (and add-on, when it has one); with
 * none, the base is still discovered and labelled 'discovered'. A profile with `refuse` (stock
 * 1.63) turns the build away with its message; an unsupported tag (X.13) is refused first.
 */
export async function resolveBase(fw: Firmware, set: BaseSet): Promise<Resolved> {
  const no = unsupported(fw.tag);
  if (no) throw new NotPatchable(no, null, null);
  const id = await identity(fw);
  let profile: BaseProfileFile | null = null;
  for (const p of set.profiles) {
    const w = p.identify;
    if (id.tag !== w.tag || id.coldfire !== w.coldfire_sha256 || id.dsp2 !== w.dsp2_sha256 || id.dsp1 !== w.dsp1_sha256) continue;
    profile = p;
    break;
  }
  const label = profile ? { id: profile.id, name: profile.name ?? profile.id }
    : { id: `lineage-163-${id.coldfire.slice(0, 8)}`, name: `an unprofiled 1.63-lineage OS (tag '${fw.tag.trim()}', ColdFire ${id.coldfire.slice(0, 8)})` };
  const d = await discover(fw, set.lineage, label);
  if (profile?.refuse) throw new NotPatchable(`${label.name}: ${profile.refuse}`, d, profile);
  if (!d.base) throw new NotPatchable(d.refused ?? `${label.name}: discovery failed`, d, profile);
  const base = d.base;
  const disagreements: string[] = [];
  if (profile) {
    if (base.boot.addonFlash !== null) {
      const full = await identity(fw, base.boot.addonFlash);
      if (profile.identify.addon_sha256 && full.addon !== profile.identify.addon_sha256) {
        // same slots, different add-on: not the base the profile qualified
        profile = null;
      } else {
        id.addon = full.addon;
      }
    }
  }
  for (const [k, flag] of Object.entries(PROFILE_GATED)) {
    const o = profile?.options?.[k];
    const sup = (base.support as unknown as Record<string, { ok: boolean; why: string }>)[k];
    if (o?.ok || !sup?.ok) continue;
    const why = o ? `refused on this base: ${o.why ?? 'its profile says so'}` : `${flag} is not qualified on ${profile ? profile.id : 'a base without a profile'}: ` +
      'it is found in the code, but only a base whose profile records it running is given it';
    (base.support as unknown as Record<string, { ok: boolean; why: string }>)[k] = { ok: false, why };
    if (k === 'hostSend') base.features.hostSend = null;
    if (k === 'unmuteFix') base.features.unmute = null;
  }
  if (profile) {
    for (const [k, v] of Object.entries(profile.cache ?? {})) {
      if (d.values[k] !== undefined && d.values[k] !== v) disagreements.push(`${k}: cached ${v}, discovered ${d.values[k]}`);
      if (d.values[k] === undefined) disagreements.push(`${k}: cached ${v}, not discovered on this build`);
    }
    const q = profile.qualification ?? { level: 'discovered' as Qualification, by: 'a profile without qualification evidence' };
    base.qualification = { level: disagreements.length ? 'discovered' : q.level, by: disagreements.length ? `${q.by}; but discovery disagrees with its cache` : q.by, profile: profile.id };
    base.qualified = base.qualification.level === 'hardware-proven';
  } else {
    base.id = label.id;
    base.name = label.name;
  }
  base.identify = { tag: fw.tag, coldfire_sha256: id.coldfire, dsp2_sha256: id.dsp2, dsp1_sha256: id.dsp1 };
  return { base, id, discovery: d, profile, disagreements };
}

/** Convenience wrapper over resolveBase: the base and its identity (throws NotPatchable). */
export async function identify(fw: Firmware, set: BaseSet): Promise<{ base: Base; id: Identity; resolved: Resolved }> {
  const r = await resolveBase(fw, set);
  return { base: r.base, id: r.id, resolved: r };
}

export function baseSet(files: (BaseProfileFile | LineageFile)[]): BaseSet {
  const lineage = files.find((f) => f.format === 'md-lineage/1') as LineageFile | undefined;
  if (!lineage) throw new Error('no lineage file (md-lineage/1) among the base files');
  const profiles = files.filter((f) => f.format === 'md-base/2') as BaseProfileFile[];
  const old = files.filter((f) => f.format !== 'md-lineage/1' && f.format !== 'md-base/2');
  if (old.length) throw new Error(`base files in an old format: ${old.map((f) => f.id).join(', ')}`);
  return { lineage, profiles };
}

export const supportLine = (k: string, s: Support): string => `${k}: ${s.ok ? 'yes' : 'no'} (${s.why})`;
export { h };
