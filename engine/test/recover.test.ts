// --dsp1-recover: the handler's words, executed, and the DSP1 <-> DSP2 link they act on.
//
// Three layers, all on the exact words recover.ts emits (no firmware files needed):
//
//  1. An interpreter for the ~30 DSP56300 encodings the handler uses runs it the way DSP1's DMA0
//     interrupt does: return address on the system stack, the registers it saves and restores, the
//     X/Y/P words and the I/O registers it touches (HCR, DDR4, DCR4, DSTR; with a codec model ESSI1
//     and the codec DMAs).
//  2. A model of the audio path's block protocol, built from the base's own code: DSP1's main loop
//     (P:$3c half wait, the per-track wait P:$73..$79, P:$270's re-arm-and-toggle at slot 15,
//     P:$294 and the X:$647 clear), DSP2's block loop (a track rendered, its 32-word ESSI0 send, the
//     end-of-block spin P:$bb..$bf on the PDRC level after track 0), and a serial wire on which a
//     word reaching ESSI0's receiver with DMA4 unarmed is held in RX (RDF) or lost (overrun), as
//     on the DSP56303. The handler is run by the interpreter on every DMA0 interrupt. What is
//     measured is which word of DSP2's stream lands in each of DSP1's sixteen 32-word mixer slots.
//
//  3. A model of the codec link as DSP1's power-on sets it up (P:$100080..$1000d4): ESSI1
//     delivering a word every time slot, two slots a frame, RFS set on the first; DMA0 taking one
//     word per request into X:$100..$17f, 128 a block, DE cleared at the block end and re-armed by
//     the handler; DMA1 sending one 3-word line per request out of X:$400..$57f in its 3D mode, DE
//     cleared every 16 passes and re-armed by its fast interrupt P:$1a. The handler runs on every
//     DMA0 block end, with the codec advancing under it cycle by cycle, so its snapshot and its
//     realign meet real word arrivals. What is measured is the alignment power-on establishes and
//     the main loop depends on: DSR1 at every DMA0 block end, and the slot of the word it ended on.
//
// Three earlier handler revisions are kept as word-for-word fixtures, so the models can show the
// failure each one has: v3 resyncs on the first missed frame, v4 also zeroes the voice feed back to
// back, and v5 idles DMA4 with a `do` loop between the stack pop and push.

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
  x0: number; r0: number;
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
  codec?: Codec;
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
    else if (w === 0x0003f8) { c.masked = true; }                                                     // ori #$3,mr
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
    else if (w === 0x565800) { acc = bank('X', c.r0); c.X.set(c.r0, a1(c)); c.r0++; }                     // move a,x:(r0)+
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
    stk: [], sp: 0, lc: LC_AT_RESET, srOut: -1 };
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

const CUR = R.handler(R.HANDLER_AT, 0);   // the current default handler

// The v3 handler word for word: 81 words at P:$baf.
const V3_AT = 0xbaf;
const V3 = [
  0x527000, 0x000646, 0x547000, 0x000645, 0x507000, 0x000644, 0x08f4ac, 0xc861c0, 0x56f000, 0x000647,
  0x014180, 0x014285, 0x05141a, 0x0a82a4, 0x000bc7, 0x567000, 0x000647, 0x54f000, 0x000645, 0x52f000,
  0x000646, 0x50f000, 0x000644, 0x000004, 0x607000, 0x000642, 0x60f400, 0x000400, 0x200013, 0x068081,
  0x000bce, 0x565800, 0x014180, 0x60f000, 0x000642, 0x08f482, 0x00000c, 0x050fca, 0x08f482, 0x00001c,
  0x607000, 0x000642, 0x60f400, 0x000400, 0x200013, 0x068081, 0x000bde, 0x565800, 0x60f400, 0x000600,
  0x060082, 0x000be3, 0x5e5800, 0x044cfc, 0x0140c5, 0x000073, 0x059406, 0x0140c5, 0x00007a, 0x051403,
  0x54f400, 0x00002e, 0x04ccfc, 0x56f000, 0x000647, 0x014180, 0x014385, 0x059403, 0x200013, 0x014380,
  0x567000, 0x000647, 0x60f000, 0x000642, 0x54f000, 0x000645, 0x52f000, 0x000646, 0x50f000, 0x000644,
  0x000004,
];
const v3Words = (): number[] => V3;
// The v4 handler word for word: 115 words at P:$b8d (it zeroes the feed too).
const V4_AT = 0xb8d;
const V4W = [
  0x527000, 0x000646, 0x547000, 0x000645, 0x507000, 0x000644, 0x08f4ac, 0xc861c0, 0x56f000, 0x000647,
  0x014180, 0x014285, 0x05141f, 0x0a82a4, 0x000ba5, 0x567000, 0x000647, 0x54f000, 0x000645, 0x52f000,
  0x000646, 0x50f000, 0x000644, 0x000004, 0x00fcb8, 0x607000, 0x000642, 0x60f400, 0x000400, 0x200013,
  0x068081, 0x000bad, 0x565800, 0x07708c, 0x000bfd, 0x07708c, 0x000bfe, 0x014180, 0x60f000, 0x000642,
  0x08f482, 0x00000c, 0x050fc5, 0x00fcb8, 0x08f482, 0x00001c, 0x607000, 0x000642, 0x60f400, 0x000400,
  0x200013, 0x068081, 0x000bc2, 0x565800, 0x60f400, 0x000600, 0x060082, 0x000bc7, 0x5e5800, 0x077084,
  0x000bff, 0x07f084, 0x000bfd, 0x084e1e, 0x07708c, 0x000bfd, 0x200045, 0x07f08e, 0x000bfe, 0x05a403,
  0x200013, 0x050c06, 0x014180, 0x014385, 0x059403, 0x200013, 0x014380, 0x07708c, 0x000bfe, 0x07f084,
  0x000bff, 0x014385, 0x05940c, 0x200013, 0x044cfc, 0x0140c5, 0x000073, 0x059406, 0x0140c5, 0x00007a,
  0x051403, 0x54f400, 0x00002e, 0x04ccfc, 0x56f000, 0x000647, 0x014180, 0x014385, 0x059403, 0x200013,
  0x014380, 0x567000, 0x000647, 0x60f000, 0x000642, 0x54f000, 0x000645, 0x52f000, 0x000646, 0x50f000,
  0x000644, 0x000004, 0x000000, 0x000000, 0x000000,
];

