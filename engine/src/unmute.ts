// Unmute latency: an unmuted track plays its next trig.
//
// On every 1.63-derived OS a track that is unmuted less than about one step before its next trig
// stays silent for that trig, so an unmute on the beat is heard about two steps late. The cause is
// the sequencer's tick worker, which runs on every 1/24-beat tick. On the tick that starts step S it
//   1. plays the queues it built for S: note-on queue A and its note-off queue, swing queue B and
//      its note-off queue, 16 three-byte events [9n, note, velocity] per buffer, double-buffered.
//      Each event goes through the OS's channel-message dispatcher (which triggers the track whose
//      note it is, and tests the track's mute byte), and out of the MIDI port when MIDI out is on;
//   2. toggles the buffer and builds the queues for S+1, one iteration per track with a trig. A
//      muted track is skipped there (`tst.b mute[track]; bne.w next`): nothing is queued for it.
// So an unmute after the start of step S-1 finds step S already built without the track.
//
// The fix moves that mute test from build time to play time, for the queued notes only. Five
// instructions of the base are replaced by calls into a routine of ours in RAM:
//   S1 build start   `clr.l <lockCnt>`         -> jsr h_clr: the same, and clears "queued while muted"
//   S2 mute test     `tst.b -16(a1); bne.w`    -> jsr h_mute; nop: remember the mute byte, do not skip
//   S3 class branch  `cmp.l d1,d5; bne.w`      -> jsr h_cls: MIDI machines still skip when muted
//                                                (as the base does); any other machine is queued,
//                                                and marked when it is muted
//   S4 step play     `adda.l #<localOn>,a0`    -> jsr h_play: the same, then every queued event of a
//                                                marked track that is STILL muted is removed from
//                                                all four queues (note-on and note-off): it is not
//                                                played, not sent and has no note-off, exactly as
//                                                the base treats a muted track
//   S5 tick          `tst.b <playLocks>`       -> jsr h_tick: the grace window, then the same test
// Grace window: a note-on h_play removed is kept for GRACE_TICKS ticks; if its track is unmuted
// within them, h_tick plays it then (note-on, then note-off, through the same dispatcher and MIDI
// send the queue loops use, at the loops' interrupt level), so an unmute just after the trig is
// heard one tick late instead of not at all.
//
// Unchanged: muting (a muted track is still never played or sent), every event of a track that was
// not muted when queued (the base's path byte for byte), MIDI machines, accents and swing (still
// evaluated when queued), the p-lock and slide pass (it tests the mute at play time already), song
// mode and live record. No DSP code.
//
// Found by signature in the base's own code, never by address: the tick worker's entry and play
// loops, the build's buffer toggle, mute test, class branch and queue writes, the OS's note-on
// path (for the note -> track map). A base that rewrites any of them (DEV rewrites the tick
// worker's entry and the build's buffer toggle) does not get the fix.

import { h, u32 } from './bytes.js';
import { Asm } from './cf_asm.js';
import { decodeLinear } from './isa.js';
import { findSig, type CodeImage, type Hit } from './sig.js';

/** Ticks (1/24 beat; a step is 6) an unmute may come after the trig and still play it, one tick late. */
export const GRACE_TICKS = 1;

/** One queue: its first buffer (48 bytes, 16 events, per buffer) and its count (a long per buffer). */
export interface UnmuteQueue { what: string; base: number; count: number; on: boolean }

export interface UnmuteSite { name: string; at: number; label: string; old: Uint8Array }

/** What the fix is written against, every value read from the base's code. */
export interface Unmute {
  sites: UnmuteSite[];
  mute: number;        // byte per track, 1 = muted
  buf: number;         // the queue buffer being played (long, 0 or 1)
  lockCnt: number;     // cleared at the start of the build (S1's instruction)
  playLocks: number;   // tested at the tick worker's entry (S5's instruction)
  slot: number;        // the global slot (byte); 178 bytes per global
  localOn: number;     // + 178 * slot: long, the queues are played internally when set
  revMap: number;      // + 178 * slot + note: the track a note triggers
  midiOut: number;     // long: the queue loops send MIDI only when set
  dispatch: number;    // the channel-message dispatcher (msg)
  uartSend: number;    // MIDI out (n, msg)
  ipl: number;         // the status register the queue loops run at
  queues: UnmuteQueue[];
  skipTo: number;      // the build loop's "next track"
  noteQueue: number;   // the build's note-queue path (every machine but MIDI machines)
}

