# Kick arithmetic, recursive body and shared filter

This batch provides two CPU/fidelity alternatives after
[BD-TANH-SCHEDULE.md](BD-TANH-SCHEDULE.md). All changes are default-off. The
full source paths and previous candidates remain available. Neither alternative
meets the under-129 target, has listening acceptance, or is hardware-qualified.

## Changes

`--quadratic-saturation` replaces both tanh stages with
`F(x) = x * (1 - abs(x)/4)`, with input limited to [-2, 2]. In Q21 the core
is one multiplication and subtraction. The heat stage explicitly clamps its
input. The base stage can omit those clamps only because the impulse layer is
absent: the worst control-dependent bound is below 1.49 before saturation
(`1.1416 * (1.0792 * .938 + 2 * .244 * .6)`). The flag therefore requires
`--omit-impulse` and excludes `--sequential-tanh`. Table precision does not
affect this table-free curve. This is the largest sonic change in the batch.

`--recursive-body` replaces sample-rate frequency/phase accumulation and sine
reads with a magic-circle oscillator. Its two states use Q22 for headroom;
each sample updates `x -= k*y`, then `y += k*x`. Once per 32 samples, the
coefficient is computed as `2*sin(pi*mean_frequency/Fs)` using interpolated
shared sine data. The mean includes the source's frequency increment before
each sample. A half-coefficient-change correction adjusts the first state
when pitch changes. This retains a pitch sweep but holds its instantaneous
frequency constant within each block. It requires 32-sample control endpoints,
resident state and omitted impulse. The unused impulse fields hold oscillator
state; local X usage stays at 43 words.

Rounding the coefficient to Q23 removes a systematic truncation bias. The
initial truncating experiment failed the changing-heat numerical bound at
0.000272; the rounded quadratic candidate passes at 0.000170. Parallel moves
in the oscillator preserve the initial scheduled pilot's native audio/state
exactly. The independent float model uses the same algorithm with `sin()`;
it does not copy the native coefficient table or fixed-point arithmetic.

`--lean-mix` bypasses the noise DC filter and puts raw LCG click noise and the
body through one shared body low-pass. It removes the separate click low-pass.
The freed registers hold the RNG and click gain. It requires the recursive
body and LCG noise, and works with either saturation choice. The C++ comparison
uses source oscillator/envelope/filter objects with the changed routing.
Pinned source headers remain unchanged.

## CPU and storage

The table alternative retains the sequential interpolated tanh lookup. The
arithmetic alternative uses all three new options.

| Candidate | Raw maximum clocks/block | Modeled cold clocks/block | Modeled clocks/sample | Program words | Package bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous sequential-tanh candidate | 8,225 | 10,470 | 327.1875 | 2,131 | 7,052 |
| Add quadratic saturation | 7,265 | 9,346 | 292.0625 | 1,862 | 6,212 |
| Add recursive body | 6,730 | 8,680 | 271.2500 | 1,887 | 6,292 |
| Add shared filter, quadratic saturation | 5,930 | 7,698 | 240.5625 | 1,869 | 6,236 |
| Recursive body/shared filter, table saturation | 6,890 | 8,822 | 275.6875 | 2,138 | 7,076 |

These are sampled instruction-host results with additive interlock/fetch
penalties, not measured hardware cold-cache bounds. Data waits, dispatch,
DMA and penalty overlap remain unqualified. Saved blocks 179, 6,813, 7,365,
11,244 and 12,709 are replayed alongside onset/ending calls. Four additional
corner replays per final alternative cover the short-render boundary setting,
both previously failed numerical corners and the largest spectral-loss corner.
Ordinary/tracer audio, call cycles and final dumps agree.

The arithmetic alternative's seven-voice family occupies 22,855 program words /
74,400 package bytes, or 35,716 / 114,984 with CP. The table alternative uses
23,124 / 75,240, or 35,985 / 115,824 with CP. The library-byte capacity
field still does not fit. Packages remain zero-cycle drafts and installable
SysEx stays blocked; actual device capacity has not been queried.

## Perceptual evidence

All scores below use matched native renders at their actual output gain. The
lab's `mel-proxy-v1` is an uncalibrated spectral proxy, not an audibility verdict.
Primary fixtures are default, minimum, maximum/XL, active retrigger and delayed
trigger. There are no categorical flags in these comparisons.

| Change / reference | Worst primary loss |
| --- | ---: |
| Quadratic saturation vs preceding table candidate | 1.074219 |
| Recursive body vs quadratic candidate | 0.007761 |
| Shared filter vs recursive quadratic candidate | 0.106961 |
| Recursive/shared-filter table alternative vs preceding table candidate | 0.108946 |
| Complete arithmetic alternative vs full corrected native reference | 1.210611 |
| Complete table alternative vs full corrected native reference | 0.299074 |

