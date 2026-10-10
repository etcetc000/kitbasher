# Kick activity specialization

This default-off `--bounded-activity` option specializes the shared-filter
kick from [BD-ARITHMETIC.md](BD-ARITHMETIC.md). It requires `--lean-mix` and
works with either saturation choice. The synthesis equations, control mapping,
noise sequence and voice lifetime are unchanged.

The previous implementation checks activity and lifetime every sample. The
new dispatch proves a whole block remains active when the final interpolated
body envelope is positive. Its step rounds toward zero, so this final value
is the block minimum. That path clears the silence counter once and omits
redundant per-sample lifetime checks.

When both envelopes begin at zero, both interpolated steps are also zero.
A separate tail loop keeps RNG and recursive oscillator updates but omits their
zero products, gain and envelope work. The shared low-pass, DC filter, heat,
output and exact lifetime decisions still run. The original loop handles
remaining cases, including envelopes reaching zero within a block. Persistent
body/click scratch values remain zero, matching the original loop.

An initial positive-envelope-only experiment was bit-exact but made the sampled
worst tail slightly slower. It remains diagnostic evidence; the final option
includes the zero-envelope specialization.

## CPU and storage

| Saturation | Previous modeled cold clocks/sample | Current modeled cold clocks/sample | Maximum raw clocks/block | Program words | Package bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quadratic | 240.5625 | 199.84375 | 4,826 | 2,136 | 7,068 |
| Tanh table | 275.6875 | 234.96875 | 5,786 | 2,429 | 7,984 |

Both save 40.71875 modeled clocks/sample. The largest modeled cold blocks
are 6,395 and 7,519 clocks respectively; these occur during the body rather
than at the raw maximum in the final tail block. Twelve ordered replays cover
minimum/maximum fixtures and corners 8, 14, 18 and 30, with saved historical
maximum blocks 179, 6,813, 7,365, 11,244 and 12,709. Ordinary/tracer audio,
cycles and final dumps agree.

The model remains uncalibrated and additive: raw instruction-host clocks plus
interlocks and cold program-word fetch sensitivity. It excludes data waits,
dispatch, DMA and penalty overlap. Neither candidate reaches 129, and the
separate 3,951-clock firmware admission limit remains unmet. No hardware
timing or listening qualification is claimed.

The specialized quadratic kick adds 267 program words and 832 package bytes;
the table version adds 291 words and 908 bytes. With current metals and compact
toms, family totals are 23,122 / 75,232 (words/bytes) for quadratic or
23,415 / 76,148 for table saturation. Including CP gives 35,983 / 115,816 or
36,276 / 116,732. The library-byte field still does not fit; actual device
capacity has not been queried. Packages retain zero admitted cycles and the
exporter rejects installable SysEx.

## Verification

`check_bd_activity.py` compares 1,944 synthetic envelope/tail boundary fixtures
per saturation choice. Each runs three blocks and compares all output and
persistent/guard dumps after every block. Fixtures include envelope values
0, 1, 31, 32, 33 and 64, silence counters 0/30/31, both signs of filter history,
HEAT 0/127, and original/zero/nearly-unity envelope coefficients. These cover
sub-step plateaus, exact zero endpoints, mixed body/click activity and
mid-block shutdown.

Ninety-four native audio/state pairs remain bit-exact: ten primary cases,
four heat/idle-retrigger cases, 64 full-tail control corners and sixteen seeded
default/maximum renders. This includes all nine previously failing numerical
fixtures in those groups; their strict failures remain explicit. All 390 valid
preceding generator configurations checked remain unchanged with the flag off.
The C++ model is unchanged, and invalid option combinations reject.

Both choices pass 11-track isolation, 22 dirty-state reassignments, poisoned
shared-scratch checks, independent unaligned relocation and byte-exact
standalone package reproduction. A deliberately wrong guard that admits a
zero final envelope is rejected by the boundary probe: both audio and state
comparisons fail. Rejected binaries remain isolated diagnostic fixtures.

Repository checks pass: 205 Node tests, 56 Python tests and the site build;
11 firmware-image-dependent Node tests remain skipped. All 13 local TR6 tests
pass.

The float comparison and perceptual acceptance status are inherited from the
preceding candidates. Bit-exact optimization does not repair their existing
numerical differences or make the quadratic curve sonically acceptable.

## Reproduce

From `mds/tr6`, use fresh output directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --quadratic-saturation --bounded-activity --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-activity-quadratic
python tools/compare_variants.py build/bd-math-qualified-lean build/bd-activity-quadratic --require-bitexact
python tools/check_bd_activity.py --baseline build/bd-math-qualified-lean --candidate build/bd-activity-quadratic --host $env:MD_DSP_HOST --out build/bd-activity-boundaries
```

For table saturation, replace `--quadratic-saturation` with `--sequential-tanh`
and compare against `build/bd-math-tanh-primary`. State checks accept the
corresponding `--bd-bounded-activity` flag. Native evidence, boundary probes,
traces and rejected pilots remain in ignored `build/bd-bounded-*` directories.
