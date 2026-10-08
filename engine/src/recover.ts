// --dsp1-recover: DSP1's DMA0 overrun watchdog recovers instead of halting, and tells the ColdFire.
//
// The stock watchdog (engine/src/watchdog.ts decodes it word for word)
// ---------------------------------------------------------------------
// DSP1's DMA0 interrupt (vector P:$18, `jsset #$0,x:<<$fffff4,$9c2`) fires when DMA0 has taken a
// whole 128-word block off ESSI1's receiver -- 64 audio frames, about 1.45 ms -- and re-arms it.
// The main loop clears X:$647 at the end of every pass (P:$9a5), so in normal operation the counter
// reads 0 in the handler and is stored back as 1. On the third entry with no clear in between, the
// handler writes DCR1 = 0 (P:$9d8: the link DMA that feeds ESSI1's transmitter stops, so the audio
// stops) and jumps to itself forever (P:$9da). The Machinedrum stays silent until it is
// power-cycled, and up to two blocks of garbage come out first.
//
// DSP1's memory map, and where the garbage comes from
// ---------------------------------------------------
// DSP1 is the mixer. The addresses below are DSP1's, read from the disassembly of the DEV, X.14
// and 1.63 uploads, which are identical here:
//
//   Y:$600..$7ff   the DSP2 voice feed. DMA4 (DSR4 = $ffffb8 = ESSI0's receiver, DDR4 = Y:$600,
//                  DCO4 = $1ff) lands DSP2's sixteen tracks here, 32 words a track. The main loop
//                  waits for it at P:$73: DDR4 (X:$ffffde) minus its own read pointer Y:$1c4 must
//                  be at least $20. P:$294 resets Y:$1c2..$1c4 to $600 once a block.
//   X:$100..$17f   the codec's input, DMA0's landing zone, two 64-word halves.
//   X:$400..$57f   the output double buffer: 2 x 192 words = 2 x (32 frames x 6 outputs). The main
//                  loop zeroes one half (P:$2a5, `do #<$c0` at X:$640) and the sixteen tracks and
//                  the master chain accumulate into it while DMA1 sends the other.
//
// A pass that does not reach P:$2a5 accumulates a second time on top of what is already there, and
// repeated accumulation saturates: full-scale +-0.99997 in whole 32-sample blocks, mixed with exact
// repeats of the previous block (a half DMA1 sends twice) and with zero blocks.
//
// What this option does
// ---------------------
// It places a replacement handler in DSP1's free internal program RAM (the top of the same
// $a08..$bff window the DSP1 drive links its laws into) and points the vector's target word at it.
// The base's own handler at P:$9c2..$9da stays byte for byte where it is and becomes unreachable;
// exactly one word of the base changes, the vector's target.
//
// The replacement is the base's fifteen instructions with these differences:
//
//   * The trip count is 2, not 3: it acts on the first missed frame, one block before the halt.
//   * Instead of DCR1 = 0 and a jump to itself, every missed frame zeroes the output double buffer
//     X:$400..$57f (what DMA1 sends), paced at one word per two cycles. The DSP2 voice feed is not
//     touched, since zeroing it starves DMA4 (see PACE). No DMA or ESSI register is written except
//     DCR4's DE on a resync, so DMA1 keeps its phase against ESSI1's six time slots (the outputs
//     cannot come back permuted) and the DMA1 fast interrupt at P:$1a, which re-arms DCR1 every
//     transfer, keeps running. A block that arrived in time is never touched: the handler acts only
//     on an entry where the main loop did not finish a pass.
//   * The first healthy entry after a mute (the heal) zeroes X:$400..$57f once more.
//   * It resyncs the DSP1/DSP2 link through the firmware's own P:$2e restart, but only once DSP2 is
//     known to be parked on its block boundary: DDR4 (DMA4's destination) has not moved across
//     RESYNC_SILENT = 3 consecutive missed frames, and the main loop sits in its per-track wait.
//     Resyncing while DSP2 is merely late splices every track across two mixer slots until
//     power-off (see RESYNC_SILENT).
//   * It raises HCR's two host flags. HF3 (bit 4) is set on every late entry and cleared on the
//     HF3_HOLD-th (8th) consecutive healthy entry after it, so it stays up for the overrun plus
//     11.6 ms -- long enough that the ColdFire's ~171 Hz poll never misses one. HF2 (bit 3) is
//     sticky: this unit has overrun at least once since power-on. The ColdFire reads both in
//     DSP1's ISR at $500002 (bit 4 / bit 3); the OS writes HCR exactly once, at DSP1's own
//     set-up (P:$100067, HCR = $4 = HCIE), and never touches HF2 or HF3.
//
// The counter is clamped at 3, so it can neither run away nor wrap, and every entry after the
// first takes the silent path until the main loop clears it. There is no fallback to the halt: a
// muted output is already silent, while a halted DSP1 stops servicing the host commands the
// ColdFire busy-waits on (P:$9aa, P:$9b6, P:$9bf) and can wedge the UI as well as the audio.
// Staying muted keeps the machine usable and lets it heal itself, and HF2 records that it happened.
//
// Cost when nothing is late: one `jset` on the host flags, 2 words and 4 cycles, once per DMA0
// interrupt (about 690 Hz); nothing else on that path differs from the base. Cost when late: 896
// words written plus about twenty instructions (the DDR4 sample, the silent-run count), against
// the ~147,000 cycles between two DMA0 interrupts.

import { h } from './bytes.js';
import { records as recordsOf } from './dsp.js';
import { findWatchdog } from './watchdog.js';
import { HANDOFF_AT, HANDOFF_ORDERED } from './handoff.js';

/** Our scratch word: r0 while the late path runs. X:$642 is in the handler's own save block
 *  (X:$643..$647) and no instruction in the whole DSP1 upload names it; our own record zeroes it,
 *  because nothing else does and DSP1's RAM comes up dirty. */
export const SCRATCH = 0x642;

/** DSP1's free internal program RAM, the window the DSP1 drive already links into. */
export const P_FREE_END = 0xc00;

/** The DSP2 voice feed: DMA4's landing ring, 16 tracks x 32 words. */
export const FEED = 0x600;
export const FEED_WORDS = 0x200;
/**
 * The main loop's per-track wait for DSP2 (P:$73..$79): `move x:<<$ffffde,b` (DMA4's destination),
 * `move y:>$1c4,x0` (its own read pointer), `sub`, `cmp #<$20,b`, `blt`. A plain branch loop with no
 * DO open, so it is the one place the handler may safely change where the main loop resumes.
 */
export const WAIT_LO = 0x73, WAIT_HI = 0x79;
/**
 * The firmware's own audio-path restart, P:$2e: Y:$1c2..$1c4 = $600, wait for DDR0 to reach $139,
 * `jsr $270` (re-arm DMA2 and DMA4, read RX0 to clear ESSI0's receiver, toggle the PDRC handshake
 * DSP2 waits on), `jmp $294` (zero the output half, restart the sixteen-track pass). This is what
 * the OS itself runs after DSP1's power-on init, so it is a qualified entry point, not ours.
 */
export const RESTART = 0x2e;
/** The output double buffer DMA1 sends: 2 x 192 words = 2 x (32 frames x 6 outputs). */
export const OUT = 0x400;
export const OUT_WORDS = 0x180;

