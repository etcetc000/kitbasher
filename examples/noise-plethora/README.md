# Noise Plethora

One Machinedrum machine, NZEPL, that plays the 30 programs of the first three
banks of [Befaco's Noise Plethora](https://github.com/Befaco/Noise_plethora),
rewritten for the DSP56300. Flurry and the later extra modes are not included.

## Controls

Knobs, in order: **PTCH, DEC, MODE, X, Y, ATK, BPF, BPQ**.

- **MODE** selects the program and relabels itself and the program's X and Y
  knobs (FREQ, SPRD, FM, PWID and so on).
- **PTCH** and **DEC** come first, as on every other model; **ATK** is the attack.
- **BPF** and **BPQ** set a band-pass filter after every program. BPF sets the
  center frequency, exponentially from 30 Hz to 7.3 kHz (default 80, about
  950 Hz). BPQ sets Q from 1 to 32. At BPQ 0 the signal passes dry at any BPF;
  turning BPQ up narrows the peak and deepens the floor smoothly: about -4 dB at
  16, -15 dB at 64 and -30 dB at 127. The center frequency always passes at unity.

The original's drive and level knobs are gone: drive is fixed at unity and the
level at its former default, so the track level sets loudness. The five programs
that used the drive knob for their own control keep its zero setting: smoothing
off for WalkingFilomena, Atari, radioOhNo and grainGlitchII, and a 50% pulse
width for BasuraTotal.

The original's internal reverb is left out; the Machinedrum's master reverb is
there instead.

## How it fits

Every program runs under the 129-cycle-per-sample target (worst: grainGlitchII,
about 125), and the whole machine uses 20,473 DSP2 words (4,687 of code, 15,786
of tables). Getting there meant replacing some of the original's structures. Each
program is one of:

- **Faithful:** the original structure and controls. clusterSaw, partialCluster,
  FibonacciCluster, pwCluster, S_H, BasuraTotal, basurilla, Rwalk_LFree,
  phasingCluster, the three grainGlitch programs, and the five feedback graphs
  (xModRingSqr, XModRingSine, CrossModRing, Atari, radioOhNo).
- **Near-faithful:** small, measured differences. crCluster2, arrayOnTheRocks.
- **Inspired-light:** the same idea and controls with a cheaper core.
  sineFMcluster, TriFMcluster, existencelsPain, whoKnows, resonoise.
- **Inspired:** a different technique for the same musical result. PrimeCluster,
  PrimeCnoise, satanWorkout, WalkingFilomena, Rwalk_BitCrushPW,
  Rwalk_SineFMFlange.

The main differences, by group:

- **Granular programs.** Grains are at most 469 samples (the original allows
  511) so three grain banks and the feedback ring fit the track's 1,536-word
  buffer. Banks rotate instead of being copied, and the grain FM factor is an
  exact 2^x at 1/256-octave steps.
- **phasingCluster.** The 16 LFOs and their detune update once per block,
  linearized to within about 0.7 cents.
- **FM programs.** One 2^x table (1/256 octave, ±8 octaves) replaces the
  per-sample exponential. Oscillators at fixed ratios share one phase
  accumulator; modulators are parabolic sines. crCluster2 is about 1.9 dB louder
  than the original; sineFMcluster and TriFMcluster update their FM factor every
  2 or 4 samples. PrimeCluster and PrimeCnoise use parabolic partials (all
  harmonics at 1/n²) instead of triangles, and a 24-bit noise generator.
- **Filters and walks.** Band-passes run once per sample instead of twice, with
  power-of-two damping and per-block coefficients ramped across the block. Walking
  PWM programs schedule their edges per block. WalkingFilomena mixes its sixteen
  squares by majority vote. Rwalk_BitCrushPW weights its nine pulses so BITS acts
  on more than three levels. Rwalk_SineFMFlange has a real swept flanger: the
  original resets its LFO on every control call, which leaves a fixed comb with
  interpolation grit.
- **satanWorkout.** Pink noise from Paul Kellet's three-pole filter on a 24-bit
  generator, in place of the original's pink source.
- **Shared code.** Programs are dispatched through a table of addresses; tables
  that the DSP code never reads are not packed; linear and quadratic knob laws
  (the MODE zones among them) are computed instead of stored. sineFMcluster reads
  TriFMcluster's base-rate column, and tables that held a constant column or a
  repeated period store it once. `authoring.py` asserts each of these is exact.

These changes were checked against an integer reference of the adapted
algorithms, bit for bit. That shows the DSP code does what the adaptation says;
it does not make the adaptation identical to the original Teensy code. A
listening comparison with the original module has not been made.

Known issue: in one reference case, where two tracks switch programs in an
interleaved pattern, track 15 is silent where the reference expects sound.

## Files

| File | What it is |
|---|---|
| `authoring.py` | Generates the model source directory (`model.json`, `dsp2.asm`, `tables.asm`) |
| `upstream-inventory.json` | The upstream revision, programs, gains and source hashes the port follows |
| `array-waveform.json` | The waveform arrayOnTheRocks plays |
| `dry-reference.patch` | The upstream programs with the internal reverb removed, as the reference |
| `compact-grains.patch` | The upstream grain programs with the shorter grains used here |
| `COPYING`, `TEENSY-NOTICE.txt` | Licenses; see below |

Generate the source and export a pack:

```text
python examples/noise-plethora/authoring.py --out build/noise-plethora
python packs/assembly_export.py build/noise-plethora --out my-packs/noise --assembler /path/to/asm56.exe
```

`authoring.py` refuses two DO loops that end on the same instruction
(`check_do_ends`). On the DSP56300 that leaves only the inner loop running; the
outer loop falls through with its state still stacked until DSP2 overruns. The
emulator re-checks the outer loop and hides the bug, so the generator checks it
instead.

## License and credits

Derived from Befaco Noise Plethora; the pinned upstream revision and per-file
hashes are in `upstream-inventory.json`. The Noise Plethora-derived code here is
GPL-3.0-or-later; see [COPYING](COPYING). The waveform interpolation and
exponential FM primitives follow the Teensy Audio library, under the MIT notice in
[TEENSY-NOTICE.txt](TEENSY-NOTICE.txt); the FM approximation is credited upstream
to Laurent de Soras. A pack or OS image that includes this model is distributed
under GPL v3 or later.
