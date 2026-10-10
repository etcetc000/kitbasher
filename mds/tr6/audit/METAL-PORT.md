# TR6-CH / TR6-OH / TR6-CY functional ports

The shared fixed-point engine retains all **47 partials**, their individual
wobble states, pitch-dependent anti-alias taper, bell accent, noise path,
envelopes, gate, saturation, click and output DC blocker. These are development
MDS packages, not shipping machines. CPU cost is far above the under-129 target.

Source: Simple606 `6aacda7a14a8c097d32836039fd356eb0976ba8e`, `HiHats.hpp`,
`SynthDrumCommon.hpp`, and the actual cymbal specification extracted from
`PluginProcessor.h`. See [LICENSE-Simple606](../LICENSE-Simple606). The source
headers compile directly in `tests/metal_reference.cpp`, without JUCE.

## Algorithm and state

Each voice uses **58 local X words**, no mutable local Y words, and **376 external
words**: 47 records of eight words. A record holds phase, phase remainder,
increment, increment remainder, amplitude, bell flag, wobble and wobble remainder.
The MDS track resource supplies the base; INIT adds `1536 * R1`, saves that
pointer locally, and clears the owned records before use. The remaining 1,160
external words are untouched. No shared scratch or another track's state is used.

Even muted partials retain their source behavior: each consumes a wobble RNG
draw every active sample. Pitching up fades a partial between 0.40 and 0.48
times the sample rate, then zeros its increment and amplitude. There is no
partial-count reduction, downsampling, sampled hit, or substitute noise engine.
The 47 independent wobble states use successive draws from one dedicated RNG.

Init uses the plugin's distinct CH/OH/CY seeds, `$606606`/`$606607`/`$606608`, and
the source's phase, wobble and noise XOR salts. All xorshift32 state transitions
are exact. Trigger consumes 47 new starting phases and resets wobble, colored
filters, envelopes and the output DC blocker. The noise RNG **and its preliminary
DC-filter history continue across retriggers**, as in the original WhiteNoise
object. The phase and wobble RNGs also continue. Those histories reset at INIT.

CH, OH and CY retain their separate source coefficients and durations. Decay,
pitch, HP/LP coefficients, fade lengths and envelope poles are captured at each
trigger. The two exposed raw14 controls are:

| Control | Default | Mapping after `raw14 >> 7` |
| --- | ---: | --- |
| DEC | 89 for CH/OH; 102 for CY | `max(0.05, knob / 127)` |
| TUNE | 64 | `2 ** ((-12 + 24 * knob / 127) / 12)` |

Fractional controls currently floor to the integer setting. The plugin's
cross-voice hat choking lives in its host wrapper, outside this DSP class.
Independent MDS tracks do not inherit that interaction; firmware/kit routing
still needs a deliberate integration check. The port does not write across tracks
to manufacture a choke.

## Numerical choices

- Audio/filter state uses **Q19**, leaving internal range for the sum of 47
  components. Partial amplitudes use Q21. Each phase and increment has a 24-bit
  word plus a 24-bit remainder. Trigger frequency multiplication retains split
  coefficients, rather than rounding every increment to a whole phase word.
- Wobble uses **Q26** with retained update remainders. Scaled coefficient
  multiplication preserves the small drive and correlation terms. The update
  occurs before the corresponding phase advance, matching the source.
- Sines use the MDS 32,768-entry import. The test host constructs that table
  mathematically; its equality to an actual device's table remains unverified.
  Float32 radian-phase arithmetic and fixed-point turns do not round identically.
- Envelopes store `2 * (1 - pole)` and retain product remainders. This preserves
  the extra fractional bit of the source float32 poles near one. The attack uses
  its complementary remaining envelope. The gate uses a split reciprocal to
  avoid coarse rounding during the long OH/CY fades.
- Trigger filter coefficients come from the actual initialized C++ objects.
  The source filter topology is retained. The pitch-dependent amplitude taper
  is evaluated in fixed point, with the same smoothstep law and thresholds.
- The random-state sequence is exact; conversion to audio uses the top 24 bits.
  Source `Random::bipolar()` converts all 32 bits through float32. This produces
  small amplitude/phase differences, included in the comparisons.
