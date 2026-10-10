# Kick tail oscillator and RNG elision

`--tail-elision` is a default-off option requiring bounded activity and scheduled
mixing. Once both body and click envelopes are zero, the sample loop keeps the
filter, output curve, silence counter and shutdown decisions, but omits the
inaudible oscillator and per-sample noise calculations. The synthesis model and
independent C++ reference remain unchanged.

The oscillator's two coordinates (`lastbody`, `z1`) may differ only after both
envelopes reach zero. Envelopes cannot grow again before TRIG, which resets both
coordinates and their coefficient. Other state, including RNG, filter history,
pitch, lifetime and guards, must remain identical. This is an audio/live-state
equivalence claim, not an all-persistent-state equality claim.

## RNG and state contract

The LCG advances once after the block using its exact affine composition modulo
2^24: `s[n] = A[n] * s[0] + B[n]`. A 66-word table holds coefficient pairs for
0 through 32 draws. If the voice stops during the block, `33 - LC` gives the
number of samples that actually consumed noise, including the stopping sample.
An inactive entry consumes none. Retaining this sequence matters on retrigger,
even though the skipped noise was multiplied by zero during the tail.

The dead oscillator register temporarily holds the draw count. Its memory
value is restored before the resident state is flushed. The coefficient still
updates through the existing block pitch path. No persistent slots are added,
and shared scratch is not used.

`check_bd_tail_elision.py` compares matching complete renders and exercises
408 synthetic fixtures per candidate. These cover all 32 shutdown positions,
six seeds across the signed 24-bit boundary, HEAT zero/127, already inactive
entries and sustained filter tails. It checks audio and state after each of
two tail blocks, immediately after retrigger, and after two further blocks.
An independent integer recurrence checks the expected RNG draw count. Only
the two dead coordinates may differ before retrigger; all state must match
afterward. The ordinary `compare_variants.py --require-bitexact` contract is
unchanged.

## CPU and storage

| Candidate | Previous cold model, clocks/sample | Tail-elided cold model, clocks/sample | Maximum raw clocks/block | Program words | Package bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rounded DC, quadratic base/heat | 178.90625 | 171.90625 | 4,093 | 2,041 | 6,772 |
| Rounded DC, linear base/quadratic heat | 171.43750 | 164.43750 | 3,933 | 2,031 | 6,744 |
| Rounded DC, linear base/tanh heat | 186.25000 | 181.34375 | 4,407 | 2,293 | 7,560 |

The largest sampled cold blocks now occur in the active-body loop: 5,501,
5,262 and 5,803 modeled clocks respectively. The final active tail at block
7,365 no longer determines the maximum. Twenty-one ordered replays include
minimum/maximum settings, corners 8/14/18/29/30, saved historical maximum
blocks 179/6,813/7,365/11,244/12,709 and ending calls. Ordinary and tracing
hosts agree on audio, cycles and final state. The option adds 71 program
words and 220/224/220 package bytes respectively; local state stays at 43 words.

These are uncalibrated additive instruction-host/interlock/instruction-fetch
models, excluding data waits, dispatch, DMA and overlap. All three remain
above 129 and do not establish the separate 3,951-clock admission requirement.
No hardware timing or listening acceptance is claimed. Packages still declare
zero admitted cycles and cannot export installable SysEx.

With current metals and compact toms, the seven-voice family uses 23,027
program words / 74,936 package bytes for rounded quadratic; 23,017 / 74,908
for linear/quadratic HEAT; or 23,279 / 75,724 for linear/tanh HEAT. Including
CP gives 35,888 / 115,520, 35,878 / 115,492 and 36,140 / 116,308. The library
byte field remains exceeded; actual device capacity has not been queried.

## Verification

All 163 checked render pairs have identical native Q23 audio and live state:
21 primary/changing-heat/idle-retrigger cases, 96 complete-tail binary control
corners, 36 native seed renders at default/maximum/the worst-loss XL corner,
and ten primary cases using the earlier unrounded quadratic/tanh paths. The
13 inherited numerical failures remain failures with unchanged bounds and
explicit provenance. They are not promoted into qualified native ensembles.

The 408-fixture probe passes for all three current candidates and both earlier
unrounded paths (2,040 fixtures total). All RNG counts match; every post-trigger
state snapshot is exact. Deliberately changing `33 - LC` to `32 - LC` is
rejected for changing RNG state even though the default audio remains identical.
This negative fixture is retained as rejected evidence, not a usable package.

Each current candidate passes 11-track isolation, 22 dirty-state reassignments,
poisoned shared scratch, all 60 rounded-feedback release probes, independent
unaligned relocation, byte-exact standalone package reproduction and the draft
export gate. All 432 preceding generator configurations plus 48 output/seed
configurations remain text-identical with the flag off; default BD source and
the C++ reference are unchanged. Invalid generator and CLI options reject.
Sixteen local TR6 unit tests pass, including checks that the dead-coordinate
exception rejects live-envelope, RNG, filter, lifetime and truncated-state drift.
The repository gate passes with native exit code zero: 205 Node tests,
56 Python tests and the site build; 11 firmware-image-dependent tests are skipped.

## Perceptual qualification

This option introduces no new audible approximation in the checked renders.
Identical native Q23 audio retains the corresponding lab perceptual scores
and native seed-ensemble results in [BD-OUTPUT.md](BD-OUTPUT.md). It does not
resolve that audit's cumulative spectral/level changes, numerical failures or
outstanding listening review. RMS is not used to approve a fidelity tradeoff.

## Reproduce

From `mds/tr6`, using fresh output directories:

```powershell
python tools/render_bd.py --tanh-bits 8 --resident-state --lcg-noise --control-rate 32 --omit-impulse --recursive-body --lean-mix --quadratic-saturation --bounded-activity --scheduled-mix --rounded-dc --linear-base --tail-elision --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --out build/bd-tail-linear
python tools/check_bd_tail_elision.py --baseline build/bd-output-final-linear --candidate build/bd-tail-linear --host $env:MD_DSP_HOST --out build/bd-tail-probe
```

Omit `--linear-base` for quadratic base/heat; replace `--quadratic-saturation`
with `--sequential-tanh` for linear base/tanh heat. State-isolation checks
accept equivalent `--bd-` flags. Ignored `build/bd-tail-*` directories retain
native audio, scripts, trace results, package images and input/output hashes.
Automatic approval review blocked removal of the duplicate `bd-tail-pilot`
and `bd-tail-probe-linear` directories; they remain ignored alongside the
retained verification evidence.
