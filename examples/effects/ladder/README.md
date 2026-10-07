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
| A ColdFire handler turned knobs into control words | `controls` rounds each raw knob exactly as the handler did and copies the control word from `ctl` (8 × 128 words) into `Y:+$21..+$28`. It runs at the start of every render and trigger. |
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

The pack ran in a DSP56300 kernel harness (machinedrum-kit's `md-kernel`, both
DSP engines, registers randomized and memory poisoned on every call) against the
original's integer reference model, with raw knob words as kitbasher delivers
them (`knob << 16`, including slewed fractions). The audio, the ladder and
envelope state, and the eight control words were compared on every block.

| Check | Result |
|---|---|
| Cases | 49 cases, 9,976 blocks per engine: impulses in 5 modes × 3 resonances, enveloped sweeps, a 2,500-block random stress test, every value of every knob with trigs, all VCA zones, the tanh clamp, tracks 0 and 15 |
| Reference comparison | Exact; 0 mismatches |
| Booted Kitbasher image | Stock OS 1.63 prepared, core pack plus NFX4P (ID 4), every build gate passing, in a Machinedrum emulator: GND-NS on track 1, NFX4P on track 2. Three settings (4th and 2nd pole, envelope and gate VCA, bypass, drive up to 127) × 48 consecutive live blocks matched the reference exactly, from the knob words Kitbasher's knob callback delivered |
| Worst render block, emulated | 3,560 cycles (111.3 per sample); constant cutoff with the VCA bypassed 2,964 |
| Init / trigger | About 20 / 120 cycles |
| Cold-cache estimate | About 141 cycles per sample with the envelope on the cutoff (about 318 code words per block, 3 cycles each); about 110 with a constant cutoff |
| Hardware | Not tested |

The cold-cache figures are estimates, not measurements, and they are over the
129-cycle target with the envelope on the cutoff. They do not include pipeline
interlocks or data wait states. The original measured about 460 hidden cycles per
instance on hardware with the envelope VCA. The port adds the knob conversion
(about 100 cycles) and the external table reads. The original ran 14 instances
plus a generator on hardware with the envelope VCA on every track.

## Export

```text
python packs/assembly_export.py examples/effects/ladder --out my-packs/nfx-4p --assembler /path/to/asm56.exe
```

## License

GPL v3 or later, like the rest of Kitbasher. The ladder follows the author's
own Kocmoc uLADR.
