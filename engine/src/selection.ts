// Catalog composition and kit-compatible ID allocation. No placement, compression or I/O.
import type { Base } from './bases.js';
import type { Layout } from './layout.js';
import { u32 } from './bytes.js';
import { checkPack, needsUwSamples, type Pack, type PackModel, type PackTable } from './packs.js';

/** Machine IDs a Machinedrum without UW can use: below 128 (it takes 128 off any higher one). */
export const NO_UW_ID_LIMIT = 128;

export interface ModelFilter {
  modelKeys?: string[];
  families?: string[];
  exclude?: string[];
}

/** `family` is the menu category the machine is listed in; `mapped`: its ID is the user's map's */
export interface Selected { m: PackModel; family: string; id: number; preferred: number; mapped: boolean }

export interface Family { name: string; models: PackModel[] }

export interface IdMove { name: string; module: string; preferred: number; id: number; why: string }

export interface MergedFamily { name: string; order: number; models: PackModel[]; shared: PackTable[] }

/**
 * The packs as families. A family may arrive in several packs (for example a pack the user loaded
 * next to a bundled one): its machines and shared tables are merged and put back in
 * the family's own order (`seq`). The same machine or table twice is fine when it is the same
 * bytes, and an error when it is not (packs from two different exports).
 */
export function merged(packs: Pack[]): MergedFamily[] {
  for (const p of packs) checkPack(p);
  const ordered = [...packs].sort((a, b) => a.order - b.order);
  const fams = new Map<string, MergedFamily>();
  const models = new Map<string, PackModel>();
  const tables = new Map<string, PackTable>();
  for (const p of ordered) {
    let f = fams.get(p.family);
    if (!f) { f = { name: p.family, order: p.order, models: [], shared: [] }; fams.set(p.family, f); }
    if (f.order !== p.order) throw new Error(`family ${p.family} comes with two different orders (${f.order}, ${p.order})`);
    for (const m of p.models) {
      const had = models.get(m.key);
      if (had) {
        if (JSON.stringify(had) !== JSON.stringify(m)) throw new Error(`machine ${m.key} (${m.name.trim()}) is in two packs with different contents`);
        continue;
      }
      models.set(m.key, m);
      f.models.push(m);
    }
    for (const t of p.shared) {
      const had = tables.get(t.name);
      if (had) {
        if (had.words !== t.words) throw new Error(`shared table ${t.name} is in two packs with different contents`);
        continue;
      }
      tables.set(t.name, t);
      f.shared.push(t);
    }
  }
  const bySeq = <T extends { seq?: number }>(a: T[]): T[] =>
    a.map((x, i) => [x, i] as const).sort((p, q) => (p[0].seq ?? p[1]) - (q[0].seq ?? q[1])).map(([x]) => x);
  return [...fams.values()].map((f) => ({ ...f, models: bySeq(f.models), shared: bySeq(f.shared) }));
}

/**
 * Former key -> current key, over every model of the packs. A renamed model lists the keys it was
 * published under in `aliases`, so a layout saved, or a selection written, before the rename still
 * finds it. An alias that is another model's key, or that two models claim, is an error: it could
 * not say which model it means.
 */
export function keyAliases(models: PackModel[]): Map<string, string> {
  const keys = new Set(models.map((m) => m.key));
  const out = new Map<string, string>();
  for (const m of models) {
    for (const a of m.aliases ?? []) {
      if (keys.has(a)) throw new Error(`${m.key} (${m.name.trim()}) lists alias ${a}, which is the key of another model`);
      const had = out.get(a);
      if (had !== undefined && had !== m.key) throw new Error(`alias ${a} is claimed by both ${had} and ${m.key}`);
      out.set(a, m.key);
    }
  }
  return out;
}

/** A key, or the current key of the model it is an alias of. */
export const resolveKey = (aliases: Map<string, string>, key: string): string => aliases.get(key) ?? key;

