// The two model-facing features that added machines may rely on:
//
//   dynamic labels  a segment in its own RAM range: `update` (keeps the displayed track's knob
//                   labels in step with its mode knob), two trampolines (the knob-turn refresh and
//                   the whole-page draw), a flag, the entry table, lookup maps and label blocks.
//                   Reached by a 6-byte call in the knob callback, and by retargeting the base's
//                   redraw stub and every `jsr/jmp` to the 1.63 page-draw routine.
//   DSP1 drive      upload records for DSP1 (a hook in the per-track chain, the law bodies, and the
//                   sixteen selector words zeroed), and a ColdFire transport in the RAM image that
//                   tells DSP1 each track's law when its machine changes.
//
// The code itself comes from the core pack as templates: bytes plus the 32-bit fields that depend
// on addresses, as recorded by the pack exporter.

import { be32, Buf, fromBase64, h, wordsLE } from './bytes.js';
import type { PackModel } from './packs.js';
import { records } from './dsp.js';

export interface Template { bytes: string; params: Record<string, number>; fields: [number, Record<string, number>][] }

export function instantiate(t: Template, vals: Record<string, number>): Uint8Array {
  const b = fromBase64(t.bytes);
  for (const [at, w] of t.fields) {
    let v = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    for (const [p, k] of Object.entries(w)) {
      if (vals[p] === undefined) throw new Error(`template needs ${p}`);
      v += k * (vals[p] - t.params[p]);
    }
    b.set(be32(v >>> 0), at);
  }
  return b;
}

// ---- dynamic labels -------------------------------------------------------------------------

export interface DynPlan { knob: number; mask: number[]; stop_of: number[]; formula: [number, number, number] | null; stops: number; blocks: string }
export interface DynCore { entry_size: number; terminator: number; call_size: number; update: Template; values: Template; page: Template }

/** Where a machine's label blocks go: the segment, or (named machines) the flash block. */
export interface DynMachine { m: PackModel; id: number; desc: number; blocksToFlash: boolean }

const pad4 = (n: number): number => n + ((-n) & 3);

/**
 * The segment at `base`. `values` and `page` are the routines the base's redraw stub and page-draw
 * calls went to (read from the base, not assumed). `flashAt` is the run-time address where label
 * blocks of machines marked `blocksToFlash` go; returns those bytes for the caller to place there.
 * Null when no machine declares labels.
 */
export function dynSegment(core: DynCore, machines: DynMachine[], base: number, values: number, page: number,
  flashAt: number | null): { blob: Uint8Array; update: number; values: number; page: number; flag: number; flashBlocks: Uint8Array } | null {
  const plans = machines.flatMap((d) => d.m.dyn_labels.map((p) => ({ d, p })));
  if (!plans.length) return null;
  const upd = fromBase64(core.update.bytes).length;
  const vs = fromBase64(core.values.bytes).length;
  const ps = fromBase64(core.page.bytes).length;
  const a = { update: base, values: base + pad4(upd), page: 0, flag: base + pad4(pad4(upd) + vs + ps), table: 0 };
  a.page = a.values + vs;
  a.table = a.flag + 4;
  // tables(): entry table, then maps and blocks in the order the entries need them
  const head = new Buf();
  const body = new Buf();
  const fimg = new Buf();
  const at = a.table + core.entry_size * plans.length + 4;
  const maps = new Map<string, number>();
  for (const { d, p } of plans) {
    let fn: number;
    let nbyte: number;
    if (p.formula === null) {
      const key = p.stop_of.join(',');
      if (!maps.has(key)) { maps.set(key, at + body.length); body.push(Uint8Array.from(p.stop_of)); }
      fn = maps.get(key)!;
      nbyte = 0;
    } else {
      const [sa, n, sb] = p.formula;
      fn = ((sa << 24) | (sb << 16)) >>> 0;
      nbyte = n;
    }
    const blocks = fromBase64(p.blocks);
    let blocksAt: number;
    if (d.blocksToFlash) {
      if (flashAt === null) throw new Error('label blocks in flash need the flash block (descriptors in flash)');
      if (fimg.length % 4 || blocks.length % 4) throw new Error('flash label blocks must stay 4-aligned');
      blocksAt = flashAt + fimg.length;
      fimg.push(blocks);
    } else {
      blocksAt = at + body.length;
      body.push(blocks);
    }
    const maskBits = p.mask.reduce((s, k) => s | (1 << k), 0);
    head.push(be32(d.id), [p.knob, maskBits, 4 * p.mask.length, nbyte], be32(d.desc + 0x0a), be32(fn), be32(blocksAt));
  }
  head.push(be32(core.terminator));
  const blob = new Buf().push(instantiate(core.update, { table: a.table, flag: a.flag }));
  blob.fill(0, a.values - base - blob.length);
  blob.push(instantiate(core.values, { update: a.update, flag: a.flag, values, page }));
  blob.push(instantiate(core.page, { update: a.update, flag: a.flag, page }));
  blob.fill(0, a.flag - base - blob.length);
  blob.fill(0, 4);
  blob.push(head.bytes(), body.bytes());
  blob.align(4, 0);
  return { blob: blob.bytes(), update: a.update, values: a.values, page: a.page, flag: a.flag, flashBlocks: fimg.bytes() };
}

