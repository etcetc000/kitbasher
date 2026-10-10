# Kick output-stage experiments

The default-off `--rounded-dc` and `--linear-base` options build on
[BD-MIX-SCHEDULE.md](BD-MIX-SCHEDULE.md). Both require its scheduled shared
mixer. Full reference paths and all earlier candidates remain available.
These are additional CPU/fidelity choices, not accepted replacements.

## Algorithms and lifetime

Rounded feedback replaces the DC pole's multiply plus carried fractional
remainder with `MPYR`. The pole remains 0.995. This removes the remainder
load/add/store, but rounded feedback can retain about 100 Q21 units at zero
input. After the 0.70 voice trim, that is approximately 33.4e-6 FS. The original
10e-6 lifetime threshold could leave such a voice active indefinitely.

The rounded option therefore uses a **64e-6 pre-HEAT silence threshold** in both
native lifetime checks and the independent float adapter. The 32-consecutive-
sample rule is unchanged. At maximum HEAT, the corresponding small-signal
output threshold can be about 136e-6 FS. This changes quiet tails and noise
advancement before subsequent triggers. The float model retains its original
real-valued DC filter; it does not copy the native quantization.

Linear base bypasses the first saturation curve and retains the external HEAT
stage, either quadratic or tanh. This is a larger sound change: body peaks rise
and harmonics change. `--linear-base-gain` is an explicit compile-time gain in
(0,1], folded into the existing drive multiplication. Its default is unity;
no per-file normalization or alignment is used when scoring.

## CPU and perceptual results

| Candidate | Sampled cold model, clocks/sample | Program words | Package bytes |
| --- | ---: | ---: | ---: |
| Rounded DC, quadratic base/heat | 178.90625 | 1,970 | 6,552 |
| Rounded DC, linear base/quadratic heat | 171.4375 | 1,960 | 6,520 |
| Rounded DC, linear base/tanh heat | 186.25000 | 2,222 | 7,340 |

The preceding scheduled quadratic and tanh candidates modeled at 186.28125
and 224.03125 respectively. These figures remain uncalibrated additive
instruction-host/interlock/fetch models, excluding data waits, dispatch, DMA
and overlap. None reaches 129 or establishes the separate 3,951-clock
admission requirement. Hardware and listening qualification remain open.

Rounded DC alone has worst incremental primary mel-proxy loss 0.011449 and
maximum envelope error about 0.000025 FS versus the preceding quadratic
candidate. The largest frame discrepancy, 3.446 dB, is in its quiet tail.
Its cumulative full-reference loss remains about 1.210071; rounding does not
remove the earlier quadratic curve's spectral difference.

The unity linear/quadratic candidate's worst primary cumulative loss is
1.540220. Its default peak rises from about 0.534 in the preceding quadratic
candidate to 0.701, and active-retrigger peak reaches about 0.709. Its maximum
full-reference envelope error is about 0.158 FS. There are no categorical
flags in these five primary comparisons, but that does not establish sonic
acceptance.

Reducing linear gain makes peaks closer without necessarily making spectra
closer. The native primary gain pilots produced:

| Linear gain | Default peak FS | Worst full-reference primary loss |
| --- | ---: | ---: |
| 1.000 | 0.700894 | 1.540220 |
| 0.875 | 0.613283 | 1.807479 |
| 0.850 | 0.595758 | 1.977947 |
| 0.800 | 0.560717 | 2.362995 |

Those reduced-gain pilots are not promoted as improvements. This is a direct
example of why peak/RMS matching alone cannot choose the optimization.

Native ensembles compare four original xorshift reference seeds, four disjoint
reference-split seeds and four matching candidate seeds at actual output gain.
Each render is 65,536 samples at 44,100 Hz. Maximum and the added corner remain
active at that duration; complete tails are covered separately by the control
grid. The corner is TRAN/DEC/TUNE 127, HEAT 0, XL 1, selected because the linear
stage's full-tail spectral difference is largest there.

