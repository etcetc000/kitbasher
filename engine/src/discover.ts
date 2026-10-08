// Discovery: where to patch a base, found in the base's own unpacked code on every build.
//
// A base is any OS 1.63-derived build. The engine does not trust a list of addresses for it:
// from the container it unpacks the ColdFire slot, follows the reset code to the OS jump, follows
// that into the base's boot routine and add-on (and any scatter table the add-on unpacks), and
// then finds every site a feature needs by signature (bases/lineage-163.json, engine/src/sig.ts):
// instruction patterns with address operands captured, call sites of routines it found the same
// way, data structures by their shape. Every value it will patch is read here, and the build
// checks it again against the base before writing.
//
// When a signature is missing or matches more than once, the thing it was for is "not supported
// on <base>: <which signature>" and nothing is guessed. A profile (bases/*.json) is an optional
// cache: identification hashes and how far a base has been qualified; its cached addresses are
// compared with what discovery finds, and discovery wins.

import { h, num, sha256, u32 } from './bytes.js';
import type { Firmware } from './container.js';
import { OS_LIMIT } from './container.js';
import { records } from './dsp.js';
import { wordsLE } from './bytes.js';
import { nrv2bDecode } from './nrv2b.js';
import { ctrRangeTests } from './scan.js';
import { bothGates, findControlAllGates, findLoopSkip, gateLine, GATE_NEW, GATE_OLD } from './ctr_controlall.js';
import { findSig, operands, parseSig, reader, type CodeImage, type Hit } from './sig.js';
import type { Base, LineageFile } from './bases.js';
import type { PiSlices } from './pi_clean.js';
import { findSite as findFlushHook, NoIndicator, type Site as FlushSite } from './indicator.js';
import { recoverProblems, ANCHORS } from './recover.js';
import {qualifyModelRuntime} from './model_runtime.js';
import { findUwMenu } from './uw_menu.js';
import { findUnmute, unmuteValues } from './unmute.js';
import { callees, chromaSites, discoverChroma, isTask, NoChroma, type Chroma } from './midi_chroma.js';
import { findPitchLabels, NoPitchLabels, pitchLabelValues, type PitchLabelSite } from './pitch_labels.js';

export interface Finding { what: string; ok: boolean; detail: string }
export interface Support { ok: boolean; why: string }

export interface Discovery {
  /** 'addon': a hidden routine that unpacks an add-on (X.14, DEV); 'hook': a routine that only
   *  continues into the OS (the prepared 1.63 base); 'stock': the OS jump goes straight to the
   *  OS; 'patched': the boot chain already enters something that is not the OS */
  kind: 'addon' | 'hook' | 'stock' | 'patched' | 'unknown';
  lineage: boolean;
  findings: Finding[];
  support: { dynLabels: Support; dsp1Drive: Support; hostSend: Support; descFlash: Support; ramWindow: Support; idFixes: Support; piClean: Support;
             /** the options: --dsp1-recover (its anchors in DSP1/DSP2), --cpu-indicator (the LCD flush hook), --ctr-control-all (its three sites) */
    dsp1Recover: Support; cpuIndicator: Support; ctrControlAll: Support; modelRuntime: Support;
    /** the menu on a Machinedrum without UW: how the base hides ROM and RAM there (engine/src/uw_menu.ts) */
    uwMenu: Support;
    /** the unmute-latency fix: the sequencer sites it replaces (engine/src/unmute.ts) */
    unmuteFix: Support;
    /** --midi-chroma: X.14's real-time MIDI path or OS 1.63's MIDI task (engine/src/midi_chroma.ts) */
    midiChroma: Support;
    /** --pitch-labels: the knob-value painter's string draw (engine/src/pitch_labels.ts) */
    pitchLabels: Support };
  /** the patchable base; null with `refused` saying why */
  base: Base | null;
  refused: string | null;
  /** every discovered value, flat, for comparing with a profile's cache */
  values: Record<string, string>;
}

/** Every feature discovery reports on (Discovery['support']), each once; the compiler checks none is missing. */
export const SUPPORT_KEYS = ['dynLabels', 'dsp1Drive', 'hostSend', 'descFlash', 'ramWindow', 'idFixes', 'piClean', 'dsp1Recover',
  'cpuIndicator', 'ctrControlAll', 'modelRuntime', 'uwMenu', 'unmuteFix', 'midiChroma', 'pitchLabels'] as const satisfies readonly (keyof Discovery['support'])[];
const allSupportKeys: Exclude<keyof Discovery['support'], (typeof SUPPORT_KEYS)[number]> extends never ? true : never = true;
void allSupportKeys;

class NotFound extends Error {}

const DESC_TABLE_IDS = 192;

