// web/src/sample-fill.ts: dropped files fill the pads in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../web/src/sample-fill.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { naturalSort, fillInOrder, AUDIO_EXT } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

// the stock map: SD and RS both play sample 12 as their main
const MAIN = { BD: 7, SD: 12, HT: 17, LT: 18, CP: 1, RS: 12, CB: 2, CH: 4, OH: 8, RC: 9, CC: 3, BR: 20, TA: 16, TR: 19, SH: 14, BC: 6 };
const SLOTS = Object.entries(MAIN).map(([pad, entry]) => ({ pad, entry }));
const pads = (r) => r.placed.map((p) => p.pad);

test('natural order: numbers as numbers, case aside', () => {
  assert.deepEqual(naturalSort(['Kick 10.wav', 'kick 2.wav', 'Kick 1.wav', 'clap.wav']), ['clap.wav', 'Kick 1.wav', 'kick 2.wav', 'Kick 10.wav']);
  assert.deepEqual(naturalSort(['AB Perc 73.WAV', 'AB Perc 5.WAV', 'AB Perc 68.WAV']), ['AB Perc 5.WAV', 'AB Perc 68.WAV', 'AB Perc 73.WAV']);
});

test('from BD: grid order, the shared sample filled once (RS skipped after SD)', () => {
  const r = fillInOrder(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'], SLOTS);
  assert.deepEqual(pads(r), ['BD', 'SD', 'HT', 'LT', 'CP', 'CB', 'CH', 'OH', 'RC']);
  assert.deepEqual(r.extra, []);
  assert.equal(new Set(r.placed.map((p) => p.entry)).size, r.placed.length, 'no sample twice');
});

test('from a pad: starts there; RS takes the shared sample when SD is not reached', () => {
  const r = fillInOrder(['a', 'b', 'c'], SLOTS, SLOTS.findIndex((s) => s.pad === 'CP'));
  assert.deepEqual(pads(r), ['CP', 'RS', 'CB']);
  assert.equal(r.placed[1].entry, 12);
});

test('more files than pads left: the rest are extras, in order', () => {
  const r = fillInOrder(['x 3', 'x 1', 'x 2', 'x 10'], SLOTS, SLOTS.findIndex((s) => s.pad === 'SH'));
  assert.deepEqual(r.placed.map((p) => `${p.pad}<-${p.name}`), ['SH<-x 1', 'BC<-x 2']);
  assert.deepEqual(r.extra, ['x 3', 'x 10']);
});

test('15 distinct samples: sixteen files from BD leave one extra', () => {
  const names = Array.from({ length: 16 }, (_, i) => `s ${i + 1}`);
  const r = fillInOrder(names, SLOTS);
  assert.equal(r.placed.length, 15);
  assert.deepEqual(r.extra, ['s 16']);
  assert.ok(!pads(r).includes('RS'));
});

test('audio extensions', () => {
  for (const n of ['a.wav', 'B.WAV', 'c.aif', 'd.AIFF', 'e.aifc']) assert.ok(AUDIO_EXT.test(n), n);
  for (const n of ['a.mp3', 'kit.kitbasher.json', 'readme.txt']) assert.ok(!AUDIO_EXT.test(n), n);
});
