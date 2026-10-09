import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { be32, u32 } from '../src/bytes.js';
import { codeImages, NotPatchable, resolveBase, type Base } from '../src/bases.js';
import { readFirmware } from '../src/container.js';
import { loadBases } from '../src/node.js';
import type { CorePack } from '../src/packs.js';
import { prepare163 } from '../src/prepare.js';
import { ramImage, resolveFeatures } from '../src/plan.js';
import { decodeLinear } from '../src/isa.js';
import { parseSig, reader, type CodeImage } from '../src/sig.js';
import { checkUnmuteCode, findUnmute, UNMUTE_SIGNATURES as SIG, unmuteBlock, unmutePatches, unmuteValues, type Unmute } from '../src/unmute.js';

// Synthetic sequencers: every piece the fix is written against, laid out from the engine's own
// signatures (wildcards zero, captures given) at the addresses the 1.63-derived bases have them, with
// each base's own MIDI send and interrupt level. No firmware is read, except by the tests at the end,
// which run only when MD_FIRMWARE_DIR names a directory of OS files.

const DATA = {
  slot: 0x7120ca, localOn: 0x71217a, dispatch: 0x206c8e, midiOut: 0x1001560, buf: 0x28d152, bufB: 0x28d166,
  lockCnt: 0x28d13c, muteHi: 0x1001530, revMap: 0x7120dc,
  qa: 0x28d2e4, ca: 0x28d156, qaoff: 0x28d344, caoff: 0x28d15e, qb: 0x28d3a4, cb: 0x28d16e, qboff: 0x28d404, cboff: 0x28d176,
};
const SKIP = 0x23abfa, NOTE_QUEUE = 0x23aac0, ORG = 0x2be100;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A signature's bytes with its captures filled in; `mark` gives a mark's or capture's address. */
function lay(sig: string, caps: Record<string, number>, at: number): { bytes: Uint8Array; mark: (n: string) => number } {
  const s = parseSig(sig);
  const b = Uint8Array.from(s.bytes, (x) => x ?? 0);
  for (const c of s.caps) {
    const v = caps[c.name] ?? caps[c.name.replace(/\d$/, '')];
    if (v === undefined) continue;
    for (let k = 0; k < c.size; k++) b[c.at + k] = (v >>> (8 * (c.size - 1 - k))) & 0xff;
  }
  const mark = (n: string): number => {
    const m = s.marks.find((x) => x.name === n) ?? s.caps.find((x) => x.name === n);
    if (!m) throw new Error(n);
    return at + m.at;
  };
  return { bytes: b, mark };
}

interface Shape { uart: number; ipl: number; dev?: boolean }
const X14: Shape = { uart: 0x2d945c, ipl: 0x2400 };
const P163: Shape = { uart: 0x213dc4, ipl: 0x2700 };
const DEV: Shape = { uart: 0x213dc4, ipl: 0x2700, dev: true };

function slot(shape: Shape): CodeImage {
  const img = new Uint8Array(0x50000);
  const put = (at: number, b: Uint8Array): void => img.set(b, at - 0x200000);
  const caps = { ...DATA, uart: shape.uart, ipl: shape.ipl };
  put(0x239762, lay(SIG.tick, caps, 0x239762).bytes);
  put(0x239ef2, lay(SIG.latch, caps, 0x239ef2).bytes);
  const pb = lay(SIG.playB, caps, 0x239f56);
  assert.equal(pb.mark('s5'), 0x239f7e);
  put(0x239f56, pb.bytes);
  put(0x20cc70, lay(SIG.noteOn, caps, 0x20cc70).bytes);
  put(NOTE_QUEUE, lay(SIG.noteQueue, caps, NOTE_QUEUE).bytes);
  const w = lay(SIG.write, caps, 0x23ab14);
  assert.equal(w.mark('skip'), SKIP);
  put(0x23ab14, w.bytes);
  // the branch displacements, from the layout: every mute test goes to "next track"
  const b0 = lay(SIG.build, caps, 0x23a908);
  const disp = (opcodeAt: number, to: number): number => (to - (opcodeAt + 2)) & 0xffff;
  const s2 = b0.mark('s2');
  put(0x23a908, lay(SIG.build, { ...caps, sk1: disp(b0.mark('sk1') - 2, SKIP), sk2: disp(s2 + 4, SKIP), sk3: disp(s2 + 10, SKIP) }, 0x23a908).bytes);
  const c0 = lay(SIG.classBranch, caps, 0x23aa10);
  put(0x23aa10, lay(SIG.classBranch, { ...caps, nq: disp(c0.mark('s3') + 2, NOTE_QUEUE) }, 0x23aa10).bytes);
  if (shape.dev) {
    // DEV enters its own code from the tick worker's entry and from the build's buffer toggle
    put(0x239762, Uint8Array.of(0x4e, 0xf9, 0x00, 0x2d, 0x68, 0x68, 0x4e, 0x71));
    put(0x23a908, Uint8Array.of(0x4e, 0xb9, 0x00, 0x2f, 0x3f, 0xa0));
  }
  return { what: 'ColdFire slot', ram: 0x200000, bytes: img };
}

const found = (shape: Shape): Unmute => {
  const r = findUnmute([slot(shape)]);
  assert.ok(r.unmute, r.why);
  return r.unmute;
};

