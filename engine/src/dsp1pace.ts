// DSP1 output pacing (off by default). DSP1's main loop picks the output half it renders next by exact
// equality at P:$3c..$43:
//     movep x:DDR0,a ; cmp #$13f,a ; beq $44 (input $100.., output $400..)
//                     cmp #$17f,a ; beq $49 (input $140.., output $4c0..) ; bra $3c
// DDR0 holds each value for one codec word, about 11 us. A poll away for longer than that at the
// wrong moment (inside an interrupt) misses the value and waits a whole extra half, which loses a block
// on both DSPs and renders the same half twice. Measured on hardware in that state: 13/14..16/17 of the
// blocks and about 30 same-half renders per 255 blocks, at idle, with the loss rate drifting -- a slow
// beat between that window and something long that interrupts DSP1.
//
// The patch: P:$3c becomes `jmp <pace>` (two words; $3e..$43 dead), and pace tests the region, not the
// value, against the half rendered last (X:$641, which P:$4d stores):
//     region A = $13f <= DDR0 < $17f (the first input half is complete), region B = everything else;
//     in A, if the last half rendered was A ($100) keep polling, else go to $44; in B the same with
//     $140 / $49.
// On time, this releases at exactly the stock moment (the region starts at the value stock waits for).
// Late by anything less than a half, it renders the right half late instead of skipping it.
import { h } from './bytes.js';

export const PACE_SITE = 0x3c;
/** the base's words at P:$3c..$3d: movep x:<<$ffffee,a ; cmp #>$13f,a (first word) */
export const PACE_BASE = [0x084e2e, 0x0140c5];
export const PACE_AT = 0x146300;
export const PACE_A = 0x44, PACE_B = 0x49;

/**
 * Re-lock (with pacing and the slack sampler): a request word `req` (set by DSP1's
 * sampler when DSP1 waited for DSP2 in RELOCK_DD or more of 255 samples in two windows running) makes
 * the pace routine drop the half it is about to render: it marks that half as rendered (X:$641) and
 * polls on, so DSP1 renders nothing for one half. DSP2, already released at the last slot 15, finishes
 * its block and parks at its spin; DSP1's next block then finds all sixteen tracks in and toggles PDRC
 * early in its block -- the power-on order. One 0.73 ms half repeats, once per re-lock. `rel` counts them.
 */
export function paceRoutine(at: number = PACE_AT, relock = false): { at: number; words: number[]; loopEnd: number; req: number; rel: number } {
  const w: number[] = [];
  const A = (): number => at + w.length;
  const fix: [number, () => number][] = [];
  const lab: Record<string, number> = {};
  const later = (n: string): void => { fix.push([A(), () => { if (lab[n] === undefined) throw new Error(n); return lab[n]; }]); w.push(0); };
  lab.pace = A();
  w.push(0x084e2e);                         // movep x:<<$ffffee,a     DDR0
  w.push(0x57f000, 0x000641);               // move x:>$641,b          the half rendered last
  w.push(0x0140c5, 0x13f); w.push(0x0af0a9); later('b');   // cmp #>$13f,a ; jlt b
  w.push(0x0140c5, 0x17f); w.push(0x0af0a1); later('b');   // cmp #>$17f,a ; jge b
  const go = (half: number, to: number, n: string): void => {
    if (relock) {                           // a re-lock asked for: drop this half
      w.push(0x07f08f); later('req'); w.push(0x20000b); w.push(0x0af0a2); later(n);   // move p:>req,b ; tst b ; jne drop
    }
    w.push(0x0af080, to);                   // jmp $44 / $49
    if (relock) {
      lab[n] = A();
      w.push(0x20001b, 0x07708d); later('req');                                       // clr b ; move b1,p:>req
      w.push(0x07f08f); later('rel'); w.push(0x014188, 0x07708d); later('rel');       // rel += 1
      w.push(0x57f400, half, 0x557000, 0x000641);                                     // move #>half,b ; move b1,x:>$641
      w.push(0x0af080); later('pace');                                                // jmp pace: wait out this half
    }
  };
  w.push(0x0140cd, 0x100); w.push(0x0af0aa); later('pace');   // region A: cmp #>$100,b ; jeq pace
  go(0x100, PACE_A, 'dropA');
  lab.b = A();
  w.push(0x0140cd, 0x140); w.push(0x0af0aa); later('pace');   // region B: cmp #>$140,b ; jeq pace
  go(0x140, PACE_B, 'dropB');
  const loopEnd = A() - 1;
  if (relock) { lab.req = A(); w.push(0); lab.rel = A(); w.push(0); }
  for (const [a, f] of fix) w[a - at] = f();
  return { at, words: w, loopEnd, req: lab.req ?? -1, rel: lab.rel ?? -1 };
}

/** The records: the routine, and P:$3c..$3d = jmp <routine>. */
export const paceRecords = (p: { at: number; words: number[] }): { space: number; addr: number; words: number[] }[] =>
  [{ space: 0, addr: p.at, words: p.words }, { space: 0, addr: PACE_SITE, words: [0x0af080, p.at] }];

export const paceReport = (p: { at: number; words: number[] }): string => `${p.words.length} words at ${h(p.at)}`;
