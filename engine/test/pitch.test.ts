import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkPack, words, type Pack, type PackModel } from '../src/packs.js';
import { describeModel } from '../src/sound_catalog.js';
import { checkPitch, hzMidi, midiHz, noteName, noteToRaw, rawToNote, resolvePitch, type Pitch } from '../src/pitch.js';

const SR = 44100;
const QUARTER: Pitch = { knob: 0, law: 'quarter', steps: 2, base_note: 24 };
const cents = (a: number, b: number): number => 1200 * Math.log2(a / b);

const packs: Pack[] = readdirSync('catalog').filter(f => f.endsWith('.json') && f !== 'core.json')
  .map(f => JSON.parse(readFileSync(`catalog/${f}`, 'utf8')) as Pack);
const models: PackModel[] = packs.flatMap(p => p.models);
const shared = new Map(packs.flatMap(p => p.shared.map(t => [t.name, t] as const)));
const byKey = (key: string): PackModel => models.find(m => m.key === key) ?? assert.fail(`no ${key} in catalog`);
// a model's own table, or a family shared table its code reads (OSCSW / OSCPW / VOXVO: sw_pinc)
const table = (m: PackModel, name: string): number[] =>
  words((m.tables.find(t => t.name === name) ?? (m.uses_shared.includes(name) ? shared.get(name) : undefined)
    ?? assert.fail(`${m.key}: no table ${name}`)).words);

test('raw <-> note: raw = 2 (MIDI - 24), C3 = 60, clamped ranges, relative and by_mode', () => {
  assert.equal(rawToNote(0, QUARTER), 24);
  assert.equal(rawToNote(72, QUARTER), 60);
  assert.equal(rawToNote(127, QUARTER), 87.5);
  assert.deepEqual(noteToRaw(60, QUARTER), { raw: 72, clamped: false, note: 60 });
  assert.deepEqual(noteToRaw(87.5, QUARTER), { raw: 127, clamped: false, note: 87.5 });
  assert.deepEqual(noteToRaw(88, QUARTER), { raw: 127, clamped: true, note: 87.5 });
  assert.deepEqual(noteToRaw(23, QUARTER), { raw: 0, clamped: true, note: 24 });
  const narrow: Pitch = { ...QUARTER, range: [12, 127] };
  assert.deepEqual(noteToRaw(29, narrow), { raw: 12, clamped: true, note: 30 });
  assert.equal(rawToNote(0, narrow), 30);
  const rel: Pitch = { knob: 0, law: 'relative', steps: 2, center: 64 };
  assert.equal(rawToNote(66, rel), 1);
  assert.deepEqual(noteToRaw(-1, rel), { raw: 62, clamped: false, note: -1 });
  const modes: Pitch = { ...QUARTER, mode_knob: 2, by_mode: [{ zone: 1, base_note: 10 }, { zone: 2, law: 'none' }] };
  assert.deepEqual(noteToRaw(20, modes, 1), { raw: 20, clamped: false, note: 20 });
  assert.deepEqual(noteToRaw(20, modes, 0), { raw: 0, clamped: true, note: 24 });
  assert.equal(rawToNote(40, modes, 2), null);
  assert.throws(() => noteToRaw(60, modes, 2), /no note mapping/);
  assert.equal(noteName(60), 'C3');
  assert.equal(noteName(24), 'C0');
  assert.equal(noteName(60.5), 'C3+');
  assert.equal(noteName(0), 'C-2');
  for (let n = 24; n <= 87; n++) assert.equal(rawToNote(noteToRaw(n, QUARTER).raw, QUARTER), n);
  assert.ok(Math.abs(hzMidi(midiHz(57.25)) - 57.25) < 1e-9);
});

