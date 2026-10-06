import { test } from 'node:test';
import assert from 'node:assert/strict';
import { select } from '../src/plan.js';
import type { Pack } from '../src/packs.js';

const packs = [{ format: 'md-pack/1', family: 'TEST', order: 0,
  models: [0, 1].map(i => ({ key: `TEST/${i}`, module: 'same_module', seq: i })),
  shared: [{ name: 'dependency', words: 'AAAA' }] }] as Pack[];

test('explicit model keys select independently of module names and retain shared dependencies', () => {
  const before = JSON.stringify(packs);
  const selected = select(packs, { modelKeys: ['TEST/1'] });
  assert.deepEqual(selected.fams[0].models.map(m => m.key), ['TEST/1']);
  assert.equal(selected.shared[0].name, 'dependency');
  assert.equal(JSON.stringify(packs), before);
  assert.equal(select(packs, {}).fams[0].models.length, 2);
  assert.deepEqual(select(packs, { modelKeys: ['TEST/1', 'TEST/0'] }).fams[0].models.map(m => m.key), ['TEST/0', 'TEST/1']);
});

test('unknown, duplicate, empty and conflicting selections are refused', () => {
  for (const modelKeys of [[], ['TEST/0', 'TEST/0'], ['TEST/missing'], ['']]) {
    assert.throws(() => select(packs, { modelKeys }));
  }
  assert.throws(() => select(packs, { modelKeys: ['TEST/0'], exclude: ['same_module'] }), /cannot be combined/);
  assert.throws(() => select(packs, { modelKeys: ['TEST/0'], families: [] }), /cannot be combined/);
});
