# Models with source in this repository

These model families ship as editable source under [`examples/`](../examples/).
Each directory is a complete `md-model/1` source: a manifest, DSP2 assembly and
immutable tables. Every model is added under a new identity with an automatically
assigned machine ID; none replaces a stock machine.

| Family | Directory | Machines | License |
|---|---|---|---|
| Analog recreations | [`examples/analog`](../examples/analog/README.md) | VADBD, VADSD, VADRC, VADPC, VADHH, VADCY, VADSY | GPL v2, with Kitbasher |
| Community voices | [`examples/community`](../examples/community/README.md) | OSCAC, FMS4O, OSCSP, VOXFR, WAVSP | No license stated by the original sources |
| Noise Plethora | [`examples/noise-plethora`](../examples/noise-plethora/README.md) | NZEPL (30 programs) | GPL-3.0-or-later; Teensy Audio parts MIT |
| Scaffold | [`examples/scaffold`](../examples/scaffold/README.md) | A silent starting point for your own model | GPL v2, with Kitbasher |

Model names say what engine they are: VAD (analog-style drum voices), FMS (FM),
OSC (oscillator synths), WAV (wavetable and spectral), VOX (voice and formant) and
NZE (noise). Renamed models keep their former keys as aliases, so a
layout saved before the rename still loads and keeps every ID.

## Analog recreations

Seven analog-style drum and synth machines with 43 modes between them. The DSP
code is original and the coefficient tables are generated mathematically;
parameter ranges and defaults follow documented analog drum-machine behavior. They
are approximations, not circuit models. MODE switches the voice and relabels the
other knobs to match. VADBD, VADHH and VADCY bring their own DSP1 drive curve.

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
python packs/assembly_export.py examples/analog/bd --out my-packs/vad-bd --assembler /path/to/asm56.exe
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
| VADBD | 134.2 |
| VADSD | 130.4 |
| VADRC | 130.0 |
| VADPC | 117.8 |
| VADHH | 126.2 |
| VADCY | 126.2 |
| VADSY | 134.8 |
| OSCAC | 70.5 |
| FMS4O | 99.6 |
| OSCSP | 120.8 |
| VOXFR | 121.6 |
| WAVSP | 106.8 |
| NZEPL | 125.4 (grainGlitchII, its costliest program) |

When a kit asks for more than the DSP can give, overload recovery silences voices
instead of letting the instrument stall. It does not make an expensive model
cheaper.