The arithmetic curve changes the body spectrum substantially. Its cumulative
primary envelope error reaches 0.022233 FS. The table alternative reaches
0.007988 FS against the full reference. Both retain the earlier onset and
quiet-tail differences; the largest full-reference spectral-frame discrepancy
is about 12.38 dB in a quiet tail. Listening review remains necessary.

Native ensembles compare four original xorshift reference seeds, four disjoint
reference-split seeds and four matching candidate seeds. Default and maximum
use 65,536 samples; maximum is still active at that duration. The corner uses
TRAN 127, DEC/TUNE 0, HEAT 127, XL 0 at the same duration. These are cumulative
comparisons against the full original signal path, including earlier LCG,
control-rate and impulse changes.

| Fixture / saturation | Split loss | Candidate loss | Loss / split | Level delta dB | Body-envelope error dB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default / table | 0.025101 | 0.058522 | 2.331460 | -0.000877 | 0.004686 |
| Default / quadratic | 0.025101 | 0.702682 | 27.994190 | -0.365146 | 0.458066 |
| Maximum / table | 0.006678 | 0.013588 | 2.034684 | -0.000381 | 0.008997 |
| Maximum / quadratic | 0.006678 | 1.342381 | 201.012668 | -0.179504 | 0.705450 |
| Corner / table | 0.749305 | 1.313839 | 1.753410 | -0.009901 | 0.018040 |
| Corner / quadratic | 0.749305 | 1.714257 | 2.287797 | -0.352400 | 0.735113 |

The small reference-split loss in maximum makes its ratio especially large;
the absolute spectral and envelope differences must also be considered. The
table path is the lower-drift alternative. The faster arithmetic curve remains
an explicit tradeoff, not an accepted replacement for the original sound.

## Numerical scope and gaps

The three arithmetic stages each pass all five primary numerical fixtures and
the non-aliasing, three-block step-37 heat pattern. The complete arithmetic
candidate's primary maximum error is 0.001196 in XL (limit 0.005), and changing
heat peaks at 0.000171 (limit 0.0002). The table alternative passes its five
primary fixtures but fails changing heat at 0.000219. Limits are unchanged.

Both alternatives have all 32 binary control corners rendered through their
complete tails: 131,072 samples normally and 524,288 in XL. All structural and
end-activity checks pass. Numerical passage is 30/32 for quadratic and 28/32 for
table saturation. The failing non-XL controls are:

| TRAN, DEC, TUNE, HEAT, XL | Quadratic peak error | Table peak error |
| --- | ---: | ---: |
| 0, 127, 0, 127, 0 | pass | 0.000281 |
| 0, 127, 127, 127, 0 | 0.000345 | 0.000385 |
| 127, 127, 0, 127, 0 | pass | 0.000290 |
| 127, 127, 127, 127, 0 | 0.000358 | 0.000400 |

Idle retrigger also remains a strict numerical failure: fixed-point and float
tails consume different numbers of noise samples before the second hit.
Completed diagnostic runs retain failing exit status and explicit provenance;
they are excluded from seed-ensemble qualification. Low spectral loss does not
override these failures or establish exhaustive control-space correctness.

All 288 preceding assembly configurations checked remain unchanged with the
new flags off. Ninety-three saved C++ streams, including the intermediate
arithmetic models, are byte-exact after the test-only adapters. Five additional
option combinations and three seed edges pass numerical checks. Invalid option
combinations reject instead of silently falling back.

Each final alternative passes 11-track state isolation and 22 dirty-state
reassignments, with shared scratch poisoned. Standalone packages reproduce
byte-for-byte and pass independent relocation and draft export checks. Sixteen
ordered replays cover primary and selected corner fixtures. Thirty-two new
native ensemble renders pass numerical checks; default/maximum reference and
split renders reuse the earlier pinned evidence.

Repository checks pass: 205 Node tests, 56 Python tests and the site build;
11 firmware-image-dependent Node tests remain skipped. All 13 local TR6 tests
pass. These checks complement the native renders, not replace them.

## Reproduce

From `mds/tr6`, with fresh output and scoring directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --quadratic-saturation --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-math-arithmetic
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --sequential-tanh --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-math-table
python tools/score_variants.py build/bd-fixed-full build/bd-math-table --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-bd-math-table-full
```

Add `--case heat_modulation`, `--case retrigger_idle` or `--knobs TRAN DEC TUNE
HEAT XL` for extended fixtures. Use the corresponding `--bd-` options in
`check_state.py`. Reports, hashes, native/float audio, listening pairs, traces
and draft packages are retained under ignored `build/bd-math-*`,
`perceptual-bd-math-*` and `cumulative-bd-math-*`. Rejected coefficient pilots
remain diagnostic evidence only.
