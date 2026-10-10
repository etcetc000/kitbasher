# Cheaper DC filtering in the metal engine

Two default-off options reduce the remaining per-sample work in the lean CH/OH/CY
ports. Both require `--lean-math`; the complete reference ports remain unchanged.

- `--rounded-dc` rounds feedback to a single state word in each DC filter,
  replacing the saved fractional error and its accumulator operations. It keeps
  the same floating-point model and changes fixed-point quantization.
- `--bypass-noise-dc` removes the noise generator's DC filter before the retained
  high-pass/low-pass biquads. The independent C++ model resets only that stage's
  history before each source `process()` call, making it return the raw noise
  sample. RNG draws, the two biquads, envelopes, saturation and output DC filter
  remain. This is an intentional signal-path approximation.

The working candidate combines these with the preceding fused/bounded cubic
model and exact table compaction. Neither option implies listening acceptance.

## Numerical and perceptual evidence

Each stage passes 27 lifecycle cases and all 96 final-block-length cases:
**246 numerical comparisons** in total. The largest native/C++ peak difference
is 0.00184232 before output trim, below the existing 0.003 limit. That bound
validates each candidate against its own floating model; it does not establish
similarity to the original 47-partial voice.

The existing optimization lab's `mel-proxy-v1` scorer gives these worst losses:

| Comparison | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Rounded feedback, lifecycle | 0.004013 | 0.003800 | 0.002184 |
| Rounded feedback, ending sweep | 0.003964 | 0.002884 | 0.002036 |
| Add noise DC bypass, lifecycle | 0.031222 | 0.025362 | 0.025287 |
| Add noise DC bypass, ending sweep | 0.023975 | 0.024117 | 0.024129 |
| Combined versus preceding candidate, lifecycle | 0.031004 | 0.025181 | 0.025054 |
| Combined versus full reference, lifecycle | 3.186826 | 2.603849 | 2.717164 |

All **300 scored native pairs** have no categorical flags. Loss is an
uncalibrated distance, not an audibility verdict. No normalization or alignment
is applied. The original model changes still dominate cumulative loss.

Rounded feedback's largest 1 ms envelope difference across lifecycle/ending
cases is 0.000002714 FS. With noise DC bypass, lifecycle maxima are
0.0008602/0.0005773/0.0008100 FS for CH/OH/CY. Bypass lowers whole-render levels
by about 0.0115–0.0223 dB across these cases. Its worst spectral frames are
0.2125/0.1190/0.2740 dB, with reference levels -23.37/-24.61/-21.34 dBFS and
residual levels -65.94/-69.56/-64.12 dBFS. These diagnostics expose the change
instead of using waveform RMS as an acceptance gate.

Both new options leave RNG draws and final random state unchanged. This
experiment does not add native multi-seed qualification to the earlier LCG
change; that remains separate work. Nine extra complete default renders cover
scalar xorshift processing with each option separately, and block processing
with four-sample envelopes and linear saturation.

The combined candidate passes 11 interleaved tracks over 512 blocks, 22 dirty
reassignments and tail-control changes against isolated renders, with shared
scratch poisoned. With both options off, 85 retained generated metal sources
are unchanged. Extending the C++ model preserves all 123 saved rounded-stage
reference streams byte-for-byte when bypass is off. The standalone builder
reproduces the combined CH package exactly.

## Timing and resources

| Candidate | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample |
| --- | ---: | ---: | ---: |
| Previous fused/bounded cubic | 6,788 | 6,784 | 212.125 |
| Rounded DC feedback | 6,468 | 6,464 | 202.125 |
| Plus noise DC bypass | 6,098 | 6,094 | 190.5625 |

Combined savings at the observed maximum are **21.5625 raw clocks/sample**.
The final block-aligned render remains the maximum in these case sets. Five
ordered replays reproduce ordinary-host audio, every call cycle count and final
dumps. At the three-clocks-per-miss sensitivity:

| CH candidate | Raw clocks | Modeled interlocks | Cold instruction-word misses | Additive estimate |
| --- | ---: | ---: | ---: | ---: |
| Previous | 6,788 | 1,303 | 414 | 9,333 |
| Rounded feedback | 6,468 | 1,239 | 406 | 8,925 |
| Combined | 6,098 | 1,207 | 384 | 8,457 |

The combined sampled estimate is **264.28 clocks/sample**, down from 291.66.
OH/CY reach 8,450 clocks. The explicitly traced one-sample CH tail is 574 raw /
1,797 modeled clocks, down from 613 / 1,929. These are uncalibrated, sampled
models: data waits, dispatch, DMA and penalty overlap remain unverified. They
do not establish a hardware worst-case bound. The under-129 target is unmet.

Combined CH uses 2,947 program words / 9,676 package bytes; OH/CY use 3,074 /
10,072 each. With compact BD and pooled tom tables, the seven-voice family is
24,938 words / 80,940 bytes; CP brings it to 37,799 / 121,524. The published
library-byte field still does not fit. All packages retain zero admitted cycles
and fail the upstream installable-SysEx gate. Firmware and hardware qualification
remain open.

## Reproduce

From `mds/tr6`, with the preceding fused/bounded baselines:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --fused-mix --bounded-loops --deduplicate-tables --rounded-dc --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --fused-mix --bounded-loops --deduplicate-tables --rounded-dc --bypass-noise-dc --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  $rounded="$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded-dedup-rounded-dc"
  python tools/score_variants.py "build/$rounded" "build/$rounded-no-noise-dc" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-no-noise-dc-v1/$kind"
}
python tools/check_state.py --deduplicate-tables --metal-rounded-dc --metal-bypass-noise-dc --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --metal-cubic-saturation --metal-fused-mix --metal-bounded-loops --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
$combined='ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded-dedup-rounded-dc-no-noise-dc'
python tools/profile_trace.py "build/$combined/block_boundary.script" --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-dc-combined-boundary-trace
```

Add `--end-boundaries` to render the full ending sweeps, then score their
`-endings` directories. Trace CH `end_01.script` with `--render-block 105` for
the one-sample tail. Cumulative comparisons use the original `*-comparison`
directories plus CH/OH `*-boundary` baselines and `--allow-model-change`.
Scoring needs fresh output directories. Draft binaries, audio, hashes, traces
and local listening pages remain ignored.