// The v5 handler word for word: 132 words at P:$b7c.
const V5W_AT = 0xb7c;
const V5W = [
  0x527000, 0x000646, 0x547000, 0x000645, 0x507000, 0x000644, 0x08f4ac, 0xc861c0, 0x56f000, 0x000647,
  0x014180, 0x014285, 0x05144b, 0x0a82a4, 0x000b94, 0x567000, 0x000647, 0x54f000, 0x000645, 0x52f000,
  0x000646, 0x50f000, 0x000644, 0x000004, 0x00fcb8, 0x607000, 0x000642, 0x07f08e, 0x000bff, 0x014180,
  0x07708c, 0x000bff, 0x014185, 0x05240d, 0x60f400, 0x000400, 0x200013, 0x068081, 0x000ba4, 0x565800,
  0x000000, 0x07708c, 0x000bfc, 0x07708c, 0x000bfd, 0x014180, 0x014885, 0x059403, 0x08f482, 0x00000c,
  0x200013, 0x014180, 0x60f000, 0x000642, 0x050f99, 0x00fcb8, 0x08f482, 0x00001c, 0x607000, 0x000642,
  0x60f400, 0x000400, 0x200013, 0x07708c, 0x000bff, 0x068081, 0x000bc0, 0x565800, 0x000000, 0x077084,
  0x000bfe, 0x07f084, 0x000bfc, 0x084e1e, 0x07708c, 0x000bfc, 0x200045, 0x07f08e, 0x000bfd, 0x05a403,
  0x200013, 0x050c06, 0x014180, 0x014385, 0x059403, 0x200013, 0x014380, 0x07708c, 0x000bfd, 0x07f084,
  0x000bfe, 0x014385, 0x059412, 0x200013, 0x044cfc, 0x0140c5, 0x000073, 0x05940c, 0x0140c5, 0x00007a,
  0x051409, 0x08f49c, 0x0e52c4, 0x060081, 0x000be6, 0x0bb424, 0x000218, 0x54f400, 0x00002e, 0x04ccfc,
  0x56f000, 0x000647, 0x014180, 0x014385, 0x059403, 0x200013, 0x014380, 0x567000, 0x000647, 0x60f000,
  0x000642, 0x54f000, 0x000645, 0x52f000, 0x000646, 0x50f000, 0x000644, 0x000004, 0x000000, 0x000000,
  0x000000, 0x000000,
];
/** The longest run of consecutive cycles in which the handler holds one of the banks a DMA needs:
 *  X:$100..$1ff (DMA0, the codec input), X:$400..$5ff (DMA1, the codec output), X:$600..$6ff
 *  (DMA2's source X:$688), Y:$600..$7ff (DMA4, the DSP2 voice feed). */
