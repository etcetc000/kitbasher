// E12 sample swapping: read the bank, find which machines play which entry, and put the user's own
// 12-bit samples in place of stock ones before the trim (engine/src/e12.ts) runs.
//
// What the E12 code assumes, read from the base's own DSP2 upload (docs/SAMPLES.md has the
// details): every E12 machine reaches its samples only through the table at `e12Table`, each entry
// (start, length in samples = 2 * words + 34, 0). Single-sample machines store their entry index
// in their track state at INIT (`move #>k,x0 / move x0,y:(r6+$f)`) and their TRIGGER computes
// table + 3k (`add #>table,a`); the two-sample machines load both entries' addresses directly
// (`move #>entry2,r1 / move #>entry1,r0`, e12.ts e12Pairs). Nothing else in the upload, the
// ColdFire code or DSP1 names a sample's address or length, so any entry may be re-laid with
// different content as long as the table says where it is and the 153 silent pad words follow it.
//
// Swapped samples are never longer than the stock entry they replace (the cap is that entry's
// length in samples), so the bank never grows past its stock footprint.

import type { Base } from './bases.js';
import type { Firmware } from './container.js';
import { wordsLE } from './bytes.js';
import { records } from './dsp.js';
import { baseFamilies } from './layout.js';
import { e12Pairs, LEN_EXTRA, PAD, pack12, roundHalfEven, SR, unpack12 } from './e12.js';

/** The user's changes to the bank: entry -> 12-bit samples, and entries the trim leaves whole. */
export interface SampleEdits {
  swaps: ReadonlyMap<number, ArrayLike<number>>;
  noTrim: ReadonlySet<number>;
}

export const NO_EDITS: SampleEdits = { swaps: new Map(), noTrim: new Set() };

/** samples of linear fade where a swapped sample longer than its entry is cut */
export const CAP_FADE = 256;
export const MIN_12 = -2048;
export const MAX_12 = 2047;

export interface E12Machine {
  id: number; name: string; family: string;
  /** the entries it plays: one, or [first, second] for the two-sample machines */
  entries: number[];
}

export interface BankEntry {
  entry: number;
  start: number;                 // P address in the stock bank
  words: number;                 // data words (the 153 pad words follow)
  samples: number;               // 2 * words: the cap for a swap
  data: Int16Array;              // the stock samples, 12-bit values
  machines: E12Machine[];        // the machines that play it
  /** pairs it is in: as `first` its playback length bounds the partner's (see e12.ts e12Pairs) */
  pairs: { partner: number; first: boolean }[];
}

export interface E12Bank {
  entries: BankEntry[];
  machines: E12Machine[];
  pairs: [number, number][];
  /** data + pad words of the stock bank: its footprint after the table */
  stockWords: number;
}

/** The bank's run of upload records (one in X.13, 62 back to back in stock 1.63) and its words. */
export interface BankRun { bank: number[]; bankIndex: number; bankEndIndex: number; bankRecords: number }

export function bankRun(fw: Firmware, base: Base): BankRun {
  const D = base.dsp2;
  const w = wordsLE(fw.slots[1].raw);
  const { recs } = records(w);
  const hx = (v: number): string => '0x' + v.toString(16);
  const first = recs.findIndex((r) => r.addr === D.bankRecord && r.tag === 0);
  if (first < 0 || recs.filter((r) => r.addr === D.bankRecord && r.tag === 0).length !== 1) {
    throw new Error(`expected one upload record starting the E12 bank at ${hx(D.bankRecord)}`);
  }
  let last = first;
  while (D.bankRecord + recs.slice(first, last + 1).reduce((n, r) => n + r.count, 0) < D.bankEnd) {
    const r = recs[last + 1];
    const at = recs[last].addr + recs[last].count;
    if (!r || r.tag !== 0 || r.addr !== at) throw new Error(`the E12 bank's records break off at ${hx(at)} before ${hx(D.bankEnd)}`);
    last++;
  }
  const run = recs.slice(first, last + 1);
  if (run[run.length - 1].addr + run[run.length - 1].count !== D.bankEnd) throw new Error('E12 bank record does not end where the bank does');
  const other = recs.filter((r, i) => (i < first || i > last) && r.tag === 0 && r.addr < D.bankEnd && r.addr + r.count > D.bankRecord);
  if (other.length) throw new Error(`another upload record writes into the E12 bank at ${hx(other[0].addr)}`);
  const bank = run.flatMap((r) => w.slice(r.index + 3, r.index + 3 + r.count));
  const end = run[run.length - 1];
  return { bank, bankIndex: run[0].index, bankEndIndex: end.index + 3 + end.count, bankRecords: run.length };
}

