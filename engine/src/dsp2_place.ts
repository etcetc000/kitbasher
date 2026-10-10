// Placing and linking the selected machines in DSP2's free regions: shared tables, each machine's
// code (on a measured cache offset when it has one) and its own tables, the three dispatch words per
// machine, and the P-I clean stub. `plan` (engine/src/plan.ts) runs this for the 1.63-lineage bases;
// the X.20 recipe (engine/src/x20.ts) runs it with the regions its E12 trim frees.

import { h } from './bytes.js';
import { alignOf, alignUp, SECTOR } from './align.js';
import { MODEL_SYMBOLS } from './model_runtime.js';
import { linkCode, words, type PackTable } from './packs.js';
import { PI_CLEAN_MODE, piCleanProgram, piSpanOf, piStubWords, type PiSlices, type PiSpan } from './pi_clean.js';
import type { Selected } from './selection.js';
import { tablePool } from './table_pool.js';

/** What the placement needs to know of the base's DSP2 program. */
export interface Dsp2Target {
  name: string;
  dispatch: { init: number; trigger: number; render: number };
  workspace: { base: number; slice: number };
  bankEnd: number;
  /** the stock P-I machines and their slices; null with the reason the build gives */
  pi: PiSlices | null;
  piWhy?: string;
  /** whether the md-voice/1 runtime is qualified on this base, and why not */
  runtime: { ok: boolean; why?: string };
}

export interface Dsp2Placement {
  key: string; name: string; family: string; id: number; preferred: number;
  org: number; words: number;
  total: number;
  align?: { offset: number; pad: number; sectors: [number, number] };
}

export interface PiCleanPlaced { org: number; words: number; span: PiSpan; ids: number[]; machines: string[]; marks: [number, number][] }

export interface Dsp2Placed {
  capacity: number;
  demand: number;
  free: number;
  overflow: string | null;
  records: [number, number[]][];
  machines: Dsp2Placement[];
  piClean: PiCleanPlaced | null;
}

/**
 * Place `sel` (and the shared tables they want) in `regions`. With `link` the records are filled:
 * (address, words) in upload order, each machine's dispatch words at `dispatch[k] + id + 1`.
 * Problems a user can act on go to `problems`, remarks to `notes`.
 */
export function placeDsp2(T: Dsp2Target, regions: [number, number][], sel: Selected[], shared: PackTable[],
  opt: { link: boolean; align: boolean }, problems: string[], notes: string[]): Dsp2Placed {
  const link = opt.link;
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
  const placed: Record<string, number> = { ws: T.workspace.base, ws_slice: T.workspace.slice };
  // Qualify the interface from its components, not the firmware's version label.
  // P-I geometry is independently discovered below; never infer it from these constants.
  if (sel.some(s => s.m.contract?.components.dsp2?.source)) {
    if (!T.runtime.ok) problems.push(`assembly md-voice/1: runtime ABI not qualified: ${T.runtime.why ?? 'component evidence missing'}`);
    Object.assign(placed, MODEL_SYMBOLS);
  }
  const assemblyPi = sel.filter(s => s.m.contract?.components.dsp2?.source && s.m.workspace_kind === 'pi');
  const assemblyScratch = sel.filter(s => s.m.contract?.components.dsp2?.source && s.m.workspace_kind === 'private');
  if (assemblyScratch.length && (T.workspace.slice !== 2048 || T.workspace.base % 2048 ||
      T.workspace.base + 16 * T.workspace.slice > T.bankEnd))
    problems.push('assembly scratch workspace requires 16 isolated, 2048-word aligned slices inside the carved E12 bank');
  if (assemblyPi.length) {
    if (!T.pi || T.pi.slice !== 1536 || T.pi.ws % 512)
      problems.push('assembly P-I users require discovered 1536-word, 512-aligned track slices');
    else placed.pi_ws = T.pi.ws;
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
  const machines: Dsp2Placement[] = [];
  const tableAlloc = tablePool(alloc);
  let sharedTableWords = 0;
  for (const s of sel) {
    const n = atob(s.m.code.words).length / 3;
    const a = opt.align ? alignOf(s.m, n) : null;
    let org = -1;
    let at: Dsp2Placement['align'];
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
      for (const k of ['init', 'trigger', 'render'] as const) recs.push([T.dispatch[k] + s.id + 1, [org + s.m.code.entry[k]]]);
    }
    machines.push({ key: s.m.key, name: s.m.name, family: s.family, id: s.id, preferred: s.preferred, org, words: n, total, align: at });
  }
  if (sharedTableWords) notes.push(`Shared ${sharedTableWords.toLocaleString('en-US')} identical immutable assembly table words; per-track scratch is never shared`);

  // The P-I clean stub, placed after every machine, only when a selected machine leaves state in
  // its P-I slice.
  let piClean: PiCleanPlaced | null = null;
  const piUsers = sel.filter((s) => s.m.pi_clean);
  if (piUsers.length) {
    const names = piUsers.map((s) => s.m.name.trim());
    const who = `${names.join(', ')} ${names.length === 1 ? 'leaves' : 'leave'} state in the track's P-I slice`;
    const P = T.pi;
    const wrong = P ? piUsers.filter((s) => s.m.pi_clean!.pi_ws !== P.ws || s.m.pi_clean!.pi_slice !== P.slice) : [];
    if (!P) {
      problems.push(`${who}, and the build cannot clear it for the stock P-I machines on ${T.name} ` +
                    `(${T.piWhy ?? 'not discovered'}): leave ${names.length === 1 ? 'it' : 'them'} out`);
    } else if (wrong.length) {
      problems.push(`${wrong.map((s) => s.m.name.trim()).join(', ')}: built for the P-I workspace at ${h(wrong[0].m.pi_clean!.pi_ws)} ` +
                    `(${h(wrong[0].m.pi_clean!.pi_slice)} per track), and ${T.name}'s is at ${h(P.ws)} (${h(P.slice)} per track)`);
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
          const r = recs.filter(([a]) => a === T.dispatch.init + id + 1);
          if (r.length !== 1 || r[0][1].length !== 1) throw new Error(`P-I clean: machine ${id} has ${r.length} init dispatch records`);
          return [id, r[0][1][0]] as [number, number];
        });
        const prog = piCleanProgram(org, P, span, marks);
        recs.push([org, prog.words]);
        P.ids.forEach((id, k) => recs.push([T.dispatch.init + id + 1, [prog.entries[k]]]));
        marks.forEach(([id], j) => { recs.find(([a]) => a === T.dispatch.init + id + 1)![1] = [prog.markEntries[j]]; });
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
  return { capacity, demand, free, overflow, records: recs, machines, piClean };
}
