# CP functional port

CP is the Simple606 clap extension to the TR6 family. The draft preserves the
source's shared-noise FIR bank, synthesized bursts, pitch-dependent spectral
compression and reconstruction, saturation, dry/noise blend, and air path.
It is not CPU-admissible or hardware-qualified.

## Source and control contract

The source is `Source/Clap.hpp` at Simple606 commit
`6aacda7a14a8c097d32836039fd356eb0976ba8e`; see `LICENSE-Simple606`.
The plugin calls `init(sampleRate)` with the clap's default seed `0x0606c1a9`.
The standalone C++ comparison includes that actual header, with test-only access
to private fields. It does not replace the source synthesis with a second model.

Controls are captured at trigger. MDS raw14 values currently floor to the integer
knob value, as in the other TR6 drafts:

| Parameter | Mapping | Default |
| --- | --- | ---: |
| DEC | `max(0.05, knob / 127)` | 102 |
| TUNE | `2^((-12 + 24 * knob / 127) / 12)` | 64 |
| NOIS | `knob / 127` | 64 |

The C++ harness computes these mappings with the source's float32 arithmetic.
TUNE 63 is below unity and 64 above it; this integer map has no exact-unity
setting. NOIS 63 uses the source's left-side blend and 64 engages a small amount
of air. These differences from the plugin's exact midpoint defaults are explicit.
The voice lasts exactly 13,275 output samples (0.301 seconds rounded up), at all
controls. Retrigger clears filters, history and clocks but preserves RNG state.
The filter prewarm always consumes 192 six-draw Gaussian-like samples.

## Complete signal path

- Four color FIRs share one noise history. At and below unity they have 192 taps;
  above unity, the source's cubic coefficient compression and energy normalization
  shorten them to `ceil(192 / pitch)`, reaching 96 taps at maximum tuning.
- Four short bursts, a snap, two terminal decays, foundation and terminal-floor
  layers retain their individual onset, attack, hold, decay and gain rules.
  Handoff/fast/late color transitions use raised-cosine ramps.
- Below unity, the core runs at `44100 * pitch`. The complete 128-tap,
  33-phase reconstruction table and linear interpolation between phases are
  retained. Both full and dry signals are reconstructed. The first output sample
  generates 65 core frames for look-ahead; this is a substantial first-block cost.
- The final raised-cosine-to-the-fourth fade, calibrated tanh, dry/noise control,
  residual high-pass, dense-noise tanh and air mix are retained.

No FIR tap reduction, partial rendering, substitute filter or sample playback
has been introduced to meet the CPU target.

## Representation and resources

The draft uses **12,861 program words**, **71 local state words** (64 X and 7 Y,
starting at Y9), and **1,472 external words** per track. INIT receives the ABI's
track number in R1 and adds `1536 * R1` to imported external-track symbol 6.
The layout leaves 64 external words unused:

| External offset | Words | Contents |
| --- | ---: | --- |
| 0 | 768 | Four 192-word coefficient banks |
| 768 | 192 | Shared noise history |
| 960 | 512 | 256 full/dry reconstruction frames |

Audio is Q18 (range approximately ±32), coefficients Q23, cubic interpolation
intermediates Q21, and envelope outputs Q21. FIR/reconstruction accumulations
retain a 48-bit remainder. Core time uses Q24 plus a 24-bit remainder; resampler
position uses an integer and 24-bit fraction, preserving the source's float32
step and exact generated-frame/RNG counts. There is an additional **0.5 output
gain**; comparisons undo it before computing error.

Deliberate numerical differences are:

- The same xorshift32 state transitions and six draws per Gaussian-like sample
  are preserved. Bipolar conversion uses the high 24 bits with a power-of-two
  divisor and fixed-point accumulation rather than the source's double arithmetic.
- Cubic coefficients are calculated at trigger from the source arrays. The
  per-pitch normalization factors are exported from the actual source arithmetic.
  Fixed-point source positions and polynomials differ slightly from float32
  coefficient evaluation; every integer pitch is separately checked.
- Exponentials use an interpolated 2,049-point `exp(-x)` table over 0..32, with
  zero beyond that range. The omitted mathematical remainder is below `1.3e-14`.
  Tanh uses 2,049 points over ±8 at 1/128 spacing, with a range-clamp counter.
