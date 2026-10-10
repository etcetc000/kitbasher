# Exact kick saturation-table schedule

`--sequential-tanh` preserves the kick's interpolation formula and tables while
reducing address setup. It forms one pointer, computes the interpolation
fraction while that pointer becomes available, then reads the two adjacent
entries with post-increment addressing. M0 is linear under the MDS entry
contract. R0 and N0 are scratch registers; persistent state is unchanged.
The option is off by default and works with the reference and approximate
kick paths. It adds no perceptual approximation.

## Evidence

Native audio and all persistent-state/guard dumps are bit-exact against the
preceding [control/impulse candidate](BD-CONTROL.md) in seven primary/extended
fixtures, all 32 control corners and 12 saved seed fixtures spanning default,
maximum and the worst perceptual corner. Six table sizes (8 through 13 bits)
also match in native maximum-setting renders of the full reference path.
All 144 tested combinations of the previous generator's settings produce
unchanged assembly when the new option is off. The C++ reference is unchanged.

The exact comparison includes known failed native/C++ fixtures: idle retrigger
and two non-XL corners. Matching their old output does not fix those numerical
gaps. Existing perceptual losses, seed-ensemble results and listening needs
carry forward unchanged; reranking identical audio would add no evidence.

`tools/check_bd_tanh.py` independently checks the integer interpolation result
in a native helper wrapper. For every table size it exercises boundary and
midpoint neighborhoods with input A0 values 0, 0x800000 and 0xffffff. Both A1
and A0 must match the integer result. It runs the original and new schedules
at P placements 0x110023 and 0x140001, verifies output guards, and records tool,
source and artifact hashes. This covers 193,536 input vectors across the six
table sizes, with four executions per vector (two schedules, two placements).
It is not exhaustive coverage of all 48-bit accumulator inputs.
An intentionally shifted table pointer is rejected by the checker; that
diagnostic run remains incomplete rather than becoming passing evidence.

Three additional option combinations match exactly (16-sample controls,
one-pole impulse and nonresident/xorshift impulse omission). The latest
candidate passes the 11-track state test, 22 dirty-state reassignments and
poisoned-scratch checks. Standalone assembly and independent relocation
reproduce the package, and the draft export gate still rejects installation.
The 13 local TR6 tests and repository check pass (205 Node tests, 56 Python
tests and the site build; 11 tests still require external firmware images).

## Timing

The retained cold model adds raw instruction-host clocks, modeled interlocks
and three clocks per cold instruction-word miss. It remains uncalibrated and
excludes data waits, dispatch, DMA and unvalidated penalty overlap.

| Latest control-32/omitted-impulse kick | Raw clocks/block | Interlocks | Cold word misses | Modeled clocks/block | Modeled clocks/sample |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous lookup, maximum fixture | 8,865 | 1,556 | 327 | 11,402 | 356.3125 |
| Sequential lookup, maximum fixture | 8,225 | 1,300 | 315 | 10,470 | 327.1875 |
| Sequential lookup, minimum fixture | 7,137 | 1,172 | 293 | 9,188 | 287.1250 |

The maximum remains the saved block 7,365. Replays also include saved blocks
179, 6,813, 11,244 and 12,709, onset and ending calls. Ordinary/tracer audio,
call cycles and final dumps agree. The change saves 29.125 modeled clocks per
sample at the sampled maximum, without changing sound. It does not meet the
under-129 target or establish firmware admission or hardware qualification.
Four ordered edge replays cover both failed numerical corners, the worst
perceptual corner and the short-render boundary setting. They stay within the
same sampled maximum and preserve ordinary/tracer audio, cycles and dumps.

The kick now occupies 2,131 program words / 7,052 package bytes, with 43 local
X words for the control-rate mode. Family totals are 23,117 program words /
75,216 bytes, or 35,978 / 115,800 including CP. The library-byte limit remains
unmet. Packages still declare zero admitted cycles; device capacity is unqueried.

## Reproduce

From `mds/tr6`, use fresh output directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --sequential-tanh --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-sequential-final
python tools/compare_variants.py build/bd-control-final-omit build/bd-sequential-final --require-bitexact
python tools/check_bd_tanh.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-sequential-boundary-final
```

Use `--bd-sequential-tanh` with the corresponding kick options for the family
state checker. `build/bd-sequential-*` retains native audio, comparisons,
provenance, boundary probes, traces and draft packages. Earlier candidate
evidence remains available in its original directories.
