// --dsp1-recover's 'ordered' variant, executed: the handler's own words run through a small
// DSP56300 interpreter (the same model as recover.test.ts, extended with M0 and with a nested long
// interrupt injected at a chosen instruction boundary).
//
// It checks the two hazards the variant exists for: a nested interrupt landing between the stack
// pop and push (which would replace the popped frame's SSL), and an interrupted context running with
// modulo addressing in M0 (which would wrap the output clear early).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/recover.js';

// ---------------------------------------------------------------------------------------------
// 1. the interpreter

const S24 = (v: number): bigint => BigInt(v & 0x800000 ? v - 0x1000000 : v);
const U24 = (v: bigint): number => Number(BigInt.asUintN(24, v));

interface Cpu {
  P: Map<number, number>; X: Map<number, number>; Y: Map<number, number>;
  a: bigint;                         // A as a 56-bit signed value
  x0: number; r0: number; m0: number;
  /** Inject a nested long interrupt's push/pop at one instruction boundary. */
  injectAt?: number;
  maskDelay: number;
  ssh: number;                       // the interrupt's return address, as the rti pops it
  /** the DSP56300 system stack, SSH:SSL per slot, and SP (1 = the interrupt's own frame), the
   *  loop counter DO pushes and restores, and the SR the rti hands back */
  stk: { h: number; l: number }[]; sp: number; lc: number; srOut: number;
  hcr: number; ddr4: number; dcr0: number;
  n: boolean; z: boolean;
  cycles: number;
  /** cycles into the handler at which it opened the interrupt mask (-1: it never did) */
  unmaskedAt: number;
  lastCost?: number;
  dcr4: number; cflag: boolean;
  /** per cycle: the internal X/Y 256-word bank the handler touched, or null */
  trace: (string | null)[];
  /** the codec link (ESSI1 + DMA0 + DMA1), when a test models it; the interrupt mask state */
  codec?: {read(a:number,c:Cpu):number|undefined;write(a:number,v:number):boolean;advance(n:number,c:Cpu):void};
  masked: boolean;
  /** every PC the handler executed, for the inertness checks */
  pcs: number[];
}

const a1 = (c: Cpu): number => U24(c.a >> 24n);
const setA1 = (c: Cpu, v: number): void => {
  const a2 = c.a >> 48n, a0 = BigInt.asUintN(24, c.a);
  c.a = (a2 << 48n) | (BigInt(v & 0xffffff) << 24n) | a0;
};
const setA2 = (c: Cpu, v: number): void => { c.a = (S24(v & 0xff ? (v & 0x80 ? v | 0xffff00 : v) : 0) << 48n) | BigInt.asUintN(48, c.a); };
const setA0 = (c: Cpu, v: number): void => { c.a = (c.a >> 24n << 24n) | BigInt(v & 0xffffff); };
const loadA = (c: Cpu, v: number): void => { c.a = S24(v) << 24n; };
const cmp = (c: Cpu, s: bigint): void => { const d = c.a - s; c.n = d < 0n; c.z = d === 0n; };
const flags = (c: Cpu): void => { c.n = c.a < 0n; c.z = c.a === 0n; };
const disp = (w: number): number => { const v = ((w >> 6) & 0xf) << 5 | (w & 0x1f); return v & 0x100 ? v - 0x200 : v; };

/** X-space reads: HCR, DDR4, DSTR, and (with a codec) ESSI1 and the codec DMAs; memory otherwise. */
function rd(c: Cpu, a: number): number {
  if (a === 0xffffc2) return c.hcr;
  if (c.codec) { const v = c.codec.read(a, c); if (v !== undefined) return v; }
  if (a === 0xffffde) return c.ddr4;
  if (a === 0xfffff4) return 0x3f & ~(c.dcr4 & 0x800000 ? 0x10 : 0);   // DTD0..5, DTD4 from DCR4's DE
  return c.X.get(a) ?? 0;
}
function wr(c: Cpu, a: number, v: number): void {
  if (a === 0xffffc2) { c.hcr = v; return; }
  if (a === 0xffffdc) { c.dcr4 = v; return; }
  if (a === 0xffffec) c.dcr0 = v;
  if (c.codec && c.codec.write(a, v)) return;
  c.X.set(a, v);
}