/** HCR, X:$ffffc2: HCIE (bit 2) as DSP1's set-up leaves it, HF2 (bit 3), HF3 (bit 4). */
const HCR = 0xffffc2;
const HCIE = 0x04, HF2 = 0x08, HF3 = 0x10;
const HF3_BIT = 4;

const ioShort = (addr: number): number => {
  if (addr < 0xffffc0 || addr > 0xffffff) throw new Error(`${h(addr)} is not an I/O short address`);
  return addr - 0xffffc0;
};
/** `movep #>imm,x:<<$ffffpp` */
const movepImm = (addr: number, imm: number): number[] => [0x08f480 | ioShort(addr), imm & 0xffffff];
/** `jset #b,x:<<$ffffpp,xxxx` */
const jsetIo = (addr: number, bit: number, to: number): number[] => [0x0a8000 | (ioShort(addr) << 8) | 0xa0 | bit, to];
/** the 9-bit split displacement of the one-word branches: aaaa in bits 9..6, aaaaa in bits 4..0 */
const disp9 = (d: number): number => {
  if (d < -256 || d > 255) throw new Error(`branch displacement ${d} does not fit nine bits`);
  const v = d & 0x1ff;
  return ((v >> 5) << 6) | (v & 0x1f);
};
const bra = (from: number, to: number): number => 0x050c00 | disp9(to - from);
const bcc = (cc: number, from: number, to: number): number => 0x050400 | (cc << 12) | disp9(to - from);
const GE = 0x1, NE = 0x2, LT = 0x9, EQ = 0xa;
/** `move(m)` between a register and P:abs (MMMRRR = 110000, the address in the next word) */
const MOVEM_P_TO_X0 = 0x07f084, MOVEM_X0_TO_P = 0x077084, MOVEM_A1_TO_P = 0x07708c, MOVEM_P_TO_A = 0x07f08e;
/** `do #>n,LA` -- a 12-bit count, LA the address of the body's last instruction */
const doImm = (n: number, la: number): number[] => [0x060000 | ((n & 0xff) << 8) | 0x80 | ((n >> 8) & 0xf), la];

/** The count the base's `cmp` holds, and the one ours holds. */
export const BASE_COUNT = 3;
export const RECOVER_COUNT = 2;
/** The second missed frame and every one after it read at least this. */
const CLAMP = 3;
/**
 * DSP1's port of the DSP2 link: DMA4's destination pointer, DDR4. The main loop's per-track wait
 * reads it too (P:$73); it only moves when a word from DSP2 lands.
 */
const DDR4 = 0xffffde;
/**
 * The resync is only safe with DSP2 parked, and only a silent link shows that it is.
 *
 * P:$2e's `jsr $270` re-bases DMA4 at Y:$600 and toggles PDRC. DSP1 normally does this at the end of
 * every pass, the one moment DSP2 is guaranteed to be parked at its end-of-block spin (P:$bb..$bf)
 * with all 512 words of its block sent: DSP1 reaches P:$270 only once DDR4 has counted all 512 in, and
 * DSP2 cannot start the next block before that toggle. Run while DSP2 is merely late -- still inside
 * its block with `s` words sent -- Y:$600 takes DSP2's word `s` of that block, and the early toggle
 * releases DSP2's next block before DSP1 has the rest of this one. The pipeline then runs on, stable,
 * with every one of DSP1's sixteen 32-word mixer slots holding the tail of one track and the head of
 * the next: each voice's block comes out rotated by `s` samples every 32 (a 1.38 kHz splice that
 * sounds ring-modulated / sample-rate-reduced), through the wrong track's level, pan and sends.
 * Nothing re-bases it afterwards (every later P:$270 re-arms at a boundary DSP2 has already crossed
 * by `s`), a further late resync adds its own `s`, and only a power cycle clears it. The longer the
 * overrun, the further into its block DSP2 is when P:$2e's wait for DDR0 = $139 ends, so the larger `s`.
 *
 * A DSP2 that is only late needs no resync: it finishes the block, DDR4 reaches $800, and the main
 * loop's own P:$270 re-arms on the boundary as always. The resync is for the one state that cannot
 * finish -- DSP1 waiting on words that were lost (a word that reaches ESSI0's receiver while DMA4 is
 * unarmed is overwritten; P:$270 toggles PDRC four instructions before it re-arms DMA4, and any
 * interrupt landing between the two opens that window), so DMA4 never reaches $800 while DSP2 sits
 * parked having sent everything, and DDR4 stops moving for good. The handler therefore samples DDR4
 * on every missed frame and resyncs only after RESYNC_SILENT consecutive missed frames across which
 * it has not moved: DSP2 has sent nothing for three whole DMA0 periods (>= 4.35 ms, sixty-odd blocks'
 * worth of a track render), which a DSP2 still inside its block cannot do. DSP2 is then parked on its
 * block boundary, and P:$2e reproduces the power-on sequence exactly: Y:$600 takes word 0 of DSP2's
 * next block, and one toggle releases exactly that block. The stock watchdog halts on the second
 * consecutive missed frame, so this resync only ever runs in a state the stock firmware treats as
 * fatal, two periods after stock gives up.
 */
export const RESYNC_SILENT = 3;
/**
 * `andi #$fc,mr`: the interrupt mask back to the main loop's (P:$2d leaves it at 0).
 *
 * DMA0 and DMA1 share IPL 0 (DSP1's set-up: IPRC D0L = D1L = 01), and a long interrupt masks its own
 * level until the rti. DMA1 -- the codec output -- stops at the end of every block (DTM 010, DE
 * cleared) and only its fast interrupt at P:$1a re-arms it; while that interrupt waits, ESSI1's three
 * transmitters underrun and every slot missed moves DMA1 for good against DMA0, whose DDR0 is what the
 * main loop picks its output half by. The stock handler holds the mask for a dozen instructions. Our
 * mute path writes 896 words and the heal 384, so both open the mask first: nothing of ours can hold
 * DMA1 off longer than the stock handler does. The rti restores the interrupted SR; the next DMA0
 * interrupt is 147,456 cycles away, so the handler cannot re-enter itself.
 */
const UNMASK = 0x00fcb8;
const NOP = 0x000000;
// Family Manual Rev.5 pp.2-15..2-16: allow 5 NOPs plus 5 for each additional
// pending long-interrupt priority transition. Cover all three maskable levels.
export const STACK_MASK_DRAIN = 15;
/** DMA4's control register, the value P:$270 arms it with, and the DMA status register (DTD4 = bit 4). */
const DCR4 = 0xffffdc, DCR4_ARMED = 0x8e52c4, DSTR = 0xfffff4;
/**
 * Paced clearing. Internal RAM is in 256-word banks, and when the core and a DMA channel want the
 * same bank in the same cycle the core wins and the DMA waits (DSP56300 Family Manual chapter 10:
 * "Priority Between a DMA Channel and the Core" and "DMA Restrictions"). A DMA word transfer that
 * waits also holds the controller: arbitration happens between words, so every other channel waits
 * behind it ("Channel Priority"). Zeroing Y:$600..$7ff (the banks DMA4 lands DSP2's words in) back to
 * back takes 512 cycles, and X:$400..$57f (the banks DMA1 reads the codec output from) 384 more. On a
 * missed frame DSP2 is almost always still sending, a word every 96 cycles; ESSI0's receiver holds
 * one, so every further word during such a stall is lost to receiver overrun, and DMA1/DMA0 (the
 * codec) sit behind the stalled DMA4 transfer. No stock code holds a DMA bank that long (the main
 * loop's own output clear at P:$2a5 is 192 words).
 *
 * The handler therefore leaves the voice feed alone -- with the output buffer silenced, zeroing the
 * feed would only delete words DSP1 has already been sent -- and zeroes the output buffer one word
 * per two cycles, so a DMA channel always finds the bank free on the next cycle and never waits on
 * this handler for more than one cycle.
 */
