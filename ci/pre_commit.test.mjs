import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root } from './local_config.mjs';

const guard = (...paths) => spawnSync(process.execPath, [join(root, 'ci/pre_commit.mjs'), ...paths], { encoding: 'utf8', windowsHide: true });

test('the pre-commit guard refuses firmware by name and by content, and accepts packs and text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-guard-'));
  try {
    const file = (name, data) => { writeFileSync(join(dir, name), data); return join(dir, name); };
    const ok = [file('pack.json', '{"format":"md-pack/1"}'), file('notes.md', '# notes'), file('small.dat', Buffer.alloc(1024))];
    assert.equal(guard(...ok).status, 0);
    for (const bad of [file('os.syx', 'x'), file('flash.BIN', 'x'), file('renamed.json', Buffer.from([0xf0, 0, 0x20, 0x3c])),
      file('dump.dat', Buffer.alloc(512 * 1024))]) {
      const result = guard(bad);
      assert.equal(result.status, 1, bad);
      assert.match(result.stderr, /firmware is never committed/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
