// ColdFire code the engine emits itself: the boot routine, its copy loops, and the LEV bar stub.
// All of it is ISA_A only (the MCF5206e has no 68020 forms: no movem through -(An), no
// move.w sr,-(a7)), and none of it touches the stack, which the boot routine must not use.

import { be32, concat, hex } from './bytes.js';

/** lea src,a0 / lea dst,a1 / move.l #n,d0 / 1: move.l (a0)+,(a1)+ / subq.l #1,d0 / bne 1b */
export function copyCode(src: number, dst: number, nlongs: number): Uint8Array {
  return concat([hex('41f9'), be32(src), hex('43f9'), be32(dst), hex('203c'), be32(nlongs), hex('22d8538066fa')]);
}

/**
 * Runs from flash (decoded at 0 during boot) after the base's own boot routine: copy the RAM
 * image, apply the patch list of (address, longword) pairs to the running OS, continue into it.
 */
export function bootRoutine(extSrc: number, extRam: number, nlongs: number, patchSrc: number, npatch: number,
  osMain: number, segment?: [number, number, number]): Uint8Array {
  return concat([
    copyCode(extSrc, extRam, nlongs),
    segment ? copyCode(...segment) : new Uint8Array(0),   // the dynamic-label segment, before anything points at it
    hex('41f9'), be32(patchSrc),                 // lea patches,a0
    hex('203c'), be32(npatch),                   // move.l #n,d0
    hex('225822985380' + '66f8'),                // 2: movea.l (a0)+,a1 ; move.l (a0)+,(a1) ; subq ; bne 2b
    hex('4ef9'), be32(osMain),                   // jmp OS_MAIN
  ]);
}

/**
 * The LEV bar's arm for IDs 0x7c..0x7f: the display's range test leaves them out, so without
 * this arm the bar freezes for those machines. 36 bytes, reached by a jmp over the first arm; `low`
 * is the first arm's own bound, which the stub now owns. The trailing nop keeps the RAM image a
 * whole number of longwords: the boot routine copies longwords.
 */
export function levBarStub(low: number, draw: number, resume: number): Uint8Array {
  const code = concat([
    hex('2001'),                                  // move.l d1,d0
    hex('0680'), be32(-0x7c >>> 0),               // addi.l #-$7c,d0
    hex('7403'),                                  // moveq #3,d2
    hex('b480'),                                  // cmp.l d0,d2
    hex('640e'),                                  // bcc.b draw
    Uint8Array.of(0x70, low),                     // moveq #low,d0
    hex('b081'),                                  // cmp.l d1,d0
    hex('6c08'),                                  // bge.b draw
    hex('2001'),                                  // move.l d1,d0 (displaced from the first arm)
    hex('4ef9'), be32(resume),                    // jmp second arm
    hex('4ef9'), be32(draw),                      // draw: jmp the level bar
  ]);
  if (14 + code[13] !== code.length - 6 || 20 + code[19] !== code.length - 6) throw new Error('LEV stub branches');
  const out = concat([code, hex('4e71').subarray(0, (-code.length & 3))]);
  if (out.length !== 36) throw new Error('LEV stub is not 36 bytes');
  return out;
}

/**
 * The DSP2 half of the OS's two-word host-command sender, with the CVR write moved after the
 * second word.
 *
 * The stock routine, shared with the DSP1 half (which enters two instructions earlier with
 * a0 = $500004) and byte-identical in stock 1.63, stock X.13 and DEV:
 *
 *   movea.l #$600004,a0    DSP2's HDI08 data window (CVR is at -3(a0))
 *   move.l  4(a7),(a0)     word 1 -> TX
 *   moveq   #$89,d0
 *   move.b  d0,-3(a0)      CVR = HC | HV=$09      <- DSP2 takes the interrupt here
 *   move.l  8(a7),d0
 *   subq.l  #1,d0
 *   nop
 *   move.l  d0,(a0)        word 2 -> TX           <- DSP2's spin at P:$ed ends here
 *   movea.l $c(a7),a1
 *   asr.l #1,d0 / bcc / move.l (a1)+,(a0) x2 / subq.l #1,d0 / bpl / rts    data words, taken by DMA0
 *
 * DSP2's HV=$09 handler (P:$e8..$f3) programs DMA0 from the two words and spins on HSR RXDF
 * waiting for the second. Between the CVR write and word 2 the ColdFire runs three instructions,
 * and anything that delays it there is DSP2 cycles burnt inside an interrupt. Writing both words
 * before raising the vector closes that window: the host-to-DSP path is double buffered (TX plus
 * HRX), so word 1 is in HRX and word 2 in TX when DSP2 takes the interrupt and the `brclr` falls
 * straight through. Stock code already reaches that state in 530 of 536 measured handler entries; the
 * reorder makes it certain.
 *
 * d0 carries the second word, so the CVR write -- which needs $89 in a data register, since
 * ColdFire ISA_A has no `move.b #imm,(d16,An)` -- has to come after it, and the count is reloaded
 * from 8(a7). The clobber set is therefore exactly stock's (d0, a0, a1), and the `nop` keeps its
 * place immediately after the CVR write, where stock and the DSP1 sender both have it. 50 bytes
 * against stock's 44: two extra instructions, both after the vector is raised.
 */
