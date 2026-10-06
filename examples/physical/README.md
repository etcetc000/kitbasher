# Physical models

`md-model/1` sources for physical-modeling voices. Each directory holds a
manifest, DSP2 assembly, tables and a README with its control ranges. The linker
assigns IDs and places code and tables; no stock machine is replaced.

| Directory | Machine | What it is | Worst cycles per sample |
|---|---|---|---:|
| [`ks`](ks/README.md) | PHYKS | Karplus–Strong plucked and hammered string with damping, pick brightness and pitch bend | 120.2 (estimate) |

The cost is a cold-cache estimate for one voice, not a guarantee for any 16-track
kit (see [Models](../../docs/MODELS.md#cpu-cost)).

## Export and check

With `assembler` configured (see [CONTRIBUTING](../../CONTRIBUTING.md)),
`npm run test:community` exports every model listed in `catalog.json` along with
the community and analog voices, and checks each at eight relocation placements.
