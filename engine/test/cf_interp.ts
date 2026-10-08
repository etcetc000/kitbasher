// A small ColdFire interpreter for tests: only the instruction forms engine/src/midi_chroma.ts
// assembles, decoded from the bytes themselves. Memory is sparse (unset bytes read 0). Calls to
// addresses with a stub run the stub (a JS function) instead, as if it were the OS routine there;
// the stub sees the stack with its return address on top and returns like `rts`.

export type Stub = (cpu: Cpu) => void;

const RET = 0xfffffff0;                 // the sentinel return address of a top-level call

export class Cpu {
  d = new Int32Array(8);
  a = new Uint32Array(8);
  pc = 0;
  n = false; z = false; v = false; c = false;
  /** the status register's upper byte as `move.w sr` sees it (S bit, interrupt mask); the CCR bits are n/z/v/c */
  sr = 0x2000;
  /** every write of the interrupt mask, in order (tests check the routines restore it) */
  srWrites: number[] = [];
  mem = new Map<number, number>();
  stubs = new Map<number, Stub>();
  steps = 0;

  constructor(stack = 0x00f00000) { this.a[7] = stack; }

  load(at: number, bytes: ArrayLike<number>): void { for (let i = 0; i < bytes.length; i++) this.mem.set(at + i, bytes[i] & 0xff); }
  r8(at: number): number { return this.mem.get(at >>> 0) ?? 0; }
  r16(at: number): number { return (this.r8(at) << 8) | this.r8(at + 1); }
  r32(at: number): number { return ((this.r16(at) << 16) | this.r16(at + 2)) >>> 0; }
  w8(at: number, v: number): void { this.mem.set(at >>> 0, v & 0xff); }
  w16(at: number, v: number): void { this.w8(at, v >>> 8); this.w8(at + 1, v); }
  w32(at: number, v: number): void { this.w16(at, v >>> 16); this.w16(at + 2, v); }
  push(v: number): void { this.a[7] -= 4; this.w32(this.a[7], v); }
  pop(): number { const v = this.r32(this.a[7]); this.a[7] += 4; return v; }
  /** the n-th long argument of a C-style call, from inside a stub (0 = the first) */
  arg(n: number): number { return this.r32(this.a[7] + 4 + 4 * n); }

  /** jsr to `at` with these long arguments pushed (C order) and run until it returns; pops them */
  call(at: number, args: number[] = [], limit = 1_000_000): void {
    for (const v of [...args].reverse()) this.push(v);
    const saved = this.pc;
    this.push(RET);
    this.pc = at;
    this.run(limit);
    this.a[7] += 4 * args.length;
    this.pc = saved;
  }

  private run(limit: number): void {
    const depth = this.a[7], start = this.steps;
    for (;;) {
      if (this.pc === RET && this.a[7] === depth + 4) return;
      if (++this.steps - start > limit) throw new Error(`no return after ${limit} instructions (pc ${this.pc.toString(16)})`);
      const stub = this.stubs.get(this.pc);
      if (stub) { stub(this); this.pc = this.pop(); continue; }
      this.step();
    }
  }

  private fetch16(): number { const v = this.r16(this.pc); this.pc = (this.pc + 2) >>> 0; return v; }
  private fetch32(): number { const v = this.r32(this.pc); this.pc = (this.pc + 4) >>> 0; return v; }

  private nz(v: number, size: number): void {
    const bits = size * 8, m = bits === 32 ? 0xffffffff : (1 << bits) - 1, x = (v & m) >>> 0;
    this.z = x === 0; this.n = ((x >>> (bits - 1)) & 1) === 1;
  }
  private logic(v: number, size: number): void { this.nz(v, size); this.v = false; this.c = false; }

  /** an effective address: { read, write, addr } for the given size (bytes) */
  private ea(mode: number, reg: number, size: number): { read: () => number; write: (v: number) => void; addr?: number } {
    const rd = (at: number): number => (size === 1 ? this.r8(at) : size === 2 ? this.r16(at) : this.r32(at));
    const wr = (at: number, v: number): void => (size === 1 ? this.w8(at, v) : size === 2 ? this.w16(at, v) : this.w32(at, v));
    const mem = (at: number) => ({ read: () => rd(at), write: (v: number) => wr(at, v), addr: at >>> 0 });
    switch (mode) {
      case 0: return {
        read: () => (size === 4 ? this.d[reg] >>> 0 : this.d[reg] & (size === 1 ? 0xff : 0xffff)),
        write: (v) => { this.d[reg] = size === 4 ? v : (this.d[reg] & ~(size === 1 ? 0xff : 0xffff)) | (v & (size === 1 ? 0xff : 0xffff)); },
      };
      case 1: return { read: () => this.a[reg], write: (v) => { this.a[reg] = v >>> 0; } };
      case 2: return mem(this.a[reg]);
      case 3: { const at = this.a[reg]; this.a[reg] += reg === 7 && size === 1 ? 2 : size; return mem(at); }
      case 4: { this.a[reg] -= reg === 7 && size === 1 ? 2 : size; return mem(this.a[reg]); }
      case 5: { const d = (this.fetch16() << 16) >> 16; return mem(this.a[reg] + d); }
      case 6: {
        const ext = this.fetch16();
        if (!(ext & 0x0800) || (ext & 0x8000)) throw new Error(`index form ${ext.toString(16)} not supported`);
        const xi = this.d[(ext >> 12) & 7], scale = 1 << ((ext >> 9) & 3), d = (ext << 24) >> 24;
        return mem(this.a[reg] + xi * scale + d);
      }
      case 7:
        if (reg === 0) { const at = (this.fetch16() << 16) >> 16; return mem(at >>> 0); }
        if (reg === 1) return mem(this.fetch32());
        if (reg === 4) { const v = size === 4 ? this.fetch32() : size === 2 ? this.fetch16() : this.fetch16() & 0xff; return { read: () => v, write: () => { throw new Error('write to #imm'); } }; }
    }
    throw new Error(`addressing mode ${mode}/${reg} not supported`);
  }

