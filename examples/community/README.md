# Community voices

Five synth voices originally written by Nick Montgomery for the Machinedrum,
ported to independent `md-model/1` add-ons. Each directory holds a manifest, DSP2
assembly, tables and a README with its control ranges. The linker assigns IDs and
places code and tables; no stock machine is replaced.

| Directory | Machine | What it is | Worst cycles per sample |
|---|---|---|---:|
| `acid` | OSCAC | Resonant bass voice with filter envelope, slide and random intervals | 70.47 |
| `efm4op` | FMS4O | Four operators and eight FM algorithms | 99.56 |
| `sawpw` | OSCSP | Saw, pulse/PWM, sub oscillator and detuning | 120.81 |
| `formant` | VOXFR | Formant oscillator with air, barrel and feedback controls | 121.59 |
| `spect` | WAVSP | Two spectral banks with scanning, tilt and partial shaping | 106.78 |

The costs are cold-cache DSP cycles per output sample at each voice's worst
measured steady or control-change scenario; all five are under the 129-cycle
target. They describe one voice, not a guarantee for any 16-track kit (see
[Models](../../docs/MODELS.md#cpu-cost)).

Their controls follow the original voices but form a new control layout: kits made
for the original replacement machines do not carry over. WAVSP owns 153 words of
per-track scratch; the others keep all their state in the voice block. Identical
tables are stored once.

## Export and check

```text
python packs/assembly_export.py examples/community/acid --out my-packs/osc-ac --assembler /path/to/asm56.exe
```

With `assembler` configured (see [CONTRIBUTING](../../CONTRIBUTING.md)),
`npm run test:community` exports every model listed in `catalog.json`, checks each
at eight relocation placements and confirms each pack holds exactly its model.

## License

The original sources state no license. The manifests therefore record
`NOASSERTION` with the original attribution; that records the absence of a
license and grants none.