| Fixture / candidate | Reference split loss | Candidate loss | Loss / split | Level delta dB | Body-envelope error dB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default / rounded quadratic | 0.025101 | 0.701916 | 27.963670 | -0.365150 | 0.458115 |
| Maximum / rounded quadratic | 0.006678 | 1.342388 | 201.013657 | -0.179505 | 0.705485 |
| Corner / rounded quadratic | 0.010459 | 1.140185 | 109.013814 | -0.353141 | 0.458778 |
| Default / linear, quadratic HEAT | 0.025101 | 1.132701 | 45.125764 | 1.082510 | 1.797268 |
| Maximum / linear, quadratic HEAT | 0.006678 | 1.391861 | 208.421993 | 0.195995 | 0.460099 |
| Corner / linear, quadratic HEAT | 0.010459 | 2.724248 | 260.467152 | 1.163508 | 2.124333 |
| Default / linear, tanh HEAT | 0.025101 | 1.132701 | 45.125764 | 1.082510 | 1.797268 |
| Maximum / linear, tanh HEAT | 0.006678 | 0.268696 | 40.235453 | 0.189426 | 0.245447 |
| Corner / linear, tanh HEAT | 0.010459 | 2.724248 | 260.467152 | 1.163508 | 2.124333 |

These are cumulative comparisons against the full original signal path.
The ratios are not audibility thresholds; small reference-split losses make
some ratios large. The linear stage's extra level and spectral differences
remain substantial. The earlier two-tanh candidate is still available for its
lower drift, at higher CPU cost.

## Validation and remaining gaps

All 15 final primary and three changing-heat numerical comparisons pass.
The 96 full-tail control corners pass 30/32 for rounded quadratic and 28/32
for each linear candidate. Ten high-heat non-XL corners fail the unchanged
0.0002 limit, and all three idle-retrigger comparisons still fail. These 13
failures retain failing exit status/provenance and are excluded from qualified
ensembles. All structural/end-activity checks pass. The largest observed
native/reference peak in this grid is about 0.805 FS; this is not an exhaustive
headroom proof.

The largest incremental corner mel losses are 0.021884 (rounded quadratic),
2.628437 (linear/quadratic HEAT) and 1.938001 (linear/tanh HEAT), without
categorical flags. Twenty-one ordered replays include saved historical maxima,
ending calls, earlier edge vectors and the new worst-loss corners. Ordinary
and tracing hosts agree on audio, cycles and final dumps; the added corners do
not raise the reported cold model. Thirty-six new candidate ensemble renders
and eight new reference/split renders pass their numerical checks.

All 432 preceding assembly configurations checked and 95 saved C++ streams
remain unchanged with the new flags off; pinned headers are unchanged. Invalid
options reject. Three additional default renders without bounded activity are
bit-exact against the corresponding final candidates.

Each candidate passes 11-track isolation, 22 dirty-state reassignments, poisoned
shared scratch, independent unaligned relocation, draft export checks and
byte-exact standalone package reproduction. The new output-tail probe exercises
60 positive/negative feedback-floor, silence-counter and HEAT combinations per
candidate. All release and finish with zero output. Deliberately restoring the
old threshold leaves 48/60 probe voices active and is rejected.

Seven-voice family totals are 22,956 program words / 74,716 package bytes for
rounded quadratic; 22,946 / 74,684 for linear/quadratic HEAT; and 23,208 / 75,504
for linear/tanh HEAT. With CP these become 35,817 / 115,300, 35,807 / 115,268 and
36,069 / 116,088. Library-byte capacity remains exceeded; actual device capacity
has not been queried. All packages retain zero admitted cycles and installable
SysEx remains blocked.

Repository checks pass: 205 Node tests, 56 Python tests and the site build;
11 firmware-image-dependent Node tests remain skipped. All 13 local TR6 tests
pass.

## Reproduce

From `mds/tr6`, with fresh output/scoring directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --quadratic-saturation --bounded-activity --scheduled-mix --rounded-dc --linear-base --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-output-linear
python tools/score_variants.py build/bd-fixed-full build/bd-output-linear --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/bd-output-full-scores
python tools/check_bd_output_tail.py --render build/bd-output-linear --host $env:MD_DSP_HOST --out build/bd-output-tail-probe
```

Omit `--linear-base` for rounded DC alone; replace `--quadratic-saturation`
with `--sequential-tanh` to retain tanh HEAT. State checks accept the equivalent
`--bd-` options. Audio, traces, hashes, score reports, rejected gain pilots and
draft packages remain in ignored `build/bd-output-*`, `perceptual-bd-output-*`
and `cumulative-bd-output-*` directories.