test('discovery: the five sites and everything the routines rely on, on the X.14 and prepared 1.63 shapes', () => {
  for (const shape of [X14, P163]) {
    const U = found(shape);
    assert.deepEqual(U.sites.map((s) => [s.name, s.at, s.old.length]), [
      ['build start', 0x23a92c, 6], ['mute test', 0x23a9a2, 8], ['class branch', 0x23aa20, 6], ['step play', 0x2397e0, 6], ['swing play', 0x239f7e, 6]]);
    assert.deepEqual([U.skipTo, U.noteQueue], [SKIP, NOTE_QUEUE]);
    assert.deepEqual([U.mute, U.buf, U.bufB, U.lockCnt, U.slot, U.localOn, U.revMap],
      [0x1001520, 0x28d152, 0x28d166, 0x28d13c, 0x7120ca, 0x71217a, 0x7120dc]);
    assert.deepEqual(U.queues.map((q) => [q.base, q.count, q.on]),
      [[0x28d2e4, 0x28d156, true], [0x28d344, 0x28d15e, false], [0x28d3a4, 0x28d16e, true], [0x28d404, 0x28d176, false]]);
    assert.deepEqual(unmuteValues(U)['unmute.sites'], [0x23a92c, 0x23a9a2, 0x23aa20, 0x2397e0, 0x239f7e]);
  }
});

