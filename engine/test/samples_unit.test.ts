// E12 sample swapping on synthetic banks: the identity property, the cap, word accounting, the
// pair rule's padding, don't-trim, the machine map read from code, and the project file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEN_EXTRA, PAD, pack12, trimBank, unpack12, type TrimOptions } from '../src/e12.js';
import { applySwaps, capSamples, CAP_FADE, e12Machines, wordCost } from '../src/samples.js';
import { decodeProject, encodeProject, osProblem, pack12Bytes, unpack12Bytes, type Project } from '../src/project.js';
import type { Base } from '../src/bases.js';

const SEG = 0x1000;
const CODE = 8;
const TABLE = SEG + CODE;

/** A bank: code (with one pair, first `pair[0]` second `pair[1]`), the table, then each sample and its pad. */
function bank(samples: number[][], pair: [number, number] | null = null): { seg: number[]; end: number } {
  const n = samples.length;
  const code = new Array<number>(CODE).fill(0);
  if (pair) code.splice(0, 4, 0x61f400, TABLE + 3 * pair[1], 0x60f400, TABLE + 3 * pair[0]);
  const seg = [...code, ...new Array<number>(3 * n).fill(0)];
  let pos = TABLE + 3 * n;
  samples.forEach((x, i) => {
    const w = pack12(x);
    seg[CODE + 3 * i] = pos;
    seg[CODE + 3 * i + 1] = 2 * w.length + LEN_EXTRA;
    seg.push(...w, ...new Array<number>(PAD).fill(0));
    pos += w.length + PAD;
  });
  return { seg, end: pos };
}

/** A decaying tone: loud start, a quiet tail the trim can cut */
const tone = (n: number, amp = 2000): number[] => Array.from({ length: n }, (_, k) => Math.round(amp * Math.exp(-k / (n / 8)) * Math.sin(k / 3)) || 0);
const KEEP: TrimOptions = { db: -30, minSeconds: Infinity, cap: null };
const TRIM: TrimOptions = { db: -20, minSeconds: 0, cap: null };
const entry = (seg: number[], i: number): { start: number; len: number } => ({ start: seg[CODE + 3 * i], len: seg[CODE + 3 * i + 1] });
const dataOf = (seg: number[], i: number): number[] => {
  const { start, len } = entry(seg, i);
  return unpack12(seg.slice(start - SEG, start - SEG + (len - LEN_EXTRA) / 2));
};

test('swapping every entry with its own data gives the stock bank, trimmed or not', () => {
  const x = [tone(4000), tone(1000), tone(2400)];
  const b = bank(x, [0, 1]);
  const same = applySwaps(b.seg, SEG, TABLE, 3, b.end, new Map(x.map((v, i) => [i, Int16Array.from(v)])));
  assert.deepEqual(same.words, b.seg);
  assert.equal(same.end, b.end);
  assert.deepEqual(same.capped, []);
  assert.deepEqual(same.changed, [], 'a swap equal to stock is not a change');
  for (const opt of [KEEP, TRIM, { ...TRIM, cap: 0.01 }]) {
    assert.deepEqual(trimBank(same.words, SEG, TABLE, 3, same.end, opt), trimBank(b.seg, SEG, TABLE, 3, b.end, opt));
  }
});

test('a shorter swap re-lays the bank: the table, the silent pad and the words it frees', () => {
  const x = [tone(4000), tone(1000), tone(2400)];
  const b = bank(x);
  const mine = tone(301, 1500);
  const r = applySwaps(b.seg, SEG, TABLE, 3, b.end, new Map([[1, mine]]));
  assert.deepEqual(dataOf(r.words, 1), [...mine, 0]);               // odd count: one silent sample
  assert.equal(entry(r.words, 1).len, 2 * Math.ceil(301 / 2) + LEN_EXTRA);
  assert.deepEqual(dataOf(r.words, 2), x[2]);
  const { start, len } = entry(r.words, 1);
  const w = (len - LEN_EXTRA) / 2;
  assert.ok(r.words.slice(start - SEG + w, start - SEG + w + PAD).every((v) => v === 0));
  assert.equal(b.end - r.end, 500 - Math.ceil(301 / 2));
  assert.equal(r.end - (TABLE + 9), [4000, 302, 2400].reduce((n, k) => n + wordCost(k), 0));
  assert.equal(r.words.length, r.end - SEG);
});

