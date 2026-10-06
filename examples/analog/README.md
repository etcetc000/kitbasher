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
retriggers; each mode is silent before its first trigger. In the emulator, all 43
label sets, kit reloads, drive selection across 16 tracks and default audio pass.
They have not yet been played on hardware.

Measured cold-cache cost, in DSP cycles per output sample (target: under 129):

| Machine | Worst measured |
|---|---:|
| VADBD | 134.19 |
| VADSD | 130.41 |
| VADRC | 129.97 |
| VADPC | 117.78 |
| VADHH | 126.16 |
| VADCY | 126.16 |
| VADSY | 134.81 |

The figures cover the DSP2 voice only, not DSP1 drive or the rest of the OS. No
mode was removed to meet the target; VADSY and VADBD are the first candidates for
optimization. See [Models](../../docs/MODELS.md#cpu-cost) for how cost is counted.
