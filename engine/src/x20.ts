// Building on MDX X.20 B (bases/x20.json, engine/src/x20_recipe.ts).
//
// X.20's loader streams its OS through the DSPs and gets the ColdFire image back, so the build never
// sees the OS: it works on the loader's stage image and the E12B sample bank only.
//   1. E12B: the INTERNAL samples trimmed (the 1.63-lineage rule), re-encoded; the DSP2 words and
//      flash they free hold the machines.
//   2. DSP2: the selected machines placed and linked into the freed bank and X.20's free gap; their
//      dispatch words in both X.20 dispatch tables (the stock 193-entry ones and the relocated 211-entry
//      ones its runtime reads).
//   3. The machines' code goes into DSP2 before DSP2's own loader runs (a receiver sent through the
//      bootstrap's ELD); the dispatch words go after DSP2 starts, through the OS's own block write.
//   4. ColdFire: the recipe's sites (record table, menu, stack, new-machine list, hooks) written by
//      an applier once the loader has decoded the OS; the routines they call ride in the stage image.
//   5. The stage image re-packed into slot 0, the payload, list and bank in E12B flash: a .syx.
// Gates (all hard failures): the file is X.20 B by hash; every ColdFire instruction the build adds,
// at its own addresses or at an OS site, decodes as ISA_A (isa.ts); the DSP boot code holds no cache
// instruction (they trap on hardware with the cache off); every site's new bytes are as long as its anchor.

import { be32, concat, h, sha256, sum32, u32 } from './bytes.js';
import { readBank, buildBank, freeFlash, E12B_FLASH, E12B_END } from './e12b.js';
import { placeDsp2, type Dsp2Target } from './dsp2_place.js';
import { decodeLinear, scanCode, type CodeMem, type Insn } from './isa.js';
import { nrv2bDecode } from './nrv2b.js';
import type { CorePack, Pack, PackModel } from './packs.js';
import { needsUwSamples } from './packs.js';
import { select, type Selected } from './selection.js';
import { decodeSyx, encodeSyx, OS_START } from './syx.js';
import { uclPack } from './ucl.js';
import { cacheOpsIn, dsp2BootLoader, isCode, siteBytes, stageCode, windowA, writeList, x20Map } from './x20_cf.js';
import { parseRecipe, type X20Recipe, type X20RecipeFile } from './x20_recipe.js';
import { fromBase64 } from './bytes.js';

export interface X20Options {
  /** a Machinedrum with the UW option (machines on 128 and up, and the UW-sample machines, need it) */
  uw: boolean;
  families?: string[];
  exclude?: string[];
  /** the E12 trim: samples quieter than `db` below their peak at the end are cut (after `minSeconds`), at most `cap` seconds kept */
  trim: { db: number; minSeconds: number; cap: number | null };
  align?: boolean;
  /**
   * How the machines' code reaches DSP2. 'preboot' (the default, the one real hardware runs): through DSP2's
   * bootstrap before its loader and runtime start. 'upload': all of it after DSP2 starts, through the OS's
   * block write -- for the emulator only (its DSP JIT does not see code written through X space before it
   * runs); on hardware a big upload there makes the OS miss DSP2's startup messages.
   */
  dsp2Load?: 'preboot' | 'upload';
}

export interface X20Report {
  base: string;
  machines: { name: string; key: string; id: number; family: string; org: string; words: number }[];
  e12: { bank_end: string; words: number; stock_words: number; freed_words: number; flash_end: string; trimmed: number };
  dsp2: { capacity: number; demand: number; free: number };
  flash: { chunks_pre: [string, number][]; chunks_post: [string, number][]; list: string; free_left: number };
  stage: { boot_code: string; window: string; packed: number; room: number };
  gates: { name: string; ok: boolean; detail: string }[];
  notes: string[];
}

const SR = 44100, FADE = 256, LEN_EXTRA = 34;
const RAW_MAX_DEFAULT = 0x2b000;

