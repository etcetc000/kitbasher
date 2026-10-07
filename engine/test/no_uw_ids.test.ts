import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Base } from '../src/bases.js';
import { canonical, LAYOUT_FORMAT, parseLayout, type Layout } from '../src/layout.js';
import type { Pack, PackModel } from '../src/packs.js';
import { needsUwSamples } from '../src/packs.js';
import { allocateIds } from '../src/plan.js';
import { decodeProject, encodeProject, type Project } from '../src/project.js';

// "My Machinedrum has no UW" (engine/src/selection.ts allocateIds, opt.noUw): such a unit takes
// 128 off any machine ID of 128 and up, so nothing may sit there.

const model = (key: string, name: string, id: number, extra: Partial<PackModel> = {}): PackModel => ({
  key, name, id, module: key, labels: Array(8).fill('KNOB'), defaults: Array(8).fill(0),
  workspace: false, wants_shared: [], uses_shared: [], dsp1_drive: null, dyn_labels: [], tables: [],
  code: { words: 'AAAA', org: 0, entry: { init: 0, trigger: 0, render: 0 }, relocs: [], symbols: {} }, ...extra,
}) as PackModel;
const pack = (family: string, models: PackModel[]): Pack => ({
  format: 'md-pack/1', family, order: 1, source: { repo: 'test', commit: '0', dirty: false, env: {} }, shared: [], models,
});
/** a contributed model with no pinned ID: the allocator picks one */
const auto = (key: string, name: string): PackModel =>
  model(key, name, 0, { contract: { components: { dsp2: { source: 'dsp2.asm' } }, injection: { mode: 'add' }, samples: [] } } as unknown as Partial<PackModel>);
const UW_SAMPLE = { needs: [{ kind: 'uw-sample' as const, name: 'DWAV', what: 'a wave', without: 'it plays silent' }] };

const BASE = { name: 'fixture', os: { descriptorTable: 0, cfBase: 0, freeDescriptor: 0, deadIds: [180, 181] } } as unknown as Base;
const MAIN = new Uint8Array(192 * 4);                 // every ID's descriptor is the free one
/** the base's own machines on IDs 0..n-1 */
const own = (n: number): Map<number, string> => new Map(Array.from({ length: n }, (_, i) => [i, `OWN${i}`]));

const SYN = [pack('SYN', [model('OSC/SW', 'OSCSW', 13), model('OSC/PW', 'OSCPW', 175)])];
const run = (packs: Pack[], noUw: boolean, listed = own(4), layout?: Layout, allowMove = false) =>
  allocateIds(BASE, MAIN, packs.map((p) => ({ name: p.family, models: p.models })), allowMove, layout, listed, { noUw });

test('with UW (the default) a pinned 175 stays on 175', () => {
  const r = run(SYN, false);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.sel.map((s) => [s.m.name, s.id]), [['OSCSW', 13], ['OSCPW', 175]]);
});

test('without UW a pinned 175 moves to the lowest free ID below 128, reported, without allowMove', () => {
  const r = run(SYN, true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sel.map((s) => [s.m.name, s.id]), [['OSCSW', 13], ['OSCPW', 4]]);
  assert.equal(r.moves.length, 1);
  assert.deepEqual([r.moves[0].name, r.moves[0].preferred, r.moves[0].id], ['OSCPW', 175, 4]);
  assert.match(r.moves[0].why, /without UW/);
  assert.equal(r.sel.find((s) => s.m.name === 'OSCPW')!.preferred, 175);
});

test('without UW, pinned IDs below 128 are placed first and keep theirs', () => {
  const r = run([pack('SYN', [model('OSC/PW', 'OSCPW', 175), model('VAD/BD', 'VADBD', 4)])], true);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sel.map((s) => [s.m.name, s.id]), [['OSCPW', 5], ['VADBD', 4]]);
});

test('without UW the build fails clearly only when no ID below 128 is left', () => {
  const full = own(128);
  const r = run(SYN, true, full);
  assert.ok(r.problems.some((p) => /OSCSW.*ID 13/.test(p)), r.problems.join('\n'));     // its own pin is taken
  assert.ok(r.problems.some((p) => /no free machine ID below 128 left for OSCPW/.test(p)), r.problems.join('\n'));
  assert.ok(!r.sel.some((s) => s.id >= 128));
  // with UW the same base still has room on 175
  assert.ok(run([pack('SYN', [model('OSC/PW', 'OSCPW', 175)])], false, full).sel.some((s) => s.id === 175));
});

test('automatic IDs never reach 128 without UW', () => {
  const packs = [pack('COM', [auto('COM/A', 'COMAA'), auto('COM/B', 'COMBB')])];
  const listed = own(127);                        // 127 is the only free ID below 128
  const uw = run(packs, false, listed);
  assert.deepEqual(uw.sel.map((s) => s.id), [127, 128]);
  const no = run(packs, true, listed);
  assert.deepEqual(no.sel.map((s) => s.id), [127]);
  assert.ok(no.problems.some((p) => /no free machine ID below 128 left for COMBB/.test(p)), no.problems.join('\n'));
  // allowMove's next-free-up search also stops below 128
  const moved = run([pack('SYN', [model('OSC/SW', 'OSCSW', 3)])], true, own(128), undefined, true);
  assert.ok(moved.problems.some((p) => /below 128/.test(p)) && !moved.sel.length, moved.problems.join('\n'));
});