export const PACE = 2;
/** The handler's own data words, the last four of its record (the loader zeroes them). */
export const DATA_WORDS = 4;
/** HF3 stays up until this many consecutive healthy DMA0 entries (8 x 1.45 ms = 11.6 ms). */
export const HF3_HOLD = 8;

/**
 * Idling DMA4 before the resync, without touching the system stack.
 *
 * The resync pops the interrupt's return frame with `move ssh,a1` (SP - 1, SSH read, SSL left in the
 * slot) and pushes it back with `move a1,ssh` (SP + 1, SSH written, SSL not written -- the interrupted
 * SR is expected to still be there). A `do` loop between the two (e.g. `do #$100 / btst #4,DSTR /
 * brkcs`) pushes two frames of its own (LA/LC, then PC/SR) into exactly those slots, so the SSL under
 * the pushed-back $2e is the loop's LC, not the main loop's SR. The rti then loads SR = LC: with
 * $100, I0 is set and IPL 0 stays masked in the main loop for good. DMA0's interrupt and DMA1's fast
 * interrupt (both IPL 0) are never taken again, both DMAs stop at their block end, the main loop
 * spins at P:$3c waiting for DDR0, and only the host commands (IPL 1) still run: silence with the UI
 * alive until power-off.
 *
 * The idle is therefore the same bounded poll written as straight-line `jset`s, so nothing touches
 * the system stack between the pop and the push (stackGate checks this).
 */
/** DTD4 polls in the straight-line idle (DSP2 is parked there, so DMA4 is idle on the first) */
export const DMA4_IDLE_POLLS = 6;

/**
 * The link re-arm window (the ordered handler only). P:$270 (the firmware's DSP2 link re-arm, at every
 * pass's slot 15 and in the restart) toggles the PDRC handshake at P:$287 and re-arms DMA4 at P:$291:
 * DSP2 is released at the toggle and its first word is on the wire ~140 cycles later. An interrupt
 * that lands between the two and runs longer than that leaves DSP2's first words arriving with DMA4
 * unarmed: held in RX0 or lost to the overrun, the block ends one or more words short (DDR4 = $7ff
 * at the resync), DSP1 waits at slot 15 for good, and only the resync gets it out.
 * The stock DMA0 handler is ~25 cycles; the missed-frame and heal paths are ~830 (the paced output
 * clear), and during an overload they are exactly what runs. With the guard, both paths first look
 * at the interrupted PC (a pop and an immediate push back, nothing between) and, anywhere in
 * P:$270..$293, do only the stock-length bookkeeping -- HF3/HF2, the counter -- and leave the clear
 * and the rest to the next entry. Before the resync hands the stack P:$2e, with DMA4 idle, ESSI0's
 * receiver is drained (SSISR0 then RX0: RDF and ROE cleared), so no word held from the old block can
 * become the new block's word 0.
 */
export const LINK_REARM_LO = 0x270, LINK_REARM_HI = 0x293;
const SSISR0 = 0xffffb7, RX0 = 0xffffb8;

export interface Handler {
  /** where it goes, and how long it is in 24-bit words */
  at: number; words: number[];
  /** the addresses the gate re-reads */
  store: number; heal: number; miss: number; ramp: number; mute: number; back: number;
  count: number; panic: number; resync: number; keep: number;
  /** where the DDR4 sample is taken, where the silent-run decision is, and the three data words */
  probe: number; decide: number; last: number; silent: number; saveX0: number; hold: number;
  /** the ordered handler only (0 otherwise): where the heal and the missed-frame path look at the interrupted PC */
  healGuard: number; missGuard: number;
}

/**
 * The handler as DSP1 P words, placed at `at`. Every instruction that also appears in the base's
 * own handler is the base's word, unchanged, including the DMA0 re-arm's constant.
 *
 * `ordered` (what --clean-recovery uses) adds receive-before-release around the link re-arm window
 * (LINK_REARM_LO..HI), masked stack edits behind a full interrupt drain (STACK_MASK_DRAIN), and M0
 * preserved across the mute and the heal; without it this is the plain --dsp1-recover handler.
 */
