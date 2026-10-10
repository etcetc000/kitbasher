// The ColdFire side of an X.20 build: the OS writes (the recipe's sites, resolved), the routines
// they call (window A, preloaded by the loader's stage 1 with the stage image), and the stage-2
// code the loader runs: the DSP2 pre-boot load, the applier that writes the sites once the loader
// has decoded the OS, and the DSP2 upload of the dispatch words after DSP2 starts.
//
// Every routine here is ISA_A (MCF5206e) and every byte it emits is decoded by isa.ts before the
// build writes it (engine/src/x20.ts, x20Gates): the emulators run 68k forms the CPU traps on
// (a `btst #n,abs.l` and a `move.l #imm,d16(An)` each froze real hardware at boot).

import { Asm, type Assembled } from './cf_asm.js';
import { be16, be32, concat, h, hex } from './bytes.js';
import type { SiteValue, X20Recipe } from './x20_recipe.js';

/** The memory map an X.20 build uses, from the recipe. */
export interface X20Map {
  /** machine records (24 bytes each) and their cap; the menu struct; the OS stack region's bottom */
  recs: number; cap: number; menu: number; mL: number; mU: number; stack: number;
  /** the new-machine list in RAM (X.20's 8 entries, then ours) and its entry count */
  list: number; listN: number;
  bankEnd: number;
}

export function x20Map(R: X20Recipe, ours: number, bankEnd: number): X20Map {
  const F = R.ram.menuFields;
  const mL = F.usrList - F.indexEntries + R.ram.recordCap;   // the menu's per-record index array grows with the cap
  const listN = R.ram.stockList.entries + ours;
  if (listN * R.ram.stockList.entryBytes > R.ram.listRoom) throw new Error(`the new-machine list has room for ${Math.floor(R.ram.listRoom / R.ram.stockList.entryBytes) - R.ram.stockList.entries} machines`);
  if (listN > 127) throw new Error('the new-machine list count is a moveq: at most 127 entries');
  return { recs: R.ram.records, cap: R.ram.recordCap, menu: R.ram.menu, mL, mU: mL + (F.usrCount - F.usrList), stack: R.ram.stackBottom,
    list: R.ram.list, listN, bankEnd };
}

/** Evaluate a recipe expression: names and hex/decimal numbers joined by + and -. */
export function evalExpr(expr: string, names: Record<string, number>): number {
  const toks = expr.replace(/\s+/g, '').match(/[+-]|[^+-]+/g);
  if (!toks) throw new Error(`recipe expression "${expr}"`);
  let v = 0, sign = 1, want = true;
  for (const t of toks) {
    if (t === '+' || t === '-') { if (want && t === '-') { sign = -sign; continue; } sign = t === '-' ? -1 : 1; want = true; continue; }
    const n = /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : /^\d+$/.test(t) ? +t : names[t];
    if (n === undefined) throw new Error(`recipe expression "${expr}": unknown name ${t}`);
    v += sign * n; sign = 1; want = false;
  }
  return v;
}

/** The bytes a site value stands for. */
export function siteBytes(v: SiteValue, names: Record<string, number>, labels: Record<string, number>): Uint8Array {
  const target = (n: string): number => {
    const a = labels[n];
    if (a === undefined) throw new Error(`recipe site calls ${n}, which the build does not provide`);
    return a;
  };
  if ('u32' in v) return be32(evalExpr(v.u32, names) >>> 0);
  if ('u16' in v) { const x = evalExpr(v.u16, names); if (x < 0 || x > 0xffff) throw new Error(`u16 ${v.u16} = ${x}`); return be16(x); }
  if ('hex' in v) return hex(v.hex);
  if ('jmp' in v) return concat([hex('4ef9'), be32(target(v.jmp))]);
  if ('jsr' in v) return concat([hex('4eb9'), be32(target(v.jsr))]);
  if ('moveq' in v) { const x = evalExpr(v.moveq, names); if (x < -128 || x > 127) throw new Error(`moveq ${v.moveq} = ${x}`); return Uint8Array.of(0x70, x & 0xff); }
  if ('nop' in v) return concat(Array.from({ length: v.nop }, () => hex('4e71')));
  if ('parts' in v) return concat(v.parts.map((p) => siteBytes(p, names, labels)));
  throw new Error(`recipe site value ${JSON.stringify(v)}`);
}