test('pitch metadata is validated against the panel', () => {
  const panel = { knobs: ['PTCH', 'DEC', 'MODE', 'TONE', '', '', '', ''].map(label => ({ label })),
    modes: [{ knob: 2, zones: [{ min: 0, labels: { '2': 'A' } as Record<string, string> }, { min: 64, labels: { '0': 'TONE', '2': 'B' } }] }] };
  const good: Pitch = { ...QUARTER, mode_knob: 2, by_mode: [{ zone: 1, law: 'none' }] };
  checkPitch(good, panel);
  assert.throws(() => checkPitch(QUARTER, panel), /relabels the pitch knob TONE without a by_mode row/);
  assert.throws(() => checkPitch({ ...good, by_mode: [{ zone: 1, base_note: 3 }] }, panel), /keeps law quarter/);
  assert.throws(() => checkPitch({ ...good, by_mode: [{ zone: 2, law: 'none' }] }, panel), /by_mode zone/);
  assert.throws(() => checkPitch({ ...good, mode_knob: 3 }, panel), /names no MODE selector/);
  assert.throws(() => checkPitch({ ...QUARTER, knob: 3, mode_knob: 2, by_mode: [{ zone: 1, law: 'none' }] }, panel), /not a pitch caption/);
  assert.throws(() => checkPitch({ ...QUARTER, steps: 1 }, { knobs: panel.knobs, modes: [] }), /quarter needs steps 2/);
  assert.throws(() => checkPitch({ ...QUARTER, range: [40, 20] }, { knobs: panel.knobs, modes: [] }), /range/);
  assert.throws(() => checkPitch({ ...QUARTER, extra: 1 } as unknown as Pitch, { knobs: panel.knobs, modes: [] }), /unknown key/);
  checkPitch({ knob: null, law: 'none' }, { knobs: panel.knobs, modes: [] });
});

test('every bundled pack, pitch included, passes the pack checks', () => {
  for (const p of packs) checkPack(p);
});

test('every synth, FM, wavetable, vocal and physical model declares a pitch law', () => {
  const tonal = ['Synths', 'FM synthesis', 'Wavetables', 'Vocal', 'Physical modeling'];
  for (const m of models) {
    if (!tonal.includes(describeModel(m).category)) continue;
    assert.ok(m.pitch && m.pitch.law !== 'none', `${m.name}: no pitch law`);
  }
});

test('every absolute-pitch model uses the shared quarter law', () => {
  for (const m of models) {
    if (!m.pitch || !['quarter', 'chromatic'].includes(m.pitch.law)) continue;
    assert.equal(m.pitch.law, 'quarter', m.name);
    assert.equal(m.pitch.steps, 2, m.name);
    assert.equal(m.pitch.base_note, 24, m.name);
    assert.equal(m.defaults[m.pitch.knob!] % 2, 0, `${m.name}: default PTCH is not a semitone`);
  }
});

// What the DSP actually plays at a raw value, decoded from the bundled table words with each
// model's own word -> Hz scale and index law (read from its dsp2.asm).
type Decoder = (m: PackModel, raw: number, zone?: number) => number;
const interp = (w: number[], x: number): number => {
  const i = Math.min(Math.max(Math.floor(x), 0), 127), f = Math.min(Math.max(x, 0), 127) - i;
  return w[i] + f * (w[i + 1] - w[i]);
};
const DECODE: Record<string, Decoder> = {
  'OSC/SP': (m, r) => (table(m, 'pitch')[r] >> 4) / 2 ** 24 * SR,        // asr #4: phase increment
  'VOX/FR': (m, r) => table(m, 'pitch')[r] / 2 ** 24 * SR,
  'OSC/AC': (m, r) => table(m, 'pitch')[r] / 16 / 2 ** 24 * SR,          // asr 5, x ratio 1/8, asl 4 x 2
  'WAV/SP': (m, r) => table(m, 'pitch')[r] / 32 / 2 ** 24 * SR,          // asr #5
  'FMS/4O': (m, r) => table(m, 'pitch')[r] / 2 ** 23 * SR,
  'PHY/KS': (m, r) => SR / (table(m, 'period')[r] / 4096),               // whole loop delay, 12 fraction bits
  'VAD/BD': (m, r) => table(m, 'e0_finc')[r] / 2 ** 24 * SR,
  'VAD/SD': (m, r) => table(m, 'e0_finc')[r] / 2 ** 24 * SR,
  'VAD/RC': (m, r) => table(m, 'e0_finc')[r] / 2 ** 24 * SR,
  // VADPC and VADSY read their chromatic table at MIDI = 24 + raw / 2 (+ the mode's own offset,
  // word 14 of the mode record), interpolating linearly between semitones.
  'VAD/PC': (m, r, z) => {
    const rec = table(m, 'e0_mrec'), ofs = ((rec[20 * z! + 14] << 8) >> 8) / 65536;
    return interp(table(m, 'e0_finc'), 24 + ofs + r / 2) / 2 ** 24 * SR;
  },
  'VAD/SY': (m, r) => interp(table(m, 'e0_osc_pitch'), 24 + r / 2) / 2 ** 24 * SR,
  // The compiled Monomachine ports (synths.json), at their table word scales.
  'FMS/2O': (m, r) => table(m, 'pinc')[r] / 2 ** 23 * SR,                // 2 f / (2 SR) at 2x oversampling
  'FMS/3O': (m, r) => table(m, 'pinc')[r] / 2 ** 23 * SR,
  'FMS/SW': (m, r) => table(m, 'pinc')[r] / 2 ** 23 * SR,
  'OSC/SW': (m, r) => table(m, 'sw_pinc')[r] / 2 ** 23 * SR,
  'OSC/PW': (m, r) => table(m, 'sw_pinc')[r] / 2 ** 23 * SR,
  'VOX/VO': (m, r) => table(m, 'sw_pinc')[r] / 2 ** 23 * SR,
  'WAV/TB': (m, r) => table(m, 'wv_inc')[r] / 2 ** 22 * SR,
  'WAV/CH': (m, r) => table(m, 'dn_inc')[r] / 2 ** 24 * SR,
  'OSC/CH': (m, r) => 2 * table(m, 'en_inc')[r] / 2 ** 23 * SR,
  // OSC8B and WAVMR hold the Monomachine's own pitch word, 2048 a octave from MIDI -2: decoded in
  // the word domain (the native exponent table adds at most 0.7 c, held by the firmware pitch gate)
  'OSC/8B': (m, r) => midiHz(table(m, 'sid_note')[r] * 12 / 2048 - 2),
  'WAV/MR': (m, r) => midiHz(table(m, 'dw_note')[r] * 12 / 2048 - 2),
};

