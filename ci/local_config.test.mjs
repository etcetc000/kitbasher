import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateConfig, config, settings } from './local_config.mjs';

test('local configuration rejects typos and relative paths', () => {
  assert.throws(() => validateConfig({ pythno: '/python' }), /Unknown/);
  assert.throws(() => validateConfig({ python: 'python.exe' }), /absolute/);
  assert.deepEqual(validateConfig({}), {});
});

test('the local file takes precedence over the environment, and the environment over defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-paths-'));
  try {
    const file = join(dir, 'config.json');
    const env = { MD_LOCAL_CONFIG: file };
    for (const rule of Object.values(settings)) delete env[rule.env];
    writeFileSync(file, '{}');
    assert.deepEqual(config(env, dir), { packDir: join(dir, 'Documents/kitbasher-packs') });
    env.MD_PACKS = join(dir, 'env-packs');
    assert.deepEqual(config(env, dir), { packDir: join(dir, 'env-packs') });
    writeFileSync(file, JSON.stringify({ packDir: join(dir, 'local-packs') }));
    assert.deepEqual(config(env, dir), { packDir: join(dir, 'local-packs') });
    for (const local of [{ typo: dir }, { packDir: null }, { packDir: 'relative' }]) {
      writeFileSync(file, JSON.stringify(local));
      assert.throws(() => config(env));
    }
    env.MD_PACKS = 'relative';
    writeFileSync(file, '{}');
    assert.throws(() => config(env), /absolute/);
    rmSync(file);
    assert.throws(() => config(env), /Missing explicit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
