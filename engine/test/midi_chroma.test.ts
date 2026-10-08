import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { be32, concat, hex, sha256, u32 } from '../src/bytes.js';
import { codeImages, NotPatchable, resolveBase, type Base, type Resolved } from '../src/bases.js';
import { readFirmware } from '../src/container.js';
import { decodeLinear } from '../src/isa.js';
import { loadBases } from '../src/node.js';
import type { CorePack, Pack, PackModel } from '../src/packs.js';
import { noteToRaw, type Pitch } from '../src/pitch.js';
import { prepare163 } from '../src/prepare.js';
import { Cpu } from './cf_interp.js';
import { ramImage, IND_EXT_SPAN, MIDI_CHROMA_CHANNEL } from '../src/plan.js';
import type { Selected } from '../src/selection.js';
import { findSig, parseSig, type CodeImage } from '../src/sig.js';
import {
  assemble, buildTable, channelByte, checkChromaCode, chromaPatches, chromaRanges, findChroma, lawOf, lookup, NoChroma,
  ARMED, IDLE, RING, X14_CHROMA as S, X14_CHROMA as X14, findChromaTask, discoverChroma, chromaRewritten, chromaSites, callees, TASK_SIGNATURES,
  type Chroma, type ChromaTask, type ChromaModel, type ChromaTable,
} from '../src/midi_chroma.js';

const packs: Pack[] = readdirSync('catalog').filter((f) => f.endsWith('.json') && f !== 'core.json')
  .map((f) => JSON.parse(readFileSync(`catalog/${f}`, 'utf8')) as Pack);
const models: PackModel[] = packs.flatMap((p) => p.models);
const QUARTER: Pitch = { knob: 0, law: 'quarter', steps: 2, base_note: 24 };
const stops = (n: number): number[] => Array.from({ length: 128 }, (_, r) => Math.floor((r * n) / 128));
// synthetic: an absolute model, a zoned one (narrow ranges and a 'none' stop), a relative one,
// one with no note law, one with no pitch knob, a chromatic one on knob 4 and one without metadata
const SYN: ChromaModel[] = [
  { id: 11, name: 'QUART', pitch: QUARTER },
  { id: 164, name: 'ZONED', pitch: { ...QUARTER, mode_knob: 2, by_mode: [{ zone: 0, base_note: -5, range: [58, 127] }, { zone: 1, base_note: 3, range: [42, 127] }, { zone: 3, law: 'none' }] },
    dyn_labels: [{ knob: 2, stop_of: stops(4) }] },
  { id: 171, name: 'RELAT', pitch: { knob: 0, law: 'relative', steps: 1, center: 64 } },
  { id: 40, name: 'NONE', pitch: { knob: 0, law: 'none' } },
  { id: 84, name: 'NOKNB', pitch: { knob: null, law: 'none' } },
  { id: 90, name: 'CHRM', pitch: { knob: 3, law: 'chromatic', steps: 1, base_note: 0, range: [0, 120] } },
  { id: 7, name: 'PLAIN' },
];

test('the pitch rule: raw = 2 (MIDI - 24), C3 = MIDI 60 = raw 72, clamped to the law\'s range', () => {
  const t = buildTable([{ id: 5, name: 'Q', pitch: QUARTER }]);
  const raw = (n: number): number | undefined => lookup(t, 5, n)?.raw;
  assert.equal(raw(60), 72);
  assert.equal(raw(24), 0);
  assert.equal(raw(61), 74);
  assert.equal(raw(87), 126);
  assert.equal(raw(88), 127);
  assert.equal(raw(23), 0);
  assert.equal(raw(127), 127);
  assert.deepEqual(lawOf(QUARTER), [48, 2, 0, 127]);
});

test('note -> PTCH table: every catalog model and every note agree with engine/src/pitch.ts noteToRaw', () => {
  let checked = 0;
  for (const m of [...models.filter((x) => x.pitch).map((x, i) => ({ id: i, name: x.name, pitch: x.pitch, dyn_labels: x.dyn_labels })), ...SYN.map((x, i) => ({ ...x, id: 200 + i }))]) {
    const t = buildTable([m]);
    const p = m.pitch;
    const dyn = p?.by_mode ? m.dyn_labels?.find((d) => d.knob === p.mode_knob) : undefined;
    for (let mode = 0; mode < 128; mode += p?.by_mode ? 1 : 128) {
      const zone = dyn ? dyn.stop_of[mode] : undefined;
      for (let n = 0; n < 128; n++) {
        const got = lookup(t, m.id, n, mode);
        let want: { knob: number; raw: number } | null = null;
        if (p && p.knob !== null) {
          const law = (zone === undefined ? p : { ...p, ...p.by_mode?.find((r) => r.zone === zone) }).law;
          if (law === 'quarter' || law === 'chromatic') want = { knob: p.knob, raw: noteToRaw(n, p, zone).raw };
        }
        assert.deepEqual(got, want, `${m.name} MODE raw ${mode} note ${n}`);
        if (want) checked++;
      }
    }
  }
  assert.ok(checked > 20 * 128, `${checked} note -> raw values checked`);
});

test('which models play notes: quarter and chromatic laws only, by_mode zones through the MODE stops', () => {
  const t = buildTable(SYN);
  const kind = Object.fromEntries(t.perModel.map((p) => [p.name, p.kind]));
  assert.equal(kind.QUART, 'quarter');
  assert.equal(kind.ZONED, 'quarter, 3 MODE segments');
  assert.match(kind.RELAT, /^trigger only \(relative law\)/);
  assert.match(kind.NONE, /^trigger only/);
  assert.match(kind.NOKNB, /^trigger only \(no pitch knob\)/);
  assert.match(kind.PLAIN, /^trigger only \(no pitch metadata\)/);
  assert.equal(kind.CHRM, 'chromatic');
  // the plain IDs first (knob 0, the first law), 0xff; then the full entries sorted by ID, 0xff
  assert.deepEqual(Array.from(t.table.subarray(0, 2)), [11, 0xff]);
  assert.equal(t.table.at(-1), 0xff);
  assert.deepEqual(lookup(t, 164, 60, 100), null);                         // MODE stop 3: law none, trigger only
  assert.deepEqual(lookup(t, 164, 30, 0), { knob: 0, raw: 70 });           // stop 0: base -5, clamped up to 58..
  assert.deepEqual(lookup(t, 164, 20, 0), { knob: 0, raw: 58 });
  assert.deepEqual(lookup(t, 90, 60), { knob: 3, raw: 60 });
  assert.equal(lookup(t, 171, 60), null);
  // a by_mode model whose pack carries no MODE stops for the knob is trigger only, not an error
  const bare = buildTable([{ id: 3, name: 'BARE', pitch: SYN[1].pitch }]);
  assert.match(bare.perModel[0].kind, /^trigger only/);
  assert.equal(bare.entries.length, 0);
});

