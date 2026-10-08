import { test } from 'node:test';
import assert from 'node:assert/strict';
import { be32, hex, u32 } from '../src/bytes.js';
import { decodeLinear } from '../src/isa.js';
import type { CodeImage } from '../src/sig.js';
import { findUwMenu, hiddenIndex, uwMenuCode, uwMenuPatches, type UwMenu } from '../src/uw_menu.js';

const TABLE = 0x252396;
const UW = 0x29f306;

function os(parts: [number, string][], size = 0x40000): CodeImage {
  const bytes = new Uint8Array(size);
  for (const [at, h] of parts) bytes.set(hex(h.replace(/\s+/g, '')), at - 0x200000);
  return { what: 'slot', ram: 0x200000, bytes };
}

// ---- discovery, on the shapes of 1.63, X.13 and X.14

const COUNT = os([
  [0x22544c, '4eb90022c1a0'],                                       // jsr the count
  [0x22c1a0, '2f0a2f02428243f900252396'],                           // its entry names the table
  [0x22c1e0, '23c20028c2d4 4ab90029f306 6608 5582 23c20028c2d4'],    // count; tst UW; bne; subq #2; count
]);

const addonOs = (entryAt: number, entry: string, branchAt: number, branch: string): CodeImage[] => {
  const slot = os([[0x22544c, '4eb90022c1a0'], [0x22c1a0, '4ef9' + entryAt.toString(16).padStart(8, '0')]]);
  const addon: CodeImage = { what: 'add-on', ram: 0x2c0000, bytes: new Uint8Array(0x3000) };
  addon.bytes.set(hex(entry.replace(/\s+/g, '')), entryAt - 0x2c0000);
  addon.bytes.set(hex(branch.replace(/\s+/g, '')), branchAt - 0x2c0000);
  return [slot, addon];
};
const X13 = addonOs(0x2c239c, '4fefffe4 48d70c7c 2c390029f306', 0x2c2424, '23c00028c2d4 4a86 6644 2204');
const X14 = addonOs(0x2c2402, '20390029f306 4fefffe4 2f400018 103900252396', 0x2c249c, '23c10028c2d4 4aaf0018 6646 226f');

test('1.63: the count is entered through our routine and its -2 is skipped', () => {
  const { menu, why } = findUwMenu([COUNT], TABLE);
  assert.ok(menu, why);
  assert.deepEqual([menu.kind, menu.entry, menu.callers, menu.branch, menu.uwFlag, menu.hides], ['count', 0x22c1a0, [0x22544e], 0x22c1ec, UW, 'last-two']);
  const { patches, checks } = uwMenuPatches(menu, 0x2bc380);
  assert.deepEqual(patches, [[0x22544e, 0x2bc380], [0x22c1ec, 0x60085582]]);
  assert.deepEqual(checks, [[0x22544e, 0x22c1a0], [0x22c1ec, 0x66085582]]);
});

test('X.13 and X.14: the thunk at 0x22c1a0 is entered through our routine and the add-on\'s move is skipped', () => {
  for (const [images, branch, old] of [[X13, 0x2c242c, 0x66442204], [X14, 0x2c24a6, 0x6646226f]] as const) {
    const { menu, why } = findUwMenu(images, TABLE);
    assert.ok(menu, why);
    assert.deepEqual([menu.kind, menu.entry, menu.callers, menu.branch, menu.branchOld, menu.hides], ['addon', 0x22c1a0, [0x22544e], branch, old, 'rom']);
    assert.equal(menu.branchNew, ((0x60 << 24) | (old & 0xffffff)) >>> 0);   // bne -> bra, same displacement
  }
});

test('a partial 1.63 match falls through to the other shapes; nothing found says why', () => {
  // the 1.63 entry is there but its UW tail is not, and the X.14 routine is: X.14 wins
  const [slot, addon] = X14;
  slot.bytes.set(hex('2f0a2f02428243f900252396'), 0x2c100);
  const { menu } = findUwMenu([slot, addon], TABLE);
  assert.equal(menu?.kind, 'addon');
  const none = findUwMenu([os([[0x22c1a0, '2f0a2f02428243f900252396']])], TABLE);
  assert.equal(none.menu, null);
  assert.match(none.why, /UW tails/);
  assert.throws(() => uwMenuPatches(findUwMenu([COUNT], TABLE).menu!, null), /not placed/);
});

test('which records a non-UW unit hides', () => {
  const m163 = findUwMenu([COUNT], TABLE).menu!, m13 = findUwMenu(X13, TABLE).menu!;
  const stock = ['GND', 'TRX', 'EFM', 'E12', 'P-I', 'INP', 'MID', 'CTR', 'ROM', 'RAM'];
  assert.equal(hiddenIndex(m163, stock), 8);
  assert.equal(hiddenIndex(m13, [...stock, 'NFX']), 8);              // ROM by name, not the last two
  assert.equal(hiddenIndex(m13, ['GND', 'TRX']), null);
});

// ---- behaviour: our routine run on a table, then the base's count, as the OS does at init