export function handler(at: number, halt: number, ordered = false): Handler {
  const w: number[] = [];
  const A = (): number => at + w.length;
  const fix: [number, () => number][] = [];
  const later = (f: () => number): void => { fix.push([A(), f]); w.push(0); };
  /** clr a, then the masked pop: `clr a; ori #3,mr; STACK_MASK_DRAIN nops; move ssh,a1`. The ordered
   *  handler emits that sequence once (at `drain.at`, below the exits) and reaches it with
   *  `move #>ret,r0; bra drain`, coming back with `jmp (r0)`: no jsr, so the system stack the pop
   *  reads is untouched, and every stack edit still follows the full drain. r0 is ours at all
   *  three sites (saved at X:$642 on entry). */
  const drain = { at: 0 };
  const maskedPop = (): void => {
    if (!ordered) { w.push(0x200013, 0x044cfc); return; }   // clr a; move ssh,a1
    const ret = A() + 3;
    w.push(0x60f400, ret);                       // move #>ret,r0
    const braAt = A();
    later(() => bra(braAt, drain.at));           // bra drain
  };
  /** the ordered handler: the interrupted PC in A (a pop and its push back, nothing between them); in P:$270..$293
   *  branch to `to`. A is the caller's to lose. */
  const guard = (to: () => number): void => {
    maskedPop();                                 // clr a; (drain); move ssh,a1   pop: the interrupted PC
    w.push(0x04ccfc);                            // move a1,ssh                   push it straight back (SSL untouched)
    if (ordered) w.push(UNMASK);
    w.push(0x0140c5, LINK_REARM_LO);             // cmp #>$270,a
    const bltOut = A();
    const past = { at: 0 };
    later(() => bcc(LT, bltOut, past.at));       // blt <on>
    w.push(0x0140c5, LINK_REARM_HI + 1);         // cmp #>$294,a
    const bltIn = A();
    later(() => bcc(LT, bltIn, to()));           // blt <to>                      in the window
    past.at = A();
  };
  // --- the base's save, P:$9c2..$9c9, word for word
  w.push(0x527000, 0x000646);                    // move a2,x:>$646
  w.push(0x547000, 0x000645);                    // move a1,x:>$645
  w.push(0x507000, 0x000644);                    // move a0,x:>$644
  w.push(0x08f4ac, 0xc861c0);                    // movep #>$c861c0,x:<<$ffffec   re-arm DMA0
  w.push(0x56f000, 0x000647);                    // move x:>$647,a
  w.push(0x014180);                              // add #<$1,a
  w.push(0x014085 | (RECOVER_COUNT << 8));       // cmp #<$2,a   (the base compares 3)
  const bgeAt = A();
  later(() => bcc(GE, bgeAt, out.miss));         // bge miss
  const jsetAt = A();
  later(() => jsetIo(HCR, HF3_BIT, out.heal)[0]);  // jset #$4,x:<<$ffffc2,heal
  later(() => out.heal);
  void jsetAt;
  // --- the base's tail, P:$9cf..$9d7, word for word
  const store = A();
  w.push(0x567000, 0x000647);                    // move a,x:>$647
  w.push(0x54f000, 0x000645);                    // move x:>$645,a1
  w.push(0x52f000, 0x000646);                    // move x:>$646,a2
  w.push(0x50f000, 0x000644);                    // move x:>$644,a0
  w.push(0x000004);                              // rti
  // --- heal: the first healthy entry after a mute. Reached only while HF3 is set, so it is never on
  //     the healthy path proper. It zeroes the output double buffer one more time, which stops the
  //     tone that would otherwise survive a successful recovery.
  //
  //     The main loop picks its output half from the input DMA's pointer, by exact equality:
  //     P:$3c reads DDR0 and takes X:$400 when it reads exactly $13f and X:$4c0 when it reads
  //     exactly $17f. A pass that takes longer than one half-period arrives after the boundary it
  //     wanted and spins to the next one, so a loop running slow catches only one of the two
  //     boundaries and the other half is never written again. Whatever was in it when the loop
  //     slowed down is replayed by DMA1 indefinitely: a hard constant tone on top of live audio,
  //     with the UI fully responsive. Zeroing both halves here means the half the loop has stopped
  //     refreshing holds silence instead of a stale block, so the worst case is a half-rate gap in
  //     the audio rather than a tone, and it heals completely once the loop catches both
  //     boundaries again.
  const heal = A();
  w.push(UNMASK);                                // andi #$fc,mr                  let DMA1's re-arm in
  w.push(0x607000, SCRATCH);                     // move r0,x:>$642
  if (ordered) { w.push(0x0770a0); later(() => savedM0); w.push(0x05f420, 0xffffff); }
  const healGuard = ordered ? A() : 0;           // inside the link re-arm window? then only the
  if (ordered) guard(() => keepHf3At);           // stock-length exit, and the heal on the next entry
  //     HF3 HOLD: HF3 comes down only on the HF3_HOLD-th consecutive healthy entry (8 = 11.6 ms), so
  //     the ColdFire's ~171 Hz poll can never miss an episode. The count lives in a data word of ours;
  //     every missed frame resets it. The zeroing and the forgetting happen on the first one only.
  w.push(MOVEM_P_TO_A); later(() => out.hold);   // move p:<hold>,a              healthy entries so far
  w.push(0x014180);                              // add #<$1,a
  w.push(MOVEM_A1_TO_P); later(() => out.hold);  // move a1,p:<hold>
  w.push(0x014185);                              // cmp #<$1,a
  const bneAt = A();
  later(() => bcc(NE, bneAt, holdTest));         // bne <hold test>              not the first: no zeroing
  w.push(0x60f400, OUT);                         // move #>$400,r0
  w.push(0x200013);                              // clr a
  const zHeal = A();
  w.push(...doImm(OUT_WORDS, zHeal + 3));        // do #>$180,<the nop below>
  w.push(0x565800);                              // move a,x:(r0)+                both halves,
  w.push(NOP);                                   // nop                           one X cycle in two (see PACE)
  //     The episode is over: forget the DDR4 sample and the silent run, so the next episode's
  //     silence has to be measured afresh (A is zero here, and DDR4 is never 0).
  w.push(MOVEM_A1_TO_P); later(() => out.last);  // move a1,p:<last>
  w.push(MOVEM_A1_TO_P); later(() => out.silent); // move a1,p:<silent>
  w.push(0x014180);                              // add #<$1,a                    A = 1 = the count again
  const holdTest = A();
  w.push(0x014085 | (HF3_HOLD << 8));            // cmp #<8,a
  const ltHoldAt = A();
  later(() => bcc(LT, ltHoldAt, keepHf3));       // blt <keep HF3>
  w.push(...movepImm(HCR, HCIE | HF2));          // movep #>$c,x:<<$ffffc2        HF3 off, HF2 stays
  const keepHf3 = A();
  var keepHf3At = keepHf3;                       // eslint-disable-line no-var
  w.push(0x200013);                              // clr a
  w.push(0x014180);                              // add #<$1,a                    A = 1, as the tail wants
  if (ordered) { w.push(0x07f0a0); later(() => savedM0); }
  w.push(0x60f000, SCRATCH);                     // move x:>$642,r0
  const healBra = A();
  later(() => bra(healBra, store));              // bra store
  // --- miss: the main loop did not finish a pass since the last DMA0 interrupt.
  //     (1) Silence first, whatever happens next: the output double buffer is what DMA1 sends, and a
  //     main loop stuck in its per-track wait leaves DMA1 replaying one 32-frame half of it forever
  //     -- a 1.38 kHz tone that plays until the unit is switched off. The DSP2 voice feed is not
  //     zeroed (see PACE).
  const miss = A();
  w.push(UNMASK);                                // andi #$fc,mr                  let DMA1's re-arm in
  w.push(...movepImm(HCR, HCIE | HF2 | HF3));    // movep #>$1c,x:<<$ffffc2       HF3 and HF2 on
  w.push(0x607000, SCRATCH);                     // move r0,x:>$642
  if (ordered) { w.push(0x0770a0); later(() => savedM0); w.push(0x05f420, 0xffffff); }
  const missGuard = ordered ? A() : 0;           // inside the link re-arm window? count it and go
  if (ordered) guard(() => out.count);
  const mute = A();
  w.push(0x60f400, OUT);                         // move #>$400,r0                what DMA1 sends
  w.push(0x200013);                              // clr a
  w.push(MOVEM_A1_TO_P); later(() => out.hold);  // move a1,p:<hold>              no healthy entries yet
  const zOut = A();
  w.push(...doImm(OUT_WORDS, zOut + 3));         // do #>$180,<the nop below>
  w.push(0x565800);                              // move a,x:(r0)+                384 zeros,
  w.push(NOP);                                   // nop                           one X cycle in two (see PACE)
  // (2) Is DSP2 still sending? Sample DMA4's destination pointer and compare it with the sample the
  //     previous missed frame took. Any word from DSP2 in between moves it. X0 is borrowed through
  //     one of our own P data words (MOVEM leaves the condition codes alone, so the compare's Z
  //     survives the reload).
  const probe = A();
  w.push(MOVEM_X0_TO_P); later(() => out.saveX0); // move x0,p:<saveX0>
  w.push(MOVEM_P_TO_X0); later(() => out.last);   // move p:<last>,x0              the previous sample
  w.push(0x084e00 | ioShort(DDR4));              // movep x:<<$ffffde,a           DDR4 now
  w.push(MOVEM_A1_TO_P); later(() => out.last);  // move a1,p:<last>
  w.push(0x200045);                              // cmp x0,a
  w.push(MOVEM_P_TO_A); later(() => out.silent); // move p:<silent>,a             the silent run so far
  const beqAt = A();
  later(() => bcc(EQ, beqAt, quiet));            // beq quiet                     not one word since
  w.push(0x200013);                              // clr a                         words arrived: DSP2 lives
  const braAt = A();
  later(() => bra(braAt, out.decide));           // bra <keep the run>
  const quiet = A();
  w.push(0x014180);                              // add #<$1,a                    one more silent period
  w.push(0x014085 | (RESYNC_SILENT << 8));       // cmp #<$3,a
  const lt2At = A();
  later(() => bcc(LT, lt2At, out.decide));       // blt <keep the run>
  w.push(0x200013);                              // clr a
  w.push(0x014080 | (RESYNC_SILENT << 8));       // add #<$3,a                    clamped
  const decide = A();
  w.push(MOVEM_A1_TO_P); later(() => out.silent); // move a1,p:<silent>
  w.push(MOVEM_P_TO_X0); later(() => out.saveX0); // move p:<saveX0>,x0
  w.push(0x014085 | (RESYNC_SILENT << 8));       // cmp #<$3,a
  const lt3At = A();
  later(() => bcc(LT, lt3At, out.count));        // blt count                     not proven parked: the
  //                                                                               stack is left alone
  // (3) The resync, with DSP2 known to be parked on its block boundary. A1 takes the interrupted PC.
  //     Pop the interrupt's return address off the system stack (SSL, the interrupted SR, stays in
  //     that slot), and if -- and only if -- it is inside the main loop's per-track wait for DSP2
  //     (P:$73..$79, a plain branch loop with no DO open and nothing live that P:$2e does not
  //     re-establish), put the firmware's own audio-path restart there instead and push it back.
  //     The rti then resumes at P:$2e with the interrupted SR, so the interrupt mask comes down
  //     with it, and DSP1 runs its own restart: Y:$1c2..$1c4 = $600, wait for DDR0 to reach $139
  //     (a codec-DMA block boundary), `jsr $270` -- which re-arms DMA2 and DMA4, reads RX0 to clear
  //     ESSI0's receiver, and toggles the PDRC bit 1 handshake DSP2's end-of-block spin waits on --
  //     then `jmp $294`, which zeroes the output half and restarts the sixteen-track pass. With DSP2
  //     parked that is the power-on sequence exactly: Y:$600 takes word 0 of the block the toggle
  //     releases. The re-arm moves DDR4, so the next missed frame, if any, starts a fresh run.
  //     Nothing touches DMA1 or ESSI1, so the six outputs keep their slot order.
  const resync = A();
  maskedPop();                                   // clr a; (drain); move ssh,a1   pop: A = the return PC
  w.push(0x0140c5, WAIT_LO);                     // cmp #>$73,a
  const ltAt = A();
  later(() => bcc(LT, ltAt, out.keep));          // blt keep
  w.push(0x0140c5, WAIT_HI + 1);                 // cmp #>$7a,a
  const geAt = A();
  later(() => bcc(GE, geAt, out.keep));          // bge keep
  // DMA4 is still enabled here, short of its 512 words, and P:$270 is about to rewrite its address
  // and counter. The DSP56300 allows that only on an idle channel (Family Manual, DMA Restrictions 6,
  // 7, 9): clear DE alone (the rest of DCR4 exactly as P:$270 armed it) and poll DTD4 until the
  // channel says it is idle. DSP2 is parked, so no request is pending and it is idle at once; the
  // poll is bounded all the same, and P:$270 disarms DE itself before its writes either way.
  //     Nothing between the pop above and the push below may use the system stack: a DO
  //     loop here overwrites the interrupted SR the push relies on (see DMA4_IDLE_POLLS).
  w.push(...movepImm(DCR4, DCR4_ARMED & ~0x800000)); // movep #>$0e52c4,x:<<$ffffdc   DMA4 DE off
  for (let k = 0; k < DMA4_IDLE_POLLS; k++) {
    w.push(jsetIo(DSTR, 4, 0)[0]); later(() => idled); // jset #4,x:<<$fffff4,<idled>  DTD4, straight-line
  }
  const idled = A();
  //     ordered: ESSI0's receiver drained with DMA4 idle -- status, then data (RDF and ROE cleared) -- so no
  //     word held from the short block can become the new block's word 0. r0 is ours (saved).
  if (ordered) {
    w.push(0x60f000, SSISR0);                    // move x:$ffffb7,r0             SSISR0 as it was
    w.push(0x60f000, RX0);                       // move x:$ffffb8,r0             RX0: gone
    w.push(0x60f000, SSISR0);                    // move x:$ffffb7,r0             and once more, for a word that
    w.push(0x60f000, RX0);                       // move x:$ffffb8,r0             landed in between
  }
  w.push(0x54f400, RESTART);                     // move #>$2e,a1                 the firmware's restart
  const keep = A();
  w.push(0x04ccfc);                              // move a1,ssh                   push it back
  if (ordered) w.push(UNMASK);
  // (4) the counter, and out
  const count = A();
  w.push(0x56f000, 0x000647);                    // move x:>$647,a
  w.push(0x014180);                              // add #<$1,a
  w.push(0x014085 | (CLAMP << 8));               // cmp #<$3,a
  const clampAt = A();
  later(() => bcc(LT, clampAt, out.back));       // blt back                      below the clamp: store A
  w.push(0x200013);                              // clr a
  w.push(0x014080 | (CLAMP << 8));               // add #<$3,a                    clamped: it cannot wrap
  const back = A();
  if (ordered) {
    // ordered: m0 and r0 back, then the heal's own exit (`store`: the count, A, rti).
    w.push(0x07f0a0); later(() => savedM0);      // move p:<savedM0>,m0
    w.push(0x60f000, SCRATCH);                   // move x:>$642,r0
    const braStore = A();
    later(() => bra(braStore, store));           // bra store
    // the shared drain (maskedPop)
    drain.at = A();
    w.push(0x200013);                            // clr a                         A2/A0 clear for the compare
    w.push(0x0003f8, ...Array(STACK_MASK_DRAIN).fill(NOP)); // ori #3,mr and the drain
    w.push(0x044cfc);                            // move ssh,a1                   pop
    w.push(0x0ae080);                            // jmp (r0)
  } else {
    w.push(0x567000, 0x000647);                  // move a,x:>$647
    w.push(0x60f000, SCRATCH);                   // move x:>$642,r0
    w.push(0x54f000, 0x000645);                  // move x:>$645,a1
    w.push(0x52f000, 0x000646);                  // move x:>$646,a2
    w.push(0x50f000, 0x000644);                  // move x:>$644,a0
    w.push(0x000004);                            // rti
  }
  // --- data, never executed: the last DDR4 sample, the silent run, and X0 while it is borrowed.
  //     Inside our own record, so they are ours by construction and the loader zeroes them.
  const last = A(); w.push(0);
  const silent = A(); w.push(0);
  const saveX0 = A(); w.push(0);
  const savedM0 = ordered ? A() : 0;
  if (ordered) w.push(0);
  const hold = A(); w.push(0);
  const ramp = mute;                             // no ramp: the output has to be silent, not quieter
  const panic = 0;                               // and no halt: the base's own is left unreachable
  const out: Handler = { at, words: w, store, heal, miss, ramp, mute, back, count, panic, resync, keep,
    probe, decide, last, silent, saveX0, hold, healGuard, missGuard };
  for (const [a, f] of fix) w[a - at] = f();
  return out;
}


