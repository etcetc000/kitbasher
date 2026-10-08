// Unmute latency: an unmuted track plays its next trig.
//
// On every 1.63-derived OS a track that is unmuted less than about one step before its next trig
// stays silent for that trig, so an unmute on the beat is heard about two steps late. The cause is
// the sequencer's tick worker, which runs on every 1/24-beat tick:
//   * on the tick that starts step S it plays queue A built for S (note-ons, then their note-offs:
//     three-byte events [9n, note, velocity], 16 per buffer, double-buffered). Each event goes
//     through the OS's channel-message dispatcher (which triggers the track whose note it is and
//     tests the track's mute byte) and out of the MIDI port when MIDI out is on. It then latches the
//     buffer for queue B, the swung trigs, and toggles the buffer and builds the queues for S+1, one
//     iteration per track with a trig. A muted track is skipped there (`tst.b mute[track]; bne.w
//     next`): nothing is queued for it;
//   * on the swing tick of step S (the step tick itself at 50% swing, up to 0.6 of a step later at
//     80%) it plays queue B and its note-offs from the latched buffer, the same way.
// So an unmute after the start of step S-1 finds step S already built without the track.
//
// The fix moves that mute test from build time to the moment each queue is played, for queued
// notes only. Five instructions of the base are replaced by calls into routines of ours in RAM:
//   S1 build start  `clr.l <lockCnt>`        -> jsr h_clr: the same, and clears the new buffer's
//                                               "queued while muted" mask
//   S2 mute test    `tst.b -16(a1); bne.w`   -> jsr h_mute; nop: remember the mute byte, do not skip
//   S3 class branch `cmp.l d1,d5; bne.w`     -> jsr h_cls: MIDI machines still skip when muted (as
//                                               the base does); any other machine is queued, and
//                                               marked in the mask when it is muted
//   S4 step play    `adda.l #<localOn>,a0`   -> jsr h_play: the same, then every event of a marked
//                                               track that is STILL muted is removed from queue A
//                                               and its note-offs: not played, not sent, no
//                                               note-off, as the base treats a muted track
//   S5 swing play   `adda.l #<localOn>,a0`   -> jsr h_playB: the same for queue B and its note-offs,
//                                               with the mute as it is on the swing tick
// The rule: a trig plays when its track is unmuted on the tick that plays it (the step tick, or
// for a swung trig the swing tick), as it would had the track been unmuted when it was queued. The
// per-trig passes that follow each queue (p-locks, slides) test the mute byte on that same tick
// already, so a trig kept here gets them too.
//
// Unchanged: muting, every event of a track that was not muted when queued (the base's path byte
// for byte), MIDI machines, accents and swing (still evaluated when queued), song mode and live
// record. No DSP code.
//
// Found by signature in the base's own code, never by address: the tick worker's entry and both
// play loops, the B buffer latch, the build's buffer toggle, mute test, class branch and queue
// writes, the OS's note-on path (for the note -> track map). A base that rewrites any of them (DEV
// rewrites the tick worker's entry and the build's buffer toggle) does not get the fix.

import { h, u32 } from './bytes.js';
import { Asm } from './cf_asm.js';
import { decodeLinear } from './isa.js';
import { findSig, type CodeImage, type Hit } from './sig.js';

/** One queue: its first buffer (48 bytes, 16 events, per buffer) and its count (a long per buffer). */
export interface UnmuteQueue { what: string; base: number; count: number; on: boolean }

export interface UnmuteSite { name: string; at: number; label: string; old: Uint8Array }

/** What the fix is written against, every value read from the base's code. */
export interface Unmute {
  sites: UnmuteSite[];
  mute: number;        // byte per track, 1 = muted
  buf: number;         // the buffer queue A plays and the build toggles (long, 0 or 1)
  bufB: number;        // the buffer queue B plays: latched from `buf` on the step tick
  lockCnt: number;     // cleared at the start of the build (S1's instruction)
  slot: number;        // the global slot (byte); 178 bytes per global
  localOn: number;     // + 178 * slot: long, the queues are played internally when set
  revMap: number;      // + 178 * slot + note: the track a note triggers
  queues: UnmuteQueue[];   // A on, A off, B on, B off
  skipTo: number;      // the build loop's "next track"
  noteQueue: number;   // the build's note-queue path (every machine but MIDI machines)
}