const one = (images: CodeImage[], sig: string, what: string): Hit => {
  const hits = findSig(images, sig);
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length ? `${hits.length} matches (${hits.slice(0, 3).map((x) => h(x.at)).join(', ')})` : 'not found'}`);
  return hits[0];
};

// The tick worker from its entry through the A queue's play loop (S5, S4, IPL, dispatcher, MIDI
// send). The 178-byte global stride is spelled out by its shifts and subtractions.
const SIG_TICK = '4e56 .... 48d7 .... @s5 4a39 <playLocks> 67 .. 4ab9 ........ 66 .. 2239 ........ 74 .. 4c42 1800 4a80 66 .. ' +
  '4eb9 ........ 4879 ........ 4879 ........ 4eb9 ........ 508f 7601 d7b9 ........ 7801 b8b9 ........ 6600 .... 4ab9 ........ 6e00 .... ' +
  '1439 <slot> 49c2 2002 e588 2202 ed89 9280 9282 2001 e588 9081 d082 2040 @s4 d1fc <localOn> 4a90 6606 4282 6000 .... 4e71 ' +
  '46fc <ipl:2> 4282 60 .. 2001 ed88 e989 9081 d082 0680 <qa> 2f00 4eb9 <dispatch> 588f 4ab9 <midiOut> 67 .. ' +
  '2039 <buf> 2200 ed89 e988 9280 2041 d1fc <qa2> 41f0 2801 4a10 6d .. 2001 d082 0680 <qa3> 2f00 4878 0003 4eb9 <uart> 508f';
// The B queue's play loop: the same dispatcher, MIDI-out flag and interrupt level.
const SIG_PLAY_B = '46fc <ipl:2> 4282 60 .. 2001 ed88 e989 9081 d082 0680 <qb> 2f00 4eb9 <dispatch> 588f 4ab9 <midiOut> 67 ..';
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
// The OS's note-on path: the global's note -> track map, then the track's mute byte.
const SIG_NOTE_ON = '1439 <slot> 49c2 2002 e588 2202 ed89 9280 9282 2001 e588 9081 d082 d08c 41f9 <revMap> 1430 0800';

/** The signatures, for tests and for anyone checking a base by hand. */
export const UNMUTE_SIGNATURES = {
  tick: SIG_TICK, playB: SIG_PLAY_B, build: SIG_BUILD, classBranch: SIG_CLASS, noteQueue: SIG_NOTE, write: SIG_WRITE, noteOn: SIG_NOTE_ON,
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
    const why: string[] = [];
    const same = (what: string, ...v: number[]): void => { if (v.some((x) => x !== v[0])) why.push(`${what} differ (${v.map(h).join(', ')})`); };
    same('the A queue addresses', T.qa.value, T.qa2.value, T.qa3.value, W.qa.value);
    same('the buffer index addresses', T.buf.value, B.buf.value, B.buf2.value);
    same('the global slot addresses', T.slot.value, n.caps.slot.value);
    if (pb.length !== 1) why.push(`the B queue's play loop: ${pb.length} matches`);
    else {
      same('the dispatchers', T.dispatch.value, pb[0].caps.dispatch.value);
      same('the MIDI-out flags', T.midiOut.value, pb[0].caps.midiOut.value);
      same("the queue loops' interrupt levels", T.ipl.value, pb[0].caps.ipl.value);
    }
    const skipTo = w.caps.skip.at;
    const s2 = B.s2.at, s3 = c.caps.s3.at;
    const target = (at: number, disp: number): number => at + 2 + ((disp << 16) >> 16);
    same('the build\'s "next track" targets', skipTo, target(B.sk1.at - 2, B.sk1.value), target(s2 + 4, B.sk2.value), target(s2 + 10, B.sk3.value));
    const noteQueue = target(s3 + 2, c.caps.nq.value);
    if (!findSig(images, SIG_NOTE).some((x) => x.at === noteQueue)) why.push(`the class branch's note-queue path at ${h(noteQueue)} is not the base's`);
    if (s3 < s2 || s3 > s2 + 0x100 || w.at < s3 || w.at > s3 + 0x200 || b.at > s2) why.push('the build loop\'s pieces are not in one routine');
    if (T.ipl.value !== 0x2400 && T.ipl.value !== 0x2700) why.push(`the queue loops run at ${h(T.ipl.value)}`);
    if (why.length) return { unmute: null, why: why.join('; ') };
    const site = (name: string, at: number, label: string, len: number): UnmuteSite => ({ name, at, label, old: bytesAt(images, at, len)! });
    const U: Unmute = {
      sites: [
        site('build start', B.s1.at, 'h_clr', 6),
        site('mute test', s2, 'h_mute', 8),
        site('class branch', s3, 'h_cls', 6),
        site('step play', T.s4.at, 'h_play', 6),
        site('tick', T.s5.at, 'h_tick', 6),
      ],
      mute: B.muteHi.value - 16, buf: T.buf.value, lockCnt: B.lockCnt.value, playLocks: T.playLocks.value,
      slot: T.slot.value, localOn: T.localOn.value, revMap: n.caps.revMap.value, midiOut: T.midiOut.value,
      dispatch: T.dispatch.value, uartSend: T.uart.value, ipl: T.ipl.value,
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
      why: `the tick worker's step play at ${h(T.s4.at)} and tick test at ${h(T.s5.at)}, the build's mute test at ${h(s2)}, ` +
           `its class branch at ${h(s3)} and start at ${h(B.s1.at)}; queues at ${U.queues.map((q) => h(q.base)).join(', ')}`,
    };
  } catch (e) {
    return { unmute: null, why: (e as Error).message };
  }
}

