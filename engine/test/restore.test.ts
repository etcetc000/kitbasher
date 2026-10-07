import { test } from 'node:test';
import assert from 'node:assert/strict';
import { be32, hex } from '../src/bytes.js';
import type { Firmware } from '../src/container.js';
import { encodeLayout, LAYOUT_FORMAT, type Layout } from '../src/layout.js';
import type { PackModel } from '../src/packs.js';
import { machinesFromDescriptors, recoverSession } from '../src/restore.js';

// A session from an OS Kitbasher built: its layout table, or (an image without one) the machines
// its boot routine writes into the descriptor table.

const DT = 0x252092;
const model = (key: string, name: string): PackModel => ({ key, name, id: 0, module: key } as unknown as PackModel);
const MODELS = [model('VAD/BD', 'VADBD'), model('OSC/PW', 'OSCPW'), model('VAD/SD', 'VADSD')];

/** OS-area flash with one boot routine of ours: one RAM copy (the descriptors), then the patch list. */
function image(descs: { id: number; name: string; inFlash?: boolean }[]): Uint8Array {
  const f = new Uint8Array(0x100000).fill(0xff);
  const src = 0x9000, dst = 0x2bc000, size = 0x56 * descs.length;
  const writes: [number, number][] = [[0x2139f8, 0x2bc000]];                 // the heap ceiling, not a descriptor
  descs.forEach((d, i) => {
    const at = d.inFlash ? 0xc000 + 0x60 * i : src + 0x56 * i;
    f.fill(0, at, at + 0x56);
    f[at + 4] = d.id;
    f.set([...d.name].map((c) => c.charCodeAt(0)), at + 5);
    writes.push([DT + 4 * d.id, d.inFlash ? 0x10000000 + at : dst + 0x56 * i]);
  });
  const r = 0x8000;
  f.set(hex('41f9'), r); f.set(be32(src), r + 2); f.set(hex('43f9'), r + 6); f.set(be32(dst), r + 8);
  f.set(hex('203c'), r + 12); f.set(be32(Math.ceil(size / 4)), r + 14); f.set(hex('22d8538066fa'), r + 18);
  const p = r + 24, list = 0xa000;
  f.set(hex('41f9'), p); f.set(be32(list), p + 2); f.set(hex('203c'), p + 6); f.set(be32(writes.length), p + 8);
  f.set(hex('22582298538066f84ef9'), p + 12); f.set(be32(0x213a0c), p + 22);
  writes.forEach(([a, v], i) => { f.set(be32(a), list + 8 * i); f.set(be32(v), list + 8 * i + 4); });
  return f;
}

test('machines from the descriptor table: RAM and flash descriptors, each checked against its own ID', () => {
  const f = image([{ id: 4, name: 'VADBD' }, { id: 175, name: 'OSCPW', inFlash: true }, { id: 9, name: 'NDSQ ' }]);
  assert.deepEqual([...machinesFromDescriptors(f, DT)!], [[4, 'VADBD'], [175, 'OSCPW'], [9, 'NDSQ ']]);
  // a descriptor whose ID byte disagrees with the table slot is not taken
  const g = image([{ id: 4, name: 'VADBD' }]);
  g[0x9000 + 4] = 5;
  assert.equal(machinesFromDescriptors(g, DT), null);
  assert.equal(machinesFromDescriptors(new Uint8Array(0x100000).fill(0xff), DT), null);
});

test('an image without a layout table: the catalog\'s models on their IDs, the rest reported', () => {
  const f = image([{ id: 4, name: 'VADBD' }, { id: 175, name: 'OSCPW' }, { id: 9, name: 'NDSQ ' }]);
  const r = recoverSession({ flash: f, osEnd: 0xb000 } as unknown as Firmware, MODELS, DT)!;
  assert.equal(r.how, 'descriptors');
  assert.deepEqual(Object.fromEntries(Object.entries(r.layout.machines).map(([k, v]) => [k, v.id])), { 'VAD/BD': 4, 'OSC/PW': 175 });
  assert.deepEqual(r.unknown, [{ id: 9, name: 'NDSQ' }]);
  assert.equal(r.layout.base, '');                                           // set when the user loads the OS to patch
  for (const m of Object.values(r.layout.machines)) assert.ok(r.layout.categories.includes(m.category));
});

test('an image with its layout table: that layout, with the UW answer', () => {
  const lay: Layout = { format: LAYOUT_FORMAT, base: 'x13', categories: ['KIK'], machines: { 'VAD/BD': { id: 4, category: 'KIK', order: 0 } }, uw: false };
  const f = image([{ id: 4, name: 'VADBD' }]);
  const t = encodeLayout(lay);
  f.set(t, 0xb000);
  const r = recoverSession({ flash: f, osEnd: 0xb000 + t.length } as unknown as Firmware, MODELS, DT)!;
  assert.equal(r.how, 'table');
  assert.deepEqual(r.layout, lay);
});
