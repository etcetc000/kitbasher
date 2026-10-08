# NFX4P: neighbour 4-pole ladder filter

A Moog-style 4-pole ladder filter that processes the **previous track's** output,
with a trig-driven AD envelope on the cutoff and an envelope or gate VCA. Put a
sound on a track and NFX4P on the next one; trig NFX4P to run its envelope. The
ladder follows Kocmoc **uLADR** (`janne808/kocmoc-rack-modules`, `src/uLADR.cpp`).

This is a port of NFX-4P v6, a custom machine for Machinedrum OS 1.63. The
filter, envelope and VCA code is unchanged, and its output is bit-exact with the
original; [what the port changed](#what-the-port-changed) is listed below.

| Control | Behavior |
|---|---|
| FREQ | Cutoff, `0.001 + 2.25·c⁴` of the sample rate (as uLADR) |
| RESO | Feedback `fb = 5·RESO/127`; self-oscillates above about 100 |
| MODE | Output pole: 0–63 the 4th pole (24 dB/oct low-pass), 64–127 the 2nd (12 dB/oct) |
| ENVA | Envelope depth on the cutoff: 64 none, above 64 up, below 64 down |
| ATK | Envelope attack, 1 ms to 10 s, exponential |
| DEC | Envelope decay, 1 ms to 10 s, exponential |
| GAIN | Input drive into the ladder: passband gain `9.6·(GAIN/127)⁴`, 0.62 at 64 |
| VCA | 127 bypass; 64–126 the envelope sets the output level; 0–63 a gate that opens for a fixed length on each trig |

The input is the previous track's raw DSP2 voice, before its DSP1 effects and
level. On the first track NFX4P outputs silence.

Because NFX4P reads the source track before its level, the source track still
plays on its own at whatever level it is set to. To hear only the filtered
signal, turn the source track's LEVEL down: NFX4P's input does not change.

## Ladder

Semi-implicit Euler, two steps per sample (pseudo 2× oversampling):

    dt = cutoff/2 (≤ 0.55), error = 1 + 2·dt
    p0 += dt·(tanh(in − error·fb·p3) − p0)
    p1 += dt·(p0 − p1);  p2 += dt·(p1 − p2);  p3 += dt·(p2 − p3)
    out = 12 · {p3 | p1}

- **Fixed point.** The four poles are Q23 values; each update is a `mac` pair
  with convergent rounding (`macr`).
- **tanh.** A 1,025-word table of `tanh(8·m)`, m = 0…1, interpolated linearly.
  The argument is clamped at 8 through the accumulator limiter. The worst error
  against tanh is 55 LSB (−103.7 dBFS) over the whole range.
- **Output.** The selected pole is scaled by 2.4 (12 V over a 5 V full scale)
  and saturates at full scale.

## Envelope and VCA

- **Envelope.** A trig restarts the attack, which charges toward twice full
  scale and turns into the decay on reaching full scale. The envelope advances
  once per 32-sample block by its exact 32-sample step (`1 − (1 − k)³²`), and with
  ENVA away from 64 the cutoff ramps linearly across each block.
- **VCA, envelope (64–126).** The output follows the envelope level, ramped
  linearly per block and slew-limited to full scale in 1 ms.
- **VCA, gate (0–63).** Each trig opens the gate for `(VCA + 1)` 1/128 notes **at
  120 BPM**: 15.6 ms at 0, 1 s (a half note) at 63. The original took the length
  from the sequencer tempo, which the DSP cannot read.
- **Bypass (127)** leaves the filter output untouched.
- **Ramp loop.** The per-sample gain multiply is software-pipelined: three
  instructions per sample and no pipeline interlocks, where the original's four
  stalled twice per sample. It uses a signed `mpy` (the gain stays in
  0…`$7FFFFF`, so the product is the original `mpysu`'s) and is bit-exact with
  it: about 92 fewer hardware cycles per block with the envelope VCA, 28 of them
  visible in the emulator.

## What the port changed

| Original (custom OS machine) | Port (`md-voice/1`) |
|---|---|
| A ColdFire handler turned knobs into control words | `controls` rounds each raw knob exactly as the handler did and copies the control word from `ctl` (8 × 128 words) into `Y:+$21..+$28`. At the start of every render and trigger, `knobs` compares each raw knob word with its snapshot in `X:+1..+8`, exactly, and runs `controls` only when one differs or after init. |
| Control words at `Y:+1..+8` | `Y:+$21..+$28`; `Y:+1..+8` hold the raw knobs, read only |
| tanh table in DSP2 internal `X:$280` | `tanh` in the model's tables, read through the external X alias. On hardware this adds 128 external reads per block, about 1 wait state each. |
| Per-render scratch `X:$0`/`X:$1` | `N7` and `Y:+$19` |
| Gate length from the sequencer tempo | Fixed at 120 BPM |
| Input from the track before, or from a two-track machine's own block | Always the track before |

`make_tables.py` regenerates `tables.asm` from the formulas; the exporter never
runs it. The 1,024 control words equal the original handler's output for every
knob value.

**Assembler pitfall.** Kitbasher's encoder separates parallel moves on two or
more spaces. Write `move x:(r4)+,x0  b,y0` with two spaces: with one, the second
move is dropped without an error.

## Checks

`npm run test:ladder` (`ci/ladder_check.py`) runs the bundled pack on a DSP56300
instruction host and compares every output sample with an independent integer
model of the envelope, ladder and VCA: 31 cases and 109,696 samples, covering
RESO 127, both cutoff extremes, both output poles, the envelope up and down with
both time extremes, every VCA zone, GAIN 0 and 127, silence, full-scale and square
input, the first track, knob motion with fractional raw words, a 400-block random
stress test and two interleaved tracks. Each case starts from a poisoned voice
block whose knob snapshot already holds the case's knobs, so a missed controls
run after init fails. The filter and envelope state, the snapshot and the other
voice blocks are checked too. The reference model reproduces the original port's
output exactly, and every optimization below was checked against it; the audio of
all 31 cases is identical, sample for sample, before and after.

Before that, the pack ran in a DSP56300 kernel harness (machinedrum-kit's `md-kernel`, both
DSP engines, registers randomized and memory poisoned on every call) against the
original's integer reference model, with raw knob words as kitbasher delivers
them (`knob << 16`, including slewed fractions). The audio, the ladder and
envelope state, and the eight control words were compared on every block.

| Check | Result |
|---|---|
| Cases | 49 cases, 9,976 blocks per engine: impulses in 5 modes × 3 resonances, enveloped sweeps, a 2,500-block random stress test, every value of every knob with trigs, all VCA zones, the tanh clamp, tracks 0 and 15 |
| Reference comparison | Exact; 0 mismatches |
| Booted Kitbasher image | Stock OS 1.63 prepared, core pack plus NFX4P (ID 4), every build gate passing, in a Machinedrum emulator: GND-NS on track 1, NFX4P on track 2. Three settings (4th and 2nd pole, envelope and gate VCA, bypass, drive up to 127) × 48 consecutive live blocks matched the reference exactly, from the knob words Kitbasher's knob callback delivered |
| Worst render block, emulated | 3,419 cycles (106.8 per sample), in a block where a knob moves; about 3,270 when none does; constant cutoff with the VCA bypassed 2,798 |
| Init / trigger, emulated | 33 / 66 cycles; a trigger that has to remake the control words 179 |
| Hardware estimate | About 146 cycles per sample at worst, 138 with no knob motion, 116 with a constant cutoff (below) |
| Hardware | Not tested |

The hardware estimate adds to the emulated cycles what the emulator does not
charge, for the worst measured block of each kind:

| Part | Envelope on the cutoff, knob moving | No knob motion | Constant cutoff, VCA bypassed |
|---|---:|---:|---:|
| Emulated | 106.8 | 102.0 | 87.4 |
| Pipeline interlocks | 0.9 | 0.7 | 8.1 |
| External table reads, 1 wait state each | 4.3 (136 reads) | 4.0 (128) | 4.0 (128) |
| Cold instruction cache, 3 cycles a code word | 33.8 (360 words) | 31.1 (332) | 16.7 (178) |
| **Total, cycles per sample** | **145.8** | **137.8** | **116.2** |

Interlocks are counted on the executed path with the DSP56300 rules (an
accumulator read by the move right after the instruction that wrote it; a move
reading an accumulator the move before it wrote; an address register used within
three clocks of a move that wrote it). Before the reordering they were 543 cycles
a block with the envelope, 15 a sample in the ladder loops plus 40 in the knob
conversion; now 29. The constant-cutoff loops keep 6 a sample: their table
address has no independent work to fill the three clocks before it is used.

These are estimates, not measurements, and all are over the 129-cycle target with
the envelope on the cutoff; the cache term is the largest and the least certain.
The original measured about 460 hidden cycles per instance on hardware with the
envelope VCA, and ran 14 instances plus a generator with the envelope VCA on every
track.

## Export

```text
python packs/assembly_export.py examples/effects/ladder --out my-packs/nfx-4p --assembler /path/to/asm56.exe
```

## License

GPL v3 or later, like the rest of Kitbasher. The ladder follows the author's
own Kocmoc uLADR.
