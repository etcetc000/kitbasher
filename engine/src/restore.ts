// A previous session from an OS Kitbasher built (the .syx or .bin the user flashed): the machine
// IDs, so kits saved with it keep finding their machines. Every build embeds its layout table
// (layout.ts); an image without one (or with one this engine cannot read) still names its machines:
// the build's boot routine writes each added machine's descriptor into the OS's descriptor table,
// and the descriptor carries the machine's ID (+4) and its name (+5, five characters). Those names
// are matched to the catalog's models.

import { u32 } from './bytes.js';
import type { Firmware } from './container.js';
import { LAYOUT_FORMAT, findLayout, type Layout } from './layout.js';
import type { PackModel } from './packs.js';
import { readBootRamWrites } from './boot_safety.js';
import { menuCategory, menuOrder } from './sound_catalog.js';

export interface Recovered {
  layout: Layout;
  how: 'table' | 'descriptors';
  /** machines the image has that the catalog does not (by name), with their IDs */
  unknown: { id: number; name: string }[];
}

/** Where a boot routine of ours sits in the OS area: its RAM-copy loops, then the patch loop. */
function bootRoutines(flash: Uint8Array): number[] {
  const out: number[] = [];
  const end = Math.min(flash.length, 0x100000) - 26;
  for (let o = 0x4000; o < end; o += 2) {
    if (flash[o] === 0x41 && flash[o + 1] === 0xf9 && flash[o + 6] === 0x43 && flash[o + 7] === 0xf9 &&
        flash[o + 12] === 0x20 && flash[o + 13] === 0x3c && flash[o + 18] === 0x22 && flash[o + 19] === 0xd8 &&
        flash[o + 20] === 0x53 && flash[o + 21] === 0x80 && flash[o + 22] === 0x66 && flash[o + 23] === 0xfa) out.push(o);
  }
  return out;
}

/**
 * The added machines of an image Kitbasher built, from its descriptor-table patches: ID -> name.
 * `descriptorTable` is the OS's (bases/lineage-163.json os.descriptor_table); `alias` the run-time
 * address the OS maps flash at (descriptors that live in flash).
 */
export function machinesFromDescriptors(flash: Uint8Array, descriptorTable: number, alias = 0x10000000): Map<number, string> | null {
  for (const routine of bootRoutines(flash)) {
    let writes: [number, number][];
    // the SRAM range is allowed: some builds also patch the SRAM copy of the OS
    try { writes = readBootRamWrites(flash, routine, { dst: 0x01000000, len: 0x10000 }); } catch { continue; }
    // the RAM copies the routine makes: run-time [dst, dst + n) holds flash [src, ...)
    const copies: [number, number, number][] = [];
    for (let o = routine; flash[o] === 0x41 && flash[o + 1] === 0xf9 && flash[o + 6] === 0x43; o += 24) {
      copies.push([u32(flash, o + 2), u32(flash, o + 8), u32(flash, o + 14) * 4]);
    }
    const at = (a: number): number | null => {
      for (const [src, dst, n] of copies) if (a >= dst && a + 10 <= dst + n) return src + (a - dst);
      if (a >= alias && a - alias + 10 <= flash.length) return a - alias;
      return null;
    };
    const out = new Map<number, string>();
    for (const [site, desc] of writes) {
      if (site < descriptorTable || site >= descriptorTable + 4 * 192 || (site - descriptorTable) % 4) continue;
      const id = (site - descriptorTable) / 4;
      const f = at(desc);
      if (f === null || flash[f + 4] !== id) continue;                 // the descriptor names its own ID
      out.set(id, String.fromCharCode(...flash.subarray(f + 5, f + 10)));
    }
    if (out.size) return out;
  }
  return null;
}

/**
 * Names the catalog's models were published under before (catalog/ before commit 387a991,
 * "Rename models to engine-based names"), as a descriptor of an older build carries them.
 */
