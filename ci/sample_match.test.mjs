// web/src/sample-match.ts: which E12 machine a dropped file is for, from its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../web/src/sample-match.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { matchName, matchFiles, words, E12_CODES } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

const code = (n) => matchName(n).code;

test('words: extension, punctuation, digits and camelCase split', () => {
  assert.deepEqual(words('Kits/909/OpenHat_02.WAV'), ['open', 'hat']);
  assert.deepEqual(words('TR808-Snare1.aif'), ['tr', 'snare']);
  assert.deepEqual(words('bd.wav'), ['bd']);
});

test('the names in the brief map to their machines', () => {
  const cases = {
    'kick.wav': 'BD', 'BD 01.wav': 'BD', 'Bass Drum.aif': 'BD',
    'snare.wav': 'SD', 'sd_tight.wav': 'SD',
    'hi tom.wav': 'HT', 'HT.wav': 'HT', 'tom hi.wav': 'HT', 'High Tom 2.aiff': 'HT',
    'lo tom.wav': 'LT', 'lt.wav': 'LT', 'Low-Tom.wav': 'LT',
    'clap.wav': 'CP', 'cp.wav': 'CP',
    'rim.wav': 'RS', 'rs.wav': 'RS', 'snare rim.wav': 'RS',
    'cowbell.wav': 'CB', 'cb.wav': 'CB',
    'closed.wav': 'CH', 'ch.wav': 'CH', 'chh.wav': 'CH', 'hat.wav': 'CH', 'HiHat.wav': 'CH',
    'open.wav': 'OH', 'oh.wav': 'OH', 'ohh.wav': 'OH', 'open hat.wav': 'OH', 'hat open.wav': 'OH', 'OpenHiHat.wav': 'OH',
    'ride.wav': 'RC', 'rc.wav': 'RC', 'crash.wav': 'CC', 'cc.wav': 'CC',
    'br.wav': 'BR', 'brush.wav': 'BR', 'tamb.wav': 'TA', 'Tambourine.wav': 'TA', 'ta.wav': 'TA',
    'tr.wav': 'TR', 'shaker.wav': 'SH', 'sh.wav': 'SH', 'bc.wav': 'BC',
  };
  for (const [name, want] of Object.entries(cases)) assert.equal(code(name), want, name);
});

test('no guess when the name says nothing, or only "tom"', () => {
  for (const n of ['vox.wav', 'tom.wav', 'loop 120.wav', '01.wav']) assert.equal(code(n), null, n);
  assert.equal(matchName('01.wav').why, 'no name to go by');
});

test('a layer is named as such', () => {
  assert.deepEqual(matchName('snare noise.wav'), { name: 'snare noise.wav', code: 'SD', part: 'layer' });
  assert.equal(matchName('snare.wav').part, 'main');
});

test('a set: non-audio and second files for a taken machine stay unmatched', () => {
  const got = matchFiles(['kick.wav', 'kick 2.wav', 'notes.txt', 'snare.wav', 'snare ring.wav', 'perc.wav']);
  assert.deepEqual(got.map((m) => m.code), ['BD', null, null, 'SD', 'SD', null]);
  assert.match(got[1].why, /BD is already taken by kick\.wav/);
  assert.match(got[2].why, /not a WAV or AIFF/);
  assert.equal(got[4].part, 'layer');
});

test('every code is in Machinedrum order', () => {
  assert.deepEqual([...E12_CODES], ['BD', 'SD', 'HT', 'LT', 'CP', 'RS', 'CB', 'CH', 'OH', 'RC', 'CC', 'BR', 'TA', 'TR', 'SH', 'BC']);
});
