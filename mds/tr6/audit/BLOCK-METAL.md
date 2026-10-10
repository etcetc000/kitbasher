# Block processing without further sound changes

Two default-off scheduling switches build on the recursive three-partial model:

- `--block-oscillators` renders the three oscillators in separate passes. Each
  pass retains its two recurrence samples and coefficient in registers through
  the active portion of the block. The first writes the imported 32-word X
  scratch buffer; the others add to it. The scalar output pass reads that sum
  and applies the same bell gain, noise, filters, envelopes and saturation.
  Parallel moves overlap the previous-state update and scratch fetch with ALU
  work. The last block advances oscillator state only for its remaining active
  samples. Scratch is never retained between calls.
- `--resident-state` additionally keeps attack/fast/slow/bell/click envelopes,
  decay poles, frame, duration and two intermediate values in spare R/N registers
  inside RENDER. Each active call loads them from track memory and stores them
  back before returning. R6, R7 and their memory ownership remain intact; no
  address-indexed operation uses those cached registers in the scalar loop.

The first switch requires `--resonators`; the second requires the first. Existing
three-partial/no-wobble/lean requirements still apply. Neither changes the noise
model. All nine prior full, lean and recursive/LCG generated sources remain
byte-exact with both switches disabled.

## Evidence

All nine complete lifecycle/control cases for CH/OH/CY pass for each switch:
**54 native comparisons**. Against the previous recursive/LCG candidate, every
audio byte and all baseline final state/guard dumps match exactly, including
the complete external track region. The C++ comparison bounds remain unchanged.
The final state check matters: matching audio alone could hide incorrectly
advanced oscillators after the voice stops.

The existing lab scorer evaluates the 27 combined scheduling cases: **all 27
identical, zero incremental mel/envelope loss, no categorical flags**. This adds
no sound drift in those cases; the earlier model's perceptual and multi-seed
limitations still apply. No new listening or hardware claim is made.

Eleven interleaved tracks over 512 blocks each, 22 dirty-state reassignments and
tail-control changes also match isolated native renders bit-for-bit. These
checks poison shared scratch before every render, including calls to the other
five reference voices. The renderer independently checks both scratch guards.

The `--end-boundaries` sweep selects an integer decay for each final-block length
1–32 at pitch 64. All 192 complete scalar/candidate renders pass, and their 96
paired audio/state comparisons are bit-exact. This covers early termination of
each oscillator pass without advancing hidden state beyond the source lifetime.
Three additional default cases retaining xorshift noise also remain bit-exact.
CH track 0 and track 15 renders pass independent numerical and memory guards.
The standalone builder produces the exact CH package used for these renders.
All 18 retained full/lean/recursive/scheduled generated sources match the current
generator byte-for-byte; ten local analysis tests pass.

| Candidate | CH raw clocks/block | OH/CY raw clocks/block | CH raw clocks/sample |
| --- | ---: | ---: | ---: |
| Recursive/LCG scalar | 13,757 | 13,725 | 429.91 |
| Block oscillators | 12,525 | 12,493 | 391.41 |
| Plus resident state | 11,567 | 11,535 | 361.47 |

Together these save **2,190 raw clocks/block / 68.4375 clocks/sample**. OH/CY
reach 360.47 raw clocks/sample. This is still above the under-129 cold-cache
target, before interlocks, memory waits and dispatch. The new hot loops add
code: combined CH is 3,326 program words / 10,824 package bytes; OH/CY are
3,325 / 10,820 each. Local/external allocations stay at 58/24 words. The shared
32-word X buffer is obtained through MDS kind 3 / symbol 7; it is not private
storage and is poisoned before every test render.

Two ordered replays (CH default and its one-sample-tail case) match ordinary-host
audio, all call cycle counts and final dumps. The sampled largest render is
11,561 raw clocks, 2,020 modeled interlocks and 372 cold instruction-word misses.
At three clocks per miss the additive estimate is **14,697/block, or
459.28/sample**, down from 509.84 for the preceding scalar implementation.
The instruction footprint and modeled stalls grow even though raw work falls.
The explicitly traced one-sample tail costs 841 raw clocks and 2,070 including
the same additive model. `profile_trace.py --render-block 105` selects that
boundary, which its default min/max sampling would otherwise miss. Neither
replay calibrates cache/data waits or proves an exhaustive hardware bound.

With compact BD, the seven-voice family uses 27,099 program words / 87,584 bytes;
including CP gives 39,960 / 128,168. Library fit remains unresolved. All packages
remain drafts and their upstream SysEx export is rejected.

## Reproduce

From `mds/tr6`:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --block-oscillators --resident-state --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/compare_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident" --require-bitexact
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean-resonators-lcg" "build/$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-block-v1/$kind"
}
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST

# For each voice, add --end-boundaries to both scalar and scheduled render commands.
# Those runs use distinct directories ending in -endings; compare them with --require-bitexact.
python tools/profile_trace.py build/ch-p3-static-lut8-lean-resonators-lcg-blockosc-resident-endings/end_01.script --render-block 105 --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-block-end1-trace
```

Omit `--resident-state` for the intermediate oscillator-only scheduling result.
`compare_variants.py --require-bitexact` checks native audio plus every baseline
dump address and length; absent, truncated or changed state is an error. A test
rejects changed final state even when audio is identical. Additional candidate
scratch guard dumps are checked by the renderer. The standalone package builder
accepts `--track-memory --scratch-x` for these sources. All output stays ignored.
