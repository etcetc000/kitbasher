// Model key aliases: a renamed model lists the keys it was published under, and a layout, a key
// selection or an exclusion written with one of them still means that model (selection.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Base } from '../src/bases.js';
import { LAYOUT_FORMAT, type Layout } from '../src/layout.js';
import { checkModelContract, type ModelContract } from '../src/model_contract.js';
import { checkPack, type Pack, type PackModel } from '../src/packs.js';
import { allocateIds, keyAliases, resolveKey, resolveLayout, select } from '../src/plan.js';

const model = (key: string, name: string, id: number, aliases?: string[], module = key): PackModel => ({
  key, name, id, module, ...(aliases ? { aliases } : {}), labels: Array(8).fill('KNOB'), defaults: Array(8).fill(0),
  workspace: false, wants_shared: [], uses_shared: [], dsp1_drive: null, dyn_labels: [], tables: [],
  code: { words: 'AAAA', org: 0, entry: { init: 0, trigger: 0, render: 0 }, relocs: [], symbols: {} },
}) as PackModel;

const pack = (family: string, order: number, models: PackModel[]): Pack => ({
  format: 'md-pack/1', family, order, source: { repo: 'test', commit: '0', dirty: false, env: {} }, shared: [], models,
});

// The renamed catalog: OSCSW was MM/4, VADBD was AN/BD (a directory model: key == module).
const RENAMED = [
  pack('MM', 1, [model('OSC/SW', 'OSCSW', 13, ['MM/4'], 'mm_saw'), model('FMS/2O', 'FMS2O', 11, ['MM/8'], 'mm_fmstat')]),
  pack('AN', 2, [model('VAD/BD', 'VADBD', 40, ['AN/BD'])]),
];
const BASE = { name: 'fixture', os: { descriptorTable: 0, cfBase: 0, freeDescriptor: 0, deadIds: [180, 181] } } as unknown as Base;

test('a layout saved under the former keys maps each renamed model to the same ID and category', () => {
  const old: Layout = { format: LAYOUT_FORMAT, base: 'x14', categories: ['SYN', 'DRM'],
    machines: { 'MM/4': { id: 77, category: 'SYN', order: 1 }, 'MM/8': { id: 78, category: 'SYN', order: 0 },
                'AN/BD': { id: 79, category: 'DRM', order: 0 }, 'ND/9': { id: 90, category: 'DRM', order: 1 } } };
  const { fams, aliases } = select(RENAMED, {});
  const lay = resolveLayout(old, aliases);
  assert.deepEqual(Object.keys(lay.machines).sort(), ['FMS/2O', 'ND/9', 'OSC/SW', 'VAD/BD']);   // unknown keys kept
  const r = allocateIds(BASE, new Uint8Array(192 * 4), fams, false, lay, new Map());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sel.map((s) => [s.m.key, s.id, s.family, s.mapped]),
    [['OSC/SW', 77, 'SYN', true], ['FMS/2O', 78, 'SYN', true], ['VAD/BD', 79, 'DRM', true]]);
  // a layout naming no former key comes back as it is
  assert.equal(resolveLayout(lay, aliases), lay);
});

test('a layout naming one model under both its former and its current key is refused', () => {
  const { aliases } = select(RENAMED, {});
  const both: Layout = { format: LAYOUT_FORMAT, base: 'x14', categories: ['SYN'],
    machines: { 'MM/4': { id: 77, category: 'SYN', order: 0 }, 'OSC/SW': { id: 78, category: 'SYN', order: 1 } } };
  assert.throws(() => resolveLayout(both, aliases), /names OSC\/SW twice: as MM\/4 and as OSC\/SW/);
});

test('key selections and exclusions accept former keys', () => {
  const picked = select(RENAMED, { modelKeys: ['MM/8', 'VAD/BD'] });
  assert.deepEqual(picked.fams.flatMap((f) => f.models.map((m) => m.key)), ['FMS/2O', 'VAD/BD']);
  assert.throws(() => select(RENAMED, { modelKeys: ['MM/4', 'OSC/SW'] }), /same model twice/);
  // a directory model's module is its key: excluding its former key excludes it
  const ex = select(RENAMED, { exclude: ['AN/BD', 'mm_saw'] });
  assert.deepEqual(ex.fams.flatMap((f) => f.models.map((m) => m.key)), ['FMS/2O']);
  assert.equal(resolveKey(picked.aliases, 'MM/4'), 'OSC/SW');
  assert.equal(resolveKey(picked.aliases, 'DF/0'), 'DF/0');
});

test('conflicting aliases are rejected', () => {
  // two models claim one former key
  assert.throws(() => select([pack('MM', 1, [model('OSC/SW', 'OSCSW', 13, ['MM/4']), model('OSC/PW', 'OSCPW', 14, ['MM/4'])])], {}),
    /alias MM\/4 is claimed by both OSC\/SW and OSC\/PW/);
  // an alias that is another model's live key (e.g. an old pack loaded next to the renamed one)
  assert.throws(() => select([...RENAMED, pack('XX', 9, [model('MM/4', 'OLDSW', 13)])], {}),
    /lists alias MM\/4, which is the key of another model/);
  assert.throws(() => keyAliases([model('A/1', 'AAAAA', 1, ['B/1']), model('B/1', 'BBBBB', 2)]), /key of another model/);
  // malformed lists, caught per pack
  assert.throws(() => checkPack(pack('MM', 1, [model('OSC/SW', 'OSCSW', 13, ['MM/4', 'MM/4'])])), /listed twice/);
  assert.throws(() => checkPack(pack('MM', 1, [model('OSC/SW', 'OSCSW', 13, ['OSC/SW'])])), /its own key/);
  assert.throws(() => checkPack(pack('MM', 1, [model('OSC/SW', 'OSCSW', 13, [''])])), /nonempty strings/);
});

test('a manifest and its exported descriptor carry the same aliases', () => {
  const m = model('VAD/BD', 'VADBD', 0, ['AN/BD']);
  const contract = { format: 'md-model/1', key: 'VAD/BD', aliases: ['AN/BD'], injection: { mode: 'add' },
    panel: { name: 'VADBD', category: 'AN', knobs: Array.from({ length: 8 }, () => ({ label: 'KNOB', default: 0 })), modes: [] },
    components: { dsp2: { source: 'dsp2.asm', abi: 'md-voice/1' } },
    memory: [{ kind: 'voice', space: 'XY', words: 64, alignment: 64, lifetime: 'track-assignment', init: 'model', release: 'successor-init' }],
    samples: [], budget: { render_cps: 1, trigger_cycles: 1, init_cycles: 1 }, provenance: [] } as unknown as ModelContract;
  checkModelContract({ ...m, contract } as PackModel, 'AN');
  assert.throws(() => checkModelContract({ ...m, aliases: [], contract } as PackModel, 'AN'), /aliases differ/);
});
