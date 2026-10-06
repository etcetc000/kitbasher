// The P-I slice-clean stub.
//
// The stock P-I machines (the base's "P-I" family, IDs 64..72 on every 1.63-lineage base) keep
// their delay lines in a per-track slice of the P-I workspace (PI_WS + slice * track, the track
// from Y:$142), which the DSP2 boot code zeroes once and nothing else clears: P-I BD, SD and RS
// read their rings before writing them. A machine that borrows its track's slice (WORKSPACE 'pi')
// and leaves state there (for example 296 words at +0x400) would have that state played as audio
// by the next stock P-I machine put on the track. So, only when such a machine is in the build,
// each stock P-I init dispatch word is pointed at
//
//     pi<id>:  jsr pi_clr ; jmp <the base's own init for that ID>
//     pi_clr:  move #>track,r0 ; nop ; nop ; move y:(r0),a ; and #>$f,a ; move a1,a ; tfr a,b
//              asl a ; add b,a ; asl #9,a,a ; add #>PI_WS+off,a ; move a1,r0 ; move #0,x0
//              do #n/2,end ; move x0,y:(r0)+ ; end: move x0,y:(r0)+ ; [move x0,y:(r0)+ if n odd]
//              rts
//
// which zeroes exactly the declared span of the new track's slice and then runs the stock init.
// The clear is a DO loop rather than `rep`: REP cannot be interrupted, and a 0x600-word REP of
// external writes on every stock P-I init locks DSP2 out of its host and DMA interrupts long
// enough to freeze the unit when a stock P-I machine plays.
// A stock init reads only r6 and memory, so a, b, x0 and r0 are free; r6 and the m registers are
// left alone. The trigger and render words stay the base's. The words below are that program,
// hand-assembled.

import { h } from './bytes.js';

/** What the base offers: its stock P-I IDs, each one's own init, and the slice geometry. */
export interface PiSlices { ids: number[]; inits: number[]; ws: number; slice: number; track: number }

/** The span to clear, relative to a track's slice base. */
export interface PiSpan { offset: number; words: number }

// An alternative mode, 'dirty', clears only when needed:
//
//   * the slice-using machines' own INIT words enter `jsr pi_mark ; jmp <their init>`, which sets the
//     track's dirty word (16 words after the program, zero at upload: the DSP2 boot zeroes the slices);
//   * a stock P-I init enters `jsr pi_chk ; jmp <the base's init>`; pi_chk reads the dirty word and
//     returns at once when it is zero (the common case, a dozen cycles) and otherwise zeroes it and
//     clears the span with the same DO loop, two stores a pass.
//
//     pi_mark: move #>track,r0 ; nop ; nop ; move y:(r0),a ; and #>$f,a ; move a1,a
//              add #>flags,a ; move a1,r0 ; move #>1,x0 ; nop ; move x0,y:(r0) ; rts
//     pi_chk:  move #>track,r0 ; nop ; nop ; move y:(r0),a ; and #>$f,a ; move a1,a ; tfr a,b
//              add #>flags,a ; move a1,r0 ; nop ; nop ; move y:(r0),a ; tst a ; jeq ret
//              move #0,x0 ; nop ; move x0,y:(r0)
//              tfr b,a ; asl a ; add b,a ; asl #9,a,a ; add #>PI_WS+off,a ; move a1,r0 ; move #0,x0
//              do #n/2,end ; move x0,y:(r0)+ ; end: move x0,y:(r0)+ ; [move x0,y:(r0)+ if n odd]
//     ret:     rts
//
// a, b, x0 and r0 are free in both contexts: the dispatcher calls every init the same way, and an
// init reads only r6 and memory.

const MARK_WORDS = 16, FLAGS = 16;
/** Build-time switch (MD_PI_CLEAN_MODE). 'irq' (the default, tested on hardware): clear on every
 *  stock P-I init with the interruptible DO loop. 'dirty' (opt-in, not yet tested on hardware):
 *  mark + check + DO-loop clear, so a stock P-I init clears only after a slice-using machine has
 *  played on that track. */
export const PI_CLEAN_MODE: 'dirty' | 'irq' = (globalThis as any).process?.env?.MD_PI_CLEAN_MODE === 'dirty' ? 'dirty' : 'irq';
const IRQ_WORDS = (span: number): number => 16 + 2 + 2 + (span & 1) + 1;
const chkWords = (n: number): number => 34 + (n & 1);
export const piStubWords = (n: number, marks = 0, span = 0x600): number =>
  PI_CLEAN_MODE === 'irq' ? 4 * n + IRQ_WORDS(span) : 4 * (n + marks) + MARK_WORDS + chkWords(span) + FLAGS;

