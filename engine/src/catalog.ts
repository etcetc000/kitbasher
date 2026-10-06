// Catalog changes are transactional: validate the entire selection before replacing state.
import { checkPack, type CorePack, type Pack } from './packs.js';
import { merged } from './selection.js';

export interface Catalog { packs: Pack[]; core: CorePack | null }
export function selectCatalog(current: Catalog, files: (Pack | CorePack)[], mode: 'add' | 'replace'): Catalog {
  if (!files.length) throw new Error('Choose at least one pack file');
  for (const p of files) checkPack(p);
  const cores = files.filter(p => p.family === 'CORE') as CorePack[];
  const core = mode === 'replace' ? cores[0] ?? null : current.core ?? cores[0] ?? null;
  if (cores.some(p => JSON.stringify(p) !== JSON.stringify(core)))
    throw new Error('Different core revisions: use Replace catalog and select one complete pack set');
  const packs = [...(mode === 'replace' ? [] : current.packs), ...files.filter(p => p.family !== 'CORE') as Pack[]];
  if (mode === 'replace' && (!core || !packs.length))
    throw new Error('Replacing a catalog requires core.json and at least one family pack');
  merged(packs); // Includes conflicting copies of a model or shared table.
  return { core, packs };
}
