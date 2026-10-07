// Model packs (format md-pack/1), written by the pack exporters under packs/. A pack holds one
// family's machines: its shared tables and, per machine, the DSP2 code at a reference placement
// with a list of relocations, the machine's own tables, and its OS descriptor fields. A family may
// arrive split across several packs (for example, one shipped with the patcher and one from a local
// pack directory); `seq` restores the family's own order of machines and shared tables, so the
// pack a machine came in never changes the build.

import { isPackCategory } from './sound_catalog.js';
import type { AlignEntry } from './align.js';
import { fromBase64, wordsLE } from './bytes.js';
import type { DynCore, DynPlan, Dsp1Core, Dsp1Law } from './features.js';
import { checkModelContract, type ModelContract } from './model_contract.js';
import { panelModesFromPlans } from './model_panel.js';
import { checkPitch, type Pitch } from './pitch.js';

export const PACK_FORMAT = 'md-pack/1';

export interface PackTable { name: string; words: string; always?: boolean; seq?: number }

/** Data a machine reads at run time that the firmware does not carry (a UW sample it finds by header). */
export interface PackNeed {
  kind: 'uw-sample';
  name: string;                     // what the MD's sample manager shows, e.g. 'NDCL', 'DWAV'
  what: string;                     // where it comes from
  without: string;                  // what the machine does when it is not loaded
  install?: { transport: 'sds-handshake'; file: string }; // suggested asset basename, not a download URL
}

export interface PackModel {
  contract?: ModelContract;
  key: string;                      // 'OSC/SW', 'VAD/BD', ...
  /**
   * Keys this model was published under before (e.g. 'MM/4' for OSC/SW). A saved layout, a
   * selection or an exclusion that names one of them means this model (selection.ts keyAliases).
   */
  aliases?: string[];
  module: string;                   // source module name, as matched by MD_EXCLUDE
  name: string;                     // 5 characters
  /**
   * Optional browsing data carried by the pack (packs/annotate_browse.mjs): the page's category
   * and description for the model and help per control label. Lets a pack that is not in the
   * page's bundled catalog sort and explain its models in the page.
   */
  browse?: { category?: string; description?: string; help?: Record<string, [string, string]> };
  /**
   * What the pitch knob means (engine/src/pitch.ts): its knob, law, base note, steps and range.
   * An assembly model carries the same object in `contract.panel.pitch`; a compiled pack, which
   * has no contract, carries it only here.
   */
  pitch?: Pitch;
  labels: (string | null)[];        // 8
  defaults: number[];               // 8
  id: number;                       // preferred machine ID, the same on every base (a moved ID is an error)
  workspace: boolean;               // needs the per-track workspace carved out of the E12 space
  workspace_kind?: 'private' | 'pi' | null;   // 'private': its own carved-out slice; 'pi': its track's slice of the stock P-I workspace
  /**
   * The machine leaves state in its track's P-I slice that a stock P-I machine landing on the
   * track would play (P-I BD, SD, RS read their rings before writing them): words
   * `offset`..`offset + words - 1` of the slice, for the P-I workspace it was built for (`pi_ws`,
   * `pi_slice` words per track, constants in its code). With such a machine selected the build
   * routes every stock P-I init through a stub that zeroes that span first (engine/src/pi_clean.ts).
   */
  pi_clean?: PiClean | null;
  wants_shared: string[];           // prefixed shared tables it asks for (placed only on request)
  uses_shared: string[];            // every shared table its code references
  dsp1_drive: string | null;        // the DSP1 law it opts into (DIST takes that curve on its track)
  dyn_labels: DynPlan[];            // mode knobs whose stops relabel other knobs (empty: static labels)
  tables: PackTable[];
  seq?: number;                     // position in its family (export order)
  needs?: PackNeed[];               // run-time data the firmware does not carry
  flash_rank?: number | null;       // descFlash 'auto' moves ranked descriptors first (hardware ran them from flash)
  /**
   * The instruction-cache offsets measured as good for this exact code (engine/src/align.ts).
   * Absent when the machine's cost is flat across offsets (most machines), and absent when the
   * code has changed since it was measured: the build then places it first-fit rather than on
   * offsets measured for other code.
   */
  align?: AlignEntry;
  code: {
    words: string;
    org: number;
    entry: { init: number; trigger: number; render: number };
    relocs: [number, string, number][];      // word index, symbol ('@org' or a table), weight
    symbols: Record<string, number>;         // the reference address of each table symbol
  };
}

export interface PiClean { offset: number; words: number; pi_ws: number; pi_slice: number }

