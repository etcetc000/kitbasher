import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Base } from '../src/bases.js';
import { build, requireUwAnswer, uwFromFlags, UwAnswerRequired, type BuildOptions } from '../src/build.js';
import { LAYOUT_FORMAT, type Layout } from '../src/layout.js';
import type { CorePack } from '../src/packs.js';

// The UW answer is mandatory: no build without the user's own Yes or No. A layout that records one
// (a restored file) does not stand in for it, on the page, in the engine or on the command line.

const layout = (uw?: boolean): Layout => ({ format: LAYOUT_FORMAT, base: 'x', categories: [], machines: {}, ...(uw === undefined ? {} : { uw }) });
const opts = (o: Partial<BuildOptions>): BuildOptions => ({ trim: { db: -30, minSeconds: 0.5, cap: null }, ...o } as BuildOptions);

test('requireUwAnswer: only an explicit true or false', () => {
  assert.equal(requireUwAnswer({ uw: true }), true);
  assert.equal(requireUwAnswer({ uw: false }), false);
  assert.equal(requireUwAnswer({ uw: false, noUw: true }), false);
  for (const uw of [undefined, null, 'yes', 0, 1]) assert.throws(() => requireUwAnswer({ uw }), UwAnswerRequired);
  assert.throws(() => requireUwAnswer({ noUw: true }), UwAnswerRequired);          // noUw alone is not the answer
  assert.throws(() => requireUwAnswer({ uw: true, noUw: true }), /Conflicting/);
});

test('build refuses without an explicit uw, before reading anything; a layout\'s uw does not satisfy it', async () => {
  const run = (o: Partial<BuildOptions>) => build(new Uint8Array(0), {} as Base, [], {} as CorePack, opts(o));
  await assert.rejects(run({}), UwAnswerRequired);
  await assert.rejects(run({ layout: layout(true) }), UwAnswerRequired);
  await assert.rejects(run({ layout: layout(false) }), UwAnswerRequired);
  await assert.rejects(run({ layout: layout(false), noUw: true }), /Answer the UW question/);
  // with an answer it gets past the check (and fails later on the empty input, not on the answer)
  await assert.rejects(run({ uw: true, layout: layout(false) }), (e: Error) => !(e instanceof UwAnswerRequired));
});

test('uwFromFlags: exactly one of --uw and --no-uw', () => {
  assert.equal(uwFromFlags({ uw: true }), true);
  assert.equal(uwFromFlags({ noUw: true }), false);
  assert.throws(() => uwFromFlags({}), /pass --uw .* or --no-uw/);
  assert.throws(() => uwFromFlags({ uw: true, noUw: true }), /choose one/);
});

test('the CLI refuses to build without --uw or --no-uw, even when a restored layout records an answer', () => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'kb-uw-'));
  const map = join(dir, 'layout.json');
  writeFileSync(map, JSON.stringify(layout(true)));
  const out = join(dir, 'out.syx');
  for (const extra of [[], ['--restore', map], ['--map', map], ['--uw', '--no-uw']]) {
    const r = spawnSync(process.execPath, [cli, '--in', join(dir, 'missing.syx'), '--out', out, ...extra], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 1, `${extra.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, extra.length === 2 && extra[0] === '--uw' ? /choose one/ : /--uw .*--no-uw/);
    assert.doesNotMatch(r.stderr, /ENOENT/);                                       // refused before reading the input
  }
});