export function hostSendReorder(): Uint8Array {
  return hex(
    '207c' + '00600004' +     // movea.l #$600004,a0
    '20af' + '0004' +         // move.l 4(a7),(a0)        word 1
    '202f' + '0008' +         // move.l 8(a7),d0
    '5380' +                  // subq.l #1,d0
    '2080' +                  // move.l d0,(a0)           word 2
    '7089' +                  // moveq #$89,d0
    '1140' + 'fffd' +         // move.b d0,-3(a0)         CVR = HC | HV=$09
    '4e71' +                  // nop
    '202f' + '0008' +         // move.l 8(a7),d0          the count again
    '5380' +                  // subq.l #1,d0
    '226f' + '000c' +         // movea.l $c(a7),a1
    'e280' +                  // asr.l #1,d0
    '6402' +                  // bcc.b +2
    '2099' +                  // move.l (a1)+,(a0)
    '2099' +                  // move.l (a1)+,(a0)
    '5380' +                  // subq.l #1,d0
    '6af8' +                  // bpl.b -8
    '4e75');                  // rts
}

/** Stock's own body, from its DSP2 entry to its rts: what the base holds at the discovered site. */
export const HOST_SEND_STOCK = '207c0060000420af000470891140fffd202f000853804e712080226f000ce28064022099209953806af84e75';

const hx = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * What the reordered sender must be, property by property rather than by one byte compare, so a
 * failure says which property broke. Returns [] when every one holds.
 */
export function hostSendCheck(code: Uint8Array): string[] {
  const bad: string[] = [];
  const b = hx(code);
  const stock = HOST_SEND_STOCK;
  if (b !== hx(hostSendReorder())) bad.push('the emitted bytes are not the reordered sender this engine builds');
  const at = (s: string): number => (b.indexOf(s) < 0 ? -1 : b.indexOf(s) / 2);
  const word1 = at('20af0004'), word2 = at('2080'), cvr = at('1140fffd'), moveq = at('7089'), tail = at('226f000c'), nop = at('4e71');
  if (at('207c00600004') !== 0) bad.push("it does not start by loading a0 = $600004 (DSP2's HDI08 window)");
  if (word1 < 0 || word2 < 0 || cvr < 0 || moveq < 0 || tail < 0 || nop < 0) bad.push('word 1, word 2, the CVR write, the nop or the data loop is missing');
  else {
    if (word1 >= word2) bad.push('word 2 is not written after word 1');
    if (!(word2 < moveq && moveq + 2 === cvr)) bad.push('the CVR write does not come after the second word, which is the whole point of the reorder');
    if (cvr + 4 !== nop) bad.push('the nop does not follow the CVR write, as it follows it in stock and in the DSP1 sender');
    if (cvr >= tail) bad.push('the data loop does not come after the CVR write');
  }
  const reload = (b.match(/202f0008/g) ?? []).length, subq = (b.match(/5380/g) ?? []).length;
  if (reload !== 2 || subq !== 3) bad.push(`the count is loaded ${reload} times and decremented ${subq} (stock 1 and 2, the reorder 2 and 3)`);
  if (tail >= 0 && b.slice(2 * tail) !== stock.slice(stock.indexOf('226f000c'))) bad.push("the data loop and rts are not stock's, byte for byte");
  if (code.length !== 50) bad.push(`${code.length} bytes, not 50`);
  return bad;
}

/** The two longwords that put `jmp stub` over the first arm, with a nop in the two bytes left. */
export function levBarJmp(sites: number[], stub: number): [number, number][] {
  return [[sites[0], (0x4ef90000 | (stub >>> 16)) >>> 0], [sites[1], (((stub << 16) >>> 0) | 0x4e71) >>> 0]];
}