/**
 * The stack gate. Between an instruction that pops the system stack's top frame into a register
 * (`move ssh,D`) and the one that pushes it back (`move S,ssh`), nothing may use the system stack: a
 * push there writes over the popped slot's SSL (the interrupted SR), and the push back writes SSH
 * only (a `do` loop there hands the main loop its LC as SR; see DMA4_IDLE_POLLS). Stack users: DO / DOR /
 * REP (0x06....), JSR / JScc / JSSET / JSCLR (0x0b.... with bit 7, 0x0d0xxx, 0x0f....), BSR (0x050800, 0x0d1080),
 * ENDDO, RTS, RTI. The words are walked instruction by instruction (two-word forms by opcode), so an
 * operand word is never read as an instruction.
 */
export function insnWords(w: number): 1 | 2 {
  const hi = w >> 16, lo16 = w & 0xffff;
  if ((w & 0xffffc0) === 0x08f480) return 2;                                          // movep #>imm,x:pp
  if ((w & 0xffc0c0) === 0x0a8080 || (w & 0xffc0c0) === 0x018080 || (w & 0xffc0c0) === 0x0ac000) return 2;   // jset/jclr
  if ((w & 0xff00f0) === 0x060080) return 2;                                          // do #n,la
  if ((w & 0xfffff0) === 0x0140c0) return 2;                                          // add/sub/cmp #>imm
  if ((w & 0xfff0c0) === 0x07f080 || (w & 0xfff0c0) === 0x077080) return 2;           // movem p:abs
  if (hi >= 0x40 && hi <= 0x7f && (lo16 === 0x7000 || lo16 === 0xf000 || lo16 === 0xf400)) return 2;   // move x:abs / #>imm
  if (w === 0x0bf080 || w === 0x0af080 || (w & 0xffffc0) === 0x05f400) return 2;     // jsr/jmp abs, movec #>imm
  if ((w & 0xffff00) === 0x0d1000) return 2;                                          // bcc/bra/bsr long
  return 1;
}
export const isPop = (w: number): boolean => (w & 0xffc0ff) === 0x0440fc;
export const isPush = (w: number): boolean => (w & 0xffc0ff) === 0x04c0fc;
export function usesStack(w: number): boolean {
  return (w & 0xff0000) === 0x060000 || (w & 0xff0080) === 0x0b0080 || (w & 0xfff000) === 0x0d0000 || w === 0x0d1080 ||
    (w & 0xff0000) === 0x0f0000 || (w & 0xfffc00) === 0x050800 || w === 0x00008c || w === 0x00000c || w === 0x000004;
}
/** Every stack user found between a pop and its push, as [pop address, offender address]. */
export function stackGate(words: number[], at: number): [number, number][] {
  const bad: [number, number][] = [];
  let open = -1;
  for (let k = 0; k < words.length; k += insnWords(words[k])) {
    const w = words[k];
    if (isPop(w)) { open = at + k; continue; }
    if (isPush(w)) { open = -1; continue; }
    if (open >= 0 && usesStack(w)) bad.push([open, at + k]);
  }
  return bad;
}

