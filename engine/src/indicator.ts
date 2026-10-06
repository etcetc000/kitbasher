// --cpu-indicator: while DSP1 keeps reporting overruns (--dsp1-recover, engine/src/recover.ts), the
// transport icons (record dot, play triangle, stop square) are replaced by an inverted "CPU!" box,
// and it clears about half a second after the last overrun. On a screen without the transport area
// a 4 x 4 block in the top-left corner is inverted instead.
//
// The flag
// --------
// --dsp1-recover raises DSP1's HDI08 host flags: HF3 while its voice feed is muted, HF2 sticky once
// it has happened (HCR = $1c while late, $0c on the heal). DSP1's HDI08 is at $500000 on the
// ColdFire bus, so the host-side ISR is the byte at $500002, HF3 = bit 4, HF2 = bit 3. The OS never
// touches HF2/HF3. Reading the ISR is one bus read: it costs DSP1 nothing and cannot block.
//
// How the LCD is driven
// ---------------------
// The glass sits behind the panel controller on UART2; the OS sends it 8x8 tiles. An LCD flush,
// which the OS runs about 52 times a second whatever the screen, (1) clears a 1,024-byte frame
// (pointer <next>), (2) composes every visible window into it, (3) diffs it tile by tile against the
// frame it sent last (pointer <prev>) and sends the tiles that differ, (4) swaps the pointers.
// Anything written into the frame between (2) and (3) reaches the glass; the next flush that does not
// write it sends the OS's own tile back. Frame layout: byte x*8 + (7 - page) is column x of that page,
// bit (y & 7) is row y (LSB = top).
//
// Two hooks, found by signature
// -----------------------------
// 1. The flush. Step (3) begins `move.l <prev>,d5`; it becomes `jsr <draw>` (six bytes for six) and
//    <draw> ends with that same load. Found as: `2a39 <prev>` + `clr.l d3 ; movea.l d3,a0 ; clr.l d4 ;
//    lea (a0,d5.l),a3 ; movea.l x(a7),a2 ; adda.l a0,a2 ; movea.l a0,a1 ; bra.b` + the byte compare,
//    the pointer swap `2039 <next> 2839 <prev> 23c4 <next> 23c0 <prev>` after it, `7007 9083`
//    (page = 7 - d3) between, and the routine's entry loading <next> and clearing 64 x 16 bytes.
// 2. The ColdFire's fastest periodic interrupt, Timer 1 (IRQ2, 347 Hz). OS start-up installs its
//    handler with `move.l #<handler>,(a7) ; jsr <install>` where <install> stores its argument at
//    VBR + $64 (autovector 2) and programs the timer; the handler is in internal SRAM. The
//    immediate is repointed at <poll>, which ORs HF3 into a latch and `jmp`s to the OS's handler.
//    It touches no stack and restores d0, so the OS's task switch sees exactly the frame and
//    registers it would have. Found as: `2ebc <H> 4eba <d16> 588f` with H in
//    $1000000..$1001fff, and the jsr's target storing `move.l 4(a7),$64(a1)` within its first $40
//    bytes; exactly once.
//
//    The same start-up then stores the same handler as the TRAP #0 vector (the tasks' software yield,
//    `move.l #<H>,d0 ; move.l d0,$80(a0)`); that immediate is repointed too, so <poll> runs on the
//    timer and on every yield: 177 + ~170 = ~350 a second, measured in the emulator.
//
// Persistence
// -----------
// <poll> samples HF3 ~350 times a second (every ~2.9 ms) into a latch; <draw> reads and clears the latch
// each flush, together with HF3 and HF2 right now. Any HF3 seen since the last flush, or HF2 changing
// (its first 0 -> 1 after power-on catches even an event too short for both), restarts a hold of HOLD
// flushes (~0.5 s). So the cue stays up while overruns keep coming and clears ~0.5 s after the last
// one seen. Limit: an HF3 pulse shorter than 2.9 ms can fall between two polls (DSP1 heals on the next
// healthy DMA0 entry, 1.45 ms); a sustained overload keeps producing them, so the chance that every
// one of them is missed for 0.5 s is small, but not zero. A DSP1-side minimum HF3 hold of a few
// milliseconds (in engine/src/recover.ts) would close the gap; it is not implemented.
//
// The cue
// -------
// The transport area is columns 0..30, rows 18..30 of the pattern screen: the frame border on column
// 0, the divider on column 30, and between them nothing but the record dot (x 4..8, y 22..26), the
// play triangle (x 12..16, y 21..27) and the stop square (x 20..24, y 22..26) -- measured with the
// emulator's LCD in the stopped, playing, record-armed and song modes. <draw> first checks that the
// frame being sent looks like that (border and divider lit, nothing lit outside the three icon boxes);
// if so it overwrites columns 1..29, rows 19..29 with an inverted box carrying "CPU!", else it XORs
// the corner block x 2..5, y 1..4. Cost: when nothing is late, <poll> is 6 instructions at 347 Hz and
// <draw> ~20 at 52 Hz, ~3,000 cycles a second of 33 M; while the cue is up, ~3,000 cycles a flush.

