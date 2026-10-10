# Interpolated control-rate envelopes

`--envelope-rate 4|8|16` is a default-off approximation on top of the resident
three-partial recursive model. Fast/slow exponential states and the attack
deficit advance by the corresponding power of their source coefficient. Their
combined envelope is interpolated between endpoints. Bell and click envelopes
are interpolated too. Oscillators, noise, both biquads, saturation, DC blockers
and the final gate still run at 44.1 kHz. The original stop frame is unchanged.

The first combined envelope interpolates from zero; bell/click start at unity.
This changes attack curvature. The C++ reference models these endpoint updates
and interpolation independently, then lets the original voice process its
unchanged signal path. Native numerical comparisons target that approximation;
the existing lab scorer measures its difference from the preceding native model.
RMS does not decide acceptance.

This option requires `--resident-state`, and therefore the preceding block,
recursive, lean and three-partial/no-wobble options. The default is 1, retaining
audio-rate envelopes. The former wide-remainder slots `fastenverr`,
`slowenverr`, `attackerr`, `bellerr` hold the interpolated base envelope and its
three increments in this mode. Fast/slow coefficient slots hold powered poles.
Track memory remains 58 local / 24 external words, plus shared 32-word X scratch.

## CPU and sound tradeoff

All 81 complete C++/native comparisons pass at the unchanged 0.003 pre-trim
numerical limit. The largest observed error is 0.001019. Exact RNG/frame/activity,
track and scratch guards, parameter capture, idle silence and saturation-range
checks pass. All 81 incremental pairs were evaluated by the existing lab
`mel-proxy-v1` at actual output gain, without alignment or normalization.

Stride eight additionally passes 96 complete cases covering every final-block
length 1–32 for all three voices. Their incremental worst losses are CH 0.035485,
OH 0.009029 and CY 0.013287, with no flags and no larger raw-cycle maximum. Eleven
interleaved tracks, 22 dirty-state reassignments and tail-control changes match
isolated stride-eight renders bit-for-bit, with scratch poisoned before calls.
All 18 previous generated sources and 54 original/LCG C++ streams remain
byte-exact with the option disabled.

| Envelope stride | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample | Worst incremental mel loss CH / OH / CY |
| --- | ---: | ---: | ---: | --- |
| 1, previous model | 11,567 | 11,535 | 361.47 | 0 / 0 / 0 |
| 4 | 10,929 | 10,921 | 341.53 | 0.022568 / 0.004761 / 0.014466 |
| 8 | 10,589 | 10,585 | 330.91 | 0.065218 / 0.013713 / 0.014749 |
| 16 | 10,419 | 10,417 | 325.59 | 0.270754 / 0.030881 / 0.020858 |

There are no categorical flags. Lower loss is closer; these numbers have no
calibrated audibility cutoff. The eight-sample candidate saves 30.5625 raw
clocks/sample for CH and 29.6875 for OH/CY. Sixteen saves only another 5.25–5.3125
clocks/sample, while its largest CH loss is over four times larger. Keep eight
as the next working candidate, with four and sixteen available for comparison.
This is an engineering tradeoff, not a listening verdict.

Two ordered CH replays (default and one-sample tail) reproduce ordinary-host
audio, every call cycle count and final dumps. The sampled largest render is
10,583 raw clocks, 1,808 modeled interlocks and 395 cold instruction-word misses.
At three clocks per miss the additive estimate is **13,576/block, or
424.25/sample**, versus 459.28 previously. The one-sample tail instead increases
from 841 to 918 raw clocks because of group setup; its additive estimate is
2,219. These sampled, uncalibrated estimates omit data waits/dispatch and do not
prove a hardware bound. The under-129 target is still unmet.

At stride eight, largest 1 ms envelope errors are CH 0.001061, OH 0.001180 and
CY 0.000936 FS. At sixteen they rise to 0.004267, 0.004140 and 0.003859 FS.
The worst CH mel case is its minimum setting. In the initial 256-sample spectral
frame, stride-eight reference/candidate levels are -17.809/-17.831 dBFS, versus
-17.809/-17.931 at stride sixteen. That locates the transient change; whole-render
level differences alone would underdescribe it. Worst-ranked listening pairs
are exported by the existing scorer.

Another 27 native pairs compare stride eight with the complete 47-partial source
port. Worst cumulative loss is CH 3.183341, OH 2.605030, CY 2.718855, with no
flags. The experiment therefore retains **204 scored native pairs**: 81 stride
comparisons, 96 ending-length cases and 27 cumulative comparisons. Earlier
partial/noise changes still dominate the cumulative difference.

Every stride has the same storage: CH 3,349 program words / 10,896 package bytes,
OH/CY 3,348 / 10,892. With compact BD, the seven-voice family uses 27,168 words /
87,800 bytes; including CP gives 40,029 / 128,384. CPU, library fit and firmware
admission remain unresolved. No installable SysEx is produced.

## Reproduce

From `mds/tr6`, with a fresh scoring output directory:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-envelope-v1/env8-$kind"
}
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

Use stride four or sixteen to reproduce the other comparisons. This experiment
changes no random generator or seed, so the earlier noise ensemble probe remains
separate evidence about the underlying model. It does not become native
multi-seed qualification of these envelopes. Source/tool/image provenance is
retained with each render and verified during scoring. Artifacts remain ignored.