/** How many words the handler takes, and so where it sits at the top of the free window. */
export const HANDLER_WORDS = handler(0, 0).words.length;
export const HANDLER_AT = P_FREE_END - HANDLER_WORDS;
/** how long the plain or the ordered handler is, and so where it sits */
export const handlerWords = (ordered = false): number => handler(0, 0, ordered).words.length;
export const handlerAt = (ordered = false): number => P_FREE_END - handlerWords(ordered);

/** The base's own halt: its `movep #>$0,x:<<$ffffe8` two words before the jump to itself. */
export const wdHalt = (baseWords: number[]): number => findWatchdog(baseWords).at + 22;

/** The DMA0 interrupt vector: P:$18 is `jsset #$0,x:<<$fffff4,<handler>`, P:$19 its target. */
export const VECTOR = 0x18;
export const VECTOR_WORD = 0x0bb4a0;

/**
 * What the handler takes from the base, word for word.
 *
 * The handler is written against the base's own DSP1 and DSP2 code: it resumes the main loop at the
 * base's restart P:$2e (which calls the re-arm at P:$270 and jumps to the pass start P:$294), it
 * recognises the base's per-track wait P:$73..$79 by address, and its "DSP2 parked" argument is
 * DSP2's end-of-block spin at P:$bb..$bf on the PDRC level DSP1's P:$270 toggles. None of that is
 * findable by a signature that could sit anywhere -- the addresses are the contract -- so each is
 * required here, word for word, as stock 1.63's upload has it (DEV's DSP1 and DSP2 uploads are
 * byte-identical to 1.63's; X.14 re-records its DSP2 but keeps these words). A base that differs in
 * any one of them does not get the option: the build refuses it by name.
 */
export interface Anchor { what: string; dsp: 1 | 2; at: number; words: number[] }
export const ANCHORS: Anchor[] = [
  { what: "the DMA0 vector (jsset #0,x:<<$fffff4 on DMA0's status bit; its target is checked against the watchdog found)",
    dsp: 1, at: VECTOR, words: [VECTOR_WORD] },
  { what: "the audio-path restart P:$2e..$3b (Y:$1c2..$1c4 = $600, wait for DDR0 = $139, jsr $270, jmp $294)",
    dsp: 1, at: RESTART, words: [0x44f400, 0x000600, 0x4c7000, 0x0001c2, 0x4c7000, 0x0001c3, 0x4c7000, 0x0001c4,
                                 0x084e2e, 0x0140c5, 0x000139, 0x0527dd, 0x0d0270, 0x0c0294] },
  { what: "the main loop's per-track wait for DSP2 P:$73..$79 (DDR4 - Y:$1c4 < $20: loop)",
    dsp: 1, at: WAIT_LO, words: [0x57f000, 0xffffde, 0x4cf000, 0x0001c4, 0x20004c, 0x01608d, 0x0597da] },
  { what: 'the DSP2 link re-arm P:$270..$293 (DMA2, the PDRC toggle, DMA4 at Y:$600 for $200 words, rts)',
    dsp: 1, at: 0x270, words: [0x60f400, 0x000180, 0x61f400, 0x000688, 0x064080, 0x000277, 0x44d800, 0x445900,
                               0x08f4a4, 0x0e5a50, 0x08f4a6, 0xffffbc, 0x08f4a7, 0x000688, 0x08f4a5, 0x00003f,
                               0x08f4a4, 0x8e5a50, 0x44f000, 0xffffb8, 0x56f000, 0xffffbd, 0x014283, 0x567000,
                               0xffffbd, 0x08f49c, 0x0e52c4, 0x08f49e, 0x000600, 0x08f49f, 0xffffb8, 0x08f49d,
                               0x0001ff, 0x08f49c, 0x8e52c4, 0x00000c] },
  { what: "DSP2's end-of-block spin P:$bb..$bf (until PDRC bit 1 differs from X:$202)",
    dsp: 2, at: 0xbb, words: [0x57f000, 0xffffbd, 0x01428e, 0x200005, 0x05a7dc] },
];