const one = (images: CodeImage[], sig: string, what: string): Hit => {
  const hits = findSig(images, sig);
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length ? `${hits.length} matches (${hits.slice(0, 3).map((x) => h(x.at)).join(', ')})` : 'not found'}`);
  return hits[0];
};

// The tick worker from its entry through queue A's play loop (S4). The 178-byte global stride is
// spelled out by its shifts and subtractions.
const SIG_TICK = '4e56 .... 48d7 .... 4a39 ........ 67 .. 4ab9 ........ 66 .. 2239 ........ 74 .. 4c42 1800 4a80 66 .. ' +
  '4eb9 ........ 4879 ........ 4879 ........ 4eb9 ........ 508f 7601 d7b9 ........ 7801 b8b9 ........ 6600 .... 4ab9 ........ 6e00 .... ' +
  '1439 <slot> 49c2 2002 e588 2202 ed89 9280 9282 2001 e588 9081 d082 2040 @s4 d1fc <localOn> 4a90 6606 4282 6000 .... 4e71 ' +
  '46fc <ipl:2> 4282 60 .. 2001 ed88 e989 9081 d082 0680 <qa> 2f00 4eb9 <dispatch> 588f 4ab9 <midiOut> 67 .. ' +
  '2039 <buf> 2200 ed89 e988 9280 2041 d1fc <qa2> 41f0 2801 4a10 6d .. 2001 d082 0680 <qa3> 2f00 4878 0003 4eb9 <uart> 508f';
// Queue B's play loop on the swing tick (S5): the same shape as A's, reading the latched buffer.
const SIG_PLAY_B = '4ab9 ........ 6e00 .... 1439 <slot> 49c2 2002 e588 2202 ed89 9280 9282 2001 e588 9081 d082 2040 @s5 d1fc <localOn> ' +
  '4a90 6606 4282 6000 .... 4e71 46fc <ipl:2> 4282 60 .. 2001 ed88 e989 9081 d082 0680 <qb> 2f00 4eb9 <dispatch> 588f 4ab9 <midiOut> 67 .. ' +
  '2039 <bufB> 2200 ed89 e988 9280 2041 d1fc <qb2>';
// The step tick latches queue A's buffer for queue B.
const SIG_LATCH = '2439 <buf> 23c2 <bufB> 4ab9';
// The build: buffer toggle, S1, the per-track loop's set-up and mute tests (S2), up to the
// instruction that first loads d0 again (so h_mute may use it).
const SIG_BUILD = '4ab9 <buf> 57c0 1600 49c3 4483 23c3 <buf2> 7090 80b9 ........ 1e00 13c0 ........ @s1 42b9 <lockCnt> 42b9 ........ ' +
  '2839 ........ 2005 e588 2205 ed89 9280 9285 2001 e588 9081 d085 2440 d5fc ........ 42ae ff94 42ae fff4 42ae ff9c 42ae ff98 42ae ff90 4286 ' +
  '43f9 ........ 2d49 ff64 41f9 ........ 2d48 ff6e 43f9 <muteHi> 2d49 ff6a 202e ffb4 206e ffac c0b0 6800 6700 <sk1:2> ' +
  '226e ff6a @s2 4a29 fff0 6600 <sk2:2> 4a11 6600 <sk3:2> 1239 ........ 49c1 2401 e78a 2001';
// S3: the machine-class branch; d5 = 0x60 (MIDI machines) and the base's own successor.
const SIG_CLASS = '0281 0000 00f0 2404 e58a 2004 e988 7a60 @s3 ba81 6600 <nq:2> 2079 ........ 23c8';
// The note-queue path the class branch takes for every other machine (h_cls continues there).
const SIG_NOTE = '226e ff64 22bc ffff ffff 9082 2200 e989 d081 41f9';
// The queue writes, B then A: each event's note-on, its note-off, both counts; then the loop's
// "next track" (moveq #1,d0; add.l d0,-12(a6): -12(a6) is the track).
const SIG_WRITE = '2403 e98a 2203 ed89 4aa8 0008 67 .. 202e ffb4 c093 60 .. 202e ffb4 c0b4 6800 4a80 67 .. ' +
  '9282 2041 d1fc <qb> 226e ff9c 1387 8800 2009 5280 1192 0800 5280 1185 0800 5280 2d40 ff9c 41f9 <cb> 7001 d1b0 3c00 ' +
  '2041 d1fc <qboff> 222e ff98 1187 1800 2001 5280 1192 0800 5280 4202 1182 0800 5280 2d40 ff98 41f9 <cboff> 60 .. ' +
  '9282 2041 d1fc <qa> 226e ff94 1387 8800 2009 5280 1192 0800 5280 1185 0800 5280 2d40 ff94 41f9 <ca> 7001 d1b0 3c00 ' +
  '2041 d1fc <qaoff> 222e ff90 1187 1800 2001 5280 1192 0800 5280 4202 1182 0800 5280 2d40 ff90 41f9 <caoff> ' +
  '7a01 dbb0 3c00 @skip 7001 d1ae fff4';
// The OS's note-on path: the global's note -> track map.
const SIG_NOTE_ON = '1439 <slot> 49c2 2002 e588 2202 ed89 9280 9282 2001 e588 9081 d082 d08c 41f9 <revMap> 1430 0800';

/** The signatures, for tests and for anyone checking a base by hand. */
export const UNMUTE_SIGNATURES = {
  tick: SIG_TICK, playB: SIG_PLAY_B, latch: SIG_LATCH, build: SIG_BUILD, classBranch: SIG_CLASS, noteQueue: SIG_NOTE,
  write: SIG_WRITE, noteOn: SIG_NOTE_ON,
} as const;

const bytesAt = (images: CodeImage[], at: number, n: number): Uint8Array | null => {
  for (const i of images) if (at >= i.ram && at + n <= i.ram + i.bytes.length) return i.bytes.slice(at - i.ram, at - i.ram + n);
  return null;
};

/** The sequencer the fix is written against, or why the base does not have it. */
export function findUnmute(images: CodeImage[]): { unmute: Unmute | null; why: string } {
  try {
    const t = one(images, SIG_TICK, 'the tick worker');
    const T = t.caps;
    const b = one(images, SIG_BUILD, "the build's buffer toggle and mute test");
    const B = b.caps;
    const c = one(images, SIG_CLASS, "the build's machine-class branch");
    const w = one(images, SIG_WRITE, "the build's queue writes");
    const W = w.caps;
    const n = one(images, SIG_NOTE_ON, "the OS's note-on path");
    const pb = findSig(images, SIG_PLAY_B).filter((x) => x.caps.qb.value === W.qb.value);
    if (pb.length !== 1) throw new Error(`queue B's play loop: ${pb.length} matches`);
    const P = pb[0].caps;
    const latch = findSig(images, SIG_LATCH).filter((x) => x.caps.buf.value === T.buf.value && x.caps.bufB.value === P.bufB.value);
    const why: string[] = [];
    const same = (what: string, ...v: number[]): void => { if (v.some((x) => x !== v[0])) why.push(`${what} differ (${v.map(h).join(', ')})`); };
    same('the A queue addresses', T.qa.value, T.qa2.value, T.qa3.value, W.qa.value);
    same('the B queue addresses', P.qb.value, P.qb2.value, W.qb.value);
    same('the buffer index addresses', T.buf.value, B.buf.value, B.buf2.value);
    same('the global slot addresses', T.slot.value, n.caps.slot.value, P.slot.value);
    same('the local-play flags', T.localOn.value, P.localOn.value);
    same('the dispatchers', T.dispatch.value, P.dispatch.value);
    same('the MIDI-out flags', T.midiOut.value, P.midiOut.value);
    same("the queue loops' interrupt levels", T.ipl.value, P.ipl.value);
    if (latch.length !== 1) why.push(`the step tick's latch of queue B's buffer: ${latch.length} matches`);
    if (P.bufB.value === T.buf.value) why.push('queue B plays the build\'s own buffer index');
    const skipTo = w.caps.skip.at;
    const s2 = B.s2.at, s3 = c.caps.s3.at;
    const target = (at: number, disp: number): number => at + 2 + ((disp << 16) >> 16);
    same('the build\'s "next track" targets', skipTo, target(B.sk1.at - 2, B.sk1.value), target(s2 + 4, B.sk2.value), target(s2 + 10, B.sk3.value));
    const noteQueue = target(s3 + 2, c.caps.nq.value);
    if (!findSig(images, SIG_NOTE).some((x) => x.at === noteQueue)) why.push(`the class branch's note-queue path at ${h(noteQueue)} is not the base's`);
    if (s3 < s2 || s3 > s2 + 0x100 || w.at < s3 || w.at > s3 + 0x200) why.push('the build loop\'s pieces are not in one routine');
    if (pb[0].at < t.at || pb[0].at > t.at + 0x1000) why.push("queue B's play loop is not in the tick worker");
    if (why.length) return { unmute: null, why: why.join('; ') };
    const site = (name: string, at: number, label: string, len: number): UnmuteSite => ({ name, at, label, old: bytesAt(images, at, len)! });
    const U: Unmute = {
      sites: [
        site('build start', B.s1.at, 'h_clr', 6),
        site('mute test', s2, 'h_mute', 8),
        site('class branch', s3, 'h_cls', 6),
        site('step play', T.s4.at, 'h_play', 6),
        site('swing play', P.s5.at, 'h_playB', 6),
      ],
      mute: B.muteHi.value - 16, buf: T.buf.value, bufB: P.bufB.value, lockCnt: B.lockCnt.value,
      slot: T.slot.value, localOn: T.localOn.value, revMap: n.caps.revMap.value,
      queues: [
        { what: 'A on', base: W.qa.value, count: W.ca.value, on: true },
        { what: 'A off', base: W.qaoff.value, count: W.caoff.value, on: false },
        { what: 'B on', base: W.qb.value, count: W.cb.value, on: true },
        { what: 'B off', base: W.qboff.value, count: W.cboff.value, on: false },
      ],
      skipTo, noteQueue,
    };
    return {
      unmute: U,
      why: `the tick worker's step play at ${h(T.s4.at)} and swing play at ${h(P.s5.at)}, the build's mute test at ${h(s2)}, ` +
           `its class branch at ${h(s3)} and start at ${h(B.s1.at)}; queues at ${U.queues.map((q) => h(q.base)).join(', ')}`,
    };
  } catch (e) {
    return { unmute: null, why: (e as Error).message };
  }
}

