# TR6-LT / TR6-HT functional ports

Both Simple606 toms now render as origin-zero, relocatable DSP56303 MDS drafts.
They preserve the source signal paths and fit the per-track state allowance.
They are **not optimized, cold-cache qualified, installable, or hardware tested**.

The source remains Simple606 `6aacda7a14a8c097d32836039fd356eb0976ba8e`,
`Source/Toms.hpp` and `Source/SynthDrumCommon.hpp`; see [LICENSE-Simple606](../LICENSE-Simple606).
`tests/tom_reference.cpp` compiles those headers directly, without JUCE.

## Signal paths and controls

LT retains its 124.435 Hz main oscillator with the 39.921 Hz exponential glide,
second/third harmonics, separate 367 Hz strike, three independent noise streams
with HP/LP cascades, and the additional focused strike filter fed by the high
noise stream. HT retains its 208 Hz main oscillator, harmonics, 135.616 Hz lower
ring, 285 Hz strike and all four upper modes, plus all three noise cascades.
Mode levels, start phases, attacks, decays and the source's 0.8 output trim are
retained. Source branches with constant zero mode levels remain absent for LT.

Both machines expose two trigger-captured raw14 controls:

| Control | Default | Mapping after integer knob extraction |
| --- | ---: | --- |
| DEC | 102 | `max(0.05, knob / 127)` |
| TUNE | 64 | `2 ** ((-12 + 24 * knob / 127) / 12)` |

The integer knob is `raw14 >> 7`; fractional modulation currently floors, as in
the other initial TR6 ports. These controls cover the plugin's decay and pitch
ranges. The default knob values approximate its 0.8 decay and unity pitch.
Filter histories, oscillators and envelopes restart on a hit. The three random
streams continue across retriggers. Init uses the plugin seeds: LT `$6061`, HT
`$6062`, with the three source XOR salts unchanged.

## Fixed-point representation and known differences

- Audio and biquad histories use Q20 for internal headroom. Coefficients that
  can approach magnitude two are stored divided by two and restored in the
  multiply path. The source's transposed direct-form-II filters are retained.
- Envelope recurrences use Q23 values with retained multiplication remainders.
  Rises are represented by the complementary decaying remainder. This is
  algebraically equivalent to the source rise but rounds differently from its
  float32 update; the audio comparisons include that difference.
- Phases wrap at 24 bits. Frequency has four additional fractional bits and a
  carried remainder. Each phase advances before evaluation, matching the tom
  source. Sine reads use the MDS 32,768-entry resource, including the main
  oscillator's second and third harmonics. The host resource is mathematical;
  equivalence to an actual device's sine table remains unverified.
- All three xorshift32 state sequences are exact. The top-24-bit noise amplitude
  map divides by `2^24`, whereas the C++ source divides by `2^24-1`. The ideal
  mapping difference is at most `2^-23`; float32 and filter rounding contribute
  additional small differences covered by the comparisons.
- Trigger coefficients are obtained from the original C++ object's initialized
  fields. No independently fitted cutoff/decay approximation is introduced.
  A 128-entry lifetime table reproduces the source's float32 envelope updates
  and weighted-mode silence test. This keeps sample counts and RNG advancement
  exact despite small fixed-point envelope differences at the silence threshold.
- An additional **0.5 output gain** provides 6.02 dB of headroom. The low-tom
  corner tests reach 1.01398 in the untrimmed reference, beyond signed Q23 output.
  Both toms use the same extra gain. Error calculations divide native output by
  this gain; paired WAVs apply it to both signals. The trim cannot hide error.

## Reproduction

From `mds/tr6/`, with the pinned sources bootstrapped and Clang C++14 available:

```powershell
python tools/generate_toms.py
python tools/render_toms.py lt --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_toms.py ht --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_toms.py lt --sweep-decay --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_toms.py ht --sweep-decay --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

The generator builds the source-backed coefficient exporter in ignored
`build/tom-reference/`. Renderers keep coefficients, assembly, package metadata,
scripts, host logs, raw output, paired WAVs and `comparison.json` in
`build/lt-comparison/` and `build/ht-comparison/`. Decay sweeps reuse `sweep.*`
scratch files; all case metrics remain in the report. See [BD-PORT.md](BD-PORT.md)
for external assembler/host provenance and the outstanding public-host setup gap.

Every assembly package is rechecked against independent relocation at two
placements. Packages declare zero admitted cycles; the upstream SysEx converter
must reject them. No device transfer is part of these commands.

## Current evidence

The eight base scenarios per machine cover default settings, all four DEC/TUNE
corners, retriggers every 137 blocks with both overlapping and already-idle
tails, and ten silent blocks before a first hit.
Each renders 65,536 samples and compares against the original source with a
fixed peak-error limit of **0.0005 full scale before the added gain**. All sixteen
base comparisons pass, including exact frame/activity and three RNG states,
parameter/reserved-word guards, track-boundary guards and complete output-buffer
writes. Single-hit cases reach idle and produce exact zero output thereafter.

Both machines also pass **all 128 integer decay settings** at TUNE 64, with
32,768 samples per case. The independent full C++ render confirms every
table-derived lifetime and final RNG state. Across the 272 total comparisons,
the worst peak errors are **0.00046335 (LT)** and **0.00024650 (HT)**, both at
DEC 127/TUNE 0. These are numerical bounds over this test set, not listening
judgments. The added idle-retrigger runs are retained separately in
`build/lt-idle-retrigger/` and `build/ht-idle-retrigger/` for this validation.

| Machine | Program words | Persistent state words | Default peak error | Default error SNR | Largest tested host cycles/block |
| --- | ---: | ---: | ---: | ---: | ---: |
| LT | 5,304 | 89 (X64 + Y25) | 0.00018657 | 76.68 dB | 31,226 |
| HT | 5,866 | 107 (X64 + Y43) | 0.00018403 | 77.75 dB | 36,026 |

Y state begins at offset 9, preserving Y0 and all eight host parameter words.
Thus the highest used Y offsets are 33 (LT) and 51 (HT), within the 64-word
allowance. Both draft packages conservatively declare X64/Y64.

Six interleaved native tracks (BD, two SDs, LT and two HTs) match isolated renders
bit-for-bit for 512 blocks each. Eight dirty-state machine reassignments pass,
including both directions between LT/HT, BD/LT and SD/HT. SD/LT/HT controls changed
during a tail leave it unchanged until the next trigger. Results are in the
ignored `build/state-check/result.json`.

The raw cycle-table costs are **975.81/sample (LT)** and **1,125.81/sample (HT)**.
The decay sweep catches a seven-clock increase when the final active sample
lands at a block boundary (LT DEC 7, HT DEC 68); default/corner tests alone miss it.
They exclude cache misses, pipeline interlocks, memory waits and firmware
dispatch. They are not cold-cache measurements and fail the under-129 target
even before those costs. The initial literal translations deliberately retain
all audible components and three full-rate random streams. No CPU or listening
approval is implied by the numerical passes.

Remaining: hats/cymbal/clap ports, broader pitch/modulation and multi-placement
coverage, listening review, ordered timing analysis, optimization, complete-family
resource/admission checks, final SysEx qualification and device testing.