/** A DSP upload's P memory as the loader leaves it (later records win). */
function pWords(w: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of recordsOf(w).recs) if (r.tag === 0) for (let k = 0; k < r.count; k++) m.set(r.addr + k, w[r.index + 3 + k]);
  return m;
}

/**
 * Can --dsp1-recover go into this base? [] when it can, otherwise every reason it cannot: an anchor
 * that is not the base's word for word, the watchdog not found once with the trip count 3, the
 * handler's window P:$b8d..$bff holding anything of the base, X:$642 named by the base, or (DSP2
 * `taken`: P ranges the base's own ColdFire code writes into DSP2 at run time) the spin overwritten.
 */
export function recoverProblems(dsp1Words: number[], dsp2Words: number[], taken: [number, number][] = [], ordered = false, phaseReady?: number): string[] {
  const why: string[] = [];
  const p1 = pWords(dsp1Words), p2 = pWords(dsp2Words);
  const hw = (v: number | undefined): string => (v === undefined ? '------' : v.toString(16).padStart(6, '0'));
  for (const a of ANCHORS) {
    const m = a.dsp === 1 ? p1 : p2;
    const expected = a.words.map((v, k) => phaseReady !== undefined && a.dsp === 1 && (a.at + k === 0x270 || a.at + k === 0x271) ? (a.at + k === 0x270 ? 0x0bf080 : phaseReady) : ordered && a.dsp === 1 && a.at + k >= HANDOFF_AT && a.at + k < HANDOFF_AT + HANDOFF_ORDERED.length ? HANDOFF_ORDERED[a.at + k - HANDOFF_AT] : v);
    const bad = expected.map((v, k) => (m.get(a.at + k) === v ? -1 : k)).filter((k) => k >= 0);
    if (bad.length) {
      why.push(`DSP${a.dsp} ${a.what}: P:${h(a.at + bad[0])} holds ${hw(m.get(a.at + bad[0]))}, not ${hw(a.words[bad[0]])}` +
               (bad.length > 1 ? ` (and ${bad.length - 1} more words differ)` : ''));
    }
    if (a.dsp === 2 && taken.some(([lo, hi]) => lo < a.at + a.words.length && hi > a.at)) {
      why.push(`DSP2 ${a.what}: the base's own code writes over it at run time`);
    }
  }
  try {
    const wd = findWatchdog(dsp1Words);
    if (wd.count !== BASE_COUNT) why.push(`the DMA0 watchdog's trip count is ${wd.count}, not the ${BASE_COUNT} the handler is written against`);
    if (p1.get(VECTOR + 1) !== wd.at) why.push(`the DMA0 vector's target is ${h(p1.get(VECTOR + 1) ?? -1)}, not the watchdog at ${h(wd.at)}`);
  } catch (e) { why.push((e as Error).message); }
  const inWindow = [...p1.keys()].filter((a) => a >= HANDLER_AT && a < P_FREE_END);
  if (inWindow.length) why.push(`the handler's window P:${h(HANDLER_AT)}..${h(P_FREE_END - 1)} holds ${inWindow.length} words of the base's own`);
  const named = namesScratch(dsp1Words);
  if (named.length) why.push(`X:${h(SCRATCH)} is named by the base's DSP1 code at P:${named.map(h).join(', P:')}`);
  return why;
}


export interface Dsp1Rec { addr: number; space: number; words: number[] }

/**
 * The three records --dsp1-recover adds to the DSP1 upload, in the order the loader writes them:
 * the handler, the vector's target word, and our scratch word zeroed (DSP1's RAM comes up dirty
 * and no other record or instruction in the upload initialises X:$642).
 */
export function recoverRecords(halt: number, ordered = false): Dsp1Rec[] {
  const hl = handler(handlerAt(ordered), halt, ordered);
  return [
    { space: 0, addr: hl.at, words: hl.words },
    { space: 0, addr: VECTOR + 1, words: [hl.at] },
    { space: 1, addr: SCRATCH, words: [0] },
    ...(ordered ? [{ space: 0, addr: HANDOFF_AT, words: HANDOFF_ORDERED }] : []),
  ];
}

/**
 * The gate. Read back from the two upload streams, never from what the patcher believed:
 *   - the base's vector is the `jsset` on DMA0's status bit and pointed at the base's handler;
 *   - the built upload's vector points at ours, and P:$18 itself is unchanged;
 *   - every one of the handler's words is in the built upload's P memory, at its address;
 *   - the base's own handler, all 25 words of it, is still byte for byte where the base has it,
 *     and no word of the base's P memory is rewritten but the one vector word (the DSP1 drive's
 *     own records excepted: they are its own gate's business);
 *   - the base's trip count is the 3 this option is written against;
 *   - X:$642 is zeroed by a record and named by nothing else in the upload;
 *   - the DSP1 drive, when it is linked, ends below the handler;
 *   - every anchor (ANCHORS: the restart P:$2e, the wait P:$73..$79, the re-arm P:$270, DSP2's spin
 *     P:$bb..$bf) is the base's word for word, in the base and in the uploads the image carries.
 */
