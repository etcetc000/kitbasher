import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCatalog } from '../src/catalog.js';
import { merged } from '../src/selection.js';
import type { CorePack, Pack } from '../src/packs.js';

const core = (revision: string) => ({ format: 'md-pack/1', family: 'CORE', knob_callback: revision }) as CorePack;
const pack = (revision: string) => ({ format: 'md-pack/1', family: 'TEST', order: 0, shared: [],
  models: [{ key: 'TEST/0', name: 'TEST', module: 'test', defaults: [revision] }] }) as unknown as Pack;

test('complete replacement discards the previous revision without mutating it', () => {
  const old = { core: core('old'), packs: [pack('old')] }, before = JSON.stringify(old);
  const next = selectCatalog(old, [core('new'), pack('new')], 'replace');
  assert.equal(next.core!.knob_callback, 'new');
  assert.equal(merged(next.packs)[0].models.length, 1);
  assert.equal(JSON.stringify(old), before);
});

test('add retains conflict checks and identical copies are harmless', () => {
  const old = { core: core('old'), packs: [pack('old')] };
  assert.throws(() => selectCatalog(old, [core('new'), pack('new')], 'add'), /Different core/);
  assert.throws(() => selectCatalog(old, [pack('new')], 'add'), /different contents/);
  assert.equal(merged(selectCatalog(old, [core('old'), pack('old')], 'add').packs)[0].models.length, 1);
});

test('incomplete or internally conflicting replacements leave the current catalog intact', () => {
  const old = { core: core('old'), packs: [pack('old')] }, before = JSON.stringify(old);
  for (const files of [[], [pack('new')], [core('new')], [core('new'), core('other'), pack('new')]])
    assert.throws(() => selectCatalog(old, files, 'replace'));
  assert.equal(JSON.stringify(old), before);
});
