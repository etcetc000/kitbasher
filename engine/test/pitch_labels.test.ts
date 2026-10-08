// Pitch note names (engine/src/pitch_labels.ts): the cells, the table, the routine run in the
// interpreter (engine/test/cf_interp.ts) for every catalog model, raw and MODE stop, and, with
// firmware, discovery on every profiled base and the real knob-value painter of X.14 and OS 1.63
// running into the routine and the OS's own string draw, read back off the framebuffer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hex } from '../src/bytes.js';
import { codeImages, NotPatchable, resolveBase, type Base, type Resolved } from '../src/bases.js';
import { readFirmware } from '../src/container.js';
import { decodeProject, encodeProject } from '../src/project.js';
import { loadBases } from '../src/node.js';
import type { CorePack, Pack, PackModel } from '../src/packs.js';
import { noteName, rawToNote, type Pitch } from '../src/pitch.js';
import { prepare163 } from '../src/prepare.js';
import { ramImage } from '../src/plan.js';
import type { Selected } from '../src/selection.js';
import { findSig } from '../src/sig.js';
import {
  assemble, buildLabelTable, cellsOf, cellText, checkLabelCode, expectedLabel, findPitchLabels, labelCallees, labelLaw, labelPatches,
  lookup, NoPitchLabels, pitchLabelValues, PITCH_LABEL_SIGNATURES, Q_MAX, QUARTER, QUARTER_SHARP,
  type LabelModel, type LabelTable, type PitchLabelSite,
} from '../src/pitch_labels.js';
import { Cpu } from './cf_interp.js';

const packs: Pack[] = readdirSync('catalog').filter((f) => f.endsWith('.json') && f !== 'core.json')
  .map((f) => JSON.parse(readFileSync(`catalog/${f}`, 'utf8')) as Pack);
const models: PackModel[] = packs.flatMap((p) => p.models);
const catalog: LabelModel[] = models.map((m, i) => ({ id: 20 + i, name: m.name.trim(), pitch: m.pitch, dyn_labels: m.dyn_labels }));

// X.14's and OS 1.63's addresses (the firmware tests below check discovery finds exactly these)
const S: PitchLabelSite = {
  painter: 0x228a24, call: 0x22999e, site: 0x2299a0, draw: 0x211384, width: 0x211634, font: 0x259954,
  page: 0x2818de, track: 0x2818da, machineIds: 0x7001aa, kitParams: 0x70001a,
};
const ORG = 0x2bcb1c;
const QUARTER_LAW: Pitch = { knob: 0, law: 'quarter', steps: 2, base_note: 24 };
const stops = (n: number): number[] => Array.from({ length: 128 }, (_, r) => Math.floor((r * n) / 128));
/** a MODE plan on knob 3 whose stops relabel knob 3 itself: "MD00", "MD01", ... (or all alike) */
const modePlan = (n: number, alike = false): LabelModel['dyn_labels'] => [{
  knob: 2, mask: [2], stop_of: stops(n),
  blocks: Buffer.from(Array.from({ length: n }, (_, z) => `MD${alike ? '00' : String(z).padStart(2, '0')}`).join('')).toString('base64'),
}];

// ---- the cells -----------------------------------------------------------------------------------

