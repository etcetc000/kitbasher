# Recursive oscillators and cheaper noise

Two independent, default-off switches extend the three-partial lean candidate:

- `--resonators` replaces each per-sample sine lookup and phase increment with
  `y[n] = 2 cos(w) y[n-1] - y[n-2]`, rounded to Q21. Trigger initializes the two
  preceding samples from the imported sine table and the original random phase.
  Three 128-entry coefficient tables cover the integer pitch settings. Existing
  external record slots hold the two samples and coefficient; allocation stays
  at 58 local and 24 external words.
- `--lcg-noise` replaces only the noise xorshift with a 24-bit LCG,
  `s = (1664525 s + 1013904223) mod 2^24`. The original phase RNG remains intact.
  The C++ comparison model feeds the same LCG values through the existing source
  noise DC blocker, both biquads and downstream synthesis. It checks the inverse
  xorshift used to inject each value. Native comparisons check the final LCG
  state exactly; this is a changed random realization, not source equivalence.

Both require `--partial-count 3 --no-wobble --lean-math`. They preserve filters,
envelopes, saturation, bell accent, click and exact stop frames. Full/default and
previous lean assembly remain byte-exact with the switches off. All 27 retained
lean C++ streams also remain byte-exact after extending the reference interface.

## Results

Each switch alone and both together pass all nine complete lifecycle/control
cases for CH/OH/CY: **81 native comparisons**. The unchanged pre-trim numerical
limit is 0.003 against the corresponding C++ model. The largest observed error
is 0.001230. Local/external/output guards, parameters, RNG, frame/activity,
pretrigger/idle silence and saturation-range checks pass.

| Candidate | CH raw clocks/block | OH/CY raw clocks/block | CH program words | CH package bytes |
| --- | ---: | ---: | ---: | ---: |
| Previous lean | 15,869 | 15,837 | 2,787 | 9,108 |
| Recursive oscillators | 14,909 | 14,877 | 3,268 | 10,628 |
| LCG noise | 14,717 | 14,685 | 2,752 | 8,992 |
| Both | 13,757 | 13,725 | 3,233 | 10,520 |

Both save 2,112 raw clocks/block, or **66 clocks/sample**, versus lean. Their
maxima are **429.91 CH / 428.91 OH/CY clocks/sample**. Under 129 remains unmet
before cache, interlock, data-memory and dispatch costs. Oscillator initialization
and coefficient tables increase storage: combined OH/CY use 3,232 program words
and 10,512 package bytes each. With compact BD, the combined seven-voice family
uses 26,820 program words / 86,664 bytes; adding CP gives 39,681 / 127,248.
These are exploratory candidates, not a qualified kit or a storage-fit solution.

The combined candidate also passes 11 interleaved tracks over 512 blocks each,
22 dirty-state reassignments and tail-control changes, bit-exact against isolated
native renders. The other voices retain their reference implementations.
CH default ordered tracing matches ordinary-host audio, all cycle counts and
final dumps. Its sampled largest render is 13,750 raw clocks, 1,728 modeled
interlocks and 279 cold instruction-word misses. The additive three-clock-miss
estimate is 16,315/block (**509.84/sample**), versus lean's 19,222. Trigger rises
from 820 to 982 raw clocks. These are sampled, uncalibrated screening estimates,
not exhaustive worst-case or hardware timing. Nine local analysis tests pass.

The existing lab `mel-proxy-v1` scores all 81 incremental native pairs against
the preceding lean candidate. There is no level normalization or alignment and
no categorical flags. Lower loss means closer; no audibility cutoff is inferred.

| Voice | Recursive-only worst loss | LCG-only worst loss | Combined worst loss |
| --- | ---: | ---: | ---: |
| CH | 0.001340 | 3.232704 | 3.232682 |
| OH | 0.001326 | 2.540595 | 2.540655 |
| CY | 0.001628 | 2.641829 | 2.641732 |

Recursive-only maximum 1 ms envelope errors are 0.00001121, 0.00003587 and
0.00012336 FS respectively. Combined errors reach 0.074985, 0.094320 and
0.105012 FS. The LCG changes individual noise transients substantially; the
paired scores cannot distinguish an undesirable timbre change from a different
valid noise realization. Worst-ranked listening pairs are exported locally.

A further 27 native comparisons score the combined candidate against the full
47-partial reference: worst loss is CH 3.180529, OH 2.607685, CY 2.717307, with no
categorical flags. The complete experiment therefore includes **108 scored
native pairs**. This cumulative comparison retains the source-model difference;
the incremental comparison above isolates the latest changes.

## Multi-seed noise probe

The existing external `wmd_stats.py` ensemble scorer evaluates **240 C++ model
renders**: per setting, 16 original seeds, 16 three-partial xorshift seeds and
eight three-partial LCG seeds. The first two ensembles each split into disjoint
groups of eight. This covers default/maximum settings for all three voices.
Original split distances reproduce the preceding experiment. The LCG probe
compares against both original and reduced models.

| Voice/case | Reduced xorshift split loss | Reduced xorshift to LCG loss | Full original to LCG loss |
| --- | ---: | ---: | ---: |
| CH default | 0.728315 | 0.735636 | 0.742009 |
| CH maximum | 0.686226 | 0.675994 | 0.717399 |
| OH default | 0.738496 | 0.739884 | 0.757957 |
| OH maximum | 0.690885 | 0.689359 | 0.705557 |
| CY default | 0.759785 | 0.777432 | 0.796168 |
| CY maximum | 0.716594 | 0.725503 | 0.741009 |

Noise-change distances are near the reduced model's seed-to-seed distances in
these ensembles. Relative level changes range from -0.16951 to +0.13444 dB;
body-envelope errors are 0.3070–0.5680 dB. This supports retaining LCG as an
optimization candidate. It does not establish perceptual equivalence: phase
seeds are shared for the candidate comparison, ensemble averages hide individual
transients, and these are C++ models, not native multi-seed qualification.
The ensemble and paired scorer scales must not be compared directly.

## Reproduce

From `mds/tr6`, use a fresh scoring/ensemble output directory:

```powershell
foreach ($kind in @('ch','oh','cy')) {
  python tools/render_metal.py $kind --partial-count 3 --no-wobble --tanh-bits 8 --lean-math --resonators --lcg-noise --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
  python tools/score_variants.py "build/$kind-p3-static-lut8-lean" "build/$kind-p3-static-lut8-lean-resonators-lcg" --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out "build/perceptual-recursive-v1/resonators-lcg-$kind"
}
python tools/score_metal_ensemble.py --lcg-noise --scorer $env:MD_WMD_STATS --out build/metal-ensemble-lcg-v1
python tools/check_state.py --metal-partial-count 3 --metal-no-wobble --metal-tanh-bits 8 --metal-lean-math --metal-resonators --metal-lcg-noise --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

Omit one experimental switch to reproduce its isolated result. Render-time
source/tool/image provenance is captured and validated by the paired adapter.
Ensemble reports include source, executable, scorer and audio hashes, seed lists
and final states. All generated outputs remain ignored; no private bank program,
table or binary is included. No installable SysEx or hardware result is claimed.
