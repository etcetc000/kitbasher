import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Base } from '../src/bases.js';
import { canonical, decodeLayout, encodeLayout, LAYOUT_FORMAT, parseLayout, type Layout } from '../src/layout.js';
import type { PackModel } from '../src/packs.js';
import { needsUwSamples } from '../src/packs.js';
import { allocateIds, effectiveLayout } from '../src/plan.js';
import { decodeProject, encodeProject, type Project } from '../src/project.js';

// Machine IDs are assigned bottom-up (engine/src/selection.ts allocateIds); a restored session
// (layout) keeps its IDs; a Machinedrum without UW uses nothing at 128 and up.

const model = (key: string, name: string, id = 0, extra: Partial<PackModel> = {}): PackModel => ({
  key, name, id, module: key, labels: Array(8).fill('KNOB'), defaults: Array(8).fill(0),
  workspace: false, wants_shared: [], uses_shared: [], dsp1_drive: null, dyn_labels: [], tables: [],
  code: { words: 'AAAA', org: 0, entry: { init: 0, trigger: 0, render: 0 }, relocs: [], symbols: {} }, ...extra,
}) as PackModel;
const UW_SAMPLE = { needs: [{ kind: 'uw-sample' as const, name: 'DWAV', what: 'a wave', without: 'it plays silent' }] };

const BASE = { name: 'fixture', id: 'x', os: { descriptorTable: 0, cfBase: 0, freeDescriptor: 0, deadIds: [96, 119] } } as unknown as Base;
const MAIN = new Uint8Array(192 * 4);                 // every ID's descriptor is the free one
const own = (ids: number[]): Map<number, string> => new Map(ids.map((i) => [i, `OWN${i}`]));
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const FOUR = own(range(0, 3));

const fams = (...models: PackModel[]) => [{ name: 'F', models }];
const ids = (r: ReturnType<typeof allocateIds>) => Object.fromEntries(r.sel.map((s) => [s.m.name, s.id]));
const run = (f: ReturnType<typeof fams>, opt: { noUw?: boolean; layout?: Layout; listed?: Map<number, string>; allowMove?: boolean } = {}) =>
  allocateIds(BASE, MAIN, f, !!opt.allowMove, opt.layout, opt.listed ?? FOUR, { noUw: opt.noUw });
const layoutOf = (machines: Record<string, number>, uw?: boolean): Layout => ({
  format: LAYOUT_FORMAT, base: 'x', categories: ['F'],
  machines: Object.fromEntries(Object.entries(machines).map(([k, id], i) => [k, { id, category: 'F', order: i }])),
  ...(uw === undefined ? {} : { uw }),
});

const A = model('K/A', 'AAAAA'), B = model('K/B', 'BBBBB'), PW = model('OSC/PW', 'OSCPW', 175), C = model('K/C', 'CCCCC');

test('bottom-up, in order: a pack\'s own ID is not a pin; the same selection always gets the same IDs', () => {
  const r = run(fams(A, PW, B));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(r), { AAAAA: 4, OSCPW: 5, BBBBB: 6 });
  assert.deepEqual(r.moves, []);
  assert.deepEqual(ids(run(fams(A, PW, B))), ids(r));               // deterministic
  assert.deepEqual(ids(run(fams(A, PW, B), { noUw: true })), ids(r)); // and the same with or without UW
});

test('a restored session keeps every ID it names; only new models fill free IDs', () => {
  const first = ids(run(fams(A, PW, B)));
  const session = layoutOf({ 'K/A': first.AAAAA, 'OSC/PW': first.OSCPW, 'K/B': first.BBBBB });
  // a model added in front of the others would have taken 4 without the session
  const r = run(fams(C, A, PW, B), { layout: session });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(r), { CCCCC: 7, AAAAA: 4, OSCPW: 5, BBBBB: 6 });
  assert.deepEqual(r.moves, []);
  // an old session with high IDs (from earlier builds) is honoured as it is with UW
  const old = run(fams(A, PW), { layout: layoutOf({ 'OSC/PW': 175 }) });
  assert.deepEqual(ids(old), { AAAAA: 4, OSCPW: 175 });
});

test('without UW a restored ID of 128 and up moves to the lowest free ID below 128, reported', () => {
  const r = run(fams(A, PW, B), { noUw: true, layout: layoutOf({ 'K/A': 20, 'OSC/PW': 175 }) });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(r), { AAAAA: 20, OSCPW: 4, BBBBB: 5 });       // the session's move first, then the new model
  assert.deepEqual(r.moves.map((m) => [m.name, m.preferred, m.id]), [['OSCPW', 175, 4]]);
  assert.match(r.moves[0].why, /without UW/);
  assert.equal(r.sel.find((s) => s.m.name === 'OSCPW')!.mapped, true);
});

test('IDs outside 0..191 are refused, with or without UW; parseLayout refuses them too', () => {
  for (const noUw of [false, true]) {
    const r = run(fams(A), { noUw, layout: layoutOf({ 'K/A': 200 }) });
    assert.ok(r.problems.some((p) => /AAAAA on ID 200, which is outside 0\.\.191/.test(p)), r.problems.join('\n'));
    assert.equal(r.sel.length, 0);
  }
  assert.throws(() => parseLayout(JSON.stringify(layoutOf({ 'K/A': 192 }))), /0\.\.191/);
  assert.throws(() => parseLayout(JSON.stringify(layoutOf({ 'K/A': -1 }))), /0\.\.191/);
  // a session ID the base itself uses: an error, unless moves are allowed
  assert.ok(run(fams(A), { layout: layoutOf({ 'K/A': 2 }) }).problems.some((p) => /OWN2/.test(p)));
  const moved = run(fams(A), { layout: layoutOf({ 'K/A': 2 }), allowMove: true });
  assert.deepEqual([ids(moved).AAAAA, moved.moves[0].preferred], [4, 2]);
});