/** Discover a base. `name`/`id` label it (a profile's, or derived from its tag and hashes). */
export async function discover(fw: Firmware, lin: LineageFile, label: { id: string; name: string }): Promise<Discovery> {
  const findings: Finding[] = [];
  const values: Record<string, string> = {};
  const note = (what: string, ok: boolean, detail: string): void => { findings.push({ what, ok, detail }); };
  const val = (k: string, v: number | number[] | string): void => { values[k] = Array.isArray(v) ? v.map(h).join(',') : typeof v === 'number' ? h(v) : v; };
  const S = lin.signatures;
  const A = lin.anchors;
  const at1 = (k: string, v: number): string => (A[k] === undefined ? '' : num(A[k]) === v ? ' (the 1.63 address)' : ` (1.63 has it at ${A[k]}: moved)`);
  const fail = (kind: Discovery['kind'], why: string): Discovery => ({
    kind, lineage: kind !== 'unknown', findings, values, base: null, refused: why,
    support: Object.fromEntries(SUPPORT_KEYS.map((k) => [k, { ok: false, why }])) as Discovery['support'],
  });
  /** exactly one match, else NotFound naming the signature and the count */
  const one = (name: string, imgs: CodeImage[], sig = S[name]): Hit => {
    const hits = findSig(imgs, parseSig(sig));
    if (hits.length !== 1) {
      throw new NotFound(`signature '${name}' ${hits.length ? `matches ${hits.length} times (${hits.slice(0, 4).map((x) => h(x.at)).join(', ')})` : 'is not found'}`);
    }
    return hits[0];
  };

  // ---- 1. lineage: the reset code, the bootstrap-rewrite guard and its boot-block copy
  const cfBase = num(lin.identify.cf_base);
  const main = fw.slots[0].raw;
  const cfImg: CodeImage = { what: 'ColdFire slot', ram: cfBase, bytes: main };
  let reset: Hit;
  try {
    reset = findSig([{ ...cfImg, bytes: main.subarray(0, 0x40) }], parseSig(S.reset))[0];
    if (!reset) throw new NotFound("signature 'reset' is not at the OS entry");
  } catch (e) {
    return fail('unknown', `not an OS 1.63-lineage ColdFire image: ${(e as Error).message}`);
  }
  const C = reset.caps;
  const sram = { src: C.sram_src.value, dst: C.sram_dst.value, len: C.sram_end.value - C.sram_dst.value };
  const bss: [number, number] = [C.bss.value, C.bss_end.value];
  note('reset code', true, `stack ${h(C.stack.value)}; SRAM copy ${h(sram.src)} -> ${h(sram.dst)} (${sram.len} bytes); BSS ${h(bss[0])}..${h(bss[1])}; OS jump operand at ${h(C.entry.at)} -> ${h(C.entry.value)}`);
  const br = lin.identify.bootstrap_rewrite;
  let bootCopy = 0;
  {
    const o = num(br.at) - cfBase;
    const r = main.slice(o, o + br.length);
    const copyAt = br.copy_operands.map((k) => u32(r, k));
    // every address operand zeroed: the routine is 1.63's whatever the base's code around it moved
    for (const x of operands([{ what: '', ram: num(br.at), bytes: r.slice() }], (v) => v >= cfBase && v < cfBase + main.length)) r.set([0, 0, 0, 0], x.at - num(br.at));
    const copy = copyAt[0] - cfBase;
    bootCopy = copyAt[0];
    const ok = (await sha256(r)) === br.sha256 && copyAt.every((c) => c === copyAt[0]) &&
      (await sha256(main.subarray(copy, copy + lin.identify.boot_block_copy.length))) === lin.identify.boot_block_copy.sha256;
    note('bootstrap-rewrite guard', ok, ok ? `1.63's routine at ${br.at}, its boot-block copy at ${h(copyAt[0])}: both unchanged` : 'the bootstrap-rewrite routine or its boot-block copy differs from 1.63');
    if (!ok) return fail('unknown', 'not an OS 1.63-lineage image: the bootstrap-rewrite routine or its boot-block copy was changed, and the engine never patches a base where that is so');
  }
  if (fw.kind === 'flash') {
    const bb = lin.identify.boot_block;
    const ok = (await sha256(fw.flash.subarray(0, 0x4000))) === bb.sha256 && fw.flash[0x3ffe] === 0x22 && fw.flash[0x3fff] === 0x4b;
    note('boot block', ok, ok ? 'the SPS-1UW boot block; flash[0x3ffe] = 0x224b' : 'the boot block is not the SPS-1UW one, or flash[0x3ffe] is not 0x224b');
    if (!ok) return fail('unknown', 'the flash image\'s boot block is not the one the engine knows (or 0x3ffe is not 0x224b)');
  }
  const osMainAt = (a: number): boolean => findSig([{ ...cfImg, bytes: main.subarray(a - cfBase, a - cfBase + 0x40), ram: a }], parseSig(S.os_main)).some((x) => x.at === a);

  // ---- 2. the boot chain
  const entry = C.entry.value;
  const flash = fw.flash;
  const fimg: CodeImage = { what: 'flash', ram: 0, bytes: flash.subarray(0, OS_LIMIT) };
  let kind: Discovery['kind'];
  let routine = entry;
  let osMain: number;
  let jumpOpcodeAt: number;
  let addon: { operand: number; flash: number; ram: number; init: number } | null = null;
  if (osMainAt(entry)) {
    val('os_main', entry);
    note('boot chain', true, `the OS jump goes straight to the OS at ${h(entry)}: no boot routine, no add-on`);
    return fail('stock', `${label.name} has no boot hook (the OS jump at ${h(C.entry.at)} goes straight to the OS, like stock 1.63): ` +
                'use the prepared 1.63 base (the CLI\'s --prepare-163 makes it from stock 1.63 once)');
  }
  if (entry >= OS_LIMIT) return fail('unknown', `the OS jump names ${h(entry)}, neither the OS nor flash`);
  const win = { ...fimg, bytes: flash.subarray(entry, entry + 0x40), ram: entry };
  const ha = findSig([win], parseSig(S.boot_addon)).find((x) => x.at === entry);
  const hk = findSig([win], parseSig(S.boot_hook)).find((x) => x.at === entry);
  if (ha) {
    kind = 'addon';
    osMain = ha.caps.os_main.value;
    jumpOpcodeAt = ha.caps.os_main.at - 2;
    addon = { operand: ha.caps.addon_flash.at, flash: ha.caps.addon_flash.value, ram: ha.caps.addon_ram.value, init: ha.caps.addon_init.value };
  } else if (hk) {
    kind = 'hook';
    osMain = hk.caps.os_main.value;
    jumpOpcodeAt = hk.caps.os_main.at - 2;
  } else {
    return fail('unknown', `the OS jump enters ${h(entry)} and the code there is not a boot routine the engine knows (signatures 'boot_addon', 'boot_hook')`);
  }
  if (!osMainAt(osMain)) {
    note('boot chain', false, `the routine at ${h(routine)} ends in jmp ${h(osMain)}, which is not the OS entry`);
    return fail('patched', `this OS's boot chain already continues into ${h(osMain)}, not the OS: it was patched before ` +
                '(load the original base; a layout it carries is read back)');
  }
  val('boot.routine', routine); val('boot.jump_operand', jumpOpcodeAt + 2); val('os_main', osMain);
  const cf = fw.slots[0];
  const cfTail = [cf.at + 8 + cf.used, cf.at + 8 + cf.length];
  const d1 = fw.slots[2];
  const afterD1 = d1.at + 8 + d1.length;
  const inCfTail = routine >= cfTail[0] && routine + 0x20 <= cfTail[1];
  const inTail = routine >= afterD1 && routine < fw.osEnd;
  if (!inCfTail && !inTail) return fail(kind, `the boot routine at ${h(routine)} is neither in the ColdFire slot's dead tail nor after the DSP1 slot`);
  note('boot chain', true, `OS jump -> ${kind === 'addon' ? 'hidden routine' : 'hook routine'} at ${h(routine)} ` +
       `(${inCfTail ? "in the ColdFire slot's dead tail" : 'in flash after the container slots'})` +
       (addon ? `: unpacks the add-on at flash ${h(addon.flash)} to ${h(addon.ram)}, calls ${h(addon.init)}` : '') +
       `, then jmp ${h(osMain)}${at1('os_main', osMain)}`);

  // ---- 3. the base's code in RAM: SRAM copy, add-on, scatter entries
  const segs: { what: string; flash: number; used: number; ram: number; bytes: Uint8Array }[] = [];
  const sramImg: CodeImage = { what: 'SRAM', ram: sram.dst, bytes: main.subarray(sram.src - cfBase, sram.src - cfBase + sram.len) };
  let scatter: { table: number; count: number; leaAt: number } | null = null;
  if (addon) {
    if (addon.flash + 8 >= OS_LIMIT) return fail(kind, `the add-on operand names flash ${h(addon.flash)}`);
    let dec;
    try { dec = nrv2bDecode(flash.subarray(addon.flash + 8, OS_LIMIT)); } catch (e) { return fail(kind, `the add-on at ${h(addon.flash)} does not unpack: ${(e as Error).message}`); }
    segs.push({ what: 'add-on', flash: addon.flash, used: 8 + dec.used, ram: addon.ram, bytes: dec.out });
    val('addon.flash', addon.flash); val('addon.ram', addon.ram);
    const sc = findSig([{ what: 'add-on', ram: addon.ram, bytes: dec.out }], parseSig(S.scatter));
    if (sc.length > 1) return fail(kind, `signature 'scatter' matches ${sc.length} times in the add-on`);
    if (sc.length === 1) {
      scatter = { table: sc[0].caps.table.value, count: sc[0].caps.last.value + 1, leaAt: sc[0].caps.table.at };
      for (let k = 0; k < scatter.count; k++) {
        const src = u32(flash, scatter.table + 8 * k);
        const ram = u32(flash, scatter.table + 8 * k + 4);
        if (src < scatter.table || src + 8 >= OS_LIMIT) return fail(kind, `scatter entry ${k} at ${h(src)} is outside the OS area`);
        try {
          const d = nrv2bDecode(flash.subarray(src + 8, OS_LIMIT));
          segs.push({ what: `scatter ${k}`, flash: src, used: 8 + d.used, ram, bytes: d.out });
        } catch (e) { return fail(kind, `scatter entry ${k} at ${h(src)} does not unpack: ${(e as Error).message}`); }
      }
      val('scatter.table', scatter.table); val('scatter.count', scatter.count);
      note('scatter table', true, `the add-on unpacks ${scatter.count} pieces through the table at flash ${h(scatter.table)} (lea at ${h(scatter.leaAt - 2)}): ` +
           segs.slice(1).map((s) => `${h(s.ram)}+${s.bytes.length}`).join(', '));
    }
  }
  // RAM code as it is when the added boot routine runs: the OS, minus what the reset code cleared
  // (the SRAM copy's source is in the BSS), plus SRAM and the base's own pieces
  const cfLive: CodeImage = { ...cfImg, bytes: main.subarray(0, Math.min(main.length, bss[0] - cfBase)) };
  const segImgs: CodeImage[] = segs.map((s) => ({ what: s.what, ram: s.ram, bytes: s.bytes }));
  const images: CodeImage[] = [cfLive, sramImg, ...segImgs];
  const read = reader([cfImg, sramImg, ...segImgs]);
  const r32 = (a: number): number | null => { const b = read(a, 4); return b ? u32(b, 0) : null; };

  // ---- 4. which flash after the DSP1 slot is pinned (named by something the build cannot rewrite)
  const pins: string[] = [];
  if (inTail) pins.push(`the OS jump (inside the packed ColdFire slot) names the boot routine at ${h(routine)}`);
  if (scatter) pins.push(`the add-on names the scatter table at ${h(scatter.table)} and the table holds absolute flash offsets`);
  const flashRefs = operands(segImgs, (v) => v >= afterD1 && v < OS_LIMIT)
    .filter((o) => ((o.op & 0xf1ff) === 0x41f9 || o.op === 0x4879) && !(scatter && o.at === scatter.leaAt));
  if (flashRefs.length) pins.push(`the base's code names flash ${flashRefs.slice(0, 3).map((o) => `${h(o.value)} (at ${h(o.at)})`).join(', ')}`);
  const layout: Base['layout'] = { dsp2Slot: pins.length ? 'keep-end' : 'resize' };
  note('flash layout', true, pins.length
    ? `keep-end: the flash after the DSP1 slot stays where it is (${pins.join('; ')}); DSP2 re-packed into its slot, DSP1 growth taken from DSP2's dead tail`
    : `resize: nothing but the boot routine's add-on operand names the flash after the DSP1 slot, so it may move (the operand follows it)`);
  const freeFlash = OS_LIMIT - ((fw.osEnd + 3) & ~3);
  note('free flash', freeFlash > 0x1000, `container and base code end at ${h(fw.osEnd)}; ${freeFlash} bytes free to ${h(OS_LIMIT)}`);
  val('flash.os_end', fw.osEnd);

  try {
    // ---- 5. OS data structures by shape: the descriptor table, its free descriptor, the family table
    const leas = operands([cfImg], (v) => v >= cfBase && v < cfBase + main.length).filter((o) => (o.op & 0xf1ff) === 0x41f9);
    const counts = new Map<number, number>();
    for (const o of leas) counts.set(o.value, (counts.get(o.value) ?? 0) + 1);
    const dsz = lin.os.descriptor.size;
    const descTables: { at: number; free: number }[] = [];
    for (const [v, n] of counts) {
      if (n < 3) continue;
      const t = v - cfBase;
      if (t + 4 * DESC_TABLE_IDS + 4 > main.length || u32(main, t + 4 * DESC_TABLE_IDS) !== 0) continue;
      const ent = Array.from({ length: DESC_TABLE_IDS }, (_, i) => u32(main, t + 4 * i));
      const freq = new Map<number, number>();
      for (const e of ent) freq.set(e, (freq.get(e) ?? 0) + 1);
      const [free, nf] = [...freq].sort((a, b) => b[1] - a[1])[0];
      if (nf < 16 || read(free + 4, 1)?.[0] !== 0) continue;
      const ok = ent.every((e, id) => e === free || read(e + 4, 1)?.[0] === id);
      if (ok) descTables.push({ at: v, free });
    }
    if (descTables.length !== 1) throw new NotFound(`descriptor table: ${descTables.length} candidates with its shape (192 pointers, each to a descriptor carrying its own ID, then 0)`);
    const { at: descriptorTable, free: freeDescriptor } = descTables[0];
    // the stride of the base's own descriptors in the OS image is the descriptor size
    const own = [...new Set(Array.from({ length: DESC_TABLE_IDS }, (_, i) => u32(main, descriptorTable - cfBase + 4 * i)))]
      .filter((p) => p >= cfBase && p < cfBase + main.length).sort((a, b) => a - b);
    const gaps = own.slice(1).map((p, i) => p - own[i]);
    if (!gaps.includes(dsz) || gaps.some((g) => g % 2)) throw new NotFound(`descriptor size: the OS's descriptors are not ${dsz} bytes apart`);
    const nOwn = Array.from({ length: DESC_TABLE_IDS }, (_, i) => u32(main, descriptorTable - cfBase + 4 * i)).filter((p) => p !== freeDescriptor).length;
    note('descriptor table', true, `${h(descriptorTable)}${at1('descriptor_table', descriptorTable)}: ${nOwn} machines, free ID -> ${h(freeDescriptor)}${at1('free_descriptor', freeDescriptor)}; ${counts.get(descriptorTable)} lea sites in the OS`);
    val('os.descriptor_table', descriptorTable); val('os.free_descriptor', freeDescriptor);
    const descSet = new Set(Array.from({ length: DESC_TABLE_IDS }, (_, i) => u32(main, descriptorTable - cfBase + 4 * i)));
    const isFamilyTable = (f: number): number => {
      let n = 0;
      for (; n < 64; n++) {
        const rec = read(f + 8 * n, 8);
        if (!rec) return 0;
        if (rec[0] === 0) break;
        if (![0, 1, 2, 3].every((k) => rec[k] === 0 || (rec[k] >= 0x20 && rec[k] < 0x7f))) return 0;
        const list = u32(rec, 4);
        for (let k = 0; ; k++) {
          const p = r32(list + 4 * k);
          if (p === null || k > 256) return 0;
          if (p === 0) break;
          if (!descSet.has(p) && p !== freeDescriptor && read(p + 4, 1) === null) return 0;
        }
      }
      return n >= 3 ? n : 0;
    };
    const famCand = [...new Set(operands(images, (v) => v >= cfBase && v < cfBase + main.length).map((o) => o.value))]
      .filter((f) => r32(f + 4) !== null && isFamilyTable(f) > 0 && operands(images, (v) => v === f + 4).length > 0);
    if (famCand.length !== 1) throw new NotFound(`family table: ${famCand.length} candidates with its shape (name + list records, lists of descriptor pointers, a 0 name ending it)`);
    const familyTable = famCand[0];
    const famOps = operands(images, (v) => v === familyTable || v === familyTable + 4);
    const familyBaseSites = famOps.filter((o) => o.value === familyTable).map((o) => o.at);
    const familyListSites = famOps.filter((o) => o.value === familyTable + 4).map((o) => o.at);
    note('family table', true, `${h(familyTable)}${at1('family_table', familyTable)}, ${isFamilyTable(familyTable)} families; named at ${familyBaseSites.map(h).join(', ')}; its lists at ${familyListSites.map(h).join(', ')}`);
    val('os.family_table', familyTable); val('os.family_base_sites', familyBaseSites); val('os.family_list_sites', familyListSites);
    // how a unit without UW hides ROM and RAM, which decides what it shows of our families
    const uw = findUwMenu(images, familyTable);
    note('non-UW menu', uw.menu !== null, uw.why);
    if (uw.menu) { val('os.uw_menu.entry', uw.menu.entry); val('os.uw_menu.callers', uw.menu.callers); val('os.uw_menu.branch', uw.menu.branch); }
    // the sequencer an unmute waits on (engine/src/unmute.ts)
    const um = findUnmute(images);
    note('unmute latency', um.unmute !== null, um.why);
    if (um.unmute) for (const [k, v] of Object.entries(unmuteValues(um.unmute))) val(k, v);
    // the machine IDs of the base's menu family with this name (the descriptor's ID byte at +4)
    const familyMembers = (table: number, name: string): number[] | null => {
      for (let n = 0; n < 256; n++) {
        const rec = read(table + 8 * n, 8);
        if (!rec || rec[0] === 0) return null;
        if (String.fromCharCode(...Array.from(rec.subarray(0, 4)).filter((c) => c)).trim() !== name) continue;
        const ids: number[] = [];
        for (let k = 0; k < 256; k++) {
          const p = r32(u32(rec, 4) + 4 * k);
          if (!p) break;
          const id = read(p + 4, 1);
          if (id) ids.push(id[0]);
        }
        return ids;
      }
      return null;
    };

    // ---- 6. the heap
    const sb = one('sbrk', [cfLive]);
    const heap = { site: sb.caps.ceiling.at, old: sb.caps.ceiling.value };
    const heapStart = sb.caps.heap_start.value;
    note('heap', true, `sbrk's ceiling at ${h(heap.site)}${at1('heap_ceiling', heap.site)} holds ${h(heap.old)}; the break (${h(sb.caps.brk.value)}) starts at ${h(heapStart)}`);
    val('os.heap_ceiling', heap.site); val('os.heap_old', heap.old);

    // ---- 7. the ID-range fixes
    const F = lin.os.id_fixes;
    const idProblems: string[] = [];
    const site = (name: string, cap: string, old: number): number | null => {
      try {
        const x = one(name, [cfLive, ...segImgs]);
        const c = x.caps[cap];
        if (c.value !== old && cap !== 'site') { idProblems.push(`${name}: ${h(c.at)} holds ${h(c.value)}, not ${h(old)}`); return null; }
        return c.at;
      } catch (e) { idProblems.push((e as Error).message); return null; }
    };
    const hd = site('high_defaults', 'site', 0);
    const hdOld = hd === null ? 0 : r32(hd)!;
    if (hd !== null && hdOld !== num(F.high_defaults.old)) idProblems.push(`high_defaults: ${h(hd)} holds ${h(hdOld)}, not ${F.high_defaults.old}`);
    const dl = site('defaults_low', 'site', 0);
    if (dl !== null && r32(dl) !== num(F.ctr_mask.defaults_low.old)) idProblems.push(`defaults_low: ${h(dl)} holds ${h(r32(dl)!)}`);
    let lev: { low: number; jmp2: number; high: number; draw: number } | null = null;
    try {
      const x = one('lev_bar', [cfLive, ...segImgs]);
      const lo = x.caps.low; const j2 = x.caps.jmp2; const hi = x.caps.high;
      if (lo.value !== num(F.lev_bar.low.old) || j2.value !== num(F.lev_bar.ctr.old[1]) || hi.value !== num(F.lev_bar.high.old)) {
        idProblems.push(`lev_bar: ${h(lo.at)} holds ${h(lo.value)} ${h(j2.value)} ${h(hi.value)}`);
      } else {
        const disp = (j2.value >>> 16) & 0xff;                       // bge.b draw, the first arm's exit
        lev = { low: lo.at, jmp2: j2.at, high: hi.at, draw: j2.at + 2 + (disp < 0x80 ? disp : disp - 0x100) };
      }
    } catch (e) { idProblems.push((e as Error).message); }
    let preview: number | null = null;
    try { preview = one('preview', [cfLive, ...segImgs]).caps.site.at; } catch (e) { idProblems.push((e as Error).message); }
    // CTR-range tests: found by following the masked ID; they are the site list
    const ctrFound = new Map<number, string>();
    for (const img of images) for (const [s, w] of ctrRangeTests(img.bytes, img.ram)) ctrFound.set(s, w);
    const ctrSites = [...ctrFound.keys()].sort((a, b) => a - b);
    note('CTR-range tests', ctrSites.length > 0, `${ctrSites.length} in the base's code (${images.map((i) => i.what).join(', ')}): ${ctrSites.map(h).join(' ')}`);
    val('os.ctr_sites', ctrSites);
    // FUNC + knob (control all) on 124..127: a wider test than the CTR-range masks, in the encoder
    // handler, found by its own idiom (engine/src/ctr_controlall.ts).
    const caGates = images.flatMap((img) => findControlAllGates(img.bytes, img.ram));
    const caBoth = bothGates(caGates);
    note('control-all gates (124..127)', caBoth !== null, gateLine(caGates));
    if (caBoth) val('os.ctr_control_all', [caBoth.kind.site, caBoth.encoder.site]);
    const caLoop = images.flatMap((img) => findLoopSkip(img.bytes, img.ram));
    note('control-all per-track skip', caLoop.length === 1,
         caLoop.length === 1 ? `${h(caLoop[0].site)}, ${caLoop[0].old.length} bytes rewritten as one range test`
           : `${caLoop.length} candidates: the pair of skips was not found exactly once`);
    if (caLoop.length === 1) val('os.ctr_loop_skip', caLoop[0].site);
    if (hd !== null) { val('os.high_defaults', hd); note('high defaults (169..175)', true, `${h(hd)}${at1('high_defaults', hd)} holds ${h(hdOld)}`); }
    if (dl !== null) { val('os.defaults_low', dl); note('CTR defaults (124..127)', true, `${h(dl)}${at1('defaults_low', dl)}`); }
    if (lev) { val('os.lev_bar', [lev.low, lev.high, lev.draw]); note('LEV bar', true, `range test at ${h(lev.low)}${at1('lev_bar_low', lev.low)}, high bound ${h(lev.high)}, draw ${h(lev.draw)}`); }
    if (preview !== null) { val('os.preview', preview); note('machine-select preview', true, `ID test at ${h(preview)}${at1('preview', preview)}`); }
    for (const p of idProblems) note('ID-range fix', false, p);
    if (idProblems.length) throw new NotFound(`the ID-range fixes: ${idProblems.join('; ')}`);

    // ---- 8. dynamic knob labels: the knob-turn refresh and the whole-page draw
    let dyn: Base['features']['dynLabels'] = null;
    let dynWhy = '';
    let pageDraw = 0;
    let redrawStub = 0;
    try {
      const k = one('knob_turn', [cfLive]);
      pageDraw = k.caps.page_draw.value;
      const R = k.caps.redraw.value;
      const pageSites = callSitesIn(images, pageDraw);
      const rb = read(R, 6);
      if (!rb) throw new NotFound(`the knob-turn refresh ${h(R)} is not in the base's code`);
      let redraw: NonNullable<Base['features']['dynLabels']>['redraw'];
      if (rb[0] === 0x4e && rb[1] === 0xf9) {
        // the base already redirected it (X.14): chain through what its jmp names
        redraw = { mode: 'stub', sites: [R + 2], old: u32(rb, 2), values: u32(rb, 2) };
        redrawStub = R + 2;
      } else {
        // stock entry: every call of it enters the added trampoline, which ends by entering it
        const calls = callSitesIn(images, R);
        const refs = operands(images, (v) => v === R);
        if (!calls.length || refs.length !== calls.length) throw new NotFound(`the knob-turn refresh ${h(R)} is named ${refs.length - calls.length} times other than by a call`);
        redraw = { mode: 'callers', sites: calls, old: R, values: R };
        redrawStub = R + 2;
      }
      if (!pageSites.length) throw new NotFound(`no call of the page draw ${h(pageDraw)}`);
      dyn = { segment: [0, 0], redraw, pageSites };                  // the segment comes from the RAM window
      note('knob-turn refresh', true, `${h(R)}${at1('redraw', R)}: ${redraw.mode === 'stub' ? `the base's own jmp ${h(redraw.old)} at ${h(R)}, chained` : `${redraw.sites.length} calls (${redraw.sites.map(h).join(', ')}), retargeted`}`);
      note('page draw', true, `${h(pageDraw)}${at1('page_draw', pageDraw)}: ${pageSites.length} jsr/jmp sites`);
      val('dyn.redraw', R); val('dyn.redraw_sites', redraw.sites); val('dyn.page_draw', pageDraw); val('dyn.page_sites', pageSites);
    } catch (e) { if (!(e instanceof NotFound)) throw e; dynWhy = e.message; note('dynamic labels', false, dynWhy); }

    // ---- 9. the DSP1 drive: the ColdFire sender, and the DSP1 chain's dead window
    let dsp1: Base['features']['dsp1Drive'] = null;
    let dsp1Why = '';
    try {
      const x = one('dsp1_sender_call', [{ ...cfImg, bytes: main.subarray(sram.src - cfBase, sram.src - cfBase + sram.len), ram: sram.src }]);
      const sender = x.caps.sender.value;
      const hostWrite = x.caps.host_write.value;
      const osSite = sram.dst + (x.caps.sender.at - sram.src);
      if (sender < sram.dst || sender >= sram.dst + sram.len) throw new NotFound(`the DSP1 sender ${h(sender)} is not in the SRAM copy`);
      // every call of it in the OS as it runs (the ColdFire slot below the BSS and the SRAM copy)
      // and in the base's own pieces: stock 1.63 sends per track from two loops, 0x20ab84 in RAM
      // and the SRAM one; X.14's add-on calls it too
      const senderSites = dsp1SenderSites([cfLive, sramImg], segImgs, sender);
      const osCalls = callSitesIn([cfLive, sramImg], sender);
      if (!osCalls.includes(osSite)) throw new NotFound(`the SRAM sender call ${h(osSite)} is not a jsr`);
      const dw = dsp1Window(fw.slots[2].raw);
      if (typeof dw === 'string') throw new NotFound(dw);
      if (dw.hook !== num(A.dsp1_hook)) throw new NotFound(`the DSP1 dead window is at P:${h(dw.hook)} and the core pack's hook is built for P:${A.dsp1_hook}`);
      dsp1 = { senderSites, sender, hook: dw.hook, ret: dw.ret, program: dw.program };
      note('DSP1 sender', true, `the OS and extension loops call the sender ${h(sender)} at ${senderSites.map(h).join(', ')} (in SRAM ${h(osSite)}${at1('sram_sender_call', osSite)}, copied from ${h(x.caps.sender.at)} at reset)`);
      note('DSP1 chain hook', true, `dead window at P:${h(dw.hook)}, return jmp at P:${h(dw.ret)}, program window P:${h(dw.program[0])}..${h(dw.program[1])} in no upload record`);
      val('dsp1.sender', sender); val('dsp1.sender_sites', senderSites); val('dsp1.host_write', hostWrite); val('dsp1.hook', dw.hook);
      val('dsp1.program', dw.program);
    } catch (e) { if (!(e instanceof NotFound)) throw e; dsp1Why = e.message; note('DSP1 drive', false, dsp1Why); }

    // ---- 9b. the two-word host-command sender, and every reference to its DSP2 entry
    //
    // One routine in the SRAM copy sends a two-word host command and then the data words: a DSP1
    // entry that loads a0 = $500004 and falls into the body, and a DSP2 entry that loads
    // a0 = $600004. Every ColdFire -> DSP2 host command in the render path comes from the DSP2
    // entry. The body raises CVR (HC | HV=$09) before it writes the command's second word, so
    // DSP2's HV=$09 handler at P:$e8..$f3 spins on HSR RXDF until the ColdFire gets there;
    // --host-reorder puts a reordered copy of the routine in the RAM image and repoints every
    // reference to the DSP2 entry at it. The signature is all-literal, so a base whose sender
    // differs by one byte does not match and the feature is refused rather than guessed.
    let hostSend: Base['features']['hostSend'] = null;
    let hostWhy = '';
    try {
      const nb = parseSig(S.host_send).bytes.length;
      const x = one('host_send', [sramImg]);
      const dsp2Entry = x.caps.dsp2_entry.at;
      const dsp1Entry = x.caps.dsp1_entry.at;
      const refs = operands(images, (v) => v === dsp2Entry);
      // the forms the lineage's callers use: jsr/pea abs.l, lea abs.l,An
      const bad = refs.filter((o) => ![0x4eb9, 0x4879].includes(o.op) && (o.op & 0xf1ff) !== 0x41f9);
      if (bad.length) throw new NotFound(`the DSP2 host-send entry ${h(dsp2Entry)} is named by an opcode the engine does not know at ${bad.map((o) => h(o.at)).join(', ')}`);
      if (!refs.length) throw new NotFound(`nothing names the DSP2 host-send entry ${h(dsp2Entry)}`);
      const sites = refs.map((o) => o.at);
      const dsp2Bytes = nb - (dsp2Entry - x.at);
      hostSend = { entry: dsp2Entry, dsp1Entry, sites, body: x.at, bytes: dsp2Bytes, cvrAt: x.caps.cvr.at, word2At: x.caps.word2.at, tailAt: x.caps.tail.at };
      note('host-command sender', true, `${h(dsp2Entry)}${at1('host_send_dsp2', dsp2Entry)} (DSP2, ${dsp2Bytes} bytes to its rts) and ` +
        `${h(dsp1Entry)}${at1('host_send_dsp1', dsp1Entry)} (DSP1) share one body, stock byte for byte over all ${nb} bytes; ` +
        `the CVR write is at ${h(x.caps.cvr.at + 2)}, ahead of the second word at ${h(x.caps.word2.at)}; the DSP2 entry is named at ${sites.map(h).join(', ')} ` +
        `(${refs.filter((o) => o.op === 0x4eb9).length} jsr, ${refs.filter((o) => (o.op & 0xf1ff) === 0x41f9).length} lea), in ${[...new Set(refs.map((o) => o.image))].join(', ')}`);
      val('host_send.dsp2', dsp2Entry); val('host_send.dsp1', dsp1Entry); val('host_send.sites', sites);
    } catch (e) { if (!(e instanceof NotFound)) throw e; hostWhy = e.message; note('host-command sender', false, hostWhy); }

    // ---- 9c. the LCD flush's diff (--cpu-indicator, engine/src/indicator.ts): exactly once over
    //      every image of the base's code, and in the ColdFire slot
    let lcdFlush: FlushSite | null = null;
    let lcdWhy = '';
    try {
      lcdFlush = findFlushHook(main, cfBase, [sramImg, ...segImgs]);
      note('LCD flush (--cpu-indicator)', true, `the diff's move.l ${h(lcdFlush.prev)},d5 at ${h(lcdFlush.site)} in the flush ${h(lcdFlush.flush)} ` +
           `(frame pointers next ${h(lcdFlush.next)} / prev ${h(lcdFlush.prev)}, swap at ${h(lcdFlush.swap)}); ` +
           `the Timer 1 install's handler immediate at ${h(lcdFlush.timerOperand)} (${h(lcdFlush.timerHandler)}, installer ${h(lcdFlush.timerInstall)}), ` +
           `its TRAP #0 store ${lcdFlush.trapOperand === null ? 'absent' : `at ${h(lcdFlush.trapOperand)}`}; each once in the base's code`);
      val('lcd.flush_hook', lcdFlush.site); val('lcd.flush', lcdFlush.flush); val('lcd.frames', [lcdFlush.next, lcdFlush.prev]);
      val('lcd.timer', [lcdFlush.timerOperand, lcdFlush.timerHandler, lcdFlush.timerInstall]);
      if (lcdFlush.trapOperand !== null) val('lcd.trap', lcdFlush.trapOperand);
    } catch (e) { if (!(e instanceof NoIndicator)) throw e; lcdWhy = e.message; note('LCD flush (--cpu-indicator)', false, lcdWhy); }

    // ---- 9d. MIDI chromatic note input (--midi-chroma, engine/src/midi_chroma.ts): X.14's real-time
    //      MIDI path, every hook site and the OS code the lock path relies on, byte for byte; else
    //      OS 1.63's MIDI task, every site and routine by signature
    let midiChroma: Chroma | null = null;
    let chromaWhy = '';
    try {
      midiChroma = discoverChroma(images, S);
      if (isTask(midiChroma)) {
        const C = midiChroma;
        note('MIDI chromatic input (--midi-chroma)', true, `OS 1.63's MIDI task: its channel test at ${h(C.filter.site)}${at1('midi_task_filter', C.filter.site)} ` +
             `(queue ${h(C.midiQueue)}, filled by the UART parser ${h(C.parser)}), the note-on handler ${h(C.noteOn)}${at1('note_on', C.noteOn)} and CC handler ` +
             `${h(C.ccHandler)} from its dispatch table ${h(C.table)}, the live-record call at ${h(C.recSite.site)} and the UI loop's queue-count call's ` +
             `operand at ${h(C.idle.site)}; the recorder, lock writer, popup and grid state from the OS's own paths, by signature`);
        val('midi_chroma.sites', chromaSites(C));
        val('midi_chroma.calls', callees(C));
        val('midi_chroma.data', [C.baseCh, C.selTrack, C.machineIds, C.kitParams, C.livePattern, C.trigHi, C.uiQueue, C.uiPattern, C.gridMode, C.held, C.knobTouched]);
      } else {
        note('MIDI chromatic input (--midi-chroma)', true, `the parser's base-range test at ${h(midiChroma.parser.site)}, the real-time note-on call at ` +
             `${h(midiChroma.consumer.site)}, the live-record call at ${h(midiChroma.recSite.site)} and the UI idle call's operand at ${h(midiChroma.idle.site)}, ` +
             `with ${Object.keys(midiChroma.anchors).length} anchors in the OS, byte for byte`);
        val('midi_chroma.sites', chromaSites(midiChroma));
      }
    } catch (e) { if (!(e instanceof NoChroma)) throw e; chromaWhy = e.message; note('MIDI chromatic input (--midi-chroma)', false, chromaWhy); }

    // ---- 9e. pitch note names (--pitch-labels, engine/src/pitch_labels.ts): the knob-value painter's
    //      string draw, and the page, track, machine IDs and kit values it reads, by signature
    let pitchLabels: PitchLabelSite | null = null;
    let labelsWhy = '';
    try {
      pitchLabels = findPitchLabels(images);
      const P = pitchLabels;
      note('pitch note names (--pitch-labels)', true, `the knob-value painter ${h(P.painter)}: its value's string draw at ${h(P.call)} (operand ${h(P.site)}) ` +
           `calls the OS's ${h(P.draw)}, after the width ${h(P.width)} in the font ${h(P.font)}; page ${h(P.page)}, track ${h(P.track)}, machine IDs ${h(P.machineIds)}, ` +
           `kit values ${h(P.kitParams)}`);
      for (const [k, v] of Object.entries(pitchLabelValues(P))) val(k, v);
    } catch (e) { if (!(e instanceof NoPitchLabels)) throw e; labelsWhy = e.message; note('pitch note names (--pitch-labels)', false, labelsWhy); }

    // ---- 10. descriptors in flash: the OS reads its own container through the flash alias
    let alias: number | null = null;
    let aliasWhy = '';
    try {
      // the OS's init (the first call of the OS entry) sets chip select 0, the flash, to its base
      const init = u32(main, osMain - cfBase + 2);
      const x = one('flash_alias', [{ ...cfImg, ram: init, bytes: main.subarray(init - cfBase, init - cfBase + 0x100) }]);
      const a = (x.caps.csar.value << 16) >>> 0;
      const size = ((x.caps.csmr.value | 0xffff) >>> 0) + 1;
      if (!a || size < OS_LIMIT) throw new NotFound(`flash alias: chip select 0 is set to ${h(a)} for ${size} bytes`);
      alias = a;
      note('flash alias', true, `the OS's init (${h(init)}) maps chip select 0, the flash, at ${h(a)} (${size >>> 20} MiB)${at1('flash_alias', a)}: descriptors there are read as flash`);
      val('flash.alias', a);
    } catch (e) { if (!(e instanceof NotFound)) throw e; aliasWhy = e.message; note('descriptors in flash', false, aliasWhy); }

    // ---- 11. DSP2: the lineage's anchors, verified by shape; the base's own boot-time writes
    const D2 = lin.dsp2;
    const dsp2 = dsp2Check(fw.slots[1].raw, D2);
    if (typeof dsp2 === 'string') throw new NotFound(dsp2);
    note('DSP2 upload', true, dsp2.detail);
    let freeRegions: [number, number][] = D2.free_regions.map((r) => [num(r[0]), num(r[1])] as [number, number]);
    const taken = dsp2Writes(segImgs, hostWrite(images, sram) ?? 0, freeRegions);
    if (taken.unknown) {
      note('DSP2 base writes', false, `${taken.unknown}: its free region is left out`);
      freeRegions = freeRegions.slice(1);
    } else if (taken.ranges.length) {
      for (const [a, b] of taken.ranges) freeRegions = freeRegions.flatMap(([lo, hi]) => (b <= lo || a >= hi ? [[lo, hi]] : [[lo, Math.max(lo, a)], [Math.min(hi, b), hi]].filter(([p, q]) => q > p)) as [number, number][]);
      note('DSP2 base writes', true, `the base writes DSP2 at boot: ${taken.ranges.map(([a, b]) => `P:${h(a)}..${h(b - 1)}`).join(', ')} (${taken.how})`);
    } else {
      note('DSP2 base writes', true, 'the base writes no DSP2 memory of its own');
    }
    val('dsp2.free_regions', freeRegions.flat());

    // ---- 11c. --dsp1-recover: the base's DSP1 and DSP2 code the handler is written against
    //      (engine/src/recover.ts ANCHORS), word for word, and its window free
    const recWhy = recoverProblems(wordsLE(fw.slots[2].raw), wordsLE(fw.slots[1].raw), taken.ranges);
    note('DSP1 recover anchors (--dsp1-recover)', recWhy.length === 0, recWhy.length ? recWhy.join('; ')
      : `the DMA0 watchdog (trip count 3) under the vector P:$18; ${ANCHORS.map((a) => `DSP${a.dsp} P:${h(a.at)}..${h(a.at + a.words.length - 1)}`).join(', ')} ` +
        `word for word; the handler's window free; X:$642 named by nothing`);

    // ---- 11b. the stock P-I machines' inits and the slices they address (the P-I clean stub)
    let pi: PiSlices | null = null;
    let piWhy = '';
    try {
      if (!D2.pi) throw new NotFound('the lineage file has no dsp2.pi');
      const members = familyMembers(familyTable, D2.pi.family);
      if (!members) throw new NotFound(`no menu family named ${D2.pi.family} in the base's family table`);
      const r = piSlices(fw.slots[1].raw, D2, members);
      pi = r.pi;
      note('P-I slices', true, `the ${D2.pi.family} family's ${pi.ids.length} machines (IDs ${pi.ids.join(', ')}): inits ${pi.inits.map(h).join(', ')}; ` +
           `${r.found.length} of them address the slices (${r.found.join(', ')}): workspace ${h(pi.ws)}, ${h(pi.slice)} words per track, the track at Y:${h(pi.track)}` +
           (r.others.length ? `; other inits that name the P-I workspace too (not routed): IDs ${r.others.join(', ')}` : '; no other init names it'));
      val('dsp2.pi_ids', pi.ids); val('dsp2.pi_inits', pi.inits); val('dsp2.pi_ws', pi.ws); val('dsp2.pi_slice', pi.slice); val('dsp2.pi_track', pi.track);
    } catch (e) { if (!(e instanceof NotFound)) throw e; piWhy = e.message; note('P-I slices', false, piWhy); }

    // ---- 12. the ColdFire RAM window: free by the base's own code and boot
    const W = lin.ram.window;
    const env: [number, number][] = [[num(W.image[0]), num(W.image[1])], [num(W.labels[0]), num(W.labels[1])]];
    const peak = num(lin.ram.heap_peak);
    const occupants: [number, number, string][] = segs.filter((s) => s.ram >= heapStart).map((s) => [s.ram, s.ram + s.bytes.length, s.what] as [number, number, string]);
    const refs = operands(images, (v) => v >= heapStart && v < C.stack.value && v !== heapStart && v !== heap.old);
    const lowRef = refs.reduce<Operand1 | null>((m, o) => (!m || o.value < m.value ? { value: o.value, at: o.at } : m), null);
    const lowest = Math.min(C.stack.value, ...occupants.map((o) => o[0]), lowRef?.value ?? Infinity);
    const bad = env.filter(([a, b]) => a < Math.max(peak, heapStart) || b > lowest);
    let ramWhy = '';
    if (bad.length) {
      ramWhy = `the RAM window ${bad.map(([a, b]) => `${h(a)}..${h(b)}`).join(', ')} is not free on this base: ` +
               `the heap peaks at ${h(peak)}, and its code or pieces start at ${h(lowest)}` + (lowRef && lowRef.value === lowest ? ` (named at ${h(lowRef.at)})` : '');
      note('RAM window', false, ramWhy);
    } else {
      note('RAM window', true, `${env.map(([a, b]) => `${h(a)}..${h(b)}`).join(' + ')}: above the heap (starts ${h(heapStart)}, measured peak ${h(peak)}), ` +
           `below the base's lowest RAM use ${h(lowest)}${lowest === C.stack.value ? ' (the stack top: nothing of the base above the heap)' : occupants.find((o) => o[0] === lowest) ? ` (${occupants.find((o) => o[0] === lowest)![2]})` : ''}; no code of the base names an address in it`);
    }
    val('ram.window', env.flat());

    // ---- the base
    const fx = lin.os.id_fixes;
    const range = (v: string[]): [number, number] => [num(v[0]), num(v[1])];
    const dyn2 = dyn && !ramWhy ? { ...dyn, segment: env[1] } : null;
    const base: Base = {
      id: label.id, name: label.name,
      qualified: false, qualification: { level: 'discovered', by: 'discovery only: no profile names this base', profile: null },
      identify: { tag: fw.tag, coldfire_sha256: '', dsp2_sha256: '', dsp1_sha256: '' },
      boot: {
        kind: kind as 'addon' | 'hook', routine, jumpOperand: jumpOpcodeAt + 2, jumpOpcodeAt,
        addonOperand: addon?.operand ?? null, addonFlash: addon?.flash ?? null, addonRam: addon?.ram ?? null, addonInit: addon?.init ?? null,
        scatter: scatter ? { table: scatter.table, count: scatter.count } : null,
        sram, bss, entry: C.entry.at, inCfTail, bootCopy: [bootCopy, bootCopy + lin.identify.boot_block_copy.length],
      },
      layout,
      ext: { base: env[0][0], end: env[0][1] },
      features: { dynLabels: dyn2, dsp1Drive: dsp1, hostSend, descFlash: alias === null ? null : { alias }, lcdFlush, unmute: dyn2 ? um.unmute : null, midiChroma, pitchLabels },
      os: {
        cfBase, osMain, descriptorTable, freeDescriptor, descriptorSize: dsz,
        familyTable, familyBaseSites, familyListSites, uwMenu: uw.menu, pageDraw, redrawStub,
        heap, heapStart,
        deadIds: [num(lin.os.dead_ids.from), num(lin.os.dead_ids.to)],
        highDefaults: { ids: range(fx.high_defaults.ids), site: hd!, old: hdOld, new: num(fx.high_defaults.new) },
        ctrMask: { ids: range(fx.ctr_mask.ids), sites: ctrSites, old: num(fx.ctr_mask.old), new: num(fx.ctr_mask.new),
                   defaultsLow: { site: dl!, old: num(fx.ctr_mask.defaults_low.old), new: num(fx.ctr_mask.defaults_low.new) } },
        ctrControlAll: caBoth
          ? { ids: range(fx.ctr_mask.ids), sites: [caBoth.kind.site, caBoth.encoder.site],
              old: GATE_OLD, new: GATE_NEW } : null,
        ctrLoopSkip: caLoop.length === 1 ? caLoop[0] : null,
        levBar: {
          low: { ids: range(fx.lev_bar.low.ids), site: lev!.low, old: num(fx.lev_bar.low.old), new: num(fx.lev_bar.low.new) },
          high: { ids: range(fx.lev_bar.high.ids), site: lev!.high, old: num(fx.lev_bar.high.old), new: num(fx.lev_bar.high.new) },
          ctr: { ids: range(fx.lev_bar.ctr.ids), jmpSites: [lev!.low, lev!.jmp2], old: fx.lev_bar.ctr.old.map(num), resume: lev!.jmp2 + 4, draw: lev!.draw },
        },
        menu: { nameBytes: lin.os.menu.name_bytes, nameShown: lin.os.menu.name_shown, charset: lin.os.menu.charset,
                maxFamilies: lin.os.menu.max_families, maxPerList: lin.os.menu.max_per_list },
        preview: { ids: fx.preview.ids.map(range), site: preview!, old: read(preview!, 48)!.slice(), new: hexBytes(fx.preview.new) },
      },
      dsp2: {
        bankRecord: num(D2.bank_record), e12Table: num(D2.e12_table), e12Count: D2.e12_count, bankEnd: num(D2.bank_end),
        freeRegions, workspace: { base: num(D2.workspace.base), slice: num(D2.workspace.slice) },
        dispatch: { init: num(D2.dispatch.init), trigger: num(D2.dispatch.trigger), render: num(D2.dispatch.render) },
        pi,
        bootWrites:{known:!taken.unknown,ranges:taken.ranges},
      },
      segments: segs,
      support: {} as Base['support'],
      findings,
    };
    base.modelRuntime=await qualifyModelRuntime(fw,base,lin.modelRuntimes??[]);
    note('model runtime',base.modelRuntime.ok,base.modelRuntime.why);
    const support: Discovery['support'] = {
      modelRuntime:{ok:base.modelRuntime.ok,why:base.modelRuntime.why},
      unmuteFix: !um.unmute ? { ok: false, why: `the sequencer it is written against was not found: ${um.why}` }
        : !dyn2 ? { ok: false, why: `its routines go in the label segment's RAM range, which this base does not have: ${dynWhy || ramWhy || 'no RAM for the label segment'}` }
        : { ok: true, why: `discovered: ${um.why}` },
      uwMenu: uw.menu ? { ok: true, why: `discovered: ${uw.why}` } : { ok: false, why: `${uw.why}: on a Machinedrum without UW the menu hides the last two added categories and shows ROM and RAM` },
      idFixes: { ok: true, why: `discovered: ${ctrSites.length} CTR-range tests, high defaults, LEV bar, preview` },
      ramWindow: ramWhy ? { ok: false, why: ramWhy } : { ok: true, why: `discovered free: ${env.map(([a, b]) => `${h(a)}..${h(b)}`).join(' + ')}` },
      dynLabels: dyn2 ? { ok: true, why: `discovered: ${dyn2.redraw.mode === 'stub' ? 'the base\'s refresh stub' : `${dyn2.redraw.sites.length} refresh calls`}, ${dyn2.pageSites.length} page-draw sites` }
                      : { ok: false, why: dynWhy || ramWhy || 'no RAM for the label segment' },
      dsp1Drive: dsp1 ? { ok: true, why: `discovered: ${dsp1.senderSites.length} sender site${dsp1.senderSites.length > 1 ? 's' : ''}, the DSP1 dead window at P:${A.dsp1_hook}` } : { ok: false, why: dsp1Why },
      hostSend: hostSend ? { ok: true, why: `discovered: the DSP2 host-send entry ${h(hostSend.entry)}, ${hostSend.sites.length} reference${hostSend.sites.length > 1 ? 's' : ''} to it` } : { ok: false, why: hostWhy },
      descFlash: alias !== null ? { ok: true, why: `discovered: the flash alias ${h(alias)}` } : { ok: false, why: aliasWhy },
      piClean: pi ? { ok: true, why: `discovered: ${pi.ids.length} stock P-I inits, slices of ${h(pi.slice)} at ${h(pi.ws)}` } : { ok: false, why: piWhy },
      dsp1Recover: recWhy.length ? { ok: false, why: recWhy.join('; ') }
        : { ok: true, why: `discovered: the DMA0 watchdog and vector, ${ANCHORS.length} anchors word for word, the handler's window free` },
      cpuIndicator: lcdFlush ? { ok: true, why: `discovered: the LCD flush's diff at ${h(lcdFlush.site)}, the Timer 1 handler immediate at ${h(lcdFlush.timerOperand)}${lcdFlush.trapOperand === null ? '' : ` and TRAP #0's at ${h(lcdFlush.trapOperand)}`} (needs --dsp1-recover and dynamic labels)` }
        : { ok: false, why: lcdWhy },
      ctrControlAll: caBoth && caLoop.length === 1
        ? { ok: true, why: `discovered: control-all masks at ${h(caBoth.kind.site)}, ${h(caBoth.encoder.site)} and the per-track skip at ${h(caLoop[0].site)}` }
        : { ok: false, why: `control-all gates: ${gateLine(caGates)}; per-track skip: ${caLoop.length} candidates (one needed)` },
      midiChroma: midiChroma && isTask(midiChroma)
        ? { ok: true, why: `discovered: OS 1.63's MIDI task (channel test ${h(midiChroma.filter.site)}, note-on ${h(midiChroma.noteOn)}, CC ${h(midiChroma.ccHandler)}), by signature` }
        : midiChroma ? { ok: true, why: `discovered: X.14's real-time MIDI path (parser ${h(midiChroma.parser.site)}, note-on call ${h(midiChroma.consumer.site)}), byte for byte` }
        : { ok: false, why: chromaWhy },
      pitchLabels: pitchLabels ? { ok: true, why: `discovered: the knob-value painter's string draw at ${h(pitchLabels.call)}, by signature` }
        : { ok: false, why: labelsWhy },
    };
    base.support = support;
    return { kind, lineage: true, findings, support, base, refused: ramWhy ? `no ColdFire RAM for the machines: ${ramWhy}` : null, values };
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    note('discovery', false, e.message);
    return fail(kind, `not supported on ${label.name}: ${e.message}`);
  }
}

interface Operand1 { value: number; at: number }

function hexBytes(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));
}

