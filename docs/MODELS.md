# Models with source in this repository

These model families ship as editable source under [`examples/`](../examples/).
Each directory is a complete `md-model/1` source: a manifest, DSP2 assembly and
immutable tables. Every model is added under a new identity with an automatically
assigned machine ID; none replaces a stock machine.

| Family | Directory | Machines | License |
|---|---|---|---|
| Analog recreations | [`examples/analog`](../examples/analog/README.md) | AN BD, AN SD, AN RC, AN PC, AN HH, AN CY, AN SY | GPL v2, with Kitbasher |
| Community voices | [`examples/community`](../examples/community/README.md) | ACID, FM4OP, SAWPW, FORMT, SPECT | No license stated by the original sources |
| Noise Plethora | [`examples/noise-plethora`](../examples/noise-plethora/README.md) | NOISE (30 programs) | GPL-3.0-or-later; Teensy Audio parts MIT |
| Scaffold | [`examples/scaffold`](../examples/scaffold/README.md) | A silent starting point for your own model | GPL v2, with Kitbasher |

## Analog recreations

Seven drum and synth machines with 43 modes between them, recreating the analog
voice designs described in the Analog Rytm and Syntakt manuals. The DSP code is
original and the coefficient tables are generated mathematically; parameter ranges
and defaults follow the instruments' documented behavior. They approximate those
designs and are not circuit models. MODE switches the voice and relabels the other
knobs to match. AN BD, AN HH and AN CY bring their own DSP1 drive curve.

## Community voices

Five synth voices originally written by Nick Montgomery for the Machinedrum and
ported here as independent add-ons: an acid bass, four-operator FM, a saw/pulse
synth, a formant oscillator and a spectral-array scanner. Their controls follow
the original voices but form a new control layout, so kits made for the original
replacement machines do not carry over. Each directory's README lists its control
ranges. The original sources state no license, so the manifests record
`NOASSERTION`; that records the absence of a license and grants none.

## Noise Plethora

One machine that plays the 30 programs of the first three banks of Befaco's Noise
Plethora, rewritten for the DSP56300. MODE selects the program and relabels its two
program controls; a band-pass filter follows every program. Some programs are
approximations made to fit the Machinedrum's time budget; the
[README](../examples/noise-plethora/README.md) lists each one.

## Building packs from these sources

Export any model directory with the native assembler (see the
[scaffold example](../examples/scaffold/README.md) to build it):

```text
python packs/assembly_export.py examples/analog/bd --out my-packs/an-bd --assembler /path/to/asm56.exe
```

`npm run test:community` exports every community and analog model and checks
each one at eight relocation placements. Put the resulting packs in
[`catalog/`](../catalog/README.md) to bundle them into the site, or load them in
the page.

## CPU cost

Each voice renders 32 samples per block. The target for a model is under 129 DSP
cycles per output sample at its worst measured steady, control-change and
knob-turn scenario, counted with a cold instruction cache (three cycles per missed
instruction word, highest level sustained over three consecutive blocks). That is
a guide for mixing machines, not a guarantee that any 16-track kit fits: models
compete for the same cache, and the whole OS adds its own work.

| Machine | Worst cycles per sample |
|---|---:|
| AN BD | 134.2 |
| AN SD | 130.4 |
| AN RC | 130.0 |
| AN PC | 117.8 |
| AN HH | 126.2 |
| AN CY | 126.2 |
| AN SY | 134.8 |
| ACID | 70.5 |
| FM4OP | 99.6 |
| SAWPW | 120.8 |
| FORMT | 121.6 |
| SPECT | 106.8 |
| NOISE | 125.4 (grainGlitchII, its costliest program) |

When a kit asks for more than the DSP can give, overload recovery silences voices
instead of letting the instrument stall. It does not make an expensive model
cheaper.
