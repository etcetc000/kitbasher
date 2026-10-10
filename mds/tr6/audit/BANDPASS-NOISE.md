# Single-band-pass noise experiment

`--bandpass-noise` replaces the two noise-filter biquads with one fitted
band-pass. It is default-off, requires block-noise rendering and uses optional
NumPy/SciPy tools at generation time. This is a **sonic tradeoff under
evaluation**, not a listening-approved replacement for the current full-rate
cascade candidate. Full reference ports and the cascade remain available.

The coefficient shape follows the normalized constant-peak-gain band-pass in
the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/), with an
additional fitted gain. For each of 128 pitch settings, `fit_noise_bandpass.py`
fits frequency, Q and gain to the pinned source's high/low-pass cascade. It
minimizes squared differences of `log1p(magnitude / 0.01)` at 384 mel-spaced
frequencies from 40 Hz to 0.499 times the sample rate. This response-fit
objective is **not** the perceptual acceptance metric.

The fit produces float32 coefficients; the native emitter quantizes them into
half-scale Q23 tables. All 1,152 assembled coefficient words agree with their
fit inputs, and the actual quantized poles are stable at all 384 voice/pitch
settings. Maximum pole radii are CH/OH 0.893405 and CY 0.833866. Generation also
rejects nonfinite fits, failed optimizations and unstable quantized poles.

The independent C++ model reads the coefficient file and uses the source's
floating-point biquad implementation. It changes the high-pass instance to a
band-pass and the following low-pass to identity. The DSP emitter executes
only one filter pass, with zero middle feedforward coefficient and a negated
final feedforward term. It removes the unused second filter's tables. Noise
draw count, oscillators, controls, envelope timing and saturation are retained.

## Perceptual evidence

The existing lab's unnormalized, unaligned `mel-proxy-v1` scores are:

| Worst loss | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Incremental lifecycle | 3.297517 | 3.496476 | 3.381199 |
| Incremental ending sweep | 2.684436 | 2.658468 | 2.586552 |
| Cumulative lifecycle versus full reference | 4.251578 | 4.002030 | 4.068431 |

All 123 incremental lifecycle/ending pairs have no categorical flags. Across
lifecycle cases, level changes range from -1.033 to -0.151 dB, with paired
waveform correlation from 0.876 to 0.973. These are material spectral and
transient changes, not an exact scheduling optimization. A lack of categorical
flags does not establish acceptable sound.

Cumulative comparison against the full 47-partial reference includes one CH
block-boundary `negative_waveform_correlation` flag: correlation -0.01950 and
level change -0.45970 dB. This is a combined comparison including the earlier
noise and oscillator changes. It must not be described as flag-free or as
listening-qualified.

Native seed ensembles reuse two disjoint four-seed reference groups and four
matched candidate seeds per voice at default/maximum controls. They use the
existing `wmd_stats.py` scorer through `score_native_ensemble.py`, retaining
actual output gain and execution-time provenance. A ratio above the reference
split demonstrates a systematic change; it is not an audibility threshold.

| Native ensemble | Reference split loss | Band-pass loss | Ratio | Level delta, dB |
| --- | ---: | ---: | ---: | ---: |
| CH default | 1.032748 | 2.440545 | 2.363 | -0.317 |
| CH maximum | 0.911615 | 3.054099 | 3.350 | -0.672 |
| OH default | 1.044081 | 2.624045 | 2.513 | -0.457 |
| OH maximum | 0.964063 | 3.352896 | 3.478 | -0.982 |
| CY default | 1.078508 | 2.522632 | 2.339 | -0.239 |
| CY maximum | 1.020774 | 3.271679 | 3.205 | -0.399 |

Body-envelope errors range from 0.536 to 1.507 dB. The 24 candidate streams
are compared with 48 saved native reference/split streams. Triggers, sample
counts and RNG consumption stay matched; this is evidence of a systematic spectral
tradeoff, not of a seed mismatch or listening acceptance.