/** The routines and their data at `org`. */
export function unmuteAsm(org: number, A: Unmute, grace = GRACE_TICKS): Asm {
  if (!(Number.isInteger(grace) && grace >= 0 && grace <= 3)) throw new Error(`unmute grace ${grace}: 0..3 ticks`);
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
  // h_play: in place of `adda.l #localOn,a0` (a0 = 178 * slot) on the tick that plays the step's
  // queues. Every register is preserved; a0 leaves as the base's instruction leaves it.
  a.label('h_play');
  I('adda.l', `#${A.localOn}`, 'a0');
  I('lea', '-52(a7)', 'a7'); I('movem.l', 'd0-d7/a0-a4', '(a7)');
  I('move.l', L(A.buf), 'd0'); I('lsl.l', '#2', 'd0'); I('lea', '@pm', 'a1'); I('adda.l', 'd0', 'a1');
  I('move.l', '(a1)', 'd2'); I('beq.w', 'hp_out');
  I('clr.l', '(a1)');
  // d3 = the tracks queued while muted that are still muted now
  I('moveq', '#0', 'd3'); I('moveq', '#0', 'd1'); I('lea', L(A.mute), 'a2');
  a.label('hp_m');
  I('btst', 'd1', 'd2'); I('beq.b', 'hp_mn'); I('tst.b', '(a2,d1.l)'); I('beq.b', 'hp_mn'); I('bset', 'd1', 'd3');
  a.label('hp_mn');
  I('addq.l', '#1', 'd1'); I('moveq', '#16', 'd0'); I('cmp.l', 'd1', 'd0'); I('bne.b', 'hp_m');
  I('tst.l', 'd3'); I('beq.w', 'hp_out');
  // a2 = the global's note -> track map
  I('move.b', L(A.slot), 'd0'); I('extb.l', 'd0'); I('muls.w', '#178', 'd0');
  I('lea', L(A.revMap), 'a2'); I('adda.l', 'd0', 'a2');
  I('moveq', '#0', 'd7'); I('move.b', '@grace', 'd7');
  // d1 = buf * 48
  I('move.l', L(A.buf), 'd1'); I('lsl.l', '#4', 'd1'); I('move.l', 'd1', 'd0'); I('add.l', 'd0', 'd1'); I('add.l', 'd0', 'd1');
  for (const q of A.queues) {
    I('lea', L(q.base), 'a0'); I('adda.l', 'd1', 'a0');
    I('move.l', L(A.buf), 'd0'); I('lsl.l', '#2', 'd0'); I('lea', L(q.count), 'a1'); I('adda.l', 'd0', 'a1');
    I('moveq', `#${q.on ? 1 : 0}`, 'd4');
    I('bsr.w', 'hq');
  }
  a.label('hp_out');
  I('movem.l', '(a7)', 'd0-d7/a0-a4'); I('lea', '52(a7)', 'a7'); I('rts');
  // hq: a0 = queue, a1 = &count, d3 = drop mask, d4 = a note-on queue, d7 = grace, a2 = note map.
  // Keeps every other track's events in order; a dropped note-on is kept for the grace window.
  a.label('hq');
  I('move.l', '(a1)', 'd5'); I('ble.b', 'hq_ret');
  I('move.l', 'a0', 'a3'); I('moveq', '#0', 'd6');
  a.label('hq_l');
  I('moveq', '#0', 'd0'); I('move.b', '1(a0)', 'd0'); I('move.b', '(a2,d0.l)', 'd0');
  I('moveq', '#15', 'd2'); I('cmp.l', 'd0', 'd2'); I('bcs.b', 'hq_keep');
  I('btst', 'd0', 'd3'); I('beq.b', 'hq_keep');
  I('tst.l', 'd4'); I('beq.b', 'hq_next'); I('tst.l', 'd7'); I('beq.b', 'hq_next');
  I('lea', '@pend', 'a4'); I('lsl.l', '#2', 'd0'); I('adda.l', 'd0', 'a4');
  I('move.b', '(a0)', '(a4)'); I('move.b', '1(a0)', '1(a4)'); I('move.b', '2(a0)', '2(a4)'); I('move.b', 'd7', '3(a4)');
  I('move.b', 'd7', '@anyp');
  I('bra.b', 'hq_next');
  a.label('hq_keep');
  I('move.b', '(a0)', '(a3)'); I('move.b', '1(a0)', '1(a3)'); I('move.b', '2(a0)', '2(a3)'); I('addq.l', '#3', 'a3'); I('addq.l', '#1', 'd6');
  a.label('hq_next');
  I('addq.l', '#3', 'a0'); I('subq.l', '#1', 'd5'); I('bne.b', 'hq_l');
  I('move.l', 'd6', '(a1)');
  a.label('hq_ret'); I('rts');
  // h_tick: in place of `tst.b playLocks` at the worker's entry (every tick, playing or not);
  // returns with that instruction's flags. Plays a kept note-on whose track has been unmuted
  // since, and counts the others down.
  a.label('h_tick');
  I('tst.b', '@anyp'); I('beq.w', 'ht_ret');
  I('lea', '-28(a7)', 'a7'); I('movem.l', 'd0-d4/a2-a3', '(a7)');
  I('move.w', 'sr', 'd4'); I('move.w', `#${A.ipl}`, 'sr');                     // as the queue loops
  I('moveq', '#0', 'd3'); I('moveq', '#0', 'd2'); I('lea', '@pend', 'a2');
  a.label('ht_l');
  I('moveq', '#0', 'd0'); I('move.b', '3(a2)', 'd0'); I('beq.b', 'ht_n');
  I('lea', L(A.mute), 'a3'); I('tst.b', '(a3,d2.l)'); I('bne.b', 'ht_dec');
  I('clr.b', '3(a2)'); I('bsr.w', 'fire'); I('bra.b', 'ht_n');
  a.label('ht_dec');
  I('subq.l', '#1', 'd0'); I('move.b', 'd0', '3(a2)'); I('beq.b', 'ht_n'); I('moveq', '#1', 'd3');
  a.label('ht_n');
  I('addq.l', '#4', 'a2'); I('addq.l', '#1', 'd2'); I('moveq', '#16', 'd0'); I('cmp.l', 'd2', 'd0'); I('bne.b', 'ht_l');
  I('move.b', 'd3', '@anyp');
  I('move.w', 'd4', 'sr');
  I('movem.l', '(a7)', 'd0-d4/a2-a3'); I('lea', '28(a7)', 'a7');
  a.label('ht_ret');
  I('tst.b', L(A.playLocks)); I('rts');
  // fire: a2 = a kept note-on: its note-on, then its note-off (velocity 0), each through the
  // dispatcher (when the global plays the queues internally) and out of the MIDI port, as the
  // queue loops do
  a.label('fire');
  I('bsr.b', 'f_one'); I('clr.b', '2(a2)');
  a.label('f_one');
  I('move.b', L(A.slot), 'd0'); I('extb.l', 'd0'); I('muls.w', '#178', 'd0');
  I('lea', L(A.localOn), 'a3'); I('tst.l', '(a3,d0.l)'); I('beq.b', 'f_tx');
  I('move.l', 'a2', '-(a7)'); I('jsr', L(A.dispatch)); I('addq.l', '#4', 'a7');
  a.label('f_tx');
  I('tst.l', L(A.midiOut)); I('beq.b', 'f_ret'); I('tst.b', '1(a2)'); I('bmi.b', 'f_ret');
  I('move.l', 'a2', '-(a7)'); I('pea', '0x3.w'); I('jsr', L(A.uartSend)); I('addq.l', '#8', 'a7');
  a.label('f_ret');
  I('rts');
  a.label('code_end');
  a.align(4);
  a.bytes('flag', [0]); a.bytes('anyp', [0]); a.bytes('grace', [grace]); a.bytes('pad', [0]);
  a.bytes('pm', new Array(8).fill(0));
  a.bytes('pend', new Array(64).fill(0));
  a.label('end');
  return a;
}

