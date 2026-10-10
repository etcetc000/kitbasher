# Half-rate kick engine

`--render-stride 2` is a default-off kick approximation. It requires bounded
activity and scheduled mixing, which in turn require the resident, recursive,
LCG/shared-filter, 32-output-frame control path. The original full-rate ports
and all previous options remain available.

The internal engine advances 16 times per 32-frame MDS call at 22,050 Hz.
Low-pass coefficients use that rate, the DC pole becomes `0.995^2`, and
envelope/pitch endpoints still span 32 output frames. Click-noise gain is
scaled by `1/sqrt(2)` to preserve continuous-band noise power. Saturation
runs before interpolation. These changes are explicit in the render model.

Each output pair is the integer midpoint of the previous/current engine
samples followed by the current sample. This causal interpolation introduces
one output frame of delay relative to direct sample holding; scoring does
not remove that delay or normalize levels. One new local X word retains
output history across calls and TRIG. INIT clears it. Even an inactive entry
drains that history before writing zeros, and every call writes all 32 frames.

The silence counter advances by two output frames per engine sample. Bounded
activity uses 16-sample endpoint steps, and optional tail elision jumps the
LCG by at most 16 draws (`17 - LC` on a stopping iteration). Its table contains
17 coefficient pairs. The independent C++ renderer uses the same explicit
rate, noise-power, interpolation and lifetime policy with floating arithmetic;
the pinned Simple606 headers remain unchanged.

## Frequency range correction

The initial pilot scaled frequency storage with the lower sample rate. At
maximum tune, that overflowed the signed 24-bit field and produced incorrect
audio. Those `bd-half-pilot-*` renders are rejected evidence.

Frequency now retains the full-rate Q30 scale. Only the sine-table phase
conversion doubles for the 22,050 Hz oscillator. `check_bd_stride.py` tests
all 128 tune values at four transient settings (512 native fixtures), checks
physical trigger frequency and oscillator coefficient independently, and
checks the exact interpolation relation throughout completed renders. This
separates internal rate conversion from storage range.

## CPU, sound and storage

| Shortlisted curve | Sampled cold model, clocks/output sample | Maximum raw clocks/block | Program words | Package bytes | Worst primary cumulative mel loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tanh base and HEAT | 128.8125 | 2,855 | 2,318 | 7,640 | 0.333626 |
| Quadratic base and HEAT | 108.46875 | 2,301 | 2,036 | 6,756 | 1.199474 |

Sixteen ordered replays include minimum/maximum, binary control corners
8/14/18/29/30, the new worst-loss corner 17, saved historical expensive blocks
179/6,813/7,365/11,244/12,709, and ending calls. Ordinary/tracing hosts agree
on audio, cycles and dumps. The maxima are 4,122 modeled clocks/block for
dual tanh (2,855 raw + 379 interlocks + 296 fetched words times three) and
3,471 for quadratic (2,301 + 315 + 285 times three).

Both are below 129 in this sampled model, but dual tanh exceeds the separate
3,951-clock admission budget. Quadratic has model margin under both limits.
These are uncalibrated additive instruction-host/interlock/instruction-fetch
models, excluding data waits, dispatch, DMA and overlap. Hardware timing is
unverified; packages still declare zero admitted cycles and installable SysEx
export remains blocked.

Primary comparisons use the lab's `mel-proxy-v1`, without alignment or level
normalization. Dual tanh's worst incremental loss is 0.167040, with envelope
error up to 0.011448 FS. Against the full reference its worst loss is 0.333626
and envelope error 0.009707 FS. Quadratic's cumulative worst loss is 1.199474
and envelope error 0.021449 FS. Both cumulative reports have a quiet-frame
maximum difference of 12.3772 dB. No primary categorical flags are raised;
these proxy scores do not establish listening acceptance.

The largest incremental corner losses occur at TRANS=127, DEC=0, TUNE=0,
HEAT=0, XL=1: 1.218226 for dual tanh and 1.231666 for quadratic. That case is
included in additional original-reference/split/candidate native ensembles,
alongside default, maximum and the previous long-decay/high-tune/HEAT-off
worst-loss setting (corner 29).

