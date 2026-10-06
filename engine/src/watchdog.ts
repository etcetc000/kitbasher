// DSP1's DMA0 overrun watchdog, and the debug option that raises its trip count.
//
// DSP1's DMA0 interrupt handler counts frames the main loop was too late for in X:$647. On the
// third entry without a main-loop clear it writes 0 to the DMA1 control register and jumps to
// itself forever: the Machinedrum goes silent until it is power-cycled. Stock 1.63, X.13 and the
// DEV base all carry the same fifteen instructions:
//
//   9c2  527000 000646   move a2,x:>$646            save A
//   9c4  547000 000645   move a1,x:>$645
//   9c6  507000 000644   move a0,x:>$644
//   9c8  08f4ac c861c0   movep #>$c861c0,x:<<$ffffec   re-arm the codec's DMA0
//   9ca  56f000 000647   move x:>$647,a             the miss counter
//   9cc  014180          add #<$1,a
//   9cd  014385          cmp #<$3,a                 <- the trip count
//   9ce  05140a          bge $9d8                   the Nth miss: panic (the store below is skipped,
//   9cf  567000 000647   move a,x:>$647                so the counter stops at N-1)
//   9d1  54f000 000645   move x:>$645,a1            restore A and return
//   9d3  52f000 000646   move x:>$646,a2
//   9d5  50f000 000644   move x:>$644,a0
//   9d7  000004          rti
//   9d8  08f4a8 000000   movep #>$0,x:<<$ffffe8     panic: the link DMA off
//   9da  0c09da          jmp $9da                   and spin here forever
//
// The count is the six-bit immediate of that one `cmp` word. The DSP56k immediate-short data-ALU
// form is `0000 0001 01nnnnnn 1000 dccc`: the operand is bits 13..8, unsigned, zero-extended, so
// the count can be rewritten to anything from 0 to 63 by changing one 24-bit word and nothing else.
//
// Raising it is a debug option (CLI --dsp1-watchdog N, off by default and not in the web UI): a
// machine that costs too much gets N-1 tolerated late blocks, which glitch, instead of one halt that
// silences the unit. It does not make the workload fit and does not remove the halt: with a
// sustained overrun the unit still stops, just N blocks later. Disabling the halt itself (the
// panic at P:$9d8) is a different change that this option does not make.

import { records } from './dsp.js';

export const WATCHDOG_MIN = 3;
export const WATCHDOG_MAX = 0x3f;      // the immediate is six bits

/** `cmp #<$n,a`, the immediate-short form: bits 13..8 hold the operand. */
const CMP_MASK = 0xffc0ff;
const CMP_CODE = 0x014085;
export const cmpWord = (n: number): number => CMP_CODE | ((n & WATCHDOG_MAX) << 8);
export const cmpCount = (w: number): number => (w >>> 8) & WATCHDOG_MAX;

/**
 * The handler word by word from its first instruction. `null` is the `cmp` (any count); `'self'`
 * is the panic's jump to itself, the only word that names its own address. Everything else is
 * literal, including the X addresses the handler saves through and the counter at X:$647, so the
 * routine is recognised wherever it sits.
 */
const HANDLER: (number | null | 'self')[] = [
  0x527000, 0x000646, 0x547000, 0x000645, 0x507000, 0x000644,   // save A
  0x08f4ac, 0xc861c0,                                           // re-arm codec DMA0
  0x56f000, 0x000647,                                           // move x:>$647,a
  0x014180,                                                     // add #<$1,a
  null,                                                         // cmp #<$N,a
  0x05140a,                                                     // bge +10 (the panic below)
  0x567000, 0x000647,                                           // move a,x:>$647
  0x54f000, 0x000645, 0x52f000, 0x000646, 0x50f000, 0x000644,   // restore A
  0x000004,                                                     // rti
  0x08f4a8, 0x000000,                                           // movep #>$0,x:<<$ffffe8
  'self',                                                       // jmp *
];
const COUNT_AT = HANDLER.indexOf(null);                         // 11 words in
const SELF_AT = HANDLER.length - 1;                             // the last, $9da
const INSTRUCTIONS = 15;                                        // in HANDLER.length = 25 words

export const COUNTER = 0x647;      // X:$647, the miss counter every site names

/**
 * A counter clear: `move #$0,x0 ; move x0,x:>$647`. The DEV, X.13 and 1.63 uploads have two of
 * them, the main loop's (just above the handler) and the one in DSP1's DMA set-up.
 */
const CLEAR = [0x240000, 0x447000, COUNTER];

/** `move <reg>,x:>$nnn`: a long-absolute write to X (a read has $f000 where this has $7000). */
const isXWrite = (w: number): boolean => (w & 0xffff) === 0x7000;

export interface Watchdog {
  /** P address of the handler's first word */
  at: number;
  /** P address of the `cmp`, and its index in the upload's word stream (the record that wins) */
  countAt: number;
  index: number;
  /** the `cmp` word as the upload has it, and the trip count it encodes */
  word: number;
  count: number;
  /** P addresses of the `move #$0,x0 ; move x0,x:>$647` clears, in order */
  clears: number[];
  /** the routine's length in 24-bit words (its 15 instructions) */
  words: number;
}

export class NoWatchdog extends Error {}

/** The upload's P memory as DSP1 ends up with it (later records win), with each word's stream index. */
function pMem(w: number[]): Map<number, { v: number; i: number }> {
  const { recs } = records(w);
  const mem = new Map<number, { v: number; i: number }>();
  for (const r of recs) if (r.tag === 0) for (let k = 0; k < r.count; k++) mem.set(r.addr + k, { v: w[r.index + 3 + k], i: r.index + 3 + k });
  return mem;
}

