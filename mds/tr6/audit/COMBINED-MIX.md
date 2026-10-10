# Combined metal gain envelopes

The default-off combined-mix experiment reaches **128.4375 modeled cold
clocks/sample for CH and 128.3125 for OH/CY** on the saved block-boundary
vectors. These are uncalibrated, sampled instruction-cache estimates, not
hardware measurements or an exhaustive worst-case bound. The full reference
ports and every earlier candidate remain available. Listening acceptance is
still open, especially for the band-pass filter inherited by this experiment.

## Changes

Three approximations build on the full-rate band-pass candidate:

1. Linear saturation retains drive gain and removes the cubic curve. The
   baseline renders did not hit the cubic clamp, but removing its curvature
   still changes sound and increases level.
2. Envelope endpoints move from eight to 32 samples apart. This also removes
   the outer control loop. A 32-sample interval requires full-rate synthesis;
   it is rejected with the half-rate experiment.
3. `--combined-mix` interpolates two complete gains: the tonal gain includes
   base envelope, bell accent and drive; the noise gain includes its envelope,
   drive and click. Multiplying at endpoints and interpolating the result
   approximates the former product of separately interpolated envelopes.

The inner loop advances two gains, reads X/Y scratch together, sums two
products and runs the output DC filter. Parallel moves load the DC feedback
coefficient from R2 and the previous input from R4 while other arithmetic runs.
The final scheduling change is checked against its preceding combined model;
it does not introduce another intended sound change.

The combined gains and steps reuse `whitein`, `whiteout`, `whiteerr` and
`clickerr`, whose old functions are bypassed or unused in this configuration.
These slots must reset on retrigger. A pilot accidentally preserved three
of them; the retrigger numerical sweep exposed this and the trigger reset was
fixed before qualification. Ordinary noise-filter history still follows the
existing reset rules. Output DC history stays in R4/X1, gain state in N1/N2
and steps in N3/N6. R2 becomes available after oscillator processing.

The C++ comparison model independently implements endpoint products using
the pinned source's floating-point signal path. `--combined-mix` requires
linear saturation, 32-sample envelopes, resident output, interpolated gate
and bypassed noise DC. The band-pass filter is optional for this API, but
enabled for the timing candidate reported here.

## Perceptual evidence

All scores use the existing lab's unnormalized, unaligned `mel-proxy-v1`.
RMS and native/C++ numerical errors are diagnostics, not sonic acceptance.

| Worst lifecycle loss, incremental stage | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Linear instead of cubic saturation | 0.546216 | 0.692422 | 1.068857 |
| 32 instead of eight-sample endpoints | 0.376280 | 0.064389 | 0.053785 |
| Combined instead of separate gain interpolation | 0.026412 | 0.010183 | 0.008196 |
| All three changes versus band-pass/cubic/eight-sample model | 0.549737 | 0.708179 | 1.064331 |
| All three changes, 32 ending-length cases | 0.312649 | 0.462792 | 0.463646 |

These stages have no categorical flags in the nine lifecycle cases per
voice. Linear saturation raises level by 0.136–0.295 dB. The rate change's
largest 1 ms envelope difference is 0.018243 full scale; the combined-gain
stage's maximum is below 0.000687. Low proxy loss is not proof of inaudibility.

Cumulative lifecycle loss against the complete 47-partial reference reaches
4.413068 / 4.098864 / 4.241624 for CH/OH/CY. The CH block-boundary negative-correlation
flag remains. Earlier oscillator/noise/filter changes contribute to these
results; the complete model must not be described as flag-free.

Native ensembles compare four matched candidate seeds with four reference
seeds and a second disjoint four-seed reference group. The saved reference
groups use the earlier full-rate, three-partial **cascade/cubic/eight-sample**
model. They are not the complete 47-partial reference. This comparison covers
the combined effect of the band-pass, linear curve and endpoint changes.

| Native ensemble | Reference split loss | Candidate loss | Ratio | Level delta, dB |
| --- | ---: | ---: | ---: | ---: |
| CH default | 1.032748 | 2.374050 | 2.299 | -0.179 |
| CH maximum | 0.911615 | 3.109558 | 3.411 | -0.504 |
| OH default | 1.044081 | 2.569123 | 2.461 | -0.217 |
| OH maximum | 0.964063 | 3.398706 | 3.525 | -0.811 |
| CY default | 1.078508 | 2.470523 | 2.291 | -0.007 |
| CY maximum | 1.020774 | 3.274613 | 3.208 | -0.167 |

Body-envelope errors are 0.338–1.370 dB. These ratios show a systematic
change beyond reference seed variation; they are not audibility thresholds.
The band-pass remains the dominant incremental spectral tradeoff.

## Numerical and state checks

All 147 primary, ending and native-seed renders pass against the independent
C++ model. Maximum pretrim errors are 0.00012732 / 0.00030923 / 0.00096067
for CH/OH/CY, below the existing 0.003 numerical limit. Maximum native peaks
are 0.5755 / 0.5947 / 0.7713 full scale. This establishes agreement with the
changed model, not fidelity to the original sound.

