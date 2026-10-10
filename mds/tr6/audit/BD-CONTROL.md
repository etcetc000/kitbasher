# Kick control-rate and impulse experiments

These default-off candidates continue the CPU work in [BD-OPTIMIZATION.md](BD-OPTIMIZATION.md).
The full reference paths remain available. Perceptual drift is allowed, but the
under-129 cold-cache target, firmware admission and complete family delivery
remain requirements. The numerical comparisons below check implementation;
the existing lab scorer and native seed ensembles evaluate the sound change.
Neither is a listening or hardware qualification.

## Changes

`--control-rate 16` or `32` requires `--resident-state`. It computes exponential
envelope and pitch endpoints once per interval, interpolates integer steps and
snaps to each endpoint. Four endpoint words extend local X state from 39 to 43.
The original remainder slots hold interpolation steps in this mode. Endpoint
multiplication truncates: rounding pinned very quiet envelopes above their
cutoffs in an initial experiment. Envelope steps round upward to avoid crossing
below zero before the snap. The sine lookup rounds to the nearest table index
in control-rate mode; the original full-rate lookup is unchanged.

`--simple-impulse` replaces the differentiated-body layer's high-pass biquad
with a one-pole high-pass, retaining its low-pass, envelope and gain.
`--omit-impulse` removes that layer, its envelope work and three coefficient
tables; spare registers then hold other hot state. The flags are mutually
exclusive. Body, click, transient, decay, tune and heat controls remain.
The independent C++ model keeps the source filters and uses floating-point
control interpolation; it substitutes a one-pole transfer function or zero
impulse transfer for those respective experiments.

Omitting the impulse's activity check does not determine voice lifetime for
valid trigger settings: among the assembled 32-sample endpoint tables, the
shortest body lifetime is 5,728 samples and the longest impulse lifetime is
3,136, including a previous trigger's maximum impulse level. Fixed-point
versus floating-point body-tail timing still differs, as described below.

## Primary evidence

All three 32-sample variants pass the five primary fixtures: default, minimum,
maximum/XL, active retrigger and delayed trigger. Their largest native/C++ peak
error is 0.000584 in XL, below the existing 0.005 XL limit. The three-block,
step-37 heat pattern passes with peak error 0.000171 against the unchanged
0.0002 non-XL limit. Rounding the sine index removed the earlier 0.000239 heat
failure; rounding pitch steps instead did not resolve it.

Against the preceding resident/LCG, sample-rate kick, primary `mel-proxy-v1`
worst losses are 0.130216 with the full impulse, 0.132819 with the one-pole
impulse and 0.147405 with impulse omitted. Relative to the new control-rate
full-impulse candidate alone, simplifying/omitting the impulse adds worst
losses of 0.030609 / 0.136522. No primary categorical flags appear.

The metrics do show real differences: the omitted-impulse maximum fixture
changes the first sample by 0.171025 FS. The largest spectral-frame difference
is 12.2195 dB at about 5.341 seconds, where the earlier reference tail is around
-79.5 dBFS and the candidate is nearly silent. Primary maximum envelope error
is 0.002393 FS. These onset and quiet-tail changes require listening review;
a small whole-render loss does not establish inaudibility.

Native ensembles use four reference seeds, four disjoint reference-split
seeds and four matching candidate seeds, with 65,536 samples per render.
The references are the corrected original xorshift model from the previous
audit, so this measures the combined LCG, control-rate and omitted-impulse
change. Maximum/XL remains active at this duration.

| Fixture | Split loss | Candidate loss | Loss / split | Level delta dB | Body-envelope error dB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default | 0.025101 | 0.042273 | 1.684101 | -0.000569 | 0.004159 |
| Maximum | 0.006678 | 0.010105 | 1.513109 | -0.000321 | 0.011671 |

The known idle-retrigger numerical gap remains. Peak errors are 0.015146,
0.015232 and 0.015169 for full, simple and omitted impulse respectively, above
the unchanged 0.0002 limit. Different body-tail lifetimes advance the persistent
noise generators by different amounts before the second hit. Those diagnostic
pairs are explicitly failed and excluded from ensemble qualification. Native
perceptual losses versus the previous LCG model are 0.078450 / 0.087530 /
0.139604, without categorical flags; that does not override numerical failure.

The complete binary corner grid covers all 32 combinations of TRAN/DEC/TUNE/
HEAT at 0 or 127 and XL at 0 or 1, for both the previous LCG model and the
omitted-impulse candidate. Normal renders contain 131,072 samples and XL
renders 524,288, including the complete tails. All structural/end-activity
checks pass. The fixed numerical bound fails in these non-XL corners:

| TRAN, DEC, TUNE, HEAT, XL | Previous LCG peak error | Candidate peak error |
| --- | ---: | ---: |
| 0, 127, 127, 127, 0 | 0.000212 (fail) | 0.000303 (fail) |
| 127, 0, 127, 127, 0 | 0.000217 (fail) | pass |
| 127, 127, 127, 127, 0 | 0.000259 (fail) | 0.000307 (fail) |