/**
 * The one watchdog in a DSP1 upload, by its own instructions: never by address. Refuses unless
 * exactly one handler and exactly one main-loop clear are there, so a firmware whose watchdog
 * moved, was altered or was already patched is reported instead of silently patched.
 */
export function findWatchdog(w: number[]): Watchdog {
  const mem = pMem(w);
  const at: number[] = [];
  for (const [a, e] of mem) {
    if (e.v !== HANDLER[0]) continue;
    let ok = true;
    for (let k = 1; k < HANDLER.length && ok; k++) {
      const got = mem.get(a + k);
      const want = HANDLER[k];
      if (got === undefined) ok = false;
      else if (want === null) ok = (got.v & CMP_MASK) === CMP_CODE;
      else if (want === 'self') ok = got.v === (0x0c0000 | (a + k));
      else ok = got.v === want;
    }
    if (ok) at.push(a);
  }
  if (at.length !== 1) {
    throw new NoWatchdog(`the DSP1 DMA0 overrun watchdog (${HANDLER.length} words ending in a jump to itself, counting X:$${COUNTER.toString(16)}): ` +
                         `${at.length} in this upload, expected one`);
  }
  const a = at[0];
  // Every write of the counter in the whole upload must be the handler's own store or a clear to
  // zero: otherwise something else drives it and raising the trip count means something else too.
  const clears: number[] = [];
  const other: number[] = [];
  for (const [p, e] of mem) {
    if (!isXWrite(e.v) || mem.get(p + 1)?.v !== COUNTER) continue;
    if (p === a + COUNT_AT + 2) continue;                                       // the handler's `move a,x:>$647`
    if (CLEAR.every((v, k) => mem.get(p - 1 + k)?.v === v)) clears.push(p - 1);
    else other.push(p);
  }
  const hx = (v: number): string => `$${v.toString(16)}`;
  if (other.length) {
    throw new NoWatchdog(`X:${hx(COUNTER)} is written outside the handler and its clears, at P:${other.map(hx).join(', P:')}`);
  }
  if (!clears.length) {
    throw new NoWatchdog(`no clear of X:${hx(COUNTER)} (move #$0,x0 ; move x0,x:>${hx(COUNTER)}) in this upload: nothing resets the miss count`);
  }
  const c = mem.get(a + COUNT_AT)!;
  return { at: a, countAt: a + COUNT_AT, index: c.i, word: c.v, count: cmpCount(c.v), clears: clears.sort((x, y) => x - y), words: HANDLER.length };
}

/**
 * A copy of the upload's words with the watchdog's trip count set to `n`, and nothing else touched:
 * one 24-bit word, in the record that already carries it.
 */
export function setWatchdog(w: number[], n: number): { words: number[]; wd: Watchdog; from: number; to: number } {
  if (!Number.isInteger(n) || n < WATCHDOG_MIN || n > WATCHDOG_MAX) {
    throw new Error(`--dsp1-watchdog ${n}: the trip count is a whole number from ${WATCHDOG_MIN} to ${WATCHDOG_MAX} (the immediate is six bits)`);
  }
  const wd = findWatchdog(w);
  const to = cmpWord(n);
  const out = w.slice();
  out[wd.index] = to;
  return { words: out, wd, from: wd.word, to };
}

/**
 * The gate: in the upload the build is about to pack, the watchdog sits where the base has it, the
 * whole routine is byte for byte the base's apart from the count word, and the count word holds the
 * count that was asked for. Read back from both streams, not from what the patcher believed.
 */
export function checkWatchdog(baseWords: number[], outWords: number[], n: number): { ok: boolean; detail: string } {
  let b: Watchdog, o: Watchdog;
  try { b = findWatchdog(baseWords); } catch (e) { return { ok: false, detail: `in the base: ${(e as Error).message}` }; }
  try { o = findWatchdog(outWords); } catch (e) { return { ok: false, detail: `in the built upload: ${(e as Error).message}` }; }
  const mb = pMem(baseWords), mo = pMem(outWords);
  const differ: number[] = [];
  for (let k = 0; k < o.words; k++) {
    const x = mb.get(b.at + k)?.v, y = mo.get(o.at + k)?.v;
    if (x !== y) differ.push(o.at + k);
  }
  const hx = (v: number): string => `$${v.toString(16)}`;
  // nothing but the count word changed (asking for the count the base already has is a no-op)
  const extra = differ.filter((x) => x !== o.countAt);
  const only = !extra.length && b.clears.join() === o.clears.join();
  const ok = o.at === b.at && b.count === WATCHDOG_MIN && o.count === n && only;
  return {
    ok,
    detail: ok
      ? `P:${hx(o.at)}..${hx(o.at + o.words - 1)} (${INSTRUCTIONS} instructions, ${o.words} words) byte for byte the base's but for the trip count at ` +
        `P:${hx(o.countAt)}: cmp #<${hx(b.count)},a ${b.word.toString(16).padStart(6, '0')} -> cmp #<${hx(n)},a ${o.word.toString(16).padStart(6, '0')}; ` +
        `X:${hx(COUNTER)} written only there and by the clears at P:${o.clears.map(hx).join(', P:')}; ` +
        `the halt at P:${hx(o.at + SELF_AT)} now needs ${n} consecutive misses`
      : o.at !== b.at ? `the watchdog moved: base P:${hx(b.at)}, built P:${hx(o.at)}`
        : b.count !== WATCHDOG_MIN ? `the base's trip count is ${b.count}, not the ${WATCHDOG_MIN} this option is written for`
          : o.count !== n ? `the built upload's trip count is ${o.count}, not the ${n} asked for`
            : `the routine changed at P:${extra.map(hx).join(', P:')}, not only at the count word P:${hx(o.countAt)}`,
  };
}