- Tanh uses 8,193 interpolated points over [-8, 8], at 1/512 input spacing.
  A persistent counter records any range clamp. Validation requires it to stay
  zero over the entire run, including retriggers.
- A final **0.5 gain** supplies 6.02 dB of output headroom for source peaks above
  one. Error calculations undo this gain. Paired WAVs apply it to both signals.

## Reproduction and checks

From `mds/tr6/`, after bootstrapping the pinned sources:

```powershell
python tools/generate_metal.py
python tools/render_metal.py ch --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py oh --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py cy --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/mds_build.py machines/ch/ch.asm machines/ch/ch.json --track-memory `
  --assembler $env:MD_ASSEMBLER --out build/ch-package
```

The renderer's default track number is 3, exercising a nonzero INIT R1 value.
`--track 0` and `--track 15` exercise the allocation boundaries. A test-only
assembly trampoline supplies R1 because the existing instruction host has no
register-set command. It is outside the machine package. Each test poisons all
16 external track regions and checks every word outside the owned 376, plus
outer guards, local reserved words and output-buffer guards. Registers are
scrubbed between calls. Relocation and both imports are checked against fresh
assembly at two placements; the actual renderer uses distinct sine/track bases.

Cases cover default controls, four DEC/TUNE corners, active-tail retriggers,
retrigger after idle, delayed first trigger, and a voice ending on a block
boundary. Single hits run through natural idle plus at least 32 silent blocks;
retrigger tests span 1,024 blocks. All three RNG states, duration, frame count and
activity are checked against independent complete C++ renders. The fixed
pre-trim peak-error bound is **0.003 full scale**; no listening equivalence is
implied. `--blocks` is a diagnostic override and can deliberately stop early.

Artifacts stay in ignored `build/ch-comparison/`, `build/oh-comparison/` and
`build/cy-comparison/`: exact trigger tables, relocated code, scripts, logs,
paired WAVs, raw floats and `comparison.json`. Supplemental boundary/track-end
tests use separate output directories. Generated source and metadata are tracked;
packages have zero admitted cycles and upstream SysEx export must reject them.

## Measured baseline

All **29 source comparisons pass**: nine scenarios per voice, plus CH on track 0
and CY on track 15. All RNG, frame, activity, local/external guard, output-buffer
and unclamped-tanh checks pass. The CH/OH block-boundary runs are in separate
`build/ch-boundary/` and `build/oh-boundary/` directories; CY's main suite includes
that case. The allocation-end runs are `build/ch-track0/` and `build/cy-track15/`.

The shared state check also passes: nine interleaved tracks over 512 blocks each,
16 dirty-state machine reassignments, and SD/LT/HT/CH/OH/CY control changes during
tails produce bit-exact matches to isolated native renders. This includes
reassignment between external-memory voices and local-memory voices. The
standalone `mds_build.py --track-memory` CH package is byte-identical to the
package used for the source comparisons.

| Voice | Program words | Worst pre-trim peak error | Default error SNR | Largest observed raw clocks/block | Raw clocks/sample |
| --- | ---: | ---: | ---: | ---: | ---: |
| CH | 11,036 | 0.00007760 | 83.51 dB | 245,437 | 7,669.91 |
| OH | 11,035 | 0.00015070 | 81.74 dB | 245,405 | 7,668.91 |
| CY | 11,035 | 0.00049237 | 73.43 dB | 245,405 | 7,668.91 |

The greatest tested untrimmed source peaks are 1.13423, 1.14214 and 1.39241
respectively. The extra output gain prevents clipping in these cases. It is
not asserted to be a proven bound over every possible seed/control sequence.

Ending exactly on a block boundary adds seven clocks to the otherwise-largest
active render path. The tested boundary decays are CH 31, OH 25 and CY 8, at
TUNE 64. The raw costs include the instruction host's call stub and exclude
pipeline interlocks, cache fetch penalties, data-memory waits, firmware dispatch
and DMA effects. They are **not cold-cache measurements**. The raw baseline alone
needs approximately a 60-fold reduction to reach 129; program-size fit does not
make these machines CPU-admissible. No synthesis reduction has been made to
manufacture a passing performance result.

Remaining work includes CP, listening review, fractional/live control decisions,
hat choking integration, broader modulation and seed coverage, ordered timing,
optimization, complete-family capacity/admission checks and hardware validation.
