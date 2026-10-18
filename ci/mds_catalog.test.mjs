import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildMdsCatalog } from '../web/build-mds.mjs';

test('every curated core/community release validates, with reviewed identities and exact pinned bytes', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { index, assets } = await buildMdsCatalog(root);
  assert.ok(index.machines.length >= 54);
  assert.equal(assets.length, index.machines.length);
  for (const family of ['NFX', 'P-I', 'SYN', 'TX6', 'TX8', 'TX9', 'TXZ', 'SMP']) assert.ok(index.machines.some(m => m.category === family));
  assert.ok(index.machines.filter(m => m.channel === 'core').length >= 43);
  assert.ok(index.machines.filter(m => m.channel === 'community').length >= 8);
  assert.ok(index.machines.filter(m => m.channel === 'core').every(m => m.source === 'https://github.com/jmamma/MDX'));
  assert.equal(new Set(index.machines.map(m => m.summary)).size, index.machines.length);
  const kick = index.machines.find(m => m.alias === 'TX6-BD');
  assert.equal(kick.version, '2.1'); assert.match(kick.source, /\/tree\/[a-f0-9]{40}\/mds\/tx6\/bd$/);
  for (const machine of index.machines.filter(m => m.category === 'TX6')) {
    assert.deepEqual(machine.parameters.slice(0, 2).map(p => p.name), ['TUNE', 'DEC']);
    assert.match(machine.notes, /parameter locks/);
  }
  assert.equal(index.machines.filter(m => m.category === 'TX6').length, 8);
  assert.deepEqual(index.machines.find(m => m.alias === 'TX6-CP').parameters.map(p => p.name), ['TUNE', 'DEC', 'NOIS', 'BODY', 'TGHT']);
  assert.ok(index.machines.every(m => m.category !== 'TR6'));
  const smp = index.machines.filter(m => m.category === 'SMP');
  assert.equal(smp.length, 3);
  for (const [alias, hardware] of [['SMP-ST', 'uw'], ['SMP-SR', 'uw'], ['SMP-S2', 'all']]) {
    const machine = smp.find(m => m.alias === alias);
    assert.equal(machine.hardware, hardware); assert.equal(machine.version, '0.6');
    assert.match(machine.source, /b3c74740f0e8fa7309dd02e85c3b0ec1631ad7d2/);
    assert.equal(machine.author, 'hcar / murdenihcam');
  }
  assert.ok(index.machines.every(m => m.cycles > 0 && m.cycles <= 3951 && m.words > 0 && m.contentId.length === 64));
});

test('community contributions need complete metadata and a valid single-machine release', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = JSON.parse(readFileSync(join(root, 'mds/catalog.json'), 'utf8'));
  const entry = catalog.machines.find(m => m.channel === 'community');
  // Keep the fixture in the checkout so esbuild resolves the same project configuration.
  const temp = mkdtempSync(join(root, '.mds-contribution-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  for (const file of ['engine/src/mds.ts', entry.file]) { mkdirSync(dirname(join(temp, file)), { recursive: true }); copyFileSync(join(root, file), join(temp, file)); }
  const write = machines => writeFileSync(join(temp, 'mds/catalog.json'), JSON.stringify({ schema: catalog.schema, machines }));
  write([entry]); assert.equal((await buildMdsCatalog(temp)).index.machines.length, 1);
  write([{ ...entry, hidden: true }]);
  const hidden = await buildMdsCatalog(temp);
  assert.deepEqual(hidden.index.machines, []); assert.deepEqual(hidden.assets, []);
  write([{ ...entry, hidden: 'true' }]); await assert.rejects(buildMdsCatalog(temp), /hidden must be boolean/);
  for (const patch of [{ author: '' }, { summary: 42 }, { license: null }, { sha256: 'invalid' }, { source: 'http://example.com' }, { project: undefined }, { notes: [] }, { hardware: 'unknown' }, { sharedId: true }, { sharedId: 'wrong-id' }]) {
    write([{ ...entry, ...patch }]); await assert.rejects(buildMdsCatalog(temp));
  }
  write([entry, entry]); await assert.rejects(buildMdsCatalog(temp), /Duplicate/);
  const id = (await buildMdsCatalog(root)).index.machines.find(m => m.sha256 === entry.sha256).id;
  write([{ ...entry, sharedId: id }, { ...entry, sharedId: id }]);
  await assert.rejects(buildMdsCatalog(temp), /Duplicate MDS content or alias/);
});
