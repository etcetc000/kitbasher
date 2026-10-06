// web/src/convert.ts without a browser: mixdown, silence trim, normalise, the cap and its fade,
// 12-bit TPDF quantisation, and reading the source rate from WAV and AIFF headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../web/src/convert.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { processAudio, headerRate, CUT_FADE } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

const half = () => 0.5;          // no dither: random() - random() = 0
const ramp = (n, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin(i / 5));

test('stereo is mixed to mono and quantised to 12 bits', () => {
  const l = Float32Array.from([0.5, -0.5, 1, 0]), r = Float32Array.from([0.5, 0.5, 1, 0]);
  const c = processAudio([l, r], 100, { normalise: false, trimSilence: false }, half);
  assert.deepEqual([...c.data], [1024, 0, 2047, 0]);
  assert.ok(c.notes.some((n) => /2 channels mixed to mono/.test(n)));
  assert.equal(c.cut, false);
});

test('normalise brings the peak to full scale; silence at both ends is trimmed', () => {
  const x = new Float32Array(300);
  x.set(ramp(100, 0.25), 100);
  const c = processAudio([x], 1000, { normalise: true, trimSilence: true }, half);
  assert.ok(c.data.length <= 100 && c.data.length > 90);
  assert.equal(Math.max(...c.data.map(Math.abs)), 2046, 'full scale less one step, for the dither');
  assert.ok(c.notes.some((n) => /normalised \(\+12\.0 dB\)/.test(n)), c.notes.join('; '));
  assert.ok(!c.notes.some((n) => /clipped/.test(n)));
  assert.ok(c.notes.some((n) => /silence trimmed/.test(n)));
});

test('longer than the stock entry: cut to it with a fade to silence, and said so', () => {
  const x = new Float32Array(5000).fill(0.5);
  const c = processAudio([x], 1000, { normalise: false, trimSilence: false }, half);
  assert.equal(c.data.length, 1000);
  assert.equal(c.cut, true);
  assert.equal(c.data[1000 - CUT_FADE - 1], 1024);
  assert.equal(c.data[999], 0);
  assert.ok(c.data[1000 - CUT_FADE / 2] < 1024 && c.data[1000 - CUT_FADE / 2] > 0);
  assert.ok(c.notes.some((n) => /cut from 0\.113 s to 0\.023 s/.test(n)), c.notes.join('; '));
});

test('TPDF dither stays within one step and averages out', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const x = new Float32Array(20000).fill(0.3 / 2047);       // 0.3 of a 12-bit step
  const c = processAudio([x], 1e6, { normalise: false, trimSilence: false }, rnd);
  assert.ok(c.data.every((v) => v >= -1 && v <= 2));
  const mean = c.data.reduce((a, v) => a + v, 0) / c.data.length;
  assert.ok(Math.abs(mean - 0.3) < 0.05, `mean ${mean}`);
});

test('silent or empty audio is refused', () => {
  assert.throws(() => processAudio([new Float32Array(10)], 100, { normalise: true, trimSilence: true }), /silent/);
  assert.throws(() => processAudio([], 100, { normalise: true, trimSilence: true }), /no audio/);
});

test('the source rate is read from WAV and AIFF headers', () => {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt32LE(48000, 24); wav.write('data', 36);
  assert.equal(headerRate(new Uint8Array(wav)), 48000);
  const aiff = Buffer.alloc(12 + 8 + 18);
  aiff.write('FORM', 0); aiff.write('AIFF', 8); aiff.write('COMM', 12); aiff.writeUInt32BE(18, 16);
  // 44100 as an 80-bit extended float: exponent 16383 + 15, mantissa 0xAC44 << 48
  aiff.writeUInt16BE(16383 + 15, 28); aiff.writeUInt32BE(0xac440000, 30);
  assert.equal(headerRate(new Uint8Array(aiff)), 44100);
  assert.equal(headerRate(new Uint8Array(16)), null);
});
