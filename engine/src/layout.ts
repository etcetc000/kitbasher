// The user's layout: which ID each machine takes and where it sits in the machine-select menu.
//
// A layout (format md-layout/1) is a file a user can export, import and compare by fingerprint:
//   base         the base profile it was made for (IDs that are free differ per base)
//   categories   our menu categories, in menu order; they follow the base's own, which stay as
//                they are (read-only)
//   machines     pack key -> { id, category, order }
// The build honours it: every mapped machine takes its map ID (a map ID is not a "move", it is the
// user's choice, and every other ID gate still runs), and the menu lists follow the categories.
// Machines the map does not mention keep their preferred ID and their pack family's category.
//
// Every build embeds its layout (the map merged with every placement, or with no map the default
// one) as a small versioned table in free OS flash after the boot routine, never in the ColdFire
// RAM window; `findLayout` reads it back from a patched OS so a re-patch keeps IDs and categories.

import { be32, concat, h, sha256, u32, type Buf } from './bytes.js';
import { ramSegments, type Base } from './bases.js';
import type { Firmware } from './container.js';
import type { Family } from './selection.js';

export const LAYOUT_FORMAT = 'md-layout/1';

export interface MachinePlace { id: number; category: string; order: number }

export interface Layout {
  format: string;
  base: string;
  categories: string[];
  machines: Record<string, MachinePlace>;
  /**
   * The answer to "does your Machinedrum have the UW option?": true, false (then no machine on IDs
   * 128 and up: plan's `noUw`), or absent when the file does not say (a layout from before the
   * question; the page asks again).
   */
  uw?: boolean;
}

/**
 * What the MD's machine-select menu accepts (the lineage file's `os.menu`, measured in the base's
 * code). Enforced by `checkLayout` and shown in the web UI.
 */
export interface MenuLimits {
  nameBytes: number;          // bytes a family record holds for the name
  nameShown: number;          // characters the menu draws
  charset: string;            // characters the LCD font draws, as a list
  maxFamilies: number;        // family records, the base's own included
  maxPerList: number;         // machines in one menu list
}

export function menuLimits(base: Base): MenuLimits {
  return base.os.menu;
}

// ---- reading the base: its own machines and families -------------------------------------------

/** Read `n` bytes at a run-time address from the ColdFire slot or the base's add-on / scatter code. */
const segCache = new WeakMap<Uint8Array, [Uint8Array, number][]>();
function reader(fw: Firmware, base: Base): (addr: number, n: number) => Uint8Array | null {
  let segs = segCache.get(fw.slots[0].raw);
  if (!segs) {
    segs = [[fw.slots[0].raw, base.os.cfBase], ...ramSegments(fw, base).map((s) => [s.bytes, s.ram] as [Uint8Array, number])];
    segCache.set(fw.slots[0].raw, segs);
  }
  return (addr, n) => {
    for (const [b, at] of segs!) if (addr >= at && addr + n <= at + b.length) return b.subarray(addr - at, addr - at + n);
    return null;
  };
}

const text = (b: Uint8Array | null): string => (b ? String.fromCharCode(...Array.from(b).filter((c) => c)).replace(/\s+$/, '') : '?');

export type IdState = 'free' | 'dead' | 'base' | 'out';
export interface IdSlot { id: number; state: IdState; name?: string; why?: string }

/** Every machine ID 0..191 on this base: free, the MIDI range with no parameter packet, or one of the base's own. */
export function idSlots(fw: Firmware, base: Base): IdSlot[] {
  const O = base.os;
  const main = fw.slots[0].raw;
  const read = reader(fw, base);
  const listed = new Map(baseFamilies(fw, base).flatMap((f) => f.machines.map((m) => [m.id, m.name] as const)));
  const out: IdSlot[] = [];
  for (let id = 0; id < 192; id++) {
    const p = u32(main, O.descriptorTable + 4 * id - O.cfBase);
    if (p !== O.freeDescriptor || listed.has(id)) {
      // ID 0 is GND's empty machine: its descriptor is the one free IDs point at, but it is listed
      const name = p !== O.freeDescriptor ? text(read(p + 5, 5)) : listed.get(id)!;
      out.push({ id, state: 'base', name, why: `${base.name}'s own ${name}` });
    } else if (id >= O.deadIds[0] && id <= O.deadIds[1]) {
      out.push({ id, state: 'dead', why: `MIDI range ${O.deadIds[0]}..${O.deadIds[1]}: no parameter packet, silent on every hit` });
    } else {
      out.push({ id, state: 'free' });
    }
  }
  return out;
}