/** The routines and their data at `org`. */
export function unmuteAsm(org: number, A: Unmute): Asm {
  const a = new Asm(org);
  const I = (op: string, ...x: string[]): void => a.i(op, ...x);
  const L = (v: number): string => `0x${v.toString(16)}.l`;
  // h_clr: the build of the next step starts: the base's clr, and pm[new buffer] = 0. a0 is free here.
  a.label('h_clr');
  I('clr.l', L(A.lockCnt));
  I('move.l', L(A.buf), 'a0'); I('adda.l', 'a0', 'a0'); I('adda.l', 'a0', 'a0'); I('adda.l', '#@pm', 'a0');
  I('clr.l', '(a0)'); I('rts');
  // h_mute: a1 = mute + 16 + track (the build's own pointer): remember the mute byte, never skip.
  // d0 is loaded again before the build reads it.
  a.label('h_mute');
  I('move.b', '-16(a1)', 'd0'); I('move.b', 'd0', '@flag'); I('rts');
  // h_cls: in place of `cmp.l d1,d5 (d5 = 0x60); bne.w noteQueue`. Returns to the base's successor
  // (MIDI machine, not muted), to skipTo (MIDI machine, muted: as the base), or to noteQueue (any
  // other machine; muted: its bit set in pm[buf]; -12(a6) is the track).
  a.label('h_cls');
  I('cmp.l', 'd1', 'd5'); I('bne.b', 'hc_other');
  I('tst.b', '@flag'); I('bne.b', 'hc_skip'); I('rts');
  a.label('hc_skip'); I('addq.l', '#4', 'a7'); I('jmp', L(A.skipTo));
  a.label('hc_other');
  I('tst.b', '@flag'); I('beq.b', 'hc_go');
  I('lea', '-12(a7)', 'a7'); I('movem.l', 'd0-d1/a0', '(a7)');
  I('move.l', '-12(a6)', 'd0'); I('moveq', '#1', 'd1'); I('lsl.l', 'd0', 'd1');
  I('move.l', L(A.buf), 'a0'); I('adda.l', 'a0', 'a0'); I('adda.l', 'a0', 'a0'); I('adda.l', '#@pm', 'a0');
  I('or.l', 'd1', '(a0)');
  I('movem.l', '(a7)', 'd0-d1/a0'); I('lea', '12(a7)', 'a7');
  a.label('hc_go'); I('addq.l', '#4', 'a7'); I('jmp', L(A.noteQueue));
  // h_play / h_playB: in place of `adda.l #localOn,a0` (a0 = 178 * slot) on the tick that plays
  // queue A (B). Every register is preserved; a0 leaves as the base's instruction leaves it.
  for (const [label, buf, tab] of [['h_play', A.buf, 'tA'], ['h_playB', A.bufB, 'tB']] as const) {
    a.label(label);
    I('adda.l', `#${A.localOn}`, 'a0');
    I('lea', '-56(a7)', 'a7'); I('movem.l', 'd0-d7/a0-a5', '(a7)');
    I('move.l', L(buf), 'd0'); I('lea', `@${tab}`, 'a5'); I('bsr.w', 'filt');
    I('movem.l', '(a7)', 'd0-d7/a0-a5'); I('lea', '56(a7)', 'a7'); I('rts');
  }
  // filt: d0 = the buffer, a5 = its two queues ([base, count] x 2). Removes from both every event of
  // a track that was queued while muted (pm[buffer]) and is muted now.
  a.label('filt');
  I('move.l', 'd0', 'd6');
  I('lsl.l', '#2', 'd0'); I('lea', '@pm', 'a1'); I('adda.l', 'd0', 'a1');
  I('move.l', '(a1)', 'd2'); I('beq.w', 'f_out');
  // d3 = the tracks queued while muted that are still muted now
  I('moveq', '#0', 'd3'); I('moveq', '#0', 'd1'); I('lea', L(A.mute), 'a2');
  a.label('f_m');
  I('btst', 'd1', 'd2'); I('beq.b', 'f_mn'); I('tst.b', '(a2,d1.l)'); I('beq.b', 'f_mn'); I('bset', 'd1', 'd3');
  a.label('f_mn');
  I('addq.l', '#1', 'd1'); I('moveq', '#16', 'd0'); I('cmp.l', 'd1', 'd0'); I('bne.b', 'f_m');
  I('tst.l', 'd3'); I('beq.w', 'f_out');
  // a2 = the global's note -> track map; d1 = buffer * 48
  I('move.b', L(A.slot), 'd0'); I('extb.l', 'd0'); I('muls.w', '#178', 'd0');
  I('lea', L(A.revMap), 'a2'); I('adda.l', 'd0', 'a2');
  I('move.l', 'd6', 'd1'); I('lsl.l', '#4', 'd1'); I('move.l', 'd1', 'd0'); I('add.l', 'd0', 'd1'); I('add.l', 'd0', 'd1');
  I('moveq', '#2', 'd4');
  a.label('f_q');
  I('move.l', '(a5)+', 'a0'); I('adda.l', 'd1', 'a0');
  I('move.l', '(a5)+', 'a1'); I('move.l', 'd6', 'd0'); I('lsl.l', '#2', 'd0'); I('adda.l', 'd0', 'a1');
  I('bsr.b', 'hq');
  I('subq.l', '#1', 'd4'); I('bne.b', 'f_q');
  a.label('f_out');
  I('rts');
  // hq: a0 = queue, a1 = &count, d3 = drop mask, a2 = note map. Keeps every other event, in order.
  a.label('hq');
  I('move.l', '(a1)', 'd5'); I('ble.b', 'hq_ret');
  I('move.l', 'a0', 'a3'); I('moveq', '#0', 'd7');
  a.label('hq_l');
  I('moveq', '#0', 'd0'); I('move.b', '1(a0)', 'd0'); I('move.b', '(a2,d0.l)', 'd0');
  I('moveq', '#15', 'd2'); I('cmp.l', 'd0', 'd2'); I('bcs.b', 'hq_keep');
  I('btst', 'd0', 'd3'); I('bne.b', 'hq_next');
  a.label('hq_keep');
  I('move.b', '(a0)', '(a3)'); I('move.b', '1(a0)', '1(a3)'); I('move.b', '2(a0)', '2(a3)'); I('addq.l', '#3', 'a3'); I('addq.l', '#1', 'd7');
  a.label('hq_next');
  I('addq.l', '#3', 'a0'); I('subq.l', '#1', 'd5'); I('bne.b', 'hq_l');
  I('move.l', 'd7', '(a1)');
  a.label('hq_ret'); I('rts');
  a.label('code_end');
  a.align(4);
  const be = (v: number): number[] => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const [qa, qaoff, qb, qboff] = A.queues;
  a.bytes('tA', [...be(qa.base), ...be(qa.count), ...be(qaoff.base), ...be(qaoff.count)]);
  a.bytes('tB', [...be(qb.base), ...be(qb.count), ...be(qboff.base), ...be(qboff.count)]);
  a.bytes('pm', new Array(8).fill(0));
  a.bytes('flag', [0, 0, 0, 0]);
  a.label('end');
  return a;
}