/** Whether a site value replaces whole instructions (so its bytes are code the ISA gate decodes). */
export const isCode = (v: SiteValue): boolean => !('u32' in v) && !('u16' in v);

export interface WindowA {
  asm: Assembled;
  /** the handler table, filled at boot from X.20's (the applier), entry `classes` = the knob callback */
  htab: number; knobcb: number; classes: number;
}

/**
 * Window A: the routines the OS sites jump to, and their tables. Preloaded by stage 1 (it rides in
 * the stage image); the handler table is filled by the applier from X.20's own at boot.
 */
export function windowA(R: X20Recipe, M: X20Map, ours: Map<number, number>, knobCallback: Uint8Array, listFlash: number): WindowA {
  const a = new Asm(R.ram.window[0]);
  const I = (...x: string[]): void => a.i(x[0], ...x.slice(1));
  const bitmap = new Uint8Array(32), famtab = new Uint8Array(256);
  for (const [id, fam] of ours) { bitmap[id >> 3] |= 1 << (id & 7); famtab[id] = fam; }
  // d0 = the ID byte of the long argument at 4(a7); Z set (beq) when the ID is not ours. Uses d0, d1, a0.
  const isOurs = (fail: string): void => {
    I('moveq', '#0', 'd0'); I('move.b', '7(a7)', 'd0'); I('move.l', 'd0', 'd1'); I('lsr.l', '#3', 'd1');
    I('lea', '@bitmap', 'a0'); I('adda.l', 'd1', 'a0'); I('btst', 'd0', '(a0)'); I('beq.b', fail);
  };
  const H = R.hooks;
  // machine ID validity: ours are valid; the rest as X.20 decides (its first three instructions, replaced by the jump)
  a.label('VALID'); isOurs('valid_stock'); I('moveq', '#1', 'd0'); I('rts');
  a.label('valid_stock'); I('move.l', 'd3', '-(a7)'); I('move.l', 'd2', '-(a7)'); I('move.l', '12(a7)', 'd2'); I('jmp', `${h(H.VALID)}.l`);
  // menu family of a machine
  a.label('FAM'); isOurs('fam_stock'); I('lea', '@famtab', 'a0'); I('moveq', '#0', 'd1'); I('move.b', '(a0,d0.l)', 'd1'); I('move.l', 'd1', 'd0'); I('rts');
  a.label('fam_stock'); I('move.l', 'd2', '-(a7)'); I('move.l', '8(a7)', 'd1'); I('jmp', `${h(H.FAM)}.l`);
  // parameter class: ours are class `classes` (the handler table's added entry, the knob callback)
  a.label('CLS'); isOurs('cls_stock'); I('moveq', `#${R.ram.handlerTable.classes}`, 'd0'); I('rts');
  a.label('cls_stock'); I('move.l', 'd2', '-(a7)'); I('move.l', '8(a7)', 'd1'); I('jmp', `${h(H.CLS)}.l`);
  // DSP2 block write (addr, count): refused when it touches the E12 bank or the machines placed in it
  const e12Lo = R.e12.table, e12Hi = R.e12.bankEnd;
  a.label('GUARD');
  I('move.l', '4(a7)', 'd0'); I('cmpi.l', `#${e12Hi}`, 'd0'); I('bcc.b', 'guard_ok');
  I('add.l', '8(a7)', 'd0'); I('cmpi.l', `#${e12Lo + 1}`, 'd0'); I('bcs.b', 'guard_ok');
  I('moveq', '#0', 'd0'); I('rts');
  a.label('guard_ok'); I('move.l', 'a2', '-(a7)'); I('tst.l', '12(a7)'); I('jmp', `${h(H.GUARD)}.l`);
  // flash file system erase (ctx, ...): refused for the E12B instance only (its spare sectors hold the
  // machines' code); the +Drive machine banks erase as stock
  a.label('ERGUARD');
  I('move.l', '4(a7)', 'd0'); I('cmpi.l', `#${H.erguard.context}`, 'd0'); I('bne.b', 'er_stock'); I('moveq', '#0', 'd0'); I('rts');
  a.label('er_stock'); I('lea', '-16(a7)', 'a7'); I('movem.l', 'd2-d4/a2', '(a7)'); I('jmp', `${h(H.erguard.resume)}.l`);
  // record builder start: the new-machine list -- X.20's entries, then ours from flash -- into RAM,
  // then the instruction the call replaced
  const SL = R.ram.stockList;
  a.label('COPYLIST');
  I('lea', '-12(a7)', 'a7'); I('movem.l', 'd1/a0-a1', '(a7)');
  I('lea', `${h(SL.at)}.l`, 'a0'); I('lea', `${h(M.list)}.l`, 'a1'); I('move.l', `#${SL.entries * SL.entryBytes / 4}`, 'd1');
  a.label('cl_stock'); I('move.l', '(a0)+', '(a1)+'); I('subq.l', '#1', 'd1'); I('bne.b', 'cl_stock');
  I('lea', `${h(R.flashAlias + listFlash)}.l`, 'a0'); I('move.l', `#${(M.listN - SL.entries) * SL.entryBytes / 4}`, 'd1');
  a.label('cl_ours'); I('move.l', '(a0)+', '(a1)+'); I('subq.l', '#1', 'd1'); I('bne.b', 'cl_ours');
  I('movem.l', '(a7)', 'd1/a0-a1'); I('lea', '12(a7)', 'a7'); I('move.l', `${h(H.COPYLIST_READS)}.l`, 'd0'); I('rts');
  // USR machines: X.20's install (0x26607e), remove (0x217bf4) and check (0x2177e0) routines reach the
  // record table and the menu struct relative to the globals base; with them moved, these give the
  // new addresses (ISA_A has no move #imm,(d16,An), so through a register)
  a.label('USRCHKREC'); I('lea', `${h(M.recs)}.l`, 'a1'); I('move.l', 'a1', '-20(a6)'); I('rts');
  a.label('USRINSMENU'); I('lea', `${h(M.menu)}.l`, 'a0'); I('move.l', 'a0', '-96(a6)'); I('rts');
  a.label('USRREM'); I('lea', `${h(M.recs)}.l`, 'a0'); I('moveq', '#0', 'd2'); I('move.l', 'a0', 'a5');
  I('moveq', '#0', 'd1'); I('move.b', 'd0', 'd1'); I('move.l', 'd1', 'd0'); I('rts');
  a.align(4);
  a.bytes('bitmap', bitmap);
  a.bytes('famtab', famtab);
  a.align(4);
  a.bytes('htab', new Uint8Array((R.ram.handlerTable.classes + 1) * 4));
  a.bytes('knobcb', knobCallback);
  a.align(4);
  const asm = a.assemble();
  return { asm, htab: asm.labels.htab, knobcb: asm.labels.knobcb, classes: R.ram.handlerTable.classes };
}