test('without UW the other machines keep the IDs they get with UW; the moved one takes what is left', () => {
  const packs = [pack('MIX', [auto('COM/A', 'COMAA'), model('OSC/PW', 'OSCPW', 175), auto('COM/B', 'COMBB')])];
  const uw = run(packs, false);
  const no = run(packs, true);
  const id = (r: ReturnType<typeof run>, n: string) => r.sel.find((s) => s.m.name === n)!.id;
  assert.deepEqual([id(uw, 'COMAA'), id(uw, 'COMBB'), id(uw, 'OSCPW')], [4, 5, 175]);
  assert.deepEqual([id(no, 'COMAA'), id(no, 'COMBB'), id(no, 'OSCPW')], [4, 5, 6]);
  assert.deepEqual(no.moves.map((m) => [m.name, m.preferred, m.id]), [['OSCPW', 175, 6]]);
});

test('without UW a layout that pins 128+ is moved too, and keeps its category', () => {
  const lay: Layout = { format: LAYOUT_FORMAT, base: 'x', categories: ['MINE'],
    machines: { 'OSC/PW': { id: 175, category: 'MINE', order: 0 }, 'OSC/SW': { id: 20, category: 'MINE', order: 1 } } };
  const r = run(SYN, true, own(4), lay);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sel.map((s) => [s.m.name, s.id, s.family, s.mapped]), [['OSCSW', 20, 'MINE', true], ['OSCPW', 4, 'MINE', true]]);
  assert.deepEqual(r.moves.map((m) => [m.name, m.preferred, m.id]), [['OSCPW', 175, 4]]);
  assert.deepEqual(run(SYN, false, own(4), lay).sel.map((s) => s.id), [20, 175]);
});

test('models that play a UW sample are refused without UW, allowed with it', () => {
  const packs = [pack('WAV', [model('WAV/TB', 'WAVTB', 124, UW_SAMPLE), model('OSC/SW', 'OSCSW', 13)])];
  assert.ok(needsUwSamples(packs[0].models[0]) && !needsUwSamples(packs[0].models[1]));
  assert.deepEqual(run(packs, false).problems, []);
  const r = run(packs, true);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /WAVTB plays a sample from UW sample memory/);
  const declared = model('WAV/X', 'WAVXX', 30, { contract: { samples: [{}] } } as unknown as Partial<PackModel>);
  assert.ok(needsUwSamples(declared));
});

test('layout and project files round-trip the UW answer; an old file has none and keeps its fingerprint', async () => {
  const l: Layout = { format: LAYOUT_FORMAT, base: 'x13', categories: ['A'], machines: { 'K/A': { id: 4, category: 'A', order: 0 } } };
  const before = canonical(l);
  const old = parseLayout(JSON.stringify(l));
  assert.equal(canonical(old), before);
  assert.equal(old.uw, undefined);                                // not answered: the page asks
  for (const uw of [true, false]) {
    const back = parseLayout(JSON.stringify(parseLayout(JSON.stringify({ ...l, uw }))));
    assert.equal(back.uw, uw);
    assert.notEqual(canonical(back), before);
  }
  assert.throws(() => parseLayout(JSON.stringify({ ...l, uw: 'no' })), /uw must be/);
  // a layout that says No limits the IDs like the option does
  const lay: Layout = { ...l, uw: false, categories: ['SYN'], machines: { 'OSC/PW': { id: 175, category: 'SYN', order: 0 } } };
  assert.deepEqual(run(SYN, false, own(4), lay).sel.map((s) => s.id), [13, 175]);   // the allocator alone: as asked
  const p: Project = { os: { base: 'x13', name: 'X.13', tag: 'X13 ', coldfire_sha256: 'a', dsp2_sha256: 'b', dsp1_sha256: 'c' },
    swaps: new Map(), sources: new Map(), noTrim: new Set(), trim: { mode: 'auto', db: -17, cap: 1 }, models: ['A'], layout: null, uw: false };
  for (const uw of [false, true]) {
    const file = await encodeProject({ ...p, uw });
    assert.equal(file.uw, uw);
    assert.equal((await decodeProject(JSON.stringify(file))).uw, uw);
  }
  const unanswered = await encodeProject({ ...p, uw: undefined });
  assert.equal('uw' in unanswered, false);
  assert.equal((await decodeProject(JSON.stringify(unanswered))).uw, undefined);
  // a project with no answer of its own takes its layout's
  assert.equal((await decodeProject(JSON.stringify({ ...unanswered, layout: { ...l, uw: false } }))).uw, false);
});