export const FORMER_NAMES: Record<string, string[]> = {
  'VAD/BD': ['AN BD'], 'VAD/CY': ['AN CY'], 'VAD/HH': ['AN HH'], 'VAD/PC': ['AN PC'], 'VAD/RC': ['AN RC'],
  'VAD/SD': ['AN SD'], 'VAD/SY': ['AN SY'], 'OSC/AC': ['ACID '], 'OSC/SP': ['SAWPW'], 'FMS/4O': ['FM4OP'],
  'VOX/FR': ['FORMT'], 'NZE/PL': ['NOISE'], 'FMS/2O': ['FM ST'], 'FMS/3O': ['FM PA'], 'FMS/SW': ['FM DY'],
  'OSC/SW': ['MMSAW'], 'OSC/PW': ['MMPLS'], 'WAV/TB': ['MMWAV'], 'VOX/VO': ['MMVO6'], 'OSC/8B': ['MMSID'],
  'WAV/CH': ['MMDEN'], 'OSC/CH': ['MMENS'], 'WAV/MR': ['MMDDR'],
};

/** Key prefix of a session entry for a machine the catalog does not have: kept so its ID stays reserved. */
export const UNKNOWN_KEY = '?';

/** The catalog model a descriptor name means: its name now, or one it had before. */
function modelNamed(models: PackModel[], name: string): PackModel | undefined {
  const t = name.trim();
  return models.find((m) => m.name === name || m.name.trim() === t) ??
    models.find((m) => (FORMER_NAMES[m.key] ?? []).some((f) => f.trim() === t) || (m.aliases ?? []).some((a) => (FORMER_NAMES[a] ?? []).some((f) => f.trim() === t)));
}

/** The session an image Kitbasher built carries, or null when it is not one. */
export function recoverSession(fw: Firmware, models: PackModel[], descriptorTable: number): Recovered | null {
  const keys = new Set(models.map((m) => m.key));
  const aliasOf = new Map(models.flatMap((m) => (m.aliases ?? []).map((a) => [a, m.key] as const)));
  const found = machinesFromDescriptors(fw.flash, descriptorTable);
  const table = findLayout(fw);
  if (table) {
    const l = table.layout;
    // two entries on one ID (a session reused an ID): the machine the image really has there wins
    const byId = new Map<number, string[]>();
    for (const [k, p] of Object.entries(l.machines)) byId.set(p.id, [...(byId.get(p.id) ?? []), k]);
    const machines = { ...l.machines };
    for (const [id, ks] of byId) {
      if (ks.length < 2) continue;
      const there = found?.get(id);
      const m = there === undefined ? undefined : modelNamed(models, there);
      const keep = m ? ks.find((k) => k === m.key || aliasOf.get(k) === m.key) : undefined;
      for (const k of ks) if (k !== (keep ?? ks[ks.length - 1])) delete machines[k];
    }
    const unknown = Object.entries(machines).filter(([k]) => !keys.has(k) && !aliasOf.has(k))
      .map(([k, p]) => ({ id: p.id, name: k.startsWith(UNKNOWN_KEY) ? k.slice(1).replace(/@\d+$/, '') : k }));
    return { layout: { ...l, machines }, how: 'table', unknown };
  }
  if (!found) return null;
  const unknown: Recovered['unknown'] = [];
  const placed: { m: PackModel; id: number }[] = [];
  for (const [id, name] of [...found].sort((a, b) => a[0] - b[0])) {
    const m = modelNamed(models, name);
    if (m) placed.push({ m, id }); else unknown.push({ id, name: name.trim() });
  }
  const cats = [...new Set(placed.map((p) => menuCategory(p.m)))].sort((a, b) => menuOrder(a) - menuOrder(b));
  const machines: Layout['machines'] = {};
  for (const c of cats) placed.filter((p) => menuCategory(p.m) === c).forEach((p, i) => { machines[p.m.key] = { id: p.id, category: c, order: i }; });
  // machines the catalog does not know keep their IDs reserved (selection.ts: an unselected entry)
  if (unknown.length && !cats.length) cats.push('OTH');
  const after = Object.values(machines).filter((p) => p.category === cats[0]).length;
  unknown.forEach((u, i) => { machines[`${UNKNOWN_KEY}${u.name}@${u.id}`] = { id: u.id, category: cats[0], order: after + i }; });
  // the base is the one the user loads to patch again: '' until then (layout-ui.ts setBase)
  return { layout: { format: LAYOUT_FORMAT, base: '', categories: cats, machines }, how: 'descriptors', unknown };
}