export function checkRecover(baseWords: number[], outWords: number[], drive: { records: Dsp1Rec[] } | null,
  baseDsp2: number[], outDsp2: number[], ordered = false,
  own: number[] = [], phaseReady?: number): { ok: boolean; detail: string } {
  const mem = (w: number[], space: number): Map<number, number> => {
    const m = new Map<number, number>();
    const { recs } = recordsOf(w);
    for (const r of recs) if (r.tag === space) for (let k = 0; k < r.count; k++) m.set(r.addr + k, w[r.index + 3 + k]);
    return m;
  };
  const bp = mem(baseWords, 0), op = mem(outWords, 0), ox = mem(outWords, 1);
  const hl = handler(handlerAt(ordered), wdHalt(baseWords), ordered);
  const why: string[] = [];
  let wd: { at: number; count: number; words: number };
  try { wd = findWatchdog(baseWords); } catch (e) { return { ok: false, detail: `in the base: ${(e as Error).message}` }; }
  if (wd.count !== BASE_COUNT) why.push(`the base's trip count is ${wd.count}, not the ${BASE_COUNT} this option is written for`);
  if (bp.get(VECTOR) !== VECTOR_WORD || bp.get(VECTOR + 1) !== wd.at) {
    why.push(`the base's DMA0 vector at P:${h(VECTOR)} is ${h(bp.get(VECTOR) ?? -1)} ${h(bp.get(VECTOR + 1) ?? -1)}, ` +
             `not the jsset on its own handler at ${h(wd.at)}`);
  }
  if (op.get(VECTOR) !== VECTOR_WORD) why.push(`the built upload's P:${h(VECTOR)} is not the base's jsset`);
  if (op.get(VECTOR + 1) !== hl.at) why.push(`the built upload's DMA0 vector points at ${h(op.get(VECTOR + 1) ?? -1)}, not ${h(hl.at)}`);
  const wrong = hl.words.map((v, k) => (op.get(hl.at + k) === v ? -1 : hl.at + k)).filter((a) => a >= 0);
  if (wrong.length) why.push(`the handler differs from what was emitted at P:${wrong.map(h).join(', P:')}`);
  const moved: number[] = [];
  for (let k = 0; k < wd.words; k++) if (bp.get(wd.at + k) !== op.get(wd.at + k)) moved.push(wd.at + k);
  if (moved.length) why.push(`the base's own handler changed at P:${moved.map(h).join(', P:')}`);
  // nothing else of the base rewritten -- the DSP1 drive's own records excepted
  const byDrive = new Set<number>();
  for (const r of drive?.records ?? []) if (r.space === 0) for (let k = 0; k < r.words.length; k++) byDrive.add(r.addr + k);
  for (const [pop, at] of stackGate(hl.words, hl.at)) why.push(`the system stack is used at P:${h(at)}, between the pop at P:${h(pop)} and its push (the interrupted SR would be lost)`);
  const allowed = new Set([...own, ...(ordered ? HANDOFF_ORDERED.map((_, k) => HANDOFF_AT + k) : [])]);
  const over = [...bp.keys()].filter((a) => a !== VECTOR + 1 && !allowed.has(a) && !byDrive.has(a) && bp.get(a) !== op.get(a));
  if (over.length) why.push(`${over.length} word${over.length === 1 ? '' : 's'} of the base's P memory rewritten besides the vector: P:${over.slice(0, 8).map(h).join(', P:')}`);
  for (const a of [hl.last, hl.silent, hl.saveX0, hl.hold]) if (op.get(a) !== 0) why.push(`the handler's data word P:${h(a)} does not start at 0`);
  if (ox.get(SCRATCH) !== 0) why.push(`X:${h(SCRATCH)} is not zeroed by a record`);
  const names = namesScratch(outWords, ordered);
  if (names.length) why.push(`X:${h(SCRATCH)} is named by the upload's own code at P:${names.map(h).join(', P:')}`);
  for (const p of recoverProblems(baseWords, baseDsp2)) why.push(`in the base: ${p}`);
  // the anchors hold in what DSP1 and DSP2 will run, not only in the base
  for (const p of recoverProblems(outWords, outDsp2, [], ordered, phaseReady).filter((x) => /^DSP[12] /.test(x))) why.push(`in the built uploads: ${p}`);
  const driveEnd = drive ? Math.max(...drive.records.filter((r) => r.space === 0 && r.addr >= 0xa08 && r.addr < hl.at).map((r) => r.addr + r.words.length), 0) : 0;
  if (driveEnd > hl.at) why.push(`the DSP1 drive ends at ${h(driveEnd)}, past the handler at ${h(hl.at)}`);
  return {
    ok: why.length === 0,
    detail: why.length ? why.join('; ')
      : `P:${h(hl.at)}..${h(hl.at + hl.words.length - 1)} (${hl.words.length} words) reached by the DMA0 vector at P:${h(VECTOR)}, ` +
        `whose target changes (${h(wd.at)} -> ${h(hl.at)})${ordered ? ', with receive-before-release at P:$282..$292 and protected stack edits/M0' : ''}; ` +
        `the base's own ${wd.words}-word handler and its halt at P:${h(wd.at + 24)} are byte for byte where the base has them and unreachable; ` +
        `the mute starts on the first missed frame (cmp #<${RECOVER_COUNT}) and the halt keeps the base's own ${BASE_COUNT}; ` +
        `every missed frame P:${h(hl.mute)}: the output double buffer X:${h(OUT)}..${h(OUT + OUT_WORDS - 1)} zeroed first ` +
        `(that is what DMA1 sends, and a stuck main loop leaves it replaying one 32-frame half forever: a 1.38 kHz tone ` +
        `on hardware), one word every ${PACE} cycles so no DMA channel ever waits on this handler for its bank; ` +
        `the DSP2 voice feed Y:${h(FEED)}..${h(FEED + FEED_WORDS - 1)} is never written (DMA4's banks); ` +
        `then P:${h(hl.probe)}: DDR4 is sampled against the previous missed frame's sample (P:${h(hl.last)}), ` +
        `and the run of missed frames across which DSP2 sent not one word is counted (P:${h(hl.silent)}); ` +
        `only once that run reaches ${RESYNC_SILENT} -- DSP2 parked on its block boundary, never a DSP2 that is ` +
        `only late and still inside its block -- does P:${h(hl.resync)} run: ` +
        `if the interrupted PC is inside the main loop's per-track wait for DSP2 ` +
        `(P:${h(WAIT_LO)}..${h(WAIT_HI)}), the stacked return address becomes the firmware's own audio-path restart ` +
        `P:${h(RESTART)}, so the rti resumes there and the OS itself re-arms DMA2 and DMA4, clears ESSI0's receiver and ` +
        `toggles the PDRC handshake DSP2's end-of-block spin waits on, on a codec-DMA block boundary; anywhere else the ` +
        `return address is pushed back unchanged; the base's own halt at ${h(wdHalt(baseWords))} is never reached; ` +
        `HCR = ${h(HCIE | HF2 | HF3)} on every missed frame (HF3, HF2 sticky) and ${h(HCIE | HF2)} on the ${HF3_HOLD}th consecutive healthy entry (HF3 held ${HF3_HOLD} DMA0 periods for the ColdFire's poll; P:${h(hl.heal)}), ` +
        `which zeroes X:${h(OUT)}..${h(OUT + OUT_WORDS - 1)} once more so the half a slow main loop has stopped ` +
        `refreshing holds silence and not a stale block, and forgets the DDR4 sample and the silent run; ` +
        `the mute and heal paths open the interrupt mask first (andi #$fc,mr), so DMA1's IPL-0 re-arm at P:$1a ` +
        `is never held off longer than the stock handler holds it; ` +
        `no ESSI register and no DMA register written by us but DCR4's DE on a resync (DMA4 idled and DTD4 polled ` +
        `before P:$270 rewrites its address and counter), so DMA1 keeps the six outputs' slot order; ` +
        `X:${h(SCRATCH)} zeroed by a record and named by nothing else; ` +
        `anchors word for word in the base and the built uploads: ${ANCHORS.map((a) => `DSP${a.dsp} P:${h(a.at)}..${h(a.at + a.words.length - 1)}`).join(', ')}` +
        (driveEnd ? `; the DSP1 drive ends at ${h(driveEnd)}, ${hl.at - driveEnd} words below it` : ''),
  };
}

/** Every P address whose instruction names X:$642 as a long absolute operand. */
function namesScratch(w: number[], ordered = false): number[] {
  const out: number[] = [];
  const { recs } = recordsOf(w);
  const mem = new Map<number, number>();
  for (const r of recs) if (r.tag === 0) for (let k = 0; k < r.count; k++) mem.set(r.addr + k, w[r.index + 3 + k]);
  const hl = handler(handlerAt(ordered), 0, ordered);
  for (const [a, v] of mem) {
    if (v !== SCRATCH) continue;                                       // the operand word of a long absolute move
    const prev = mem.get(a - 1);
    if (prev === undefined || ((prev & 0xffff) !== 0x7000 && (prev & 0xffff) !== 0xf000)) continue;
    if (a - 1 >= hl.at && a - 1 < hl.at + hl.words.length) continue;   // our own save and restore
    out.push(a - 1);
  }
  return out;
}