Eight additional renders cover wide DC feedback, xorshift noise, the original
filter cascade, tracks 0/15, maximum seed, unbounded tanh and scalar cubic
processing with 32-sample envelopes. The final parallel-move scheduling
preserves audio and all saved state/guard dumps in 27 lifecycle comparisons
against the preceding combined model. The actual disassembly confirms the
intended MAC/R2 and ASL/R4 parallel moves.

Eleven interleaved tracks over 512 blocks, 22 dirty-state reassignments and
tail-control capture checks pass with shared scratch poisoned. Six further
replays at unaligned X:`$203` / Y:`$243` preserve audio, cycle counts and dumps.
Standalone package reproduction, relocation at two placements and the draft
export rejection pass. All 344 retained default-off assembly bodies are
unchanged; 41 historical band-pass headers differ only in comments. All 300
previous C++ streams checked remain byte-exact. Twelve invalid configurations
are rejected across the generator, render/state CLIs and C++ model.

The 13 local TR6 comparison/profiler/table tests pass. `npm.cmd run check`
passes with 205 Node tests, 56 Python tests and the site build; 11
firmware-dependent Node tests remain skipped without supplied OS images.

The retained evidence is in `build/combined-final-{ch,oh,cy}` and their
`-endings` siblings, `combined-final-native-ensemble-v1`, `combined-final-state`,
`combined-final-unaligned.json`, `combined-final-default-compat.json` and
`combined-final-reference-compat/result.json`. Perceptual reports use the
`perceptual-combined-final-*` directories and record all input/tool hashes.

## CPU, resources and limits

| Candidate | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Raw maximum, clocks/block | 2,526 | 2,525 | 2,525 |
| Raw clocks/sample | 78.9375 | 78.90625 | 78.90625 |
| Sampled cold model, clocks/block | 4,110 | 4,106 | 4,106 |
| Sampled cold model, clocks/sample | 128.4375 | 128.3125 | 128.3125 |
| Program words | 2,490 | 2,617 | 2,617 |
| Package bytes | 8,236 | 8,632 | 8,632 |

CH's block-boundary model is 2,526 raw clocks + 630 modeled interlocks +
318 instruction-word misses at three clocks each. Relative to the prior
band-pass/cubic candidate, this saves 55.53125 raw and 64.65625 modeled
clocks/sample. The margin below 129 is only 18 modeled clocks per block.
The separate 3,951-clock admission threshold is still not demonstrated.

The explicitly traced one-sample CH ending costs 469 raw / 1,440 modeled
clocks, down from the band-pass candidate's 519 / 1,616. This tail regression
check is separate from the full-block maximum.

All 123 lifecycle/ending fixtures were replayed with the ordered tracer,
including each final active block in the 32-ending sweeps. Every replay
preserves ordinary-host audio, all call-cycle counts and final state/guard
dumps. The block-boundary and `end_32` vectors retain the largest sampled
model values in the table. Full reports are in
`build/combined-final-all-traces/result.json` and its per-fixture siblings.
This expands saved-vector coverage; it is not exhaustive control/placement
qualification.

Fetch waits are sensitivity inputs, not X.20 calibration; additive penalty
overlap is unvalidated. Data waits, dispatch, DMA and actual hardware are
not included. A sub-129 sampled model does not satisfy the complete CPU goal.

The seven-voice package total is 23,567 program words / 76,620 bytes; CP
brings it to 36,428 / 117,204. The library-byte field still does not fit.
Packages remain zero-cycle drafts and the exporter blocks installable SysEx.

## Reproduce

From `mds/tr6`, with the assembler, host and lab paths configured and the
optional NumPy/SciPy fitter dependencies installed:

```powershell
$flags = @('--partial-count','3','--no-wobble','--tanh-bits','8',
  '--lean-math','--resonators','--lcg-noise','--block-oscillators',
  '--resident-state','--envelope-rate','32','--block-noise',
  '--linear-saturation','--fused-mix','--bounded-loops','--deduplicate-tables',
  '--rounded-dc','--bypass-noise-dc','--interpolated-gate',
  '--register-mix','--resident-output','--bandpass-noise','--combined-mix')
python tools/render_metal.py ch @flags --out build/combined-final-ch --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py build/bandpass-ch build/combined-final-ch --allow-model-change
python tools/score_variants.py build/bandpass-ch build/combined-final-ch --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-combined-final-aggregate-v1/ch
```

Repeat for OH/CY and add `--end-boundaries` for all final-block lengths.
Add `--seed` and use `score_native_ensemble.py` for the matched native groups.
Use fresh scorer directories. The comparison command creates local A/B pages
for listening. Prefix synthesis options with `--metal-` for `check_state.py`
(except `--deduplicate-tables`). See [OPTIMIZATION-INPUTS.md](OPTIMIZATION-INPUTS.md)
for the ordered profiler. Trace the saved block-boundary vectors and the
final active block of each ending fixture, not only the default case.

Audio, fitted controls, native/reference comparisons, hashes, draft packages
and execution traces stay in ignored build directories. Scorer versions and
the native ensemble adapter are unchanged from [BANDPASS-NOISE.md](BANDPASS-NOISE.md).