/** The E12 trim (the 1.63-lineage rule, on X.20's decoded samples): per entry the new 12-bit samples. */
export function trimX20(samples: (number[] | null)[], pairs: [number, number][], opt: X20Options['trim']): { out: (number[] | null)[]; trimmed: number } {
  const thr = 10 ** (opt.db / 20);
  const sgn = (v: number): number => (v >= 2048 ? v - 4096 : v);
  const xs = samples.map((s) => {
    if (!s) return null;
    if (s.length < LEN_EXTRA || s.slice(s.length - LEN_EXTRA).some((v) => v !== 0)) throw new Error('E12B: an entry without its silent tail');
    return s.slice(0, s.length - LEN_EXTRA).map(sgn);
  });
  const keeps = xs.map((x) => {
    if (!x) return 0;
    const n = x.length;
    let keep = n;
    if (n / SR >= opt.minSeconds) {
      const limit = Math.max(...x.map(Math.abs)) * thr;
      let q = n;
      for (let k = n - 1; k >= 0; k--) { if (Math.abs(x[k]) < limit) q = k; else break; }
      if (q < n) keep = Math.min(n, q + FADE);
      if (opt.cap) keep = Math.min(keep, Math.max(Math.floor(opt.cap * SR), FADE));
    }
    return keep;
  });
  const wo = (k: number): number => (k + 1) >> 1;
  const padTo = xs.map(() => 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const [a, b] of pairs) {
      if (xs[a] && xs[b] && keeps[a] < xs[a]!.length && wo(keeps[b]) > wo(keeps[a])) { keeps[b] = keeps[a]; changed = true; }
    }
  }
  for (const [a, b] of pairs) if (xs[a] && xs[b] && wo(keeps[b]) > wo(Math.max(keeps[a], padTo[a]))) padTo[a] = 2 * wo(keeps[b]);
  const rhe = (v: number): number => { const f = Math.floor(v), d = v - f; return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f; };
  let trimmed = 0;
  const out = xs.map((x, i) => {
    if (!x) return null;
    const n = x.length, keep = keeps[i];
    let y = x;
    if (!(keep >= n && padTo[i] <= n)) {
      trimmed++;
      y = x.slice(0, keep);
      if (keep < n) {
        const f = Math.min(FADE, keep), step = -1 / f;
        for (let k = 0; k < f; k++) { const j = keep - f + k; y[j] = rhe(y[j] * (k * step + 1)); }
      }
      while (y.length < padTo[i]) y.push(0);
      if (y.length % 2) y.push(0);
    }
    return [...y.map((v) => v & 0xfff), ...new Array(LEN_EXTRA).fill(0)];
  });
  return { out, trimmed };
}

/** X.20's menu family for a model: the recipe's per-pack map, its per-key-prefix map, else its default. */
function menuFamily(R: X20Recipe, s: Selected): number {
  const byKey = R.file.key_menu ?? {};
  const pref = Object.keys(byKey).find((p) => s.m.key.startsWith(p));
  const name = pref ? byKey[pref] : (R.file.pack_menu ?? {})[s.family] ?? (R.file.pack_menu ?? {})['*'] ?? 'GND';
  const f = R.families[name];
  if (f === undefined) throw new Error(`recipe ${R.id}: no menu family ${name}`);
  return f;
}

/** IDs bottom-up from the recipe's usable list (without UW: below 128 only), in catalog order. */
function allocate(R: X20Recipe, models: { m: PackModel; family: string }[], uw: boolean): { sel: Selected[]; problems: string[] } {
  const free = R.usable.filter((id) => uw || id < 128);
  const problems: string[] = [];
  const sel: Selected[] = [];
  for (const { m, family } of models) {
    const id = free.shift();
    if (id === undefined) { problems.push(`no free machine ID left on ${R.name} for ${m.name.trim()}: untick a machine`); continue; }
    sel.push({ m, family, id, preferred: m.id, mapped: false });
  }
  return { sel, problems };
}

/** A list entry (X.20's new-machine list format, 60 bytes): ID, name, knob labels, defaults, label mask. */
function listEntry(s: Selected): Uint8Array {
  const e = new Uint8Array(60);
  e[0] = s.id;
  const name = s.m.name.slice(0, 5).padEnd(5);
  for (let k = 0; k < 5; k++) e[1 + k] = name.charCodeAt(k) & 0xff;
  let mask = 0;
  s.m.labels.forEach((l, i) => {
    if (!l) return;
    for (let k = 0; k < Math.min(4, l.length); k++) e[7 + 5 * i + k] = l.charCodeAt(k) & 0xff;
    mask |= 1 << (28 - 4 * i);
  });
  s.m.defaults.forEach((v, i) => { e[0x2f + i] = v & 0x7f; });
  e.set(be32(mask >>> 0), 0x38);
  return e;
}