/**
 * Every jsr/jmp abs.l of the DSP1 sender in the OS and the base's own pieces (X.14's add-on calls
 * it directly). A piece that loads the sender as an immediate (move.l #sender,Dn) runs a loop of
 * its own the drive cannot hook, so the drive is refused there rather than half-applied.
 */
export function dsp1SenderSites(os:CodeImage[],extensions:CodeImage[],sender:number):number[] {
  const own=operands(extensions,v=>v===sender).filter(o=>(o.op&0xf1ff)===0x203c);
  if(own.length) throw new NotFound(`the base's own code loads the DSP1 sender ${h(sender)} as an immediate at ${own.map(o=>h(o.at)).join(', ')}`);
  return callSitesIn([...os,...extensions],sender);
}

/** Operand address of every jsr/jmp abs.l <target> in the images. */
export function callSitesIn(images: CodeImage[], target: number): number[] {
  return operands(images, (v) => v === target).filter((o) => o.op === 0x4eb9 || o.op === 0x4ef9).map((o) => o.at);
}

/** The host-write routine's address: what the OS's DSP1 sender call site passes through (in SRAM). */
function hostWrite(images: CodeImage[], sram: { src: number; dst: number; len: number }): number | null {
  const s = images.find((i) => i.what === 'SRAM');
  if (!s) return null;
  void sram;
  const x = findSig([s], parseSig('4eb9 <host_write> 4292 4fef000c 2f03 4eb9 <sender> 588f'));
  return x.length === 1 ? x[0].caps.host_write.value : null;
}