export interface UnmuteBlock {
  at: number;
  /** code then data, a whole number of longwords */
  bytes: Uint8Array;
  codeBytes: number;
  labels: Record<string, number>;
}

/** The routines assembled at `at` (4-aligned), padded to longwords for the boot copy. */
export function unmuteBlock(A: Unmute, at: number): UnmuteBlock {
  if (at % 4) throw new Error(`the unmute routines must be 4-aligned, not at ${h(at)}`);
  const r = unmuteAsm(at, A).assemble();
  const bytes = new Uint8Array((r.bytes.length + 3) & ~3);
  bytes.set(r.bytes);
  return { at, bytes, codeBytes: r.labels.code_end - at, labels: r.labels };
}

/**
 * The patch-list writes: each site becomes `jsr <routine>.l` (+ `nop` for the 8-byte mute test),
 * written as whole longwords from the site, the last completed with the base's own bytes after it.
 * `checks` hold what each longword must be in the base first.
 */
export function unmutePatches(A: Unmute, block: UnmuteBlock, read: (at: number, n: number) => Uint8Array | null):
  { patches: [number, number][]; checks: [number, number][]; ranges: [number, number][] } {
  const patches: [number, number][] = [];
  const checks: [number, number][] = [];
  const ranges: [number, number][] = [];
  for (const s of A.sites) {
    const t = block.labels[s.label];
    const code = Uint8Array.of(0x4e, 0xb9, t >>> 24, (t >>> 16) & 255, (t >>> 8) & 255, t & 255, ...(s.old.length === 8 ? [0x4e, 0x71] : []));
    if (code.length !== s.old.length) throw new Error(`unmute: ${s.name}: ${code.length} new bytes for ${s.old.length}`);
    const span = (code.length + 3) & ~3;
    const base = read(s.at, span);
    if (!base) throw new Error(`unmute: ${s.name} at ${h(s.at)} is in no code image`);
    if (base.subarray(0, s.old.length).some((x, k) => x !== s.old[k])) throw new Error(`unmute: ${s.name} at ${h(s.at)} is not what discovery found`);
    const now = base.slice();
    now.set(code);
    for (let k = 0; k < span; k += 4) { patches.push([s.at + k, u32(now, k)]); checks.push([s.at + k, u32(base, k)]); }
    ranges.push([s.at, s.at + code.length]);
  }
  return { patches, checks, ranges };
}