/** The stub at `org`: P-I entries (in `pi.ids` order), then mark entries (in `marks` order: each is
 *  [machine ID, its own init address]), pi_mark, pi_chk, then the sixteen dirty words. */
export function piCleanProgram(org: number, pi: PiSlices, span: PiSpan, marks: [number, number][] = []):
    { words: number[]; entries: number[]; markEntries: number[]; clr: number; mark: number; flags: number } {
  if (pi.slice !== 0x600) throw new Error(`the P-I clean stub computes the slice base as 0x600 * track; this base's slice is ${h(pi.slice)}`);
  if (!(span.words > 1 && span.words < 8192)) throw new Error(`P-I clean span of ${span.words} words: 2..8191`);
  if (span.offset < 0 || span.offset + span.words > pi.slice) throw new Error(`P-I clean span ${h(span.offset)}+${span.words} is outside a ${h(pi.slice)}-word slice`);
  const n = pi.ids.length;
  if (PI_CLEAN_MODE === 'irq') {
    if (marks.length) throw new Error('irq mode takes no marks');
    const clr = org + 4 * n, words: number[] = [], entries: number[] = [];
    pi.ids.forEach((_, k) => { entries.push(org + 4 * k); words.push(0x0bf080, clr, 0x0af080, pi.inits[k]); });
    const half = span.words >> 1;
    words.push(0x60f400, pi.track, 0x000000, 0x000000, 0x5ee000, 0x0140c6, 0x00000f, 0x218e00, 0x200009,
      0x200032, 0x200010, 0x0c1d12, 0x0140c0, (pi.ws + span.offset) & 0xffffff, 0x219000, 0x240000);
    const doAt = org + words.length;
    words.push(0x060080 | ((half & 0xff) << 8) | ((half >> 8) & 0xf), doAt + 3, 0x4c5800, 0x4c5800);
    if (span.words & 1) words.push(0x4c5800);
    words.push(0x00000c);
    if (words.length !== piStubWords(n, 0, span.words)) throw new Error('P-I clean irq stub length');
    return { words, entries, markEntries: [], clr, mark: clr, flags: org + words.length };
  }
  const mark = org + 4 * (n + marks.length);
  const clr = mark + MARK_WORDS;
  const flags = clr + chkWords(span.words);
  const words: number[] = [];
  const entries: number[] = [];
  const markEntries: number[] = [];
  pi.ids.forEach((_, k) => { entries.push(org + 4 * k); words.push(0x0bf080, clr, 0x0af080, pi.inits[k]); });
  marks.forEach(([, init], j) => { markEntries.push(org + 4 * (n + j)); words.push(0x0bf080, mark, 0x0af080, init); });
  const track = [0x60f400, pi.track, 0x000000, 0x000000, 0x5ee000, 0x0140c6, 0x00000f, 0x218e00];
  // pi_mark
  words.push(...track, 0x0140c0, flags, 0x219000, 0x44f400, 0x000001, 0x000000, 0x4c6000, 0x00000c);
  if (words.length !== clr - org) throw new Error('pi_mark length');
  // pi_chk
  const half = span.words >> 1;
  const head = [...track, 0x200009,                                       // tfr a,b      b = track
    0x0140c0, flags, 0x219000, 0x000000, 0x000000,                         // r0 = &dirty[track]
    0x5ee000, 0x200003];                                                   // move y:(r0),a ; tst a
  const ret = clr + head.length + 2 + 3 + 8 + 2 + 2 + (span.words & 1);
  words.push(...head, 0x0af0aa, ret,                                       // jeq ret
    0x240000, 0x000000, 0x4c6000,                                          // dirty[track] = 0
    0x200001,                                                              // tfr b,a
    0x200032, 0x200010, 0x0c1d12,                                          // asl a ; add b,a ; asl #9,a,a
    0x0140c0, (pi.ws + span.offset) & 0xffffff,                            // add #>PI_WS+off,a
    0x219000, 0x240000);                                                   // move a1,r0 ; move #0,x0
  const doAt = clr + (words.length - (clr - org));
  words.push(0x060080 | ((half & 0xff) << 8) | ((half >> 8) & 0xf), doAt + 3); // do #n/2,end (LA = the 2nd store)
  words.push(0x4c5800, 0x4c5800);                                          // move x0,y:(r0)+ (x2)
  if (span.words & 1) words.push(0x4c5800);
  words.push(0x00000c);                                                    // ret: rts
  if (org + words.length - 1 !== ret) throw new Error(`pi_chk ret at ${h(org + words.length - 1)}, expected ${h(ret)}`);
  if (org + words.length !== flags) throw new Error('pi_chk length');
  for (let i = 0; i < FLAGS; i++) words.push(0);
  if (words.length !== piStubWords(n, marks.length, span.words)) throw new Error('P-I clean stub length');
  return { words, entries, markEntries, clr, mark, flags };
}