/** Runs the routine's own instructions (only those it is made of) until its final jmp. */
function run(code: Uint8Array, mem: Map<number, number>): number {
  const rd8 = (a: number) => mem.get(a) ?? 0;
  const rd32 = (a: number) => ((rd8(a) << 24) | (rd8(a + 1) << 16) | (rd8(a + 2) << 8) | rd8(a + 3)) >>> 0;
  const wr32 = (a: number, v: number) => { for (let k = 0; k < 4; k++) mem.set(a + k, (v >>> (24 - 8 * k)) & 255); };
  let pc = 0, d0 = 0, a0 = 0, a1 = 0, z = false;
  for (let steps = 0; steps < 10000; steps++) {
    const op = (code[pc] << 8) | code[pc + 1];
    const ext = () => u32(code, pc + 2);
    if (op === 0x4ab9) { z = rd32(ext()) === 0; pc += 6; }
    else if ((op & 0xff00) === 0x6600) { const d = ((op & 0xff) << 24) >> 24; pc = z ? pc + 2 : pc + 2 + d; }
    else if (op === 0x2039) { d0 = rd32(ext()); z = d0 === 0; pc += 6; }
    else if (op === 0x0c80) { z = d0 === ext(); pc += 6; }
    else if (op === 0x41f9) { a0 = ext(); pc += 6; }
    else if (op === 0x43f9) { a1 = ext(); pc += 6; }
    else if (op === 0x1011) { d0 = ((d0 & ~0xff) | rd8(a1)) >>> 0; z = (d0 & 0xff) === 0; pc += 2; }
    else if (op === 0x20d9) { wr32(a0, rd32(a1)); a0 += 4; a1 += 4; pc += 2; }
    else if (op === 0x4a00) { z = (d0 & 0xff) === 0; pc += 2; }
    else if (op === 0x4ef9) return ext();
    else throw new Error(`unexpected opcode ${op.toString(16)} at +${pc}`);
  }
  throw new Error('no jmp reached');
}

const NEW = 0x2bc300;                     // our copy of the table
/** our copy: the base's records, then ours, record i naming list 0x10000 + i */
function table(names: string[]): Map<number, number> {
  const mem = new Map<number, number>();
  const put = (a: number, b: Uint8Array) => b.forEach((v, k) => mem.set(a + k, v));
  names.forEach((n, i) => { put(NEW + 8 * i, Uint8Array.from([...n.padEnd(4, '\0')].map((c) => c.charCodeAt(0)))); put(NEW + 8 * i + 4, be32(0x10000 + i)); });
  put(NEW + 8 * names.length, new Uint8Array(8));
  return mem;
}
/** the base's count with its own non-UW step skipped: the records, and the family index the reverse table gives each list */
function count(mem: Map<number, number>): { names: string[]; family: Map<number, number> } {
  const names: string[] = [];
  const family = new Map<number, number>();
  for (let i = 0; mem.get(NEW + 8 * i); i++) {
    names.push(String.fromCharCode(...[0, 1, 2, 3].map((k) => mem.get(NEW + 8 * i + k) ?? 0).filter((c) => c)));
    const list = [4, 5, 6, 7].reduce((v, k) => ((v << 8) | (mem.get(NEW + 8 * i + k) ?? 0)) >>> 0, 0) - 0x10000;
    family.set(list, i);
  }
  return { names, family };
}

for (const [label, menu, stock] of [
  ['1.63', () => findUwMenu([COUNT], TABLE).menu!, ['GND', 'TRX', 'EFM', 'E12', 'P-I', 'INP', 'MID', 'CTR', 'ROM', 'RAM']],
  ['X.13', () => findUwMenu(X13, TABLE).menu!, ['GND', 'TRX', 'EFM', 'E12', 'P-I', 'INP', 'MID', 'CTR', 'ROM', 'RAM', 'NFX']],
] as [string, () => UwMenu, string[]][]) {
  test(`${label}: without UW ROM and RAM go, later families move up two and the reverse table follows; with UW nothing changes`, () => {
    const m = menu();
    const names = [...stock, 'KIK', 'SNR'];
    const hidden = hiddenIndex(m, stock)!;
    const code = uwMenuCode(m, NEW + 8 * hidden, 0x524f4d00);         // 'ROM\0'
    assert.ok(decodeLinear(code, 0x2bc380).every((i) => i.ok));
    for (const uw of [0, 1]) {
      const mem = table(names);
      mem.set(UW + 3, uw);
      assert.equal(run(code, mem), m.entry);                          // always ends in the base's init
      const after = count(mem);
      if (uw) {
        assert.deepEqual(after.names, names);
        assert.equal(after.family.get(names.indexOf('KIK')), names.indexOf('KIK'));
      } else {
        const shown = names.filter((n) => n !== 'ROM' && n !== 'RAM');
        assert.deepEqual(after.names, shown);
        // KIK's list is recorded where the menu shows KIK, and so is every family after ROM and RAM
        for (const n of shown.slice(hidden)) assert.equal(after.family.get(names.indexOf(n)), shown.indexOf(n));
        assert.equal(after.family.has(names.indexOf('ROM')), false);
        run(code, mem);                                               // a second call changes nothing
        assert.deepEqual(count(mem).names, shown);
      }
    }
  });
}
