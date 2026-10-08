# Models

These model families ship as editable source under [`examples/`](../examples/).
Each directory is a complete `md-model/1` source: a manifest, DSP2 assembly and
immutable tables. Every model is added under a new identity with an automatically
assigned machine ID; none replaces a stock machine.

| Family | Directory | Machines | License |
|---|---|---|---|
| Analog recreations | [`examples/analog`](../examples/analog/README.md) | VADBD, VADSD, VADRC, VADPC, VADHH, VADCY, VADSY | GPL v3 or later |
| Community voices | [`examples/community`](../examples/community/README.md) | OSCAC, FMS4O, OSCSP, VOXFR, WAVSP (archived: not on the site) | GPL v3 or later |
| Noise Plethora | [`examples/noise-plethora`](../examples/noise-plethora/README.md) | NZEPL (30 programs) | GPL-3.0-or-later; Teensy Audio parts MIT |
| Physical models | [`examples/physical`](../examples/physical/README.md) | PHYKS | MIT |
| Effects | [`examples/effects`](../examples/effects/README.md) | NFX4P | GPL v3 or later |
| Scaffold | [`examples/scaffold`](../examples/scaffold/README.md) | A silent starting point for your own model | GPL v3 or later |

Model names say what engine they are: VAD (analog-style drum voices), FMS (FM),
OSC (oscillator synths), WAV (wavetable and spectral), VOX (voice and formant),
NZE (noise), PHY (physical models) and NFX (effects on the previous track). Renamed models keep their former keys as aliases, so a
layout saved before the rename still loads and keeps every ID.

### Pitch

Every pitched model follows one pitch law: PTCH raw = 2 × (MIDI − 24), so raw 0
is MIDI 24 (C0, 32.70 Hz), even values are semitones (72 = C3, MIDI 60) and odd
values are quarter tones, up to MIDI 87.5 at 127. Each model's manifest records
its law and range (see [Model packs](MODEL-PACKS.md#declaring-what-the-pitch-knob-means)).
Saved kits and pattern P-locks made before this law play different notes; there is
no converter.

## Compiled models

Two packs in [`catalog/`](../catalog/README.md) ship as compiled code only:

| Pack | Contents |
|---|---|
| `synths.json` | FMS2O, FMS3O, FMSSW, OSCSW, OSCPW, OSCCH, OSC8B, WAVTB, WAVCH, WAVMR, VOXVO |
| `core.json` | The shared runtime every build links: knob callback, dynamic labels, DSP1 drive curves |

A compiled pack holds finished DSP56300 code, its tables, relocations and entry
points. The engine links it exactly like a pack exported from `examples/`, so
these models work in every build. Their source is not part of this repository,
so they cannot be edited or rebuilt here. They are distributed as data alongside
Kitbasher and are not covered by the GPL source offer for the application.

## Analog recreations

Seven analog-style drum and synth machines with 43 modes between them. The DSP
code is original and the coefficient tables are generated mathematically;
parameter ranges and defaults follow documented analog drum-machine behavior. They
are approximations, not circuit models. MODE switches the voice and relabels the
other knobs to match. VADBD, VADHH and VADCY bring their own DSP1 drive curve.
Each hit varies slightly, as an analog voice does: a few cents of random detune
per hit, free-running oscillator phases on the hats, cymbals and VADSY, and a slow
pitch drift on VADSY ([details](../examples/analog/README.md#analog-imperfections)).

## Community voices

Five synth voices originally written by Nick Montgomery for the Machinedrum and
ported here as independent add-ons: an acid bass, four-operator FM, a saw/pulse
synth, a formant oscillator and a spectral-array scanner. Their controls follow
the original voices but form a new control layout, so kits made for the original
replacement machines do not carry over. Each directory's README lists its control
ranges. They are published here with the author's permission under GPL v3 or later.

## Noise Plethora

One machine that plays the 30 programs of the first three banks of Befaco's Noise
Plethora, rewritten for the DSP56300. MODE selects the program and relabels its two
program controls; a band-pass filter follows every program. Some programs are
approximations made to fit the Machinedrum's time budget; the
[README](../examples/noise-plethora/README.md) lists each one.

## Physical models

PHYKS is an original Karplus–Strong string: a noise or hammer excitation, shaped by
PICK, recirculates through a damped delay line in the track's P-I slice. DEC,
DAMP and a decaying pitch bend shape the string. Each trigger clears the slice in
three chunks and stays silent for those 96 samples (about 2 ms). It has not been
tested on hardware yet ([details](../examples/physical/ks/README.md)).

## Effects

NFX4P is a Moog-style 4-pole ladder filter (after Kocmoc uLADR) that processes the
previous track's output. A trig runs an AD envelope on the cutoff, and the output
VCA follows the envelope or opens a gate. It is a port of a custom OS 1.63
machine, bit-exact with the original in a DSP kernel harness, and checked sample
for sample against an integer model of it on a DSP instruction host
(`npm run test:ladder`). It reads the source track before its level: turn that
track's level down to hear only the filtered signal. It has not been tested on
hardware in Kitbasher yet ([details](../examples/effects/ladder/README.md)).

## Building packs from these sources

Export any model directory with the native assembler (see the
[scaffold example](../examples/scaffold/README.md) to build it):

```text
python packs/assembly_export.py examples/analog/bd --out my-packs/vad-bd --assembler /path/to/asm56.exe
```

`npm run test:community` exports every community, analog, physical and effect model and checks
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
| VADBD | 135.4 (estimate) |
| VADSD | 131.0 (estimate) |
| VADRC | 131.1 (estimate) |
| VADPC | 118.4 (estimate) |
| VADHH | 127.0 (estimate) |
| VADCY | 127.0 (estimate) |
| VADSY | 139.2 (estimate) |
| OSCAC | 70.5 |
| FMS4O | 99.6 |
| OSCSP | 120.8 |
| VOXFR | 121.6 |
| WAVSP | 106.8 |
| NZEPL | 125.4 (grainGlitchII, its costliest program) |
| PHYKS | 120.2 (estimate) |
| NFX4P | 141 (estimate; 110 with a constant cutoff) |

When a kit asks for more than the DSP can give, overload recovery silences voices
instead of letting the instrument stall. It does not make an expensive model
cheaper.