import { be32, concat, h, hex } from './bytes.js';

/** DSP1's HDI08 on the ColdFire bus, and the ISR bits --dsp1-recover raises. */
export const DSP1_ISR = 0x500002;
export const HF3_MASK = 0x10;
export const HF2_MASK = 0x08;
/** Flushes the cue is held for after the last overrun seen: 26 at 52 Hz = 0.5 s. */
export const HOLD = 26;
/** The fallback: columns x0..x1, rows y0..y1, all inside page 0. */
export const CUE = { x0: 2, x1: 5, y0: 1, y1: 4 };

/** The transport area and what may be lit in it. */
export const AREA = { x0: 0, x1: 30, y0: 18, y1: 30 };
export const ICONS: { name: string; x0: number; x1: number; y0: number; y1: number }[] = [
  { name: 'record', x0: 4, x1: 8, y0: 22, y1: 26 },
  { name: 'play', x0: 12, x1: 16, y0: 21, y1: 27 },
  { name: 'stop', x0: 20, x1: 24, y0: 22, y1: 26 },
];
/** What is overwritten, and the inverted box inside it (x 1 and 29 stay clear). */
export const PUT = { x0: 1, x1: 29, y0: 19, y1: 29 };
export const BOX = { x0: 2, x1: 28, y0: 19, y1: 29 };
/** "CPU!" in 5 x 7, knocked out of the box, top-left at (6, 21). */
export const GLYPH_AT = { x: 6, y: 21 };
export const GLYPH = [
  '.###..####..#...#...#',
  '#...#.#...#.#...#...#',
  '#.....#...#.#...#...#',
  '#.....####..#...#...#',
  '#.....#.....#...#...#',
  '#...#.#.....#...#....',
  '.###..#......###....#',
];

/** Row y of a page is bit (y & 7) of its column byte (LSB = top row). */
export const cueMask = (): number => {
  let m = 0;
  for (let y = CUE.y0; y <= CUE.y1; y++) m |= 1 << (y & 7);
  return m;
};
/** The frame byte for column x in page p. */
export const frameByte = (x: number, page: number): number => x * 8 + (7 - page);

const rowsMask = (page: number, y0: number, y1: number): number => {
  let m = 0;
  for (let y = Math.max(y0, page * 8); y <= Math.min(y1, page * 8 + 7); y++) m |= 1 << (y & 7);
  return m;
};
const pages = (y0: number, y1: number): number[] => { const p: number[] = []; for (let k = y0 >> 3; k <= y1 >> 3; k++) p.push(k); return p; };

/** The pixel (x, y) of the cue: true = lit. */
export function cuePixel(x: number, y: number): boolean {
  if (x < BOX.x0 || x > BOX.x1 || y < BOX.y0 || y > BOX.y1) return false;
  const gx = x - GLYPH_AT.x, gy = y - GLYPH_AT.y;
  const on = gy >= 0 && gy < GLYPH.length && gx >= 0 && gx < GLYPH[0].length && GLYPH[gy][gx] === '#';
  return !on;
}

