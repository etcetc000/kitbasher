# Folded mixer gains and active-sample loops

Two default-off options reduce work after the cubic candidate. `--fused-mix`
folds fixed gains into envelope state and uses multiply-accumulate sums. It
requires block noise and resident state. The floating-point synthesis model is
unchanged, but fixed-point rounding changes. `--bounded-loops` processes only
the active samples in a block and then writes its zero suffix once. It requires
resident state, control-rate envelopes and linear/cubic saturation; it is
bit-exact against the corresponding unbounded mixer.

## Mixer arithmetic

At trigger, fast/slow envelopes start at `trim/2`, click at
`click_amount*trim/2`, and bell at `bell_amount*tonal_mix*drive/4`. Attack remains
at unity. The envelope recurrences and interpolation operate on those scaled
values. The tonal base gain is `tonal_mix*drive/4`; adding the scaled bell state
gives the driven tonal coefficient. Noise uses the combined `noise_mix*drive`
coefficient. After saturation, one MAC sum combines the body and click, followed
by a factor of two before the unchanged output DC blocker.

This removes repeated fixed multiplications and intermediate truncations. The
halved trim keeps envelope state representable in Q23. Folded bell/click state
has different quantization, so this is not advertised as exact output. No new
source synthesis approximation or C++ model is introduced: every comparison
uses the same floating-point reference stream as the preceding cubic candidate.
Local/external state remains 58/24 words and both shared scratch imports remain.

## Active-sample loops

The oscillator pass already knows `min(32,duration-frame)`. R0 holds that count
during rendering; N0 supplies hardware-loop counts. The outer loop runs
`ceil(active/envelope_rate)` groups and each inner loop runs at most that group's
remaining active samples. Frame increments use linear address-register updates
in R3. The MDS RENDER ABI supplies linear M0–M5, including M3. Active state is
updated once after the loops, then the remaining output words are zero-filled.
Every call still writes exactly 32 samples and all hardware loops finish before
RTS. The inactive-block path is unchanged.

R0/N0 are available because linear/cubic saturation does not use the lookup
pointer. The option therefore rejects table saturation and audio-rate envelopes.
It does not change when active control groups advance their state, including a
partially filled final group.

## Verification and sound difference

Both stages pass 27 complete lifecycle plus 96 final-block-length numerical
comparisons at the existing 0.003 pre-trim limit; the largest error is 0.001846.
RNG consumption, stop frame, idle silence, parameter capture and track/scratch
guards pass. All **123 bounded/unbounded native pairs** have identical audio and
final state/guards. The existing lab scorer reports zero incremental loss for
its 27 lifecycle pairs.

The fused mix's worst incremental `mel-proxy-v1` losses are CH 0.004879, OH
0.004052 and CY 0.003701 over lifecycle cases. The ending sweeps reach
0.002749/0.004091/0.005190. There are no categorical flags. Largest lifecycle
1 ms envelope errors are 0.0000861/0.0002212/0.0004125 FS. Whole-render level
shifts range from -0.006264 to -0.000300 dB across the voices.

Worst spectral-frame differences are 0.07963/0.03822/0.02571 dB. Those frames
are quiet tails: reference levels are about -80.56/-90.45/-77.46 dBFS, with
residual levels -115.10/-120.55/-121.79 dBFS. These diagnostics locate the rounding
drift; low proxy loss is not listening acceptance or an audibility threshold.
No normalization, alignment or RMS-based acceptance is used.

Twenty-seven cumulative pairs against the full 47-partial ports have worst
losses 3.188439/2.607182/2.714578 and no flags. Earlier model changes dominate
the total difference. This experiment retains **177 scored native pairs**:
123 fused comparisons, 27 exact bounded comparisons and 27 cumulative pairs.
No random generator or seed changes here, and prior ensemble evidence remains
separate from native multi-seed qualification.

The combined candidate passes 11 interleaved tracks over 512 blocks, 22 dirty
reassignments and tail-control changes against isolated renders, with both
scratch buffers poisoned. CH track 0/15 guards pass. Eighteen additional complete
default cases cover envelope rates 1/4/16, tanh/linear saturation and xorshift
noise across all three voices. Sixty-seven retained generated sources remain
byte-exact with the new options off. The standalone builder reproduces the tested
combined CH package exactly.
Three further default pairs verify that bounded loops remain bit-exact with the
fused mixer disabled.

## Timing and resources

| Candidate | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample |
| --- | ---: | ---: | ---: |
| Previous cubic | 8,490 | 8,486 | 265.31 |
| Fused mix | 7,306 | 7,302 | 228.31 |
| Plus active-sample loops | 6,788 | 6,784 | 212.13 |

The mixer saves 37 raw clocks/sample; bounded loops save another 16.1875 at the
observed maximum, for **53.1875 raw clocks/sample combined**. The block-aligned
final render remains the largest raw-cycle vector in the current case set.
Ordered replays of that vector give:

| Candidate | Raw clocks | Modeled interlocks | Cold instruction-word misses | Additive clocks at 3/miss |
| --- | ---: | ---: | ---: | ---: |
| Previous CH cubic | 8,490 | 1,618 | 437 | 11,419 |
| CH fused | 7,306 | 1,330 | 407 | 9,857 |
| CH combined | 6,788 | 1,303 | 414 | 9,333 |
| OH/CY combined | 6,784 | 1,303 | 413 | 9,326 |

The largest sampled combined estimate is **291.66 clocks/sample**, down from
356.84. The explicitly traced one-sample CH tail improves from 958 raw / 2,372
modeled clocks to 613 / 1,929. All five new ordered replays reproduce ordinary
audio, every call cycle count and final dumps. These are sampled, uncalibrated
models; data waits, dispatch and DMA are omitted. They do not establish an
exhaustive hardware bound, and the under-129 target remains unmet.

Combined CH is 3,105 program words / 10,168 package bytes; OH/CY are 3,104 /
10,160 each. With compact BD, the seven-voice family uses 26,436 words / 85,608
bytes; CP brings it to 39,297 / 126,192. The library-byte field still does not
fit. Firmware admission, hardware validation and final SysEx remain unresolved;
all packages retain zero admitted cycles and upstream install export is rejected.

## Reproduce

From `mds/tr6`, after producing the preceding cubic baselines:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --fused-mix --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-fused-v1/$kind"
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --cubic-saturation --fused-mix --bounded-loops --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/compare_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded" --require-bitexact
}
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --metal-cubic-saturation --metal-fused-mix --metal-bounded-loops --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/profile_trace.py build/ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded/block_boundary.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-bounded-boundary-trace
```

Add `--end-boundaries` to renders for the complete ending sweeps and compare
the resulting `-endings` directories. Trace CH `end_01.script` with
`--render-block 105` for its one-sample tail. Scoring needs new output directories.
Hashes, draft packages, audio, local listening pages and traces remain ignored.
