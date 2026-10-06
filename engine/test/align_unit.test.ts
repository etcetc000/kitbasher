// Synthetic allocator checks, independent of whether real machine measurements are available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignOf, alignUp, inMask, SECTOR, type AlignEntry } from '../src/align.js';

test('alignment finds the nearest permitted address across every sector boundary', () => {
  for (const offsets of [[0], [127], [0, 63, 64, 127], Array.from({ length: 128 }, (_, i) => i)]) {
    const mask = offsets.reduce((m, off) => m | (1n << BigInt(off)), 0n).toString(16).padStart(32, '0');
    for (let off = 0; off < SECTOR; off++) {
      const start = 0x110000 + off, placed = alignUp(start, mask);
      const candidates = offsets.map(n => 0x110000 + n + (n < off ? SECTOR : 0));
      assert.equal(placed, Math.min(...candidates));
      assert.equal(inMask(mask, off), offsets.includes(off));
      assert.ok(placed >= start && placed - start < SECTOR);
    }
  }
});

test('alignment refuses stale word counts and malformed/empty masks', () => {
  const align: AlignEntry = { words: 1, offsets: '00000000000000000000000000000001', sectors: [2, 1, 2], metric: [4, 3, 4] };
  const model = { code: { words: 'AAAA' }, align };
  assert.equal(alignOf(model, 1), align);
  assert.equal(alignOf({ code: model.code }, 1), null);
  assert.throws(() => alignOf(model, 2), /measured on/);
  for (const offsets of ['', 'z'.repeat(32), '1'.repeat(31), '1'.repeat(33)])
    assert.throws(() => alignOf({ ...model, align: { ...align, offsets } }, 1), /malformed/);
  assert.throws(() => alignOf({ ...model, align: { ...align, offsets: '0'.repeat(32) } }, 1), /empty/);
  assert.throws(() => alignUp(0x110000, '0'.repeat(32)), /empty/);
});