/** Run from `pc` to the rti; the return address is `ssh` afterwards. */
function run(c: Cpu, pc: number): void {
  const P = (a: number): number => { const v = c.P.get(a); if (v === undefined) throw new Error(`P:${a.toString(16)} is empty`); return v; };
  const loops: { top: number; la: number; left: number }[] = [];
  // the system stack, as the DSP56300 has it: a push writes SSH and SSL, `move ssh,D` pops (SSL stays
  // in the slot), `move S,ssh` pushes SSH only (the slot's SSL is whatever was there)
  const push = (h: number, l: number): void => { c.sp++; c.stk[c.sp] = { h, l }; };
  const pop = (): { h: number; l: number } => { const f = c.stk[c.sp] ?? { h: 0, l: 0 }; c.sp--; return f; };
  const endLoop = (): void => { pop(); c.lc = pop().l; };      // PC:SR frame, then LA:LC
  const bank = (sp: string, ad: number): string | null => (ad < 0x1000 ? `${sp}${ad >> 8}` : null);
  const reg = (d: number): number => (d === 0x10 ? c.r0 : d === 0x04 ? c.x0 : d === 0x0c ? a1(c) : (() => { throw new Error(`reg ${d}`); })());
  for (let guard = 0; guard < 200000; guard++) {
    const w = P(pc), e = c.P.get(pc + 1) ?? 0;
    if (pc === c.injectAt && (!c.masked || c.maskDelay > 0)) { push(pc, SR_IN_HANDLER); pop(); }
    if (c.maskDelay > 0) c.maskDelay--;
    c.pcs.push(pc);
    let next = pc + 1, two = false, acc: string | null = null;
    if (w === 0x000004) { const f = pop(); c.ssh = f.h; c.srOut = f.l; return; }   // rti: SSH -> PC, SSL -> SR
    else if (w === 0x000000) { /* nop */ }
    else if (w === 0x00000c) { next = pop().h; }                                                 // rts
    else if ((w & 0xfff000) === 0x0d0000) { push(pc + 1, SR_IN_HANDLER); next = w & 0xfff; }      // jsr <12-bit>
    else if ((w & 0xffffc0) === 0x08f480) { wr(c, 0xffffc0 | (w & 0x3f), e); two = true; next = pc + 2; }   // movep #,x:pp
    else if ((w & 0xffffe0) === 0x0bb420) { c.cflag = !!((rd(c, 0xffffc0 | ((w >> 8) & 0x3f)) >> (w & 0x1f)) & 1); }  // btst #b,x:pp
    else if (w === 0x000218) {                                                             // brkcs
      if (c.cflag) { const l = loops.pop()!; next = l.la + 1; endLoop(); }
    }
    else if (w === 0x00fcb8) { c.masked = false; if (c.unmaskedAt < 0) c.unmaskedAt = c.cycles; }     // andi #$fc,mr
    else if (w === 0x0003f8) { c.masked = true; c.maskDelay = 15; } // conservative pending-interrupt pipeline
    else if (w === 0x527000) { c.X.set(e, U24(c.a >> 48n) & 0xff); two = true; next = pc + 2; }            // a2 -> x
    else if (w === 0x547000) { c.X.set(e, a1(c)); two = true; next = pc + 2; }
    else if (w === 0x507000) { c.X.set(e, U24(c.a)); two = true; next = pc + 2; }
    else if (w === 0x567000) { c.X.set(e, a1(c)); two = true; next = pc + 2; }       // move a,x (no limiting at these values)
    else if (w === 0x56f000) { loadA(c, rd(c, e)); two = true; next = pc + 2; }
    else if (w === 0x54f000) { setA1(c, rd(c, e)); two = true; next = pc + 2; }
    else if (w === 0x52f000) { setA2(c, rd(c, e)); two = true; next = pc + 2; }
    else if (w === 0x50f000) { setA0(c, rd(c, e)); two = true; next = pc + 2; }
    else if (w === 0x607000) { c.X.set(e, c.r0); two = true; next = pc + 2; }
    else if (w === 0x60f000) { c.r0 = rd(c, e); two = true; next = pc + 2; }
    else if (w === 0x60f400) { c.r0 = e; two = true; next = pc + 2; }
    else if (w === 0x05f420) { c.m0 = e; two = true; next = pc + 2; }
    else if (w === 0x0770a0) { c.P.set(e, c.m0); two = true; next = pc + 2; }
    else if (w === 0x07f0a0) { c.m0 = P(e); two = true; next = pc + 2; }
    else if (w === 0x54f400) { setA1(c, e); two = true; next = pc + 2; }
    else if ((w & 0xffffc0) === 0x084e00) { loadA(c, rd(c, 0xffffc0 | (w & 0x3f))); }            // movep x:pp,a
    else if ((w & 0xffffc0) === 0x084400) { c.x0 = rd(c, 0xffffc0 | (w & 0x3f)); }                // movep x:pp,x0
    else if (w === 0x014180) { c.a += 1n << 24n; flags(c); }                        // add #1,a
    else if ((w & 0xffc0ff) === 0x014080) { c.a += BigInt((w >> 8) & 0x3f) << 24n; flags(c); }            // add #n,a
    else if ((w & 0xffc0ff) === 0x014084) { c.a -= BigInt((w >> 8) & 0x3f) << 24n; flags(c); }            // sub #n,a
    else if ((w & 0xffc0ff) === 0x014085) { cmp(c, BigInt((w >> 8) & 0x3f) << 24n); }           // cmp #n,a
    else if (w === 0x0140c5) { cmp(c, S24(e) << 24n); two = true; next = pc + 2; }   // cmp #>n,a
    else if (w === 0x200045) { cmp(c, S24(c.x0) << 24n); }                // cmp x0,a
    else if (w === 0x200013) { c.a = 0n; }                                // clr a
    else if (w === 0x200003) { flags(c); }                                // tst a
    else if (w === 0x220400) { c.x0 = c.r0; }                             // move r0,x0
    else if (w === 0x07e090) { c.r0 = P(c.r0); }                          // move p:(r0),r0
    else if (w === 0x07f090) { c.r0 = P(e); two = true; next = pc + 2; }              // movem p,r0
    else if ((w & 0xffffc0) === 0x085000) { c.r0 = rd(c, 0xffffc0 | (w & 0x3f)); }                // movep x:pp,r0
    else if ((w & 0xffffc0) === 0x08d000) { wr(c, 0xffffc0 | (w & 0x3f), c.r0); }                // movep r0,x:pp
    else if (w === 0x205800) { c.r0 = (c.r0 + 1) & 0xffffff; }            // move (r0)+
    else if (w === 0x200043) { setA1(c, a1(c) ^ c.x0); }                  // eor x0,a  (A1 only)
    else if (w === 0x040040) { c.r0 = (c.r0 + 4) & 0xffffff; }            // lua (r0+4),r0
    else if (w === 0x21c400) { c.x0 = a1(c); }                            // move a,x0
    else if ((w & 0xff00ff) === 0x300000) { c.r0 = (w >> 8) & 0xff; }     // move #n,r0
    else if (w === 0x044cfc) { setA1(c, pop().h); }                       // move ssh,a1: pop
    else if (w === 0x04ccfc) { c.sp++; c.stk[c.sp] = { h: a1(c), l: c.stk[c.sp]?.l ?? 0 }; }   // move a1,ssh: push, SSL untouched
    else if (w === 0x07f084) { c.x0 = P(e); two = true; next = pc + 2; }              // movem p,x0
    else if (w === 0x077084) { c.P.set(e, c.x0); two = true; next = pc + 2; }         // movem x0,p
    else if (w === 0x07708c) { c.P.set(e, a1(c)); two = true; next = pc + 2; }        // movem a1,p
    else if (w === 0x077090) { c.P.set(e, c.r0); two = true; next = pc + 2; }         // movem r0,p
    else if (w === 0x07f08e) { loadA(c, P(e)); two = true; next = pc + 2; }           // movem p,a
    else if (w === 0x565800) { acc = bank('X', c.r0); c.X.set(c.r0, a1(c)); c.r0 = c.m0 === 0xffffff ? c.r0 + 1 : (c.r0 & ~c.m0) | ((c.r0 + 1) & c.m0); }
    else if (w === 0x5e5800) { acc = bank('Y', c.r0); c.Y.set(c.r0, a1(c)); c.r0++; }                     // move a,y:(r0)+
    else if ((w & 0xff00f0) === 0x060080) {                               // do #n,la
      loops.push({ top: pc + 2, la: e, left: ((w >> 8) & 0xff) | ((w & 0xf) << 8) }); two = true; next = pc + 2;
      push(0, c.lc); c.lc = loops[loops.length - 1].left; push(pc + 2, SR_IN_HANDLER);   // LA:LC, then PC:SR
    } else if ((w & 0xfffc00) === 0x050c00) { next = pc + disp(w); }      // bra
    else if ((w & 0xff0c00) === 0x050400) {                               // bcc
      const cc = (w >> 12) & 0xf;
      const take = cc === 0x1 ? !c.n : cc === 0x2 ? !c.z : cc === 0x9 ? c.n : cc === 0xa ? c.z : (() => { throw new Error(`cc ${cc}`); })();
      if (take) next = pc + disp(w);
    } else if ((w & 0xffc0c0) === 0x0a8080) {                             // jset / jclr #b,x:pp,target
      const pp = 0xffffc0 | ((w >> 8) & 0x3f), bit = w & 0x1f, set = !!(w & 0x20);
      two = true; next = (((rd(c, pp) >> bit) & 1) === 1) === set ? e : pc + 2;
    } else if ((w & 0xffc0c0) === 0x018080) {                             // jset / jclr #b,x:qq,target
      const qq = 0xffff80 | ((w >> 8) & 0x3f), bit = w & 0x1f, set = !!(w & 0x20);
      two = true; next = (((rd(c, qq) >> bit) & 1) === 1) === set ? e : pc + 2;
    } else if ((w & 0xffc0c0) === 0x0ac000) {                             // jset / jclr #b,S,target
      const bit = w & 0x1f, set = !!(w & 0x20);
      two = true; next = (((reg((w >> 8) & 0x3f) >> bit) & 1) === 1) === set ? e : pc + 2;
    } else if (w === 0x0ae080) {                                          // jmp (r0): the shared drain's return
      next = c.r0;
    } else throw new Error(`no interpreter for ${w.toString(16).padStart(6, '0')} at P:${pc.toString(16)}`);
    // X/Y absolute moves: the bank of their operand
    if ([0x527000, 0x547000, 0x507000, 0x567000, 0x56f000, 0x54f000, 0x52f000, 0x50f000, 0x607000, 0x60f000].includes(w)) acc = bank('X', e);
    c.cycles += two ? 2 : 1;
    c.trace.push(acc);
    if (two) c.trace.push(null);
    c.codec?.advance(two ? 2 : 1, c);
    const top = loops[loops.length - 1];
    if (top && pc === top.la && next === pc + 1) {
      if (--top.left > 0) next = top.top; else { loops.pop(); endLoop(); }
    }
    pc = next;
  }
  throw new Error('the handler did not reach its rti');
}