/** DSP2 words of the boot loader's receiver (at P:receiver, sent by ELD) and wiper (placed by the receiver itself). */
export function dsp2BootLoader(R: X20Recipe): { receiver: number[]; wiper: { addr: number; words: number[] }; opcodes: { receiver: Set<number>; wiper: Set<number> } } {
  const B = R.dsp2.boot, o = B.receiver, s = B.save;
  // DSP56300 moves of r0,r1,a0,a1,a2,b0,b1,b2,x0 to/from x:>abs
  const saveOps = [0x607000, 0x617000, 0x507000, 0x547000, 0x527000, 0x517000, 0x557000, 0x537000, 0x447000];
  const loadOps = [0x60f000, 0x61f000, 0x50f000, 0x54f000, 0x52f000, 0x51f000, 0x55f000, 0x53f000, 0x44f000];
  const receiver = [
    ...saveOps.flatMap((op, k) => [op, s + k]),               // save what the bootstrap leaves in registers
    0x0cc300, 0x000000,       // o+$12: brclr #0,x:<<$ffffc3,* (wait for a host word)
    0x084e06,                 // movep x:<<$ffffc6,a           address (negative: done)
    0x200003,                 // tst a
    0x0af0ab, o + 0x24,       // jmi >o+$24
    0x219000,                 // move a1,r0
    0x0cc300, 0x000000,       // brclr #0,x:<<$ffffc3,*
    0x084f06,                 // movep x:<<$ffffc6,b           count
    0x06cd00, o + 0x21,       // do b1,>o+$22
    0x0cc300, 0x000000,       //   brclr #0,x:<<$ffffc3,*
    0x084406,                 //   movep x:<<$ffffc6,x0
    0x445800,                 //   move x0,x:(r0)+
    0x0af080, o + 0x12,       // jmp >o+$12
    0x0af080, B.wiper,        // o+$24: jmp >wiper
  ];
  const w = B.wiper;
  const wiper = [
    0x61f400, o,              // move #>receiver,r1
    0x240000,                 // move #0,x0
    0x064080, w + 5,          // do #$40,>w+6
    0x075984,                 //   move x0,p:(r1)+   (P writes: the receiver goes away)
    ...loadOps.flatMap((op, k) => [op, s + k]),
    0x0af080, B.rdy,          // jmp >rdy: the bootstrap sends RDY and takes its next command (the stock ELD)
  ];
  // which words are instructions (the rest are their extension words)
  const ops = (words: number[], ext: (w: number) => number): Set<number> => {
    const out = new Set<number>();
    for (let k = 0; k < words.length; k += 1 + ext(words[k])) out.add(k);
    return out;
  };
  const twoWord = (w: number): number => ([0x0cc300, 0x0af0ab, 0x06cd00, 0x0af080, 0x61f400, 0x064080].includes(w) || saveOps.includes(w) || loadOps.includes(w) ? 1 : 0);
  if (receiver.length > 0x40) throw new Error('the receiver is longer than the wiper clears');
  if (w + wiper.length > s) throw new Error('the wiper runs into its save area');
  return { receiver, wiper: { addr: w, words: wiper }, opcodes: { receiver: ops(receiver, twoWord), wiper: ops(wiper, twoWord) } };
}

