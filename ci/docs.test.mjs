import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { root } from './local_config.mjs';

const skip = new Set(['node_modules', 'build', 'dist', '.git']);
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (skip.has(e.name)) return [];
    const path = join(dir, e.name);
    return e.isDirectory() ? markdown(path) : e.name.endsWith('.md') ? [path] : [];
  });
}

test('every relative link in every Markdown file resolves', () => {
  const broken = [];
  for (const file of markdown(root)) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      if (!existsSync(resolve(dirname(file), decodeURI(target.split('#')[0]))))
        broken.push(`${relative(root, file).replaceAll('\\', '/')}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});
