# Lean three-partial kernels

`--lean-math` is a default-off optimization of the three-partial, no-wobble
candidate. It preserves the three frequencies, 48-bit phase increments, source
32-bit RNG sequence, both noise biquads, DC blockers, attack/fast/slow/gate
envelopes, bell accent, click and interpolated saturation. It changes arithmetic
storage and rounding, not the synthesis topology:

- RNG low24/high8 values stay in registers through the original xorshift steps.
- Filter and DC-blocker intermediates stay in registers instead of scratch words.
- The three bell partials accumulate in B; their common gain is applied once.
  X1:X0 adds the 48-bit increment to phase in A without using B as temporary state.
- Envelopes use rounded Q23 pole multiplication instead of the wider
  loss-subtraction recurrence with a retained low accumulator word. The two
  state slots named `fastloss`/`slowloss` consequently hold poles in this mode.

The gate still stops on the exact source frame. This mode requires three bell
partials and no wobble; unsupported combinations fail. Full-path and previous
three-partial generator output remain byte-exact when the option is disabled.

## Cost and fidelity

| Voice | Previous raw clocks/block | Lean raw clocks/block | Lean raw clocks/sample | Program words | Package bytes | Worst pre-trim error against reduced C++ model |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CH | 21,053 | 15,869 | 495.91 | 2,787 | 9,108 | 0.00055123 |
| OH | 21,021 | 15,837 | 494.91 | 2,786 | 9,104 | 0.00059534 |
| CY | 21,021 | 15,837 | 494.91 | 2,786 | 9,104 | 0.00117255 |

Each saves **5,184 raw clocks/block / 162 clocks/sample**, about 24.6% versus
the earlier three-partial engine. State remains 58 local and 24 external words.
All 27 complete comparisons pass the unchanged 0.003 numerical bound, with exact
source RNG/frame/activity checks, local/external/output guards, silence and no
tanh clamps. All three packages independently reassemble at both linker
placements and remain drafts with a zero admitted cycle declaration.

With these kernels substituted, 11 interleaved tracks over 512 blocks per track,
22 dirty-state reassignments and tail-control changes match isolated native
renders bit-for-bit. The other family voices remain their full-path versions in
that check. Nine local analysis tests pass, including rejection of altered audio
against its render-time hashes.

With compact-table BD and the three lean metal packages, the seven-voice family
occupies 25,482 program words / 82,436 package bytes; adding full-path CP gives
38,343 words / 123,020 bytes. Shared library fit is still unresolved.

The existing lab scorer evaluates both the incremental arithmetic change and
the cumulative change from the full 47-partial native port: **54 scored pairs**.
No categorical flags occur. Actual output gain is retained, with no alignment
or normalization. Lower mel loss is closer; it is not an audibility percentage.

| Voice | Worst incremental mel loss | Largest incremental 1 ms envelope error FS | Worst full-reference mel loss |
| --- | ---: | ---: | ---: |
| CH | 0.001815 | 0.000005294 | 1.268738 |
| OH | 0.001320 | 0.000003667 | 0.833349 |
| CY | 0.014377 | 0.000203552 | 0.818710 |

CY's default long decay is its largest incremental-loss case. Its whole-render
level change is −0.00829 dB. At the worst 1,024-sample spectral frame, around
1.544 seconds, reference/candidate RMS is −41.668/−41.701 dBFS and residual RMS
is −90.110 dBFS. The worst 256-sample frame is near the end of the gate at
−80.35 dBFS reference level. These diagnostics locate the rounding drift; they
do not establish listening acceptance. Worst-ranked WAV pairs are exported by
the lab scorer. The earlier partial/wobble reduction still dominates the
full-reference difference.

CH default ordered tracing reproduces ordinary-host audio, every call's raw
cycle count and final state/guards. Trigger cost is 820 raw clocks. Its sampled
largest render is 15,862 raw clocks, 2,400 modeled interlocks and 320 cold
instruction-word misses. At three clocks per miss the additive estimate is
19,222 clocks/block (600.69/sample), down from 25,057. This is an uncalibrated
screening estimate, not measured X.20 cold-cache timing.

The noise/RNG/filter group alone costs 4,320 raw clocks/block; envelope/gate
work costs up to 2,656, and the output/click/frame group another 2,240. Further
state scheduling and slower envelope updates are candidates for investigation.
The **under-129 target remains unmet**; no final SysEx is emitted.

## Reproduce

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/score_variants.py "build/$kind-p3-static-lut8" "build/$kind-p3-static-lut8-lean" --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-lean-v1/incremental-$kind"
  python tools/score_variants.py "build/$kind-comparison" "build/$kind-p3-static-lut8-lean" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-lean-v1/full-$kind"
}
python tools/profile_trace.py build/ch-p3-static-lut8-lean/default.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-p3-lean-trace
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python -m unittest discover -s tests -p 'test_*.py'
```

Old CH/OH full baseline directories need their matching `--baseline-extra`
boundary directory, as in the earlier scoring report. Fresh full baseline runs
include it. Every scoring output directory must be new.

Metal renders now write `provenance.json` with source, compiler, assembler,
reference executable, ordinary host and local program/table hashes captured
before execution. Inputs are checked again after each case. Script, audio and
host-log hashes are captured with each successful case; incomplete runs are
marked accordingly. The scoring adapter rejects changed local inputs or output
files and embeds this execution-time provenance. Historical baseline renders
remain explicitly identified as lacking that newer record. This records tool
identity; it does not turn the instruction host into a hardware measurement.