/** DSP56300 cache instructions: illegal when the cache is off, as it is in a bootstrap without it (DSP56300FM). */
const CACHE_OPS = new Set([0x000003, 0x000001, 0x000002]);   // pflush, pflushun, pfree
/** Indexes of cache instructions (pflush, pflushun, pfree, plock (Rn)) among the opcode words. */
export function cacheOpsIn(words: number[], opcodes: Set<number>): number[] {
  // plock (Rn) = $0be081 | n<<8 (as X.20's bootstrap uses it); jsr (Rn) = $0be080 | n<<8 is not one
  return words.flatMap((w, k) => (opcodes.has(k) && (CACHE_OPS.has(w) || (w & 0xfff8ff) === 0x0be081) ? [k] : []));
}

export interface StageCode { asm: Assembled; sites: { at: number; old: string; bytes: Uint8Array; what: string }[] }

/**
 * Stage-2 code, assembled at the boot-code org (right after the loader and its S2MD header):
 *  - APPLIER (the handoff call): the write list, X.20's handler table into window A, the DSP2 upload,
 *    then the OS entry as the loader would have entered it;
 *  - DSP2PRE (DSP2's first bootstrap command): ELD + EGO the receiver, the pre-boot chunks, a negative
 *    address to end; the receiver's wiper returns DSP2 to its bootstrap, which then takes the stock ELD;
 *  - UPLOAD: the post-boot chunks over host command $89 (the OS's own DSP2 block write), draining DSP2's
 *    words while it waits (DSP2 never blocks on us).
 * Chunks are NRV2B-packed {u32 addr, u32 count, count x 3-byte words} in flash.
 */
