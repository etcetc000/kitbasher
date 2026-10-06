# Catalog

Model packs placed in this directory are bundled into the site. `npm run build`
copies every `*.json` file here into `web/dist/data/packs/`, and the page offers
those models to every visitor.

Each file must be an `md-pack/1` model pack, and a catalog holds at most one core
pack (`"family": "CORE"`). Visitors can also load pack files of their own into
the page. See [Model packs](../docs/MODEL-PACKS.md).

`uw/` holds the UW sample files some models read (listed in
`web/uw-assets.json`). The build serves them next to the page as `uw-data/`.

| Pack | Models |
|---|---|
| `core.json` | Shared runtime: knob callback, dynamic labels, DSP1 drive |
| `synths.json` | FMS2O, FMS3O, FMSSW, OSCSW, OSCPW, WAVTB, VOXVO, OSC8B, WAVCH, OSCCH, WAVMR |
| `np.json` | NZEPL |
| `community-*.json` | FMS4O, VOXFR, OSCSP, OSCAC, WAVSP |
| `analog-*.json` | VADBD, VADSD, VADRC, VADPC, VADHH, VADCY, VADSY |

`uw/wave-single.syx` is the single wavetable WAVTB reads; `uw/wave-bank.syx` is
the wave bank WAVCH and WAVMR read.