function blocks(mem: Map<number, number>): [number, number[]][] {
  const out: [number, number[]][] = [];
  for (const a of [...mem.keys()].sort((x, y) => x - y)) {
    const last = out[out.length - 1];
    if (last && a === last[0] + last[1].length) last[1].push(mem.get(a)!);
    else out.push([a, [mem.get(a)!]]);
  }
  return out;
}

const chunkRaw = (blks: [number, number[]][]): Uint8Array =>
  concat(blks.flatMap(([a, ws]) => [be32(a), be32(ws.length), Uint8Array.from(ws.flatMap((w) => [(w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff]))]));

/** NRV2B chunks of whole (sub)blocks, raw <= rawMax, laid into the flash spans from `cursor` on. */
async function chunks(blks: [number, number[]][], spans: [number, number][], rawMax: number): Promise<{ at: number; packed: Uint8Array }[]> {
  const words: [number, number][] = blks.flatMap(([a, ws]) => ws.map((w, k) => [a + k, w] as [number, number]));
  const out: { at: number; packed: Uint8Array }[] = [];
  let i = 0, si = 0, cur = spans.length ? spans[0][0] : 0;
  while (i < words.length) {
    if (si >= spans.length) throw new Error(`the machines' code does not fit the flash the E12 trim frees: ${words.length - i} words left; trim harder or untick a machine`);
    const room = spans[si][1] - cur;
    let n = Math.min(words.length - i, Math.floor(rawMax / 3) - 64);
    let pk: Uint8Array;
    for (;;) {
      let raw = chunkRaw(blocks(new Map(words.slice(i, i + n))));
      while (raw.length > rawMax) { n = Math.floor(n * 0.95); raw = chunkRaw(blocks(new Map(words.slice(i, i + n)))); }
      pk = await uclPack(raw, 10);
      if (nrv2bDecode(pk).out.length !== raw.length) throw new Error('NRV2B round trip');
      if (pk.length <= room || n < 256) break;
      n = Math.floor(n * Math.min(0.97, room / pk.length));
    }
    if (pk.length > room) { si++; if (si < spans.length) cur = spans[si][0]; continue; }
    out.push({ at: cur, packed: pk });
    cur = (cur + pk.length + 1) & ~1;
    spans[si] = [cur, spans[si][1]];
    i += n;
  }
  return out;
}

/** ISA_A over everything the build adds to the ColdFire: our routines from their entries, and every OS site's code bytes. */
export function x20IsaGate(mem: CodeMem[], entries: number[], ours: (a: number) => boolean, siteCode: { at: number; bytes: Uint8Array }[]): { insns: number; rejects: Insn[] } {
  const r = scanCode(mem, entries, ours);
  const rejects = [...r.rejects];
  let insns = r.insns.size;
  for (const s of siteCode) {
    const d = decodeLinear(s.bytes, s.at);
    insns += d.length;
    rejects.push(...d.filter((i) => !i.ok));
    const end = d.reduce((n, i) => n + i.len, 0);
    if (end !== s.bytes.length) rejects.push({ at: s.at, len: s.bytes.length, name: 'site', ok: false, why: `site bytes do not end on an instruction (${end} of ${s.bytes.length})` } as Insn);
  }
  return { insns, rejects };
}

export async function buildX20(input: Uint8Array, recipeFile: X20RecipeFile, packs: Pack[], core: CorePack, opt: X20Options): Promise<{ output: Uint8Array; report: X20Report }> {
  const R = parseRecipe(recipeFile);
  if (await sha256(input) !== R.file.identify.syx_sha256) throw new Error(`not ${R.name} (the .syx hash differs): this recipe patches that exact file only`);
  const notes: string[] = [];
  const gates: X20Report['gates'] = [];
  const container = decodeSyx(input);
  if (container.length !== R.file.identify.container_bytes) throw new Error(`${R.name}: container is ${container.length} bytes, expected ${R.file.identify.container_bytes}`);
  const cont = Uint8Array.from(container);
  const at = (flash: number): number => flash - OS_START;

  // ---- 1. E12B
  const areaOff = at(E12B_FLASH);
  const area = cont.subarray(areaOff, areaOff + (E12B_END - E12B_FLASH));
  const bank0 = readBank(area);
  const { out: trimmed, trimmed: nTrim } = trimX20(bank0.samples, R.e12.pairs, opt.trim);
  const bank = buildBank(trimmed, bank0.names);
  const dataStart = R.e12.table + 3 * R.e12.count;
  const bankEnd = dataStart + bank.words;
  const stockWords = R.e12.bankEnd - dataStart;
  if (bankEnd > R.e12.bankEnd) throw new Error('E12: the re-encoded bank is longer than the stock one');

  // ---- 2. machines: selection, IDs, DSP2 placement
  const { fams, shared } = select(packs, { families: opt.families, exclude: opt.exclude });
  let models = fams.flatMap((f) => f.models.map((m) => ({ m, family: f.name })));
  if (!opt.uw) {
    const out = models.filter(({ m }) => needsUwSamples(m));
    if (out.length) notes.push(`left out (they play UW samples): ${out.map(({ m }) => m.name.trim()).join(', ')}`);
    models = models.filter(({ m }) => !needsUwSamples(m));
  }
  const problems: string[] = [];
  const { sel, problems: idProblems } = allocate(R, models, opt.uw);
  problems.push(...idProblems);
  const D = R.dsp2;
  const T: Dsp2Target = { name: R.name, dispatch: D.dispatch, workspace: D.workspace, bankEnd: R.e12.bankEnd, pi: D.pi,
    runtime: { ok: true } };
  const workspace = sel.some((s) => s.m.workspace);
  const firstEnd = workspace ? D.workspace.base : R.e12.bankEnd;
  if (workspace && bankEnd > D.workspace.base) problems.push(`the machines' per-track workspace starts at ${h(D.workspace.base)} and the E12 bank ends at ${h(bankEnd)}: trim harder`);
  const regions: [number, number][] = [[bankEnd, firstEnd], ...D.free];
  const placed = placeDsp2(T, regions, sel, shared, { link: true, align: opt.align ?? false }, problems, notes);
  if (problems.length) throw new Error(problems.join('\n'));

  // ---- 3. DSP2 payload: code before DSP2 starts, dispatch words after
  const mem = new Map<number, number>();
  const dispatchSpan = (t: { init: number; trigger: number; render: number }, k: 'init' | 'trigger' | 'render', a: number): boolean =>
    a > t[k] && a <= t[k] + D.dispatch.entries;
  for (const [a, ws] of placed.records) ws.forEach((w, k) => mem.set(a + k, w));
  for (const [a, w] of [...mem]) {
    for (const k of ['init', 'trigger', 'render'] as const) {
      if (dispatchSpan(D.dispatch, k, a)) mem.set(D.relocated[k] + (a - D.dispatch[k]), w);
    }
  }
  mem.set(D.usrBankEnd, bankEnd);                       // the user machines' SAMPLE_INFO: where the INTERNAL bank ends
  const inRegions = (a: number): boolean => regions.some(([lo, hi]) => a >= lo && a < hi);
  for (const a of mem.keys()) {
    const ok = inRegions(a) || a === D.usrBankEnd ||
      (['init', 'trigger', 'render'] as const).some((k) => dispatchSpan(D.dispatch, k, a) || (a > D.relocated[k] && a <= D.relocated[k] + D.relocated.entries));
    if (!ok) throw new Error(`DSP2 write at ${h(a)} outside the machines' regions and the dispatch tables`);
  }
  const all = blocks(mem);
  const boot = dsp2BootLoader(R);
  for (const [which, words, ops] of [['receiver', boot.receiver, boot.opcodes.receiver], ['wiper', boot.wiper.words, boot.opcodes.wiper]] as const) {
    const bad = cacheOpsIn([...words], ops);
    gates.push({ name: `DSP boot code (${which}): no cache instruction`, ok: !bad.length, detail: bad.length ? `cache instruction at word ${bad.join(', ')}` : `${words.length} words` });
    if (bad.length) throw new Error(`DSP boot code (${which}) holds a cache instruction: it traps on hardware with the cache off`);
  }
  const upload = opt.dsp2Load === 'upload';
  if (upload) notes.push('DSP2 load: upload after DSP2 starts (emulator only; not for hardware)');
  const pre: [number, number[]][] = upload ? [] : [[boot.wiper.addr, boot.wiper.words], ...all.filter(([a]) => inRegions(a))];
  const post = upload ? all : all.filter(([a]) => !inRegions(a));
  for (const [a, ws] of pre) if (a < boot.wiper.addr + boot.wiper.words.length && boot.wiper.addr < a + ws.length && a !== boot.wiper.addr)
    throw new Error('a machine overlaps the boot loader\'s wiper');

  // ---- flash: chunks, then our list entries, in the flash the bank frees
  const spans = freeFlash(bank).map(([a, b]) => [a, b] as [number, number]);
  const rawMax = Math.min(RAW_MAX_DEFAULT, R.ram.uploadBuffer[1] - R.ram.uploadBuffer[0]);
  const preC = await chunks(pre, spans, rawMax);
  const postC = await chunks(post, spans, rawMax);
  const list = concat(sel.map(listEntry));
  const li = spans.findIndex(([a, b]) => b - ((a + 3) & ~3) >= list.length);
  if (li < 0) throw new Error('no flash left for the new-machine list');
  const listFlash = (spans[li][0] + 3) & ~3;
  spans[li] = [listFlash + list.length, spans[li][1]];
  // the bank (free flash erased), then the chunks and the list in its free flash
  cont.set(bank.area.subarray(0, E12B_END - E12B_FLASH), areaOff);
  for (const c of [...preC, ...postC]) cont.set(c.packed, at(c.at));
  cont.set(list, at(listFlash));

  // ---- 4. ColdFire: window A, the OS writes, the stage code
  const M = x20Map(R, sel.length, bankEnd);
  const ours = new Map(sel.map((s) => [s.id, menuFamily(R, s)] as [number, number]));
  const wa = windowA(R, M, ours, fromBase64(core.knob_callback), listFlash);
  if (wa.asm.bytes.length + R.ram.window[0] > R.ram.window[1]) throw new Error('window A overflows');
  const names: Record<string, number> = { STACK: M.stack, RECS: M.recs, CAP: M.cap, MENU: M.menu, M_U: M.mU, M_L: M.mL,
    LIST: M.list, LIST_N: M.listN, BANK_END: bankEnd, HTAB: wa.htab };
  const writes: [number, Uint8Array][] = [];
  const siteCode: { at: number; bytes: Uint8Array }[] = [];
  for (const s of R.sites) {
    const b = siteBytes(s.value, names, wa.asm.labels);
    if (b.length !== s.old.length) throw new Error(`recipe site ${h(s.at)} (${s.what}): ${b.length} bytes for a ${s.old.length}-byte anchor`);
    writes.push([s.at, b]);
    if (isCode(s.value)) siteCode.push({ at: s.at, bytes: b });
  }
  const st = stageCode(R, writeList(writes), preC.map((c) => R.flashAlias + c.at), postC.map((c) => R.flashAlias + c.at), wa, boot.receiver);

  // ---- gate: ISA_A over everything the ColdFire runs that the build adds
  const entries = [st.asm.labels.APPLIER, st.asm.labels.DSP2PRE, ...['VALID', 'FAM', 'CLS', 'GUARD', 'ERGUARD', 'COPYLIST', 'USRCHKREC', 'USRINSMENU', 'USRREM'].map((n) => wa.asm.labels[n])];
  const codeMem: CodeMem[] = [{ what: 'boot code', ram: R.ram.bootCode[0], bytes: st.asm.bytes }, { what: 'window A', ram: R.ram.window[0], bytes: wa.asm.bytes }];
  const inOurs = (a: number): boolean => codeMem.some((m) => a >= m.ram && a < m.ram + m.bytes.length);
  const isa = x20IsaGate(codeMem, entries, inOurs, [...siteCode, ...st.sites.map((s) => ({ at: s.at, bytes: s.bytes }))]);
  gates.push({ name: 'ISA_A (MCF5206e): routines, OS sites and loader sites', ok: !isa.rejects.length,
    detail: `${isa.insns} instructions${isa.rejects.length ? '; ' + isa.rejects.map((i) => `${h(i.at)} ${i.name}: ${i.why}`).join('; ') : ''}` });
  if (isa.rejects.length) throw new Error(`ISA_A gate: ${isa.rejects.map((i) => `${h(i.at)} ${i.name}: ${i.why}`).join('; ')}`);

  // ---- 5. stage image and slot 0
  const L = R.loader;
  const n0 = u32(cont, 0);
  const slot = cont.slice(8, 8 + n0);
  const s0 = nrv2bDecode(slot).out;
  if (await sha256(s0) !== R.file.identify.stage_sha256) throw new Error(`${R.name}: the loader's stage image is not the one the recipe knows`);
  if (s0.length !== L.header + L.stage2Bytes) throw new Error('stage image length');
  if (u32(s0, L.copyLongsAt) !== L.copyLongs) throw new Error('stage 1 copy count');
  const off = (ram: number): number => L.header + ram - L.stage2;
  const img = new Uint8Array(off(R.ram.window[0]) + wa.asm.bytes.length + 16);
  img.set(s0);
  for (const s of st.sites) {
    const o = off(s.at), old = Array.from(img.subarray(o, o + s.bytes.length), (b) => b.toString(16).padStart(2, '0')).join('');
    if (old !== s.old) throw new Error(`loader site ${h(s.at)} (${s.what}): ${old}, expected ${s.old}`);
    img.set(s.bytes, o);
  }
  img.set(st.asm.bytes, off(R.ram.bootCode[0]));
  img.set(wa.asm.bytes, off(R.ram.window[0]));
  let len = off(R.ram.window[0]) + wa.asm.bytes.length;
  while ((len - L.header) % 16) len++;
  const stage = img.slice(0, len);
  stage.set(be32((len - L.header) / 4), L.copyLongsAt);
  const packed = await uclPack(stage, 10);
  const back = nrv2bDecode(packed).out;
  if (back.length !== stage.length || back.some((b, k) => b !== stage[k])) throw new Error('stage image NRV2B round trip');
  const room = L.payloadFlash - L.slot0Flash;
  if (packed.length > room) throw new Error(`the re-packed stage image is ${packed.length} bytes, ${room} fit before the loader's payload`);
  const newSlot = concat([packed, new Uint8Array(room - packed.length).fill(0xff), slot.subarray(room)]);
  cont.set(be32(n0), 0);
  cont.set(be32(sum32(newSlot)), 4);
  cont.set(newSlot, 8);
  const output = encodeSyx(cont);
  if (decodeSyx(output).some((b, k) => b !== cont[k])) throw new Error('.syx round trip');

  const used = [...preC, ...postC].reduce((n, c) => n + c.packed.length, 0) + list.length;
  const report: X20Report = {
    base: R.id,
    machines: placed.machines.map((m) => ({ name: m.name.trim(), key: m.key, id: m.id, family: m.family, org: h(m.org), words: m.total })),
    e12: { bank_end: h(bankEnd), words: bank.words, stock_words: stockWords, freed_words: R.e12.bankEnd - bankEnd,
      flash_end: h(E12B_FLASH + (bank.used - 1) * 0x10000 + bank.end), trimmed: nTrim },
    dsp2: { capacity: placed.capacity, demand: placed.demand, free: placed.free },
    flash: { chunks_pre: preC.map((c) => [h(c.at), c.packed.length]), chunks_post: postC.map((c) => [h(c.at), c.packed.length]), list: h(listFlash),
      free_left: spans.reduce((n, [a, b]) => n + Math.max(0, b - a), 0) },
    stage: { boot_code: `${h(R.ram.bootCode[0])}..${h(R.ram.bootCode[0] + st.asm.bytes.length)}`, window: `${h(R.ram.window[0])}..${h(R.ram.window[0] + wa.asm.bytes.length)}`,
      packed: packed.length, room },
    gates, notes: [...notes, `${used} bytes of E12B flash used for the machines`],
  };
  return { output, report };
}
