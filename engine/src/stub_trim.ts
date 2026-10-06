// DSP2's silence stub, trimmed: what an idle track costs.
//
// A track with nothing to render (no machine, or a machine that is silent) is dispatched to one
// short routine in the base's DSP2 code, the same eleven words in X.13, X.14, the DEV builds and
// 1.63 (P:$10008f in X.14):
//
//   +0   260000            move #$0,y0
//   +1   062080 +8         do #$20,+8       32 zeros into the track's buffer
//   +3   4e5f00            move y0,y:(r7)+
//   +4   063280 +7         do #$32,+7       <- the pad: 50 passes over three nops, every block
//   +6   000000            nop
//   +7   000000            nop
//   +8   000000            nop
//   ...
//   +11  00000c            rts
//
// The pad does no work: it only spends time. Measured on hardware, cutting it to one pass saves
// about 460 cycles per idle track per block, which is DSP2 time the sounding tracks get instead:
// about one more voice of a heavy machine. Together with the DSP1 drive fast path and the
// interruptible P-I clean (engine/src/pi_clean.ts), the trimmed stub holds up on hardware under
// burst tests: 12-16 tracks triggering on one step, kit changes while playing, P-I first triggers.
//
// The trim rewrites one word, the pad's `do` count, from 50 to 1, in the record that already
// carries it. The stub is found by its own words, never by address; a base whose stub is not
// exactly this shape is reported and left alone.

import { records } from './dsp.js';

export const PAD_COUNT_BASE = 0x32;        // 50 passes, every base
export const PAD_COUNT_TRIMMED = 1;

/** `do #n,<abs>` with an 8-bit immediate count n (bits 15..8; the high nibble of the 12-bit count is 0 here) */
const doWord = (n: number): number => 0x060080 | ((n & 0xff) << 8);
const isDoImm = (w: number): boolean => (w & 0xff00ff) === 0x060080 && ((w >> 8) & 0xff) > 0;

/** The stub, word by word from its first instruction. 'to+k' is an absolute target: the stub's address + k. */
type Want = number | { to: number } | 'pad';
const STUB: [number, Want][] = [
  [0, 0x260000], [1, 0x062080], [2, { to: 8 }], [3, 0x4e5f00], [4, 'pad'], [5, { to: 7 }],
  [6, 0x000000], [7, 0x000000], [8, 0x000000], [11, 0x00000c],
];
export const PAD_OFFSET = 4;

export interface Stub {
  /** P address of the stub's first word, and of the pad's `do` */
  at: number;
  pad: number;
  /** the pad word's index in the upload's word stream (the record that wins), its value and count */
  index: number;
  word: number;
  count: number;
}

export class NoStub extends Error {}

function pMem(w: number[]): Map<number, { v: number; i: number }> {
  const { recs } = records(w);
  const mem = new Map<number, { v: number; i: number }>();
  for (const r of recs) if (r.tag === 0) for (let k = 0; k < r.count; k++) mem.set(r.addr + k, { v: w[r.index + 3 + k], i: r.index + 3 + k });
  return mem;
}

/** The one silence stub in a DSP2 upload, by its own words. Refuses unless there is exactly one. */
export function findStub(w: number[]): Stub {
  const mem = pMem(w);
  const hits: number[] = [];
  for (const [a, e] of mem) {
    if (e.v !== STUB[0][1]) continue;
    const ok = STUB.every(([k, want]) => {
      const got = mem.get(a + k)?.v;
      if (got === undefined) return false;
      if (want === 'pad') return isDoImm(got);
      if (typeof want === 'object') return got === a + want.to;
      return got === want;
    });
    if (ok) hits.push(a);
  }
  if (hits.length !== 1) {
    throw new NoStub(`the DSP2 silence stub (move #0,y0; do #$20 of zeros; a do #n pad over three nops; rts): ` +
                     `${hits.length} in this upload, expected one`);
  }
  const at = hits[0];
  const p = mem.get(at + PAD_OFFSET)!;
  return { at, pad: at + PAD_OFFSET, index: p.i, word: p.v, count: (p.v >> 8) & 0xff };
}

export interface StubTrim { words: number[]; stub: Stub; from: number; to: number; applied: boolean; note: string }

/**
 * The upload's words with the stub's pad cut to one pass, or unchanged with a note: when the base's
 * stub is not found exactly once, or its pad is not the stock 50 (already trimmed, or something
 * else changed it).
 */
export function trimStub(w: number[]): StubTrim | { words: number[]; stub: null; applied: false; note: string } {
  let stub: Stub;
  try { stub = findStub(w); } catch (e) {
    if (e instanceof NoStub) return { words: w, stub: null, applied: false, note: `stub trim skipped: ${e.message}` };
    throw e;
  }
  const hx = (v: number): string => `$${v.toString(16)}`;
  if (stub.count !== PAD_COUNT_BASE) {
    return { words: w, stub, from: stub.word, to: stub.word, applied: false,
             note: `stub trim skipped: the silence stub's pad at P:${hx(stub.pad)} counts ${stub.count}, not the stock ${PAD_COUNT_BASE}` };
  }
  const to = doWord(PAD_COUNT_TRIMMED);
  const out = w.slice();
  out[stub.index] = to;
  return { words: out, stub, from: stub.word, to, applied: true,
           note: `silence stub at P:${hx(stub.at)}: pad do #${hx(PAD_COUNT_BASE)} -> do #${hx(PAD_COUNT_TRIMMED)} at P:${hx(stub.pad)}` };
}

/**
 * The gate: read back from the base and the built upload, the stub sits where the base has it, every
 * word of it is the base's but the pad's count, and the count is the one asked for (1 when trimmed,
 * the base's when not).
 */
export function checkStubTrim(baseWords: number[], outWords: number[], trimmed: boolean): { ok: boolean; detail: string } {
  let b: Stub, o: Stub;
  try { b = findStub(baseWords); } catch (e) { return { ok: !trimmed, detail: `in the base: ${(e as Error).message}` }; }
  try { o = findStub(outWords); } catch (e) { return { ok: false, detail: `in the built upload: ${(e as Error).message}` }; }
  const mb = pMem(baseWords), mo = pMem(outWords);
  const differ = STUB.map(([k]) => b.at + k).filter((a) => mb.get(a)?.v !== mo.get(a)?.v && a !== b.pad);
  const want = trimmed ? PAD_COUNT_TRIMMED : b.count;
  const hx = (v: number): string => `$${v.toString(16)}`;
  const ok = o.at === b.at && !differ.length && o.count === want;
  return {
    ok,
    detail: ok
      ? `P:${hx(o.at)}..${hx(o.at + 11)} the base's word for word but the pad at P:${hx(o.pad)}: do #${hx(b.count)} -> do #${hx(o.count)}`
      : o.at !== b.at ? `the stub moved: base P:${hx(b.at)}, built P:${hx(o.at)}`
        : differ.length ? `the stub changed at P:${differ.map(hx).join(', P:')}`
          : `the pad counts ${o.count}, not ${want}`,
  };
}
