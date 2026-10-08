import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { be32, concat, hex, sha256, u32 } from '../src/bytes.js';
import type { Base } from '../src/bases.js';
import { decodeLinear } from '../src/isa.js';
import type { CorePack, Pack, PackModel } from '../src/packs.js';
import { noteToRaw, type Pitch } from '../src/pitch.js';
import { ramImage, IND_EXT_SPAN, MIDI_CHROMA_CHANNEL } from '../src/plan.js';
import type { Selected } from '../src/selection.js';
import type { CodeImage } from '../src/sig.js';
import {
  assemble, buildTable, channelByte, checkChromaCode, chromaPatches, chromaRanges, findChroma, lawOf, lookup, NoChroma,
  RING, X14_CHROMA as S, type ChromaModel,
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
  assert.equal(c.codeLen, 868);
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
  assert.equal(await sha256(c.bytes.subarray(0, c.codeLen)), 'cd6c936d5e70800a26920e86581f08134d5d37a7ed76415fb38bd3c42030dddc');
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
  // a base without the add-on (OS 1.63, DEV) is refused, not patched
  assert.throws(() => findChroma([imgs[0]]), (e: Error) => e instanceof NoChroma && /main loop/.test(e.message));
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