/** IDs the base's menus list whose descriptor is the free one (GND's empty machine on 0). */
export function listedFreeIds(fw: Firmware, base: Base): Map<number, string> {
  const main = fw.slots[0].raw;
  const O = base.os;
  return new Map(baseFamilies(fw, base).flatMap((f) => f.machines).filter((m) => u32(main, O.descriptorTable + 4 * m.id - O.cfBase) === O.freeDescriptor)
    .map((m) => [m.id, m.name]));
}

export interface BaseFamily { name: string; machines: { name: string; id: number }[] }

/** The base's own families, in menu order, with their machines' names. */
export function baseFamilies(fw: Firmware, base: Base): BaseFamily[] {
  const O = base.os;
  const main = fw.slots[0].raw;
  const read = reader(fw, base);
  const out: BaseFamily[] = [];
  for (let k = 0; ; k++) {
    const rec = main.subarray(O.familyTable - O.cfBase + 8 * k, O.familyTable - O.cfBase + 8 * k + 8);
    if (!rec[0]) break;
    const machines: BaseFamily['machines'] = [];
    for (let at = u32(rec, 4); ; at += 4) {
      const w = read(at, 4);
      if (!w || !u32(w, 0)) break;
      const d = u32(w, 0);
      machines.push({ name: text(read(d + 5, 5)), id: read(d + 4, 1)?.[0] ?? -1 });
    }
    out.push({ name: text(rec.subarray(0, 4)), machines });
  }
  return out;
}

// ---- the layout of a selection, and checking one -----------------------------------------------

/** The layout a build gets with no map: pack families as categories, pack order, preferred IDs. */
export function defaultLayout(base: Base, fams: Family[], idOf: (key: string) => number): Layout {
  const machines: Record<string, MachinePlace> = {};
  for (const f of fams) f.models.forEach((m, i) => { machines[m.key] = { id: idOf(m.key), category: f.name, order: i }; });
  return { format: LAYOUT_FORMAT, base: base.id, categories: fams.map((f) => f.name), machines };
}

/** Why a category name cannot go in the menu, or null. */
export function nameProblem(name: string, lim: MenuLimits, stock: string[]): string | null {
  if (!name.length) return 'a category needs a name';
  if (name.length > lim.nameShown) return `"${name}" is ${name.length} characters; the menu shows ${lim.nameShown}`;
  const bad = [...name].filter((c) => !lim.charset.includes(c));
  if (bad.length) return `"${name}": the MD's font has no ${[...new Set(bad)].map((c) => `"${c}"`).join(', ')} (use ${describeCharset(lim.charset)})`;
  if (name !== name.trim()) return `"${name}": no leading or trailing spaces`;
  if (stock.includes(name)) return `"${name}" is one of the base's own categories`;
  return null;
}

export const describeCharset = (cs: string): string => {
  const has = (s: string) => [...s].every((c) => cs.includes(c));
  const parts: string[] = [];
  if (has('ABCDEFGHIJKLMNOPQRSTUVWXYZ')) parts.push('A-Z');
  if (has('abcdefghijklmnopqrstuvwxyz')) parts.push('a-z');
  if (has('0123456789')) parts.push('0-9');
  const rest = [...cs].filter((c) => !/[A-Za-z0-9]/.test(c)).join('');
  if (rest) parts.push(`${rest.replace(' ', 'space ')}`.trim());
  return parts.join(', ');
};

/**
 * What is wrong with a layout's categories on this base, in words a user can act on. IDs, the
 * category count and the list lengths depend on the selection: `plan` checks those.
 */