/** [frame offset, mask, expected]: (byte & mask) == expected on every entry = the transport screen. */
export function checkTable(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = AREA.x0; x <= AREA.x1; x++) {
    for (const p of pages(AREA.y0, AREA.y1)) {
      const m = rowsMask(p, AREA.y0, AREA.y1);
      if (x === AREA.x0 || x === AREA.x1) { out.push([frameByte(x, p), m, m]); continue; }
      let icon = 0;
      for (const b of ICONS) if (x >= b.x0 && x <= b.x1) icon |= rowsMask(p, b.y0, b.y1);
      const mm = m & ~icon;
      if (mm) out.push([frameByte(x, p), mm, 0]);
    }
  }
  return out;
}

/** [frame offset, keep mask, value]: byte = (byte & keep) | value. */
export function putTable(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = PUT.x0; x <= PUT.x1; x++) {
    for (const p of pages(PUT.y0, PUT.y1)) {
      const m = rowsMask(p, PUT.y0, PUT.y1);
      let v = 0;
      for (let y = Math.max(PUT.y0, p * 8); y <= Math.min(PUT.y1, p * 8 + 7); y++) if (cuePixel(x, y)) v |= 1 << (y & 7);
      out.push([frameByte(x, p), ~m & 0xff, v]);
    }
  }
  return out;
}

/** The cue as ASCII, rows y0..y1 of columns 0..31, over a blank transport area. */
export function cueAscii(): string[] {
  const rows: string[] = [];
  for (let y = AREA.y0 - 1; y <= AREA.y1 + 1; y++) {
    let s = '';
    for (let x = 0; x <= 31; x++) {
      const inPut = x >= PUT.x0 && x <= PUT.x1 && y >= PUT.y0 && y <= PUT.y1;
      const border = (x === 0 || x === 30) && y <= 30;
      s += inPut ? (cuePixel(x, y) ? '#' : '.') : border ? '#' : '.';
    }
    rows.push(s);
  }
  return rows;
}

export interface Site {
  /** the 6-byte `move.l <prev>,d5` this option replaces with `jsr <draw>` */
  site: number;
  /** the pointer to the last-sent frame, and the pointer to the frame being built */
  prev: number; next: number;
  /** the flush routine's entry and its pointer swap, for the report */
  flush: number; swap: number;
  /** the Timer 1 handler's immediate in the OS start-up, the handler it names, and the installer */
  timerOperand: number; timerHandler: number; timerInstall: number;
  /** the same handler stored as the TRAP #0 vector (VBR + $80, the tasks' software yield), when the
   *  start-up does it with `move.l #<H>,d0 ; move.l d0,$80(a0)`: repointed too, so <poll> also runs
   *  on every yield, which doubles its rate. null when absent. */
  trapOperand: number | null;
}

export class NoIndicator extends Error {}