const DMA_BANKS = new Set(['X1', 'X4', 'X5', 'X6', 'Y6', 'Y7']);
function longestHold(trace: (string | null)[]): number {
  let best = 0, run = 0, prev: string | null = null;
  for (const b of trace) {
    if (b !== null && DMA_BANKS.has(b) && b === prev) run++; else run = b !== null && DMA_BANKS.has(b) ? 1 : 0;
    prev = b; best = Math.max(best, run);
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// the handler on its own

test('recover: a healthy entry stores 1, touches nothing else, resumes where it was', () => {
  const c = cpu(CUR.words, CUR.at);
  c.X.set(0x400, 0x123456);
  assert.equal(irq(c, CUR.at, 0x75), 0x75);
  assert.equal(c.X.get(0x647), 1);
  assert.equal(c.hcr, 0x4);
  assert.equal(c.X.get(0x400), 0x123456);
  assert.equal(c.dcr0, 0xc861c0, 'DMA0 re-armed with the base constant');
});

test('recover: a late DSP2 that is still sending is muted but never resynced', () => {
  const c = cpu(CUR.words, CUR.at);
  c.X.set(0x647, 1);
  for (let k = 0; k < 40; k++) {
    c.ddr4 = 0x600 + ((k * 7) % 0x200);                   // words keep arriving
    c.X.set(0x400 + k, 0x7fffff); c.Y.set(0x600 + k, 0x7fffff);
    assert.equal(irq(c, CUR.at, 0x75), 0x75, `entry ${k}: the stack is left alone`);
    assert.equal(c.hcr, 0x1c);
    assert.equal(c.X.get(0x400 + k), 0, 'the output buffer is silenced');
    assert.equal(c.Y.get(0x600 + k), 0x7fffff, 'the DSP2 voice feed is never written (DMA4 lands in it)');
    assert.ok((c.X.get(0x647) ?? 0) <= 3);
  }
});

test('recover: a parked DSP2 (DDR4 frozen) is resynced on the 4th missed frame, not before', () => {
  for (const pc of [0x73, 0x75, 0x77, 0x79]) {
    const c = cpu(CUR.words, CUR.at);
    c.X.set(0x647, 1);
    c.ddr4 = 0x6e0;
    const got = [0, 1, 2, 3, 4].map(() => irq(c, CUR.at, pc));
    assert.deepEqual(got, [pc, pc, pc, 0x2e, 0x2e], `interrupted at P:${pc.toString(16)}`);
  }
});

test('recover: outside the per-track wait the return address is never changed', () => {
  for (const pc of [0x3c, 0x43, 0x72, 0x7a, 0x100, 0x294]) {
    const c = cpu(CUR.words, CUR.at);
    c.X.set(0x647, 1);
    c.ddr4 = 0x6e0;
    for (let k = 0; k < 10; k++) assert.equal(irq(c, CUR.at, pc), pc);
  }
});

test('recover: one word from DSP2 restarts the silent count; the heal forgets it', () => {
  const c = cpu(CUR.words, CUR.at);
  c.X.set(0x647, 1);
  c.ddr4 = 0x6e0;
  irq(c, CUR.at, 0x75); irq(c, CUR.at, 0x75); irq(c, CUR.at, 0x75);   // sample + two silent periods
  c.ddr4 = 0x6e1;                                                    // one word
  assert.equal(irq(c, CUR.at, 0x75), 0x75);
  assert.equal(irq(c, CUR.at, 0x75), 0x75);
  assert.equal(irq(c, CUR.at, 0x75), 0x75);
  // a pass completes (the main loop clears X:$647), the next entry heals
  c.X.set(0x647, 0);
  assert.equal(irq(c, CUR.at, 0x75), 0x75);
  assert.equal(c.hcr, 0x1c, 'HF3 held');
  // a new episode on the very same DDR4 value needs its own full silent run
  c.X.set(0x647, 1);
  assert.deepEqual([0, 1, 2, 3].map(() => irq(c, CUR.at, 0x75)), [0x75, 0x75, 0x75, 0x2e]);
});

test('recover: HF3 comes down only on the 8th consecutive healthy entry; a miss in between restarts the hold', () => {
  assert.equal(R.HF3_HOLD, 8);
  const c = cpu(CUR.words, CUR.at);
  const healthy = (): number => { c.X.set(0x647, 0); irq(c, CUR.at, 0x3c); return c.hcr; };
  const late = (): number => { c.X.set(0x647, 1); irq(c, CUR.at, 0x3c); return c.hcr; };
  assert.equal(healthy(), 0x04, 'never overrun: HCR as DSP1 set it up');
  assert.equal(late(), 0x1c);
  c.X.set(0x400, 0x123456);
  assert.equal(healthy(), 0x1c);
  assert.equal(c.X.get(0x400), 0, 'the first healthy entry clears the output buffer');
  c.X.set(0x400, 0x123456);
  assert.deepEqual([2, 3, 4, 5].map(healthy), [0x1c, 0x1c, 0x1c, 0x1c]);
  assert.equal(c.X.get(0x400), 0x123456, 'the output buffer is cleared on the first healthy entry only');
  assert.equal(late(), 0x1c, 'a miss inside the hold');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(healthy), [0x1c, 0x1c, 0x1c, 0x1c, 0x1c, 0x1c, 0x1c, 0x0c, 0x0c],
    'HF3 off on the 8th consecutive healthy entry, HF2 kept');
  assert.equal(c.X.get(0x647), 1, 'the counter the main loop clears, as the stock tail stores it');
});

test('recover: the long paths open the interrupt mask before their work; the healthy one is the stock length', () => {
  const c = cpu(CUR.words, CUR.at);
  irq(c, CUR.at, 0x75);
  assert.equal(c.unmaskedAt, -1, 'healthy: no unmask needed');
  assert.ok(c.lastCost! <= 30, `healthy entry ${c.lastCost} cycles`);
  c.X.set(0x647, 1);
  irq(c, CUR.at, 0x75);                                   // missed frame
  assert.ok(c.unmaskedAt >= 0 && c.unmaskedAt <= 24, `mute path unmasks ${c.unmaskedAt} cycles in`);
  assert.ok(c.lastCost! > 800, `the mute path is ${c.lastCost} cycles long`);
  c.X.set(0x647, 0);
  irq(c, CUR.at, 0x75);                                   // heal
  assert.equal(c.hcr, 0x1c);
  assert.ok(c.unmaskedAt >= 0 && c.unmaskedAt <= 24, `heal path unmasks ${c.unmaskedAt} cycles in`);
});

test('recover: no DMA ever waits on the handler for more than one cycle; v3 and v4 hold DMA4 512 and DMA1 384', () => {
  for (const [words, at, name] of [[CUR.words, CUR.at, 'current'], [V5W, V5W_AT, 'v5'], [V4W, V4_AT, 'v4'], [V3, V3_AT, 'v3']] as const) {
    const c = cpu([...words], at);
    c.X.set(0x647, 1);
    c.trace = []; irq(c, at, 0x3c);                        // a missed frame
    const miss = longestHold(c.trace);
    c.X.set(0x647, 0);
    c.trace = []; irq(c, at, 0x3c);                        // the heal
    const heal = longestHold(c.trace);
    if (name === 'current' || name === 'v5') { assert.ok(miss <= 1 && heal <= 1, `${name} holds a DMA bank ${miss} / ${heal} cycles`); }
    else { assert.ok(miss >= 256, `${name} holds a DMA bank ${miss} cycles running on a missed frame`); }
  }
});

test('recover: the resync idles DMA4 (DE off, DTD4 polled) before it hands the stack P:$2e', () => {
  const c = cpu(CUR.words, CUR.at);
  c.X.set(0x647, 1);
  c.ddr4 = 0x6e0;
  assert.deepEqual([0, 1, 2].map(() => irq(c, CUR.at, 0x75)), [0x75, 0x75, 0x75]);
  assert.equal(c.dcr4, 0x8e52c4, 'DMA4 untouched while not resyncing');
  assert.equal(irq(c, CUR.at, 0x75), 0x2e);
  assert.equal(c.dcr4, 0x0e52c4, 'DE cleared, every other DCR4 bit as P:$270 armed it');
});

test('recover v3 resyncs on the first missed frame, whatever DSP2 is doing', () => {
  const w = v3Words();
  assert.equal(w.length, 81, 'the 81 words at P:$baf');
  const c = cpu(w, V3_AT);
  c.X.set(0x647, 1);
  c.ddr4 = 0x6e0;
  assert.equal(irq(c, V3_AT, 0x75), 0x2e);
});

// ---------------------------------------------------------------------------------------------
// 2. the link

/** DSP cycles */
const FRAME = 2304;                  // one codec frame
const DMA0_PERIOD = 64 * FRAME;      // DMA0 takes 128 words = 64 stereo frames per interrupt
const HALF = 32 * FRAME;
const WORD = 96;                     // one 24-bit ESSI0 word on the DSP2 -> DSP1 wire (SCK = Fcore / 4)
// P:$270 from its entry to the PDRC toggle (the 64-word copy loop and the DMA2 set-up come first),
// and to the DMA4 re-arm four instructions later. Between the 512th word (DMA4 done, DE cleared) and
// the re-arm, ESSI0's receiver has no DMA behind it.
const TO_TOGGLE = 230, TO_ARM = 240;
// DSP2 from the level change to its first word on the wire: the spin's exit, P:$c0..$d3, one word.
const D2_REACT = 40;
const SLOT_WORK = 1500;              // DSP1's work per mixer slot
const POST = 12000;                  // P:$294.. to the X:$647 clear
const STEP = 16;

interface Episode { at: number; until: number; extra: number; track: number }
interface Race { at: number; delay: number; done?: boolean }

interface LinkResult {
  passes: { t: number; words: (number | null)[] }[];
  resyncs: number[];
  deadlocked: boolean;
  misses: number; missAt: Record<string, number>;
  log: string[];
  /** every DMA4 re-arm: where it came from, and how many words of its current block DSP2 had sent */
  rearms: { t: number; from: string; sent: number }[];
  /** DSP2 words lost to ESSI0 receiver overrun */
  lost: number;
}

/**
 * Word identity on the wire: block * 512 + track * 32 + sample. DSP2 renders its sixteen tracks
 * in order, each in `render(block, track)` cycles; after track 0 it spins until the PDRC level
 * differs from the one it saved (P:$bb..$bf); each track is sent as 32 words, one per WORD cycles,
 * after the previous send completes (P:$cf).
 */
function link(handlerWords: number[] | null, at: number, opts: {
  seconds: number; episodes?: Episode[]; races?: Race[]; baseRender?: number;
  /** a v3-style re-arm, forced: at the first moment after `at` when DSP1 waits and DSP2 has put exactly
   *  `words` words of its current block on the wire, run P:$270 and go on from P:$294 */
  rebase?: { at: number; words: number }[];
}): LinkResult {
  const baseRender = opts.baseRender ?? 3437;     // the OS's silence stub: a track with nothing to play
  const races = (opts.races ?? []).map((r) => ({ ...r }));
  const render = (t: number, track: number): number => {
    let r = baseRender;
    for (const e of opts.episodes ?? []) if (t >= e.at && t < e.until && (e.track < 0 || track === e.track)) r += e.extra;
    return r;
  };
  const c = handlerWords ? cpu(handlerWords, at) : null;
  // --- DSP1's DMA4 + ESSI0 receiver
  const Y = new Array<number | null>(512).fill(null);
  let ddr4 = 0x600, dma4On = false, rdf: number | null = null;
  const arm4 = (): void => {
    ddr4 = 0x600; dma4On = true;
    if (rdf !== null) { Y[0] = rdf; ddr4++; rdf = null; }   // an armed DMA takes a held word at once
  };
  // The core wins a bank it shares with a DMA (DSP56300FM ch. 10): while the handler is holding
  // DDR4's bank, DMA4's word waits in RX; a second word arriving meanwhile is lost to overrun.
  let hStart = -1, hTrace: (string | null)[] = [];
  let pend = null as { word: number; at: number } | null;
  const freeAt = (t: number): number => {
    const b = `Y${ddr4 >> 8}`;
    let k = t - hStart;
    while (k >= 0 && k < hTrace.length && hTrace[k] === b) k++;
    return hStart + Math.max(k, t - hStart);
  };
  const land = (word: number, t: number): void => {
    if (dma4On && pend) { res.lost++; return; }
    if (dma4On && hStart >= 0 && freeAt(t) > t) { pend = { word, at: freeAt(t) }; return; }
    if (dma4On) {
      Y[ddr4 - 0x600] = word; ddr4++;
      if (ddr4 === 0x800) dma4On = false;                     // DTM 001: DE cleared at the end of the block
    } else if (rdf === null) rdf = word;                      // RDF: held in RX
    // else: receiver overrun, the word is gone
  };
  // --- DSP2
  let pdrc = 0, saved = 0;
  let d2Block = 0, d2Track = 0, d2State: 'render' | 'spin' | 'sendwait' = 'render', d2Busy = baseRender;
  let txQueue: number[] = [];
  let txNext = 0;
  // --- DSP1
  type S1 = 'half' | 'wait' | 'slot' | 'post' | 'restart' | 'setup';
  let s1: S1 = 'half', busy = 0, slot = 0, x647 = 0;
  let passWords: (number | null)[] = [];
  let pendingArm = -1, armFrom = '';
  const res: LinkResult = { passes: [], resyncs: [], deadlocked: false, misses: 0, missAt: {}, log: [], rearms: [], lost: 0 };
  // P:$270, entered at t: RX0 read and PDRC toggle at t + TO_TOGGLE, DMA4 re-armed at t + TO_ARM
  // (or later, when an interrupt lands between the two).
  let pendingToggle = -1;
  const call270 = (t: number, extraDelay: number): void => {
    armFrom = s1;
    pendingToggle = t + TO_TOGGLE;
    pendingArm = t + TO_ARM + extraDelay;
  };
  let lastIrq = 0, lastProgress = 0, lastDdr4 = -1;
  const end = opts.seconds * 44100 * FRAME;
  // power-on: DSP1 waits for DDR0 = $139, jsr $270, jmp $294
  call270(0, 0);
  s1 = 'post'; busy = POST;
  let d2SeenAt = -1, lastSent = -1;
  const rebase = (opts.rebase ?? []).map((r) => ({ ...r, done: false }));
  for (let t = 0; t < end; t += STEP) {
    // ---- DSP2
    if (d2State === 'render') {
      d2Busy -= STEP;
      if (d2Busy <= 0) {
        if (d2Track === 0) d2State = 'spin';
        else d2State = 'sendwait';
      }
    }
    if (d2State === 'spin' && pdrc !== saved) { saved = pdrc; d2State = 'sendwait'; d2SeenAt = t; }
    if (d2State === 'sendwait' && txQueue.length === 0 && t >= d2SeenAt + D2_REACT) {
      for (let n = 0; n < 32; n++) txQueue.push(d2Block * 512 + d2Track * 32 + n);
      txNext = t + WORD;
      d2Track++;
      if (d2Track === 16) { d2Track = 0; d2Block++; }
      d2State = 'render'; d2Busy = render(t, d2Track);
    }
    if (pend && t >= pend.at) {
      const pw = pend.word; pend = null;
      Y[ddr4 - 0x600] = pw; ddr4++; if (ddr4 === 0x800) dma4On = false;
    }
    if (txQueue.length && t >= txNext) { const wd = txQueue.shift()!; land(wd, t); lastSent = wd; txNext = t + WORD; }
    // ---- a DMA4 re-arm that an interrupt inside P:$270 delayed
    if (pendingToggle >= 0 && t >= pendingToggle) { rdf = null; pdrc ^= 1; pendingToggle = -1; }
    if (pendingArm >= 0 && t >= pendingArm) {
      res.rearms.push({ t, from: armFrom, sent: (lastSent + 1) % 512 + (txQueue.length ? 512 : 0) });
      arm4(); pendingArm = -1;
    }
    // ---- DSP1's DMA0 interrupt
    if (t - lastIrq >= DMA0_PERIOD) {
      lastIrq = t;
      if (c) {
        c.ddr4 = ddr4; c.X.set(0x647, x647);
        const pc = s1 === 'wait' ? 0x75 : s1 === 'half' ? 0x3c : s1 === 'restart' ? 0x36 : 0x100;
        const before = c.cycles;
        c.Y.clear(); c.trace = [];
        const back = irq(c, at, pc);
        hStart = t; hTrace = c.trace;
        x647 = c.X.get(0x647)!;
        if (c.hcr & 0x10) { res.misses++; res.missAt[s1] = (res.missAt[s1] ?? 0) + 1; }
        for (const k of c.Y.keys()) if (k >= 0x600 && k < 0x800) Y[k - 0x600] = null;   // what the handler zeroed
        busy += c.cycles - before;
        if (back === 0x2e) { s1 = 'restart'; busy = 0; res.resyncs.push(t); passWords = []; }
      } else {
        x647++;                                                          // no handler: nothing acts
      }
    }
    // ---- a forced v3-style re-arm
    for (const rb of rebase) {
      if (!rb.done && t >= rb.at && pendingArm < 0 && pendingToggle < 0 && lastSent >= 0 && (lastSent + 1) % 512 === rb.words) {
        rb.done = true;
        res.resyncs.push(t);
        call270(t, 0); s1 = 'post'; busy = POST + TO_ARM; passWords = [];
      }
    }
    // ---- DSP1
    if (busy > 0) { busy -= STEP; continue; }
    const ddr0 = 0x100 + Math.floor((t % DMA0_PERIOD) / (FRAME / 2));
    switch (s1) {
      case 'half':
        if (ddr0 === 0x13f || ddr0 === 0x17f) { s1 = 'setup'; busy = 400; slot = 0; passWords = []; }
        break;
      case 'setup': s1 = 'wait'; break;
      case 'wait':
        if (ddr4 - (0x600 + 32 * slot) >= 0x20) {
          const race = races.find((r) => t >= r.at && t < r.at + HALF && !r.done);
          let work = SLOT_WORK;
          if (slot === 15) {
            if (race) race.done = true;
            call270(t, race ? race.delay : 0);
            work += TO_ARM;
          }
          for (let n = 0; n < 32; n++) passWords.push(Y[32 * slot + n]);
          s1 = 'slot'; busy = work;
        }
        break;
      case 'slot':
        slot++;
        if (slot === 16) { res.passes.push({ t, words: passWords }); s1 = 'post'; busy = POST; }
        else s1 = 'wait';
        break;
      case 'post': x647 = 0; s1 = 'half'; break;
      case 'restart':
        if (ddr0 === 0x139) { call270(t, 0); s1 = 'post'; busy = POST + TO_ARM; }
        break;
    }
    if (ddr4 !== lastDdr4) { lastDdr4 = ddr4; lastProgress = t; }
  }
  res.deadlocked = end - lastProgress > 4 * DMA0_PERIOD;
  return res;
}

/** The offset of DSP2's stream in DSP1's slots, for every pass whose feed was not muted. */
function offsets(r: LinkResult): { t: number; s: number; aligned: boolean }[] {
  const out: { t: number; s: number; aligned: boolean }[] = [];
  for (const p of r.passes) {
    if (p.words.some((w) => w === null)) continue;
    const w = p.words as number[];
    const s = ((w[0] % 512) + 512) % 512;
    // aligned: slot i holds track i of ONE block, samples 0..31 in order
    const b = Math.floor(w[0] / 512);
    const aligned = w.every((v, k) => v === b * 512 + k);
    out.push({ t: p.t, s, aligned });
  }
  return out;
}

const SEC = 44100 * FRAME;
// DSP2 renders slower for a while: `extra` cycles more per track (track -1: every track), from `at`
// to `until`. 16 x 3437 cycles is the idle block (the OS's silence stub); 73,728 is the block
// period and 147,456 the DMA0 period, so these run from a mild overrun to three times the budget,
// sustained or as one stuck track.
const overloads: Episode[][] = [
  [{ at: 0.20 * SEC, until: 0.23 * SEC, extra: 7000, track: -1 }],
  [{ at: 0.20 * SEC, until: 0.26 * SEC, extra: 12000, track: -1 }],
  [{ at: 0.20 * SEC, until: 0.24 * SEC, extra: 160000, track: 9 },
   { at: 0.40 * SEC, until: 0.47 * SEC, extra: 9000, track: -1 },
   { at: 0.60 * SEC, until: 0.61 * SEC, extra: 200000, track: 13 }],
  [{ at: 0.15 * SEC, until: 0.35 * SEC, extra: 8000, track: -1 },
   { at: 0.50 * SEC, until: 0.52 * SEC, extra: 250000, track: 3 },
   { at: 0.62 * SEC, until: 0.66 * SEC, extra: 30000, track: -1 }],
];

test('link model: a clean run stays in lock, and the firmware only ever re-arms DMA4 with DSP2 parked', () => {
  for (const w of [null, CUR.words]) {
    const r = link(w, CUR.at, { seconds: 0.5 });
    const o = offsets(r);
    assert.ok(o.length > 600, `${o.length} passes`);
    assert.ok(o.every((p) => p.aligned && p.s === 0));
    assert.equal(r.resyncs.length, 0);
    assert.ok(r.rearms.length > 600 && r.rearms.every((a) => a.sent === 0), 'P:$270 always finds DSP2 on its block boundary');
  }
});

test('link model: v3 re-arms DMA4 in the middle of a late DSP2 block, and the slots come out spliced', () => {
  let midBlock = 0, spliced = 0;
  for (const ep of overloads) {
    const r = link(V3, V3_AT, { seconds: 0.9, episodes: ep });
    const mid = r.rearms.filter((a) => a.from === 'restart' && a.sent !== 0);
    midBlock += mid.length;
    spliced += offsets(r).filter((p) => !p.aligned).length;
    if (process.env.RECOVER_DEBUG) console.log('v3', r.resyncs.length, mid.map((a) => a.sent));
  }
  assert.ok(midBlock >= 3, `${midBlock} re-arms part-way into DSP2's block`);
  assert.ok(spliced > 0, 'passes whose sixteen slots straddle two tracks');
  // and the same splice, forced at one chosen word of DSP2's block, one boot at a time
  for (const words of [5, 40, 100, 300, 450]) {
    const r = link(CUR.words, CUR.at, { seconds: 0.4, rebase: [{ at: 0.2 * SEC, words }] });
    const after = offsets(r).filter((p) => p.t > r.resyncs[0]);
    // (a word or two more: the ones that reach ESSI0 while P:$270 is still on its way to the re-arm)
    assert.ok(after[0].s >= words && after[0].s <= words + 4, `a re-arm at word ${words}: the next pass starts at ${after[0].s}`);
    assert.ok(!after[0].aligned);
  }
});

test("link model: the handler never re-arms DMA4 off DSP2's block boundary, and every pass after an overload is exact", () => {
  for (const ep of overloads) {
    for (const phase of [0, 0.013, 0.029, 0.041]) {
      const shifted = ep.map((e) => ({ ...e, at: e.at + phase * SEC, until: e.until + phase * SEC }));
      const r = link(CUR.words, CUR.at, { seconds: 0.9, episodes: shifted });
      assert.ok(r.misses > 0 || ep === overloads[0], 'the overload is late enough to miss frames');
      assert.ok(r.rearms.every((a) => a.sent === 0), 'DMA4 only ever re-armed with DSP2 parked');
      assert.equal(r.resyncs.length, 0, 'a DSP2 that is only late is never resynced');
      assert.ok(!r.deadlocked);
      const o = offsets(r);
      assert.ok(o.every((p) => p.aligned && p.s === 0), 'every unmuted pass: slot i = track i, samples 0..31');
      const lastEnd = Math.max(...shifted.map((e) => e.until));
      const tail = r.passes.filter((p) => p.t > lastEnd + 0.02 * SEC);
      assert.ok(tail.length > 50 && tail.every((p) => p.words.every((w) => w !== null)), 'and unmuted again');
      // consecutive passes take consecutive blocks: nothing skipped, nothing repeated
      for (let k = 1; k < tail.length; k++) assert.equal((tail[k].words[0] as number) - (tail[k - 1].words[0] as number), 512);
    }
  }
});

test('link model: lost words deadlock the base; the handler resyncs only with DSP2 parked and lands in lock', () => {
  // an interrupt inside P:$270, between the PDRC toggle and the DMA4 re-arm, delays the re-arm
  // past DSP2's first words: they are lost to the receiver overrun and DMA4 never reaches $800
  const races = [{ at: 0.2 * SEC, delay: 2500 }, { at: 0.45 * SEC, delay: 2500 }];
  const none = link(null, 0, { seconds: 0.6, races });
  assert.ok(none.deadlocked, 'with no resync the link never recovers from lost words');
  const r = link(CUR.words, CUR.at, { seconds: 0.9, races });
  assert.equal(r.resyncs.length, 2, 'one resync per deadlock');
  assert.ok(r.rearms.filter((a) => a.from === 'restart').every((a) => a.sent === 0), 'with DSP2 parked');
  assert.ok(!r.deadlocked);
  const o = offsets(r).filter((p) => p.t > 0.5 * SEC);
  assert.ok(o.length > 100 && o.every((p) => p.aligned && p.s === 0));
});

test('link model: v4 loses DSP2 words to its own feed clear on a missed frame, and resyncs to recover; the current handler (like v5) loses none', () => {
  let lost4 = 0, resync4 = 0;
  for (const ep of overloads) {
    const r4 = link(V4W, V4_AT, { seconds: 0.9, episodes: ep });
    lost4 += r4.lost; resync4 += r4.resyncs.length;
    const r5 = link(CUR.words, CUR.at, { seconds: 0.9, episodes: ep });
    assert.equal(r5.lost, 0, 'no word of DSP2 is ever lost to the handler');
    assert.equal(r5.resyncs.length, 0);
    assert.ok(offsets(r5).every((p) => p.aligned && p.s === 0));
  }
  assert.ok(lost4 > 0 && resync4 > 0, `v4: ${lost4} words lost, ${resync4} resyncs`);
});

// ---------------------------------------------------------------------------------------------
// 3. the codec link (--dsp1-realign)

/** DSP cycles per ESSI1 time slot: two slots a 2,304-cycle frame. */
const SLOT = FRAME / 2;
/** A DMA request is a level (a channel armed with a word waiting in RX1 takes it at once, as the
 *  emulator models it) or an edge (only words that arrive while it is armed count). The realign must
 *  work under both, since the manual does not settle it. */
type Sem = 'level' | 'edge';

class Codec {
  t = 0; next = SLOT; slot: number;
  rdf = false; rfs = false; roe = false;
  de0 = false; die0 = false; ddr0 = 0x100; dco0 = 0x7f; left0 = 0;
  de1 = false; die1 = false; dsr1 = 0x400; ddr1 = 0xffffaa; dco1 = 0x3c1fc2;
  dcoh = 0; dcom = 0; dcohInit = 0; dcomInit = 0;
  /** DMA0's block end (the handler is due), DMA1's (its fast interrupt is due), and when */
  irq0 = false; irq0At = 0; irq1 = false; irq1At = 0;
  /** extra cycles before the next DMA1 fast interrupt is taken (a late re-arm) */
  lateFast = 0;
  /** requests still to be lost to both channels at once (a controller stalled a whole slot) */
  lostBoth = 0;
  /** an address or count written while its channel was armed (the manual forbids it) */
  violations: string[] = [];
  writes: string[] = [];
  /** at every DMA0 block end: DSR1 and the slot of the word it ended on */
  ends: { t: number; dsr1: number; rfs: boolean }[] = [];
  constructor(public sem: Sem, firstSlot: number) { this.slot = firstSlot; }
  read(a: number, c: Cpu): number | undefined {
    switch (a) {
      case R.SSISR1: return (this.rdf ? 0x80 : 0) | (this.roe ? 0x20 : 0) | (this.rfs ? 0x08 : 0);
      case R.RX1: this.rdf = false; this.roe = false; return 0;
      case R.DDR0: return this.ddr0;
      case R.DSR1: return this.dsr1;
      case R.DDR1: return this.ddr1;
      case R.DCR1: return (this.de1 ? 0x800000 : 0) | (this.die1 ? 0x400000 : 0) | 0x106510;
      case 0xfffff4: return (this.de0 ? 0 : 1) | (this.de1 ? 0 : 2) | 0x2c | (c.dcr4 & 0x800000 ? 0 : 0x10);
      default: return undefined;
    }
  }
  write(a: number, v: number): boolean {
    const arm = (was: boolean, now: boolean): boolean => !was && now;
    this.writes.push(`${a.toString(16)}=${v.toString(16)}`);
    switch (a) {
      case R.DCR0: {
        const was = this.de0;
        this.de0 = !!(v & 0x800000); this.die0 = !!(v & 0x400000);
        if (arm(was, this.de0)) { this.left0 = (this.dco0 & 0xfff) + 1; if (this.sem === 'level' && this.rdf) this.take0(); }
        return true;
      }
      case R.DCR1: {
        const was = this.de1;
        this.de1 = !!(v & 0x800000); this.die1 = !!(v & 0x400000);
        if (arm(was, this.de1)) {
          this.dcomInit = (this.dco1 >> 6) & 0xfff; this.dcohInit = (this.dco1 >> 18) & 0x3f;
          this.dcom = this.dcomInit; this.dcoh = this.dcohInit;
          if (this.sem === 'level' && this.rdf) this.line1();
        }
        return true;
      }
      case R.DDR0: case R.DCO0: case 0xffffef:
        if (this.de0) this.violations.push(`${a.toString(16)} written with DMA0 armed`);
        if (a === R.DDR0) this.ddr0 = v; else if (a === R.DCO0) this.dco0 = v;
        return true;
      case R.DSR1: case R.DDR1: case R.DCO1:
        if (this.de1) this.violations.push(`${a.toString(16)} written with DMA1 armed`);
        if (a === R.DSR1) this.dsr1 = v; else if (a === R.DDR1) this.ddr1 = v; else this.dco1 = v;
        return true;
      default: return false;
    }
  }
  /** DMA0: one word from RX1 (2D, DOR3 = -127), DE cleared at the block end, the interrupt raised */
  take0(): void {
    this.ddr0 = this.left0 > 1 ? this.ddr0 + 1 : this.ddr0 - 127;
    this.rdf = false;
    if (--this.left0 === 0) {
      this.de0 = false;
      this.ends.push({ t: this.t, dsr1: this.dsr1, rfs: this.rfs });
      if (this.die0) { this.irq0 = true; this.irq0At = this.t; }
    }
  }
  /** DMA1: one line of three words to TX12..TX10 (3D: +1, +1, then DOR0 = 1, DOR1 = -383 at a pass end) */
  line1(): void {
    this.dsr1 += 2;
    if (this.dcom === 0) {
      this.dcom = this.dcomInit; this.dsr1 -= 383;
      if (this.dcoh === 0) {
        this.dcoh = this.dcohInit; this.de1 = false;
        if (this.die1) { this.irq1 = true; this.irq1At = this.t + 12 + this.lateFast; this.lateFast = 0; }
      } else this.dcoh--;
    } else { this.dcom--; this.dsr1 += 1; }
  }
  arrive(): void {
    this.rfs = this.slot === 0; this.slot ^= 1;
    if (this.rdf) this.roe = true;
    this.rdf = true;
    if (this.lostBoth > 0) { this.lostBoth--; return; }
    if (this.de1) this.line1();                  // the request reaches both; DMA1 does not read RX1
    if (this.de0) this.take0();
  }
  /** time passes; DMA1's fast interrupt (IPL 0, two words at P:$1a) runs as soon as it may */
  advance(n: number, c: Cpu | null): void {
    for (let k = 0; k < n; k++) {
      this.t++;
      if (this.t >= this.next) { this.arrive(); this.next += SLOT; }
      if (this.irq1 && this.t >= this.irq1At && !(c && c.masked)) { this.irq1 = false; this.write(R.DCR1, R.DCR1_ARMED); }
    }
  }
}

interface CodecRun {
  codec: Codec; c: Cpu;
  /** per DMA0 block end: DMA1's lead over DMA0 in lines (0 in step; 128 - k: k behind), and the slot */
  ends: { off: number; rfs: boolean }[];
  realigns: number; periods: number;
}

/**
 * DSP1's codec link from power-on, `periods` DMA0 blocks long, with the handler `words` at `at` on
 * every DMA0 block end. The main loop is reduced to the one thing the handler reads of it -- X:$647
 * cleared by a finished pass -- and sits at P:$3c when interrupted.
 */
function codecRun(words: number[], at: number, o: {
  periods: number; realign?: boolean; sem?: Sem; firstSlot?: number;
  /** the main loop does not finish a pass in DMA0 period p */
  miss?: (p: number) => boolean;
  /** DMA0's interrupt in period p taken this many cycles late (the handler, and so DMA0's re-arm) */
  dma0Late?: Map<number, number>;
  /** DMA1's first block end at or after period `from`: its fast interrupt this many cycles late */
  dma1Late?: { from: number; cycles: number };
  /** in period p, one request lost to both channels (the controller held a whole slot) */
  lostBoth?: number[];
  /** cycles from DMA0's block end to the handler's first instruction (default 16) */
  entry?: (p: number) => number;
}): CodecRun {
  const codec = new Codec(o.sem ?? 'level', o.firstSlot ?? 0);
  const c = cpu(words, at);
  c.codec = codec; c.masked = false;
  // power-on, P:$1000c2..$1000d4: DMA1 then DMA0, before ESSI1's first word
  for (const [a, v] of [[R.DSR1, 0x400], [R.DDR1, 0xffffaa], [R.DCO1, 0x3c1fc2], [R.DCR1, R.DCR1_ARMED],
                        [R.DDR0, 0x100], [R.DCO0, 0x7f], [R.DCR0, R.DCR0_ARMED]] as const) codec.write(a, v);
  codec.writes = [];
  let p = 0, realigns = 0, x647 = 0;
  const hl = R.handler(at, 0, !!o.realign);
  const guard = (o.periods + 4) * DMA0_PERIOD;
  while (p < o.periods && codec.t < guard) {
    if (o.dma1Late && p >= o.dma1Late.from && o.dma1Late.cycles) { codec.lateFast = o.dma1Late.cycles; o.dma1Late = { ...o.dma1Late, cycles: 0 }; }
    if ((o.lostBoth ?? []).includes(p) && codec.ddr0 === 0x140) { codec.lostBoth = 1; o.lostBoth = o.lostBoth!.filter((x) => x !== p); }
    const due = codec.irq0 && codec.t >= codec.irq0At + (o.entry?.(p) ?? 16) + (o.dma0Late?.get(p) ?? 0);
    if (!due) { codec.advance(1, c); continue; }
    codec.irq0 = false;
    if (!(o.miss?.(p) ?? false)) x647 = 0;             // a pass finished in this period: P:$9a5
    c.X.set(0x647, x647);
    c.pcs = [];
    const before = !process.env.RECOVER_DEBUG ? "" : `p${p} t${codec.t} ddr0 ${codec.ddr0.toString(16)} dsr1 ${codec.dsr1.toString(16)} rdf ${+codec.rdf} rfs ${+codec.rfs} de0 ${+codec.de0} x647 ${x647} next ${codec.next - codec.t}`;
    irq(c, at, 0x3c);
    x647 = c.X.get(0x647)!;
    if (hl.rewrite && c.pcs.includes(hl.rewrite)) realigns++;
    if (process.env.RECOVER_DEBUG && hl.rewrite && c.pcs.includes(hl.rewrite)) console.log(before, 'REALIGN', 'state', c.P.get(hl.rstate));
    p++;
  }
  const ends = codec.ends.map((e) => ({ off: (((e.dsr1 - 0x400) / 3) % 128 + 128) % 128, rfs: e.rfs }));
  return { codec, c, ends, realigns, periods: p };
}

/** DMA0 periods 30..33 missed (an overload), DMA1's 16-pass block ending inside it (period 31). */
const OVERLOAD = (p: number): boolean => p >= 30 && p <= 33;
const CV5 = { words: V5W, at: V5W_AT };
const HL7 = R.handler(R.handlerAt(true), 0, true);
const CV7 = { words: HL7.words, at: HL7.at };

test('the "v5" variant is v5 word for word at v5\'s address; the default is v8', () => {
  assert.equal(R.handlerAt(false, R.VARIANTS.v5), V5W_AT);
  assert.deepEqual(R.recoverRecords(0, false, R.VARIANTS.v5)[0].words, V5W);
  assert.deepEqual(R.recoverRecords(0)[0].words, R.handler(R.handlerAt(false, R.VARIANTS.v8), 0, false, R.VARIANTS.v8).words);
});

test('codec model: power-on puts DMA1 in step with DMA0 and every block on the same slot; a clean run stays there', () => {
  for (const sem of ['level', 'edge'] as const) {
    for (const first of [0, 1]) {
      const r = codecRun(CV7.words, CV7.at, { periods: 80, sem, firstSlot: first, realign: true });
      assert.ok(r.ends.length >= 80);
      assert.ok(r.ends.every((e) => e.off === 0), 'DSR1 = $400 at every DMA0 block end');
      assert.ok(r.ends.every((e) => e.rfs === r.ends[0].rfs), 'every block ends on the same slot');
    }
  }
});

test('--dsp1-realign is inert when no frame is missed: the same register writes as v5, the healthy path v5\'s', () => {
  const r7 = codecRun(CV7.words, CV7.at, { periods: 80, realign: true });
  const r5 = codecRun(CV5.words, CV5.at, { periods: 80 });
  assert.deepEqual(r7.codec.writes, r5.codec.writes);
  assert.deepEqual(r7.ends, r5.ends);
  const once = (w: { words: number[]; at: number }): number[] => {
    const c = cpu(w.words, w.at); c.X.set(0x647, 0); c.pcs = []; irq(c, w.at, 0x3c);
    return c.pcs.map((pc) => pc - w.at);
  };
  assert.deepEqual(once(CV7), once(CV5), 'the same 14 instructions at the same offsets');
});

for (const sem of ['level', 'edge'] as const) {
  test(`codec model (${sem} requests): DMA1 re-armed k slots late stays k lines behind under v5; --dsp1-realign puts it back on the heal`, () => {
    for (const k of [1, 2, 5, 17, 40]) {
      const late = { from: 30, cycles: k * SLOT + 200 };
      const r5 = codecRun(CV5.words, CV5.at, { periods: 90, sem, miss: OVERLOAD, dma1Late: late });
      const r7 = codecRun(CV7.words, CV7.at, { periods: 90, sem, miss: OVERLOAD, dma1Late: late, realign: true });
      const lag = (128 - k) % 128;
      assert.ok(r5.ends.slice(35).every((e) => e.off === lag), `v5 k=${k}: behind for good`);
      assert.equal(r7.realigns, 1, `k=${k}: one realign`);
      assert.ok(r7.ends.slice(36).every((e) => e.off === 0), `k=${k}: DSR1 $400 at every block end from the heal on`);
      assert.ok(r7.ends.every((e) => e.rfs === r7.ends[0].rfs), 'DMA0 never touched: its slot never moves');
      assert.equal(r7.c.P.get(HL7.rstate), 0, 'probation over: audio resumed');
      assert.equal(r7.c.hcr, 0x0c);
    }
  });

  test(`codec model (${sem} requests): DMA0 held off loses words; --dsp1-realign puts DMA1 back in step with it`, () => {
    for (const k of [2, 3, 8]) {
      const r7 = codecRun(CV7.words, CV7.at, { periods: 90, sem, miss: OVERLOAD, dma0Late: new Map([[31, k * SLOT + 200]]), realign: true });
      assert.equal(r7.realigns, 1);
      assert.ok(r7.ends.slice(40).every((e) => e.off === 0), `k=${k}`);
    }
  });
}

test('codec model: every realign is straight-line, a few dozen cycles, masked only for its rewrite, and leaves DMA1 armed', () => {
  for (let j = 0; j < 30; j++) {
    // entry latencies that put ESSI1 words right inside the check and the rewrite
    const entry = (p: number): number => 4 + ((p * 37 + j * 29) % 1180);
    const codec = new Codec('level', 0);
    const r = codecRun(CV7.words, CV7.at, { periods: 70, miss: OVERLOAD, dma1Late: { from: 30, cycles: 5 * SLOT + 200 }, entry, realign: true });
    void codec;
    assert.deepEqual(r.codec.violations.filter((v) => !/DMA1 armed/.test(v)), []);
    assert.ok(r.codec.de1 || r.codec.irq1, `pattern ${j}: DMA1 armed (or at its own block end, P:$1a's to re-arm)`);
    assert.ok(r.ends.slice(-10).every((e) => e.off === 0), `pattern ${j}: in step by the end`);
  }
  // the rewrite, timed: from the mask going up to it coming down
  const w = CV7.words, at = CV7.at;
  const ori = w.indexOf(0x0003f8), andi = w.indexOf(0x00fcb8, ori);
  assert.ok(ori > 0 && andi > ori && andi - ori <= 20, `the masked stretch is ${andi - ori} words with no branch back`);
  for (let a = ori; a < andi; a++) {
    const x = w[a];
    const isBranch = (x & 0xff0000) === 0x050000 || (x & 0xff00f0) === 0x060080 || (x & 0xfff000) === 0x0d0000;
    assert.ok(!isBranch, `no loop, no call, no DO at P:${(at + a).toString(16)}`);
  }
});

test('give-up: a frame missed after a realign, before the audio is back, turns the realign off until power-off', () => {
  // the overload goes on past the heal (periods 36..38 missed again), then DMA1 is knocked out once more
  const miss = (p: number): boolean => OVERLOAD(p) || (p >= 36 && p <= 38) || (p >= 62 && p <= 64);
  const r7 = codecRun(CV7.words, CV7.at, { periods: 100, miss, dma1Late: { from: 30, cycles: 5 * SLOT + 200 }, realign: true });
  assert.equal(r7.c.P.get(HL7.rstate), R.REALIGN_GIVEN_UP);
  assert.equal(r7.realigns, 1, 'no realign after the give-up');
});

test('codec model: an overload with nothing knocked out of step is never realigned, wherever the check lands against the words', () => {
  for (let j = 0; j < 40; j++) {
    const entry = (p: number): number => 4 + ((p * 131 + j * 197) % 1500);
    const r = codecRun(CV7.words, CV7.at, { periods: 90, miss: (p) => (p >= 20 && p <= 22) || (p >= 50 && p <= 57), entry, realign: true });
    assert.equal(r.realigns, 0, `jitter pattern ${j}`);
    assert.ok(r.ends.every((e) => e.off === 0 && e.rfs === r.ends[0].rfs));
  }
});

// ---------------------------------------------------------------------------------------------
// the stacked SR across a resync

test('v5\'s resync hands the main loop its loop counter as SR (IPL 0 masked for good); v8 hands back the SR', () => {
  const run5 = (words: number[], at: number): { back: number; sr: number } => {
    const c = cpu(words, at);
    c.X.set(0x647, 1); c.ddr4 = 0x6e0;
    for (let k = 0; k < 3; k++) irq(c, at, 0x75);
    const back = irq(c, at, 0x75, false);              // the 4th missed frame: the resync
    return { back, sr: c.srOut };
  };
  const v5 = run5(V5W, V5W_AT);
  assert.equal(v5.back, 0x2e);
  assert.equal(v5.sr, LC_AT_RESET, "v5: the DO loop between `move ssh,a1` and `move a1,ssh` left LC in the SSL the rti restores");
  assert.ok(v5.sr & 0x100, '... whose bit 8 is I0: DMA0 and DMA1 (IPL 0) never interrupt again -- silence, host commands (IPL 1) still served');
  for (const name of ['v8', 'bis-A', 'bis-B'] as const) {
    const hl = R.handler(R.handlerAt(false, R.VARIANTS[name]), 0, false, R.VARIANTS[name]);
    const r = run5(hl.words, hl.at);
    assert.equal(r.back, 0x2e, name);
    assert.equal(r.sr, SR_MAIN, `${name}: the main loop's own SR`);
  }
  const hc = R.handler(R.handlerAt(false, R.VARIANTS['bis-C']), 0, false, R.VARIANTS['bis-C']);
  assert.equal(run5(hc.words, hc.at).sr, LC_AT_RESET, 'bis-C keeps v5\'s idle loop: it must go silent too');
});

test('the variant "v5" is v5 word for word; every variant restores A, X0, R0, the stack and the SR on every path', () => {
  assert.deepEqual(R.handler(V5W_AT, 0, false, R.VARIANTS.v5).words, V5W);
  for (const name of ['v8', 'bis-A', 'bis-B']) {
    const hl = R.handler(R.handlerAt(false, R.VARIANTS[name]), 0, false, R.VARIANTS[name]);
    for (const pc of [0x3c, 0x75, 0x100]) {
      const c = cpu(hl.words, hl.at);
      irq(c, hl.at, pc);                              // healthy
      c.X.set(0x647, 1); c.ddr4 = 0x6e0;
      for (let k = 0; k < 6; k++) irq(c, hl.at, pc);   // misses, and the resync where the PC allows it
      for (let k = 0; k < 9; k++) { c.X.set(0x647, 0); irq(c, hl.at, pc); }   // the heal and the hold
      assert.equal(c.hcr, 0x0c, name);
    }
  }
});

test('cost in cycles per variant -- a healthy entry, a missed frame, the resync', () => {
  const rows: string[] = [];
  for (const name of ['v5', 'v8', 'bis-A', 'bis-B', 'bis-C']) {
    const hl = R.handler(R.handlerAt(false, R.VARIANTS[name]), 0, false, R.VARIANTS[name]);
    const c = cpu(hl.words, hl.at);
    irq(c, hl.at, 0x3c); const healthy = c.lastCost!;
    c.X.set(0x647, 1); irq(c, hl.at, 0x3c); const miss = c.lastCost!;
    c.ddr4 = 0x6e0; irq(c, hl.at, 0x75); irq(c, hl.at, 0x75); irq(c, hl.at, 0x75, false); const resync = c.lastCost!;
    rows.push(`${name}: healthy ${healthy}, missed frame ${miss}, resync ${resync}`);
    assert.ok(healthy <= 30, `${name} healthy ${healthy}`);
    assert.ok(miss < (R.VARIANTS[name].feed === 'none' ? 1000 : 2000), `${name} missed frame ${miss}: light (paced)`);
  }
  if (process.env.RECOVER_DEBUG) console.log(rows.join('\n'));
});

// ---------------------------------------------------------------------------------------------
// the stack gate, and --dsp1-diag

test('stack gate: v5\'s words are rejected at the DO after the pop; v8, its variants, the realign and the diag pass', () => {
  assert.deepEqual(R.stackGate(V5W, V5W_AT), [[0xbda, 0xbe3]]);
  const hc = R.handler(R.handlerAt(false, R.VARIANTS['bis-C']), 0, false, R.VARIANTS['bis-C']);
  assert.equal(R.stackGate(hc.words, hc.at).length, 1, 'bis-C keeps the `do`-loop idle: the gate refuses it');
  for (const name of ['v8', 'bis-A', 'bis-B']) {
    for (const realign of [false, true]) for (const diag of [false, true]) {
      const hl = R.handler(R.handlerAt(realign, R.VARIANTS[name], diag), 0, realign, R.VARIANTS[name], diag);
      assert.deepEqual(R.stackGate(hl.words, hl.at), [], `${name} realign ${realign} diag ${diag}`);
    }
  }
  // and the walk never reads an operand as an instruction: the v3 and v4 words walk to their ends
  assert.deepEqual(R.stackGate(V3, V3_AT), []);
  assert.deepEqual(R.stackGate(V4W, V4_AT), []);
});

test('--dsp1-diag: every DMA0 entry publishes DSR1, DDR0, SSISR1; misses and resyncs are counted; HV 6 answers any P word', () => {
  const hl = R.handler(R.handlerAt(false, R.VARIANTS.v8, true), 0, false, R.VARIANTS.v8, true);
  assert.ok(hl.words.length <= 234, `${hl.words.length} words: fits above the DSP1 drive`);
  const c = cpu(hl.words, hl.at);
  c.X.set(0xffffeb, 0x571); c.X.set(0xffffee, 0x100); c.X.set(0xffffa7, 0x48);
  irq(c, hl.at, 0x3c);                                        // healthy: the words, no other effect
  assert.deepEqual([hl.dDsr1, hl.dDdr0, hl.dSsisr].map((a) => c.P.get(a)), [0x571, 0x100, 0x48]);
  assert.equal(c.X.get(0x647), 1);
  c.X.set(0x647, 1); c.ddr4 = 0x6e0;
  for (let k = 0; k < 4; k++) irq(c, hl.at, 0x75);             // four misses, the 4th resyncs
  assert.equal(c.P.get(hl.dMiss), 4);
  assert.equal(c.P.get(hl.dResync), 1);
  assert.equal(c.P.get(hl.dRsDdr4), 0x6e0);
  // the host command: TX already written (HRDF), the answer in HTX, r0 kept
  const host = (addr: number, hrdf = true): number => {
    c.X.set(0xffffc6, addr); c.X.set(0xffffc3, hrdf ? 1 : 0); c.r0 = 0x123;
    c.sp = 1; c.stk[1] = { h: 0x3c, l: SR_MAIN };
    run(c, hl.diag);
    assert.equal(c.r0, 0x123, 'r0 restored');
    assert.equal(c.sp, 0); assert.equal(c.srOut, SR_MAIN);
    return c.X.get(0xffffc7)!;
  };
  assert.equal(host(hl.dDsr1), 0x571);
  assert.equal(host(hl.dMiss), 4);
  assert.equal(host(hl.dRsDdr4), 0x6e0);
  c.P.set(0, 0x0af080);                                      // the reset vector's jmp
  assert.equal(host(hl.dDsr1, false), 0x0af080, 'no word: it answers P:0 ($0af080) and never waits');
  // the records: P:$0c = jsr <diag>, and nothing else of the base
  const recs = R.recoverRecords(0, false, R.VARIANTS.v8, true);
  assert.deepEqual(recs.find((r) => r.addr === R.DIAG_VECTOR)!.words, [0x0bf080, hl.diag]);
});