/**
 * DSP2 memory the base's own code writes at boot through the host-write routine: in each routine
 * of the base's pieces that loads the routine's address, the P addresses it adds (in the free
 * regions) and the word counts it bounds its loop by. `unknown` when a piece loads the routine
 * and the bounds cannot be read.
 */
function dsp2Writes(segs: CodeImage[], hw: number, regions: [number, number][]): { ranges: [number, number][]; how: string; unknown: string | null } {
  if (!hw) return { ranges: [], how: '', unknown: 'DSP host-write routine was not identified' };
  const loads = operands(segs, (v) => v === hw);
  if (!loads.length) return { ranges: [], how: '', unknown: null };
  const inFree = (v: number): boolean => regions.some(([a, b]) => v >= (a & ~0xff) && v < b);   // a region's page: a base write may start just below it
  const ranges: [number, number][] = [];
  const how: string[] = [];
  const seen = new Set<number>();
  for (const l of loads) {
    const img = segs.find((s) => s.what === l.image)!;
    const lo = Math.max(0, l.at - img.ram - 0x40);
    const hi = Math.min(img.bytes.length, l.at - img.ram + 0x100);
    const win: CodeImage = { what: img.what, ram: img.ram + lo, bytes: img.bytes.subarray(lo, hi) };
    const all = operands([win], () => true);
    const bases = all.filter((o) => (o.op & 0xfff8) === 0x0680 && inFree(o.value)).map((o) => o.value);
    if (!bases.length) continue;
    // a count: a move.l #n, or a cmpi.l #n bounding a loop (n itself for blo/blt/bhs/bge, n + 1 for bls/ble/bhi/bgt)
    const after = (o: { at: number }): number => win.bytes[o.at - win.ram + 4] ?? 0;
    const counts = all.filter((o) => ((o.op & 0xf1ff) === 0x203c || (o.op & 0xfff8) === 0x0c80) && o.value > 0 && o.value < 0x10000)
      .map((o) => ((o.op & 0xfff8) !== 0x0c80 ? o.value : [0x65, 0x6d, 0x64, 0x6c].includes(after(o)) ? o.value : o.value + 1));
    if (!counts.length) return { ranges: [], how: '', unknown: `a routine near ${h(l.at)} writes DSP2 at ${h(bases[0])} and its length could not be read` };
    const n = Math.max(...counts.filter((c) => c <= 0x4000));
    const b0 = Math.min(...bases);
    if (seen.has(b0)) continue;
    seen.add(b0);
    ranges.push([b0, b0 + n]);
    how.push(`from ${l.image} ${h(l.at - 2)}: ${n} words`);
  }
  return { ranges, how: how.join('; '), unknown: null };
}

