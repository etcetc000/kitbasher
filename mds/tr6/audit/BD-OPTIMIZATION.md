# Kick cutoff correction and first CPU reductions

The kick now has a corrected envelope cutoff, a default-off register-state
option and a default-off 24-bit noise generator. The complete signal path,
controls, filters, saturation and full reference port remain available.
The fastest candidate here is still far above the under-129 CPU target.

## Cutoff correction

The original fixed-point envelope helper emitted `CMP; CLR B; TLT B,A`.
`CLR` changes the condition flags, so `TLT` did not see the threshold comparison.
The fix prepares zero before the comparison: `CLR B; CMP; TLT B,A`. This
changes the default port and its checked-in assembly in three places; it is
a correctness fix rather than an optional sound approximation.

`check_bd_cutoff.py` exercises the assembled machine, with no hardware or
firmware involved. For initial amp/click/impulse values `[3,7,7]`, the old image
leaves `[2,6,5]` after 32 samples; the corrected image returns `[0,0,0]`.
An above-threshold vector `[32,64,64]` returns `[31,55,52]` in both images.
The check fails against the old image and passes against the corrected image.

The fix has a worst incremental lifecycle mel-proxy loss of 0.0000861 against
the old native port, with no flags. It does change quiet-tail activity and
therefore the noise sequence heard after a later idle retrigger. It also moves
the maximum-cost block, so timing replays include both the old saved vector
and the newly observed maximum.

An explicit idle-retrigger test remains a **strict numerical failure** against
the floating-point source. Before the fix, two hits advance native noise
118,154 times versus the source's 103,174. After the fix the native count is
104,498: much closer, but still 1,324 draws different. The first hit stays
within the existing numerical bound; the second starts at a different point
in the noise stream. Its peak differences are 0.019609 for the corrected
original-noise port and 0.021196 for the LCG candidate, above the unchanged
0.0002 bound. This is an outstanding fixed-point activity/noise-advance
qualification issue, not a passing numerical comparison.

The renderer preserves completed execution provenance and a `numeric_failures`
list for such diagnostic runs, then exits unsuccessfully. `complete` means
the render finished and its input hashes remained unchanged; it does not mean
numerical qualification. The native ensemble adapter still rejects failed
numerical renders. No tolerance was widened to hide this mismatch.

## Optional optimizations

`--resident-state` loads 12 frequently used state words into spare R/N
registers once per render and flushes them before returning. It retains the
39-word persistent state layout and all fractional remainders. The heat test
uses the free B accumulator, preserving the previous A1-to-A truncation.
Dropping that truncation changes low output bits, so it remains explicit.

The five primary cases, changing-heat case and idle-retrigger case preserve
native audio and every state/guard dump bit-for-bit against the corrected
baseline. This exact optimization does not resolve the baseline's independent
idle-retrigger numerical failure.

`--lcg-noise` uses `state = (1664525 * state + 1013904223) mod 2^24`, then
maps the result to bipolar noise. It retains the noise DC blocker, click
low-pass, envelope and gain. The independent C++ model uses the same integer
recurrence with the source's floating-point filters and voice activity policy.
No RNG state is reset on retrigger. Explicit uint32 seeds are supported in
both models; zero selects `0x606606`, and high bits remain significant for the
original xorshift but are discarded by the 24-bit LCG.

The ensemble adapter now rejects BD seed groups that differ only in those
discarded high bits. Two real candidate renders at `0x606606` and `0x01606606`
produce identical audio, and that group is rejected. Both valid ensemble
scores below remain unchanged when rescored with the strengthened check.
The saved CH maximum ensemble also retains identical scores, checking that
the BD-specific seed rule leaves the metal model's phase seeds intact.

## Perceptual evidence

The existing lab's unaligned, unnormalized `mel-proxy-v1` reports zero loss
for register scheduling. The LCG change's worst primary loss is **0.207821**,
in the active-retrigger case, with no categorical flags. Changing heat has
loss 0.028004; the native idle-retrigger pair has loss 0.118415. Neither has
flags. The latter compares native implementations and does not turn the
failed C++ numerical comparison into a pass.

Native seed ensembles use four reference seeds, four disjoint reference
split seeds and four matched candidate seeds at default and maximum settings.
Each render is 65,536 samples; maximum XL notes are still active at that point.
These ensembles cover the attack and body, not the complete longest tail.

| Native ensemble | Reference split loss | LCG loss | Ratio | Level delta, dB |
| --- | ---: | ---: | ---: | ---: |
| Default | 0.025101 | 0.023063 | 0.919 | -0.000732 |
| Maximum | 0.006678 | 0.005617 | 0.841 | -0.000100 |