test('the chromatic channel: base+4 by default, base+4..base+15 or an absolute one', () => {
  assert.equal(MIDI_CHROMA_CHANNEL, 'base+4');
  assert.equal(channelByte(), 0x14);
  assert.equal(channelByte('base+15'), 0x1f);
  assert.equal(channelByte('ch:1'), 0);
  assert.equal(channelByte('ch:16'), 15);
  for (const bad of ['base+3', 'base+16', 'ch:0', 'ch:17', 'off', '5']) assert.throws(() => channelByte(bad), /MIDI chromatic channel/);
});

const ORG = 0x2bc9fc;
const code = (): ReturnType<typeof assemble> => assemble(ORG, S, buildTable(SYN), channelByte());

test('the routines: ISA_A throughout, branches inside on instruction boundaries, calls only to the OS routines named', async () => {
  const c = code();
  const chk = checkChromaCode(c.bytes, c.codeLen, ORG, S);
  assert.ok(chk.ok, chk.detail);
  assert.equal(c.codeLen, 896);
  assert.equal(c.labels.chch, ORG);
  const ins = decodeLinear(c.bytes.subarray(0, c.codeLen), ORG);
  const calls = new Set(ins.filter((i) => i.target !== undefined && (i.target < ORG || i.target >= ORG + c.codeLen)).map((i) => i.target));
  assert.deepEqual([...calls].sort(), [S.noteOn, S.ccHandler, S.recorder, S.lockWriter, S.popup, S.queuePost, S.idle.next].sort());
  // the data block: idle request, ring indices, the channel byte, the wake-up byte; the ring; the table
  const d = c.labels.dat - ORG;
  assert.equal(d % 4, 0);
  assert.deepEqual(Array.from(c.bytes.subarray(d, d + 8)), [0, 0, 0x40, 0, 0, 0, 0x14, 0xfe]);
  assert.equal(c.labels.ring - c.labels.dat, 16);
  assert.equal(c.labels.table - c.labels.ring, 4 * RING);
  assert.equal(c.bytes.length % 4, 0);
  // the routines byte for byte as reviewed (their table and law addresses follow the table's length)
  assert.equal(await sha256(c.bytes.subarray(0, c.codeLen)), '9bed56c87944ca4f6550167b58b431e8ca488301b7138676f699513bbe44093b');
  // an image the checker must refuse: a branch moved off an instruction boundary
  const bad = c.bytes.slice();
  const at = decodeLinear(bad.subarray(0, c.codeLen), ORG).find((i) => i.name.startsWith('b') && i.len === 2)!.at - ORG;
  bad[at + 1] ^= 1;
  assert.equal(checkChromaCode(bad, c.codeLen, ORG, S).ok, false);
});

test('the patched bytes: parser range test, note-on call, live-record call, UI idle call', () => {
  const c = code(), L = c.labels;
  const { patches, checks } = chromaPatches(S, L);
  assert.deepEqual(patches.map(([a]) => a), [0x2dcb54, 0x2dcb58, 0x2dcb5c, 0x2dcb60, 0x2dcb64, 0x2dcf08, 0x2dcf0c, 0x2cf974, 0x2cf978, 0x225530]);
  const parser = concat(patches.slice(0, 5).map(([, v]) => be32(v)));
  assert.deepEqual(parser, concat([hex('4eb9'), be32(L.hook_parse), hex('6700'), hex('005a'), hex('6b00'), hex('fde0'), hex('4e714e714e71')]));
  assert.equal(0x2dcb5c + 0x5a, S.parser.enqueue);                          // beq.w enqueue
  assert.equal(0x2dcb60 + (0xfde0 - 0x10000), S.parser.drop);              // bmi.w drop
  assert.deepEqual(concat(patches.slice(5, 7).map(([, v]) => be32(v))), concat([hex('4eb9'), be32(L.hook_note), hex('508f')]));
  assert.deepEqual(concat(patches.slice(7, 9).map(([, v]) => be32(v))), concat([hex('4eb9'), be32(L.rec_hook), hex('588f')]));
  assert.deepEqual(patches[9], [0x225530, L.drain]);
  // what each longword holds before: the base's own code
  assert.deepEqual(checks.map(([a]) => a), patches.map(([a]) => a));
  assert.equal(checks[0][1], u32(hex(S.parser.old), 0));
  assert.equal(checks[5][1], 0x4eb9002c);
  assert.equal(checks[9][1], 0x00229b38);
  // the patched parser decodes as jsr; beq.w; bmi.w; nop x3, ending where the old test ended
  const ins = decodeLinear(parser, S.parser.site);
  assert.deepEqual(ins.map((i) => i.len), [6, 4, 4, 2, 2, 2]);
  assert.deepEqual(ins.map((i) => i.target), [L.hook_parse, S.parser.enqueue, S.parser.drop, undefined, undefined, undefined]);
  assert.deepEqual([parser[6], parser[10]], [0x67, 0x6b]);                  // beq, bmi
  assert.ok(ins.every((i) => i.ok));
  assert.deepEqual(chromaRanges(S), [[0x2dcb54, 0x2dcb68], [0x2dcf08, 0x2dcf10], [0x2cf974, 0x2cf97c], [0x225530, 0x225534]]);
});

/** Code images holding exactly the bytes the sites and anchors must have. */
function images(): CodeImage[] {
  const main = new Uint8Array(0x80000), addon = new Uint8Array(0x20000);
  const put = (at: number, v: string): void => {
    const [img, org] = at >= 0x2c0000 ? [addon, 0x2c0000] : [main, 0x200000];
    img.set(hex(v), at - org);
  };
  put(S.parser.site, S.parser.old); put(S.consumer.site, S.consumer.old); put(S.recSite.site, S.recSite.old); put(S.idle.site, S.idle.old);
  for (const [a, v] of Object.entries(S.anchors)) put(+a, v);
  return [{ what: 'ColdFire slot', ram: 0x200000, bytes: main }, { what: 'add-on', ram: 0x2c0000, bytes: addon }];
}