- Raised-cosine ramps use the imported 32,768-word sine table without interpolation.
  The test table is mathematically generated; the actual target table still needs
  comparison. Very short attacks are sensitive to time and table quantization.
- Attack completion is checked before dividing age by attack length. Scaling a
  late sample first can overflow the DSP's extended accumulator; the full-tail
  comparison caught this during development.
- Reconstruction explicitly discards fractional accumulator bits before forming
  the integer phase-table address. The just-below-unity pitch case exercises
  fractional phase interpolation that a half-rate test alone does not cover.

The comparisons establish bounded numerical error for the stated cases. They
do not establish listening equivalence or a bound over all seeds and modulation.

## Reproduction

From `mds/tr6`, with the pinned dependencies bootstrapped and the external host
and assembler configured:

```powershell
python tools/generate_clap.py
python tools/render_clap.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_clap_tables.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

`render_clap.py` checks full default/corner hits, tuning and noise-branch boundaries,
active and idle retriggers, and delayed first trigger. The fixed pre-trim peak
error bound is 0.003 full scale. It checks source frame/activity/RNG state,
reconstruction generation count, filter ring position and coefficients; it
poisons all 16 external regions and verifies all unowned words, local reserved
words and output guards. Registers are scrubbed between calls. `--blocks` is a
diagnostic override that may stop before natural idle; it is not a full-tail test.

`check_clap_tables.py` exercises every integer DEC/TUNE/NOIS position across 128
triggers. It checks all four coefficient banks against the source, tap counts,
exact prewarm RNG consumption and state reset. This is a configuration sweep,
not 128 complete audio renders. Its coefficient-error limit is 0.00001.

Artifacts stay in ignored build directories. Packages declare zero admitted
cycles, and the actual upstream converter must reject SysEx export. No firmware
or hardware is modified.

## Measured baseline

All **13 complete source comparisons pass**: the twelve named scenarios plus
the minimum case on external track 15. All frame/activity/RNG, generated-frame,
ring-position, coefficient, local/external guard, output-buffer, idle-silence
and unclamped-tanh checks pass. The largest pre-trim peak error is
**0.000344724 full scale** (maximum decay and air at minimum pitch). Default
error SNR is **73.22 dB**. The largest tested untrimmed source peak is 0.612869;
this is not a bound over every possible RNG/control sequence.

The 128-position configuration sweep also passes. The largest coefficient
error against the actual source is **0.000001404**, below the fixed 0.00001
limit. Prewarm RNG states, tap counts, history positions and trigger resets
match exactly. It is not a full audio sweep at all 128 pitches.

The mixed-machine check passes **eleven interleaved tracks** over 512 blocks
each, including both direct and resampled CP instances. **22 dirty-state
reassignments** and SD/LT/HT/CH/OH/CY/CP control changes during tails match isolated
native renders bit for bit. CP reassignments cover BD, SD and CY in both directions.

| Case | Raw trigger clocks | Raw first-render clocks | Largest raw later-render clocks |
| --- | ---: | ---: | ---: |
| Default | 223,197 | 371,041 | 389,683 |
| Minimum controls | 223,797 | 1,148,250 | 501,636 |
| TUNE 63, maximum decay/air | 223,797 | 1,331,140 | 698,932 |

The largest first render averages **41,598.13 raw clocks/output sample** over
the 32-sample block. Trigger plus that first render totals **1,554,937 raw
clocks**, including two instruction-host call stubs. Later renders are also
far above the user's under-129 target. These are raw instruction-host cycle
table counts: cache fetches, pipeline interlocks, external-data waits, firmware
dispatch and DMA are excluded. They are **not cold-cache measurements** and
must not be used as an installable cycle declaration.

The recorded comparison artifacts are `build/cp-comparison/` and
`build/cp-track15/`; the configuration sweep is `build/cp-tables/`. Generated
source matches the assembly used in those comparisons, and relocation/import
patches match independent assembly at two placements.

CPU optimization, numerical range proof across broader seeds, listening review,
fractional/live control decisions, cold-cache timing, shared-family storage
compaction, firmware admission and hardware validation remain open.
