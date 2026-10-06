import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeModel, menuCategory, OTHER } from '../src/sound_catalog.js';
import { checkPack, type Pack, type PackModel } from '../src/packs.js';

const model = (name: string, browse?: PackModel['browse']) => ({ name, browse }) as Pick<PackModel, 'name' | 'browse'>;

test('a pack\'s own browse data places a model the catalog does not know', () => {
  assert.equal(describeModel(model('ZZZZZ')).category, OTHER);
  assert.equal(menuCategory(model('ZZZZZ')), 'OTH');
  const own = model('ZZZZZ', { category: 'Kick drums', description: 'A kick from its own pack.' });
  assert.deepEqual(describeModel(own), { category: 'Kick drums', description: 'A kick from its own pack.' });
  assert.equal(menuCategory(own), 'KIK');
});

test('browse data wins over the catalog; an unknown category falls back to it', () => {
  assert.equal(menuCategory(model('NZEPL', { category: 'Effects' })), 'FX');
  assert.equal(menuCategory(model('NZEPL', { category: 'Not a category' })), 'SYN');
  assert.equal(describeModel(model('NZEPL', { help: {} })).category, 'Synths & textures');
});

test('checkPack refuses malformed browse data', () => {
  const pack = (browse: unknown) => ({ format: 'md-pack/1', family: 'TEST', order: 0, shared: [],
    models: [{ key: 'TEST/0', name: 'TEST ', module: 'test', labels: [], defaults: [], browse }] }) as unknown as Pack;
  for (const bad of [{ category: 'Drums' }, { help: { PTCH: ['Pitch'] } }, { colour: 'red' }, { description: 'x'.repeat(401) }])
    assert.throws(() => checkPack(pack(bad)), /invalid browse data/, JSON.stringify(bad));
});