Body-envelope errors are 0.005292 / 0.007736 dB. In these groups the LCG
difference is below the reference split's ordinary seed variation. This is
useful evidence for shortlisting the approximation, not an audibility
threshold, exhaustive seed coverage or listening approval.

## Validation

The five primary numerical cases pass for the corrected full-table reference,
compact-table reference, resident version and resident/LCG version. Ten saved
legacy C++ streams remain byte-exact. With optional flags off, the only native
source changes are the three cutoff instruction reorderings. The 24 native
ensemble renders and six seed-edge renders also pass their numerical checks.
Changing heat passes for all three compact-table configurations. The three
idle-retrigger numerical failures remain recorded separately above.

Family isolation passes for 11 interleaved tracks over 512 blocks, 22 dirty
reassignments and the existing tail-control capture checks, using this kick
and the combined-mix metal candidate with shared scratch poisoned. Standalone
package reproduction, independent relocation and the draft-export rejection
pass. The full-table and optimized images both pass the native cutoff probe.
The 13 local TR6 tests and `npm.cmd run check` pass: 205 Node tests, 56 Python
tests and the site build, with 11 firmware-dependent Node tests skipped
without supplied OS images.

## Timing and resources

| Corrected compact-table kick | Baseline | Resident state | Resident + LCG |
| --- | ---: | ---: | ---: |
| Largest raw render, clocks/block | 15,459 | 14,507 | 12,939 |
| Raw clocks/sample | 483.09375 | 453.34375 | 404.34375 |
| Largest sampled cold model, clocks/block | 18,959 | 18,148 | 16,312 |
| Sampled cold model, clocks/sample | 592.46875 | 567.125 | 509.75 |
| Program words | 2,581 | 2,627 | 2,591 |
| Package bytes | 8,456 | 8,604 | 8,488 |

The two optional changes save 78.75 raw and 82.71875 modeled clocks/sample
relative to the corrected baseline. Register caching increases instruction
footprint; its raw saving is larger than its modeled cold saving. The cutoff
correction itself raises the old baseline maximum by 126 raw/model clocks
because the conditional clears now execute; that regression is included.

The LCG maximum is 12,939 raw clocks + 2,248 modeled interlocks + 375 cold
instruction-word misses at three clocks each. Nine ordered replays cover
default, minimum and maximum for the three configurations. The largest
maximum-case render is now block 11,244; the saved old block 12,709 is also
replayed and is silent. Ordinary/tracer audio, every call-cycle count and
final dumps agree. Trigger and render remain separate calls.

This model is uncalibrated and additive. It excludes data waits, dispatch,
DMA and unvalidated penalty overlap; it is not a hardware worst-case bound.
Both the under-129 target and firmware admission remain unmet for BD.
Next CPU work must address the remaining sample-rate envelopes, pitch,
filtering and saturation rather than claim this incremental saving is enough.

Using the resident/LCG kick with the latest metal candidates, the seven-voice
family uses 23,577 program words / 76,652 package bytes. CP brings this to
36,438 / 117,236. The published library-byte field still does not fit; actual
device capacity is unqueried. Packages remain zero-cycle drafts and installable
SysEx remains blocked by the exporter.

## Reproduce

From `mds/tr6`, with the assembler, instruction host and external lab configured:

```powershell
python tools/render_bd.py --tanh-bits 8 --out build/bd-fixed-base --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_bd.py --tanh-bits 8 --resident-state --out build/bd-fixed-resident --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --out build/bd-fixed-lcg --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py build/bd-fixed-base build/bd-fixed-resident --require-bitexact
python tools/score_variants.py build/bd-fixed-resident build/bd-fixed-lcg --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-bd-fixed-lcg
python tools/check_bd_cutoff.py --render build/bd-fixed-lcg --host $env:MD_DSP_HOST --out build/bd-fixed-lcg-cutoff-check
```

Add `--case heat_modulation` for the three-block step-37 heat pattern, or
`--case retrigger_idle` to reproduce the known strict numerical failure.
Add `--seed` and `--blocks 2048` for the native ensemble fixtures. Zero,
`0xffffffff` and `0x01000000` are explicit seed-edge cases. Use fresh scorer
and cutoff-check directories. Add `--bd-resident-state --bd-lcg-noise
--bd-tanh-bits 8` to the family state-check command to exercise this candidate.

Reports, native audio, C++ references, local A/B pages, hashes and draft
packages stay under ignored `build/bd-fixed-*`, `bd-native-ensemble-v2`,
`perceptual-bd-fixed-*` and `bd-fixed-idle-diagnosis.json`. Existing scorer and
tool identities are recorded at execution time; no private bank code is used.