export function checkLayout(l: Layout, base: Base, stock: BaseFamily[]): string[] {
  const p: string[] = [];
  const lim = menuLimits(base);
  if (l.format !== LAYOUT_FORMAT) p.push(`layout format ${l.format}, this engine reads ${LAYOUT_FORMAT}`);
  if (l.base !== base.id) p.push(`this map was made for base ${l.base}, and the OS is ${base.name}`);
  const stockNames = stock.map((f) => f.name);
  const seen = new Set<string>();
  for (const c of l.categories) {
    const why = nameProblem(c, lim, stockNames);
    if (why) p.push(why);
    if (seen.has(c)) p.push(`category "${c}" is listed twice`);
    seen.add(c);
  }
  for (const [k, m] of Object.entries(l.machines)) {
    if (!seen.has(m.category)) p.push(`${k} is in category "${m.category}", which the map does not list`);
    if (!Number.isInteger(m.id) || m.id < 0 || m.id > 191) p.push(`${k} is on ID ${m.id}, outside 0..191`);
  }
  return p;
}

/** Canonical JSON: category order kept, machines sorted by key, fixed field order. */
export function canonical(l: Layout): string {
  const machines = Object.keys(l.machines).sort().map((k) => [k, l.machines[k].id, l.machines[k].category, l.machines[k].order]);
  // uw only when answered, so a layout without it keeps the fingerprint it always had
  return JSON.stringify({ format: l.format, base: l.base, categories: l.categories, machines, ...(l.uw === undefined ? {} : { uw: l.uw }) });
}

