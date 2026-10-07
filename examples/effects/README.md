# Effects

`md-model/1` sources for effect machines: models that process the previous
track's output instead of generating sound. Each directory holds a manifest, DSP2
assembly, tables and a README with its control ranges. The linker assigns IDs and
places code and tables; no stock machine is replaced.

| Directory | Machine | What it is | Worst cycles per sample |
|---|---|---|---:|
| [`ladder`](ladder/README.md) | NFX4P | Moog-style 4-pole ladder filter with a trig envelope and a VCA | 141 (estimate) |

The cost is a cold-cache estimate for one voice, not a guarantee for any 16-track
kit (see [Models](../../docs/MODELS.md#cpu-cost)).

An effect hears the raw DSP2 voice of the track before it, before that track's
DSP1 effects and level. On the first track it outputs silence.

## Export and check

With `assembler` configured (see [CONTRIBUTING](../../CONTRIBUTING.md)),
`npm run test:community` exports every model listed in `catalog.json` along with
the community, analog and physical voices, and checks each at eight relocation
placements.