/** Operand address of every `jsr`/`jmp <target>` in the images, in image order. */
export function callSites(images: [Uint8Array, number][], target: number): number[] {
  const t = be32(target);
  const out: number[] = [];
  for (const [b, org] of images) {
    for (let o = 0; o + 5 < b.length; o += 2) {
      if (b[o] === 0x4e && (b[o + 1] === 0xb9 || b[o + 1] === 0xf9) &&
          b[o + 2] === t[0] && b[o + 3] === t[1] && b[o + 4] === t[2] && b[o + 5] === t[3]) out.push(org + o + 2);
    }
  }
  return out;
}

export const callCode = (target: number): Uint8Array => Uint8Array.of(0x4e, 0xb9, ...be32(target));

// ---- DSP1 drive -----------------------------------------------------------------------------

export interface Dsp1Record { addr: number; space: number; words: string }

/**
 * One drive law: its body as DSP1 P words at a reference placement, with relocations against its
 * own origin ('@org') and against the laws it jumps into ('@<law>', e.g. cubicd into cubic's loop),
 * and any records of its own (the shared coefficient table). `rank` is its place in the dispatcher's
 * compare chain, `emit` its place in P memory; both only order the laws that are linked. The core
 * pack carries the laws of our own design; a law derived from another instrument travels in the
 * pack of the machines that use it.
 */
export interface Dsp1Law {
  name: string; rank: number; emit: number; requires: string[];
  words: string; org: number; entry: number; relocs: [number, string, number][];
  records: Dsp1Record[];
}

export interface Dsp1Core {
  head: Dsp1Record[];              // before the bodies: the hook in the dead window
  tail: Dsp1Record[];              // after them: the sixteen per-track selector words zeroed
  dispatch: { base: number; limit: number; test: string; jump: number; tail: string };
  laws: Dsp1Law[];
  cache_bytes: number;
  stock_sender: number;
  transport: Template;
}

export interface DriveLink {
  selector: Record<string, number>;          // law -> the value the transport sends for it
  laws: string[];                            // in dispatcher order
  records: { addr: number; space: number; words: number[] }[];
  words: number;                             // dispatcher + bodies
}

/** Later upload records win: retaining the base records alone cannot prove preservation. */
export function drivePlacementProblems(upload: number[], drive: DriveLink, hook: number, ret: number,
  reserved: DriveLink['records'] = []): string[] {
  const original = new Map<string, number>();
  for (const r of records(upload).recs) for (let i = 0; i < r.count; i++) {
    original.set(`${r.tag}:${r.addr + i}`, upload[r.index + 3 + i]);
  }
  const blocked = new Set(reserved.flatMap(r => r.words.map((_, i) => `${r.space}:${r.addr + i}`)));
  const written = new Map<string, number>();
  const problems: string[] = [];
  for (const r of drive.records) for (const [i, word] of r.words.entries()) {
    const at = r.addr + i, key = `${r.space}:${at}`;
    if (blocked.has(key)) problems.push(`drive record overlaps recovery at space ${r.space}:${h(at)}`);
    if (original.has(key) && original.get(key) !== word && !(r.space === 0 && at >= hook && at < ret)) {
      problems.push(`drive record overwrites the base at space ${r.space}:${h(at)}`);
    }
    if (written.has(key) && written.get(key) !== word) problems.push(`drive records conflict at space ${r.space}:${h(at)}`);
    written.set(key, word);
  }
  return problems;
}

/**
 * The DSP1 drive for these laws only (and those they require): the dispatcher at `dispatch.base`
 * (per law `sub #1,a` / `jeq body`, then `jmp` back), the bodies after it in `emit` order, each
 * relocated; selectors are the laws' positions in the chain, from 1. Throws naming a law no loaded
 * pack carries, or when the bodies do not fit below `dispatch.limit`.
 */