const r32 = (b: Uint8Array, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Does `b` at `o` match `pat` (hex byte pairs, `..` = any byte, spaces ignored)? */
function match(b: Uint8Array, o: number, pat: string): boolean {
  const p = pat.replace(/\s+/g, '');
  if (o < 0 || o + p.length / 2 > b.length) return false;
  for (let k = 0; k < p.length; k += 2) {
    const t = p.slice(k, k + 2);
    if (t === '..') continue;
    if (b[o + k / 2] !== parseInt(t, 16)) return false;
  }
  return true;
}

export const DIFF_HEAD = '4283 2043 4284 47f05800 246f.... d5c8 2248 60.. 4281 1213 4280 1012 508b 508a b081';
export const PAGE_FLIP = '7007 9083';
export const FRAME_CLEAR = '2f48.... 7040 4298 4298 4298 4298 5380 66f4';
/** SRAM, where the OS keeps its interrupt handlers */
export const SRAM: [number, number] = [0x1000000, 0x1002000];

type Flush = Omit<Site, 'timerOperand' | 'timerHandler' | 'timerInstall' | 'trapOperand'>;
type Timer = { timerOperand: number; timerHandler: number; timerInstall: number; trapOperand: number | null };

/** Every flush hook in one code image (`org`: its run-time base). */
export function findSites(cf: Uint8Array, org: number): Flush[] {
  const hits: Flush[] = [];
  let targets: number[] | null = null;
  for (let o = 0; o + 64 <= cf.length; o += 2) {
    if (cf[o] !== 0x2a || cf[o + 1] !== 0x39 || !match(cf, o + 6, DIFF_HEAD)) continue;
    const prev = r32(cf, o + 2);
    let swap = -1, next = -1;
    for (let k = o + 6; k < Math.min(cf.length - 24, o + 0x100); k += 2) {
      if (cf[k] === 0x20 && cf[k + 1] === 0x39 && cf[k + 6] === 0x28 && cf[k + 7] === 0x39 && r32(cf, k + 8) === prev &&
          cf[k + 12] === 0x23 && cf[k + 13] === 0xc4 && r32(cf, k + 14) === r32(cf, k + 2) &&
          cf[k + 18] === 0x23 && cf[k + 19] === 0xc0 && r32(cf, k + 20) === prev) {
        swap = org + k; next = r32(cf, k + 2); break;
      }
    }
    if (swap < 0) continue;
    let flip = false;
    for (let k = o + 6; k < swap - org; k += 2) if (match(cf, k, PAGE_FLIP)) { flip = true; break; }
    if (!flip) continue;
    if (!targets) {
      targets = [];
      for (let k = 0; k + 6 <= cf.length; k += 2) if (cf[k] === 0x4e && cf[k + 1] === 0xb9) targets.push(r32(cf, k + 2));
    }
    const below = targets.filter((t) => t <= org + o);
    if (!below.length) continue;
    const flush = Math.max(...below);
    const e = flush - org;
    let head = -1;
    for (let k = e; k >= 0 && k < e + 16 && k < o; k += 2) {
      if (cf[k] === 0x20 && cf[k + 1] === 0x79 && r32(cf, k + 2) === next) { head = k; break; }
    }
    if (head < 0 || !match(cf, head + 6, FRAME_CLEAR)) continue;
    hits.push({ site: org + o, prev, next, flush, swap });
  }
  return hits;
}

/**
 * The flush hook, exactly once over every image of the base's code as it runs (the ColdFire slot,
 * the SRAM copy, an add-on and its scatter entries): a base that carries a second copy of the flush
 * -- one that could be the one that runs -- is refused, not guessed at. The hook must be in the
 * ColdFire slot, the only image whose words the patch list may rewrite at boot for this option.
 */
export function findSite(cf: Uint8Array, org: number, others: { what: string; bytes: Uint8Array; ram: number }[] = []): Site {
  // the flush's diff, then the Timer 1 install (and its TRAP #0 store): each exactly once
  const all = [{ what: 'ColdFire slot', bytes: cf, ram: org }, ...others]
    .flatMap((i) => findSites(i.bytes, i.ram).map((s) => ({ s, what: i.what })));
  if (all.length !== 1) {
    throw new NoIndicator(`the LCD flush's diff (move.l <prev>,d5 ; clr.l d3 ; ... ; the byte compare, with the pointer ` +
      `swap and the frame clear): ${all.length} in this base's code${all.length ? ` (${all.map((x) => `${x.what} ${h(x.s.site)}`).join(', ')})` : ''}, expected one`);
  }
  if (all[0].what !== 'ColdFire slot') throw new NoIndicator(`the LCD flush's diff is in the base's ${all[0].what} at ${h(all[0].s.site)}, not in the ColdFire slot`);
  const t = [{ what: 'ColdFire slot', bytes: cf, ram: org }, ...others].flatMap((i) => findTimers(i.bytes, i.ram).map((x) => ({ x, what: i.what })));
  if (t.length !== 1) {
    throw new NoIndicator(`the Timer 1 handler install (move.l #<SRAM handler>,(a7) ; jsr <installer storing it at VBR+$64>): ` +
      `${t.length} in this base's code${t.length ? ` (${t.map((x) => `${x.what} ${h(x.x.timerOperand)}`).join(', ')})` : ''}, expected one`);
  }
  if (t[0].what !== 'ColdFire slot') throw new NoIndicator(`the Timer 1 handler install is in the base's ${t[0].what} at ${h(t[0].x.timerOperand)}, not in the ColdFire slot`);
  return { ...all[0].s, ...t[0].x };
}

/** Every Timer 1 (autovector 2) handler install in one image: `move.l #<H>,(a7) ; jsr <install>(pc) ; addq.l #4,a7`. */
export function findTimers(cf: Uint8Array, org: number): Timer[] {
  const hits: Timer[] = [];
  for (let o = 0; o + 12 <= cf.length; o += 2) {
    if (cf[o] !== 0x2e || cf[o + 1] !== 0xbc || cf[o + 6] !== 0x4e || cf[o + 7] !== 0xba || cf[o + 10] !== 0x58 || cf[o + 11] !== 0x8f) continue;
    const H = r32(cf, o + 2);
    if (H < SRAM[0] || H >= SRAM[1]) continue;
    const d = ((cf[o + 8] << 8) | cf[o + 9]) << 16 >> 16;
    const t = o + 8 + d;
    if (t < 0 || t + 0x40 > cf.length) continue;
    let stores = false;
    for (let k = t; k < t + 0x40; k += 2) if (match(cf, k, '236f 0004 0064')) { stores = true; break; }
    if (!stores) continue;
    // the TRAP #0 store of the same handler, within $20 bytes after: move.l #H,d0 ; move.l d0,$80(a0)
    let trap: number | null = null;
    for (let k = o + 12; k < o + 0x20 && k + 12 <= cf.length; k += 2) {
      if (cf[k] === 0x20 && cf[k + 1] === 0x3c && r32(cf, k + 2) === H && match(cf, k + 6, '2140 0080')) { trap = org + k + 2; break; }
    }
    hits.push({ timerOperand: org + o + 2, timerHandler: H, timerInstall: org + t, trapOperand: trap });
  }
  return hits;
}

/** The Timer 1 install, exactly once in one image (kept for callers that scan the slot alone). */
export function findTimer(cf: Uint8Array, org: number): Timer {
  const hits = findTimers(cf, org);
  if (hits.length !== 1) {
    throw new NoIndicator(`the Timer 1 handler install (move.l #<SRAM handler>,(a7) ; jsr <installer storing it at VBR+$64>): ` +
      `${hits.length} in this base's ColdFire code, expected one`);
  }
  return hits[0];
}

export interface Parts {
  /** where the code goes */
  at: number;
  site: Site;
}

export interface Stub {
  bytes: Uint8Array;
  /** the flush's entry (jsr target) and the Timer 1 wrapper's entry */
  draw: number; poll: number;
  /** state words and tables */
  seen: number; counter: number; latch: number; tsave: number; chk: number; put: number;
  codeBytes: number;
}

/**
 * The code, ISA_A only (MCF5206e: no byte compare or byte and/or on registers, so every byte goes
 * through a cleared register as a long).
 *
 * poll (Timer 1, 347 Hz; no stack used):
 *   move.l d0,tsave ; move.b $500002,d0 ; andi.l #$10,d0 ; or.l d0,latch ; move.l tsave,d0 ; jmp <H>
 *
 * draw (jsr from the flush, between compose and diff):
 *   lea -24(a7),a7 ; movem.l d0-d3/a0-a1,(a7)
 *   moveq #0,d0 ; move.b $500002,d0 ; andi.l #$18,d0         HF3 | HF2 now
 *   move.l latch,d1 ; clr.l latch ; or.l d1,d0              | HF3 seen by poll since the last flush
 *   move.l d0,d2 ; moveq #8,d3 ; and.l d3,d2                 HF2
 *   move.l seen,d1 ; move.l d2,seen ; cmp.l d1,d2 ; bne hold HF2 changed
 *   moveq #$10,d3 ; and.l d3,d0 ; bne hold                   HF3 now or latched
 *   move.l cnt,d0 ; beq.w out ; subq.l #1,d0 ; move.l d0,cnt ; bra show
 *   hold: moveq #HOLD,d0 ; move.l d0,cnt
 *   show: movea.l <next>,a0
 *         lea chk,a1 ; moveq #NCHK,d3
 *   c:    off -> d0, frame byte -> d1, mask -> d2, and.l, expected -> d2, cmp.l ; bne corner
 *         subq.l #1,d3 ; bne c
 *         lea put,a1 ; moveq #NPUT,d3
 *   p:    off -> d0, frame byte -> d1, keep -> d2, and.l, value -> d2, or.l, move.b d1,(a0,d0.l)
 *         subq.l #1,d3 ; bne p ; bra out
 *   corner: moveq #mask,d0 ; 4 x { move.b off(a0),d1 ; eor.l d0,d1 ; move.b d1,off(a0) }
 *   out:  movem.l (a7),d0-d3/a0-a1 ; lea 24(a7),a7
 *         move.l <prev>,d5 ; rts                              the instruction the jsr replaced
 * data: seen, cnt, latch, tsave (longs), chk table, put table (3 bytes an entry)
 */
export function stub(p: Parts): Stub {
  const out: Uint8Array[] = [];
  let n = 0;
  const put = (...xs: Uint8Array[]): void => { for (const x of xs) { out.push(x); n += x.length; } };
  const label: Record<string, number> = {};
  const holes: [number, number, string, boolean][] = [];
  const br = (op: number, to: string): void => { holes.push([out.length, n, to, false]); out.push(Uint8Array.of(op, 0)); n += 2; };
  const brw = (op: number, to: string): void => { holes.push([out.length, n, to, true]); out.push(Uint8Array.of(op, 0, 0, 0)); n += 4; };
  const at = (name: string): void => { label[name] = n; };
  const refs: [number, string][] = [];
  const ref = (name: string): void => { refs.push([out.length, name]); out.push(new Uint8Array(4)); n += 4; };
  const chk = checkTable(), pt = putTable();
  if (chk.length > 127 || pt.length > 127) throw new Error('indicator tables too long for moveq');
  const byteIn = (): void => { put(hex('7000'), hex('1019')); };     // moveq #0,d0 ; move.b (a1)+,d0

  // ---- poll
  at('poll');
  put(hex('23c0')); ref('tsave');                       // move.l d0,tsave
  put(hex('1039'), be32(DSP1_ISR));                     // move.b $500002,d0
  put(hex('0280'), be32(HF3_MASK));                     // andi.l #$10,d0
  put(hex('81b9')); ref('latch');                       // or.l d0,latch
  put(hex('2039')); ref('tsave');                       // move.l tsave,d0
  put(hex('4ef9'), be32(p.site.timerHandler));          // jmp <the OS's Timer 1 handler>
  // ---- draw
  at('draw');
  put(hex('4fefffe8'), hex('48d7030f'));                // lea -24(a7),a7 ; movem.l d0-d3/a0-a1,(a7)
  put(hex('7000'), hex('1039'), be32(DSP1_ISR));        // moveq #0,d0 ; move.b $500002,d0
  put(hex('0280'), be32(HF3_MASK | HF2_MASK));          // andi.l #$18,d0
  put(hex('2239')); ref('latch');                       // move.l latch,d1
  put(hex('42b9')); ref('latch');                       // clr.l latch
  put(hex('8081'));                                     // or.l d1,d0
  put(hex('2400'), Uint8Array.of(0x76, HF2_MASK), hex('c483'));   // move.l d0,d2 ; moveq #8,d3 ; and.l d3,d2
  put(hex('2239')); ref('seen');                        // move.l seen,d1
  put(hex('23c2')); ref('seen');                        // move.l d2,seen
  put(hex('b481'));                                     // cmp.l d1,d2
  br(0x66, 'hold');                                     // bne.b hold
  put(Uint8Array.of(0x76, HF3_MASK), hex('c083'));      // moveq #$10,d3 ; and.l d3,d0
  br(0x66, 'hold');                                     // bne.b hold
  put(hex('2039')); ref('cnt');                         // move.l cnt,d0
  brw(0x67, 'out');                                     // beq.w out
  put(hex('5380'));                                     // subq.l #1,d0
  put(hex('23c0')); ref('cnt');                         // move.l d0,cnt
  br(0x60, 'show');                                     // bra.b show
  at('hold');
  put(Uint8Array.of(0x70, HOLD));                       // moveq #HOLD,d0
  put(hex('23c0')); ref('cnt');                         // move.l d0,cnt
  at('show');
  put(hex('2079'), be32(p.site.next));                  // movea.l <next>,a0
  put(hex('43f9')); ref('chk');                         // lea chk,a1
  put(Uint8Array.of(0x76, chk.length));                 // moveq #NCHK,d3
  at('c');
  byteIn();                                             // offset -> d0
  put(hex('7200'), hex('12300800'));                    // moveq #0,d1 ; move.b (a0,d0.l),d1
  put(hex('7400'), hex('1419'), hex('c282'));           // moveq #0,d2 ; move.b (a1)+,d2 ; and.l d2,d1
  put(hex('7400'), hex('1419'), hex('b282'));           // moveq #0,d2 ; move.b (a1)+,d2 ; cmp.l d2,d1
  br(0x66, 'corner');                                   // bne.b corner
  put(hex('5383'));                                     // subq.l #1,d3
  br(0x66, 'c');                                        // bne.b c
  put(hex('43f9')); ref('put');                         // lea put,a1
  put(Uint8Array.of(0x76, pt.length));                  // moveq #NPUT,d3
  at('p');
  byteIn();
  put(hex('7200'), hex('12300800'));                    // moveq #0,d1 ; move.b (a0,d0.l),d1
  put(hex('7400'), hex('1419'), hex('c282'));           // keep: and.l d2,d1
  put(hex('7400'), hex('1419'), hex('8282'));           // value: or.l d2,d1
  put(hex('11810800'));                                 // move.b d1,(a0,d0.l)
  put(hex('5383'));                                     // subq.l #1,d3
  br(0x66, 'p');                                        // bne.b p
  br(0x60, 'out');                                      // bra.b out
  at('corner');
  put(Uint8Array.of(0x70, cueMask()));                  // moveq #mask,d0
  for (let x = CUE.x0; x <= CUE.x1; x++) {
    const off = frameByte(x, 0);
    put(hex('1228'), Uint8Array.of(0, off));            // move.b off(a0),d1
    put(hex('b181'));                                   // eor.l d0,d1
    put(hex('1141'), Uint8Array.of(0, off));            // move.b d1,off(a0)
  }
  at('out');
  put(hex('4cd7030f'), hex('4fef0018'));                // movem.l (a7),d0-d3/a0-a1 ; lea 24(a7),a7
  put(hex('2a39'), be32(p.site.prev));                  // move.l <prev>,d5   the replaced instruction
  put(hex('4e75'));                                     // rts
  const codeBytes = n;
  for (const name of ['seen', 'cnt', 'latch', 'tsave']) { at(name); put(be32(0)); }
  at('chk'); put(Uint8Array.from(chk.flat()));
  at('put'); put(Uint8Array.from(pt.flat()));
  if (n % 2) put(Uint8Array.of(0));
  for (const [i, own, name, word] of holes) {
    const d = label[name] - (own + 2);
    if (word) {
      if (d < -32768 || d > 32767) throw new Error(`the indicator's branch to ${name} is ${d} bytes, out of range`);
      out[i][2] = (d >> 8) & 0xff; out[i][3] = d & 0xff;
      continue;
    }
    if (d === 0 || d < -128 || d > 127) throw new Error(`the indicator's branch to ${name} is ${d} bytes, out of range`);
    out[i][1] = d & 0xff;
  }
  for (const [i, name] of refs) out[i].set(be32(p.at + label[name]));
  const bytes = concat(out);
  if (bytes.length !== n) throw new Error('the indicator did not assemble to its own length');
  const A = (k: string): number => p.at + label[k];
  return { bytes, draw: A('draw'), poll: A('poll'), seen: A('seen'), counter: A('cnt'), latch: A('latch'),
           tsave: A('tsave'), chk: A('chk'), put: A('put'), codeBytes };
}

/**
 * The patches: the longwords covering the flush's 6-byte `move.l <prev>,d5`, rewritten to
 * `jsr <draw>` with the bytes around it kept, and the Timer 1 handler's immediate -> <poll>.
 * `orig(a)` reads the base's longword at a.
 */
export function hookPatches(site: Site, s: { draw: number; poll: number }, orig: (a: number) => number):
  { patches: [number, number][]; checks: [number, number][] } {
  const lo = site.site & ~3, hi = (site.site + 6 + 3) & ~3;
  const old = new Uint8Array(hi - lo);
  for (let a = lo; a < hi; a += 4) old.set(be32(orig(a)), a - lo);
  const nw = old.slice();
  nw.set(concat([hex('4eb9'), be32(s.draw)]), site.site - lo);
  const patches: [number, number][] = [], checks: [number, number][] = [];
  for (let a = lo; a < hi; a += 4) {
    patches.push([a, r32(nw, a - lo)]);
    checks.push([a, r32(old, a - lo)]);
  }
  patches.push([site.timerOperand, s.poll]);
  checks.push([site.timerOperand, site.timerHandler]);
  if (site.trapOperand !== null) {
    patches.push([site.trapOperand, s.poll]);
    checks.push([site.trapOperand, site.timerHandler]);
  }
  return { patches, checks };
}

/**
 * The gate: the code in the RAM image is the bytes this build emitted; <poll> ends in a jmp to the
 * OS's own Timer 1 handler; <draw> reads the ISR, ends with the replaced load and rts; the state
 * words start at zero; the patch list is exactly the two hooks.
 */
export function checkIndicator(img: Uint8Array, site: Site, at: number, s: Stub,
  patched: [number, number][], orig: (a: number) => number): { ok: boolean; detail: string } {
  const why: string[] = [];
  const want = hookPatches(site, s, orig).patches;
  if (patched.length !== want.length || patched.some(([a, v], k) => a !== want[k][0] || v !== want[k][1])) {
    why.push(`the patch list writes ${patched.map(([a, v]) => `${h(a)}=${h(v)}`).join(', ')}, not ` +
             `${want.map(([a, v]) => `${h(a)}=${h(v)}`).join(', ')}`);
  }
  const code = s.bytes;
  const got = img.subarray(0, code.length);
  const differ = [...code].map((v, k) => (got[k] === v ? -1 : k)).filter((k) => k >= 0);
  if (differ.length) why.push(`the code in the RAM image differs from what was emitted at +${differ.map((k) => k.toString(16)).join(', +')}`);
  const o = (a: number): number => a - at;
  for (const [nm, a] of [['seen', s.seen], ['cnt', s.counter], ['latch', s.latch], ['tsave', s.tsave]] as [string, number][]) {
    if (r32(code, o(a)) !== 0) why.push(`${nm} does not start at zero`);
  }
  const pe = o(s.draw);
  if (!(code[pe - 6] === 0x4e && code[pe - 5] === 0xf9 && r32(code, pe - 4) === site.timerHandler)) {
    why.push(`the Timer 1 wrapper does not end in jmp ${h(site.timerHandler)}`);
  }
  if (!(code[o(s.poll) + 6] === 0x10 && code[o(s.poll) + 7] === 0x39 && r32(code, o(s.poll) + 8) === DSP1_ISR)) {
    why.push(`the Timer 1 wrapper does not read DSP1's ISR`);
  }
  const ce = s.codeBytes;
  if (!(code[ce - 8] === 0x2a && code[ce - 7] === 0x39 && r32(code, ce - 6) === site.prev && code[ce - 2] === 0x4e && code[ce - 1] === 0x75)) {
    why.push(`<draw> does not end with move.l ${h(site.prev)},d5 ; rts`);
  }
  if (at % 4) why.push(`the code is at ${h(at)}, not 4-aligned`);
  return {
    ok: why.length === 0,
    detail: why.length ? why.join('; ')
      : `${code.length} bytes at ${h(at)}: <poll> ${h(s.poll)} on Timer 1 (the OS start-up's handler immediate ${h(site.timerOperand)}: ` +
        `${h(site.timerHandler)} -> ${h(s.poll)}, installed by ${h(site.timerInstall)}; it ORs HF3 into a latch and jmps to ${h(site.timerHandler)}); ` +
        `<draw> ${h(s.draw)} by jsr from the LCD flush's diff at ${h(site.site)} (flush ${h(site.flush)}, frames next ${h(site.next)} / prev ` +
        `${h(site.prev)}), holding ${HOLD} flushes after any HF3 seen or HF2 change; on the transport screen (${checkTable().length}-byte check) ` +
        `it writes ${putTable().length} bytes of an inverted "CPU!" box over x ${PUT.x0}..${PUT.x1} y ${PUT.y0}..${PUT.y1}, elsewhere it XORs ` +
        `x ${CUE.x0}..${CUE.x1} y ${CUE.y0}..${CUE.y1}; state words zero`,
  };
}