/** The DSP1 upload's per-track dead window: do #$20 over fifteen nops, then the return jmp. */
export function dsp1Window(raw: Uint8Array): { hook: number; ret: number; program: [number, number] } | string {
  const w = wordsLE(raw);
  const { recs } = records(w);
  const mem = new Map<number, number>();
  for (const r of recs) if (r.tag === 0) for (let i = 0; i < r.count; i++) mem.set(r.addr + i, w[r.index + 3 + i]);
  const found: number[] = [];
  for (const [a, v] of mem) {
    if (v !== 0x062080 || mem.get(a + 1) !== a + 0x10) continue;
    let ok = true;
    for (let i = 2; i < 0x11; i++) if (mem.get(a + i) !== 0) { ok = false; break; }
    if (ok && ((mem.get(a + 0x11) ?? 0) & 0xffff00) === 0x0c0000) found.push(a);
  }
  if (found.length !== 1) return `the DSP1 dead window (do #$20 over fifteen nops, then jmp): ${found.length} in the DSP1 upload`;
  // Stay inside the established internal-RAM window. Newer bases may occupy part
  // of it; absence from an upload does not qualify any additional address range.
  const free: [number, number][] = [];
  for (let a = 0xa08; a < 0xc00;) {
    if (mem.has(a)) { a++; continue; }
    const lo = a;
    while (a < 0xc00 && !mem.has(a)) a++;
    free.push([lo, a]);
  }
  free.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]) || a[0] - b[0]);
  if (!free.length) return 'the DSP1 upload occupies the entire drive program window P:0xa08..0xc00';
  return { hook: found[0], ret: found[0] + 0x11, program: free[0] };
}