test('a swap longer than its stock entry is cut to it with a fade, and reported', () => {
  const x = [tone(4000), tone(1000), tone(2400)];
  const b = bank(x);
  const long = new Array<number>(5000).fill(1000);
  const r = applySwaps(b.seg, SEG, TABLE, 3, b.end, new Map([[1, long]]));
  assert.deepEqual(r.capped, [1]);
  const got = dataOf(r.words, 1);
  assert.equal(got.length, 1000);
  assert.equal(got[1000 - CAP_FADE - 1], 1000);
  assert.ok(got[999] < 10 && got[999] >= 0);
  assert.equal(r.end, b.end, 'a capped swap never grows the bank');
  assert.throws(() => capSamples([4096], 10), /12-bit/);
  assert.throws(() => applySwaps(b.seg, SEG, TABLE, 3, b.end, new Map([[3, [0]]])), /no E12 entry 3/);
});

test('a first sample swapped shorter than its partner is padded with silence to the partner', () => {
  const x = [tone(4000), tone(2000), tone(2400)];
  const b = bank(x, [0, 1]);
  const r = applySwaps(b.seg, SEG, TABLE, 3, b.end, new Map([[0, tone(600)]]));
  const t = trimBank(r.words, SEG, TABLE, 3, r.end, KEEP);
  assert.equal(t.report[0].padded_for, 1);
  assert.equal(t.report[0].new_words, 1000);
  assert.deepEqual(dataOf(t.words, 0).slice(0, 600), tone(600));
  assert.ok(dataOf(t.words, 0).slice(600).every((v) => v === 0));
  assert.deepEqual(dataOf(t.words, 1), x[1], 'the partner is untouched');
  // the stock bank (first longer) is never padded
  assert.ok(trimBank(b.seg, SEG, TABLE, 3, b.end, KEEP).report.every((e) => e.padded_for === undefined));
});

test('don\'t trim: the entry is kept whole, and the pair rule pads its first instead of cutting it', () => {
  const x = [tone(4000), new Array<number>(3000).fill(500), tone(2400)];
  const b = bank(x, [0, 1]);
  const cut = trimBank(b.seg, SEG, TABLE, 3, b.end, TRIM);
  assert.ok(cut.report[2].new_words < 1200);
  assert.equal(cut.report[1].for_partner, 0, 'stock pair rule: the partner follows the trimmed first');
  const kept = trimBank(b.seg, SEG, TABLE, 3, b.end, TRIM, new Set([1, 2]));
  assert.equal(kept.report[2].new_words, 1200);
  assert.equal(kept.report[1].new_words, 1500);
  assert.equal(kept.report[1].for_partner, undefined);
  assert.equal(kept.report[0].padded_for, 1);
  assert.equal(kept.report[0].new_words, 1500);
});

test('the machine map is read from INIT and TRIGGER code through the dispatch tables', () => {
  const P = new Map<number, number>();
  const T = 0x2000, N = 4;
  const D = { e12Table: T, e12Count: N, dispatch: { init: 0x3000, trigger: 0x3100, render: 0x3200 } };
  const put = (a: number, ws: number[]): void => ws.forEach((v, i) => P.set(a + i, v));
  // ID 5: indexed (INIT stores entry 2), ID 6: a pair (first 3, second 0), ID 7: neither
  put(0x4000, [0x44f400, 2, 0x0b7684, 0x00000f, 0x00000c]);
  put(0x4100, [0x023ef4, 0x0141c0, 3, 0x0140c0, T, 0x00000c]);
  put(0x4200, [0x61f400, T, 0x60f400, T + 9, 0x00000c]);
  put(0x4300, [0x000000, 0x00000c]);
  P.set(0x3000 + 6, 0x4000); P.set(0x3100 + 6, 0x4100);
  P.set(0x3000 + 7, 0x4300); P.set(0x3100 + 7, 0x4200);
  P.set(0x3000 + 8, 0x4300); P.set(0x3100 + 8, 0x4300);
  const got = e12Machines((a) => P.get(a), { dsp2: D } as unknown as Base,
    [{ name: 'E12 ', machines: [{ name: 'E12XA', id: 5 }, { name: 'E12XB', id: 6 }, { name: 'E12XC', id: 7 }] }]);
  assert.deepEqual(got, [
    { id: 5, name: 'E12XA', family: 'E12', entries: [2] },
    { id: 6, name: 'E12XB', family: 'E12', entries: [3, 0] },
  ]);
});

const OS = { base: 'x13', name: 'OS X.13', tag: 'X13 ', coldfire_sha256: 'a'.repeat(64), dsp2_sha256: 'b'.repeat(64), dsp1_sha256: 'c'.repeat(64) };
const baseLike = (o = OS): Base => ({ id: o.base, name: o.name, identify: { tag: o.tag, coldfire_sha256: o.coldfire_sha256, dsp2_sha256: o.dsp2_sha256, dsp1_sha256: o.dsp1_sha256 } }) as unknown as Base;