  private cond(cc: number): boolean {
    const { n, z, v, c } = this;
    switch (cc) {
      case 0: return true; case 2: return !c && !z; case 3: return c || z; case 4: return !c; case 5: return c;
      case 6: return !z; case 7: return z; case 10: return !n; case 11: return n;
      case 12: return n === v; case 13: return n !== v; case 14: return !z && n === v; case 15: return z || n !== v;
    }
    throw new Error(`condition ${cc} not supported`);
  }

  /** x - y as size bytes, setting NZVC as cmp/sub do; returns the difference */
  private sub(x: number, y: number, size: number): number {
    const bits = size * 8, m = bits === 32 ? 0xffffffff : (1 << bits) - 1;
    x = (x & m) >>> 0; y = (y & m) >>> 0;
    const r = ((x - y) & m) >>> 0, sign = (v: number): number => (v >>> (bits - 1)) & 1;
    this.nz(r, size); this.c = y > x; this.v = sign(x) !== sign(y) && sign(r) !== sign(x);
    return r;
  }
  private add(x: number, y: number): number {
    const r = (x + y) >>> 0;
    this.nz(r, 4); this.c = (x >>> 0) + (y >>> 0) > 0xffffffff;
    this.v = (x >>> 31) === (y >>> 31) && (r >>> 31) !== (x >>> 31);
    return r;
  }

