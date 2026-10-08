// X.13 is not supported: an OS with its tag is refused before discovery, in one line, whatever its
// slot hashes, so it is never patched or taken for X.14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotPatchable, resolveBase, unsupported } from '../src/bases.js';
import type { Firmware } from '../src/container.js';
import { loadBases } from '../src/node.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const set = loadBases(resolve(ROOT, 'bases'));

test('an OS tagged X13 is refused before anything is hashed or discovered', async () => {
  const fw = { tag: 'X13 ' } as unknown as Firmware;            // no slots: the tag alone decides
  await assert.rejects(resolveBase(fw, set), (e: unknown) => {
    assert.ok(e instanceof NotPatchable);
    assert.equal(e.discovery, null);
    assert.equal(e.message, 'OS X.13 is not supported. Load an OS X.14 file.');
    return true;
  });
});

test('no base profile or model runtime is for X.13, and supported tags are not refused', () => {
  assert.ok(!set.profiles.some((p) => p.id === 'x13' || unsupported(p.identify.tag)));
  assert.ok(!(set.lineage.modelRuntimes ?? []).some((r) => r.id === 'x13'));
  assert.equal(unsupported('X14 '), null);
});
