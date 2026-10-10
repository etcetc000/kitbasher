# TR6 on Machinedrum X.20: viability audit

Audited 2026-10-09. Scope: a TR-606-style MDS machine family based on Simple606. Working performance target supplied by the user: **under 129 cold-cache clocks per sample**. Priority: **functional ports first, optimization afterward**.

**Verdict: proceed with a staged DSP port.** MDS provides the deployment mechanism; CPU cost is the main uncertainty. A functional implementation is plausible, but this audit does not establish that all source algorithms meet the performance target. Preserve the algorithms for the initial ports and measure before changing their sound. The clap has the strongest evidence of requiring a substantial later optimization or an explicitly accepted approximation.

## Pinned sources

| Repository | Revision | Role |
|---|---|---|
| [jmamma/MDS](https://github.com/jmamma/MDS/tree/c446179d6d73a82b117ee20eb2216af78734a795) | `c446179d6d73a82b117ee20eb2216af78734a795` | Target ABI, packaging, protocol, examples |
| [Fadedlimes/Simple606](https://github.com/Fadedlimes/Simple606/tree/6aacda7a14a8c097d32836039fd356eb0976ba8e) | `6aacda7a14a8c097d32836039fd356eb0976ba8e` | Exact sound reference for this audit |
| [analogcode/606-Inspired-Synth-Drums](https://github.com/analogcode/606-Inspired-Synth-Drums/tree/79e51940e5ea6731684e5992cc9b2bddf67c0f2d) | `79e51940e5ea6731684e5992cc9b2bddf67c0f2d` | Upstream DSP provenance and comparison |

The local `.audit-sources` directories contain those checkouts. BassDrum, Snare, Toms, and SynthDrumCommon match upstream byte-for-byte. HiHats and Clap differ: upstream adds a fast sine path and convolution-loop changes. Do not silently substitute upstream for the pinned Simple606 reference. Both projects carry MIT licenses; retain their notices with derived code. [Simple606 license](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/License.txt).

## Target fit and timing contract

MDS requires DSP56303 assembly with INIT/TRIG/RENDER entry points, producing 32 mono samples at 44.1 kHz. It supports eight synthesis controls, a three-character category, and a two-character machine code. `TR6-BD`, `TR6-SD`, `TR6-LT`, `TR6-HT`, `TR6-CH`, `TR6-OH`, and `TR6-CY` therefore fit its metadata. Local state has 64 X and 64 Y words, with Y0–8 reserved; each track also has 1,536 external words and access to the host sine table. [MDS ABI](https://github.com/jmamma/MDS/blob/c446179d6d73a82b117ee20eb2216af78734a795/docs/MDX_MachineDumpStandard.txt).

The published admission limit is 3,951 clocks per block, including trigger and dispatch costs with slow external program memory. The firmware checks the declaration, not actual execution. Keep this distinct from the user's sub-129 cold-cache benchmark: 129 × 32 = 4,128, whereas 3,951 / 32 = 123.46875. Resolve the accounting difference against the actual target firmware and measurement harness before release; do not replace the user's development target with an assumed equivalent. [Timing contract](https://github.com/jmamma/MDS/blob/c446179d6d73a82b117ee20eb2216af78734a795/docs/MDX_MachineDumpStandard.txt#L123-L142).

The bank has 16 installation slots; the protocol exposes program/library capacity and admission budgets. Seven voices occupy seven slots; optional clap makes eight. Query actual capacity before installation: code size across the family matters independently of track CPU. [MDS protocol](https://github.com/jmamma/MDS/blob/c446179d6d73a82b117ee20eb2216af78734a795/docs/MDX_MachineDumpProtocol.txt).

## Voice-by-voice assessment

These are engineering judgments from source structure, **not measured DSP timings**.

| Voice | Source workload | Functional port outlook | Risk against sub-129 target |
|---|---|---|---|
| BD | Swept sine, three decaying components, one-pole filters, high-pass biquad, saturation, DC removal | Best first port; relatively compact state and signal path | Lowest relative risk; still requires timing |
| SD | Shell and quiet wire-ring oscillators, two bandpasses, filtered noise, shaped attacks/gates; repeated exponential/power evaluation | Feasible with careful envelope and coefficient translation | Medium; transcendental work must become efficient DSP operations |
| LT | Main tone plus harmonics and strike, three noise streams, up to eight biquads; upper resonances disabled in its preset | Feasible, but materially more than a sine tom | Medium–high; filtering and trigger setup are significant |
| HT | Main harmonics, lower ring, strike and four upper modes; six active noise-path biquads | Feasible with explicit state allocation | Medium–high; nine sine evaluations per active sample in the source |
| CH/OH | 47 partials, independent random wobble, two noise filters, envelopes and saturation | Functional port plausible using external state | High; 1,504 partial evaluations per block before the rest of the voice |
| CY | Same 47-partial engine, with Simple606-specific cymbal settings | Reuse the working hat port and preserve its separate settings | High; similar per-sample workload to hats, with longer overlap |
| CP, optional | Four 192-tap color FIRs, shaped bursts/tails and saturation; pitch-dependent reconstruction | Possible as a development/reference port; poor candidate for direct shipping translation | Very high; 768 FIR MAC terms/sample at unity pitch, or 24,576/block, before other work |

Sources: [BassDrum.hpp](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/BassDrum.hpp), [Snare.hpp](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/Snare.hpp), [Toms.hpp](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/Toms.hpp), [HiHats.hpp](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/HiHats.hpp), [cymbal specification](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/PluginProcessor.h#L16-L41), [Clap.hpp](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/Clap.hpp).

At unity pitch the clap bypasses its reconstruction filter. That does **not** remove its four color FIRs. Pitching down invokes the 128-tap reconstruction stage even at the Machinedrum's native 44.1 kHz. The first such render also generates lookahead samples. Its trigger configures coefficient banks and prewarms 192 noise samples. Benchmark those paths explicitly. Straightforward convolution is already far beyond 129 operations/sample; this is workload evidence, not a cycle-accurate lower-bound measurement of every possible reformulation.

Keep CP optional: the upstream author identifies it as RD-6-inspired, whereas the original 606 had no clap. A seven-voice TR6 release is a coherent scope without it. [Upstream description](https://github.com/analogcode/606-Inspired-Synth-Drums/blob/79e51940e5ea6731684e5992cc9b2bddf67c0f2d/README.md).

## Correctness work before optimization

1. **Preserve an audible reference.** Use the pinned Simple606 DSP, including its wrapper's kick transient/decay mapping and cymbal specification. Keep desktop effects out of isolated voice comparisons. Rendering a header's arbitrary defaults is not necessarily rendering the plugin's sound.
2. **Design numerical scaling explicitly.** Allocate phase, frequency, filter coefficients, accumulators and audio their appropriate formats. A blanket float-to-Q23 substitution will fail for coefficients or intermediate values outside ±1. Preserve envelope tails and avoid fixed-point limit cycles. Decide whether PRNG sequences must match exactly or only statistically.
3. **Implement the full signal path first.** Use the host sine lookup, deliberate envelope translations, and explicit persistent state. Do not reduce partials or replace filters in the first correctness baseline. A necessary numerical approximation must be documented and compared with the source.
4. **Keep each port independently testable.** Separate machine entry points from reusable oscillator/filter/noise assembly. Prefer one voice per track; avoid embedding the desktop sequencer, mixer and effects rack into one machine.
5. **Specify control behavior.** Simple606 captures most synthesis settings at trigger time. Preserve this initially; then explicitly choose which controls should affect a running tail. Keep a stable parameter order so later optimization does not break saved kits.
6. **Handle hats and accent deliberately.** Simple606 closes the open hat in its host wrapper, and accent changes kick/snare timbre as well as gain. Independent MDS tracks do not inherit those C++ interactions. Validate native firmware trigger/mute routing or offer a single selectable CH/OH machine for natural same-track retriggering. Do not invent cross-track state writes. Exact accent equivalence needs a defined parameter/host mapping.

The wrapper behaviors are visible in [fireVoice](https://github.com/Fadedlimes/Simple606/blob/6aacda7a14a8c097d32836039fd356eb0976ba8e/Source/PluginProcessor.cpp#L284-L316).

## Measured reference baseline

Compiled the pinned DSP headers with Clang 22.1.8, C++14, `-O2`, without JUCE. The harness ran **144 cases**: eight voices × three decays × three pitch ratios × single-hit/retrigger modes. Each rendered three seconds at 44.1 kHz; retriggers occurred every 100 ms. Every case produced non-silent finite output. All eight baseline single hits were inactive by the end of the render.

| Voice | Largest absolute sample across the tested cases |
|---|---:|
| BD | 0.578315 |
| SD | 0.975047 |
| LT | 1.106680 |
| HT | 1.037602 |
| CH | 1.301461 |
| OH | 1.230925 |
| CY | 1.557140 |
| CP | 0.528781 |

The over-unity peaks make gain staging a correctness requirement. These are pre-mixer, unaccented results, not comprehensive worst-case bounds. The harness does not cover every knob, kick XL/heat, all accent settings, cross-voice choking, modulation, or all seeds. WAVs use floating-point samples so they preserve these peaks without clipping. No listening comparison or perceptual equivalence claim is made.

Files: [harness](reference_render.cpp), [runner](run-reference.ps1), `results/reference-metrics.csv` (generated), and eight WAVs under `results/`.

Run in an existing background command process:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File audit/run-reference.ps1
```

This changes no persistent execution-policy setting. Requires the pinned checkout at `.audit-sources/Simple606` and `clang++` on PATH. Desktop render success demonstrates source separability and supplies a comparison baseline; **it provides no Machinedrum CPU measurement**.

## Port and timing milestones

**First milestone:** BD, followed by SD, LT/HT, then full CH/OH/CY; CP last if included. For each, produce a working simulator render and compare pitch trajectory, envelope, attack, spectrum and peak level with the reference. Keep development packages explicitly unqualified until their timings are known.

**Second milestone:** establish a reproducible cold-cache DSP56303 harness. Record simulator/version, target firmware, cache initialization, external-memory wait states, code placement, clock-counter meaning, parameter values and seed. Measure trigger-plus-first-render, later active blocks, silence, parameter changes, and retriggers. Report both whole-block maximum clocks and normalized clocks/sample. Do not flush the cache every sample and call that the same test as a cold entry into a block. Include dispatch separately when it is outside the measured region. The public repository references a simulator but supplies neither that harness nor a numeric dispatch-overhead constant; these remain implementation inputs to obtain/verify.

**Third milestone:** optimize measured bottlenecks while comparing against the working ports. First pursue loop/register scheduling, memory placement, fixed-rate constant folding, coefficient caching, and removal of provably inaudible work. Keep partial reduction, FIR-to-IIR substitution, and other changes in synthesis topology as separately evaluated options. Preserve pitch-dependent anti-alias behavior and retrigger semantics.

**Release gate:** every shipped machine satisfies the agreed cold-cache target and the target firmware's actual admission contract; family code/storage fits; package relocation/metadata validates; hardware passes dense retrigger, long-tail, parameter-lock and multi-track stress tests. A typical seven-drum pattern is not enough: stress repeated instances of the most expensive installed machine too.

## What is and is not established

- Established: source provenance, integration mechanism, full voice inventory, major CPU hazards, a reproducible desktop reference, and valid parsing of all ten supplied MDS example packages.
- First assembly milestone: a full-path BD prototype now renders on the instruction host and passes five stated numerical/state comparisons. See [kick port evidence](BD-PORT.md). Its current CPU cost exceeds the target before cache costs.
- Not established: the remaining voice ports, cold-cache DSP cycle counts, hardware sound quality, shared program-memory fit of completed ports, or installation compatibility with a particular device/firmware build.
- Draft BD and sine-test `.mds` packages are generated in ignored build directories with zero cycle declarations. No `.syx` was generated and no hardware was modified. An existing external assembler and instruction host are now used; they are not bundled. The supplied MDS example cycle declarations were inspected, not independently benchmarked.

Recommendation: **green-light the functional-port milestone, with no promise yet that the full 47-partial metal engine or clap will ship unchanged under 129.** Revisit feasibility using measured cold-cache results from the first working assembly versions.