/** The main loop's SR (DSP1's set-up leaves the mask at 0), the handler's, and LC as power-on leaves
 *  it: the DSP56300 does not initialise LC, and nothing in DSP1's loader or upload ever writes it, so
 *  the main loop runs with whatever it came up with (here a value with the IPL-0 mask bit's position
 *  set, as a power-on can). An emulator that starts it at 0 hides the `do`-loop idle's fault. */
const SR_MAIN = 0x000000, SR_IN_HANDLER = 0x000100;
const LC_AT_RESET = 0x5a5b6c;

function cpu(words: number[], at: number): Cpu {
  const P = new Map<number, number>();
  words.forEach((w, k) => P.set(at + k, w));
  const X = new Map<number, number>([[R.SCRATCH, 0], [0x647, 0]]);
  return { P, X, Y: new Map(), a: 0n, x0: 0, r0: 0, ssh: 0, hcr: 0x4, ddr4: 0x600, dcr0: 0, n: false, z: false, cycles: 0, unmaskedAt: -1,
    dcr4: 0x8e52c4, cflag: false, trace: [], masked: true, pcs: [],
    stk: [], sp: 0, lc: LC_AT_RESET, srOut: -1, m0: 0xffffff, maskDelay: 0 };
}

/** One DMA0 interrupt: returns where the main loop resumes. */
function irq(c: Cpu, at: number, pc: number, checkSr = true): number {
  c.sp = 1; c.stk[1] = { h: pc, l: SR_MAIN };  // the interrupt's frame
  const regs = { a: c.a, x0: c.x0, r0: c.r0 };
  c.unmaskedAt = -1;
  c.masked = true;                   // a long interrupt masks its own level
  const start = c.cycles;
  run(c, at);
  c.masked = false;                  // the rti gives the main loop its SR back (mask 0, P:$2d)
  if (c.unmaskedAt >= 0) c.unmaskedAt -= start;
  c.lastCost = c.cycles - start;
  assert.equal(c.a, regs.a, 'A restored');
  assert.equal(c.x0, regs.x0, 'X0 restored');
  assert.equal(c.r0, regs.r0, 'R0 restored');
  assert.equal(c.sp, 0, 'the system stack back where the interrupt found it');
  if (checkSr) assert.equal(c.srOut, SR_MAIN, `the rti hands the main loop back its own SR (got $${c.srOut.toString(16)})`);
  return c.ssh;
}