/**
 * A layout with every machine under its model's current key. Unknown keys stay as they are (a map
 * may name machines this catalog does not carry); the same model named twice, under an old key
 * and its new one, is an error rather than a silent choice between two placements.
 */
export function resolveLayout(l: Layout, aliases: Map<string, string>): Layout {
  if (!Object.keys(l.machines).some((k) => aliases.has(k))) return l;
  const machines: Layout['machines'] = {};
  const from = new Map<string, string>();
  for (const [k, p] of Object.entries(l.machines)) {
    const key = resolveKey(aliases, k);
    if (from.has(key)) throw new Error(`the layout names ${key} twice: as ${from.get(key)} and as ${k}`);
    from.set(key, k);
    machines[key] = p;
  }
  return { format: l.format, base: l.base, categories: l.categories, machines, ...(l.uw === undefined ? {} : { uw: l.uw }) };
}

export function select(packs: Pack[], opt: ModelFilter): { fams: Family[]; shared: PackTable[]; aliases: Map<string, string> } {
  const all = merged(packs);
  const aliases = keyAliases(all.flatMap((f) => f.models));
  let keys: Set<string> | null = null;
  if (opt.modelKeys !== undefined) {
    if (!Array.isArray(opt.modelKeys) || !opt.modelKeys.length ||
      opt.modelKeys.some(k => typeof k !== 'string' || !k.length) ||
      new Set(opt.modelKeys).size !== opt.modelKeys.length) throw new Error('modelKeys requires unique nonempty model keys');
    if (opt.families !== undefined || opt.exclude !== undefined) throw new Error('modelKeys cannot be combined with families or exclude');
    keys = new Set(opt.modelKeys.map((k) => resolveKey(aliases, k)));
    if (keys.size !== opt.modelKeys.length) throw new Error('modelKeys names the same model twice (under a former key and its current one)');
    const known = new Set(all.flatMap(f => f.models.map(m => m.key)));
    for (const key of keys) if (!known.has(key)) throw new Error(`selected model key is not in the catalog: ${key}`);
  }
  const want = opt.families ? new Set(opt.families) : null;
  // `exclude` names modules; a model published from a directory has its key as its module, so a
  // former key there means the renamed model's module
  const moduleOf = new Map(all.flatMap((f) => f.models.map((m) => [m.key, m.module] as const)));
  const ex = new Set((opt.exclude ?? []).map((e) => (aliases.has(e) ? moduleOf.get(aliases.get(e)!)! : e)));
  const fams = all.filter((p) => !want || want.has(p.name))
    .map((p) => ({ name: p.name, models: p.models.filter((m) => (!keys || keys.has(m.key)) && !ex.has(m.module)) }))
    // A family with no machine left gets no menu entry.
    .filter((f) => f.models.length > 0);
  // Shared tables come from every pack, selected or not: other families read DF's (ki, gi, ...).
  const shared = all.flatMap((p) => p.shared);
  return { fams, shared, aliases };
}

/**
 * Every machine on its preferred ID. Saved kits address machines by ID, so an ID that is not
 * free is an error naming why; only with `allowMove` does the machine take the next free ID up,
 * and every such move is returned.
 *
 * `noUw` (a Machinedrum without UW, which takes 128 off any machine ID of 128 or more): no
 * machine goes on 128 and up. A machine pinned there (its preferred ID, or the map's) moves to the
 * lowest free ID below 128, reported as a move whether or not `allowMove` is set; automatic IDs
 * stay below 128; a model that plays a UW sample is refused.
 */
