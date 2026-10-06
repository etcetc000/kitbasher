// Loading bases and packs from directories (Node only; the page fetches its bundled data and reads
// pack files the user chooses).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { baseSet, type BaseProfileFile, type BaseSet, type LineageFile } from './bases.js';
import type { CorePack, Pack } from './packs.js';

/**
 * The local pack directory: model packs the user keeps outside the checkout. MD_PACKS overrides
 * the default. The CLI reads it next to catalog/ when it exists.
 */
export const LOCAL_PACKS = process.env.MD_PACKS ?? join(homedir(), 'Documents/kitbasher-packs');

export function loadBases(dir: string): BaseSet {
  return baseSet(readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BaseProfileFile | LineageFile));
}

/** Every pack in these directories (missing ones skipped); the engine merges a family's packs. */
export function loadPacks(dirs: string | string[]): { packs: Pack[]; core: CorePack; dirs: string[] } {
  const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => existsSync(d));
  const files = list.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as Pack | CorePack));
  const cores = files.filter((f) => f.family === 'CORE') as CorePack[];
  if (!cores.length) throw new Error(`no core.json in ${list.join(', ') || 'any pack directory'}: a pack directory needs the core.json of its pack set`);
  if (cores.some((c) => JSON.stringify(c) !== JSON.stringify(cores[0]))) throw new Error('two different core packs');
  return { packs: files.filter((f) => f.family !== 'CORE') as Pack[], core: cores[0], dirs: list };
}
