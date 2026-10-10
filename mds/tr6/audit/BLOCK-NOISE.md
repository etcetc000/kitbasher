# Exact block noise and filter passes

`--block-noise` moves the white-noise/DC stage and both biquads into separate
passes over the active part of each 32-sample block. RNG/DC history stays in
registers during the first pass. Each filter keeps its two delay states in
registers and streams its three coefficients from shared X scratch. Filtered
samples occupy shared Y scratch; the oscillator passes then reuse X scratch.
The final mix, envelope, saturation and output DC stage are unchanged.

This is a default-off scheduling change on top of `--block-oscillators`, not a
new synthesis approximation. Neither scratch buffer survives a call. Each read
is preceded by a write, and the passes process only the remaining active samples
on the final block. Both buffers use linear addressing, without an alignment
assumption. MDS kind 3 / symbol 7 supplies 32 X words; kind 4 / symbol 8 supplies
32 Y words. Persistent allocations remain 58 local / 24 external words.

When resident state is enabled, the envelope moves from R5 to N7 so R5 can walk
the noise buffer. At envelope rate one, the slow pole consequently returns to
track memory. No C++ synthesis or seed changes are required.

## Verification

All 27 lifecycle and 96 final-block-length comparisons against the preceding
eight-sample-envelope model have identical native audio and final persistent
state/guards. Independent C++ numerical checks and exact RNG/frame/activity
checks pass. Nine more default cases cover audio-rate envelopes, the absence of
resident state, and the original xorshift noise option; these are also bit-exact.
The existing lab `mel-proxy-v1` reports zero incremental loss, envelope error and
flags for the 27 lifecycle pairs. Earlier perceptual drift remains unchanged;
this is not a new listening or native multi-seed qualification.

Eleven interleaved tracks over 512 blocks, 22 dirty-state reassignments and
changes to controls during tails match isolated renders exactly. Both scratch
buffers are poisoned before calls. Three additional default replays relocate
scratch from X:$200/Y:$240 to unaligned X:$203/Y:$243 and reproduce all audio,
persistent state and relocated guards. Forty-one retained generated sources
remain byte-identical with the option disabled. The standalone builder with
`--track-memory --scratch-x --scratch-y` reproduces the rendered CH package.

An initial experiment combined an X coefficient read and Y sample write with
`mpy` in one instruction. The pinned assembler accepted it but emitted `mpysu`
without those moves. Audio comparison caught the error. The final implementation
separates the coefficient read, and the ordered disassembly is retained with the
successful trace. Assembly success alone does not establish instruction intent.

## Cost and limits

| Candidate | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample |
| --- | ---: | ---: | ---: |
| Eight-sample envelopes | 10,589 | 10,585 | 330.91 |
| Plus block noise/filters | 9,674 | 9,670 | 302.31 |

The saving is 915 raw clocks/block, or 28.59375/sample. OH/CY reach 302.19 raw
clocks/sample. Two ordered CH replays reproduce ordinary-host audio, every call
cycle count and final dumps. Their largest sampled render costs 9,668 raw clocks,
1,778 modeled interlocks and 451 cold instruction-word misses. At three clocks
per miss, the additive estimate is **12,799/block, or 399.97/sample**, versus
424.25 previously. The one-sample tail rises from 918 to 995 raw clocks and from
2,219 to 2,465 in that model because setup is paid for fewer active samples.

These are sampled, uncalibrated estimates. They omit data-memory waits,
dispatch and DMA and do not prove an exhaustive cold-cache or hardware bound.
The under-129 target remains unmet. Output mixing/DC and saturation still cost
more than either block filter; reducing instruction traffic alone is insufficient.

Code grows to CH 3,405 words / 11,104 package bytes and OH/CY 3,404 / 11,100 each.
With compact BD, the seven-voice family uses 27,336 words / 88,424 bytes; CP brings
it to 40,197 / 129,008. Library fit and firmware admission remain unresolved.
All packages retain zero admitted cycles and upstream SysEx export rejects them.

## Reproduce

From `mds/tr6`, after producing the preceding envelope-eight baselines:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --envelope-rate 8 --block-noise --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/compare_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise" --require-bitexact
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-blocknoise-v1/$kind"
}
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/profile_trace.py build/ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise/default.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-blocknoise-trace
```

Use `--end-boundaries` on baseline/candidate renders and compare the resulting
`-endings` directories for all final-block lengths. Add `--render-block 105` to
the CH `end_01.script` replay to trace its one-sample tail explicitly. Scoring
requires a fresh output directory. Source/tool/image and render hashes remain
with ignored artifacts; no audio, private firmware, or tool binaries enter the PR.
