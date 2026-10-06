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
| `mm.json` | FM ST, FM PA, FM DY, MMSAW, MMPLS, MMWAV, MMVO6, MMDEN, MMDDR, MMSID, MMENS, MMBOX |
| `np.json` | NOISE |
| `community-*.json` | FM4OP, FORMT, SAWPW, ACID, SPECT |
| `analog-*.json` | AN BD, AN SD, AN RC, AN PC, AN HH, AN CY, AN SY |
