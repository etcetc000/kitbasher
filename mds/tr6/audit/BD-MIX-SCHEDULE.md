# Exact kick mixer scheduling

`--scheduled-mix` is a default-off scheduling option for the shared-filter
kick. It requires `--lean-mix` and either quadratic or sequential-table
saturation. It changes neither synthesis equations nor the independent C++
model. With `--bounded-activity`, it also reduces three sample loops to two.

## Changes

The click envelope write shares its multiplication instruction, with the noise
operand transfer placed between the envelope add and its consumer. The body
amplitude update uses the other accumulator while the body product stays live,
preserving the original truncation before adding the click. The DC-input write
shares the subtraction instruction; the previous output loads directly into
its multiplier operand. The original fractional DC remainder is retained.

The invariant DC pole uses spare N0. The quadratic variant additionally caches
the body gain in R0 and the body low-pass coefficient in X1. Sequential tanh
still owns R0/X1 when it needs them. Constants reload after control/coefficient
setup on every active render, and no persistent state layout changes.

The activity dispatch uses a stronger bound than [BD-ACTIVITY.md](BD-ACTIVITY.md).
For an envelope starting at `v > 0`, its step is
`d = ceil((next - v)/32)`, with `0 <= next <= v`. If `d < 0`, the interpolated
value cannot reach zero before sample 32; when `d == 0` it stays positive.
Thus any initially positive body/click envelope clears the silence counter
through sample 31. A single lifetime check after sample 32 sets the counter to
zero or one, and the voice cannot become inactive in that block. Blocks
starting with both envelopes zero use the existing exact tail loop, including
its per-sample shutdown decisions. The old fallback loop is unnecessary.

The original `--bounded-activity` generator output remains available unchanged
when the new scheduling flag is off. The scheduling option also works without
activity specialization, retaining the original sample loop.

## CPU and storage

| Saturation | Previous cold model, clocks/sample | Current cold model, clocks/sample | Maximum raw clocks/block | Program words | Package bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quadratic | 199.84375 | 186.28125 | 4,575 | 1,978 | 6,576 |
| Tanh table | 234.96875 | 224.03125 | 5,625 | 2,260 | 7,456 |

The savings are 13.5625 and 10.9375 modeled clocks/sample, plus 158/169 program
words and 492/528 package bytes. The largest sampled cold blocks are 5,961 and
7,169 clocks, both in the final active tail block at index 7,365. Twelve ordered
replays cover minimum/maximum and control corners 8, 14, 18 and 30, including
saved historical maximum blocks 179, 6,813, 7,365, 11,244 and 12,709.
Ordinary/tracer audio, cycles and final dumps agree.

These remain uncalibrated additive instruction-host/interlock/fetch models,
excluding data waits, dispatch, DMA and overlap. Both candidates remain above
129 clocks/sample and the separate 3,951-clock admission requirement. No
hardware qualification or new listening acceptance is claimed.

With current metals and compact toms, the seven-voice family uses 22,964 program
words / 74,740 package bytes with quadratic BD, or 23,246 / 75,620 with tanh.
Including CP gives 35,825 / 115,324 or 36,107 / 116,204. The library-byte field
still does not fit, and actual device capacity has not been queried. Packages
retain zero admitted cycles; the exporter rejects installable SysEx.

## Verification

Ninety-four primary, changing-heat/idle-retrigger, full-tail corner and native
seed audio/state pairs remain bit-exact. Each saturation choice also passes
all 1,944 envelope/tail boundary fixtures, with audio and persistent/guard
state compared after each of three blocks. The nine pre-existing numerical
failures in the render sweep remain failures at the unchanged limits.

All 408 preceding valid generator configurations checked remain unchanged with
the scheduling flag off. The C++ model is unchanged. The perceptual scores and
seed-ensemble results in [BD-ARITHMETIC.md](BD-ARITHMETIC.md) still describe
these identical waveforms; neither the existing numerical gaps nor the
quadratic curve's substantial spectral change is resolved by this scheduling.

Ten further primary pairs without activity specialization and five additional
tanh-table sizes remain bit-exact, bringing the render-pair total to 109.
Both saturation choices pass 11-track isolation, 22 dirty-state reassignments,
poisoned shared scratch, independent unaligned relocation, draft export checks
and byte-exact standalone package reproduction. A deliberately omitted
final-sample silence count is rejected by the boundary probe, with both audio
and state differences. Rejected binaries remain isolated diagnostic fixtures.

Repository checks pass: 205 Node tests, 56 Python tests and the site build;
11 firmware-image-dependent Node tests remain skipped. All 13 local TR6 tests
pass.

## Reproduce

From `mds/tr6`, with fresh output directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --quadratic-saturation --bounded-activity --scheduled-mix --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-scheduled-quadratic
python tools/compare_variants.py build/bd-bounded-final-quadratic build/bd-scheduled-quadratic --require-bitexact
python tools/check_bd_activity.py --baseline build/bd-bounded-final-quadratic --candidate build/bd-scheduled-quadratic --host $env:MD_DSP_HOST --out build/bd-scheduled-boundaries
```

For tanh, replace `--quadratic-saturation` with `--sequential-tanh` and use the
tanh baseline. `check_state.py` accepts the corresponding `--bd-scheduled-mix`
option. Evidence and rejected pilots stay in ignored `build/bd-scheduled-*`.
