// X.13 is no longer a base: it is turned away by its tag, before discovery, with a message that
// names X.14, whatever its slot hashes (a stock file or a build Kitbasher made on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotPatchable, resolveBase } from '../src/bases.js';
import type { Firmware } from '../src/container.js';
import { loadBases } from '../src/node.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const set = loadBases(resolve(ROOT, 'bases'));

test('the X.13 profile only recognises and refuses: no cache, no notes, a successor that exists', () => {
  const x13 = set.profiles.find((p) => p.id === 'x13')!;
  assert.equal(x13.identify.tag, 'X13 ');
  assert.deepEqual(x13.retired, { successor: 'x14' });
  assert.ok(set.profiles.some((p) => p.id === 'x14' && !p.retired && !p.refuse));
  for (const k of ['cache', 'notes', 'qualification', 'options']) assert.equal(x13[k], undefined, k);
  assert.ok(!(set.lineage.modelRuntimes ?? []).some((r) => r.id === 'x13'));
});

test('any OS tagged X13 is refused before discovery, with the install-X.14 message', async () => {
  // no slots at all: the refusal must come from the tag alone, before anything is hashed or discovered
  const fw = { tag: 'X13 ' } as unknown as Firmware;
  await assert.rejects(resolveBase(fw, set), (e: unknown) => {
    assert.ok(e instanceof NotPatchable);
    assert.equal(e.profile?.id, 'x13');
    assert.equal(e.discovery, null);
    assert.match(e.message, /^OS X\.13 is no longer supported — please install OS X\.14 first/);
    return true;
  });
});