export function stageCode(R: X20Recipe, list: Uint8Array, preChunks: number[], postChunks: number[], wa: WindowA, rx: number[]): StageCode {
  const s = new Asm(R.ram.bootCode[0]);
  const S = (...x: string[]): void => s.i(x[0], ...x.slice(1));
  const HP = R.host.dsp2, BUF = R.ram.uploadBuffer[0];
  // applier: write list {u32 addr, u32 count, bytes, pad to even}, addr 0 ends
  s.label('APPLIER');
  S('lea', '@list', 'a0');
  s.label('ap_loop'); S('move.l', '(a0)+', 'a1'); S('move.l', 'a1', 'd1'); S('beq.w', 'ap_done');
  S('move.l', '(a0)+', 'd0');
  s.label('ap_copy'); S('move.b', '(a0)+', '(a1)+'); S('subq.l', '#1', 'd0'); S('bne.b', 'ap_copy');
  S('move.l', 'a0', 'd1'); S('addq.l', '#1', 'd1'); S('and.l', '#-2', 'd1'); S('move.l', 'd1', 'a0'); S('bra.b', 'ap_loop');
  s.label('ap_done');
  // X.20's per-class parameter handlers into window A, then ours (the knob callback) after them
  S('lea', `${h(R.ram.handlerTable.at)}.l`, 'a0'); S('lea', `${h(wa.htab)}.l`, 'a1'); S('move.l', `#${wa.classes}`, 'd0');
  s.label('ap_h'); S('move.l', '(a0)+', '(a1)+'); S('subq.l', '#1', 'd0'); S('bne.b', 'ap_h');
  S('move.l', `#${wa.knobcb}`, 'd0'); S('move.l', 'd0', '(a1)');
  S('jsr', '@UPLOAD');
  S('jmp', `${h(R.loader.handoff.enter)}.l`);
  // HI08 (DSP2): TRDY set and no host command pending; TXDE. d4 counts down to a timeout.
  let n = 0;
  const drain = (): void => {
    const l = 'dr' + n++;
    S('move.b', `${h(HP + 2)}.l`, 'd0'); S('btst', '#0', 'd0'); S('beq.b', l); S('move.l', `${h(HP + 4)}.l`, 'd0');
    s.label(l);
  };
  const waitReady = (fail: string): void => {
    const l = 'wr' + n++;
    S('move.l', '#0x200000', 'd4');
    s.label(l); S('subq.l', '#1', 'd4'); S('beq.w', fail); drain();
    S('move.b', `${h(HP + 2)}.l`, 'd0'); S('btst', '#2', 'd0'); S('beq.b', l);
    S('move.b', `${h(HP + 1)}.l`, 'd0'); S('btst', '#7', 'd0'); S('bne.b', l);
  };
  const waitTx = (fail: string): void => {
    const l = 'wt' + n++;
    S('move.l', '#0x200000', 'd4');
    s.label(l); S('subq.l', '#1', 'd4'); S('beq.w', fail); drain();
    S('move.b', `${h(HP + 2)}.l`, 'd0'); S('btst', '#1', 'd0'); S('beq.b', l);
  };
  s.label('UPLOAD');
  S('lea', '-32(a7)', 'a7'); S('movem.l', 'd2-d7/a2-a3', '(a7)');
  S('lea', '@chunks', 'a3');
  s.label('up_chunk'); S('move.l', '(a3)+', 'd0'); S('beq.w', 'up_end');
  S('move.l', 'd0', 'a0'); S('lea', `${h(BUF)}.l`, 'a1'); S('bsr.w', 'NRV2B'); S('move.l', 'a1', 'd7');
  S('lea', `${h(BUF)}.l`, 'a2');
  s.label('up_block'); S('move.l', 'a2', 'd0'); S('cmp.l', 'd7', 'd0'); S('bcc.w', 'up_chunk');
  S('bsr.w', 'RD32'); S('move.l', 'd3', 'd1'); S('bsr.w', 'RD32'); S('move.l', 'd3', 'd2');
  waitReady('up_end');
  S('move.l', 'd1', `${h(HP + 4)}.l`); S('move.l', `#${R.host.uploadVector}`, 'd0'); S('move.b', 'd0', `${h(HP + 1)}.l`);
  waitTx('up_end');
  S('move.l', 'd2', 'd0'); S('subq.l', '#1', 'd0'); S('move.l', 'd0', `${h(HP + 4)}.l`);
  s.label('up_word'); S('bsr.w', 'RD24');
  waitTx('up_end');
  S('move.l', 'd3', `${h(HP + 4)}.l`); S('subq.l', '#1', 'd2'); S('bne.b', 'up_word');
  S('bra.w', 'up_block');
  s.label('up_end'); S('movem.l', '(a7)', 'd2-d7/a2-a3'); S('lea', '32(a7)', 'a7'); S('rts');
  s.label('RD32'); S('moveq', '#0', 'd3'); S('move.b', '(a2)+', 'd3');
  S('lsl.l', '#8', 'd3'); S('move.b', '(a2)+', 'd3'); S('lsl.l', '#8', 'd3'); S('move.b', '(a2)+', 'd3'); S('lsl.l', '#8', 'd3'); S('move.b', '(a2)+', 'd3'); S('rts');
  s.label('RD24'); S('moveq', '#0', 'd3'); S('move.b', '(a2)+', 'd3');
  S('lsl.l', '#8', 'd3'); S('move.b', '(a2)+', 'd3'); S('lsl.l', '#8', 'd3'); S('move.b', '(a2)+', 'd3'); S('rts');
  // NRV2B (UCL, 8-bit): a0 source, a1 destination -> a1 end. d0 bit buffer, d1 offset, d2 length, d3 bit, d4 last offset
  s.label('NRV2B');
  S('move.l', 'a2', '-(a7)'); S('moveq', '#0', 'd0'); S('moveq', '#1', 'd4');
  s.label('nb_lit'); S('bsr.w', 'GETBIT'); S('tst.l', 'd3'); S('beq.b', 'nb_match'); S('move.b', '(a0)+', '(a1)+'); S('bra.b', 'nb_lit');
  s.label('nb_match'); S('moveq', '#1', 'd1');
  s.label('nb_m1'); S('bsr.w', 'GETBIT'); S('add.l', 'd1', 'd1'); S('add.l', 'd3', 'd1'); S('bsr.w', 'GETBIT'); S('tst.l', 'd3'); S('beq.b', 'nb_m1');
  S('moveq', '#2', 'd3'); S('cmp.l', 'd3', 'd1'); S('bne.b', 'nb_m2'); S('move.l', 'd4', 'd1'); S('bra.b', 'nb_len');
  s.label('nb_m2'); S('subq.l', '#3', 'd1'); S('lsl.l', '#8', 'd1'); S('moveq', '#0', 'd3'); S('move.b', '(a0)+', 'd3'); S('or.l', 'd3', 'd1');
  S('moveq', '#-1', 'd3'); S('cmp.l', 'd3', 'd1'); S('beq.b', 'nb_end'); S('addq.l', '#1', 'd1'); S('move.l', 'd1', 'd4');
  s.label('nb_len'); S('bsr.w', 'GETBIT'); S('move.l', 'd3', 'd2'); S('add.l', 'd2', 'd2'); S('bsr.w', 'GETBIT'); S('add.l', 'd3', 'd2');
  S('tst.l', 'd2'); S('bne.b', 'nb_l2'); S('moveq', '#1', 'd2');
  s.label('nb_l1'); S('bsr.w', 'GETBIT'); S('add.l', 'd2', 'd2'); S('add.l', 'd3', 'd2'); S('bsr.w', 'GETBIT'); S('tst.l', 'd3'); S('beq.b', 'nb_l1');
  S('addq.l', '#2', 'd2');
  s.label('nb_l2'); S('cmpi.l', '#0xd00', 'd1'); S('bls.b', 'nb_l3'); S('addq.l', '#1', 'd2');
  s.label('nb_l3'); S('move.l', 'a1', 'd3'); S('sub.l', 'd1', 'd3'); S('move.l', 'd3', 'a2'); S('move.b', '(a2)+', '(a1)+');
  s.label('nb_cp'); S('move.b', '(a2)+', '(a1)+'); S('subq.l', '#1', 'd2'); S('bne.b', 'nb_cp'); S('bra.b', 'nb_lit');
  s.label('nb_end'); S('move.l', '(a7)+', 'a2'); S('rts');
  s.label('GETBIT'); S('move.l', 'd0', 'd3'); S('and.l', '#0x7f', 'd3'); S('beq.b', 'gb_load'); S('add.l', 'd0', 'd0'); S('bra.b', 'gb_done');
  s.label('gb_load'); S('moveq', '#0', 'd0'); S('move.b', '(a0)+', 'd0'); S('add.l', 'd0', 'd0'); S('addq.l', '#1', 'd0');
  s.label('gb_done'); S('and.l', '#0x1ff', 'd0'); S('move.l', 'd0', 'd3'); S('lsr.l', '#8', 'd3'); S('rts');
  // DSP2 pre-boot load: replaces `move.l #'ELD',d2` where the loader sends DSP2's bootstrap its first command
  s.label('DSP2PRE');
  S('lea', '-52(a7)', 'a7'); S('movem.l', 'd0-d7/a0-a3/a5', '(a7)');
  S('tst.l', '@pre_done'); S('bne.w', 'pre_out');
  S('moveq', '#1', 'd0'); S('move.l', 'd0', '@pre_done');
  S('move.l', '84(a7)', 'a5');
  S('move.l', 'a5', 'd0'); S('cmpi.l', `#${HP}`, 'd0'); S('bne.w', 'pre_out');
  if (preChunks.length) {
    S('move.l', '#0x454c44', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('move.l', `#${rx.length}`, 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('lea', '@rxw', 'a1'); S('move.l', `#${rx.length}`, 'd2');
    s.label('pre_l'); S('move.l', '(a1)+', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out'); S('subq.l', '#1', 'd2'); S('bne.b', 'pre_l');
    S('bsr.w', 'RX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('cmpi.l', `#${rx.reduce((x, w) => x + w, 0) & 0xffffff}`, 'd1'); S('bne.w', 'pre_out');
    S('move.l', '#0x45474f', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('lea', '@pchunks', 'a3');
    s.label('pre_chunk'); S('move.l', '(a3)+', 'd0'); S('beq.w', 'pre_end');
    S('move.l', 'd0', 'a0'); S('lea', `${h(BUF)}.l`, 'a1'); S('bsr.w', 'NRV2B'); S('move.l', 'a1', 'd7');
    S('lea', `${h(BUF)}.l`, 'a2');
    s.label('pre_block'); S('move.l', 'a2', 'd0'); S('cmp.l', 'd7', 'd0'); S('bcc.w', 'pre_chunk');
    S('bsr.w', 'RD32'); S('move.l', 'd3', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('bsr.w', 'RD32'); S('move.l', 'd3', 'd2'); S('move.l', 'd3', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    s.label('pre_word'); S('bsr.w', 'RD24'); S('move.l', 'd3', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('subq.l', '#1', 'd2'); S('bne.b', 'pre_word'); S('bra.w', 'pre_block');
    s.label('pre_end'); S('move.l', '#0x800000', 'd1'); S('bsr.w', 'TX1'); S('tst.l', 'd4'); S('beq.w', 'pre_out');
    S('bsr.w', 'RX1');
    S('moveq', '#2', 'd0'); S('move.l', 'd0', '@pre_done');
  }
  s.label('pre_out');
  S('movem.l', '(a7)', 'd0-d7/a0-a3/a5'); S('lea', '52(a7)', 'a7');
  S('move.l', '#0x454c44', 'd2'); S('rts');
  // TX1: d1 -> port a5 (wait TXDE); RX1: port a5 -> d1 (wait RXDF). d4 = 0 on timeout.
  s.label('TX1'); S('move.l', '#0x400000', 'd4');
  s.label('tx_w'); S('subq.l', '#1', 'd4'); S('beq.b', 'tx_r'); S('move.b', '2(a5)', 'd0'); S('btst', '#1', 'd0'); S('beq.b', 'tx_w'); S('move.l', 'd1', '4(a5)');
  s.label('tx_r'); S('rts');
  s.label('RX1'); S('move.l', '#0x400000', 'd4');
  s.label('rx_w'); S('subq.l', '#1', 'd4'); S('beq.b', 'rx_r'); S('move.b', '2(a5)', 'd0'); S('btst', '#0', 'd0'); S('beq.b', 'rx_w');
  S('move.l', '4(a5)', 'd1'); S('and.l', '#0xffffff', 'd1');
  s.label('rx_r'); S('rts');
  s.align(4);
  s.label('pre_done'); S('dc.l', '0');
  s.label('rxw'); for (const w of rx) S('dc.l', String(w));
  s.label('pchunks'); for (const c of preChunks) S('dc.l', String(c)); S('dc.l', '0');
  s.label('chunks'); for (const c of postChunks) S('dc.l', String(c)); S('dc.l', '0');
  s.label('list'); s.bytes('list_data', list);
  const asm = s.assemble();
  if (R.ram.bootCode[0] + asm.bytes.length > R.ram.bootCode[1])
    throw new Error(`the boot code (${asm.bytes.length} bytes) does not fit ${h(R.ram.bootCode[0])}..${h(R.ram.bootCode[1])}`);
  const L = R.loader;
  const jsr = (t: number): Uint8Array => concat([hex('4eb9'), be32(t)]);
  const sites = [
    { at: L.handoff.at, old: L.handoff.old, bytes: jsr(asm.labels.APPLIER), what: 'handoff -> applier' },
    ...(preChunks.length ? [{ at: L.dsp2First.at, old: L.dsp2First.old, bytes: jsr(asm.labels.DSP2PRE), what: "DSP2's first bootstrap command -> pre-boot load" }] : []),
  ];
  return { asm, sites };
}

/** The applier's write list: {u32 address, u32 count, bytes, padded to even}..., 0. */
export function writeList(writes: [number, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [a, b] of writes) {
    parts.push(be32(a), be32(b.length), b);
    if (b.length & 1) parts.push(Uint8Array.of(0));
  }
  parts.push(be32(0));
  return concat(parts);
}