Thus numerical passage is 29/32 for the preceding model and 30/32 for the new
candidate, not complete control-space qualification. Candidate maximum XL
error is 0.000901. The 32 native perceptual comparisons have no categorical
flags; worst loss is 0.482052 at TRAN 127, DEC/TUNE/HEAT 0, with either XL
setting. Its worst frame difference is 2.0561 dB and envelope error 0.001351 FS.
Failed numerical rows remain identified in the scoring provenance.

A separate 4/4/4 native ensemble checks that worst corner against the preceding
LCG model, isolating the new control/impulse change. Split loss is 0.689817 and
candidate loss 0.006374 (ratio 0.009240), with level delta +0.008353 dB and body
envelope error 0.009538 dB. The large reference variation in this short,
click-heavy setting is not an audibility threshold for its changed onset.

A deliberately shortened render at knobs `0 127 0 0 0`, 65,536 samples, ends
with different source/native activity states. The final candidate reproduces
that failure; its provenance remains incomplete and it is not scored as a
qualified pair. Extending the render lets both tails finish but does not fix
their different lifetimes. This remains relevant to idle retriggers.

## Timing

These are sampled instruction-host results with the same uncalibrated additive
interlock/fetch model as the preceding audit, not hardware worst-case bounds.
The maximum fixture replays saved render blocks 179, 6,813, 7,365, 11,244 and
12,709 as well as automatically selected onset, peak and ending calls.

| Resident/LCG variant | Raw clocks/block | Modeled cold clocks/block | Modeled clocks/sample | Program words |
| --- | ---: | ---: | ---: | ---: |
| Previous sample-rate kick | 12,939 | 16,312 | 509.7500 | 2,591 |
| Control 32, full impulse | 11,738 | 15,073 | 471.03125 | 2,630 |
| Control 32, one-pole impulse | 10,586 | 13,488 | 421.5000 | 2,603 |
| Control 32, impulse omitted | 8,865 | 11,402 | 356.3125 | 2,143 |

The omitted-impulse maximum is 8,865 raw + 1,556 modeled interlocks + 327 cold
instruction-word misses at three clocks each. Ordinary and tracer audio,
all call cycles and final dumps agree. Data waits, dispatch, DMA and penalty
overlap remain outside the model. BD is still well above 129 and the separate
3,951-clock admission requirement.

Four additional ordered replays cover the short-render boundary setting, both
candidate numerical-failure corners and the worst perceptual corner. Their
maxima stay within the same 11,402-clock sampled model; all 32 corners have raw
maxima at or below 8,865 clocks. This is sampled coverage, not an exhaustive
proof over controls, placement or firmware scheduling.

## Compatibility and resources

All 120 combinations of the preceding generator's table sizes, register/noise
flags and five seed settings produce unchanged assembly with the new options
off. The checked-in full-reference assembly is unchanged. Twenty-one legacy
C++ streams are byte-exact. Seven option combinations and three seed edges
pass native comparison; these include 16-sample endpoints, full-rate impulse
alternatives, xorshift and LCG. Invalid control intervals, missing resident
state, mutually exclusive impulse flags and invalid custom controls reject.

The latest omitted-impulse kick passes 11-track interleaving, 22 dirty-state
reassignments and the existing poisoned-scratch checks alongside the retained
metal candidates. Full/one-pole control-rate cutoff probes clear all three
below-threshold envelopes and preserve the above-threshold decay. Independent
standalone assembly/relocation reproduces the package and the draft export
gate still rejects installation.

The kick uses 2,143 program words / 7,088 package bytes and 43 local X words.
The seven-voice family now uses 23,129 program words / 75,252 package bytes;
CP brings that to 35,990 / 115,836. The published library-byte field still
does not fit, and actual device capacity has not been queried. These remain
zero-cycle draft packages.

The 13 local TR6 tests and `npm.cmd run check` pass (205 Node tests, 56 Python
tests and the site build; 11 firmware-image-dependent tests remain skipped).

## Reproduce

From `mds/tr6`, use fresh output/scoring directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-control-final-omit
python tools/score_variants.py build/bd-fixed-lcg build/bd-control-final-omit --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-bd-control-final-omit
```

Remove `--omit-impulse` for the complete impulse layer, or substitute
`--simple-impulse`. Add `--case heat_modulation` or `--case retrigger_idle` for
the extended fixtures. `--knobs TRAN DEC TUNE HEAT XL` accepts four 0..127
controls and an XL value of 0 or 1, mutually exclusive with `--case`.
Custom XL fixtures use the same existing XL numerical bound, not a new bound.
`--blocks` may deliberately stop a render before the voice becomes idle.
For state isolation add `--bd-tanh-bits 8 --bd-resident-state --bd-lcg-noise
--bd-control-rate 32 --bd-omit-impulse` to the family `check_state.py` command.

Ignored `build/bd-control-final-*`, `perceptual-bd-control-final-*` and
`incremental-bd-control-final-*` and `bd-control-worst-corner-ensemble` retain audio, independent references, native
provenance, scorer hashes, listening pairs and traces. The earlier eight-sample
control experiment failed the unchanged numerical bound and is not exposed as
a supported setting. Earlier failed pilots remain diagnostic evidence only.
