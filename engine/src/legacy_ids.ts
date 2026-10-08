// The machine IDs Kitbasher gave before IDs were assigned bottom-up (2026-10): each model on the ID
// its pack named (OSCPW 175, WAVTB 124, OSC8B 126, VOXVO 127, WAVCH 6, FMSSW 10, FMS2O 11, ...), and
// every model without one on the lowest free ID after them, the whole catalog selected. Offered as
// a layout ("IDs of earlier Kitbasher builds") so kits saved with an earlier build keep finding
// their machines. Kept verbatim from that allocator; nothing else uses it.
//
// The allocator runs over LEGACY_MODELS, the catalog as it was when the switch was made, never over
// the catalog of today: a model added later would otherwise join the allocation and shift every
// automatic ID after it (a new model in front of NZEPL took its 43, and NZEPL and PHYKS moved up one).
import type { Base } from './bases.js';
import { u32 } from './bytes.js';
import { LAYOUT_FORMAT, type Layout } from './layout.js';
import type { PackModel } from './packs.js';
import type { Family, IdMove, Selected } from './selection.js';
import { menuCategory, menuOrder } from './sound_catalog.js';

export const LEGACY_LAYOUT_NAME = 'IDs of Kitbasher builds before 2026-10';

/** A model of the catalog the earlier allocator ran over: its key, its pack's ID (null: none, the next free ID). */
export interface LegacyModel { key: string; name: string; id: number | null }

/**
 * The catalog the earlier allocator ran over, in its order (catalog/ of 031c150^, the last commit
 * before bottom-up IDs, selected whole). Frozen: a model added since is not in it and never moves
 * one of these; the restore path gives it a free ID around them. Never edit, reorder or extend it.
 */
export const LEGACY_MODELS: readonly LegacyModel[] = Object.freeze([
  { key: 'VAD/BD', name: 'VADBD', id: null },
  { key: 'VAD/CY', name: 'VADCY', id: null },
  { key: 'VAD/HH', name: 'VADHH', id: null },
  { key: 'VAD/PC', name: 'VADPC', id: null },
  { key: 'VAD/RC', name: 'VADRC', id: null },
  { key: 'VAD/SD', name: 'VADSD', id: null },
  { key: 'VAD/SY', name: 'VADSY', id: null },
  { key: 'OSC/AC', name: 'OSCAC', id: null },
  { key: 'FMS/4O', name: 'FMS4O', id: null },
  { key: 'VOX/FR', name: 'VOXFR', id: null },
  { key: 'OSC/SP', name: 'OSCSP', id: null },
  { key: 'NZE/PL', name: 'NZEPL', id: null },
  { key: 'PHY/KS', name: 'PHYKS', id: null },
  { key: 'FMS/2O', name: 'FMS2O', id: 11 },
  { key: 'FMS/3O', name: 'FMS3O', id: 12 },
  { key: 'FMS/SW', name: 'FMSSW', id: 10 },
  { key: 'OSC/SW', name: 'OSCSW', id: 13 },
  { key: 'OSC/PW', name: 'OSCPW', id: 175 },
  { key: 'WAV/TB', name: 'WAVTB', id: 124 },
  { key: 'VOX/VO', name: 'VOXVO', id: 127 },
  { key: 'OSC/8B', name: 'OSC8B', id: 126 },
  { key: 'WAV/CH', name: 'WAVCH', id: 6 },
  { key: 'OSC/CH', name: 'OSCCH', id: 14 },
  { key: 'WAV/MR', name: 'WAVMR', id: 30 },
].map((m) => Object.freeze(m)));

/**
 * The earlier allocator, unchanged (with moves allowed, as the page always built), over the selected
 * models that are in `table` (by key or former key), in the table's order and with the table's IDs.
 * Selected models not in it are left out: they get no earlier ID, so the caller places them.
 */
