import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputPaceRoutine } from '../src/outputpace.js';

// Execute the emitted instructions across every legal pair of codec DMA phases.
// In particular, deliberately desynchronize input/output by every possible word.
function run(dsr1: number, ddr0: number, previousOutput: number) {
  const p = outputPaceRoutine();
  let pc = p.at, a = 0, b = 0, r0 = -1, r3 = -1, diff = 0, steps = 0;
  for (; steps < 80; steps++) {
    if (pc === 0x4d) return { waiting: false, r0, r3 };
    if (steps && pc === p.at) return { waiting: true, r0, r3 };
    assert.ok(pc >= p.at && pc < p.at + p.words.length);
    const op = p.words[pc++ - p.at], immediate = p.words[pc - p.at];
    if (op === 0x084e2b) a = dsr1;
    else if (op === 0x084e2e) a = ddr0;
    else if (op === 0x57f000) { assert.equal(immediate, 0x640); b = previousOutput; pc++; }
    else if (op === 0x0140c5 || op === 0x0140cd) { diff = (op === 0x0140c5 ? a : b) - immediate; pc++; }
    else if (op === 0x60f400) { r0 = immediate; pc++; }
    else if (op === 0x63f400) { r3 = immediate; pc++; }
    else if (op === 0x0af080) pc = immediate;
    else if (op === 0x0af0a9 || op === 0x0af0a1 || op === 0x0af0aa) {
      const take = op === 0x0af0a9 ? diff < 0 : op === 0x0af0a1 ? diff >= 0 : diff === 0;
      pc = take ? immediate : pc + 1;
    } else assert.fail(`unexpected opcode ${op.toString(16)}`);
  }
  assert.fail('unexpected loop');
}

test('output pacing handles all codec phases, selects input independently, and never repeats an output half', () => {
  // Include intermediate words within each three-word output transfer, not just
  // the aligned positions normally returned by the emulator's DMA scheduler.
  for (let out = 0; out < 384; out++) for (let input = 0; input < 128; input++) {
    const dsr = 0x400 + out, ddr = 0x100 + input;
    const wantedOut = dsr >= 0x4bd && dsr < 0x57d ? 0x400 : 0x4c0;
    const wantedIn = input >= 63 && input < 127 ? 0x100 : 0x140;
    for (const previous of [0x400, 0x4c0]) {
      const result = run(dsr, ddr, previous);
      assert.equal(result.waiting, previous === wantedOut);
      if (!result.waiting) { assert.equal(result.r3, wantedOut); assert.equal(result.r0, wantedIn); }
    }
  }
});

test('output pacing fits its reserved area and accepts the initial zero output pointer', () => {
  const p = outputPaceRoutine();
  assert.ok(p.at + p.words.length <= 0x146400);
  assert.deepEqual(run(0x4bd, 0x13f, 0), { waiting: false, r0: 0x100, r3: 0x400 });
  assert.deepEqual(run(0x57d, 0x17f, 0), { waiting: false, r0: 0x140, r3: 0x4c0 });
});