export interface Pack {
  format: string;
  family: string;
  order: number;
  source: { repo: string; commit: string; dirty: boolean; env: Record<string, string> };
  shared: PackTable[];
  models: PackModel[];
  dsp1_laws?: Dsp1Law[];            // DSP1 drive laws its machines use that the core pack does not carry
}

export interface CorePack {
  format: string;
  family: 'CORE';
  source?: Pack['source'];
  knob_callback: string;
  dyn: DynCore;
  dsp1: Dsp1Core;
}

export const words = (b64: string): number[] => wordsLE(fromBase64(b64));

/**
 * DSP memory a model takes on its own, in words: its code, its tables and the shared tables it
 * asks for. A selection can take less (identical tables and shared tables are placed once).
 */
export function modelWords(m: PackModel, shared: PackTable[] = []): number {
  const n = (b64: string): number => fromBase64(b64).length / 3;
  return n(m.code.words) + m.tables.reduce((s, t) => s + n(t.words), 0) +
    shared.filter((t) => m.wants_shared.includes(t.name)).reduce((s, t) => s + n(t.words), 0);
}

export function checkPack(p: Pack | CorePack): void {
  if (p.format !== PACK_FORMAT) throw new Error(`pack ${p.family}: format ${p.format}, this engine reads ${PACK_FORMAT}`);
  if ('models' in p) for (const m of p.models) {
    if (m.browse !== undefined) {
      const b = m.browse as Record<string, unknown>;
      const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
      if (!b || typeof b !== 'object' || Object.keys(b).some(k => !['category', 'description', 'help'].includes(k)) ||
          (b.category !== undefined && !isPackCategory(b.category)) || (b.description !== undefined && !text(b.description, 400)) ||
          (b.help !== undefined && (typeof b.help !== 'object' || Object.values(b.help as object).some(h =>
            !Array.isArray(h) || h.length !== 2 || !text(h[0], 80) || !text(h[1], 400)))))
        throw new Error(`${m.name}: invalid browse data`);
    }
    checkAliases(m);
    checkModelContract(m, p.family);
    if (m.pitch !== undefined) checkPitch(m.pitch, m.contract?.panel ??
      { knobs: m.labels.map(l => ({ label: l ?? '' })), modes: panelModesFromPlans(m.dyn_labels ?? []) }, m.key);
    for (const n of m.needs ?? []) if (n.install !== undefined &&
      (!n.install || n.install.transport !== 'sds-handshake' || typeof n.install.file !== 'string' ||
       Object.keys(n.install).some(k => k !== 'transport' && k !== 'file') ||
       !/^[A-Za-z0-9][A-Za-z0-9_-]*\.syx$/.test(n.install.file))) {
      throw new Error(`${m.name}: invalid UW installation descriptor`);
    }
  }
}

/** A model's `aliases`: unique nonempty strings, none of them its own key. */
export function checkAliases(m: PackModel): void {
  if (m.aliases === undefined) return;
  if (!Array.isArray(m.aliases) || m.aliases.some((a) => typeof a !== 'string' || !a.length || a.length > 32))
    throw new Error(`${m.key}: aliases must be nonempty strings`);
  if (new Set(m.aliases).size !== m.aliases.length) throw new Error(`${m.key}: an alias is listed twice`);
  if (m.aliases.includes(m.key)) throw new Error(`${m.key}: a model cannot alias its own key`);
}

/** Whether a model reads a UW sample (or its contract declares samples): a Machinedrum without UW cannot play it. */
export const needsUwSamples = (m: PackModel): boolean =>
  (m.needs ?? []).some((n) => n.kind === 'uw-sample') || (m.contract?.samples?.length ?? 0) > 0;

export function needLines(m: PackModel): string[] {
  return (m.needs ?? []).map((n) => `${m.name.trim()}: ${n.without} without the ${n.name} sample in a UW slot (${n.what})` +
    (n.install ? `. Load ${n.install.file} using handshaken SDS; check the file's destination slot before sending.` : ''));
}

/** Link a machine's code at `org` with its tables at `placed`. */
export function linkCode(m: PackModel, org: number, placed: Record<string, number>): number[] {
  const out = words(m.code.words);
  for (const [i, sym, k] of m.code.relocs) {
    const from = sym === '@org' ? m.code.org : m.code.symbols[sym];
    const to = sym === '@org' ? org : placed[sym];
    if (to === undefined) throw new Error(`${m.name}: table ${sym} is not placed`);
    out[i] = (out[i] + k * (to - from)) & 0xffffff;
  }
  return out;
}
