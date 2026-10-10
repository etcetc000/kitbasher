# Keeping output-filter history in registers

The default-off `--resident-output` option builds on the exact register mixer.
It preserves the preceding full-rate candidate's audio, RNG draws and final
state. It requires `--register-mix`; the full reference ports remain unchanged.

R4 and X1 retain the output DC filter's previous input and output. The outer
loop count is captured before those registers are loaded, and the advancing X
scratch pointer supplies the consumed-sample count at the end of the block.
The MDS import refers to the scratch base; adding its size happens at runtime
so the encoded import offset remains inside the resource.

Bell gain no longer occupies X1 throughout the sample loop. Its last value is
reconstructed once per block by subtracting the last integer bell increment
and adding the fixed tone gain. The bell state stays well inside Q23 range.
Parallel moves preserve the output filter's original pre-ALU input and
truncation points. Click advancement overlaps the output write. When the gate
is already interpolated, the mixer reads the current envelope directly from
its interpolation register, avoiding a duplicate per-sample copy; the final
diagnostic envelope slot is still written exactly.

## Evidence

All **123 lifecycle and ending-length cases** across CH/OH/CY preserve native
audio and final state/guard dumps bit-for-bit against the register mixer.
The existing lab's `mel-proxy-v1` reports **zero incremental loss** for all 27
lifecycle pairs. No level, transient, tail or polarity change is introduced.
This does not establish listening acceptance of earlier approximations.

Ten additional option pairs are exact: four- and sixteen-sample envelope
endpoints, per-sample gate, linear saturation, wide DC feedback with retained
noise DC, xorshift noise, half-rate compatibility, tracks 0/15 and an explicit
`0xffffffff` seed. Half-rate compatibility is a regression check; the rejected
half-rate experiment remains unselected.

Another **24 native comparisons** cover four seeds per voice at default and
maximum controls, reusing the saved full-rate native seed fixtures. All are
bit-exact in audio and final state. This qualifies the incremental scheduling
change across those seeds; it does not qualify the reduced model's cumulative
differences from the original 47-partial engine.

Eleven interleaved tracks over 512 blocks, 22 dirty-state reassignments and
tail-control changes match isolated renders with shared scratch poisoned.
Six additional replays relocate scratch to X:`$203` / Y:`$243` and preserve
audio, call cycles and every final dump. Standalone package reproduction,
independent reassembly at two placements and the draft-export rejection pass.
With the option off, **253 retained generated sources** remain unchanged.
The 13 local comparison, profiler and table tests pass. Repository checks pass
with 205 Node tests, 56 Python tests and the site build; 11 firmware-dependent
Node tests remain skipped without supplied OS images.

| Full-rate candidate | CH | OH | CY |
| --- | ---: | ---: | ---: |
| Previous raw maximum/block | 5,180 | 5,176 | 5,176 |
| Resident output raw maximum/block | 4,910 | 4,906 | 4,906 |
| Resident output raw clocks/sample | 153.4375 | 153.3125 | 153.3125 |
| Sampled cold model, clocks/block | 7,023 | 7,016 | 7,016 |
| Sampled cold model, clocks/sample | 219.46875 | 219.250 | 219.250 |

The full-block saving is **270 raw clocks (8.4375/sample)** and **277 modeled
clocks (8.65625/sample)**. CH's largest sampled model is 4,910 raw + 928
modeled interlocks + 395 instruction-word misses times three. The previous
model was 7,300 clocks. Ordinary and ordered-trace hosts agree on audio, every
call-cycle count and final dumps for the three boundary replays. Disassembly
confirms the parallel DC-history captures and output write.

The fourth ordered replay explicitly checks CH's one-sample final block,
block 105 of `end_01`. It **regresses from 559 to 568 raw clocks**, and from
1,745 to 1,778 modeled clocks: the added block setup/flush work outweighs the
per-sample saving for this short suffix. The full-block maximum still falls.

Fetch wait values remain uncalibrated sensitivity inputs. Data waits, dispatch,
DMA and penalty overlap remain unverified. These are sampled models, not
hardware measurements or exhaustive worst-case bounds. **Under 129 remains
unmet.**

Each metal program grows by eight words and 28 package bytes. CH is 2,962
words / 9,724 bytes; OH/CY are 3,089 / 10,120 each. Packages retain zero admitted
cycles and the upstream exporter rejects installable SysEx.
The seven-voice family uses 24,983 program words / 81,084 package bytes; adding
CP gives 37,844 / 121,668. Both still exceed the published library-byte field.

## Reproduce

Use the full-rate flags in [REGISTER-MIXER.md](REGISTER-MIXER.md), adding
`--register-mix --resident-output`. Use explicit output directories such as
`build/resident-output-ch` and `build/resident-output-ch-endings`.

```powershell
python tools/render_metal.py ch @flags --register-mix --resident-output --out build/resident-output-ch --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py build/register-mix-ch build/resident-output-ch --require-bitexact
python tools/score_variants.py build/register-mix-ch build/resident-output-ch --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-output-v1/ch
```

Repeat for OH/CY and the `--end-boundaries` fixtures. Score directories must be
fresh. For interleaved-state checks, add `--metal-register-mix
--metal-resident-output` to the gate audit's `check_state.py` command and use a
fresh `--out`. Trace each `block_boundary.script`; additionally trace CH's
`end_01.script` with `--render-block 105`. Execution-time input/tool hashes,
native audio, draft packages, reports and traces stay in ignored build output.