  step(): void {
    const at = this.pc, op = this.fetch16();
    const mode = (op >> 3) & 7, reg = op & 7, rx = (op >> 9) & 7;
    const top = op >> 12;
    if (op === 0x4e75) { this.pc = this.pop(); return; }                       // rts
    if (op === 0x4e71) return;                                                 // nop
    if ((op & 0xfff8) === 0x40c0) {                                            // move.w sr,Dn
      const ccr = (this.n ? 8 : 0) | (this.z ? 4 : 0) | (this.v ? 2 : 0) | (this.c ? 1 : 0);
      this.d[reg] = (this.d[reg] & ~0xffff) | ((this.sr & 0xff00) | ccr); return;
    }
    if (op === 0x46fc || (op & 0xfff8) === 0x46c0) {                           // move.w #imm,sr / move.w Dn,sr
      const v = op === 0x46fc ? this.fetch16() : this.d[reg] & 0xffff;
      this.sr = v & 0xff00; this.srWrites.push(this.sr);
      this.n = !!(v & 8); this.z = !!(v & 4); this.v = !!(v & 2); this.c = !!(v & 1);
      return;
    }
    if (top === 7 && !(op & 0x100)) { this.d[rx] = (op << 24) >> 24; this.logic(this.d[rx], 4); return; }   // moveq
    if (top === 1 || top === 2 || top === 3) {                                 // move.b / move.l / move.w
      const size = top === 1 ? 1 : top === 2 ? 4 : 2;
      const v = this.ea(mode, reg, size).read();
      const dm = (op >> 6) & 7;
      if (dm === 1) { this.a[rx] = size === 4 ? v >>> 0 : ((v << 16) >> 16) >>> 0; return; }   // movea: no flags
      this.ea(dm, rx, size).write(v);
      this.logic(v, size);
      return;
    }
    if (top === 6) {                                                           // bra / bsr / bcc
      const cc = (op >> 8) & 15;
      let d = (op << 24) >> 24;
      const base = this.pc;
      if (d === 0) { d = (this.fetch16() << 16) >> 16; }
      const target = (base + d) >>> 0;
      if (cc === 1) { this.push(this.pc); this.pc = target; return; }
      if (this.cond(cc)) this.pc = target;
      return;
    }
    if ((op & 0xfff8) === 0x49c0) { this.d[reg] = (this.d[reg] << 24) >> 24; this.logic(this.d[reg], 4); return; }     // extb.l (before lea, whose pattern it fits)
    if ((op & 0xf1c0) === 0x41c0) { const e = this.ea(mode, reg, 4); this.a[rx] = e.addr!; return; }   // lea
    if ((op & 0xffc0) === 0x4840) { const e = this.ea(mode, reg, 4); this.push(e.addr!); return; }      // pea
    if ((op & 0xffc0) === 0x4e80) { const e = this.ea(mode, reg, 4); this.push(this.pc); this.pc = e.addr!; return; }   // jsr
    if ((op & 0xffc0) === 0x4ec0) { const e = this.ea(mode, reg, 4); this.pc = e.addr!; return; }      // jmp
    if ((op & 0xff00) === 0x4a00) {                                            // tst.b / tst.w / tst.l
      const size = [1, 2, 4][(op >> 6) & 3];
      this.logic(this.ea(mode, reg, size).read(), size);
      return;
    }
    if ((op & 0xfff8) === 0x0c80) { const v = this.fetch32(); this.sub(this.d[reg], v, 4); return; }    // cmpi.l
    if ((op & 0xfff8) === 0x0080) { const v = this.fetch32(); this.d[reg] |= v; this.logic(this.d[reg], 4); return; }   // ori.l
    if ((op & 0xfff8) === 0x0280) { const v = this.fetch32(); this.d[reg] &= v; this.logic(this.d[reg], 4); return; }   // andi.l
    if ((op & 0xf1c0) === 0xb080) { this.sub(this.d[rx], this.ea(mode, reg, 4).read(), 4); return; }     // cmp.l
    if ((op & 0xf1c0) === 0xb1c0) { this.sub(this.a[rx], this.ea(mode, reg, 4).read(), 4); return; }     // cmpa.l
    if ((op & 0xf1c0) === 0x8080) { this.d[rx] |= this.ea(mode, reg, 4).read(); this.logic(this.d[rx], 4); return; }   // or.l
    if ((op & 0xf1c0) === 0xc080) { this.d[rx] &= this.ea(mode, reg, 4).read(); this.logic(this.d[rx], 4); return; }   // and.l
    if ((op & 0xf1c0) === 0xd080) { this.d[rx] = this.add(this.d[rx], this.ea(mode, reg, 4).read()); return; }          // add.l
    if ((op & 0xf1c0) === 0x9080) { this.d[rx] = this.sub(this.d[rx], this.ea(mode, reg, 4).read(), 4); return; }      // sub.l
    if ((op & 0xf1c0) === 0xd1c0) { this.a[rx] = (this.a[rx] + this.ea(mode, reg, 4).read()) >>> 0; return; }         // adda.l
    if ((op & 0xf1c0) === 0xc1c0) {                                            // muls.w
      const y = (this.ea(mode, reg, 2).read() << 16) >> 16, x = (this.d[rx] << 16) >> 16;
      this.d[rx] = x * y; this.logic(this.d[rx], 4); return;
    }
    if ((op & 0xf1c0) === 0x5080 || (op & 0xf1c0) === 0x5180) {                // addq.l / subq.l
      const q = rx || 8, e = this.ea(mode, reg, 4), x = e.read();
      if (mode === 1) { e.write(op & 0x100 ? x - q : x + q); return; }
      e.write(op & 0x100 ? this.sub(x, q, 4) : this.add(x, q));
      return;
    }
    if ((op & 0xf1f8) === 0xe188 || (op & 0xf1f8) === 0xe088) {                // lsl.l / lsr.l #n,Dn
      const n = rx || 8, x = this.d[reg] >>> 0, left = !!(op & 0x100);
      const r = left ? (x << n) >>> 0 : x >>> n;
      this.d[reg] = r; this.logic(r, 4); this.c = left ? ((x >>> (32 - n)) & 1) === 1 : ((x >>> (n - 1)) & 1) === 1;
      return;
    }
    if ((op & 0xfff8) === 0x4680) { this.d[reg] = ~this.d[reg]; this.logic(this.d[reg], 4); return; }   // not.l
    if ((op & 0xfff8) === 0x4480) { this.d[reg] = this.sub(0, this.d[reg], 4); return; }                 // neg.l
    if ((op & 0xf1f8) === 0x0100) { this.z = ((this.d[reg] >>> (this.d[rx] & 31)) & 1) === 0; return; }  // btst Dn,Dn
    if ((op & 0xfff8) === 0x0800) { const b = this.fetch16() & 31; this.z = ((this.d[reg] >>> b) & 1) === 0; return; } // btst #n,Dn
    if ((op & 0xfff8) === 0x0880) {                                            // bclr #n,Dn
      const b = this.fetch16() & 31; this.z = ((this.d[reg] >>> b) & 1) === 0; this.d[reg] &= ~(1 << b); return;
    }
    if ((op & 0xffc0) === 0x48c0 || (op & 0xffc0) === 0x4cc0) {                // movem.l
      const list = this.fetch16(), e = this.ea(mode, reg, 4);
      let p = e.addr!;
      for (let k = 0; k < 16; k++) {
        if (!((list >> k) & 1)) continue;
        if (op & 0x0400) { const v = this.r32(p); if (k < 8) this.d[k] = v; else this.a[k - 8] = v; }
        else this.w32(p, k < 8 ? this.d[k] : this.a[k - 8]);
        p += 4;
      }
      return;
    }
    throw new Error(`opcode ${op.toString(16)} at ${at.toString(16)} not supported`);
  }
}
