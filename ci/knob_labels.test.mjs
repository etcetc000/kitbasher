// A knob with no function has an empty label, so the Machinedrum and the page do not show it
// (type 0 in the descriptor). A placeholder such as "--" or "----" draws a knob that does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifests = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return manifests(path);
  return name.endsWith('.json') ? [path] : [];
});
const placeholder = /^[-_. ]+$/;

test('no knob is labelled with a placeholder: unused knobs have an empty label', () => {
  const bad = [];
  for (const path of manifests(join(root, 'examples'))) {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    if (m.format !== 'md-model/1') continue;
    m.panel.knobs.forEach((k, i) => { if (placeholder.test(k.label)) bad.push(`${relative(root, path)} knob ${i + 1} "${k.label}"`); });
    for (const mode of m.panel.modes ?? []) for (const z of mode.zones)
      for (const [k, label] of Object.entries(z.labels)) if (placeholder.test(label)) bad.push(`${relative(root, path)} MODE ${z.min}..${z.max} knob ${Number(k) + 1} "${label}"`);
  }
  assert.deepEqual(bad, []);
});