const RTS = 0x00000c;
const MOVE_R0 = 0x60f400, MOVE_R1 = 0x61f400;     // move #>imm,r0 / r1
const ADD_A = 0x0140c0;                             // add #>imm,a
const MOVE_X0 = 0x44f400;                           // move #>imm,x0
const STORE_X0_Y_R6 = 0x0b7684;                     // move x0,y:(r6+disp)
const INDEX_SLOT = 0x00000f;                        // y:(r6+$f): the track's entry index

/**
 * Which machines play which entries, read from the DSP2 dispatch tables (indexed by ID + 1) and
 * each machine's INIT and TRIGGER routine: a trigger that loads table entries into r0/r1 plays
 * those (r0 the first); one that adds the table to the track's entry index plays the entry its
 * INIT stores there. Machines whose code does neither are not E12 machines.
 */
export function e12Machines(P: (a: number) => number | undefined, base: Base, fams: { name: string; machines: { name: string; id: number }[] }[]): E12Machine[] {
  const D = base.dsp2;
  const T = D.e12Table, N = D.e12Count;
  const entryOf = (v: number | undefined): number | null =>
    v !== undefined && v >= T && v < T + 3 * N && (v - T) % 3 === 0 ? (v - T) / 3 : null;
  const routine = (a: number | undefined, max = 64): number[] => {
    const out: number[] = [];
    if (a === undefined) return out;
    for (let i = 0; i < max; i++) { const v = P(a + i); if (v === undefined) break; out.push(v); if (v === RTS) break; }
    return out;
  };
  const out: E12Machine[] = [];
  for (const f of fams) for (const m of f.machines) {
    if (m.id < 0) continue;
    const trig = routine(P(D.dispatch.trigger + m.id + 1));
    let r0: number | null = null, r1: number | null = null, indexed = false;
    for (let i = 0; i + 1 < trig.length; i++) {
      if (trig[i] === MOVE_R0 && entryOf(trig[i + 1]) !== null) r0 ??= entryOf(trig[i + 1]);
      if (trig[i] === MOVE_R1 && entryOf(trig[i + 1]) !== null) r1 ??= entryOf(trig[i + 1]);
      if (trig[i] === ADD_A && trig[i + 1] === T) indexed = true;
    }
    let entries: number[] | null = null;
    if (r0 !== null) entries = r1 !== null && r1 !== r0 ? [r0, r1] : [r0];
    else if (indexed) {
      const init = routine(P(D.dispatch.init + m.id + 1));
      for (let i = 0; i + 3 < init.length; i++) {
        if (init[i] === MOVE_X0 && init[i + 2] === STORE_X0_Y_R6 && init[i + 3] === INDEX_SLOT && init[i + 1] < N) { entries = [init[i + 1]]; break; }
      }
    }
    if (entries) out.push({ id: m.id, name: m.name.trim(), family: f.name.trim(), entries });
  }
  return out;
}

