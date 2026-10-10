# Reduced hats and cymbal candidates

These CPU experiments preserve the source noise generator, high/low-pass
biquads, attack, fast/slow envelopes, gate fade, bell accent, click, saturation
and output DC blocker. They keep either the three or six strongest partials,
in original source order, and remove per-partial frequency wobble. They use the
257-point tanh table from the compact-table experiment. Full-path machine
assembly and default generator output remain unchanged.

Three partials retain 5,978 / 6,340 / 7,686 Hz at unity tuning. Six also retain
6,500 / 6,600 / 8,876 Hz. The squared amplitudes sum to 89.64% and 92.85% of the
original 47-partial total, respectively. This ignores accent, phase, noise,
filtering and saturation; it is not a perceptual-quality score. Removed partials
consume no phase-random draws, so retained phases can change. Wobble RNG no longer
advances. Noise RNG, control mappings and source stop-time rules are retained.

## Measured cost and numerical checks

| Voice | Partials | P words | Package bytes | External words/track | Largest raw clocks/block | Raw clocks/sample | Worst error against reduced C++ model, before trim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CH | 3 | 2,847 | 9,292 | 24 | 21,053 | 657.91 | 0.00055314 |
| OH | 3 | 2,846 | 9,288 | 24 | 21,021 | 656.91 | 0.00059510 |
| CY | 3 | 2,846 | 9,288 | 24 | 21,021 | 656.91 | 0.00062228 |
| CH | 6 | 2,859 | 9,332 | 48 | 25,277 | 789.91 | 0.00055111 |
| OH | 6 | 2,858 | 9,328 | 48 | 25,245 | 788.91 | 0.00058485 |
| CY | 6 | 2,858 | 9,328 | 48 | 25,245 | 788.91 | 0.00067892 |

Raw cost falls about 91.4% with three partials or 89.7% with six relative to
the full-path maxima of 245,437/245,405 clocks/block. The three-partial option
still needs over **5.1×** further improvement even before cache/interlocks and
data waits. Neither candidate meets the under-129 target.

Using the three-partial models plus compact-table BD, the seven-voice family is
25,662 program words / 82,988 package bytes (38,523 words / 123,572 bytes with
full-path CP). This still exceeds the published 16-bit library-byte field.
Actual device capacity remains unqueried.

All **54 complete comparisons** pass: nine cases for each voice at each partial
count. Coverage includes decay/pitch corners, active and idle retriggers,
delayed triggers and block-aligned stop times. Exact RNG/frame/activity checks,
local/external/output guards and silence checks pass, with no tanh clamps.
These numerical errors compare native assembly to the C++ source configured
with the same intentional partial/wobble changes. They do **not** establish
equivalence to the original 47-partial source. The unchanged original C++ mode
reproduces all 27 saved base/boundary streams byte-for-byte; its tables and
default generated assembly also remain unchanged.

With the three-partial models substituted, 11 interleaved tracks over 512 blocks,
22 dirty-state reassignments and control changes during tails match isolated
native renders bit-for-bit. Other family members remain their full-path ports
in this test. The six-partial models have the per-voice checks above but have not
had this interleaved-family run.

The three-partial CH default ordered replay matches ordinary-host audio,
every call's cycle count and final state/guards. Its trigger costs 868 raw
clocks; the largest default render costs 21,046 raw clocks plus 2,880 modeled
interlocks and 377 cold instruction-word misses. At three clocks per miss the
additive screening estimate is 25,057 clocks/block (783.03/sample). This is
not calibrated X.20 cold-cache timing. The remaining noise/filter/envelope group
alone costs 9,184 raw clocks/block on that path. Oscillator reduction therefore
cannot solve the remaining budget by itself.

## Sound differences

The existing lab `mel-proxy-v1` now scores all 54 native pairs against the full
native baseline. See [perceptual scoring](PERCEPTUAL-SCORING.md) for worst/p95
loss, transient diagnostics, scorer hashes and reproduction commands. These
replace the preliminary sampled-centroid summaries for candidate ranking.

Three versus six partials has no consistent paired-loss winner: CH worst loss
improves slightly with six, while OH/CY worsen slightly. Six costs 4,224 more raw
clocks/block. Changing retained phases and removing stochastic wobble also calls
for multi-seed evidence before drawing a fidelity conclusion.

Across the tested controls, whole-render RMS changes lie between −0.42 and
+0.22 dB. This is only a supporting level diagnostic. Waveform peak differences
from the full model reach 0.8243 before trim. Listening review is still required;
neither partial count is a shipping choice.

## Reproduce

From `mds/tr6/`, after rendering the original baselines:

```powershell
foreach ($count in @(3,6)) {
  foreach ($kind in @('ch','oh','cy')) {
    python tools/render_metal.py $kind --partial-count $count --no-wobble --tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
    python tools/compare_variants.py "build/$kind-comparison" "build/$kind-p$count-static-lut8" --allow-model-change
  }
}
python tools/profile_trace.py build/ch-p3-static-lut8/default.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-p3-static-trace
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python -m unittest discover -s tests -p 'test_*.py'
```

Earlier CH/OH baseline directories omit the boundary case; supply the matching
`--baseline-extra build/ch-boundary` or `build/oh-boundary` as described in the
compact-table report. `--allow-model-change` explicitly allows the differing
desktop streams and records that difference; controls, sample counts and gain
must still agree. Without the flag, differing reference streams are rejected.

Draft packages, comparison reports and local `compare.html`/WAVs live under
`build/{voice}-p{3|6}-static-lut8/`. All packages retain zero admitted cycles;
no installable SysEx or hardware validation is claimed. Seven local analysis-tool
tests cover cache behavior and A/B reference/controls/schedule rejection; nine
existing lab scorer tests pass. Broader native controls/seeds, listening,
interleaved-state qualification for the six-partial variant, final family fit and
cold-cache/admission qualification remain open.
