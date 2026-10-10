# Interpolating the fade gate with the envelope

`--interpolated-gate` folds the fade gate into the control-rate envelope
endpoints. The preceding candidate interpolates the base envelope but computes
and multiplies its gate on every sample. The new option removes that inner-loop
work. It requires `--envelope-rate` greater than one and is default-off.

For an interval starting at frame F with stride R, the powered envelope endpoint
represents sample F+R−1. Its gate is `clamp((duration−F−R+1)/fade, 0, 1)` when
fade is nonzero. The combined endpoint is interpolated from the preceding
combined value. An endpoint beyond the lifetime clamps to zero. The active-sample
loop still stops at exactly the original duration and writes the remaining
output suffix as zero. The separate click term retains its original behavior.

The C++ `EnvelopeSteps` model independently computes the same floating endpoint
and disables the source's per-sample gate for that candidate. Gate parameters
are captured at trigger before disabling it. The full original reference and
the preceding per-sample-gate candidate remain available.

## Evidence

The eight-sample candidate passes **27 lifecycle and 96 ending-length numerical
comparisons**, covering all final-block lengths 1–32. Maximum native/C++ error
is 0.00183918 before output trim, within the existing 0.003 limit. Eleven extra
complete cases cover four- and sixteen-sample endpoints, unbounded loops with
xorshift noise/tanh/unfused mixing, and CH external-memory tracks 0/15.

The existing optimization lab's `mel-proxy-v1` results are:

| Comparison | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Incremental lifecycle worst loss | 0.002434 | 0.000354 | 0.000201 |
| Incremental ending-sweep worst loss | 0.001797 | 0.000405 | 0.000310 |
| Cumulative lifecycle versus full reference | 3.186852 | 2.603838 | 2.717197 |

All **150 scored native pairs** have no categorical flags. The largest
incremental 1 ms envelope errors are CH 0.00002172, OH 0.00001276 and CY
0.00000835 FS. Across lifecycle cases, level shifts range from −0.0002724 to
+0.0000100 dB. Worst spectral-frame differences including ending sweeps are
0.02181/0.01804/0.02585 dB. Their reference levels are approximately
−99.87/−83.01/−82.64 dBFS and residual levels −122.32/−120.01/−122.04 dBFS.
These are quiet tails; no normalization, alignment or RMS acceptance gate is
used. Proxy loss does not establish listening acceptance.

Random draws and state are unchanged by the gate option. It does not resolve
the earlier LCG candidate's outstanding native multi-seed qualification.
The candidate passes 11 interleaved tracks over 512 blocks, 22 dirty-state
reassignments and tail-control changes, with shared scratch poisoned. CH track
0/15 guards and standalone package reproduction pass. With the option off,
106 retained generated metal sources and 123 saved C++ reference streams are
byte-exact. Four ordered replays reproduce ordinary audio, every call-cycle
count and final dumps.

## Timing and resources

The observed CH maximum falls from **6,098 to 5,498 raw clocks/block**, or
**190.5625 to 171.8125 clocks/sample**. OH/CY fall from 6,094 to 5,494. The
saving is 18.75 raw clocks/sample. The final block-aligned render remains the
largest raw vector in the current case set.

CH's largest sampled cold model is **5,498 raw + 1,151 modeled interlocks +
391 instruction-word misses × 3 = 7,822 clocks**, or **244.4375/sample**, down
from 264.28125. OH/CY reach 7,815 clocks. The explicitly traced one-sample CH
tail is 567 raw / 1,771 modeled clocks, down from 574 / 1,797. Fetch wait values
are sensitivity assumptions, not hardware calibration. Data waits, dispatch,
DMA and overlap remain unverified; these sampled models are not hardware
worst-case bounds. The under-129 target remains unmet.

The added control-rate branch increases each program by 11 words / 32 package
bytes. CH is 2,958 words / 9,708 bytes; OH/CY are 3,085 / 10,104 each. With the
other current candidates, the seven-voice family uses 24,971 words / 81,036
bytes; CP brings it to 37,832 / 121,620. Both still exceed the published
library-byte field. All packages remain unqualified drafts with zero admitted
cycles, and installable SysEx export remains rejected.

## Reproduce

From `mds/tr6`, after producing the preceding DC candidates:

```powershell
$flags=@('--partial-count','3','--no-wobble','--tanh-bits','8','--lean-math','--resonators','--lcg-noise','--block-oscillators','--resident-state','--envelope-rate','8','--block-noise','--cubic-saturation','--fused-mix','--bounded-loops','--deduplicate-tables','--rounded-dc','--bypass-noise-dc')
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind @flags --interpolated-gate --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  $before="$kind-p3-static-lut8-lean-resonators-lcg-blockosc-resident-env8-blocknoise-cubic-fused-bounded-dedup-rounded-dc-no-noise-dc"
  python tools/score_variants.py "build/$before" "build/$before-gate" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-gate-v1/$kind"
}
python tools/check_state.py --deduplicate-tables --metal-rounded-dc --metal-bypass-noise-dc --metal-interpolated-gate --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --metal-block-oscillators --metal-resident-state --metal-envelope-rate 8 --metal-block-noise --metal-cubic-saturation --metal-fused-mix --metal-bounded-loops --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

Add `--end-boundaries` and score the corresponding `-endings` directories for
the ending sweeps. Trace the candidate `block_boundary.script`; additionally
trace CH `end_01.script` with `--render-block 105` for its one-sample tail.
Scoring requires fresh output directories. Source/tool/image provenance,
scoring reports, audio, draft binaries and traces remain ignored.
