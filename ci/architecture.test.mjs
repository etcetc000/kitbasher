import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

test('engine host adapters stay at the boundary; selection and instruction gates remain independent', () => {
  const directory = new URL('../engine/src/', import.meta.url);
  for (const file of readdirSync(directory).filter(f => f.endsWith('.ts') && !['cli.ts', 'node.ts'].includes(f))) {
    const name = file.slice(0, -3), path = new URL(file, directory);
    const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      if (!statement.moduleSpecifier) continue;
      assert.doesNotMatch(statement.moduleSpecifier.text, /^(node:)|\/(cli|node)\.js$/,
        `${name} must remain independent of host I/O`);
      if (['selection', 'isa_gate'].includes(name))
        assert.doesNotMatch(statement.moduleSpecifier.text, /\/(build|plan)\.js$/,
          `${name} must remain independent of orchestration`);
    }
  }
});