test('without UW the build fails clearly only when no ID below 128 is left', () => {
  const full = own(range(0, 127));
  const no = run(fams(A), { noUw: true, listed: full });
  assert.ok(no.problems.some((p) => /no free machine ID below 128 left for AAAAA/.test(p)), no.problems.join('\n'));
  assert.deepEqual(ids(run(fams(A), { listed: full })), { AAAAA: 128 });   // with UW 128 is free
  const moved = run(fams(PW), { noUw: true, listed: full, layout: layoutOf({ 'OSC/PW': 175 }) });
  assert.ok(moved.problems.some((p) => /below 128 left for OSCPW.*175/.test(p)), moved.problems.join('\n'));
});

test('models that play a UW sample are refused without UW, allowed with it', () => {
  const W = model('WAV/TB', 'WAVTB', 124, UW_SAMPLE);
  assert.ok(needsUwSamples(W) && !needsUwSamples(A));
  assert.ok(needsUwSamples(model('WAV/X', 'WAVXX', 30, { contract: { samples: [{}] } } as unknown as Partial<PackModel>)));
  assert.deepEqual(run(fams(W, A)).problems, []);
  const r = run(fams(W, A), { noUw: true });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /WAVTB plays a sample from UW sample memory/);
});

// ---- a restored session's machines that are not selected now

test('restored but unselected machines keep their IDs reserved; new models do not take them', () => {
  // X.14-style repro: built with VADSD on 6; restore, deselect VADSD, add VADBD
  const SD = model('VAD/SD', 'VADSD'), BD = model('VAD/BD', 'VADBD');
  const session = layoutOf({ 'VAD/SD': 6 });
  const r = run(fams(BD), { layout: session, listed: own(range(0, 5)) });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(r), { VADBD: 7 });                           // not 6: VADSD's
  assert.deepEqual(r.reused, []);
  // the layout the build embeds lists both, on different IDs
  const out = effectiveLayout(BASE, session, [{ name: 'F', models: [BD] }], r.sel, undefined);
  assert.deepEqual(Object.fromEntries(Object.entries(out.machines).map(([k, p]) => [k, p.id])), { 'VAD/SD': 6, 'VAD/BD': 7 });
  // restoring that with both selected: each keeps its ID, no problem, no move
  const both = run(fams(BD, SD), { layout: out, listed: own(range(0, 5)) });
  assert.deepEqual(both.problems, []);
  assert.deepEqual(ids(both), { VADBD: 7, VADSD: 6 });
  assert.deepEqual(both.moves, []);
});

test("a reserved ID is taken back only when no other is left, reported; this build's machine wins the ID", () => {
  const SD = model('VAD/SD', 'VADSD'), BD = model('VAD/BD', 'VADBD');
  const listed = own([...range(0, 5), ...range(7, 191)]);             // only 6 is free, and VADSD holds it
  const session = layoutOf({ 'VAD/SD': 6 });
  const r = run(fams(BD), { layout: session, listed });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(ids(r), { VADBD: 6 });
  assert.deepEqual(r.reused, [{ id: 6, key: 'VAD/SD' }]);
  // the embedded layout drops VADSD's entry: one machine per ID, this build's
  const out = effectiveLayout(BASE, session, [{ name: 'F', models: [BD] }], r.sel, undefined);
  assert.deepEqual(Object.fromEntries(Object.entries(out.machines).map(([k, p]) => [k, p.id])), { 'VAD/BD': 6 });
});

// ---- the UW answer in files

test('layout and project files round-trip the UW answer; an old file has none and keeps its fingerprint', async () => {
  const l = layoutOf({ 'K/A': 4 });
  const before = canonical(l);
  const old = parseLayout(JSON.stringify(l));
  assert.equal(canonical(old), before);
  assert.equal(old.uw, undefined);
  for (const uw of [true, false]) {
    const back = parseLayout(JSON.stringify(parseLayout(JSON.stringify({ ...l, uw }))));
    assert.equal(back.uw, uw);
    assert.notEqual(canonical(back), before);
    assert.equal(decodeLayout(encodeLayout(back)).uw, uw);         // the table in a patched OS carries it too
  }
  assert.equal(decodeLayout(encodeLayout(l)).uw, undefined);
  assert.throws(() => parseLayout(JSON.stringify({ ...l, uw: 'no' })), /uw must be/);
  const p: Project = { os: { base: 'x14', name: 'X.14', tag: 'X14 ', coldfire_sha256: 'a', dsp2_sha256: 'b', dsp1_sha256: 'c' },
    swaps: new Map(), sources: new Map(), noTrim: new Set(), trim: { mode: 'auto', db: -17, cap: 1 }, models: ['A'], layout: null, uw: false };
  for (const uw of [false, true]) {
    const file = await encodeProject({ ...p, uw });
    assert.equal(file.uw, uw);
    assert.equal((await decodeProject(JSON.stringify(file))).uw, uw);
  }
  const unanswered = await encodeProject({ ...p, uw: undefined });
  assert.equal('uw' in unanswered, false);
  assert.equal((await decodeProject(JSON.stringify(unanswered))).uw, undefined);
  assert.equal((await decodeProject(JSON.stringify({ ...unanswered, layout: { ...l, uw: false } }))).uw, false);
});