/** The DSP2 upload's P memory as it loads (later records win). */
export function dsp2Mem(raw: Uint8Array): Map<number, number> {
  const w = wordsLE(raw);
  const { recs } = records(w);
  const mem = new Map<number, number>();
  for (const r of recs) if (r.tag === 0) for (let i = 0; i < r.count; i++) mem.set(r.addr + i, w[r.index + 3 + i]);
  return mem;
}

/**
 * The stock P-I machines' inits (their dispatch words; each a routine in the upload, not the
 * silence stub) and the slice geometry their code names (lineage dsp2.pi.init_signature).
 */
function piSlices(raw: Uint8Array, D: LineageFile['dsp2'], members: number[]): { pi: PiSlices; found: number[]; others: number[] } {
  const P = D.pi!;
  const mem = dsp2Mem(raw);
  const init = num(D.dispatch.init);
  const words = Array.from({ length: 193 }, (_, i) => mem.get(init + i));
  const freq = new Map<number, number>();
  for (const v of words) if (v !== undefined) freq.set(v, (freq.get(v) ?? 0) + 1);
  const stub = [...freq].sort((a, b) => b[1] - a[1])[0][0];
  const ids = [...members].sort((a, b) => a - b);
  if (!ids.length) throw new NotFound(`the ${P.family} family has no machines`);
  const inits = ids.map((id) => {
    const t = words[id + 1];
    if (t === undefined || t === stub || !mem.has(t)) throw new NotFound(`${P.family} ID ${id}: its init word ${t === undefined ? 'is not in the upload' : `${h(t)} is ${t === stub ? 'the silence stub' : 'not in the upload'}`}`);
    return t;
  });
  const tok = P.init_signature.trim().split(/\s+/);
  const match = (t: number): Record<string, number> | null => {
    for (let o = 0; o + tok.length <= P.window; o++) {
      const caps: Record<string, number> = {};
      if (tok.every((x, i) => {
        const v = mem.get(t + o + i);
        if (v === undefined) return false;
        if (x.startsWith('<')) { caps[x.slice(1, -1)] = v; return true; }
        return v === parseInt(x, 16);
      })) return caps;
    }
    return null;
  };
  const hits = ids.map((id, k) => [id, match(inits[k])] as const).filter(([, c]) => c);
  if (!hits.length) throw new NotFound(`no ${P.family} init names the P-I workspace (${P.init_signature})`);
  const [, c0] = hits[0];
  const differ = hits.filter(([, c]) => c!.pi_ws !== c0!.pi_ws || c!.track !== c0!.track || c!.half !== c0!.half);
  if (differ.length) throw new NotFound(`the ${P.family} inits disagree on the P-I workspace: ID ${hits[0][0]} and ID ${differ[0][0]}`);
  const others = words.map((t, i) => [i - 1, t] as const)
    .filter(([id, t]) => id >= 0 && !ids.includes(id) && t !== undefined && t !== stub && mem.has(t) && match(t)?.pi_ws === c0!.pi_ws).map(([id]) => id);
  return { pi: { ids, inits, ws: c0!.pi_ws, slice: 2 * c0!.half, track: c0!.track }, found: hits.map(([id]) => id), others };
}