export function linkDrive(core: Dsp1Core, available: Map<string, Dsp1Law>, wanted: string[], limit?: number,
  program?: [number, number]): DriveLink {
  const need = new Set<string>();
  const add = (n: string, by: string): void => {
    if (need.has(n)) return;
    const l = available.get(n);
    if (!l) throw new Error(`DSP1 drive law ${n} (${by}) is in no loaded pack`);
    need.add(n);
    for (const r of l.requires) add(r, `required by ${n}`);
  };
  for (const w of wanted) add(w, 'asked for');
  const laws = [...need].map((n) => available.get(n)!);
  const chain = [...laws].sort((a, b) => a.rank - b.rank);
  const order = [...laws].sort((a, b) => a.emit - b.emit);
  const D = core.dispatch;
  const origin = program?.[0] ?? D.base;
  const test = wordsLE(fromBase64(D.test));
  const tail = wordsLE(fromBase64(D.tail));
  const top = Math.min(limit ?? D.limit, D.limit, program?.[1] ?? D.limit);
  const bodyWords = order.reduce((n, l) => n + fromBase64(l.words).length / 3, 0);
  // Compact: when the dispatcher and bodies overflow the window, the dispatcher moves into the
  // hook's own dead window (core.head, 17 words at P:$25e): `move y:(r6+$9),a`, then per law
  // `sub #<1,a; jeq body`. Selector 0, and any unknown one, falls through the window's end into the
  // stock DIST stage exactly where the standard hook's `jeq` sends it. Used only when needed, so
  // every selection that fits the standard layout keeps its bytes.
  const hook = core.head.length === 1 ? wordsLE(fromBase64(core.head[0].words)) : [];
  const compact = origin + chain.length * (test.length + 2) + tail.length + bodyWords > top &&
    hook.length === 17 && hook[0] === 0x0226fe && hook[2] === 0x0af0aa && hook[3] === core.head[0].addr + 17 &&
    1 + 3 * chain.length <= 17;
  let at = compact ? origin : origin + chain.length * (test.length + 2) + tail.length;
  const placed = new Map<string, number>();
  for (const l of order) { placed.set(l.name, at); at += fromBase64(l.words).length / 3; }
  if (at > top) throw new Error(`the DSP1 drive bodies end at ${h(at)}, past ${h(top)}`);
  const words: number[] = [];
  if (!compact) {
    for (const l of chain) words.push(...test, D.jump, placed.get(l.name)! + l.entry);
    words.push(...tail);
  }
  const extra: DriveLink['records'] = [];
  for (const l of order) {
    const w = wordsLE(fromBase64(l.words));
    for (const [i, sym, k] of l.relocs) {
      const to = sym === '@org' ? placed.get(l.name)! : placed.get(sym.slice(1));
      const from = sym === '@org' ? l.org : available.get(sym.slice(1))!.org;
      if (to === undefined) throw new Error(`DSP1 law ${l.name} jumps into ${sym.slice(1)}, which is not linked`);
      w[i] = (w[i] + k * (to - from)) & 0xffffff;
    }
    words.push(...w);
    for (const r of l.records) extra.push({ addr: r.addr, space: r.space, words: wordsLE(fromBase64(r.words)) });
  }
  const rec = (r: Dsp1Record): DriveLink['records'][number] => ({ addr: r.addr, space: r.space, words: wordsLE(fromBase64(r.words)) });
  const head = core.head.map(rec);
  if (compact) {
    const w = [0x0226fe];                          // move y:(r6+$9),a   the track's selector
    for (const l of chain) w.push(0x014184, 0x0af0aa, placed.get(l.name)! + l.entry); // sub #<1,a; jeq body
    while (w.length < 17) w.push(0x000000);        // nop up to the window's end: on into stock DIST
    head[0].words = w;
  } else if (origin !== D.base) {
    let jumps = 0;
    for (const r of head) if (r.space === 0) for (let i = 0; i + 1 < r.words.length; i++) {
      if (r.words[i] === 0x0af080 && r.words[i + 1] === D.base) {
        r.words[i + 1] = origin;
        jumps++;
      }
    }
    if (jumps !== 1) throw new Error(`the DSP1 hook has ${jumps} dispatcher jumps; relocation requires exactly one`);
  }
  return {
    selector: Object.fromEntries(chain.map((l, i) => [l.name, i + 1])),
    laws: chain.map((l) => l.name),
    records: [...head, { addr: origin, space: 0, words }, ...extra, ...core.tail.map(rec)],
    words: words.length,
  };
}

/** (machine id, selector) for every machine that opts in. */
export function drivePairs(selector: Record<string, number>, machines: { m: PackModel; id: number }[]): [number, number][] {
  return machines.filter((x) => x.m.dsp1_drive).map((x) => {
    const sel = selector[x.m.dsp1_drive!];
    if (!sel) throw new Error(`${x.m.name}: DSP1 law ${x.m.dsp1_drive} is not linked`);
    return [x.id, sel];
  });
}

/** The transport, placed at `base` in the RAM image: ID -> selector table, per-track cache, code. */
export function dsp1Transport(core: Dsp1Core, base: number, idSpace: number, pairs: [number, number][]): { blob: Uint8Array; entry: number } {
  const tab = new Uint8Array(idSpace);
  for (const [id, sel] of pairs) {
    if (id < 0 || id >= idSpace) throw new Error(`machine ID ${id} is outside the DSP1 ID table (0..${idSpace - 1})`);
    tab[id] = sel;
  }
  const entry = base + idSpace + core.cache_bytes;
  const blob = new Buf().push(tab).fill(0, core.cache_bytes).push(instantiate(core.transport, { base, id_space: idSpace }));
  blob.align(4, 0);
  return { blob: blob.bytes(), entry };
}
