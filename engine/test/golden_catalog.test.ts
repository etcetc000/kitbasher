import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The firmware golden hashes (GOLDEN in midi_chroma.test.ts, GOLDEN_OFF in unmute.test.ts) are builds
// of the bundled catalog, so any change to catalog/ changes them. Those tests need OS files and are
// skipped where there are none, CI included; this one needs nothing and runs everywhere. It fails when
// catalog/ is no longer the catalog the goldens were recorded from. After a catalog change, rebuild the
// goldens with MD_FIRMWARE_DIR set, and record the new hashes and this fingerprint in the same change.
const GOLDEN_CATALOG = 'e5e8d66a6162b0e5353bcf62d2636e04ae7d43e2d9b2dc302c925ead680ef7c7';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** What a build reads from a catalog directory (loadPacks: its *.json but index.json), as parsed JSON:
 *  line endings and formatting do not count, contents and file names do. */
function catalogFingerprint(dir: string): string {
  const h = createHash('sha256');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'index.json').sort())
    h.update(`${f}\n${JSON.stringify(JSON.parse(readFileSync(join(dir, f), 'utf8')))}\n`);
  return h.digest('hex');
}

test('the firmware goldens were recorded from the bundled catalog as it is', () => {
  assert.equal(catalogFingerprint(join(ROOT, 'catalog')), GOLDEN_CATALOG,
    'catalog/ changed since the firmware goldens in midi_chroma.test.ts and unmute.test.ts were recorded: ' +
    'rebuild them with MD_FIRMWARE_DIR set, then record the new hashes and this fingerprint together');
});
