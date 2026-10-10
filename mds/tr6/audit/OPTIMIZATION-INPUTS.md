# Inputs to the later TR6 optimization pass

2026-10-09. Functional Simple606 ports remain the first priority. The material
below informs measurement and implementation choices; it does not replace the
source signal paths or establish that TR6 can meet **under 129 cold-cache clocks
per sample**. BD and SD are still well above that target.

## X.20 TX8/TX9 packages

The owner supplied the local `md-x15-private/bases/x20/USR-Machines/` directory
(uncommitted inputs for that repository's PR #28 at inspection time). These are
**TX8/TX9**, rather than TR8/TR9, and are compiled MDS SysEx packages, not assembly
source. All **43** packages across TX8, TX9, TXZ, SYN, P-I and NFX passed the pinned
public MDS package parser and byte-exact reconstruction with `mds_to_syx.convert`.
This validates packaging, checksums and metadata, not audio or timing.

Selected metadata read from the packages:

| Machine | Program words, including data | X/Y workset words | Declared maximum track cycles |
| --- | ---: | ---: | ---: |
| TX8-BD | 385 | 21/20 | 1,738 |
| TX9-BD | 1,428 | 64/22 | 2,720 |
| TX8-SD | 1,590 | 64/64 | 3,398 |
| TX9-SD | 1,337 | 40/48 | 1,542 |
| TX8-XT | 1,133 | 50/28 | 3,616 |
| TX9-XT | 1,121 | 56/64 | 2,667 |
| TX8-HH | 2,831 | 64/47 | 3,865 |
| TX8-CY | 1,907 | 64/64 | 3,437 |
| TX8-CP | 1,694 | 29/39 | 3,633 |
| TX9-CP | 1,648 | 22/35 | 3,501 |

These are **author-declared budgets**, not measurements made in this audit. The
program sizes are not instruction-cache footprints. In particular, the low
TX9-SD declaration does not predict the cost of Simple606's different shell,
wire, ring, RNG and envelope paths.

Read-only disassembly of TX8-BD, TX9-BD, TX9-SD, TX8-HH and TX8-CY showed useful
implementation patterns:

- **Parallel arithmetic and data movement.** TX9-SD's filter loop and TX8-HH's
  sample loop repeatedly combine MAC operations with coefficient/state fetches
  from both X and Y. TR6's initial scalar translations leave these issue slots
  unused. Rearranging state between the two memory spaces is a major candidate.
- **Wide state stored as X/Y pairs.** TX8-BD's recurrence loop and TX9-SD's
  envelope path use long-word state loads/stores. This suggests an efficient
  representation for TR6's explicit envelope remainders, subject to checking
  exact accumulator scaling, rounding and saturation.
- **Separate control and sample work.** TX9-SD performs some envelope/control
  work around 16-sample loops. TX8-CY has a toggled control-update path. These are
  evidence of deliberate rate separation in those designs. Applying the same
  rate reduction to Simple606's pitch bends or attacks would change the DSP and
  needs a separately evaluated approximation; it is not a free scheduling win.
- **Block scratch imports.** TX8-HH and TX8-CY import the MDS temporary X/Y
  buffers. These can support staged passes without enlarging persistent track
  state. Their shared lifetime forbids carrying state between calls.
- **Different oscillator designs.** TX8-BD's hot loop uses coupled recurrences
  rather than importing the large sine table. This is an alternative synthesis
  design, not evidence that a replacement will preserve Simple606's bent sine.

No private program, SysEx, disassembly, coefficients or tables were copied into
Kitbasher. Inspection used temporary files outside it, removed on completion.
SHA-256 provenance for the principal inspected SysEx files:

```text
TX8-BD b825b02d11956e069e85605d14b4a1a54f186b1bd9ac108c5d3eb34f93dd1bda
TX9-BD fc1859fdf2073a372d3cd0d6baf1f8a3b81eb4f7e10ae5f537787b7564c75584
TX9-SD c14b0d740063e56a65b4f45d93d163dd4453d098492b7038ee5da41d4da8d23e
TX8-HH 1314c37d6a7671833e45b307859d8716c291b2907db1020f46d84e7db5b6552a
TX8-CY cbc618881841bc30143aa41b01b86584782f31ab5e2fa5f435059eb8b834665d
```

## Existing optimization findings

Read from local `md-firmware-mod` at
`a82a0f58f40c319e16f46544e8cb18767975e5b4`, including its current
`lab/optimization-lab` directory. Historical lab timings use their own metric
and firmware assumptions; they are not X.20/TR6 results.

| Local source | Applicable lesson |
| --- | --- |
| `docs/OPTIMIZATION.md`, `tools/interlock_audit/interlock.py` | Use executed instruction order; account for arithmetic-result and AGU setup hazards. Histogram totals miss ordering. |
| `docs/COMPACT.md`, `docs/OPT121-DECISIONS.md` | Separate hot render code from init/control code; keep relocation operands valid when shortening instructions. Short immediates can change values. |
| `lab/optimization-lab/notes/mtlbl-pipeline-round21.md` | Pipeline phase updates and delayed sine fetches while retaining precision; use legal parallel moves and check bit-exact output. |
| `notes/stusd-filter-round9.md` under the same lab | Filter algebra can remove operations, but equivalent real-number transfer functions can round differently in fixed point. |
| `notes/909-controls-round54.md`, `notes/909-smooth-round55.md` | Reuse control indices/curves. Reject limiter approximations that erase quiet tails; include moving controls and expanded decay cases. |
| `notes/sdv-polyphase-round32.md` | Arithmetic savings can lose to cache growth; held or reduced-rate noise requires a sound comparison. |
| `notes/ndmod-recurrence-round16.md` | Halving coefficients can discard an important bit and alter pitch/decay. Early culling can worsen the worst path despite being bit-exact. |
| `notes/brksd-transfer-round34.md` | Forward retained words, but use distinct run directories and check mixed-track state. Shared scratch filenames previously contaminated results. |

For TR6, prioritize exact scheduling, retained values, X/Y layout and compact
hot loops after all voices work. Treat oscillator replacement, filter-form
changes, smaller nonlinear tables and reduced update rates as separate numerical
experiments. Preserve the current reference comparisons and random streams.

## Ordered-trace baseline

`tools/profile_trace.py` replays an existing render script in fresh ordinary and
ordered-trace hosts. Audio bytes, every call's raw cycle count, and final state
dumps must agree. It disassembles the actual relocated program, rejects unknown
executed PCs, and hashes the input images/scripts and external tools.

It samples init, the first two triggers, the first three render blocks, raw-cycle
minimum/maximum render blocks, and the final render block. This is diagnostic
sampling, **not an exhaustive worst-case control or placement sweep**.

The cache model starts empty for each selected call: eight LRU sectors of 128
words, with individual instruction words filled on misses. The lab interlock
analyzer runs on the exact trace. The report retains raw cycles, modeled stalls,
and fetch misses separately, plus additive sensitivities at 1, 2 and 3 clocks
per miss. Those wait-state choices are not X.20 calibration. Additive overlap,
data-memory waits (including table reads), firmware dispatch and DMA freezes are
unverified or omitted. The host's internal JSR stub is included. Trigger and
render are separate calls; the sum is not a measured firmware dispatch path.

Example, after `render_sd.py` has produced its input artifacts:

```powershell
python tools/profile_trace.py build/sd-comparison/default.script `
  --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST `
  --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER `
  --out build/profile-sd-default
python -m unittest discover -s tests -p test_profile_trace.py
```

The external paths refer to the lab's `dsphost-hist/Release/dsphost.exe`,
`tools/build/dsphost-trace.exe`, `tools/bin/dsp56303Disassemble.exe`, and
`tools/interlock_audit/interlock.py`. The public host build recipe remains open.

Six complete replays passed audio, raw-cycle and final-state agreement: BD
default/maximum and SD default/minimum/maximum/retrigger. Four cache boundary/LRU
tests passed. At program base `$110023`, the largest sampled render costs were:

| Case | Render block (zero-based) | Raw cycles/block | Modeled interlock clocks | Cold instruction-word misses | Additive estimate at 3 clocks/miss, clocks/sample |
| --- | ---: | ---: | ---: | ---: | ---: |
| BD default | 1,845 | 14,105 | 2,149 | 337 | 539.53 |
| BD maximum XL/heat | 12,709 | 15,333 | 2,405 | 365 | 588.53 |
| SD default/maximum/retrigger | 0 | 17,171 | 2,368 | 356 | 643.97 |
| SD minimum | 0 | 18,099 | 2,400 | 376 | 675.84 |

The last column is a screening estimate, not a hardware measurement or certified
upper bound. Raw-cycle maxima alone already require approximately **3.7x (BD)**
and **4.4x (SD)** improvement to reach 129. Cache tuning alone cannot close that
gap. Repeated immediate AGU setup/use around sine fetches contributes 96 modeled
stall clocks per 32-sample loop site; scheduling independent work into that gap
is a concrete candidate. Arithmetic and accumulator-transfer hazards contribute
many more stalls. Keep the complete signal paths as baselines while reducing
loads, stores, shifts and dependency chains.

External measurement-tool SHA-256 identities:

```text
ordinary host f615bfd80a90e51e7840fad00804ac9593822374f44d79d58ab11c5a90b9098f
ordered host  a5f9e301eeb149db77a5d024a8ba8a3c300f7c911c76afef0941f482b61345a0
disassembler c0fc002da5aa1c330f178a434986c57ce2e81348be5901b642bcd01fe48623f9
interlock.py be5a58a3ec866a590edbc486415e2faac463cc040e106d4eee37ce7401cc4d8b
```
## Accepted optimization tradeoff

On 2026-10-10 the user explicitly accepted perceptual drift to reach the CPU
target. The complete source-path ports remain the comparison baseline. The next
phase may evaluate reduced partial counts, simpler wobble/noise generation,
shorter or replacement clap filters, smaller tables and other synthesis changes;
it does not need to preserve sample-level agreement with that baseline.

For each candidate, record its signal-path changes, control/seed coverage,
program and state sizes, trigger/first/later render costs, and A/B render files.
Check tuning, attack, decay, level, spectral shape, silence and retrigger behavior.
Numerical and spectral metrics support comparison but do not establish listening
equivalence. Retain candidates that trade sound and cost differently when the
preference needs listening. The under-129 cold-cache target, firmware admission
contract and complete-family storage requirements remain unchanged.

## External-memory voice traces

The profiler now accepts additional nonoverlapping P images for INIT fixtures
that supply R1's track index. Every image is hashed and disassembled; the fixture
instructions are included in the cost. It also samples the largest observed
later render separately from the first render after a trigger.

CH default, CP below-unity tuning (TUNE=63), and compact-table CH default replay
bit-exactly against the ordinary host for audio, every call's raw cycles and
final state/guards. At program base `$110023`, selected results are:

| Call | Raw clocks | Modeled interlocks | Cold instruction-word misses | Additive clocks at 3/miss |
| --- | ---: | ---: | ---: | ---: |
| CH default trigger | 8,700 | 783 | 261 | 10,266 |
| CH default render block 151 | 245,430 | 30,784 | 454 | 277,576 |
| CP below-unity trigger | 223,797 | 24,050 | 443 | 249,176 |
| CP below-unity first render | 1,331,140 | 105,944 | 26,587 | 1,516,845 |
| CP below-unity later render block 76 | 698,932 | 60,801 | 28,480 | 845,173 |

The compact CH replay has identical raw/interlock/fetch counts to full-table CH.
The model limitations above apply, especially omitted table/data waits and
uncalibrated wait-state assumptions. These are sampled paths, not certified
worst-case cold-cache timings. CP's first render spends 839,040 raw clocks in the
FIR-index loop group alone; reducing filter/reconstruction work is necessary.

```powershell
python tools/profile_trace.py build/ch-comparison/default.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-trace
python tools/profile_trace.py build/cp-comparison/below_unity.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/cp-trace
python tools/profile_trace.py build/ch-lut8/default.script --host $env:MD_DSP_HOST --trace-host $env:MD_DSP_TRACE_HOST --disassembler $env:MD_DSP_DISASSEMBLER --interlocks $env:MD_INTERLOCK_ANALYZER --out build/ch-lut8-trace
```
