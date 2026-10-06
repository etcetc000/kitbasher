# Analog recreations

Seven `md-model/1` sources recreate the analog voice designs described in the
Analog Rytm and Syntakt manuals. The DSP code is original, the coefficient tables
are generated mathematically, and parameter ranges and defaults follow the
instruments' documented behavior. They approximate those designs; they are not
circuit models.

| Directory | Machine | Modes |
|---|---|---|
| `bd` | AN BD | Hard, classic, FM, plastic, silky, sharp, acoustic kicks |
| `sd` | AN SD | Hard, classic, FM, natural, acoustic snares |
| `rc` | AN RC | Hard and classic rimshots; classic clap |
| `pc` | AN PC | Bass/low/mid/high toms; conga; ping |
| `hh` | AN HH | Classic and metallic closed/open hats; basic; lab |
| `cy` | AN CY | Classic, metallic, ride cymbals; classic and metallic cowbells |
| `sy` | AN SY | Eight dual-VCO configurations; raw; raw triangle; chip |

Each directory holds the manifest, the DSP2 assembly and its tables. BD, HH and
CY also carry the same self-contained DSP1 drive curve. MODE is divided evenly
between the modes, and the knob labels change with it, including what the other
controls mean. No UW sample is needed.

These are new machines with automatically assigned IDs; they do not replace a
stock machine or convert saved kits. When you rebuild firmware that existing kits
use, load your saved layout so every machine keeps its ID.

## Export

```text
python packs/assembly_export.py examples/analog/bd --out my-packs/an-bd --assembler /path/to/asm56.exe
```

The exporter checks the code at eight relocation placements and writes
`my-packs/an-bd/model.json`. `npm run test:community` exports all seven (and the
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
| AN BD | 134.19 |
| AN SD | 130.41 |
| AN RC | 129.97 |
| AN PC | 117.78 |
| AN HH | 126.16 |
| AN CY | 126.16 |
| AN SY | 134.81 |

The figures cover the DSP2 voice only, not DSP1 drive or the rest of the OS. No
mode was removed to meet the target; AN SY and AN BD are the first candidates for
optimization. See [Models](../../docs/MODELS.md#cpu-cost) for how cost is counted.