/**
 * Our routines read back as code: ISA_A throughout, every branch on one of our own instruction
 * starts, and jumps only to the build loop's two continuations. Returns the problems (empty:
 * fine) and the instruction count.
 */
export function checkUnmuteCode(A: Unmute, code: Uint8Array, at: number): { problems: string[]; count: number } {
  const ins = decodeLinear(code, at);
  const starts = new Set(ins.map((i) => i.at));
  const problems: string[] = [];
  for (const i of ins) if (!i.ok || i.mac) problems.push(`${h(i.at)} ${i.name}: ${i.why ?? 'not ISA_A'}`);
  const outside = [A.skipTo, A.noteQueue];
  for (const i of ins) {
    if (i.target === undefined) continue;
    const inside = i.target >= at && i.target < at + code.length;
    if (inside ? !starts.has(i.target) : !outside.includes(i.target)) problems.push(`${h(i.at)} ${i.name} -> ${h(i.target)}`);
  }
  return { problems, count: ins.length };
}

/** The discovered values a profile caches. */
export const unmuteValues = (U: Unmute): Record<string, number[]> => ({
  'unmute.sites': U.sites.map((s) => s.at),
  'unmute.calls': [U.skipTo, U.noteQueue],
  'unmute.data': [U.mute, U.buf, U.bufB, U.lockCnt, U.slot, U.localOn, U.revMap],
});
