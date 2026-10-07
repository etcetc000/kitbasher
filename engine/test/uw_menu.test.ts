import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex, u32 } from '../src/bytes.js';
import { decodeLinear } from '../src/isa.js';
import type { CodeImage } from '../src/sig.js';
import { findUwMenu, uwMenuCode, uwMenuPatches } from '../src/uw_menu.js';

const TABLE = 0x252396;

// The shapes discovery looks for, at their 1.63 / X.13 / X.14 places; everything else is zero.
function os(parts: [number, string][], size = 0x40000): CodeImage {
  const bytes = new Uint8Array(size);
  for (const [at, h] of parts) bytes.set(hex(h), at - 0x200000);
  return { what: 'slot', ram: 0x200000, bytes };
}

const COUNT = os([
  [0x22544c, '4eb90022c1a0'],                                    // jsr the count
  [0x22c1a0, '2f0a2f02428243f900252396'],                        // its entry names the table
  [0x22c1e0, '23c20028c2d44ab90029f306660855822' + '3c20028c2d4'], // count; tst UW; bne; subq #2; count
]);

test('1.63-style count: found, entered through our routine, its -2 skipped', () => {
  const { menu, why } = findUwMenu([COUNT], TABLE);
  assert.ok(menu && menu.kind === 'count', why);
  assert.equal(menu.entry, 0x22c1a0);
  assert.deepEqual(menu.callers, [0x22544e]);
  assert.equal(menu.branch, 0x22c1ec);
  assert.equal(menu.uwFlag, 0x29f306);
  const { patches, checks } = uwMenuPatches(menu, TABLE, 0x2bc300, 0x2bc380);
  assert.deepEqual(patches, [[0x22544e, 0x2bc380], [0x22c1ec, 0x60085582]]);
  assert.deepEqual(checks, [[0x22544e, 0x22c1a0], [0x22c1ec, 0x66085582]]);
});

test('the non-UW routine is ISA_A and branches where it says', () => {
  const { menu } = findUwMenu([COUNT], TABLE);
  assert.ok(menu && menu.kind === 'count');
  const at = 0x2bc380, hidden = 0x2bc340;
  const code = uwMenuCode(menu, hidden, 0x524f4d00);              // 'ROM\0'
  const ins = decodeLinear(code, at);
  assert.ok(ins.every((i) => i.ok), ins.filter((i) => !i.ok).map((i) => i.why).join('; '));
  assert.equal(ins.length, 13);
  const go = code.length - 6;                                     // jmp entry.l
  assert.equal(u32(code, go) >>> 16, 0x4ef9);
  assert.equal(u32(code, go + 2), 0x22c1a0);
  const target = (o: number): number => o + 2 + ((code[o + 1] << 24) >> 24);
  assert.equal(code[6], 0x66); assert.equal(target(6), go);       // UW: straight on
  assert.equal(code[20], 0x66); assert.equal(target(20), go);     // already moved: straight on
  assert.equal(code[42], 0x66); assert.equal(target(42), 34);     // the copy loop
  assert.equal(u32(code, 10), hidden);                            // the record compared ...
  assert.equal(u32(code, 16), 0x524f4d00);                        // ... with the base's name
  assert.equal(u32(code, 24), hidden);                            // moved onto
  assert.equal(u32(code, 30), hidden + 16);                       // from two records on
});

test('X.13-style shift: the loop end follows our table', () => {
  const addon: CodeImage = { what: 'add-on', ram: 0x2c0000, bytes: new Uint8Array(0x3000) };
  addon.bytes.set(hex('d1fc002523960680002523862168001400041' + '0a80010'), 0x243e);
  const { menu, why } = findUwMenu([os([]), addon], TABLE);
  assert.ok(menu && menu.kind === 'shift', why);
  assert.deepEqual(menu.endSites, [0x2c2446]);
  const { patches, checks } = uwMenuPatches(menu, TABLE, 0x2bc300, null);
  assert.deepEqual(patches, [[0x2c2446, 0x2bc2f0]]);
  assert.deepEqual(checks, [[0x2c2446, 0x252386]]);
});

test('X.14-style relative move: found, nothing to patch', () => {
  const addon: CodeImage = { what: 'add-on', ram: 0x2c0000, bytes: new Uint8Array(0x3000) };
  addon.bytes.set(hex('d1fc0025239620095289216800140004' + '10a80010'), 0x24ba);
  const { menu } = findUwMenu([os([]), addon], TABLE);
  assert.deepEqual(menu, { kind: 'relative' });
  assert.deepEqual(uwMenuPatches(menu!, TABLE, 0x2bc300, null), { patches: [], checks: [] });
});

test('no UW test, or a count with no caller: not found, and the build says why', () => {
  assert.equal(findUwMenu([os([])], TABLE).menu, null);
  const lone = os([[0x22c1a0, '2f0a2f02428243f900252396'], [0x22c1e0, '23c20028c2d44ab90029f30666085582' + '23c20028c2d4']]);
  const r = findUwMenu([lone], TABLE);
  assert.equal(r.menu, null);
  assert.match(r.why, /no call/);
  assert.throws(() => uwMenuPatches(findUwMenu([COUNT], TABLE).menu!, TABLE, 0x2bc300, null), /not placed/);
});