test('the sites are verified byte for byte; anything else is refused with the reason', () => {
  const imgs = images();
  assert.equal(findChroma(imgs), S);
  for (const at of [S.parser.site + 19, S.consumer.site + 2, S.recSite.site, S.idle.site + 3, 0x21670a]) {
    const m = imgs.find((i) => at >= i.ram && at < i.ram + i.bytes.length)!;
    m.bytes[at - m.ram] ^= 0x40;
    assert.throws(() => findChroma(imgs), (e: Error) => e instanceof NoChroma && /X\.14/.test(e.message));
    m.bytes[at - m.ram] ^= 0x40;
  }
  // a base without the add-on (OS 1.63, DEV) has no X.14 path (1.63's is found by findChromaTask)
  assert.throws(() => findChroma([imgs[0]]), (e: Error) => e instanceof NoChroma && /X\.14's real-time MIDI path/.test(e.message));
});

test('the RAM image: off is exactly as before; on appends the routines and nothing else changes', () => {
  const core = JSON.parse(readFileSync('catalog/core.json', 'utf8')) as CorePack;
  const main = new Uint8Array(0x60000);
  const base = {
    id: 'x14', ext: { base: 0x2bc000, end: 0x2bd000 },
    os: { cfBase: 0x200000, descriptorSize: 0x3a, familyTable: 0x252396, uwMenu: null,
          levBar: { low: { ids: [0x5e, 0x5f] }, high: { ids: [0xa8, 0xaf] }, ctr: { ids: [0x7c, 0x7f] } } },
    features: { dynLabels: null, hostSend: null, midiChroma: S },
  } as unknown as Base;
  main.set(hex('4d4f444500252d00'), 0x52396);                               // one family record of the base
  const syn = models.filter((m) => m.pitch).slice(0, 6);
  const sel = syn.map((m, i) => ({ m, family: 'F', id: 100 + i, preferred: 100 + i, mapped: false })) as Selected[];
  const fams = [{ name: 'F', models: syn }];
  const opt = { dyn: false, dsp1: null, host: false, toFlash: new Set<string>(), dynFlash: new Set<string>(), idSpace: 0xc0, flashAt: 0, redrawValues: 0, ind: null };
  const off = ramImage(base, main, core, fams, sel, opt);
  const offNull = ramImage(base, main, core, fams, sel, { ...opt, chroma: null });
  assert.deepEqual(offNull.image, off.image);
  assert.equal(off.chroma, null);
  const on = ramImage(base, main, core, fams, sel, { ...opt, chroma: { site: S, channel: 'base+4', cfg: 0x14 } });
  assert.ok(on.chroma);
  assert.deepEqual(on.image.subarray(0, off.image.length), off.image);
  assert.equal(on.chroma.at, 0x2bc000 + off.image.length);
  assert.deepEqual(on.image.subarray(off.image.length), on.chroma.code.bytes);
  assert.equal(on.chroma.table.entries.length, syn.filter((m) => lawOf(m.pitch!) !== null).length);
  assert.ok(on.bytes <= IND_EXT_SPAN);
});

// ---- the routines executed (engine/test/cf_interp.ts), the OS routines they call stubbed --------

const MSG = 0x00e00000;
interface Rig {
  cpu: Cpu; L: Record<string, number>; t: ChromaTable; S: Chroma;
  notes: number[][]; ccs: number[][]; posts: { queue: number; byte: number }[];
  locks: number[][]; popups: number[][]; idleNext: number;
  /** the step the live trig recorder sets (null: live record off, the recorder is not called) */
  live: number | null; lockResult: number;
}
function rig(ms: ChromaModel[] = SYN, cfg = 0x14, S: Chroma = X14): Rig {
  const t = buildTable(ms), c = assemble(ORG, S, t, cfg), cpu = new Cpu();
  cpu.load(ORG, c.bytes);
  const r: Rig = { cpu, L: c.labels, t, S, notes: [], ccs: [], posts: [], locks: [], popups: [], idleNext: 0, live: null, lockResult: 1 };
  const msg = (p: number): number[] => [cpu.r8(p), cpu.r8(p + 1), cpu.r8(p + 2)];
  cpu.stubs.set(S.noteOn, (x) => {
    const m = msg(x.arg(0));
    r.notes.push([...m, x.arg(1)]);
    // the OS records the trig (live record on, a direct-track note) through the call rec_hook replaced
    if (r.live !== null && m[1] >= 0x80) x.call(r.L.rec_hook, [~m[1] & 15]);
  });
  cpu.stubs.set(S.ccHandler, (x) => { r.ccs.push([...msg(x.arg(0)), x.arg(1)]); });
  cpu.stubs.set(S.recorder, (x) => {
    const st = r.live!;
    x.d[0] = 1 << (st % 32);
    x.a[0] = st >= 32 ? S.trigHi : 0x7272c0;
  });
  cpu.stubs.set(S.queuePost, (x) => { r.posts.push({ queue: x.arg(0), byte: x.r8(x.arg(1)) }); });
  cpu.stubs.set(S.lockWriter, (x) => { r.locks.push([0, 1, 2, 3, 4].map((k) => x.arg(k))); x.d[0] = r.lockResult; });
  cpu.stubs.set(S.popup, (x) => { r.popups.push([0, 1, 2, 3, 4].map((k) => x.arg(k) & 0xffff)); });
  cpu.stubs.set(S.idle.next, () => { r.idleNext++; });
  cpu.w32(S.baseCh, 0);                      // base channel 1
  cpu.w32(S.selTrack, 2);
  cpu.w32(S.livePattern, 5);
  cpu.w32(S.uiPattern, 9);
  return r;
}
const machineOn = (r: Rig, track: number, id: number): void => r.cpu.w32(r.S.machineIds + 4 * track, id);
function play(r: Rig, ch: number, note: number, vel = 100): void {
  r.cpu.load(MSG, [0x90 | ch, note, vel]);
  r.cpu.call(r.L.hook_note, [MSG, 1]);
}
const dat = (r: Rig, k: number): number => r.cpu.r8(r.L.dat + k);
const ringOf = (r: Rig): number[] => Array.from({ length: RING }, (_, k) => r.cpu.r32(r.L.ring + 4 * k));
const req = (trackKnob: number, raw: number, step: number, pattern: number): number => ((trackKnob << 24) | (raw << 16) | (step << 8) | pattern) >>> 0;

test('executed: lookup returns what lookup() says for every table entry, note and MODE raw', () => {
  const ms: ChromaModel[] = [...SYN, ...models.filter((m) => m.pitch).map((m, i) => ({ id: 100 + i, name: m.name, pitch: m.pitch, dyn_labels: m.dyn_labels }))];
  const r = rig(ms), { cpu, L, t } = r;
  let n = 0;
  for (const e of t.entries) {
    const segs = e.bytes[1] >> 3, track = e.id % 16;
    for (let mode = 0; mode < 128; mode += segs ? 1 : 128) {
      cpu.w8(S.kitParams + 24 * track + e.bytes[3], mode);
      for (let note = 0; note < 128; note++) {
        cpu.d[0] = e.id; cpu.d[3] = note; cpu.d[4] = track;
        cpu.call(L.lookup);
        const want = lookup(t, e.id, note, mode);
        assert.deepEqual(cpu.d[0] < 0 ? null : { knob: cpu.d[1], raw: cpu.d[0] }, want, `${e.name} mode ${mode} note ${note}`);
        n++;
      }
    }
  }
  for (const id of [0, 3, 40, 84, 171, 254]) {           // not in the table, or trigger only
    cpu.d[0] = id; cpu.d[3] = 60; cpu.d[4] = 0;
    cpu.call(L.lookup);
    assert.equal(cpu.d[0], -1, `ID ${id}`);
  }
  assert.ok(n > 10_000);
});

test('executed: hook_parse keeps the base range, queues chromatic note-ons with velocity, drops the rest', () => {
  for (const base of [0, 5, 11]) {
    const r = rig(), { cpu, L } = r;
    cpu.w32(S.baseCh, base);
    const parse = (ch: number, vel: number): string => {
      cpu.load(MSG, [0x90 | ch, 60, vel]);
      cpu.d[0] = ch; cpu.a[1] = MSG;
      cpu.call(L.hook_parse);
      assert.equal(cpu.d[0], ch, 'd0 preserved');
      return cpu.z ? 'enqueue' : cpu.n ? 'drop' : 'continue';
    };
    for (let k = 0; k < 4; k++) assert.equal(parse(base + k, 100), 'continue');
    assert.equal(parse(base + 4, 100), 'enqueue');
    assert.equal(parse(base + 4, 0), 'drop');
    assert.equal(parse(base + 5, 100), 'drop');
  }
});

test('executed: a chromatic note sets the pitch knob by CC and triggers the selected track; outside record nothing is queued', () => {
  const r = rig();
  machineOn(r, 2, 11);                                    // QUART on the selected track 3
  play(r, 4, 60, 77);
  assert.deepEqual(r.ccs, [[0xb0, 72, 72, 1]]);           // base channel, CC 72 (3rd track of the channel) + knob 0, raw 72
  assert.deepEqual(r.notes, [[0x90, (~2) & 0xff, 77, 1]]); // the direct-track form, the note's velocity
  assert.deepEqual(r.posts, []);                          // neither live record nor held steps: nothing queued
  assert.equal(dat(r, 2), IDLE);
  // track 14 is CC-addressed on base+3 (2nd track there), CHRM's knob 3: CC 40 + 3
  r.cpu.w32(S.selTrack, 13); machineOn(r, 13, 90);
  play(r, 4, 50);
  assert.deepEqual(r.ccs[1], [0xb3, 43, 50, 1]);
  // other channels pass straight through, message and port unchanged
  r.ccs.length = 0; r.notes.length = 0;
  play(r, 0, 61); play(r, 6, 62);
  assert.deepEqual(r.notes, [[0x90, 61, 100, 1], [0x96, 62, 100, 1]]);
  assert.deepEqual(r.ccs, []);
  // trigger only: no CC, the trigger, nothing armed
  machineOn(r, 13, 171); r.notes.length = 0;
  play(r, 4, 60);
  assert.deepEqual(r.ccs, []);
  assert.deepEqual(r.notes, [[0x90, (~13) & 0xff, 100, 1]]);
  assert.equal(dat(r, 2), IDLE);
  // no track selected: nothing at all
  r.cpu.w32(S.selTrack, 16); r.notes.length = 0;
  play(r, 4, 60);
  assert.deepEqual(r.notes, []);
});

test('executed: live record queues [track | knob<<4, raw, step, pattern] and wakes the UI task with 0xFE', () => {
  const r = rig();
  machineOn(r, 2, 11);
  r.live = 37;
  play(r, 4, 61);
  assert.deepEqual(r.posts, [{ queue: S.uiQueue, byte: 0xfe }]);
  assert.equal(r.cpu.r32(r.L.ring), req(2, 74, 37, 5));
  assert.deepEqual([dat(r, 4), dat(r, 5), dat(r, 2)], [1, 0, IDLE]);
  r.live = 3;
  play(r, 4, 24);
  assert.equal(r.cpu.r32(r.L.ring + 4), req(2, 0, 3, 5));
  // a trigger-only machine records its trig but requests no lock
  machineOn(r, 2, 171);
  play(r, 4, 60);
  assert.equal(r.posts.length, 2);
});

test('executed: grid record queues an ARMED request only while a trig key is held', () => {
  const r = rig(), { cpu } = r;
  machineOn(r, 2, 164); cpu.w8(S.kitParams + 24 * 2 + 2, 40);      // ZONED, MODE stop 1
  cpu.w32(S.gridMode, 1);
  play(r, 4, 60);
  assert.deepEqual(r.posts, [], 'grid record, nothing held');
  cpu.w32(S.held + 4, 1 << 6);                                        // step 7 held
  play(r, 4, 60);
  assert.equal(r.posts.length, 1);
  assert.equal(cpu.r32(r.L.ring), req(2, lookup(r.t, 164, 60, 40)!.raw, ARMED, 0));
  cpu.w32(S.gridMode, 0);
  play(r, 4, 60);
  assert.equal(r.posts.length, 1, 'held keys outside grid record');
});

test('executed: a base channel too high to address the track by CC only triggers it, and arms nothing', () => {
  const r = rig(), { cpu } = r;
  cpu.w32(S.baseCh, 13);                                  // base channel 14: tracks 13..16 are out of CC reach
  cpu.w32(S.selTrack, 12); machineOn(r, 12, 11);
  r.live = 4;
  play(r, 1, 60, 90);                                     // base+4 wraps to channel 2
  assert.deepEqual(r.ccs, []);
  assert.equal(r.notes.length, 1);
  assert.deepEqual(r.posts, [], 'no lock for a pitch that was not set');
  assert.equal(dat(r, 2), IDLE);
  cpu.w32(S.selTrack, 11); machineOn(r, 11, 11);          // track 12 is still reachable (CC on channel 16)
  play(r, 1, 60, 90);
  assert.deepEqual(r.ccs, [[0xbf, 96, 72, 1]]);
  assert.equal(r.posts.length, 1);
});

test('executed: the ring keeps one slot free; when full the newest request is replaced and counted', () => {
  const r = rig(), { cpu } = r;
  machineOn(r, 2, 11);
  for (const [k, note] of [30, 40, 50, 60, 70].entries()) { r.live = k; play(r, 4, note); }
  assert.deepEqual([dat(r, 4), dat(r, 5)], [3, 0]);       // 3 of 4 slots used, read index untouched
  assert.equal(cpu.r32(r.L.dat + 8), 2);                  // two requests replaced
  assert.deepEqual(ringOf(r).slice(0, 3), [req(2, 12, 0, 5), req(2, 32, 1, 5), req(2, 92, 4, 5)]);
  assert.equal(r.posts.length, 5);                        // every request still wakes the UI task
});

test('executed: drain writes recorded locks, every held step in grid record, the popup when full, then continues', () => {
  const r = rig(), { cpu, L } = r;
  const put = (entries: number[]): void => { entries.forEach((v, k) => cpu.w32(L.ring + 4 * k, v)); cpu.w8(L.dat + 5, 0); cpu.w8(L.dat + 4, entries.length); };
  // a recorded step, then an ARMED request with steps 4 and 42 held in grid record
  put([req(3 | (2 << 4), 99, 17, 6), req(5, 50, ARMED, 0)]);
  cpu.w32(S.gridMode, 1); cpu.w32(S.held + 4, 1 << 3); cpu.w32(S.held, 1 << 9);
  cpu.call(L.drain);
  assert.deepEqual(r.locks, [[6, 3, 2, 17, 99], [9, 5, 0, 3, 50], [9, 5, 0, 41, 50]]);
  assert.equal(cpu.r32(S.knobTouched), 1);
  assert.deepEqual([dat(r, 4), dat(r, 5)], [2, 2]);
  assert.deepEqual(r.popups, []);
  assert.equal(r.idleNext, 1);
  // ARMED outside grid record: dropped; a failed write: the OS popup
  r.locks.length = 0; cpu.w32(S.gridMode, 0);
  put([req(5, 50, ARMED, 0)]);
  cpu.call(L.drain);
  assert.deepEqual(r.locks, []);
  r.lockResult = 0;
  put([req(1, 10, 2, 1)]);
  cpu.call(L.drain);
  assert.deepEqual(r.popups, [[0xffff, 0xffff, 0xffff, 0xffff, 0x66]]);
  // an empty ring: straight on to the idle routine, d2-d7 intact
  cpu.d[2] = 0x1234; cpu.d[7] = -5;
  cpu.call(L.drain);
  assert.deepEqual([cpu.d[2], cpu.d[7], r.idleNext], [0x1234, -5, 4]);
});

// ---- OS 1.63: the MIDI task (findChromaTask), on synthetic code images built from the lineage's signatures

const LINEAGE = JSON.parse(readFileSync('bases/lineage-163.json', 'utf8')) as { signatures: Record<string, string> };
const SIGS = LINEAGE.signatures;

/** Where stock 1.63 has each signature, and the values its captures hold there. */
const AT163: Record<string, number> = {
  chroma_task: 0x209de2, chroma_uart_isr: 0x1000862, chroma_parser_post: 0x21453c, chroma_note_on: 0x20cc48, chroma_rec_call: 0x20d032,
  chroma_sel_track: 0x20ccd2, chroma_recorder: 0x237a0c, chroma_cc: 0x20c8de, chroma_cc_kit: 0x20c9d4, chroma_grid_held: 0x224998,
  chroma_grid_lock: 0x224a9c, chroma_lock_writer: 0x21670a, chroma_queue_post: 0x2129e8, chroma_ui_loop: 0x22551c,
};
const CAP163: Record<string, number> = {
  base_ch: 0x100155c, midi_queue: 0x28d9b8, queue_get: 0x212994, table: 0x252d1e, parser: 0x214218, queue_post: 0x2129e8, ui_queue: 0x2ab2ec,
  ui_queue2: 0x2ab2ec, recorder: 0x2379ac, sel_track: 0x2818da, live_pattern: 0x28d202, trig_hi: 0x780000, base_ch_lo: 0x100155f,
  machine_base: 0x700008, kit_params: 0x70001a, grid_mode: 0x281a3e, held: 0x281aee, held_lo: 0x281af2, knob_touched: 0x281b12,
  ui_pattern: 0x2ab2e8, lock_writer: 0x21670a, popup_full: 0x66, popup: 0x21a10c, queue_count: 0x212944,
};

/** The OS 1.63 MIDI-task site, as findChromaTask reads it from stock 1.63 (the profile caches the same). */
const T163: ChromaTask = {
  kind: 'task',
  baseCh: 0x100155c, selTrack: 0x2818da, machineIds: 0x7001aa, kitParams: 0x70001a, noteOn: 0x20cc48, ccHandler: 0x20c8de,
  recorder: 0x2379ac, trigHi: 0x780000, recSite: { site: 0x20d040, old: '4eb9002379ac588f' }, livePattern: 0x28d202,
  lockWriter: 0x21670a, popup: 0x21a10c, popupFull: 0x66, queuePost: 0x2129e8, uiQueue: 0x2ab2ec,
  idle: { site: 0x225524, old: '00212944', next: 0x212944 },
  uiPattern: 0x2ab2e8, gridMode: 0x281a3e, held: 0x281aee, knobTouched: 0x281b12,
  filter: { site: 0x209e10, end: 0x209e20, loop: 0x209de6, old: '720fc280b6816ece20035680b0816dc6' },
  midiQueue: 0x28d9b8, parser: 0x214218, table: 0x252d1e,
};

/** Code images holding every chroma signature where 1.63 has it, its captures filled in, and the dispatch table. */
function images163(over: Record<string, Record<string, number>> = {}): CodeImage[] {
  const caps = CAP163, at = AT163;
  const main = new Uint8Array(0x60000), sram = new Uint8Array(0x1000);
  const put = (a: number, b: ArrayLike<number>): void => {
    const [img, org] = a >= 0x1000000 ? [sram, 0x1000088] : [main, 0x200000];
    img.set(b, a - org);
  };
  for (const n of TASK_SIGNATURES) {
    const sig = parseSig(SIGS[n]);
    const b = sig.bytes.map((x) => x ?? 0);
    for (const c of sig.caps) {
      const v = over[n]?.[c.name] ?? caps[c.name];
      assert.ok(v !== undefined, `${n}: capture ${c.name}`);
      for (let k = 0; k < c.size; k++) b[c.at + k] = (v >>> (8 * (c.size - 1 - k))) & 0xff;
    }
    put(at[n], b);
  }
  put(caps.table + 4 * 9, be32(0x20cc48));
  put(caps.table + 4 * 0xb, be32(0x20c8de));
  return [{ what: 'ColdFire slot', ram: 0x200000, bytes: main }, { what: 'SRAM', ram: 0x1000088, bytes: sram }];
}

test('1.63 discovery: every site and routine from the signatures, the same as stock 1.63 has them', () => {
  assert.deepEqual(findChromaTask(images163(), SIGS), T163);
  assert.deepEqual(discoverChroma(images163(), SIGS), T163);
  // the X.14 path is tried first and wins where it is (its own images have no MIDI task signatures)
  assert.equal(discoverChroma(images(), SIGS), S);
  assert.throws(() => discoverChroma([images()[1]], SIGS), (e: Error) => e instanceof NoChroma && /X\.14's real-time/.test(e.message) && /OS 1\.63's MIDI task/.test(e.message));
  // the main-OS routines and state are the ones X.14 inherits from 1.63 (the same addresses)
  for (const k of ['baseCh', 'selTrack', 'machineIds', 'kitParams', 'recorder', 'trigHi', 'livePattern', 'lockWriter', 'popupFull', 'queuePost', 'uiQueue', 'uiPattern', 'gridMode', 'held', 'knobTouched'] as const) {
    assert.equal(T163[k], X14[k], k);
  }
  assert.equal(T163.recSite.old, X14.recSite.old);
});

test('1.63 discovery: a missing, doubled or inconsistent piece is refused, naming it', () => {
  const refuse = (imgs: CodeImage[], re: RegExp): void => {
    assert.throws(() => findChromaTask(imgs, SIGS), (e: Error) => e instanceof NoChroma && /OS 1\.63's MIDI task/.test(e.message) && re.test(e.message), String(re));
  };
  // each signature, broken in its first byte
  for (const n of TASK_SIGNATURES) {
    const imgs = images163();
    const a = AT163[n], m = imgs.find((i) => a >= i.ram && a < i.ram + i.bytes.length)!;
    m.bytes[a - m.ram] ^= 0x01;
    refuse(imgs, new RegExp(`'${n}'`));
  }
  // a second MIDI task loop
  {
    const imgs = images163();
    const sig = parseSig(SIGS.chroma_task);
    imgs[0].bytes.set(imgs[0].bytes.slice(AT163.chroma_task - 0x200000, AT163.chroma_task - 0x200000 + sig.bytes.length), 0x58000);
    refuse(imgs, /'chroma_task'\) matches 2 times/);
  }
  // inconsistent pieces: each pair the OS's own paths must agree on
  refuse(images163({ chroma_parser_post: { midi_queue: 0x28d9c0 } }), /the MIDI task's queue and the one the parser posts to differ/);
  refuse(images163({ chroma_cc: { base_ch_lo: 0x1001563 } }), /the base channel and the CC handler's low byte of it differ/);
  refuse(images163({ chroma_grid_held: { held_lo: 0x281af6 } }), /held-step mask's two longwords differ/);
  refuse(images163({ chroma_grid_lock: { sel_track: 0x2818de } }), /the selected track \(note-on handler, grid knob path\) differ/);
  refuse(images163({ chroma_ui_loop: { ui_queue2: 0x2ab2f0 } }), /the UI task's queue \(parser, UI loop\) differ/);
  refuse(images163({ chroma_ui_loop: { queue_get: 0x212998 } }), /the queue get \(MIDI task, UI loop\) differ/);
  refuse(images163({ chroma_grid_lock: { ui_pattern: 0x2ab2e4 } }), /the UI task's pattern/);
  // the UART interrupt calls a parser the post is not in
  refuse(images163({ chroma_uart_isr: { parser: 0x215000 } }), /'chroma_parser_post'\) is not found/);
  // the dispatch table names another note-on handler
  { const imgs = images163(); imgs[0].bytes.set(be32(0x20cc4a), CAP163.table + 36 - 0x200000); refuse(imgs, /'chroma_note_on'/); }
});

const code163 = (): ReturnType<typeof assemble> => assemble(ORG, T163, buildTable(SYN), channelByte());

test('1.63 routines: ISA_A throughout, calls only to the OS routines named, the ring filled with interrupts masked', async () => {
  const c = code163();
  const chk = checkChromaCode(c.bytes, c.codeLen, ORG, T163);
  assert.ok(chk.ok, chk.detail);
  assert.equal(c.codeLen, 876);
  assert.equal(c.labels.chch, ORG);
  const ins = decodeLinear(c.bytes.subarray(0, c.codeLen), ORG);
  const calls = new Set(ins.filter((i) => i.target !== undefined && (i.target < ORG || i.target >= ORG + c.codeLen)).map((i) => i.target));
  assert.deepEqual([...calls].sort(), callees(T163).sort());
  assert.equal(T163.idle.next, 0x212944);
  // no X.14 entry points; the play, lock and lookup code is X.14's but for the mask around the enqueue
  assert.equal(c.labels.hook_parse, undefined);
  assert.equal(c.labels.hook_note, undefined);
  const x = assemble(ORG, X14, buildTable(SYN), channelByte());
  const text = (a: ReturnType<typeof assemble>, from: string, to: string): string[] =>
    a.listing.filter((l) => l.at >= a.labels[from] && l.at < a.labels[to]).map((l) => l.text.replace(/\b\d+\.l\b/g, 'ADDR.l').replace(/#\d{6,}/g, '#ADDR'));
  const sr = ['move.w sr,d6', 'move.w #0x2700,sr', 'move.w d6,sr'];
  assert.deepEqual(text(c, 'hn_mine', 'code_end').filter((t) => !sr.includes(t)), text(x, 'hn_mine', 'code_end'));
  const q = text(c, 'hn_queue', 'hn_out');
  assert.deepEqual([q[0], q[1]], sr.slice(0, 2));
  assert.equal(q[q.indexOf('move.b d2,4(a2)') + 1], 'move.w d6,sr');
  assert.ok(q.indexOf('move.w d6,sr') < q.findIndex((t) => t.startsWith('jsr')), 'the UI task is woken after the mask is restored');
  // the routines byte for byte as run in the emulator (their table and law addresses follow the table's length)
  assert.equal(await sha256(c.bytes.subarray(0, c.codeLen)), '9e20db34b858ce53446c7cb8a0ce5699a39bd340c184d373d652843a203fd04a');
});

test('1.63 patched bytes: the MIDI task\'s channel test, the live-record call, the UI loop\'s count call', () => {
  const c = code163(), L = c.labels;
  const { patches, checks } = chromaPatches(T163, L);
  assert.deepEqual(patches.map(([a]) => a), [0x209e10, 0x209e14, 0x209e18, 0x209e1c, 0x20d040, 0x20d044, 0x225524]);
  const filter = concat(patches.slice(0, 4).map(([, v]) => be32(v)));
  assert.deepEqual(filter, concat([hex('4eb9'), be32(L.hook_task), hex('6b00'), be32(0x209de6 - 0x209e18).subarray(2), hex('4e714e714e71')]));
  const ins = decodeLinear(filter, 0x209e10);
  assert.deepEqual(ins.map((i) => i.len), [6, 4, 2, 2, 2]);
  assert.deepEqual(ins.map((i) => i.target), [L.hook_task, 0x209de6, undefined, undefined, undefined]);
  assert.ok(ins.every((i) => i.ok));
  assert.deepEqual(concat(patches.slice(4, 6).map(([, v]) => be32(v))), concat([hex('4eb9'), be32(L.rec_hook), hex('588f')]));
  assert.deepEqual(patches[6], [0x225524, L.drain]);
  assert.deepEqual(checks.map(([a]) => a), patches.map(([a]) => a));
  assert.deepEqual(checks.map(([, v]) => v), [0x720fc280, 0xb6816ece, 0x20035680, 0xb0816dc6, 0x4eb90023, 0x79ac588f, 0x00212944]);
  assert.deepEqual(chromaRanges(T163), [[0x209e10, 0x209e20], [0x20d040, 0x20d048], [0x225524, 0x225528]]);
  assert.deepEqual(chromaRewritten(T163), [0x209e10, 0x209e20]);
  assert.deepEqual(chromaSites(T163), [0x209e10, 0x20d040, 0x225524]);
  assert.deepEqual(chromaRewritten(X14), [0x2dcb54, 0x2dcb68]);
});

// ---- the 1.63 routines executed: hook_task as the MIDI task calls it

/** The MIDI task's call for a channel message: d0 = status sign-extended, d2 = status & 0xF0, d3 = base, a0 = msg. */
function task(r: Rig, status: number, d1: number, d2: number): 'dispatch' | 'drop' {
  const { cpu } = r;
  cpu.load(MSG, [status, d1, d2]);
  cpu.d[0] = (status << 24) >> 24; cpu.d[2] = status & 0xf0; cpu.d[3] = cpu.r32(r.S.baseCh); cpu.a[0] = MSG;
  cpu.d[4] = 0x4444; cpu.d[7] = 0x7777; cpu.a[2] = 0x2222;
  cpu.call(r.L.hook_task);
  assert.deepEqual([cpu.d[4], cpu.d[7], cpu.a[2]], [0x4444, 0x7777, 0x2222], 'callee-saved registers');
  if (!cpu.n) {
    assert.deepEqual([cpu.d[2], cpu.d[3], cpu.a[0]], [status & 0xf0, r.cpu.r32(r.S.baseCh), MSG], 'what the dispatch reads');
    return 'dispatch';
  }
  return 'drop';
}
const play163 = (r: Rig, ch: number, note: number, vel = 100): string => task(r, 0x90 | ch, note, vel);

test('1.63 executed: the base range is dispatched as before; the rest is dropped as before, chromatic note-ons played first', () => {
  for (const base of [0, 5, 11, 12, 15]) {
    const r = rig(SYN, 0x14, T163), { cpu } = r;
    cpu.w32(T163.baseCh, base);
    machineOn(r, 2, 11);
    for (const st of [0x80, 0x90, 0xa0, 0xb0]) {
      for (let ch = 0; ch < 16; ch++) {
        const inBase = ch >= base && ch <= base + 3;
        const chroma = ch === ((base + 4) & 15) && !inBase;
        r.notes.length = 0; r.ccs.length = 0;
        for (const vel of [0, 1, 127]) {
          const got = task(r, st | ch, 60, vel);
          assert.equal(got, inBase ? 'dispatch' : 'drop', `base ${base} status ${(st | ch).toString(16)} vel ${vel}`);
          const played = chroma && st === 0x90 && vel > 0;
          assert.equal(r.notes.length > 0, played, `played: base ${base} ${(st | ch).toString(16)} ${vel}`);
          r.notes.length = 0; r.ccs.length = 0;
        }
      }
    }
  }
});

test('1.63 executed: a chromatic note does what it does on X.14 (CC, trigger, live record, grid, ring), interrupts masked only around the ring', () => {
  // the same scenario on both, compared call by call
  const scenario = (S: Chroma): unknown => {
    const r = rig(SYN, 0x14, S), { cpu } = r;
    const go = (ch: number, note: number, vel = 100): void => { if (S === X14) play(r, ch, note, vel); else play163(r, ch, note, vel); };
    machineOn(r, 2, 11);
    go(4, 60, 77);                                           // plain play
    cpu.w32(S.selTrack, 13); machineOn(r, 13, 90); go(4, 50);   // knob 3 on track 14
    machineOn(r, 13, 171); go(4, 60);                        // trigger only
    cpu.w32(S.selTrack, 16); go(4, 60);                      // no track selected
    cpu.w32(S.selTrack, 2); r.live = 37; go(4, 61);          // live record, step 37
    r.live = 3; go(4, 24);
    r.live = null; machineOn(r, 2, 164); cpu.w8(S.kitParams + 24 * 2 + 2, 40);
    cpu.w32(S.gridMode, 1); go(4, 60);                       // grid record, nothing held
    cpu.w32(S.held + 4, 1 << 6); go(4, 60);                  // step 7 held
    cpu.w32(S.gridMode, 0); cpu.w32(S.held + 4, 0);
    machineOn(r, 2, 11);
    for (const [k, note] of [30, 40, 50, 60, 70].entries()) { r.live = k; go(4, note); }   // the ring fills
    cpu.w32(S.baseCh, 13); cpu.w32(S.selTrack, 12); machineOn(r, 12, 11); r.live = 4; go(1, 60, 90);   // out of CC reach
    return { notes: r.notes.map((n) => n.slice(1)), ccs: r.ccs.map((c) => c.slice(1)), posts: r.posts.map((p) => p.byte),
             ring: ringOf(r), dat: Array.from({ length: 12 }, (_, k) => dat(r, k)), sr: cpu.srWrites.length };
  };
  const a = scenario(X14) as { sr: number }, b = scenario(T163) as { sr: number; posts: number[] };
  assert.equal(a.sr, 0, 'X.14: no mask (the producer is an interrupt)');
  assert.equal(b.sr, 2 * b.posts.length, '1.63: masked and restored once per request');
  assert.deepEqual({ ...b, sr: 0 }, { ...a, sr: 0 });
  // the mask is restored to what it was, and the UI task is woken with it restored
  const r = rig(SYN, 0x14, T163);
  machineOn(r, 2, 11); r.live = 5; r.cpu.sr = 0x2300;
  r.cpu.stubs.set(T163.queuePost, (x) => { r.posts.push({ queue: x.arg(0), byte: x.r8(x.arg(1)) }); assert.equal(x.sr, 0x2300); });
  play163(r, 4, 60);
  assert.deepEqual(r.cpu.srWrites, [0x2700, 0x2300]);
  assert.deepEqual(r.posts, [{ queue: T163.uiQueue, byte: 0xfe }]);
});

test('1.63 executed: drain runs in the UI loop\'s count call and continues to the count routine with its argument', () => {
  const r = rig(SYN, 0x14, T163), { cpu, L } = r;
  let arg = 0;
  cpu.stubs.set(T163.idle.next, (x) => { r.idleNext++; arg = x.arg(0); x.d[0] = 3; });
  cpu.w32(L.ring, req(3 | (2 << 4), 99, 17, 6)); cpu.w8(L.dat + 5, 0); cpu.w8(L.dat + 4, 1);
  cpu.d[2] = 0x1234;
  cpu.call(L.drain, [T163.uiQueue]);
  assert.deepEqual(r.locks, [[6, 3, 2, 17, 99]]);
  assert.deepEqual([arg, cpu.d[0], r.idleNext, cpu.d[2]], [T163.uiQueue, 3, 1, 0x1234]);
});

// ---- with firmware (MD_FIRMWARE_DIR: a directory of OS files you own; skipped without it)

const FW = process.env.MD_FIRMWARE_DIR;
const fwSkip = !FW || !existsSync(FW) ? 'MD_FIRMWARE_DIR is not set to a directory of OS files' : false;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Every OS file in the directory that resolves to a profiled base (stock 1.63 prepared first), by profile. */
async function firmware(): Promise<Map<string, { bytes: Uint8Array; resolved: Resolved }>> {
  const set = loadBases(join(ROOT, 'bases'));
  const out = new Map<string, { bytes: Uint8Array; resolved: Resolved }>();
  for (const f of readdirSync(FW!).filter((n) => /\.(bin|syx)$/i.test(n))) {
    let bytes: Uint8Array = readFileSync(join(FW!, f));
    try {
      let resolved;
      try { resolved = await resolveBase(readFirmware(bytes), set); }
      catch (e) {
        if (!(e instanceof NotPatchable) || e.profile?.id !== 'stock-163') continue;
        bytes = (await prepare163(bytes)).output;
        resolved = await resolveBase(readFirmware(bytes), set);
      }
      if (resolved.profile && !out.has(resolved.profile.id)) out.set(resolved.profile.id, { bytes, resolved });
    } catch { /* not an OS file the engine reads */ }
  }
  return out;
}

test('firmware: discovery finds what each profile caches for chromatic input, and offers it only where the profile qualified it', { skip: fwSkip }, async () => {
  const all = await firmware();
  assert.ok(all.size, `no profiled OS file in ${FW}`);
  for (const [id, { resolved }] of all) {
    const p = resolved.profile!;
    const cached = Object.entries(p.cache ?? {}).filter(([k]) => k.startsWith('midi_chroma.'));
    for (const [k, v] of cached) assert.equal(resolved.discovery.values[k], v, `${id} ${k}`);
    assert.deepEqual(Object.keys(resolved.discovery.values).filter((k) => k.startsWith('midi_chroma.')).sort(), cached.map(([k]) => k).sort(), `${id}: every discovered value is cached`);
    assert.deepEqual(resolved.disagreements, [], id);
    const offered = p.options?.midiChroma?.ok === true && cached.length > 0;
    assert.equal(resolved.base.support.midiChroma.ok, offered, `${id}: ${resolved.base.support.midiChroma.why}`);
    assert.equal(!!resolved.base.features.midiChroma, offered, id);
    if (id === 'stock-163-prepared') assert.deepEqual(resolved.base.features.midiChroma, T163);
    if (id === 'x14') assert.equal(resolved.base.features.midiChroma, X14);
  }
});

test('firmware: on X.14 the 1.63 signatures for the OS routines find the addresses X.14\'s path names', { skip: fwSkip }, async () => {
  const x = (await firmware()).get('x14');
  assert.ok(x, `no X.14 file in ${FW}`);
  const imgs = codeImages(readFirmware(x.bytes), x.resolved.base);
  const one = (n: string): Record<string, { at: number; value: number }> => {
    const hits = findSig(imgs, SIGS[n]);
    assert.equal(hits.length, 1, n);
    return hits[0].caps;
  };
  const rec = one('chroma_recorder'), gl = one('chroma_grid_lock'), gh = one('chroma_grid_held'), ui = one('chroma_ui_loop');
  assert.deepEqual([rec.live_pattern.value, rec.trig_hi.value], [X14.livePattern, X14.trigHi]);
  assert.deepEqual([gl.lock_writer.value, gl.popup_full.value, gl.ui_pattern.value, gl.sel_track.value], [X14.lockWriter, X14.popupFull, X14.uiPattern, X14.selTrack]);
  assert.deepEqual([gh.grid_mode.value, gh.held.value, gh.knob_touched.value], [X14.gridMode, X14.held, X14.knobTouched]);
  assert.deepEqual([ui.ui_queue.value, ui.base_ch.value], [X14.uiQueue, X14.baseCh]);
  // X.14's UART interrupt calls its add-on's parser, not 1.63's: the MIDI-task path is not taken there
  assert.equal(findSig(imgs, SIGS.chroma_uart_isr).length, 0);
});

// The output of main at 255c0ec for these inputs (the bundled catalog, --uw). A build without
// --midi-chroma must be the same byte for byte on both bases, and X.14 with it too: the X.14 routines
// are the ones run on hardware. The 1.63 build with it is recorded so a change to it is deliberate.
const GOLDEN: Record<string, Record<string, string>> = {
  x14: { '': '0b743978980cc452a41ee5c768f283811f56512ad4f37bd5578bc84e23289663', '--midi-chroma': '4bab8efe1bb77e14f084b48cb742c2763f72931bc81d44d7405138c2841f2b61' },
  'stock-163-prepared': { '': '59bec81709bd731831322ab5f9fdfee7766e1e5150504bfb05cefc50cb559914', '--midi-chroma': '243ce93002890d7f070a3f1e081ee416a2441ed631fee6acdf98f69078e79647' },
};

test('firmware: builds without the option are main\'s byte for byte; X.14 with it too', { skip: fwSkip }, async () => {
  const all = await firmware();
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'kb-chroma-'));
  try {
    let checked = 0;
    for (const [id, builds] of Object.entries(GOLDEN)) {
      const got = all.get(id);
      if (!got) continue;
      const input = join(dir, `${id}.bin`);
      writeFileSync(input, got.bytes);
      for (const [flag, want] of Object.entries(builds)) {
        const out = join(dir, `${id}-out${flag}.bin`);
        const r = spawnSync(process.execPath, [cli, '--in', input, '--out', out, '--uw', '--catalog', join(ROOT, 'catalog'), ...(flag ? [flag] : [])],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(createHash('sha256').update(readFileSync(out)).digest('hex'), want, `${id} ${flag || 'default'}`);
        checked++;
      }
    }
    assert.ok(checked, `none of ${Object.keys(GOLDEN).join(', ')} in ${FW}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