/** A short fingerprint two users can read to each other: same layout, same fingerprint. */
export async function fingerprint(l: Layout): Promise<string> {
  const s = await sha256(new TextEncoder().encode(canonical(l)));
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`.toUpperCase();
}

/** A layout file's JSON, read and checked for shape (not for this base: checkLayout does that). */
export function parseLayout(json: string): Layout {
  const o = JSON.parse(json) as Layout;
  if (!o || typeof o !== 'object' || o.format !== LAYOUT_FORMAT) throw new Error(`not a ${LAYOUT_FORMAT} map file`);
  if (typeof o.base !== 'string' || !Array.isArray(o.categories) || typeof o.machines !== 'object') throw new Error('map file: base, categories and machines are required');
  for (const [k, m] of Object.entries(o.machines)) {
    if (!Number.isInteger(m.id) || typeof m.category !== 'string' || !Number.isInteger(m.order)) throw new Error(`map file: ${k} needs an integer id and order and a category`);
    if (m.id < 0 || m.id > 191) throw new Error(`map file: ${k} is on ID ${m.id}, outside 0..191`);
  }
  if (o.uw !== undefined && typeof o.uw !== 'boolean') throw new Error('map file: uw must be true or false');
  return { format: o.format, base: o.base, categories: o.categories.map(String), machines: o.machines, ...(o.uw === undefined ? {} : { uw: o.uw }) };
}

// ---- the table in flash --------------------------------------------------------------------------
//
//   'MDLY' u8 version (1, or 2 when the layout records the UW answer) u8 categories u8 machines
//   u8 base-id length, base id, [version 2: u8 UW answer, 1 yes / 0 no,]
//   per category 4 name bytes (0-padded), per machine u8 key length, key, u8 id, u8 category, u8 order,
//   0-padding to 4, then the trailer: u32 CRC-32 of all before it, u32 table length, 'MDLY'.
// The trailer ends the OS area, so the table is found from the end of the update backwards.

const MAGIC = [0x4d, 0x44, 0x4c, 0x59];   // 'MDLY'
export const LAYOUT_TABLE_VERSION = 1;
/** the table with the UW answer after the base id; a layout without the answer is still written as version 1 */
export const LAYOUT_TABLE_VERSION_UW = 2;

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ascii = (s: string, what: string): number[] => [...s].map((c) => {
  const v = c.charCodeAt(0);
  if (v < 0x20 || v > 0x7e) throw new Error(`${what} "${s}" is not printable ASCII`);
  return v;
});

export function encodeLayout(l: Layout): Uint8Array {
  const cats = l.categories;
  const keys = Object.keys(l.machines).sort();
  if (cats.length > 255 || keys.length > 255) throw new Error('layout too large for its table');
  const b: number[] = [...MAGIC, l.uw === undefined ? LAYOUT_TABLE_VERSION : LAYOUT_TABLE_VERSION_UW, cats.length, keys.length, l.base.length, ...ascii(l.base, 'base id')];
  if (l.uw !== undefined) b.push(l.uw ? 1 : 0);
  for (const c of cats) {
    const n = ascii(c, 'category');
    if (n.length > 4) throw new Error(`category "${c}" is longer than 4 bytes`);
    b.push(...n, ...new Array(4 - n.length).fill(0));
  }
  for (const k of keys) {
    const m = l.machines[k];
    const ci = cats.indexOf(m.category);
    if (ci < 0) throw new Error(`${k}: category "${m.category}" is not listed`);
    if (m.id < 0 || m.id > 255 || m.order < 0 || m.order > 255) throw new Error(`${k}: id or order out of range`);
    b.push(k.length, ...ascii(k, 'machine key'), m.id, ci, m.order);
  }
  while (b.length % 4) b.push(0);
  const body = Uint8Array.from(b);
  return concat([body, be32(crc32(body)), be32(body.length + 12), Uint8Array.from(MAGIC)]);
}

export function decodeLayout(t: Uint8Array): Layout {
  const bad = (why: string): never => { throw new Error(`layout table: ${why}`); };
  if (t.length < 20 || MAGIC.some((v, i) => t[i] !== v)) bad('no magic');
  const body = t.subarray(0, t.length - 12);
  if (u32(t, t.length - 12) !== crc32(body)) bad('CRC mismatch');
  if (t[4] !== LAYOUT_TABLE_VERSION && t[4] !== LAYOUT_TABLE_VERSION_UW) bad(`version ${t[4]}, this engine reads ${LAYOUT_TABLE_VERSION} and ${LAYOUT_TABLE_VERSION_UW}`);
  let o = 8;
  const str = (n: number): string => { const s = String.fromCharCode(...t.subarray(o, o + n)); o += n; return s; };
  const base = str(t[7]);
  const uw = t[4] === LAYOUT_TABLE_VERSION_UW ? t[o++] === 1 : undefined;
  const categories: string[] = [];
  for (let i = 0; i < t[5]; i++) { categories.push(String.fromCharCode(...Array.from(t.subarray(o, o + 4)).filter((c) => c))); o += 4; }
  const machines: Record<string, MachinePlace> = {};
  for (let i = 0; i < t[6]; i++) {
    const key = str(t[o++]);
    const id = t[o++];
    const cat = t[o++];
    const order = t[o++];
    if (cat >= categories.length) bad(`${key}: category ${cat} out of range`);
    machines[key] = { id, category: categories[cat], order };
  }
  if (o > body.length) bad('truncated');
  return { format: LAYOUT_FORMAT, base, categories, machines, ...(uw === undefined ? {} : { uw }) };
}

/** The layout table a patched OS carries at the end of its OS area, or null. */
export function findLayout(fw: Firmware): { layout: Layout; at: number } | null {
  const f = fw.flash;
  const end = fw.osEnd;
  const tail = end - (end % 2 ? 1 : 0);
  for (const e of [end, tail, end + 1]) {           // a .syx container is padded to even
    if (e < 20 || MAGIC.some((v, i) => f[e - 4 + i] !== v)) continue;
    const n = u32(f, e - 8);
    if (n < 20 || n > e) continue;
    const at = e - n;
    try { return { layout: decodeLayout(f.subarray(at, e)), at }; } catch { /* not ours */ }
  }
  return null;
}

/** Push the table (4-aligned) onto the image being built; returns where it starts. */
export function appendLayout(img: Buf, l: Layout): number {
  img.align(4, 0xff);
  const at = img.length;
  img.push(encodeLayout(l));
  return at;
}

export const hexId = (v: number): string => `${v} (${h(v)})`;