export function legacyAllocate(base: Base, main: Uint8Array, fams: Family[], listed: Map<number, string>,
  table: readonly LegacyModel[] = LEGACY_MODELS): { sel: Selected[]; moves: IdMove[]; problems: string[] } {
  const allowMove = true;
  const layout = undefined as Layout | undefined;
  const o = base.os;
  const taken = new Map<number, string>();
  const why = (id: number): string | null => {
    if (!Number.isInteger(id) || id < 0 || id >= 192) return 'outside 0..191';
    if (listed.has(id)) return `${base.name}'s own ${listed.get(id)} (its menu lists it)`;
    if (id >= o.deadIds[0] && id <= o.deadIds[1]) return 'in the MIDI range with no parameter packet';
    if (taken.has(id)) return `taken by ${taken.get(id)}`;
    if (u32(main, o.descriptorTable + 4 * id - o.cfBase) !== o.freeDescriptor) return `taken by one of ${base.name}'s own machines`;
    return null;
  };
  const sel: Selected[] = [];
  const moves: IdMove[] = [];
  const problems: string[] = [];
  const blocked: string[] = [];
  // the map's IDs first: they are the user's, and a machine the map does not name yields to them
  const mapOk = new Set<string>();
  const rank = new Map(table.map((t, i) => [t.key, i]));
  const entry = (m: PackModel): number | undefined => [m.key, ...(m.aliases ?? [])].map((k) => rank.get(k)).find((i) => i !== undefined);
  const frozen = new Map<string, LegacyModel>();
  for (const m of fams.flatMap((f) => f.models)) { const i = entry(m); if (i !== undefined) frozen.set(m.key, table[i]); }
  const automaticId = (m: PackModel): boolean => frozen.get(m.key)!.id === null;
  const ordered = fams.flatMap(f => f.models.filter((m) => frozen.has(m.key)).map(m => ({ f, m })))
    .sort((a, b) => entry(a.m)! - entry(b.m)!);
  // Place existing/pinned models before unassigned contributions. Otherwise an
  // earlier category's automatic model can steal a later model's existing ID.
  // Menu order is restored below; it is independent of placement priority.
  const allocationOrder = [...ordered].sort((a, b) => Number(automaticId(a.m)) - Number(automaticId(b.m)));
  for (const { m } of ordered) {
    const p = layout?.machines[m.key];
    if (!p) continue;
    const w = why(p.id);
    if (w) { problems.push(`the map puts ${m.name.trim()} on ID ${p.id}, which is ${w}`); continue; }
    taken.set(p.id, m.name.trim());
    mapOk.add(m.key);
  }
  for (const { f, m } of allocationOrder) {
    const name = m.name.trim();
    const want = frozen.get(m.key)!.id ?? 0;
    const automatic = automaticId(m);
    const p = layout?.machines[m.key];
    if (p) {
      if (mapOk.has(m.key)) sel.push({ m, family: p.category, id: p.id, preferred: want, mapped: true });
      continue;
    }
    const w = why(want);
    let id = want;
    if (automatic) {
      id = 0;
      while (id < 192 && why(id)) id++;
      if (id >= 192) { problems.push(`no free machine ID left for ${name}: remove a selected model; sample trimming does not free IDs`); continue; }
      taken.set(id, name);
      sel.push({ m, family: f.name, id, preferred: id, mapped: false });
      continue;
    }
    if (w) {
      if (!allowMove) {
        blocked.push(`${name} (ID ${want}, ${w})`);
        continue;
      }
      while (id < 192 && why(id)) id++;
      if (id >= 192) { problems.push(`no free machine ID left for ${name}: remove a selected model; sample trimming does not free IDs`); continue; }
      moves.push({ name, module: m.module, preferred: want, id, why: w });
    }
    taken.set(id, name);
    sel.push({ m, family: f.name, id, preferred: want, mapped: false });
  }
  if (blocked.length) {
    problems.push(`machine ID not free: ${blocked.join(', ')}. Saved kits find machines by ID, so a machine is not ` +
                  'moved to another ID unless you allow it (--allow-id-move); or leave it out');
  }
  const menuOrder = new Map(ordered.map(({ m }, i) => [m.key, i]));
  sel.sort((a, b) => menuOrder.get(a.m.key)! - menuOrder.get(b.m.key)!);
  return { sel, moves, problems };
}

/**
 * The layout the earlier allocator gives this selection (`families`: the selected models, as the
 * engine selects them), in the default menu categories: what a build of the same selection with an
 * earlier Kitbasher gave. Only models in LEGACY_MODELS are in it; a model added to the catalog
 * since is not, and the build gives it a free ID around these as for any restored session. The
 * .syx of that build is the exact record.
 */
export function legacyLayout(base: Base, main: Uint8Array, families: { name: string; models: PackModel[] }[], listed: Map<number, string>): Layout {
  const { sel } = legacyAllocate(base, main, families, listed);
  const cats = [...new Set(sel.map((s) => menuCategory(s.m)))].sort((a, b) => menuOrder(a) - menuOrder(b));
  const machines: Layout['machines'] = {};
  for (const c of cats) {
    sel.filter((s) => menuCategory(s.m) === c).forEach((s, i) => { machines[s.m.key] = { id: s.id, category: c, order: i }; });
  }
  return { format: LAYOUT_FORMAT, base: base.id, categories: cats, machines };
}