/** The DSP2 upload's E12 table and dispatch tables where the lineage has them, by shape. */
function dsp2Check(raw: Uint8Array, D: LineageFile['dsp2']): { detail: string } | string {
  const w = wordsLE(raw);
  const { recs } = records(w);
  const mem = new Map<number, number>();
  for (const r of recs) if (r.tag === 0) for (let i = 0; i < r.count; i++) mem.set(r.addr + i, w[r.index + 3 + i]);
  const t = num(D.e12_table);
  const n = D.e12_count;
  const bankEnd = num(D.bank_end);
  let prev = t + 3 * n - 1;
  for (let i = 0; i < n; i++) {
    const s = mem.get(t + 3 * i), l = mem.get(t + 3 * i + 1), z = mem.get(t + 3 * i + 2);
    if (s === undefined || l === undefined || z !== 0 || s <= prev || s >= bankEnd) return `DSP2: the E12 table at ${D.e12_table} does not have its shape (entry ${i})`;
    prev = s;
  }
  const disp = [D.dispatch.init, D.dispatch.trigger, D.dispatch.render].map(num);
  for (const d of disp) {
    const tab = Array.from({ length: 193 }, (_, i) => mem.get(d + i));
    if (tab.some((v) => v === undefined)) return `DSP2: the dispatch table at ${h(d)} is not in the upload`;
    const freq = new Map<number, number>();
    for (const v of tab) freq.set(v!, (freq.get(v!) ?? 0) + 1);
    const [stub, k] = [...freq].sort((a, b) => b[1] - a[1])[0];
    if (k < 64 || stub < 0x100000 || stub >= 0x100200) return `DSP2: the dispatch table at ${h(d)} has no silence stub on the free IDs`;
  }
  return { detail: `E12 table at ${D.e12_table} (${n} samples, ascending, inside the bank), dispatch tables at ${disp.map(h).join(', ')} (193 words, silence stub on the free IDs)` };
}