| Native fixture | Reference split loss | Dual-tanh loss / split ratio | Quadratic loss / split ratio |
| --- | ---: | ---: | ---: |
| Default | 0.025101 | 0.082057 / 3.27 | 0.695848 / 27.72 |
| Maximum | 0.006678 | 0.034702 / 5.20 | 1.330526 / 199.24 |
| Corner 29 | 0.010459 | 0.046247 / 4.42 | 1.126747 / 107.73 |
| Corner 17 | 0.715189 | 1.593900 / 2.23 | 1.784777 / 2.50 |

Each ensemble has four original native references, four disjoint reference
seeds, and four candidate seeds. Dual-tanh level changes range from -0.0117
to +0.0198 dB, with body-envelope error up to 0.0665 dB. Quadratic ranges
from -0.4261 to -0.1695 dB, with body-envelope error up to 0.6874 dB. The
reference floor varies substantially with the setting; ratios are not
audibility thresholds. Every included render passes its numerical and
structural checks. Failed fixtures are not inserted into these ensembles.

Linear-base pilots also remain reproducible: quadratic HEAT models at 104.5
and tanh HEAT at 112.90625 clocks/sample. Their five primary renders and
frequency/interpolation probes pass, but they have not received the complete
corner/ensemble/isolation qualification below. Their cumulative primary loss
reaches 1.580120; they do not supersede the shortlisted candidates.

With current metals and compact toms, dual tanh yields a seven-voice family
of 23,304 program words / 75,804 package bytes; including CP gives 36,165 /
116,388. Quadratic yields 23,022 / 74,920, or 35,883 / 115,504 including CP.
The library-byte capacity remains exceeded, and actual device capacity has
not been queried. Local BD state increases from 43 to 44 words.

## Verification and limits

The shortlisted candidates pass all ten primary and two changing-HEAT
comparisons against their independent floating models. Complete-tail binary
corners pass 28/32 for dual tanh and 31/32 for quadratic. Both idle-retrigger
fixtures still fail. These seven candidate failures retain the unchanged
0.0002 non-XL / 0.005 XL bounds and explicit failing provenance. New full-rate
dual-tanh comparison fixtures also retain their own numerical failures.

Each candidate passes 11-track isolation, 22 dirty-state reassignments,
poisoned shared scratch, 60 feedback-floor release cases, independent
unaligned relocation, byte-exact standalone package reproduction and the
draft export gate. The tail-elision probe passes 408 fixtures per half-rate
candidate, including exact RNG counts and all-state equality after retrigger.
An additional 408-fixture full-rate regression still passes.
Default and maximum renders also pass with unrounded DC for both curves.

The 512-setting frequency/interpolation probe passes for both shortlisted
and both linear-base pilot curves. Maximum trigger-frequency error is below
0.000095 Hz and oscillator-coefficient error below 1.7e-7. The original
overflowing pilot is deliberately rejected by the same independent probe.
All native output pairs in the four primary sets satisfy the interpolation
relation, including history across blocks and retriggers.

All 432 preceding generator configurations and 96 output/seed/tail combinations
remain text-identical with stride one. All 116 saved C++ reference streams
checked remain identical; pinned source headers are unchanged. Twenty local
TR6 tests pass, and six invalid generator/layout/CLI combinations reject.
The repository gate passes with native exit code zero: 205 Node tests,
56 Python tests and the site build; 11 firmware-image-dependent tests are skipped.
CPU model margin, proxy loss and passing selected fixtures do
not establish exhaustive control/seed coverage, hardware support or listening
acceptance.

## Reproduce

From `mds/tr6`, using fresh output directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --sequential-tanh --bounded-activity --scheduled-mix --rounded-dc --tail-elision --render-stride 2 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-half-dual
python tools/check_bd_stride.py --render build/bd-half-dual --host $env:MD_DSP_HOST --out build/bd-half-range
python tools/score_variants.py build/bd-fixed-full build/bd-half-dual --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/bd-half-full-scores
```

Replace `--sequential-tanh` with `--quadratic-saturation` for the quadratic
candidate. State-isolation checks accept `--bd-render-stride 2` and equivalent
`--bd-` flags. The native tail-elision probe supports both rates; compare
matching half-rate renders with only tail elision switched off/on. Data,
provenance, traces, audition pairs and draft packages stay under ignored
`build/bd-half-*` directories. No hardware or listening qualification is claimed.