/** The stock bank as the page shows it: every entry, its samples, and who plays it. */
export function readBank(fw: Firmware, base: Base): E12Bank {
  const D = base.dsp2;
  const w = wordsLE(fw.slots[1].raw);
  const mem = new Map<number, number>();
  for (const r of records(w).recs) if (r.tag === 0) for (let i = 0; i < r.count; i++) mem.set(r.addr + i, w[r.index + 3 + i]);
  const { bank } = bankRun(fw, base);
  const seg = bank;
  const at = (a: number): number => a - D.bankRecord;
  const N = D.e12Count, T = D.e12Table;
  const starts = Array.from({ length: N }, (_, i) => seg[at(T + 3 * i)]);
  const ends = [...starts.slice(1), D.bankEnd];
  const machines = e12Machines((a) => mem.get(a), base, baseFamilies(fw, base));
  const pairs = e12Pairs(seg, D.bankRecord, T, N);
  const entries: BankEntry[] = starts.map((st, i) => {
    const words = ends[i] - st - PAD;
    const len = seg[at(T + 3 * i + 1)];
    if (len !== 2 * words + LEN_EXTRA) throw new Error(`E12 entry ${i}: unexpected length ${len} for ${words} words`);
    return {
      entry: i, start: st, words, samples: 2 * words,
      data: Int16Array.from(unpack12(seg.slice(at(st), at(st + words)))),
      machines: machines.filter((m) => m.entries.includes(i)),
      pairs: pairs.flatMap(([a, b]): { partner: number; first: boolean }[] => (a === i ? [{ partner: b, first: true }] : b === i ? [{ partner: a, first: false }] : [])),
    };
  });
  return { entries, machines, pairs, stockWords: D.bankEnd - starts[0] };
}

/** A swapped sample checked and cut to `cap` samples, fading the last CAP_FADE out. */
export function capSamples(x: ArrayLike<number>, cap: number): { data: number[]; capped: boolean } {
  const y = Array.from(x);
  for (const v of y) if (!Number.isInteger(v) || v < MIN_12 || v > MAX_12) throw new Error(`a 12-bit sample must be an integer in ${MIN_12}..${MAX_12}, not ${v}`);
  if (y.length <= cap) return { data: y, capped: false };
  y.length = cap;
  const f = Math.min(CAP_FADE, cap);
  for (let k = 0; k < f; k++) { const j = cap - f + k; y[j] = roundHalfEven(y[j] * (1 - k / f)); }
  return { data: y, capped: true };
}

/**
 * The bank words with swapped entries in place, re-laid back to back from the first sample (each
 * followed by its pad), the table rewritten; a swap longer than its stock entry is cut to it. With
 * every swap equal to the stock data this is the stock bank, word for word.
 */
export function applySwaps(seg: number[], segBase: number, table: number, count: number, bankEnd: number,
  swaps: ReadonlyMap<number, ArrayLike<number>>): { words: number[]; end: number; capped: number[] } {
  const at = (a: number): number => a - segBase;
  const starts = Array.from({ length: count }, (_, i) => seg[at(table + 3 * i)]);
  if (starts[0] !== table + 3 * count) throw new Error('E12 samples do not start after the table');
  for (const k of swaps.keys()) if (!Number.isInteger(k) || k < 0 || k >= count) throw new Error(`no E12 entry ${k}`);
  const ends = [...starts.slice(1), bankEnd];
  const out = seg.slice(0, at(starts[0]));
  const capped: number[] = [];
  let pos = starts[0];
  for (let i = 0; i < count; i++) {
    const nw = ends[i] - starts[i] - PAD;
    let words: number[];
    const s = swaps.get(i);
    if (s) {
      const c = capSamples(s, 2 * nw);
      if (c.capped) capped.push(i);
      words = pack12(c.data);
    } else words = seg.slice(at(starts[i]), at(starts[i] + nw));
    out[at(table + 3 * i)] = pos;
    out[at(table + 3 * i + 1)] = 2 * words.length + LEN_EXTRA;
    out.push(...words);
    for (let k = 0; k < PAD; k++) out.push(0);
    pos += words.length + PAD;
  }
  return { words: out, end: pos, capped };
}

/** Bank words a set of entry lengths costs: data words plus each entry's pad. */
export const wordCost = (samples: number): number => Math.ceil(samples / 2) + PAD;

export const seconds = (samples: number): number => samples / SR;
