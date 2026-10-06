// DSP2 block-boundary overload policy (--clean-recovery). DDR1 ($ffffea) is the
// continuously running 256-word codec-input ring, not DDR2 ($ffffe6), which
// the stock handshake resets. One rendered block should advance 64 input words.
import { Emit } from './dsp_emit.js';

export const RETIRE_SITE = 0xe2;
export const RETIRE_BASE = [0x084e2a, 0x0140c6, 0xffffc0];
export const RETIRE_AT = 0x147700;

export function retireRoutine(threshold = 64, at = RETIRE_AT) {
  if (!Number.isInteger(threshold) || threshold < 16 || threshold > 1024) throw new Error('invalid retirement threshold');
  const e = new Emit(at);
  // Only A/B and CCR are scratch. Stock code at this boundary replaces A,
  // then unconditionally returns to the block start, where B is replaced.
  e.put(0x084e2a); // movep x:<<$ffffea,a
  e.write('a1', 'current');
  e.read('a', 'valid'); e.cmp(0); e.jump('calculate', 2);
  e.set('valid', 1); e.set('debt', 0); e.jump('out');
  e.label('calculate');
  e.read('a', 'current'); e.read('b', 'previous');
  e.put(0x200014, 0x0140c6, 255, 0x218e00); // sub b,a ; and #>$ff,a ; move a1,a
  // AND changes A1, not the accumulator extension. Normalize after a wrapped
  // negative subtraction before adding signed debt or testing its sign.
  e.write('a1', 'lastDelta');
  e.read('b', 'debt'); e.put(0x200010, 0x0140c4, 64); // add b,a ; sub #>64,a
  e.jump('nonnegative', 1); // ge
  e.put(0x56f400, 0);
  e.label('nonnegative'); e.write('a1', 'debt');
  e.cmp(threshold); e.jump('out', 9); // lt
  e.inc('events');
  e.set('debt', 0); // leaves A=0
  // Retire only renderer IDs. Pending triggers, kit parameters, synthesis
  // memory, transport buffers, DMA state and interrupt state are untouched.
  // The stock dispatcher initializes a retired machine on its next trigger.
  for (let track = 0; track < 16; track++) e.put(0x5e7000, 0x153 + track);
  e.label('out'); e.read('a', 'current'); e.write('a1', 'previous');
  e.put(0x0140c6, 0xffffc0, 0x00000c); // replay original input-ring snapshot, rts
  const routine = e.finish(['valid', 'previous', 'current', 'debt', 'events', 'lastDelta']);
  return { ...routine, threshold, hook: [0x0bf080, at, 0] };
}