test('12-bit packing round-trips, odd counts included', () => {
  const x = Int16Array.from([-2048, 2047, 0, -1, 1, 1234, -999]);
  const b = pack12Bytes(x);
  assert.equal(b.length, 12);
  assert.deepEqual(unpack12Bytes(b, 7), x);
  assert.throws(() => unpack12Bytes(b, 9), /expected/);
});

test('a project round-trips through its file, refuses another OS and damaged samples', async () => {
  const p: Project = {
    os: OS, swaps: new Map([[12, Int16Array.from(tone(999))], [3, Int16Array.from([1, -2, 3])]]), sources: new Map([[12, 'snare.wav']]),
    noTrim: new Set([3]), trim: { mode: 'manual', db: -17, cap: 1 }, models: ['b', 'a'],
    layout: { format: 'md-layout/1', base: 'x13', categories: ['KIK'], machines: { 'vadbd': { id: 100, category: 'KIK', order: 0 } } },
  };
  const file = await encodeProject(p);
  const text = JSON.stringify(file);
  assert.ok(!text.includes('"swaps":{}'));
  const q = await decodeProject(text);
  assert.deepEqual([...q.swaps.keys()].sort((a, b) => a - b), [3, 12]);
  assert.deepEqual(q.swaps.get(12), p.swaps.get(12));
  assert.deepEqual(q.swaps.get(3), p.swaps.get(3));
  assert.equal(q.sources.get(12), 'snare.wav');
  assert.deepEqual([...q.noTrim], [3]);
  assert.deepEqual(q.trim, p.trim);
  assert.deepEqual(q.models, ['a', 'b']);
  assert.deepEqual(q.layout, p.layout);
  assert.equal(JSON.stringify(await encodeProject(q)), text, 'export is stable');
  assert.equal(osProblem(q.os, baseLike()), null);
  assert.match(osProblem(q.os, baseLike({ ...OS, dsp2_sha256: 'd'.repeat(64) }))!, /different OS X\.13 file/);
  assert.match(osProblem(q.os, baseLike({ ...OS, base: 'x14', name: 'OS X.14' }))!, /made for OS X\.13/);
  const bad = JSON.parse(text);
  bad.samples.swaps[0].sha256 = '0'.repeat(64);
  await assert.rejects(decodeProject(JSON.stringify(bad)), /sha256/);
  await assert.rejects(decodeProject('{"format":"md-layout/1"}'), /not a kitbasher-project\/1/);
  // MIDI chromatic note input: absent means off, and a file without it reads back without it
  assert.equal(q.midiChroma, undefined);
  assert.ok(!text.includes('midi_chroma'));
  const on = await encodeProject({ ...p, midiChroma: true });
  assert.equal(on.midi_chroma, true);
  assert.equal((await decodeProject(JSON.stringify(on))).midiChroma, true);
  assert.ok(!JSON.stringify(await encodeProject({ ...p, midiChroma: false })).includes('midi_chroma'));
  await assert.rejects(decodeProject(JSON.stringify({ ...on, midi_chroma: 'yes' })), /midi_chroma/);
});

test('a swapped first sample shorter than its partner is padded at any length; the stock pair rule is unchanged', () => {
  const flat = new Array<number>(30000).fill(500);
  const b = bank([tone(44100), flat], [0, 1]);                       // first 1.0 s, partner 0.68 s
  const opt: TrimOptions = { db: -20, minSeconds: 0.5, cap: null };
  // stock: the trimmed first sample shortens its partner, as before
  const stock = trimBank(b.seg, SEG, TABLE, 2, b.end, opt);
  assert.equal(stock.report[1].for_partner, 0);
  assert.ok(stock.report[1].new_words < 15000);
  // swapped, too short to be trimmed (0.34 s) and long enough to be trimmed (0.59 s): both padded
  for (const n of [15000, 26000]) {
    const s = applySwaps(b.seg, SEG, TABLE, 2, b.end, new Map([[0, tone(n)]]));
    const t = trimBank(s.words, SEG, TABLE, 2, s.end, opt, new Set(), new Set([0]));
    assert.equal(t.report[0].padded_for, 1, `${n}: first padded`);
    assert.equal(t.report[0].new_words, 15000, `${n}: to the partner's length`);
    assert.equal(t.report[1].new_words, 15000, `${n}: partner whole`);
    assert.equal(t.report[1].for_partner, undefined, `${n}: partner not cut`);
  }
});
