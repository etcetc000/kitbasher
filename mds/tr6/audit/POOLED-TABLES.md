# Exact literal-table compaction

`--deduplicate-tables` shares complete, identical 24-bit coefficient arrays
within each generated machine. It is default-off in the tom and metal renderers.
Consecutive assembly labels name the same read-only data. Filter, envelope and
random state remain separate; there is no cross-machine storage or ABI change.
The full reference ports remain available with the option off.

| Machine | Program words before / after | Package bytes before / after | Shared arrays removed |
| --- | ---: | ---: | ---: |
| LT | 5,304 / 4,536 | 16,976 / 14,576 | Six 128-word arrays |
| HT | 5,866 / 5,354 | 18,756 / 17,156 | Four 128-word arrays |
| CH, fused/bounded cubic candidate | 3,105 / 2,977 | 10,168 / 9,768 | One 128-word array |

LT's corresponding filter coefficients are identical for filters 0/4 and 2/6.
HT shares the two upper-envelope pole arrays and the coefficients for filters
0/4. CH shares fast/slow envelope-loss arrays. OH/CY in this candidate have no
identical complete arrays, so compaction saves nothing there. Array length is
part of equality; equal prefixes are not merged.

The total saving is **1,408 program words and 4,400 package bytes**. Package
savings include MDS's wire encoding, so they exceed the raw 4,224 program bytes.
With compact BD, original SD, compacted toms, and the current metal candidates,
the seven-voice family is **25,028 words / 81,208 bytes**. CP brings that to
**37,889 / 121,792**. Both still exceed the published 16-bit library-byte field;
actual device capacity has not been queried. This change does not solve CPU or
installation qualification.

## Evidence

Eight lifecycle cases for each tom and nine for CH produce **25 bit-exact
native audio pairs**, including all baseline final state and guard dumps.
The existing optimization lab's `mel-proxy-v1` scorer reports zero loss,
zero envelope/frame differences and no flags for every pair. No seed or signal
path changes here; no perceptual-drift allowance is needed for compaction.
The tom baselines were freshly rendered to retain complete matched coverage.

`check_table_pool.py` verifies all **11,020 entries in 87 literal arrays**
against the assembled baseline and candidate MDS programs. It checks unchanged
entry-point offsets, absence of relocations/imports inside literal tables,
alias offsets and the exact expected size reduction. This covers every stored
control entry, including entries outside the lifecycle audio cases.
Every raw call-cycle sequence is identical across all 25 matched renders.
Compaction is a storage improvement, not a measured CPU improvement.

The compacted configuration passes 11 interleaved tracks over 512 blocks,
22 dirty-state reassignments and tail-control changes against isolated renders,
with shared scratch poisoned before calls. A standalone CH build reproduces the
rendered package byte-for-byte.

An ordered replay of CH's block-boundary vector reproduces ordinary audio,
every call cycle count and final dumps. Its largest sampled render remains
6,788 raw clocks + 1,303 modeled interlocks + 414 cold instruction-word misses:
**9,333 clocks / 32 samples = 291.66** at the three-clocks-per-miss sensitivity.
The instruction-cache model is uncalibrated and excludes data waits, dispatch
and DMA; this is not a hardware bound. The under-129 target remains unmet.

With compaction disabled, **86 retained generated sources** are unchanged.
The builder independently verifies relocation at two placements. Local unit
checks cover full-array boundaries, emitted 24-bit equality and the legacy
default format. Tom rendering now captures source/tool/image hashes before
execution and retains a distinct filename for each decay-sweep case rather
than overwriting a shared `sweep` artifact. No historical provenance is invented.

## Reproduce

From `mds/tr6`, with the configured tools and the preceding CH candidate:

```powershell
foreach ($kind in @('lt','ht')) {
  python tools/render_toms.py $kind --out "build/$kind-dedup-baseline" --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/render_toms.py $kind --deduplicate-tables --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/compare_variants.py "build/$kind-dedup-baseline" "build/$kind-dedup" --require-bitexact
  python tools/check_table_pool.py $kind "build/$kind-dedup-baseline" "build/$kind-dedup"
  python tools/score_variants.py "build/$kind-dedup-baseline" "build/$kind-dedup" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-dedup-v1/$kind"
}
$metal='ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded'
python tools/render_metal.py ch --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --fused-mix --bounded-loops --deduplicate-tables --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py "build/$metal" "build/$metal-dedup" --require-bitexact
python tools/check_table_pool.py ch "build/$metal" "build/$metal-dedup"
python tools/score_variants.py "build/$metal" "build/$metal-dedup" --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-dedup-v1/ch
python tools/check_state.py --deduplicate-tables --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --metal-cubic-saturation --metal-fused-mix --metal-bounded-loops --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

Use fresh scoring output directories. Per-render provenance, table checks,
comparison reports, raw audio, listening pages and draft packages remain ignored.
Hardware, listening, admission and final SysEx qualification remain open.
