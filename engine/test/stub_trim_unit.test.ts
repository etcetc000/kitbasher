// The silence-stub trim on synthetic DSP2 uploads: found by its own words, one word changed,
// refused when the shape or the count is not the stock one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStubTrim, findStub, NoStub, trimStub } from '../src/stub_trim.js';

const STUB_AT = 0x10008f;
function stubWords(at: number, pad = 0x063280): number[] {
  return [0x260000, 0x062080, at + 8, 0x4e5f00, pad, at + 7, 0, 0, 0, 0x0bf080, 0x123456, 0x00000c];
}
/** P records around the stub, an X record, and the entry record */
function upload(stubs: number[][], at = STUB_AT): number[] {
  const w: number[] = [0, 0x100000, 4, 0x0c0000, 0, 0, 0];
  stubs.forEach((s, k) => w.push(0, at + 0x100 * k, s.length, ...s));
  w.push(1, 0x200, 2, 7, 7, 3, 0x100000);
  return w;
}

test('finds the stub by its words and cuts only the pad count to 1', () => {
  const w = upload([stubWords(STUB_AT)]);
  const s = findStub(w);
  assert.equal(s.at, STUB_AT);
  assert.equal(s.pad, STUB_AT + 4);
  assert.equal(s.count, 0x32);
  const r = trimStub(w);
  assert.ok(r.applied);
  const diff = r.words.map((v, i) => (v !== w[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(diff, [s.index]);
  assert.equal(r.words[s.index], 0x060180);
  assert.deepEqual(checkStubTrim(w, r.words, true).ok, true);
});

test('the stub is recognised wherever it sits (targets are relative to it)', () => {
  const at = 0x123456 & 0xfffff0;
  const w = upload([stubWords(at)], at);
  assert.equal(findStub(w).at, at);
  assert.ok(trimStub(w).applied);
});

test('a later record overriding the pad wins, and is the one patched', () => {
  const w = upload([stubWords(STUB_AT)]);
  const at = w.length - 7;                                                  // before the X and entry records
  w.splice(at, 0, 0, STUB_AT + 4, 1, 0x063280);
  const s = findStub(w);
  assert.equal(s.index, at + 3);
  const r = trimStub(w);
  assert.equal(r.words[at + 3], 0x060180);
  assert.equal(r.words.filter((v, i) => v !== w[i]).length, 1);
});

test('skips, with a note, a stub already trimmed or with a different pad', () => {
  for (const pad of [0x060180, 0x062880]) {
    const w = upload([stubWords(STUB_AT, pad)]);
    const r = trimStub(w);
    assert.equal(r.applied, false);
    assert.deepEqual(r.words, w);
    assert.match(r.note, /not the stock 50/);
  }
});

test('skips when the stub is missing, altered or not unique', () => {
  const altered = stubWords(STUB_AT); altered[3] = 0x4e5e00;
  const badTarget = stubWords(STUB_AT); badTarget[2] = STUB_AT + 9;
  for (const w of [upload([]), upload([altered]), upload([badTarget]), upload([stubWords(STUB_AT), stubWords(STUB_AT + 0x100)])]) {
    assert.throws(() => findStub(w), NoStub);
    const r = trimStub(w);
    assert.equal(r.applied, false);
    assert.deepEqual(r.words, w);
    assert.match(r.note, /skipped/);
  }
});

test('the gate catches a moved stub, another changed word, or the wrong count', () => {
  const w = upload([stubWords(STUB_AT)]);
  const r = trimStub(w);
  assert.equal(checkStubTrim(w, w, true).ok, false);                        // not trimmed
  const other = r.words.slice(); other[findStub(w).index - 1] ^= 1;          // +3 changed
  assert.equal(checkStubTrim(w, other, true).ok, false);
  assert.equal(checkStubTrim(w, upload([stubWords(STUB_AT + 0x10, 0x060180)], STUB_AT + 0x10), true).ok, false);
  assert.equal(checkStubTrim(upload([]), upload([]), false).ok, true);       // nothing to trim, nothing done
});
