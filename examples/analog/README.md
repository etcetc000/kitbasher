# Analog recreations

Seven `md-model/1` sources for analog-style drum and synth voices. The DSP code is
original, the coefficient tables are generated mathematically, and parameter
ranges and defaults follow documented analog drum-machine behavior. They are
approximations, not circuit models.

| Directory | Machine | Modes |
|---|---|---|
| `bd` | VADBD | Punch, round, FM, toy, soft, crisp, wood kicks |
| `sd` | VADSD | Punch, round, FM, warm, wood snares |
| `rc` | VADRC | Two rimshots (RIM1, RIM2); clap |
| `pc` | VADPC | Boom; three toms (TOM1 to TOM3); conga; ping |
| `hh` | VADHH | Closed and open hats (CH 1, OH 1, CH 2, OH 2); HAT3; six-oscillator HBLD |
| `cy` | VADCY | Two cymbals (CYM1, CYM2); ride; two cowbells (COW1, COW2) |
| `sy` | VADSY | Eight dual-VCO configurations; OSC; OSC triangle (OSCT); BITS |

Each directory holds the manifest, the DSP2 assembly and its tables. BD, HH and
CY also carry the same self-contained DSP1 drive curve. MODE is divided evenly
between the modes, and the knob labels change with it, including what the other
controls mean. No UW sample is needed.

## Analog imperfections

No two hits of an analog voice are quite the same. These machines imitate that,
at a fixed, subtle depth (there is no control for it, and the knobs are unchanged):

- **Per-hit detune.** Each trigger draws a random pitch offset of up to ±3 cents
  from a per-track generator, so repeated hits land a few cents apart. VADSY draws
  one for each of its two oscillators.
- **Free-running oscillators.** VADHH and VADCY start each oscillator of a hit that
  follows silence at a random phase, so the six squares line up differently every
  time. VADSY does the same in its free-running configurations; the configurations
  that reset on a trigger still start from zero, and so do the drums, whose attack
  depends on it.
- **Slow drift.** VADSY's oscillators wander by about 1.5 cents RMS over half a
  second, in opposite directions, so their beating moves too.

All of it is computed once per trigger or once per 32-sample block; the sample
loops are unchanged. Clap and noise voices are not affected. With the depth set to
zero these sources assemble to exactly the previous machines, word for word.

These are new machines with automatically assigned IDs; they do not replace a
stock machine or convert saved kits. When you rebuild firmware that existing kits
use, load your saved layout so every machine keeps its ID.

## Export

```text
python packs/assembly_export.py examples/analog/bd --out my-packs/vad-bd --assembler /path/to/asm56.exe
```

The exporter checks the code at eight relocation placements and writes
`my-packs/vad-bd/model.json`. `npm run test:community` exports all seven (and the
community models) in one go. `catalog.json` lists the directories and model keys.

## Checks and cost

Every mode matches the reference implementation it was derived from, sample for
sample, at default controls and with all other controls at 0 and at 127, each with
retriggers, when the imperfections are built at depth zero (which reproduces the
previous sources word for word); each mode is silent before its first trigger. In the emulator, all 43
label sets, kit reloads, drive selection across 16 tracks and default audio pass.
They have not yet been played on hardware.

Measured cold-cache cost, in DSP cycles per output sample (target: under 129),
before the imperfections, and what they add. The added render cost was measured
in the emulator at every mode's defaults and with all controls at 0 and 127; the
cold-cache figure adds three cycles for each new instruction word a block runs,
so it is an estimate, not a new profile:

| Machine | Worst measured | Imperfections add (render) | Estimated with them |
|---|---:|---:|---:|
| VADBD | 134.19 | +0.38 | 135.4 |
| VADSD | 130.41 | +0.19 | 131.0 |
| VADRC | 129.97 | +0.72 | 131.1 |
| VADPC | 117.78 | +0.19 | 118.4 |
| VADHH | 126.16 | +0.31 | 127.0 |
| VADCY | 126.16 | +0.31 | 127.0 |
| VADSY | 134.81 | +1.34 | 139.2 |

Triggers cost 13 to 91 cycles more, once per hit (VADSY's first hit after
silence is the dearest, at 249 cycles).

The figures cover the DSP2 voice only, not DSP1 drive or the rest of the OS. No
mode was removed to meet the target; VADSY and VADBD are the first candidates for
optimization. See [Models](../../docs/MODELS.md#cpu-cost) for how cost is counted.
