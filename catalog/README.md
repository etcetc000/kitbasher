# Catalog

Model packs placed in this directory are bundled into the site. `npm run build`
copies every `*.json` file here into `web/dist/data/packs/`, and the page offers
those models to every visitor.

Each file must be an `md-pack/1` model pack, and a catalog holds at most one core
pack (`"family": "CORE"`). Visitors can also load pack files of their own into
the page. See [Model packs](../docs/MODEL-PACKS.md).

`uw/` holds the UW sample files some models read (listed in
`web/uw-assets.json`). The build serves them next to the page as `uw-data/`.

| Pack | Models | Source |
|---|---|---|
| `core.json` | Shared runtime: knob callback, dynamic labels, DSP1 drive | Compiled; source not included |
| `synths.json` | FMS2O, FMS3O, FMSSW, OSCSW, OSCPW, WAVTB, VOXVO, OSC8B, WAVCH, OSCCH, WAVMR | Compiled; source not included |
| `np.json` | NZEPL | [`examples/noise-plethora`](../examples/noise-plethora/README.md) |
| `community-*.json` | FMS4O, VOXFR, OSCSP, OSCAC, WAVSP | [`examples/community`](../examples/community/README.md) |
| `analog-*.json` | VADBD, VADSD, VADRC, VADPC, VADHH, VADCY, VADSY | [`examples/analog`](../examples/analog/README.md) |

`uw/wave-single.syx` is the single wavetable WAVTB reads; `uw/wave-bank.syx` is
the wave bank WAVCH and WAVMR read.

Compiled packs hold finished DSP code and tables. You can use them in any build,
but they cannot be rebuilt or edited from this repository; see
[Compiled models](../docs/MODELS.md#compiled-models).
