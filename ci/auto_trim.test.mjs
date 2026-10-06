import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../web/src/auto-trim.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { findTrimThreshold } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

test('auto trim refines the first fitting interval without chasing unrelated errors', () => {
  const found = findTrimThreshold(db => ({ db, fits: db >= -23.6, ok: false }), p => p.fits);
  assert.equal(found.db, -23.6);
  assert.equal(found.value.db, found.db);
  assert.equal(found.value.ok, false, 'compatibility errors remain unresolved');
});

test('auto trim stops at a fitting minimum and bounds an impossible search', () => {
  const calls = [];
  const found = findTrimThreshold(db => { calls.push(db); return true; }, value => value);
  assert.equal(found.db, -40);
  assert.deepEqual(calls, [-40]);
  const impossible = findTrimThreshold(db => { calls.push(db); return false; }, value => value, -10.5);
  assert.equal(impossible.db, -10);
  assert.equal(impossible.value, false);
  assert.deepEqual(calls, [-40, -10.5, -10]);
});