/** The hull of the spans the selected machines declare (one span in practice). */
export function piSpanOf(spans: PiSpan[]): PiSpan | null {
  if (!spans.length) return null;
  const lo = Math.min(...spans.map((s) => s.offset));
  const hi = Math.max(...spans.map((s) => s.offset + s.words));
  return { offset: lo, words: hi - lo };
}

/**
 * The gate: in the built upload `mem` (P words), every
 * stock P-I ID's init word points at a stub entry that is exactly `jsr <inside our stub> ; jmp
 * <the base's own init for that ID>`, the routine it calls is the clear routine for `span`, and
 * the base's trigger and render words for those IDs are untouched.
 */
export function checkPiClean(mem: Map<number, number>, baseMem: Map<number, number>, dispatch: { init: number; trigger: number; render: number },
  pi: PiSlices, span: PiSpan, stub: [number, number], marks: [number, number][] = []): { ok: boolean; detail: string } {
  const bad: string[] = [];
  let clr: number | null = null;
  pi.ids.forEach((id, k) => {
    const own = baseMem.get(dispatch.init + id + 1);
    const e = mem.get(dispatch.init + id + 1);
    const w = e === undefined ? [] : [0, 1, 2, 3].map((i) => mem.get(e + i));
    const ok = own === pi.inits[k] && e !== undefined && e >= stub[0] && e + 4 <= stub[1] && w[0] === 0x0bf080 &&
      w[1] !== undefined && w[1] >= stub[0] && w[1] < stub[1] && w[2] === 0x0af080 && w[3] === own &&
      (['trigger', 'render'] as const).every((t) => mem.get(dispatch[t] + id + 1) === baseMem.get(dispatch[t] + id + 1));
    if (clr === null && w[1] !== undefined) clr = w[1];
    if (!ok || w[1] !== clr) bad.push(`${id}: init ${e === undefined ? 'missing' : h(e)} -> ${w.map((x) => (x === undefined ? '?' : h(x))).join(' ')}, the base's init ${own === undefined ? '?' : h(own)}`);
  });
  if (clr !== null) {
    const prog = piCleanProgram(stub[0], pi, span, marks);
    const want = prog.words.slice(prog.clr - stub[0], prog.flags - stub[0]);
    const got = want.map((_, i) => mem.get(clr! + i));
    marks.forEach(([id, init], j) => {
      const e = mem.get(dispatch.init + id + 1);
      const w = e === undefined ? [] : [0, 1, 2, 3].map((i) => mem.get(e + i));
      if (e !== prog.markEntries[j] || w[0] !== 0x0bf080 || w[1] !== prog.mark || w[2] !== 0x0af080 || w[3] !== init)
        bad.push(`machine ${id}: init ${e === undefined ? 'missing' : h(e)} is not the mark entry for its init ${h(init)}`);
    });
    if (got.some((v, i) => v !== want[i])) bad.push(`the clear routine at ${h(clr)} is not the one for ${h(span.offset)}+${span.words}`);
  }
  return {
    ok: bad.length === 0,
    detail: `${pi.ids.length} stock P-I IDs (${pi.ids[0]}..${pi.ids[pi.ids.length - 1]}): each init word enters the slice-clean stub, which ` +
            `zeroes (DO loop${PI_CLEAN_MODE === 'dirty' ? `, only when one of ${marks.length} slice machines marked the track since` : ', every init'}) words ${h(span.offset)}..${h(span.offset + span.words - 1)} of the track's slice (P-I workspace ${h(pi.ws)}, ${h(pi.slice)} per track) ` +
            `and jumps to the base's own init; trigger and render words the base's` + (bad.length ? `; mismatched: ${bad.slice(0, 3).join('; ')}` : ''),
  };
}
