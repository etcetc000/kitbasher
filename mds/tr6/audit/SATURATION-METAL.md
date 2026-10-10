# Cheaper metal saturation candidates

Two default-off options replace the interpolated tanh stage after the existing
drive gain. Both require the lean three-partial/no-wobble model and preserve
oscillators, noise, filters, envelopes, click and output DC processing.

- `--linear-saturation` retains the driven signal without compression.
- `--cubic-saturation` clamps that signal to [-1,1], then evaluates
  `x - x³/4`. The curve is monotone on that interval and bounded by +/-0.75.
  This is an intentional approximation, including its limiting above unity.

The options are mutually exclusive. Both omit the tanh table and its address
calculation. The native cubic uses `u=x/4` and `u*(1/4-u²)` to produce Q19 output
with two multiplies. Neither option changes RNG consumption or persistent
allocations. The original full-path and preceding optimized sources are retained.

The C++ linear reference expresses drive through the source's two mix gains and
selects its existing saturation bypass. For cubic, the reference builder copies
the pinned header into ignored output and replaces exactly one saturation call
with a floating-point hook; it fails if the expected call is absent or repeated.
All other source code remains unchanged. The default hook invokes the original
`std::tanh`. The generated header is hashed with the other render inputs.

## CPU and perceptual evidence

All 54 complete numerical comparisons for the two options pass against their
respective independent floating-point models at the unchanged 0.003 pre-trim
limit. Cubic's largest observed error is 0.000957. This does not establish
equivalence to tanh: the existing lab scorer evaluates matched native renders
against the preceding tanh model at actual output gain, without normalization
or alignment.

| Curve | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample | Worst incremental mel loss CH / OH / CY |
| --- | ---: | ---: | ---: | --- |
| Interpolated tanh | 9,674 | 9,670 | 302.31 | 0 / 0 / 0 |
| Linear | 7,914 | 7,910 | 247.31 | 1.610226 / 1.780953 / 1.646577 |
| Bounded cubic | 8,490 | 8,486 | 265.31 | 0.203563 / 0.219258 / 0.169507 |

Linear saves 55 raw clocks/sample; cubic saves 37. Cubic costs 18 more than
linear but reduces the largest incremental losses by roughly eight to ten times.
Keep cubic as the next working candidate and linear as a more aggressive option.
There are no categorical flags, but these uncalibrated scores do not establish
inaudibility or listening acceptance. RMS does not select the candidate.

Across the nine lifecycle settings, cubic's level differences are CH
+0.043..+0.061 dB, OH +0.048..+0.071 dB and CY +0.051..+0.070 dB. Linear ranges
from +0.191 to +0.369 dB. The cubic worst spectral frames differ by 0.288/0.319/
0.247 dB; maximum 1 ms envelope errors are 0.001979/0.002742/0.002933 FS.
CH's worst spectral frame is near 7.26 ms, OH's near 431 ms and CY's near 530 ms
in their maximum-control cases, so the difference is not restricted to onset.
The scorer retains attack, tail, polarity and worst-frame diagnostics and exports
listening pairs. No listening review has been performed.

Another 96 complete cubic renders cover every final-block length 1–32 for all
three voices. Numerical, RNG/frame/activity, track/scratch guards and idle checks
pass. Their worst incremental losses are 0.105141/0.138628/0.115052, with no flags
or larger raw-cycle maxima. The floating reference does not reach the cubic clamp
in these 123 lifecycle/ending renders. A separate **269-point native kernel check**
covers [-8,8], including adjacent Q19 values around +/-1 and zero; outputs remain
bounded and monotone at those points, with maximum error 0.00000190735 FS against
the analytic curve. The old tanh range assertion is inapplicable to intentional
cubic limiting and is not used for this mode.

Twenty-seven cumulative native pairs compare cubic with the full 47-partial
source port. Worst losses are 3.188186/2.606686/2.714379, with no flags. Earlier
partial/noise changes continue to dominate the total difference. The experiment
retains **177 scored native pairs**: 27 linear, 27 cubic, 96 cubic endings and 27
cumulative. It changes no random generator or seed; earlier ensemble evidence
remains separate and does not become native multi-seed qualification here.

## Timing, resources and isolation

The block-aligned final render is the largest raw-cycle vector in the current
case set. Ordered CH replays of that same vector yield:

| Curve | Raw clocks | Modeled interlocks | Cold instruction-word misses | Additive clocks at 3/miss |
| --- | ---: | ---: | ---: | ---: |
| Tanh | 9,674 | 1,778 | 454 | 12,814 |
| Linear | 7,914 | 1,554 | 421 | 10,731 |
| Cubic | 8,490 | 1,618 | 437 | 11,419 |

Cubic's additive estimate is **356.84 clocks/sample**, versus 400.44 for tanh
on this vector. Earlier reports' 399.97 figure was the sampled default vector,
which is slightly cheaper. Cubic's explicitly traced one-sample tail costs 958
raw / 2,372 modeled clocks. Audio, every call cycle count and final dumps match
the ordinary host in all four replays. These are sampled, uncalibrated sensitivity
estimates, not an exhaustive hardware bound. Data waits, dispatch and DMA remain
omitted, and the under-129 cold-cache target is still unmet.

Cubic uses CH 3,119 program words / 10,212 package bytes and OH/CY 3,118 / 10,208.
It saves 286 words and 892 bytes per voice. Linear saves another 16 words and
52 bytes per voice. With compact BD and cubic metal, the seven-voice family is
26,478 words / 85,748 bytes; including CP gives 39,339 / 126,332. Persistent state
is still 58 local / 24 external words per metal voice, with shared X/Y scratch.
Library fit, firmware admission, hardware checks and final SysEx remain open.
The draft packages retain zero admitted cycles and fail upstream install export.

Eleven interleaved tracks, 22 dirty-state reassignments and tail-control changes
match isolated cubic renders bit-for-bit with both scratch buffers poisoned.
Additional CH track 0/15 renders pass numerical and memory guards, and the
standalone builder reproduces the tested cubic CH package byte-for-byte.
With both saturation options off, 56 retained generated sources and 321 distinct
historical C++ streams remain byte-exact. The final hook also reproduces all 27
earlier linear reference streams exactly.

## Reproduce

From `mds/tr6`, with preceding block-noise tanh baselines available:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-cubic-v1/$kind"
}
python tools/check_metal_saturation.py build/ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic/ch.asm --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/cubic-domain-verified
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --metal-cubic-saturation --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/profile_trace.py build/ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic/block_boundary.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-saturation-cubic-boundary-trace
```

Use `--linear-saturation` and `-linear` directories for the alternative. Add
`--end-boundaries` to renders for the ending sweeps; trace CH `end_01.script`
with `--render-block 105` for the one-sample tail. Scoring and kernel checks require
new output directories. Generated headers, audio, traces and binaries stay ignored.
