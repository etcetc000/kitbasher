# Half-rate experiment: do not select as the working candidate

Running the metal synthesis at 22,050 Hz and repeating each output sample saves
CPU, but materially changes the upper tuning range and still misses the cold
target. The full-rate [gated-envelope candidate](GATED-ENVELOPES.md) remains the
working version. The half-rate option stays default-off so this result can be
reproduced rather than rediscovered.

`--render-stride 2` runs 16 synthesis steps per 32-sample MDS call. The pinned
C++ source generates coefficients at 22,050 Hz; native oscillator increments,
resonator coefficients, filters, decay and duration tables use that rate. Each
output is written twice, with no interpolation or normalization. Four internal
samples per envelope endpoint preserve the preceding candidate's eight-output-
sample cadence. The option requires bounded loops. This is a synthesis change,
not an exact scheduling optimization.

Render fixtures continue to use the original 44.1 kHz controls, trigger times
and output lengths, enabling matched native comparisons. Native state counts
internal steps. Across all 128 integer decay settings, physical durations differ
from the full-rate source by at most one output sample. The 32 ending fixtures
cover every internal final-block length 1–16 for each voice.

## CPU and functional evidence

The experiment passes 123 lifecycle/ending numerical comparisons. Largest
native/C++ peak errors before output trim are CH 0.00014861, OH 0.00048352 and
CY 0.00078217, within the existing 0.003 bound. It also passes 11 interleaved
tracks over 512 blocks, 22 dirty reassignments, tail-control changes and scratch
poisoning. A standalone CH build reproduces the tested package.

| Voice | Raw maximum per block | Raw per output sample | Sampled cold model at 3 clocks/miss |
| --- | ---: | ---: | ---: |
| CH | 3,146 | 98.3125 | 4,929 / 32 = 154.03125 |
| OH/CY | 3,142 | 98.1875 | 4,922 / 32 = 153.8125 |

CH's model includes 607 interlock clocks and 392 cold instruction-word misses.
Four ordered replays reproduce ordinary audio, every call cycle count and final
dumps, including a one-internal-step/two-output-sample tail. These uncalibrated
models omit data waits, dispatch, DMA and overlap; they are not hardware bounds.
The under-129 target remains unmet even before considering the sound tradeoff.

## Perceptual evidence

The existing `mel-proxy-v1` scorer evaluates 123 matched native pairs against
the working full-rate candidate. Worst lifecycle losses are **CH 17.1316,
OH 17.7823, CY 10.2814**. CH maximum and OH maximum/short-high-pitch have
negative-waveform-correlation flags. Separate level diagnostics show roughly
11–12 dB losses in those hat cases. Those are not level-change flags.

At maximum tuning, all three selected partials exceed 10,584 Hz, the source's
0.48 × 22,050 Hz muting threshold. They remain below its full-rate threshold.
The filter cutoffs and sample-repetition spectrum also change. This accounts
for a material pitch/timbre change; it cannot be treated as small rounding drift.

To distinguish these changes from ordinary random variation, the experiment
also renders **72 native streams**: three voices × default/maximum settings ×
(four reference seeds + four disjoint reference seeds + four candidate seeds).
The candidate uses the first reference group's seeds. All streams pass their
own independent C++ comparison; the largest error is 0.00185212.

`score_native_ensemble.py` invokes the existing external `tools/wmd_stats.py`
scorer on native Q23 output, retaining actual gain. It does not copy or invent a
new loss function. Its ensemble distance is distinct from paired `mel-proxy-v1`:

| Voice / setting | Reference split loss | Half-rate loss | Level change |
| --- | ---: | ---: | ---: |
| CH default | 1.0327 | 2.8282 | +0.75 dB |
| CH maximum | 0.9116 | 16.3043 | −11.79 dB |
| OH default | 1.0441 | 3.6933 | −1.18 dB |
| OH maximum | 0.9641 | 17.5496 | −11.10 dB |
| CY default | 1.0785 | 2.7944 | +0.12 dB |
| CY maximum | 1.0208 | 9.5524 | −5.93 dB |

At maximum tuning, candidate loss is 17.9/18.2/9.4 times the reference split
loss. The difference persists across seeds. No universal acceptance threshold
or listening verdict is inferred, but this is a poor tradeoff for the next
working candidate. More aggressive approximations are not justified merely by
the lower raw cycle count.

## Native seed support and retained references

`--seed` accepts an explicit uint32 seed for native and C++ rendering. A zero
top-level seed uses the source voice's 0x606606 fallback. When a phase, wobble or
xorshift-noise seed becomes zero after XOR with its salt, native initialization
now matches `Random::seed`'s 0x12345678 fallback. The independent LCG model
deliberately permits its own zero state. Six extra native cases verify zero,
0xffffffff, phase/wobble zero states and both noise-generator zero states.

The ensemble adapter requires complete execution-time provenance, matched
controls/gain/triggers/output lengths, distinct seeds within groups, disjoint
reference groups and candidate seeds paired with the first group. It verifies
raw hashes and records scorer/adapter hashes. Negative checks reject overlapping
and unpaired groups. Four seeds per group are diagnostic evidence, not exhaustive
seed qualification or hardware evidence.

All 141 retained pre-experiment generated sources remain unchanged. The extended
C++ renderer preserves 123 saved full-rate streams byte-for-byte; explicit
default seeds reproduce native working-candidate audio and final state exactly
in the three default cases.
Short hashed default directory names avoid excessive Windows path lengths for
stride/seed experiments; `--out` gives runs a readable name.

## Reproduce

Use the flags from `GATED-ENVELOPES.md`, replacing `--envelope-rate 8` with
`--envelope-rate 4` and adding `--render-stride 2 --out build/half-cubic-ch` for
CH; repeat for OH/CY. Add `--end-boundaries` with a separate output directory.
Score against the full-rate directories using `--allow-model-change`.

For native ensembles, render default and maximum for each voice with explicit
seeds `(base + i * 2654435769) mod 2^32`, i=0..7, where base is 0x606606/7/8
for CH/OH/CY. The full-rate reference uses seeds 0..7 and envelope stride 8;
the half-rate candidate uses seeds 0..3 and envelope stride 4. Keep each render
in a separate directory. For one case:

```powershell
python tools/score_native_ensemble.py --case default --reference build/ref0 build/ref1 build/ref2 build/ref3 --split build/ref4 build/ref5 build/ref6 build/ref7 --candidate build/half0 build/half1 build/half2 build/half3 --scorer $env:MD_WMD_SCORER --out build/native-ensemble-score
```

Use a fresh scoring directory. Set `MD_WMD_SCORER` to the existing
`md-firmware-mod/tools/wmd_stats.py`. The scored native files, execution-time
hashes, draft packages, local A/B pages and traces remain ignored. No installable
SysEx or hardware qualification is produced by this experiment.