test('a declared pitch table steps by the law: 50 c a raw inside the range, held outside it', () => {
  for (const m of models) {
    if (!m.pitch?.table || m.pitch.by_mode) continue;
    const [lo, hi] = m.pitch.range ?? [0, 127];
    const tol = m.pitch.tolerance_cents ?? 2;
    // decoded through the model's own word -> Hz law (PHYKS holds a delay, OSC8B / WAVMR a pitch word)
    const hz = (r: number): number => (DECODE[m.key] ?? assert.fail(`${m.key}: no decoder`))(m, r);
    for (let r = 0; r < 127; r++) {
      const step = cents(hz(r + 1), hz(r));
      if (r >= lo && r < hi) assert.ok(Math.abs(step - 100 / m.pitch.steps!) <= tol, `${m.name} raw ${r}: ${step.toFixed(2)} c`);
      else assert.ok(Math.abs(step) < 1e-9, `${m.name}: raw ${r + 1} is outside the range and must hold`);
    }
  }
});

test('every note of every pitched model: noteToRaw lands within 2 cents of the note', () => {
  const report: string[] = [];
  for (const m of models) {
    const p = m.pitch;
    if (!p || !['quarter', 'chromatic'].includes(p.law)) continue;
    const decode = DECODE[m.key] ?? assert.fail(`${m.key}: pitched but no decoder in this test`);
    const zones = p.by_mode ? m.dyn_labels.find(d => d.knob === p.mode_knob)!.stops : 1;
    for (let z = 0; z < zones; z++) {
      const zone = p.by_mode ? z : undefined;
      const law = resolvePitch(p, zone).law;
      if (law === 'none') continue;
      const tol = resolvePitch(p, zone).tolerance_cents ?? 2;
      let worst = 0; const clamped: number[] = [];
      for (let note = 0; note < 128; note++) {
        const { raw, clamped: c } = noteToRaw(note, p, zone);
        if (c) { clamped.push(note); continue; }
        worst = Math.max(worst, Math.abs(cents(decode(m, raw, z), midiHz(note))));
      }
      assert.ok(worst <= tol, `${m.name} zone ${z}: ${worst.toFixed(3)} c`);
      report.push(`${m.name}${zones > 1 ? ` zone ${z}` : ''}: max ${worst.toFixed(3)} c; clamped notes ` +
        `${clamped.length ? `${clamped.filter(n => n < 64).length} below, ${clamped.filter(n => n >= 64).length} above` : 'none'}`);
      // and every raw plays what rawToNote says (quarter tones included)
      for (let raw = 0; raw < 128; raw++) {
        const want = rawToNote(raw, p, zone)!;
        assert.ok(Math.abs(cents(decode(m, raw, z), midiHz(want))) <= tol, `${m.name} raw ${raw}`);
      }
    }
  }
  console.log(report.join('\n'));
});
