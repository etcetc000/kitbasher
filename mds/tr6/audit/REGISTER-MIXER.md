# Keeping mixer temporaries in registers

The default-off `--register-mix` option keeps the previous full-rate model's
audio and state unchanged. It requires fused mixing and bounded loops. The
rejected half-rate experiment is not part of this candidate.

The mixer uses R0/R5 for simultaneous X/Y scratch reads, R4 for the active
sample count, N0 for the truncated tonal value, R2 for filtered noise and X1
for bell gain. N0 is available after each DO instruction copies its count into
the hardware loop counter. Bell gain is captured alongside an arithmetic
operation, and the filtered-noise move overlaps the tonal multiply. The
pre-increment bell and existing 24-bit truncation points are preserved.

All three temporary values are written back to their original local-state
slots at the block end, before N0 becomes the zero-suffix count. This preserves
diagnostic state as well as audio. No scratch data survives calls. No private
bank code or tables are used.

## Audio and timing evidence

All **123 lifecycle and ending-length cases** across CH/OH/CY are bit-exact
against the preceding full-rate gated candidate, including every final state
and guard dump. The existing lab's `mel-proxy-v1` scores all 27 lifecycle pairs
at **zero loss**, with no level, transient, tail or polarity differences.
The previous candidate's cumulative approximation losses remain unchanged;
this scheduling change does not establish listening acceptance for them.

Ten additional paired default renders are exact: four- and sixteen-sample
envelopes, per-sample gate, linear saturation, wide DC feedback with retained
noise DC, xorshift noise, half-rate compatibility, tracks 0/15 and seed
`0xffffffff`. RNG draws and scheduling are unchanged by register mixing.

Eleven tracks over 512 blocks, 22 dirty-state reassignments and tail-control
changes match isolated renders with shared scratch poisoned. Six additional
replays (default and boundary for each voice) move X/Y scratch to `$203`/`$243`;
audio, call counts and all final dumps remain exact. Standalone package
reproduction passes, including independent reassembly at two placements and
the upstream draft-export rejection. With the option off, **236 retained
generated sources** are unchanged. A final emitter cleanup reproduces those
236 sources and all 17 retained sources using the finished register mixer
byte-for-byte. The 13 local comparison/profiler/table tests pass. Repository
checks pass with 205 Node tests, 56 Python tests and the site build; 11
firmware-dependent Node tests remain skipped without supplied OS images.

| Full-rate candidate | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Previous raw maximum/block | 5,498 | 5,494 | 5,494 |
| Register mixer raw maximum/block | 5,180 | 5,176 | 5,176 |
| Register mixer raw clocks/sample | 161.875 | 161.750 | 161.750 |
| Sampled cold model, clocks/block | 7,300 | 7,293 | 7,293 |
| Sampled cold model, clocks/sample | 228.125 | 227.90625 | 227.90625 |

The saving is **318 raw clocks/block (9.9375/sample)** and **522 modeled
clocks/block (16.3125/sample)**. CH's largest sampled model is 5,180 raw + 959
modeled interlocks + 387 instruction-word misses times three. Its preceding
model was 7,822 clocks/block. The block-boundary case remains the largest raw
vector in the checked lifecycle/ending set. Ordinary and ordered-trace hosts
agree on audio, every call-cycle count and final dumps for all three boundary
replays. Disassembly confirms the emitted parallel register moves and X/Y read.
The fourth ordered replay covers CH's one-sample final block (block 105 of
`end_01`): 559 raw / 1,745 modeled clocks, down from 567 / 1,771.

This is an uncalibrated additive cache/interlock sensitivity model, not a
hardware measurement or exhaustive worst-case bound. Data waits, dispatch,
DMA and penalty overlap remain unverified. **Under 129 remains unmet.**

Each metal program shrinks by four words and 12 package bytes. CH is 2,954
words / 9,696 bytes; OH/CY are 3,081 / 10,092 each. With the other current
candidates, the seven-voice family is 24,959 words / 81,000 bytes; CP brings it
to 37,820 / 121,584. Family fit remains unresolved. Packages still declare zero
admitted cycles, and the upstream gate rejects installable SysEx export.

## Reproduce

From `mds/tr6`, using the pinned tools and existing full-rate gate baselines:

```powershell
$flags=@('--partial-count','3','--no-wobble','--tanh-bits','8','--lean-math','--resonators','--lcg-noise','--block-oscillators','--resident-state','--envelope-rate','8','--block-noise','--cubic-saturation','--fused-mix','--bounded-loops','--deduplicate-tables','--rounded-dc','--bypass-noise-dc','--interpolated-gate')
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind @flags --register-mix --out "build/register-mix-$kind" --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/render_metal.py $kind @flags --register-mix --end-boundaries --out "build/register-mix-$kind-endings" --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  $before="$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded-dedup-rounded-dc-no-noise-dc-gate"
  python tools/compare_variants.py "build/$before" "build/register-mix-$kind" --require-bitexact
  python tools/compare_variants.py "build/$before-endings" "build/register-mix-$kind-endings" --require-bitexact
  python tools/score_variants.py "build/$before" "build/register-mix-$kind" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-register-v1/$kind"
}
```

Use a fresh score directory. Trace each `block_boundary.script` with
`profile_trace.py`, supplying the ordinary/tracing hosts, disassembler and
external interlock analyzer. Source/tool/image hashes, native audio, score
inputs, draft packages and traces remain in ignored build directories.

For shared-state checks, add `--metal-register-mix` to the full-rate
`check_state.py` command in [GATED-ENVELOPES.md](GATED-ENVELOPES.md), using an
explicit fresh `--out` directory. Trace `register-mix-ch-endings/end_01.script`
with `--render-block 105` to reproduce the short-tail check.