export interface UnmuteBlock {
  at: number;
  /** code then data, a whole number of longwords */
  bytes: Uint8Array;
  codeBytes: number;
  labels: Record<string, number>;
  grace: number;
}

/** The routines assembled at `at` (4-aligned), padded to longwords for the boot copy. */
export function unmuteBlock(A: Unmute, at: number, grace = GRACE_TICKS): UnmuteBlock {
  if (at % 4) throw new Error(`the unmute routines must be 4-aligned, not at ${h(at)}`);
  const r = unmuteAsm(at, A, grace).assemble();
  const bytes = new Uint8Array((r.bytes.length + 3) & ~3);
  bytes.set(r.bytes);
  return { at, bytes, codeBytes: r.labels.code_end - at, labels: r.labels, grace };
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
 * starts, and calls and jumps only to the dispatcher, the MIDI send and the build loop's two
 * continuations. Returns the problems (empty: fine) and the instruction count.
 */
export function checkUnmuteCode(A: Unmute, code: Uint8Array, at: number): { problems: string[]; count: number } {
  const ins = decodeLinear(code, at);
  const starts = new Set(ins.map((i) => i.at));
  const problems: string[] = [];
  for (const i of ins) if (!i.ok || i.mac) problems.push(`${h(i.at)} ${i.name}: ${i.why ?? 'not ISA_A'}`);
  const outside = [A.dispatch, A.uartSend, A.skipTo, A.noteQueue];
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
  'unmute.calls': [U.dispatch, U.uartSend, U.skipTo, U.noteQueue],
  'unmute.data': [U.mute, U.buf, U.slot, U.localOn, U.revMap, U.midiOut],
});