export function allocateIds(base: Base, main: Uint8Array, fams: Family[], allowMove: boolean, layout: Layout | undefined,
  listed: Map<number, string>, opt: { noUw?: boolean } = {}): { sel: Selected[]; moves: IdMove[]; problems: string[] } {
  const o = base.os;
  const noUw = !!opt.noUw;
  const top = noUw ? NO_UW_ID_LIMIT : 192;
  const HIGH = 'an ID a Machinedrum without UW cannot use (128 and up)';
  const taken = new Map<number, string>();
  const why = (id: number): string | null => {
    if (!Number.isInteger(id) || id < 0 || id >= 192) return 'outside 0..191';
    if (id >= top) return HIGH;
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
  const automaticId = (m: PackModel): boolean => !!m.contract?.components.dsp2?.source && m.contract.injection.id === undefined;
  const ordered = fams.flatMap(f => f.models.map(m => ({ f, m })));
  // Place existing/pinned models before unassigned contributions. Otherwise an
  // earlier category's automatic model can steal a later model's existing ID.
  // Menu order is restored below; it is independent of placement priority.
  // Without UW, a machine pinned on 128+ moves to the lowest ID still free once every other machine
  // has its own, so the rest get the IDs they get with UW.
  const rank = (m: PackModel): number => noUw && !automaticId(m) && (layout?.machines[m.key]?.id ?? m.id) >= top ? 2
    : automaticId(m) ? 1 : 0;
  const allocationOrder = [...ordered].sort((a, b) => rank(a.m) - rank(b.m));
  if (noUw) {
    for (const { m } of ordered) {
      if (needsUwSamples(m)) problems.push(`${m.name.trim()} plays a sample from UW sample memory, which a Machinedrum without UW does not have: leave it out`);
    }
  }
  for (const { m } of ordered) {
    const p = layout?.machines[m.key];
    if (!p) continue;
    if (p.id >= top) continue;                       // without UW: moved below, like a pinned ID
    const w = why(p.id);
    if (w) { problems.push(`the map puts ${m.name.trim()} on ID ${p.id}, which is ${w}`); continue; }
    taken.set(p.id, m.name.trim());
    mapOk.add(m.key);
  }
  for (const { f, m } of allocationOrder) {
    const name = m.name.trim();
    const want = m.id;
    const automatic = automaticId(m);
    const p = layout?.machines[m.key];
    const lowest = (): number => { let v = 0; while (v < top && why(v)) v++; return v; };
    if (p && p.id >= top) {
      // the map pins it on 128+, which this unit cannot use: the lowest free ID below 128
      const id = lowest();
      if (id >= top) { problems.push(`no free machine ID below ${top} left for ${name} (the map puts it on ${p.id}, and a Machinedrum without UW cannot use 128 and up): remove a selected model`); continue; }
      moves.push({ name, module: m.module, preferred: p.id, id, why: HIGH });
      taken.set(id, name);
      sel.push({ m, family: p.category, id, preferred: p.id, mapped: true });
      continue;
    }
    if (p) {
      if (mapOk.has(m.key)) sel.push({ m, family: p.category, id: p.id, preferred: want, mapped: true });
      continue;
    }
    const w = why(want);
    let id = want;
    if (automatic) {
      id = lowest();
      if (id >= top) { problems.push(`no free machine ID ${noUw ? 'below 128 ' : ''}left for ${name}: remove a selected model; sample trimming does not free IDs`); continue; }
      taken.set(id, name);
      sel.push({ m, family: f.name, id, preferred: id, mapped: false });
      continue;
    }
    if (w && noUw && want >= top) {
      // pinned on 128+: without UW it moves to the lowest free ID below 128, allowed or not
      id = lowest();
      if (id >= top) { problems.push(`no free machine ID below ${top} left for ${name} (its ID is ${want}, and a Machinedrum without UW cannot use 128 and up): remove a selected model`); continue; }
      moves.push({ name, module: m.module, preferred: want, id, why: w });
    } else if (w) {
      if (!allowMove) {
        blocked.push(`${name} (ID ${want}, ${w})`);
        continue;
      }
      while (id < top && why(id)) id++;
      if (id >= top) { problems.push(`no free machine ID ${noUw ? 'below 128 ' : ''}left for ${name}: remove a selected model; sample trimming does not free IDs`); continue; }
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