All **147 primary/ending/seed numerical renders** pass against the independent
C++ model. Worst pretrim errors are CH 0.00037375, OH 0.00113164 and CY
0.00185052, below the existing 0.003 limit. This numerical check establishes
agreement with the changed model; the perceptual comparisons above measure
its deviation from the prior sound.

Interleaving 11 tracks over 512 blocks, 22 dirty-state reassignments and
tail-control changes pass with shared scratch poisoned. Standalone package
reproduction, independent relocation and the draft-export rejection pass.
With the option off, 294 retained generated sources and 123 C++ cascade
reference streams remain byte-exact. Four ordered replays reproduce ordinary
audio, every call-cycle count and final dumps.

Eleven extra numerical cases cover four/sixteen-sample endpoints, per-sample
gate, linear saturation, wide DC feedback, xorshift, half-rate compatibility,
tracks 0/15, an explicit maximum seed and unbounded/unfused tanh processing.
Six unaligned-scratch replays preserve audio, cycles and final dumps at
X:`$203` / Y:`$243`. The 13 local comparison, profiler and table tests pass.
Repository checks pass with 205 Node tests, 56 Python tests and the site build;
11 firmware-dependent Node tests remain skipped without supplied OS images.

## CPU and storage

| Full-rate band-pass candidate | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Raw maximum, clocks/block | 4,303 | 4,299 | 4,299 |
| Raw clocks/sample | 134.46875 | 134.34375 | 134.34375 |
| Sampled cold model, clocks/block | 6,179 | 6,172 | 6,172 |
| Sampled cold model, clocks/sample | 193.09375 | 192.875 | 192.875 |
| Program words | 2,527 | 2,654 | 2,654 |
| Package bytes | 8,352 | 8,748 | 8,748 |

CH falls from 4,910 to 4,303 raw clocks/block, saving 18.96875/sample. Its
sampled model falls from 7,023 to 6,179 clocks: 4,303 raw + 799 modeled
interlocks + 359 instruction-word misses times three. That saves another
26.375 modeled clocks/sample. Each metal voice saves 435 program words and
1,372 package bytes.

The explicitly traced one-sample CH tail is 519 raw / 1,616 modeled clocks,
down from 568 / 1,778. With this experiment, the seven-voice family would use
23,678 words / 76,968 bytes; CP brings it to 36,539 / 117,552. Both still exceed
the published library-byte field. The working cascade candidate's resource
totals remain those in [RESIDENT-OUTPUT.md](RESIDENT-OUTPUT.md).

Under 129 remains unmet even in raw instruction-host timing. The cold model
uses uncalibrated fetch waits and additive penalties, excludes data waits,
dispatch and DMA, and is not a hardware worst-case bound. Packages remain
zero-cycle drafts, with installable SysEx blocked by the upstream export gate.

## Reproduce

Install the optional fitter dependencies; the recorded run uses NumPy 2.3.5
and SciPy 1.17.0. From `mds/tr6`, use the flags in
[REGISTER-MIXER.md](REGISTER-MIXER.md) and add the three options below:

```powershell
python tools/render_metal.py ch @flags --register-mix --resident-output --bandpass-noise --out build/bandpass-ch --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py build/resident-output-ch build/bandpass-ch --allow-model-change
python tools/score_variants.py build/resident-output-ch build/bandpass-ch --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-bandpass-v1/ch
```

Repeat for OH/CY and `--end-boundaries`. Comparison reports create local A/B
pages for listening. Add `--seed` for matched native seed renders and use
`score_native_ensemble.py` as described in [HALF-RATE-METAL.md](HALF-RATE-METAL.md).
Use fresh scoring directories. Add `--metal-bandpass-noise` to the resident
output state-check command for interleaving/reassignment checks. Original
cascade controls, fitted controls and coefficients, solver versions/objective,
source/tool hashes, native audio, draft packages and traces remain in ignored
build directories.