test('discovery refuses a base that rewrites the tick worker or the build (DEV), and one whose pieces disagree', () => {
  const dev = findUnmute([slot(DEV)]);
  assert.equal(dev.unmute, null);
  assert.match(dev.why, /tick worker: not found/);
  // queue B played through another dispatcher than queue A
  const img = slot(X14);
  img.bytes.set(be32(0x206000), 0x239faa + 2 - 0x200000);
  assert.match(findUnmute([img]).why, /dispatchers differ/);
  // a mute test that no longer skips to the build loop's "next track"
  const img2 = slot(X14);
  img2.bytes.set([0x00, 0x10], 0x23a9a8 - 0x200000);
  assert.match(findUnmute([img2]).why, /"next track" targets differ/);
  // queue B's buffer not latched from queue A's on the step tick
  const img3 = slot(X14);
  img3.bytes.set(be32(0x28d16a), 0x239ef2 + 8 - 0x200000);
  assert.match(findUnmute([img3]).why, /latch of queue B's buffer: 0 matches/);
});

test('the routines: ISA_A code and data, jumping only to the build loop\'s two continuations', () => {
  for (const shape of [X14, P163]) {
    const U = found(shape);
    const b = unmuteBlock(U, ORG);
    assert.equal(b.codeBytes, 360);
    assert.equal(b.bytes.length, 404);
    assert.deepEqual(checkUnmuteCode(U, b.bytes.subarray(0, b.codeBytes), b.at).problems, []);
    const ins = decodeLinear(b.bytes.subarray(0, b.codeBytes), b.at);
    const out = ins.filter((i) => i.target !== undefined && (i.target < b.at || i.target >= b.at + b.bytes.length)).map((i) => i.target);
    assert.deepEqual([...new Set(out)].sort(), [U.skipTo, U.noteQueue].sort());
    // no status-register writes, no calls out: nothing runs at another interrupt level
    assert.ok(ins.every((i) => u32(b.bytes, i.at - b.at) >>> 16 !== 0x46fc));
  }
  assert.throws(() => unmuteBlock(found(X14), ORG + 2), /4-aligned/);
});

test('the patched sequencer words, per base: each site becomes jsr <routine> (+ nop), as whole longwords', () => {
  for (const shape of [X14, P163]) {
    const img = slot(shape);
    const U = found(shape);
    const b = unmuteBlock(U, ORG);
    const L = b.labels;
    const { patches, checks, ranges } = unmutePatches(U, b, reader([img]));
    const hi = (t: number): string => `4eb9${(t >>> 16).toString(16).padStart(4, '0')}`;
    const lo = (t: number, rest: string): string => `${(t & 0xffff).toString(16).padStart(4, '0')}${rest}`;
    assert.deepEqual(patches.map(([a, v]) => [a.toString(16), v.toString(16).padStart(8, '0')]), [
      ['23a92c', hi(L.h_clr)], ['23a930', lo(L.h_clr, '42b9')],      // build start -> h_clr; then the base's next clr.l
      ['23a9a2', hi(L.h_mute)], ['23a9a6', lo(L.h_mute, '4e71')],    // mute test -> h_mute; nop
      ['23aa20', hi(L.h_cls)], ['23aa24', lo(L.h_cls, '2079')],      // class branch -> h_cls; then the base's movea.l
      ['2397e0', hi(L.h_play)], ['2397e4', lo(L.h_play, '4a90')],    // step play -> h_play; then the base's tst.l (a0)
      ['239f7e', hi(L.h_playB)], ['239f82', lo(L.h_playB, '4a90')],  // swing play -> h_playB; then the base's tst.l (a0)
    ]);
    const rd = reader([img]);
    for (const [a, v] of checks) assert.equal(v, u32(rd(a, 4)!, 0));
    assert.deepEqual(ranges, [[0x23a92c, 0x23a932], [0x23a9a2, 0x23a9aa], [0x23aa20, 0x23aa26], [0x2397e0, 0x2397e6], [0x239f7e, 0x239f84]]);
    const out = img.bytes.slice();
    for (const [a, v] of patches) out.set(be32(v), a - 0x200000);
    ranges.forEach(([l, h], k) => {
      const ins = decodeLinear(out.subarray(l - 0x200000, h - 0x200000), l);
      assert.ok(ins.every((i) => i.ok), `${l.toString(16)}: ${ins.map((i) => i.name)}`);
      assert.equal(ins[0].target, L[U.sites[k].label]);
    });
  }
  const img = slot(X14);
  const U = found(X14);
  img.bytes[0x23a92c - 0x200000] = 0x4e;
  assert.throws(() => unmutePatches(U, unmuteBlock(U, ORG), reader([img])), /not what discovery found/);
});

// ---- the routines, run: a small interpreter for exactly the ColdFire instructions they are made of

class Cpu {
  d = new Array<number>(8).fill(0);
  a = new Array<number>(8).fill(0);
  pc = 0; n = false; z = false; v = false; c = false;
  mem = new Map<number, number>();
  steps = 0;
  r8(x: number): number { return this.mem.get(x >>> 0) ?? 0; }
  r16(x: number): number { return (this.r8(x) << 8) | this.r8(x + 1); }
  r32(x: number): number { return ((this.r16(x) << 16) | this.r16(x + 2)) >>> 0; }
  w8(x: number, v: number): void { this.mem.set(x >>> 0, v & 0xff); }
  w32(x: number, v: number): void { for (let k = 0; k < 4; k++) this.w8(x + k, v >>> (24 - 8 * k)); }
  load(at: number, b: ArrayLike<number>): void { for (let k = 0; k < b.length; k++) this.w8(at + k, b[k]); }
  private ext16(): number { const v = this.r16(this.pc); this.pc += 2; return v; }
  private ext32(): number { const v = this.r32(this.pc); this.pc += 4; return v; }
  private nz(v: number, size: number): void {
    const m = size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    v = (v & m) >>> 0;
    this.z = v === 0; this.n = !!(v & (size === 1 ? 0x80 : size === 2 ? 0x8000 : 0x80000000)); this.v = false; this.c = false;
  }
  /** an effective address: register or memory, read and written at `size` bytes */
  private ea(mode: number, reg: number, size: number): { get: () => number; set: (v: number) => void; addr?: number } {
    const rd = (x: number): number => size === 1 ? this.r8(x) : size === 2 ? this.r16(x) : this.r32(x);
    const wr = (x: number, v: number): void => { if (size === 1) this.w8(x, v); else if (size === 4) this.w32(x, v); else { this.w8(x, v >>> 8); this.w8(x + 1, v); } };
    const m = (x: number) => ({ get: () => rd(x), set: (v: number) => wr(x, v), addr: x });
    const mask = size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    switch (mode) {
      case 0: return { get: () => (this.d[reg] & mask) >>> 0, set: (v) => { this.d[reg] = ((this.d[reg] & ~mask) | (v & mask)) >>> 0; } };
      case 1: return { get: () => this.a[reg], set: (v) => { this.a[reg] = v >>> 0; } };
      case 2: return m(this.a[reg]);
      case 3: { const x = this.a[reg]; this.a[reg] = (x + size) >>> 0; return m(x); }
      case 4: { this.a[reg] = (this.a[reg] - size) >>> 0; return m(this.a[reg]); }
      case 5: { const d = (this.ext16() << 16) >> 16; return m((this.a[reg] + d) >>> 0); }
      case 6: {
        const e = this.ext16();
        const x = (e & 0x8000 ? this.a : this.d)[(e >> 12) & 7] * (1 << ((e >> 9) & 3));
        return m((this.a[reg] + x + ((e << 24) >> 24)) >>> 0);
      }
      case 7:
        if (reg === 0) return m(((this.ext16() << 16) >> 16) >>> 0);
        if (reg === 1) return m(this.ext32());
        if (reg === 4) { const v = size === 4 ? this.ext32() : this.ext16() & mask; return { get: () => v, set: () => { throw new Error('write to #imm'); } }; }
    }
    throw new Error(`ea ${mode}/${reg}`);
  }
  private cc(k: number): boolean {
    switch (k) {
      case 0: return true; case 4: return !this.c; case 5: return this.c; case 6: return !this.z; case 7: return this.z;
      case 10: return !this.n; case 11: return this.n; case 13: return this.n !== this.v; case 15: return this.z || this.n !== this.v;
    }
    throw new Error(`condition ${k}`);
  }
  private push(v: number): void { this.a[7] = (this.a[7] - 4) >>> 0; this.w32(this.a[7], v); }
  /** Runs from `entry` until it returns to `ret` (pushed first) or jumps outside [lo, hi). */
  call(entry: number, lo: number, hi: number, ret = 0xdead0): { exit: 'rts' | 'jmp'; to: number } {
    this.push(ret);
    this.pc = entry;
    for (;;) {
      if (++this.steps > 1e6) throw new Error('runaway');
      if (this.pc < lo || this.pc >= hi) throw new Error(`pc ${this.pc.toString(16)} outside the routines`);
      const at = this.pc, op = this.ext16();
      const sz = [1, 2, 4][(op >> 6) & 3];
      if (op === 0x4e75) { this.pc = this.r32(this.a[7]); this.a[7] += 4; if (this.pc === ret) return { exit: 'rts', to: ret }; continue; }
      if (op === 0x4e71) continue;
      if ((op & 0xffc0) === 0x4ec0 || (op & 0xffc0) === 0x4e80) {
        const t = this.ea((op >> 3) & 7, op & 7, 4).addr!;
        if ((op & 0xffc0) === 0x4e80) this.push(this.pc);
        if (t < lo || t >= hi) { if ((op & 0xffc0) === 0x4e80) throw new Error('call out'); return { exit: 'jmp', to: t }; }
        this.pc = t; continue;
      }
      if ((op & 0xfff8) === 0x49c0) { const r = op & 7; this.d[r] = (((this.d[r] & 0xff) << 24) >> 24) >>> 0; this.nz(this.d[r], 4); continue; }
      if ((op & 0xf1c0) === 0x41c0) { this.a[(op >> 9) & 7] = this.ea((op >> 3) & 7, op & 7, 4).addr!; continue; }
      if ((op & 0xfb80) === 0x4880 && (op & 0x40)) {                       // movem.l
        const list = this.ext16(), toMem = !(op & 0x400), x = this.ea((op >> 3) & 7, op & 7, 4).addr!;
        let k = 0;
        for (let r = 0; r < 16; r++) if (list & (1 << r)) {
          const regs = r < 8 ? this.d : this.a;
          if (toMem) this.w32(x + 4 * k, regs[r & 7]); else regs[r & 7] = this.r32(x + 4 * k);
          k++;
        }
        continue;
      }
      if ((op & 0xff00) === 0x4200) { this.ea((op >> 3) & 7, op & 7, sz).set(0); this.nz(0, sz); continue; }
      if ((op & 0xff00) === 0x4a00) { this.nz(this.ea((op >> 3) & 7, op & 7, sz).get(), sz); continue; }
      if ((op & 0xf100) === 0x7000) { const r = (op >> 9) & 7; this.d[r] = (((op & 0xff) << 24) >> 24) >>> 0; this.nz(this.d[r], 4); continue; }
      if ((op & 0xc000) === 0 && (op & 0x3000)) {                            // move / movea
        const s = { 1: 1, 3: 2, 2: 4 }[(op >> 12) & 3]!;
        const v = this.ea((op >> 3) & 7, op & 7, s).get();
        const dm = (op >> 6) & 7, dr = (op >> 9) & 7;
        if (dm === 1) { this.a[dr] = s === 2 ? (((v << 16) >> 16) >>> 0) : v; continue; }
        this.ea(dm, dr, s).set(v); this.nz(v, s); continue;
      }
      if ((op & 0xf000) === 0x5000) {                                        // addq / subq .l
        const q = ((op >> 9) & 7) || 8, sub = !!(op & 0x100), m = (op >> 3) & 7, r = op & 7;
        if (m === 1) { this.a[r] = (this.a[r] + (sub ? -q : q)) >>> 0; continue; }
        const e = this.ea(m, r, 4), x = e.get(), v = (x + (sub ? -q : q)) >>> 0;
        e.set(v); this.nz(v, 4); this.c = sub ? q > x : v < x; continue;
      }
      if ((op & 0xf000) === 0x6000) {
        let d = (op << 24) >> 24;
        if (d === 0) d = (this.ext16() << 16) >> 16;
        const k = (op >> 8) & 15, target = at + 2 + d;
        if (k === 1) { this.push(this.pc); this.pc = target; continue; }
        if (this.cc(k)) this.pc = target;
        continue;
      }
      if ((op & 0xf1c0) === 0x8080) { const r = (op >> 9) & 7; this.d[r] = (this.d[r] | this.ea((op >> 3) & 7, op & 7, 4).get()) >>> 0; this.nz(this.d[r], 4); continue; }
      if ((op & 0xf1c0) === 0x8180) { const e = this.ea((op >> 3) & 7, op & 7, 4); const v = (e.get() | this.d[(op >> 9) & 7]) >>> 0; e.set(v); this.nz(v, 4); continue; }
      if ((op & 0xf1c0) === 0xb080) {
        const s = this.ea((op >> 3) & 7, op & 7, 4).get(), dv = this.d[(op >> 9) & 7], r = (dv - s) >>> 0;
        this.nz(r, 4); this.c = s > dv; this.v = !!(((dv ^ s) & (dv ^ r)) & 0x80000000); continue;
      }
      if ((op & 0xf1c0) === 0xc1c0) { const r = (op >> 9) & 7; const s = (this.ea((op >> 3) & 7, op & 7, 2).get() << 16) >> 16; this.d[r] = (((this.d[r] << 16) >> 16) * s) >>> 0; this.nz(this.d[r], 4); continue; }
      if ((op & 0xf1c0) === 0xd1c0) { const r = (op >> 9) & 7; this.a[r] = (this.a[r] + this.ea((op >> 3) & 7, op & 7, 4).get()) >>> 0; continue; }
      if ((op & 0xf1c0) === 0xd080) { const r = (op >> 9) & 7, x = this.d[r], v = (x + this.ea((op >> 3) & 7, op & 7, 4).get()) >>> 0; this.d[r] = v; this.nz(v, 4); this.c = v < x; continue; }
      if ((op & 0xf1d8) === 0xe188) {                                         // lsl.l #n / Dm, Dn
        const r = op & 7, n = op & 0x20 ? this.d[(op >> 9) & 7] & 63 : ((op >> 9) & 7) || 8;
        const x = this.d[r];
        this.d[r] = n >= 32 ? 0 : (x << n) >>> 0; this.nz(this.d[r], 4); this.c = n > 0 && n <= 32 && !!((x >>> (32 - n)) & 1); continue;
      }
      if ((op & 0xf1c0) === 0x0100 || (op & 0xf1c0) === 0x01c0) {             // btst / bset Dn,<ea>
        const m = (op >> 3) & 7, e = this.ea(m, op & 7, m === 0 ? 4 : 1), bit = this.d[(op >> 9) & 7] & (m === 0 ? 31 : 7), v = e.get();
        this.z = !(v & (1 << bit));
        if ((op & 0xf1c0) === 0x01c0) e.set((v | (1 << bit)) >>> 0);
        continue;
      }
      throw new Error(`no interpretation for ${op.toString(16)} at ${at.toString(16)}`);
    }
  }
}

const U = found(X14);
const BLOCK = unmuteBlock(U, ORG);
const SP = 0x2ff000;
const machine = (): Cpu => {
  const m = new Cpu();
  m.load(ORG, BLOCK.bytes);
  m.a[7] = SP;
  // the global's note -> track map: notes 36.. play tracks 0..15; note 100 plays no track
  for (let t = 0; t < 16; t++) m.w8(U.revMap + 36 + t, t);
  m.w8(U.revMap + 100, 0x7f);
  return m;
};
const ev = (t: number, vel: number): number[] => [0x90, 36 + t, vel];
const NOTE100 = [0x90, 100, 0x7f];
const queue = (m: Cpu, q: number, buf: number, events: number[][]): void => {
  m.load(U.queues[q].base + 48 * buf, events.flat());
  m.w32(U.queues[q].count + 4 * buf, events.length);
};
const read = (m: Cpu, q: number, buf: number): number[][] => {
  const n = m.r32(U.queues[q].count + 4 * buf);
  return Array.from({ length: n }, (_, k) => [0, 1, 2].map((i) => m.r8(U.queues[q].base + 48 * buf + 3 * k + i)));
};
const run = (m: Cpu, label: string) => m.call(BLOCK.labels[label], ORG, ORG + BLOCK.codeBytes);
const pm = (m: Cpu, buf: number): number => m.r32(BLOCK.labels.pm + 4 * buf);

test('run: the build queues a muted track and marks it; MIDI machines keep the skip', () => {
  const m = machine();
  m.w32(U.buf, 1);
  m.w32(BLOCK.labels.pm + 4, 0xffff);
  m.w32(U.lockCnt, 7);
  assert.equal(run(m, 'h_clr').exit, 'rts');
  assert.deepEqual([pm(m, 1), m.r32(U.lockCnt)], [0, 0]);              // the new buffer's mask cleared, with the base's clr
  // per track: h_mute (a1 = mute + 16 + track), then h_cls (d1 = class, d5 = 0x60, -12(a6) = track)
  const track = (t: number, muted: boolean, cls: number): { exit: string; to: number; a7: number; regs: number[] } => {
    m.w8(U.mute + t, muted ? 1 : 0);
    m.a[1] = U.mute + 16 + t;
    assert.equal(run(m, 'h_mute').exit, 'rts');
    m.a[6] = 0x2fe000; m.w32(m.a[6] - 12, t);
    m.d[0] = 0x11111111; m.d[1] = cls; m.d[5] = 0x60; m.a[0] = 0x22222222;
    const r = run(m, 'h_cls');
    const out = { ...r, a7: m.a[7], regs: [m.d[0], m.d[1], m.a[0]] };
    m.a[7] = SP;
    return out;
  };
  // muted, any machine but a MIDI one: on to the note-queue path, marked, registers as they were
  assert.deepEqual(track(3, true, 0x10), { exit: 'jmp', to: NOTE_QUEUE, a7: SP, regs: [0x11111111, 0x10, 0x22222222] });
  assert.equal(pm(m, 1), 1 << 3);
  // unmuted: the same path, not marked
  assert.deepEqual(track(4, false, 0x10).to, NOTE_QUEUE);
  assert.equal(pm(m, 1), 1 << 3);
  // a MIDI machine (class 0x60): muted skips to "next track" as the base does, unmuted continues
  assert.deepEqual([track(5, true, 0x60).to, pm(m, 1)], [SKIP, 1 << 3]);
  assert.deepEqual(track(6, false, 0x60).exit, 'rts');
  assert.equal(pm(m, 0), 0);                                            // the other buffer is not touched
});

test('run: the step tick drops queue A events of tracks queued while muted and still muted, nothing else', () => {
  const m = machine();
  m.w32(U.buf, 1); m.w32(U.bufB, 0);
  m.w32(BLOCK.labels.pm + 4, (1 << 3) | (1 << 6));                    // tracks 3 and 6 were muted when queued
  m.w8(U.mute + 3, 1);                                                  // 3 still is; 6 was unmuted since
  m.w8(U.mute + 8, 1);                                                  // 8 was muted after it was queued: the base's path
  queue(m, 0, 1, [ev(3, 0x7f), ev(6, 0x7f), ev(8, 0x5f), NOTE100, ev(3, 0x5f)]);
  queue(m, 1, 1, [ev(3, 0), ev(6, 0), ev(8, 0)]);
  queue(m, 2, 1, [ev(3, 0x7f)]);
  queue(m, 0, 0, [ev(3, 0x7f)]);
  for (let r = 0; r < 8; r++) { m.d[r] = 0x100 + r; m.a[r] = 0x200 + r; }
  m.a[0] = 178 * 0; m.a[7] = SP;
  const before = [...m.d, ...m.a.slice(1)];
  assert.equal(run(m, 'h_play').exit, 'rts');
  assert.equal(m.a[0], U.localOn);                                      // as the base's adda.l leaves it
  assert.deepEqual([...m.d, ...m.a.slice(1)], before);                  // every other register preserved
  assert.deepEqual(read(m, 0, 1), [ev(6, 0x7f), ev(8, 0x5f), NOTE100]);   // compacted, in order
  assert.deepEqual(read(m, 1, 1), [ev(6, 0), ev(8, 0)]);
  assert.deepEqual(read(m, 2, 1), [ev(3, 0x7f)]);                       // queue B waits for its own tick
  assert.deepEqual(read(m, 0, 0), [ev(3, 0x7f)]);                       // the other buffer is not touched
  assert.equal(pm(m, 1), (1 << 3) | (1 << 6));                          // the mask stays for queue B
});

test('run: the swing tick filters queue B with the mute as it is then, from the latched buffer', () => {
  const m = machine();
  m.w32(U.buf, 0); m.w32(U.bufB, 1);                                    // the build has moved on; B plays buffer 1
  m.w32(BLOCK.labels.pm + 4, (1 << 3) | (1 << 6));
  m.w8(U.mute + 6, 1);                                                  // 3 unmuted before the swing tick, 6 muted again
  queue(m, 2, 1, [ev(3, 0x7f), ev(6, 0x7f), ev(9, 0x7f)]);
  queue(m, 3, 1, [ev(3, 0), ev(6, 0), ev(9, 0)]);
  queue(m, 0, 1, [ev(6, 0x7f)]);
  m.a[0] = 178; m.w8(U.slot, 1);                                        // slot 1: the note map of the second global
  for (let t = 0; t < 16; t++) m.w8(U.revMap + 178 + 36 + t, t);
  assert.equal(run(m, 'h_playB').exit, 'rts');
  assert.equal(m.a[0], 178 + U.localOn);
  assert.deepEqual(read(m, 2, 1), [ev(3, 0x7f), ev(9, 0x7f)]);
  assert.deepEqual(read(m, 3, 1), [ev(3, 0), ev(9, 0)]);
  assert.deepEqual(read(m, 0, 1), [ev(6, 0x7f)]);                       // queue A is the step tick's
});

/** The build's view of one track: h_mute then h_cls, as the base calls them (class 0x10: not a MIDI machine). */
const buildTrack = (m: Cpu, t: number): void => {
  m.a[1] = U.mute + 16 + t;
  assert.equal(run(m, 'h_mute').exit, 'rts');
  m.a[6] = 0x2fe000; m.w32(m.a[6] - 12, t);
  m.d[1] = 0x10; m.d[5] = 0x60;
  assert.deepEqual(run(m, 'h_cls'), { exit: 'jmp', to: NOTE_QUEUE });
  m.a[7] = SP;
};
const muted = (m: Cpu, t: number, on: boolean): void => m.w8(U.mute + t, on ? 1 : 0);

test('run: every marked track still muted empties the queue; a mask over an empty queue changes nothing', () => {
  const m = machine();
  m.w32(U.buf, 0);
  m.w32(BLOCK.labels.pm, (1 << 2) | (1 << 9));
  muted(m, 2, true); muted(m, 9, true);
  queue(m, 0, 0, [ev(2, 0x7f), ev(9, 0x7f), ev(2, 0x5f)]);
  queue(m, 1, 0, []);                                                   // count 0: nothing to do
  m.load(U.queues[1].base, [0xaa, 0xbb, 0xcc]);                         // stale bytes past the count stay
  assert.equal(run(m, 'h_play').exit, 'rts');
  assert.equal(m.r32(U.queues[0].count), 0);
  assert.deepEqual(read(m, 0, 0), []);
  assert.equal(m.r32(U.queues[1].count), 0);
  assert.deepEqual([0, 1, 2].map((k) => m.r8(U.queues[1].base + k)), [0xaa, 0xbb, 0xcc]);
});

test('run: a full queue of 16 events is compacted in place, nothing written past its buffer', () => {
  const m = machine();
  m.w32(U.buf, 0);
  m.w32(BLOCK.labels.pm, (1 << 1) | (1 << 4) | (1 << 15));
  for (const t of [1, 4, 15]) muted(m, t, true);
  const all = Array.from({ length: 16 }, (_, k) => ev(k, 0x40 + k));
  queue(m, 0, 0, all);
  const next = U.queues[0].base + 48;                                   // buffer 1 follows buffer 0
  m.load(next, [0x11, 0x22, 0x33, 0x44]);
  assert.equal(run(m, 'h_play').exit, 'rts');
  assert.deepEqual(read(m, 0, 0), all.filter((_, k) => ![1, 4, 15].includes(k)));
  assert.deepEqual([0, 1, 2, 3].map((k) => m.r8(next + k)), [0x11, 0x22, 0x33, 0x44]);
});

test('run: note-off queues are filtered on their own contents, not as copies of the note-ons', () => {
  const m = machine();
  m.w32(U.buf, 1);
  m.w32(BLOCK.labels.pm + 4, (1 << 3) | (1 << 7));
  muted(m, 3, true); muted(m, 7, true);
  queue(m, 0, 1, [ev(3, 0x7f), ev(5, 0x7f)]);
  queue(m, 1, 1, [ev(5, 0), ev(7, 0), ev(3, 0), ev(11, 0)]);           // other order, a track the note-ons lack
  assert.equal(run(m, 'h_play').exit, 'rts');
  assert.deepEqual(read(m, 0, 1), [ev(5, 0x7f)]);
  assert.deepEqual(read(m, 1, 1), [ev(5, 0), ev(11, 0)]);
});

test('run: two steps through both buffers: build X, A of X, latch, build Y, B of X, build X again', () => {
  const m = machine();
  const X = 0, Y = 1;
  // step S is built into X while tracks 2 and 6 are muted
  m.w32(U.buf, X); m.w32(BLOCK.labels.pm + 4 * X, 0xdead);              // whatever the mask held before
  run(m, 'h_clr');
  assert.equal(pm(m, X), 0);
  muted(m, 2, true); muted(m, 6, true);
  for (const t of [2, 4, 6]) buildTrack(m, t);
  assert.equal(pm(m, X), (1 << 2) | (1 << 6));
  queue(m, 0, X, [ev(2, 0x7f), ev(4, 0x7f)]); queue(m, 1, X, [ev(2, 0), ev(4, 0)]);
  queue(m, 2, X, [ev(6, 0x7f)]); queue(m, 3, X, [ev(6, 0)]);            // track 6 swings
  // step tick of S: track 2 unmuted just before it; A of X plays
  muted(m, 2, false);
  run(m, 'h_play');
  assert.deepEqual([read(m, 0, X), read(m, 1, X)], [[ev(2, 0x7f), ev(4, 0x7f)], [ev(2, 0), ev(4, 0)]]);
  // the latch, then S+1 is built into Y with track 6 still muted: Y's mask, not X's
  m.w32(U.bufB, X); m.w32(U.buf, Y);
  run(m, 'h_clr');
  buildTrack(m, 6);
  assert.deepEqual([pm(m, X), pm(m, Y)], [(1 << 2) | (1 << 6), 1 << 6]);
  // swing tick of S: B of X, track 6 still muted, decided with X's mask
  run(m, 'h_playB');
  assert.deepEqual([read(m, 2, X), read(m, 3, X)], [[], []]);
  // next step tick: A of Y with track 6 unmuted in time; then the build of S+2 clears X's mask only
  queue(m, 0, Y, [ev(6, 0x7f)]);
  muted(m, 6, false);
  m.w32(U.buf, Y);
  run(m, 'h_play');
  assert.deepEqual(read(m, 0, Y), [ev(6, 0x7f)]);
  m.w32(U.bufB, Y); m.w32(U.buf, X);
  run(m, 'h_clr');
  assert.deepEqual([pm(m, X), pm(m, Y)], [0, 1 << 6]);
});

test('run: with nothing queued while muted, the queues are left exactly as they are', () => {
  const m = machine();
  m.w32(U.buf, 1);
  m.w8(U.mute + 3, 1);
  queue(m, 0, 1, [ev(3, 0x7f), ev(4, 0x7f)]);
  const snap = new Map(m.mem);
  assert.equal(run(m, 'h_play').exit, 'rts');
  for (const [k, v] of snap) if (k < SP - 0x100 || k >= SP) assert.equal(m.mem.get(k), v, k.toString(16));
});

// ---- the option: on by default where the base has it, off leaves the build as it was

const fixture = (unmute: Unmute | null): Base => ({
  name: 'fixture', support: { unmuteFix: unmute ? { ok: true, why: 'found' } : { ok: false, why: 'the tick worker: not found' } },
  os: { descriptorSize: 86, familyTable: 0, cfBase: 0, familyCount: 0, levBar: { ctr: { ids: [124, 127] }, low: { ids: [88, 95] } } },
  ext: { base: 0x2bc000, end: 0x2bd000 },
  features: { dynLabels: { segment: [0x2be100, 0x2bef60] }, unmute },
} as unknown as Base);
const core = { knob_callback: 'cAlOdQ==', dyn: { call_size: 6 } } as unknown as CorePack;
const ram = (base: Base, unmute?: boolean) => ramImage(base, new Uint8Array(8), core, [], [],
  { dyn: false, dsp1: null, host: false, ind: null, toFlash: new Set(), dynFlash: new Set(), idSpace: 192, flashAt: 0x100e0000, redrawValues: 0, unmute });

test('resolveFeatures: on by default where found; off when asked; asked for where not found is a problem', () => {
  const yes = fixture(found(X14)), no = fixture(null);
  assert.equal(resolveFeatures(yes, {}).unmute, true);
  assert.equal(resolveFeatures(yes, { unmuteFix: false }).unmute, false);
  const quiet = resolveFeatures(no, {});
  assert.equal(quiet.unmute, false);
  assert.deepEqual(quiet.problems, []);
  assert.match(quiet.notes.join(' '), /unmute-latency fix .*not supported on fixture: the tick worker: not found/);
  const asked = resolveFeatures(no, { unmuteFix: true });
  assert.equal(asked.unmute, false);
  assert.match(asked.problems.join(' '), /unmute-latency fix/);
});

test('off: the RAM image is the one the build had before; on: the routines alone in the label RAM range', () => {
  const base = fixture(found(X14));
  const before = ram(base);
  const off = ram(base, false);
  assert.deepEqual(off, before);
  assert.equal(off.unmute, null);
  const on = ram(base, true);
  assert.deepEqual(on.image, before.image);
  assert.equal(on.bytes, before.bytes);
  assert.equal(on.dyn, null);
  assert.ok(on.unmute);
  assert.equal(on.unmute.home, 'own');
  assert.equal(on.unmute.block.at, ORG);
  assert.deepEqual(on.unmute.segment, unmuteBlock(found(X14), ORG).bytes);
});

test('the CLI takes --unmute-fix or --no-unmute-fix, not both', () => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const r = spawnSync(process.execPath, [cli, '--in', 'missing.syx', '--out', 'out.syx', '--uw', '--unmute-fix', '--no-unmute-fix'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /--unmute-fix and --no-unmute-fix: choose one/);
  assert.doesNotMatch(r.stderr, /ENOENT/);
});

// ---- with firmware (MD_FIRMWARE_DIR: a directory of OS files you own; skipped without it)

const FW = process.env.MD_FIRMWARE_DIR;
const fwSkip = !FW || !existsSync(FW) ? 'MD_FIRMWARE_DIR is not set to a directory of OS files' : false;
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Every OS file in the directory that resolves to a profiled base (stock 1.63 prepared first), by profile. */
async function firmware(): Promise<Map<string, { bytes: Uint8Array; resolved: Awaited<ReturnType<typeof resolveBase>> }>> {
  const set = loadBases(join(ROOT, 'bases'));
  const out = new Map<string, { bytes: Uint8Array; resolved: Awaited<ReturnType<typeof resolveBase>> }>();
  for (const f of readdirSync(FW!).filter((n) => /\.(bin|syx)$/i.test(n))) {
    let bytes: Uint8Array = readFileSync(join(FW!, f));
    try {
      let resolved;
      try { resolved = await resolveBase(readFirmware(bytes), set); }
      catch (e) {
        if (!(e instanceof NotPatchable) || e.profile?.id !== 'stock-163') continue;
        bytes = (await prepare163(bytes)).output;
        resolved = await resolveBase(readFirmware(bytes), set);
      }
      if (resolved.profile && !out.has(resolved.profile.id)) out.set(resolved.profile.id, { bytes, resolved });
    } catch { /* not an OS file the engine reads */ }
  }
  return out;
}

test('firmware: discovery finds what each profile caches for the fix, and the fix only where it is qualified', { skip: fwSkip }, async () => {
  const all = await firmware();
  assert.ok(all.size, `no profiled OS file in ${FW}`);
  for (const [id, { resolved }] of all) {
    const p = resolved.profile!.cache ?? {};
    const r = findUnmute(codeImages(readFirmware(all.get(id)!.bytes), resolved.base));
    if (p['unmute.sites']) {
      assert.ok(r.unmute, `${id}: ${r.why}`);
      for (const [k, v] of Object.entries(unmuteValues(r.unmute))) assert.equal(v.map((x) => `0x${x.toString(16)}`).join(','), p[k], `${id} ${k}`);
      assert.deepEqual(resolved.disagreements, [], id);
      assert.equal(resolved.base.support.unmuteFix.ok, true, id);
    } else {
      assert.equal(resolved.base.support.unmuteFix.ok, false, `${id}: offered without a qualified profile`);
    }
  }
});

// The output of main for these inputs (default options, the bundled catalog, --uw). Built with
// --no-unmute-fix the image must be the same, byte for byte. Any intended change to the build
// changes these: record the new hash from a build without the fix, and say why in the change.
// 255c0ec: VADSY and VADPC re-assembled with label targets (2b1bd79) changed the catalog's code;
// the engine of 255c0ec with the catalog from before 2b1bd79 still gives the earlier db5a9921... / a2976aa1...
// d360e4b: NFX4P joined the catalog (catalog/effects-ladder.json); the engine of d360e4b with that file
// left out of catalog/ still gives the earlier 95d8fa8a... / 1874e754...
// NZEPL footprint and WALK fix: catalog/np.json re-exported, 2,199 DSP2 words smaller; with the earlier np.json
// the same engine still gives the earlier 4c73c964... / e037e2ee...
// golden_catalog.test.ts records the catalog these were built from, so CI notices a catalog change.
const GOLDEN_OFF: Record<string, string> = {
  x14: 'cb8591e66b86ec79dbe90e2a261000da5b3c99bba82513904adfc7d8a5bf2ba8',
  'stock-163-prepared': '760c4f9d79bac77e99c622e93c3f44f147934dd3b10cd4506cc19a58842a0516',
};

test('firmware: --no-unmute-fix builds the image the build made before the fix', { skip: fwSkip }, async () => {
  const all = await firmware();
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'kb-unmute-'));
  try {
    let checked = 0;
    for (const [id, want] of Object.entries(GOLDEN_OFF)) {
      const got = all.get(id);
      if (!got) continue;
      const input = join(dir, `${id}.bin`), out = join(dir, `${id}-off.bin`);
      writeFileSync(input, got.bytes);
      const r = spawnSync(process.execPath, [cli, '--in', input, '--out', out, '--uw', '--catalog', join(ROOT, 'catalog'), '--no-unmute-fix'],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(sha(readFileSync(out)), want, id);
      checked++;
    }
    assert.ok(checked, `none of ${Object.keys(GOLDEN_OFF).join(', ')} in ${FW}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