test('the cells: DEV\'s letter, accidental and octave, MIDI 60 = C3, quarter tones as one glyph', () => {
  const t = (q: number): string => cellText(cellsOf(q));
  assert.equal(t(48), 'C-0');          // raw 0 of the shared law: MIDI 24
  assert.equal(t(120), 'C-3');         // raw 72: MIDI 60
  assert.equal(t(121), 'C+3');         // raw 73: a quarter tone above C3
  assert.equal(t(122), 'C#3');
  assert.equal(t(123), 'C‡3');         // a quarter tone above C#3
  assert.equal(t(175), 'D‡5');         // raw 127: MIDI 87.5
  assert.equal(t(0), 'C--2');          // MIDI 0: the octave's sign takes a cell
  assert.equal(t(46), 'B--1');
  assert.equal(t(Q_MAX), 'B+9');
  assert.throws(() => cellsOf(-1));
  assert.throws(() => cellsOf(Q_MAX + 1));
  assert.deepEqual(cellsOf(121), { letter: 'C', acc: QUARTER, octave: '3' });
  assert.deepEqual(cellsOf(123), { letter: 'C', acc: QUARTER_SHARP, octave: '3' });
  // the same note as engine/src/pitch.ts noteName, written as the cells write it
  for (let q = 0; q <= Q_MAX; q++) {
    const n = noteName(q / 2);
    const m = /^([A-G])(#?)(-?\d+)(\+?)$/.exec(n)!;
    const acc = m[4] ? (m[2] ? '‡' : '+') : m[2] || '-';
    assert.equal(t(q), `${m[1]}${acc}${m[3]}`, `q ${q}: ${n}`);
  }
});

test('the label of every raw follows engine/src/pitch.ts rawToNote, with its range clamp', () => {
  const p: Pitch = { ...QUARTER_LAW, range: [10, 100] };
  for (let raw = 0; raw < 128; raw++) {
    const note = rawToNote(raw, p)!;
    assert.equal(expectedLabel(p, raw), cellText(cellsOf(2 * note)));
  }
  assert.equal(expectedLabel(p, 0), expectedLabel(p, 10));
  assert.equal(expectedLabel(p, 127), expectedLabel(p, 100));
  assert.equal(expectedLabel({ knob: 0, law: 'relative', steps: 1, center: 64 }, 64), null);
  assert.equal(expectedLabel({ knob: 0, law: 'continuous', cents_per_step: 37.5 }, 64), null);
  assert.equal(expectedLabel({ knob: null, law: 'none' }, 64), null);
});

test('the laws a label can show, and why the others cannot', () => {
  assert.deepEqual(labelLaw(QUARTER_LAW), { lo: 0, hi: 127, k: 1, q0: 48 });
  assert.deepEqual(labelLaw({ knob: 3, law: 'chromatic', steps: 1, base_note: 0, range: [0, 120] }), { lo: 0, hi: 120, k: 2, q0: 0 });
  assert.deepEqual(labelLaw({ ...QUARTER_LAW, base_note: -5, range: [10, 127] }), { lo: 10, hi: 127, k: 1, q0: 0 });
  assert.match(labelLaw({ ...QUARTER_LAW, base_note: -5 }) as string, /outside the octaves/);
  assert.match(labelLaw({ knob: 0, law: 'chromatic', steps: 1, base_note: 100 }) as string, /outside the octaves/);
  assert.match(labelLaw({ knob: 0, law: 'chromatic', steps: 1, base_note: 24.25 }) as string, /quarter-tone grid/);
  assert.equal(labelLaw({ knob: 0, law: 'relative', steps: 1, center: 64 }), 'relative law');
});

// ---- the table -----------------------------------------------------------------------------------

test('the catalog: every absolute pitch law gets note names; relative, continuous and missing laws keep their numbers', () => {
  const t = buildLabelTable(catalog, true);
  const shows = new Map(t.perModel.map((p) => [p.name, p.shows]));
  const labelled = [...shows].filter(([, s]) => s.startsWith('note names')).map(([n]) => n).sort();
  const want = models.filter((m) => m.pitch && ['quarter', 'chromatic'].includes(m.pitch.law)).map((m) => m.name.trim()).sort();
  assert.deepEqual(labelled, want);
  assert.equal(shows.get('VADCY'), 'its number (relative law)');
  assert.equal(shows.get('VADHH'), 'its number (relative law)');
  assert.equal(shows.get('NZEPL'), 'its number (continuous law)');
  assert.equal(shows.get('NFX4P'), 'its number (no pitch metadata)');
  assert.match(shows.get('VADPC')!, /follows knob 3: 6 MODE segments/);
  assert.match(shows.get('VADRC')!, /follows knob 3: 1 MODE segment, 1 of them with no note law/);
  // without dynamic labels a MODE change does not redraw the page: VADPC and VADRC keep their numbers
  const off = new Map(buildLabelTable(catalog, false).perModel.map((p) => [p.name, p.shows]));
  assert.match(off.get('VADPC')!, /^its number \(its pitch law changes with knob 3, and without dynamic knob labels/);
  assert.match(off.get('VADRC')!, /^its number/);
  assert.equal(off.get('VADBD'), 'note names on knob 1');
  // the plain machines (knob 1, law 0, no MODE segments) are a list of IDs; the others full entries
  const plain = t.entries.filter((e) => e.bytes.length === 4 && e.bytes[1] === 0 && e.bytes[2] === 0);
  assert.equal(t.table[plain.length], 0xff);
  assert.equal(t.table.length, plain.length + 1 + t.entries.filter((e) => !plain.includes(e)).reduce((n, e) => n + e.bytes.length, 0) + 1);
});

test('a MODE stop change must change a caption, or the model keeps its number', () => {
  const zoned: Pitch = { ...QUARTER_LAW, mode_knob: 2, by_mode: [{ zone: 1, base_note: 36 }, { zone: 2, law: 'none' }] };
  const t = (alike: boolean, dyn = true): string => buildLabelTable([{ id: 9, name: 'Z', pitch: zoned, dyn_labels: modePlan(3, alike) }], dyn).perModel[0].shows;
  assert.match(t(false), /^note names on knob 1 \(follows knob 3: 2 MODE segments, 1 of them with no note law/);
  assert.match(t(true), /^its number \(MODE stops 1 and 2, 1 and 3, 2 and 3 change its pitch law without changing a caption/);
  assert.match(t(false, false), /^its number \(its pitch law changes with knob 3/);
  // the same law on every stop: no redraw needed, labelled even without dynamic labels
  const same: Pitch = { ...QUARTER_LAW, mode_knob: 2, by_mode: [{ zone: 1, base_note: 24 }] };
  assert.equal(buildLabelTable([{ id: 9, name: 'Z', pitch: same, dyn_labels: modePlan(3, true) }], false).perModel[0].shows, 'note names on knob 1');
  // no MODE plan in the pack: no way to tell the stop
  assert.match(buildLabelTable([{ id: 9, name: 'Z', pitch: zoned }], true).perModel[0].shows, /whose MODE stops the pack does not carry/);
});

// ---- the routine executed ------------------------------------------------------------------------

const FONT = S.font, FB = 0x2ab836, Y = 33, STR = 0x00e00000;
interface Draw { font: number; fb: number; x: number; y: number; max: number; text: string }
interface Rig { cpu: Cpu; L: Record<string, number>; t: LabelTable; draws: Draw[] }

function rig(ms: LabelModel[], dyn = true): Rig {
  const t = buildLabelTable(ms, dyn), c = assemble(ORG, S, t), cpu = new Cpu();
  cpu.load(ORG, c.bytes);
  const r: Rig = { cpu, L: c.labels, t, draws: [] };
  const str = (a: number): string => { let s = ''; for (let k = 0; k < 8 && cpu.r8(a + k); k++) s += String.fromCharCode(cpu.r8(a + k)); return s; };
  cpu.stubs.set(S.draw, (x) => { r.draws.push({ font: x.arg(0), fb: x.arg(1), x: x.arg(2) | 0, y: x.arg(3), max: x.arg(4), text: str(x.arg(5)) }); });
  // the stock font's width: 3-pixel glyphs 1 apart (what the OS routine returns for "0".."127")
  cpu.stubs.set(S.width, (x) => { assert.equal(x.arg(0), FONT); assert.equal(x.arg(1), 0xffffffff); const n = str(x.arg(2)).length; x.d[0] = n ? 4 * n - 1 : 0; });
  return r;
}

/**
 * The painter's call, for the knob's value as the OS printed it: knob in d6, raw in d4, x centred on
 * the knob's column (0x39 + 20 * (knob & 3)) from the number's width. Returns what was drawn, the
 * text with our glyphs as '+' and '‡'. Every callee-saved register and the stack come back as they were.
 */
function paint(r: Rig, o: { id: number; knob: number; raw: number; track?: number; page?: number; modeKnob?: number; modeRaw?: number; text?: string }): { draws: Draw[]; text: string | null; x: number } {
  const { cpu } = r, track = o.track ?? 3, text = o.text ?? String(o.raw);
  cpu.w32(S.page, o.page ?? 0); cpu.w32(S.track, track);
  if (track < 16) cpu.w32(S.machineIds + 4 * track, o.id);
  if (o.modeKnob !== undefined) cpu.w8(S.kitParams + 24 * track + o.modeKnob, o.modeRaw!);
  cpu.load(STR, [...Array.from(text, (ch) => ch.charCodeAt(0)), 0]);
  const x = 0x39 + 20 * (o.knob & 3) - ((4 * text.length - 1) >> 1);
  for (let k = 0; k < 8; k++) cpu.d[k] = 0x1111 * (k + 1);
  for (let k = 0; k < 7; k++) cpu.a[k] = 0x10000 * (k + 1);
  cpu.d[4] = o.raw; cpu.d[6] = o.knob;
  const keep = [...cpu.d.slice(2), ...cpu.a.slice(2, 7)], sp = cpu.a[7];
  r.draws.length = 0;
  cpu.call(ORG, [FONT, FB, x, Y, 0xffffffff, STR]);
  assert.deepEqual([...cpu.d.slice(2), ...cpu.a.slice(2, 7)], keep, 'd2-d7 and a2-a6 kept');
  assert.equal(cpu.a[7], sp, 'the stack as it was');
  const draws = r.draws.map((d) => ({ ...d }));
  if (draws.length === 1) {
    assert.deepEqual(draws[0], { font: FONT, fb: FB, x, y: Y, max: 0xffffffff, text }, 'the number, drawn with the painter\'s own arguments');
    return { draws, text: null, x };
  }
  assert.equal(draws.length, 3, JSON.stringify(draws));
  for (const d of draws) assert.deepEqual([d.fb, d.y, d.max], [FB, Y, 0xffffffff]);
  const ours = r.L.font;
  const acc = draws[1].text === '\x01' ? '+' : draws[1].text === '\x02' ? '‡' : draws[1].text;
  assert.equal(draws[1].font, draws[1].text < ' ' ? ours : FONT, 'a quarter-tone glyph in our font, everything else in the stock one');
  assert.deepEqual([draws[0].font, draws[2].font], [FONT, FONT]);
  const label = `${draws[0].text}${acc}${draws[2].text}`;
  // centred where the number was: three cells from the centre - 5, four from the centre - 7
  const left = 0x39 + 20 * (o.knob & 3) - (draws[2].text.length > 1 ? 7 : 5);
  assert.deepEqual(draws.map((d) => d.x), [left, left + 4, left + 8], label);
  assert.equal(draws[0].text.length, 1); assert.equal(draws[1].text.length, 1);
  return { draws, text: label, x };
}

test('executed: every catalog model, every raw and every MODE stop draws what engine/src/pitch.ts says', () => {
  const r = rig(catalog);
  const labelled = new Set(r.t.entries.map((e) => e.id));
  let labels = 0, numbers = 0;
  for (const m of catalog) {
    const p = m.pitch;
    const plan = p?.by_mode ? m.dyn_labels?.find((d) => d.knob === p.mode_knob) : undefined;
    const modes = plan ? Array.from({ length: 128 }, (_, k) => k) : [0];
    for (const mode of modes) {
      const zone = plan ? plan.stop_of[mode] : undefined;
      for (let raw = 0; raw < 128; raw++) {
        for (const knob of [p?.knob ?? 0, ((p?.knob ?? 0) + 1) % 8]) {
          const got = paint(r, { id: m.id, knob, raw, modeKnob: p?.mode_knob, modeRaw: mode }).text;
          const want = labelled.has(m.id) && knob === p?.knob ? expectedLabel(p, raw, zone) : null;
          assert.equal(got, want, `${m.name} knob ${knob + 1} raw ${raw} MODE ${mode}`);
          if (got) labels++; else numbers++;
        }
      }
    }
  }
  assert.ok(labels > 20 * 128 && numbers > 20 * 128, `${labels} labels, ${numbers} numbers`);
});

test('executed: synthetic laws: chromatic over negative octaves, half-note bases, range clamps, a knob other than 1', () => {
  const ms: LabelModel[] = [
    { id: 11, name: 'CHRM', pitch: { knob: 3, law: 'chromatic', steps: 1, base_note: 0, range: [0, 120] } },
    { id: 12, name: 'HALF', pitch: { knob: 5, law: 'chromatic', steps: 1, base_note: 23.5, range: [0, 100] } },
    { id: 13, name: 'CLAMP', pitch: { ...QUARTER_LAW, knob: 7, range: [10, 100] } },
    { id: 14, name: 'HIGH', pitch: { knob: 0, law: 'chromatic', steps: 1, base_note: 100 } },
    { id: 15, name: 'ZONED', pitch: { ...QUARTER_LAW, mode_knob: 2, by_mode: [{ zone: 0, base_note: -5, range: [10, 127] }, { zone: 2, law: 'none' }, { zone: 3, law: 'chromatic', steps: 1, base_note: 12 }] },
      dyn_labels: modePlan(4) },
  ];
  const r = rig(ms);
  assert.deepEqual(r.t.perModel.map((p) => p.shows.split(' (')[0]), ['note names on knob 4', 'note names on knob 6', 'note names on knob 8', 'its number', 'note names on knob 1']);
  const seen = new Set<string>();
  for (const m of ms) {
    for (let mode = 0; mode < 128; mode += 32) {
      for (let raw = 0; raw < 128; raw++) {
        const got = paint(r, { id: m.id, knob: m.pitch!.knob!, raw, modeKnob: 2, modeRaw: mode }).text;
        const want = m.name === 'HIGH' ? null : expectedLabel(m.pitch!, raw, m.pitch!.by_mode ? stops(4)[mode] : undefined);
        assert.equal(got, want, `${m.name} raw ${raw} MODE ${mode}`);
        if (got) seen.add(got);
      }
    }
  }
  for (const s of ['C--2', 'C#-1', 'C-8', 'B+-1', 'C‡0', 'C--2', 'C-1', 'G#-1']) assert.ok(seen.has(s), s);
  assert.equal(paint(r, { id: 13, knob: 7, raw: 0 }).text, paint(r, { id: 13, knob: 7, raw: 10 }).text);
  assert.equal(paint(r, { id: 13, knob: 7, raw: 127 }).text, paint(r, { id: 13, knob: 7, raw: 100 }).text);
});

test('executed: the number stays where the label does not apply, drawn with the painter\'s own call', () => {
  const r = rig([{ id: 6, name: 'BD', pitch: QUARTER_LAW }]);
  assert.equal(paint(r, { id: 6, knob: 0, raw: 72 }).text, 'C-3');
  assert.equal(paint(r, { id: 6, knob: 1, raw: 72 }).text, null);               // another knob
  assert.equal(paint(r, { id: 6, knob: 0, raw: 72, page: 1 }).text, null);      // another page (AMP, EQ, ...)
  assert.equal(paint(r, { id: 6, knob: 0, raw: 72, track: 16 }).text, null);    // no track shown
  assert.equal(paint(r, { id: 7, knob: 0, raw: 72 }).text, null);               // another machine
  assert.equal(paint(r, { id: 1, knob: 0, raw: 72 }).text, null);               // a stock machine
  assert.equal(paint(r, { id: 6, knob: 0, raw: 0, text: '-' }).text, null);     // the painter had no value
  for (let track = 0; track < 16; track++) assert.equal(paint(r, { id: 6, knob: 0, raw: 74, track }).text, 'C#3');
});

test('the routine: ISA_A, branches only inside it, calls only the OS\'s string draw and width; one operand enters it', () => {
  const t = buildLabelTable(catalog, true), c = assemble(ORG, S, t);
  const cc = checkLabelCode(c.bytes, c.codeLen, ORG, S);
  assert.ok(cc.ok, cc.detail);
  assert.deepEqual([...new Set(cc.insns.filter((i) => i.target !== undefined && (i.target < ORG || i.target >= ORG + c.codeLen)).map((i) => i.target))].sort(), labelCallees(S).sort());
  assert.equal(c.labels.pl_draw, ORG);
  assert.equal(c.bytes.length % 4, 0);
  assert.deepEqual(labelPatches(S, c.labels), { patches: [[0x2299a0, ORG]], checks: [[0x2299a0, 0x211384]] });
  // a corrupted call is refused
  const bad = c.bytes.slice();
  const jsr = cc.insns.find((i) => i.name.startsWith('jsr') && i.target === S.width)!;
  bad[jsr.at - ORG + 5] ^= 4;
  assert.ok(!checkLabelCode(bad, c.codeLen, ORG, S).ok);
  // the bytes used for the full catalog, as documented
  assert.equal(c.codeLen, 518);
  assert.equal(c.bytes.length - c.codeLen, 158);
});

test('the RAM image: off is exactly as before; on appends the routine and nothing else changes', () => {
  const core = JSON.parse(readFileSync('catalog/core.json', 'utf8')) as CorePack;
  const main = new Uint8Array(0x60000);
  const base = {
    id: 'x14', ext: { base: 0x2bc000, end: 0x2bd000 },
    os: { cfBase: 0x200000, descriptorSize: 0x3a, familyTable: 0x252396, uwMenu: null,
          levBar: { low: { ids: [0x5e, 0x5f] }, high: { ids: [0xa8, 0xaf] }, ctr: { ids: [0x7c, 0x7f] } } },
    features: { dynLabels: null, hostSend: null, midiChroma: null, pitchLabels: S },
  } as unknown as Base;
  main.set(hex('4d4f444500252d00'), 0x52396);
  const syn = models.filter((m) => m.pitch).slice(0, 6);
  const sel = syn.map((m, i) => ({ m, family: 'F', id: 100 + i, preferred: 100 + i, mapped: false })) as Selected[];
  const fams = [{ name: 'F', models: syn }];
  const opt = { dyn: false, dsp1: null, host: false, toFlash: new Set<string>(), dynFlash: new Set<string>(), idSpace: 0xc0, flashAt: 0, redrawValues: 0, ind: null };
  const off = ramImage(base, main, core, fams, sel, opt);
  assert.deepEqual(ramImage(base, main, core, fams, sel, { ...opt, labels: null }).image, off.image);
  assert.equal(off.pitchLabels, null);
  const on = ramImage(base, main, core, fams, sel, { ...opt, labels: S });
  assert.ok(on.pitchLabels);
  assert.deepEqual(on.image.subarray(0, off.image.length), off.image);
  assert.equal(on.pitchLabels.at, 0x2bc000 + off.image.length);
  assert.deepEqual(on.image.subarray(off.image.length), on.pitchLabels.code.bytes);
  // no machine with a note law: no routine, nothing appended
  const none = models.filter((m) => !m.pitch || m.pitch.law === 'relative').slice(0, 2);
  const selNone = none.map((m, i) => ({ m, family: 'F', id: 100 + i, preferred: 100 + i, mapped: false })) as Selected[];
  const a = ramImage(base, main, core, [{ name: 'F', models: none }], selNone, opt);
  const b = ramImage(base, main, core, [{ name: 'F', models: none }], selNone, { ...opt, labels: S });
  assert.equal(b.pitchLabels, null);
  assert.deepEqual(b.image, a.image);
});

test('a project keeps the choice: pitch_labels true, or absent for off', async () => {
  const p = { os: { base: 'x14', name: 'X.14', tag: 'X14 ', coldfire_sha256: 'a', dsp2_sha256: 'b', dsp1_sha256: 'c' },
    swaps: new Map(), sources: new Map(), noTrim: new Set<number>(), trim: { mode: 'auto' as const, db: -30, cap: 0.55 }, models: ['VADBD'], layout: null };
  const off = await encodeProject(p);
  assert.ok(!JSON.stringify(off).includes('pitch_labels'));
  assert.equal((await decodeProject(JSON.stringify(off))).pitchLabels, undefined);
  const on = await encodeProject({ ...p, pitchLabels: true });
  assert.equal(on.pitch_labels, true);
  assert.equal((await decodeProject(JSON.stringify(on))).pitchLabels, true);
  for (const bad of [false, 1, 'on']) await assert.rejects(decodeProject(JSON.stringify({ ...on, pitch_labels: bad })), /pitch_labels must be true or absent/);
});

test('the TypeScript lookup is the routine\'s table read', () => {
  const t = buildLabelTable(catalog, true);
  const pc = catalog.find((m) => m.name === 'VADPC')!;
  assert.equal(lookup(t, pc.id, 0, 10, 0), 'C--2');
  assert.equal(lookup(t, pc.id, 0, 10, 22), 'G#-2');
  assert.equal(lookup(t, pc.id, 1, 10, 22), null);
  const rc = catalog.find((m) => m.name === 'VADRC')!;
  assert.equal(lookup(t, rc.id, 0, 72, 0), 'C-3');
  assert.equal(lookup(t, rc.id, 0, 72, 100), null);
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

test('firmware: discovery finds the painter\'s draw on X.14 and 1.63 as cached; on DEV it is DEV\'s own, and the option is refused', { skip: fwSkip }, async () => {
  const all = await firmware();
  assert.ok(all.size, `no profiled OS file in ${FW}`);
  for (const [id, { bytes, resolved }] of all) {
    const p = resolved.profile!;
    const cached = Object.entries(p.cache ?? {}).filter(([k]) => k.startsWith('pitch_labels.'));
    for (const [k, v] of cached) assert.equal(resolved.discovery.values[k], v, `${id} ${k}`);
    assert.deepEqual(Object.keys(resolved.discovery.values).filter((k) => k.startsWith('pitch_labels.')).sort(), cached.map(([k]) => k).sort(), id);
    const offered = p.options?.pitchLabels?.ok === true;
    assert.equal(resolved.base.support.pitchLabels.ok, offered, `${id}: ${resolved.base.support.pitchLabels.why}`);
    assert.equal(!!resolved.base.features.pitchLabels, offered, id);
    const imgs = codeImages(readFirmware(bytes), resolved.base);
    if (id.startsWith('dev-')) {
      // the call DEV hooks for its TONAL labels, the same one this option hooks
      const dev = id === 'dev-26912' ? 0x2d500c : 0x2d4eae;
      assert.throws(() => findPitchLabels(imgs), (e: Error) => e instanceof NoPitchLabels && e.message.includes(`calls 0x${dev.toString(16)}, not the OS's string draw 0x211384`));
      assert.match(resolved.base.support.pitchLabels.why, /^refused on this base: DEV already replaces the knob-value draw/);
      const hook = imgs.flatMap((im) => findSig([im], '4ab9 002818de 6600 .... 2039 002818da 0c80 00000010')).filter((x) => x.at === dev);
      assert.equal(hook.length, 1, 'DEV\'s routine tests page 0 and a track below 16 first');
    } else {
      assert.deepEqual(findPitchLabels(imgs), S);
      assert.deepEqual(pitchLabelValues(S), Object.fromEntries(cached.map(([k, v]) => [k, v.split(',').map((x) => Number(x))])));
      for (const [k, sig] of Object.entries(PITCH_LABEL_SIGNATURES)) assert.ok(findSig(imgs, sig).some((x) => x.at >= S.painter && x.at < S.painter + 0x1200), `${id}: ${k}`);
    }
  }
});

// The output of main at d360e4b for these inputs (the bundled catalog, --uw). A build without
// --pitch-labels must be the same byte for byte; the build with it is recorded so a change to it is deliberate.
const GOLDEN: Record<string, Record<string, string>> = {
  x14: { '': '1b0ec85399bd18393588ec2125a475b2da17915309c4b9f32f25ac5b69282212', '--no-pitch-labels': '1b0ec85399bd18393588ec2125a475b2da17915309c4b9f32f25ac5b69282212',
         '--pitch-labels': 'd3c480df3836dbff3503974c3768e6f286f5ca0b646c87b2efe97c6cde23d944' },
  'stock-163-prepared': { '': '77ff4079d42d93b7b5082c259f23089bf2fb666928f9a4fac97eed6ec2626d96', '--no-pitch-labels': '77ff4079d42d93b7b5082c259f23089bf2fb666928f9a4fac97eed6ec2626d96',
                          '--pitch-labels': '84efea23711ccd0ca332f36a49b495ee45f005871f57015a8656df32d0029bb0' },
};

test('firmware: builds without the option are main\'s byte for byte; with it, as recorded', { skip: fwSkip }, async () => {
  const all = await firmware();
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'kb-labels-'));
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
        if (flag === '--pitch-labels') assert.match(r.stdout, /gate pitch-labels: pass/);
        checked++;
      }
    }
    assert.ok(checked, `none of ${Object.keys(GOLDEN).join(', ')} in ${FW}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- with firmware: the OS's own knob-value painter, the routine and the OS's string draw, read back off the LCD

const BUF = 0x00d00000;

/** A CPU with the base's code, the routine at ORG entered from the painter's draw call, and a 128x64 framebuffer. */
function lcdRig(bytes: Uint8Array, base: Base, ms: LabelModel[]): { cpu: Cpu; L: Record<string, number>; px: (x: number, y: number) => number } {
  const cpu = new Cpu(0x00f00000);
  for (const im of codeImages(readFirmware(bytes), base)) cpu.load(im.ram, im.bytes);
  const t = buildLabelTable(ms, true), c = assemble(ORG, S, t);
  cpu.load(ORG, c.bytes);
  for (const [a, v] of labelPatches(S, c.labels).patches) cpu.w32(a, v);
  const str = (a: number): string => { let s = ''; for (let k = 0; k < 8 && cpu.r8(a + k); k++) s += String.fromCharCode(cpu.r8(a + k)); return s; };
  // the painter's own helpers: its "%d" print, and the dial and frame drawing (not under test)
  cpu.stubs.set(0x211d46, (x) => { const f = str(x.arg(1)); cpu.load(x.arg(0), [...Array.from(f === '%d' ? String(x.arg(2) | 0) : f, (ch) => ch.charCodeAt(0)), 0]); });
  for (const a of [0x21124c, 0x2106fe, 0x210f84]) cpu.stubs.set(a, () => {});
  cpu.w32(FB, 128); cpu.w32(FB + 4, 64); cpu.w32(FB + 8, 2); cpu.w32(FB + 12, BUF);
  // the parameter page as the emulator shows it after a turn of knob 1: page 0, track 1, every knob typed, knob 1 just touched
  cpu.w32(S.page, 0); cpu.w32(S.track, 0); cpu.w32(0x28b328, 0x11111111); cpu.w32(0x28b330, 1); cpu.w32(0x281a72, 0x1d);
  const px = (x: number, y: number): number => (cpu.r32(BUF + (2 * x + (y >> 5)) * 4) >>> (31 - (y & 31))) & 1;
  return { cpu, L: c.labels, px };
}

test('firmware: the real painter of X.14 and 1.63 into the routine and the OS\'s draw: the LCD reads the note', { skip: fwSkip }, async () => {
  const all = await firmware();
  let checked = 0;
  for (const id of ['x14', 'stock-163-prepared']) {
    const got = all.get(id);
    if (!got) continue;
    const ms: LabelModel[] = [{ id: 6, name: 'BD', pitch: QUARTER_LAW },
      { id: 15, name: 'ZONED', pitch: { ...QUARTER_LAW, mode_knob: 2, by_mode: [{ zone: 0, base_note: -5, range: [10, 127] }, { zone: 2, law: 'none' }] }, dyn_labels: modePlan(4) }];
    const { cpu, L, px } = lcdRig(got.bytes, got.resolved.base, ms);
    const clear = (): void => { for (let k = 0; k < 128 * 2 * 4; k += 4) cpu.w32(BUF + k, 0); };
    // the glyphs, each drawn alone by the OS's draw: the stock font's, and our two
    const glyph = (font: number, ch: number): string => {
      clear(); cpu.load(STR, [ch, 0]);
      cpu.call(S.draw, [font, FB, 0, 0, 0xffffffff, STR]);
      return Array.from({ length: 5 }, (_, y) => [0, 1, 2].map((x) => px(x, y)).join('')).join('/');
    };
    const dict = new Map<string, string>();
    for (const ch of 'ABCDEFG#-0123456789') dict.set(glyph(S.font, ch.charCodeAt(0)), ch);
    dict.set(glyph(L.font, 1), '+'); dict.set(glyph(L.font, 2), '‡');
    assert.equal(dict.size, 21, 'every glyph distinct');
    const read = (): string => {
      const ink: [number, number][] = [];
      for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (px(x, y)) ink.push([x, y]);
      const x0 = Math.min(...ink.map((p) => p[0])), x1 = Math.max(...ink.map((p) => p[0])), y0 = Math.min(...ink.map((p) => p[1]));
      let s = '';
      for (let x = x0; x <= x1; x += 4) s += dict.get(Array.from({ length: 5 }, (_, y) => [0, 1, 2].map((k) => px(x + k, y0 + y)).join('')).join('/')) ?? '?';
      return s;
    };
    for (const [mid, mode, raws] of [[6, 0, [0, 1, 2, 3, 71, 72, 73, 74, 75, 100, 126, 127]], [15, 0, [0, 10, 11, 12, 13, 50]], [15, 40, [0, 72, 73]], [15, 70, [72, 73]]] as [number, number, number[]][]) {
      cpu.w32(S.machineIds, mid); cpu.w8(S.kitParams + 2, mode);
      for (const raw of raws) {
        clear();
        cpu.call(S.painter, [0, raw], 2_000_000);
        const m = ms.find((x) => x.id === mid)!;
        const want = expectedLabel(m.pitch!, raw, mid === 15 ? stops(4)[mode] : undefined) ?? String(raw);
        assert.equal(read(), want, `${id}: machine ${mid}, MODE ${mode}, raw ${raw}`);
        checked++;
      }
    }
  }
  assert.ok(checked, 'no X.14 or 1.63 file');
});
