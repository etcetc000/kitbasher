// DSP1 render pacing driven by the output side: the render half is chosen from where the output
// DMA (DSR1) is in the output buffer, and the input half independently from where input DMA0 (DDR0)
// is. It resets no channel, counter, voice, sample buffer or peripheral configuration.
import { PACE_AT } from './dsp1pace.js';

export function outputPaceRoutine(at = PACE_AT): { at: number; words: number[]; loopEnd: number; req: number; rel: number } {
  const words: number[] = [], labels: Record<string, number> = {};
  const fix: [number, string][] = [];
  const label = (name: string): void => { labels[name] = at + words.length; };
  const branch = (opcode: number, name: string): void => { words.push(opcode); fix.push([words.length, name]); words.push(0); };
  label('pace');
  words.push(0x084e2b);                           // movep x:DSR1,a
  words.push(0x57f000, 0x640);                     // previous OUTPUT half, x:$640 -> b
  words.push(0x0140c5, 0x4bd); branch(0x0af0a9, 'outputB');
  words.push(0x0140c5, 0x57d); branch(0x0af0a1, 'outputB');
  words.push(0x0140cd, 0x400); branch(0x0af0aa, 'pace');
  words.push(0x63f400, 0x400);                     // r3 = output A
  branch(0x0af080, 'input');
  label('outputB');
  words.push(0x0140cd, 0x4c0); branch(0x0af0aa, 'pace');
  words.push(0x63f400, 0x4c0);                     // r3 = output B
  label('input');
  words.push(0x084e2e, 0x60f400, 0x140);           // current DDR0; default input B
  words.push(0x0140c5, 0x13f); branch(0x0af0a9, 'commit');
  words.push(0x0140c5, 0x17f); branch(0x0af0a1, 'commit');
  words.push(0x60f400, 0x100);                     // latest completed input A
  label('commit');
  words.push(0x0af080, 0x4d);                      // stock stores r0/x:$641, r3/x:$640
  for (const [index, name] of fix) words[index] = labels[name];
  return { at, words, loopEnd: at + words.length - 1, req: -1, rel: -1 };
}