test('ordered: nested long interrupts cannot replace SSL while a frame is popped', () => {
  const old=R.handler(R.handlerAt(),0);
  const bad=cpu(old.words,old.at);bad.X.set(0x647,1);bad.ddr4=0x7ff;
  for(let k=0;k<3;k++)irq(bad,old.at,0x75);
  bad.injectAt=old.resync+2; // first instruction after SSH was popped
  irq(bad,old.at,0x75,false);
  assert.equal(bad.srOut,SR_IN_HANDLER,'control reproduces the unprotected SSL overwrite');
  const h=R.handler(R.handlerAt(false,R.VARIANTS.ordered),0,false,R.VARIANTS.ordered);
  // Every eligible instruction in both guard paths and the long resync interval.
  for(const path of ['miss','heal'] as const) for(let site=h.at;site<h.at+h.words.length;site++){  // the shared drain too
    const c=cpu(h.words,h.at);c.X.set(0x647,1);c.ddr4=0x7ff;
    for(let k=0;k<3;k++)irq(c,h.at,0x75);
    if(path==='heal')c.X.set(0x647,0);
    c.injectAt=site;
    assert.equal(irq(c,h.at,0x75),path==='heal'?0x75:0x2e);
  }
});

test('ordered: interrupted modulo addressing cannot truncate the mute, and M0 survives every exit',()=>{
  for(const name of ['v10','ordered']){
    const h=R.handler(R.handlerAt(false,R.VARIANTS[name]),0,false,R.VARIANTS[name]);
    const c=cpu(h.words,h.at);c.m0=31;c.r0=0x123;c.a=0x123456789abcn;
    for(let a=0x400;a<0x580;a++)c.X.set(a,0x123456);
    c.X.set(0x647,1);irq(c,h.at,0x3c);
    const remaining=Array.from({length:384},(_,k)=>c.X.get(0x400+k)).filter(v=>v!==0).length;
    assert.equal(remaining,name==='v10'?352:0);
    assert.equal(c.m0,31);
    if(name==='ordered'){
      for(const pc of [0x3c,0x75,0x288]){
        for(let k=0;k<5;k++){c.X.set(0x647,1);irq(c,h.at,pc);assert.equal(c.m0,31);}
        for(let k=0;k<9;k++){c.X.set(0x647,0);irq(c,h.at,pc);assert.equal(c.m0,31);}
      }
    }
  }
});
