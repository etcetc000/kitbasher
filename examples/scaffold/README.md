# Your first model: edit, assemble and load

This directory is a complete, minimal model source that you can copy and change.
It is deliberately silent: `render` clears its 32 output samples on every call.
Use it to learn the source layout and the build path, then replace the DSP code
with your own sound.

| File | What it holds |
| --- | --- |
| `model.json` | The manifest: key, version, panel name, category, knob labels and defaults, memory and cycle budget. The format is described by [`docs/model-manifest.schema.json`](../../docs/model-manifest.schema.json). |
| `dsp2.asm` | The DSP56300 assembly for the voice, with `init`, `trigger` and `render` entry points. |

## 1. Build the assembler

The exporter assembles `dsp2.asm` with a small native encoder built from the
[dsp56300](https://github.com/dsp56300/dsp56300) emulator sources. You need a
C++20 compiler and a local checkout of those sources:

```sh
python packs/build_assembler.py --dsp-source /absolute/path/to/dsp56300/source
```

This writes `build/assembly/asm56.exe`. Point the `assembler` setting at it in
`.local/config.json` (the file is ignored by Git), for example:

```json
{ "assembler": "/absolute/path/to/checkout/build/assembly/asm56.exe" }
```

Then check that it works:

```sh
npm run test:assembly
```

## 2. Edit the model

- In `model.json`, change `panel.name` to give the model its own menu name, and
  edit the knob labels and defaults.
- In `dsp2.asm`, change the `init`, `trigger` and `render` routines.

The voice interface (`md-voice/1`) works like this:

- Each track gets a 64-word X/Y voice block, addressed through `r6`.
- `Y:+1..+8` in that block hold the raw knob values. Read them, but do not
  overwrite them.
- `md_output` points to the output-buffer pointer; `render` writes 32 samples there.
- Every routine returns normally with `rts`.
- Initialize every state word you read: the block is not cleared for you.

## 3. Export a model pack

```sh
python packs/assembly_export.py examples/scaffold --out /absolute/my-packs/example --assembler /absolute/path/to/asm56.exe
```

The exporter validates the manifest, assembles the source and checks the
relocations by reassembling the code at eight different placements. It writes
`/absolute/my-packs/example/model.json`, an `md-pack/1` model pack.

Keep your packs outside this checkout. `npm run dev` serves the packs in your pack
directory, `~/Documents/kitbasher-packs` by default; set `packDir` in
`.local/config.json` (or the `MD_PACKS` environment variable) to use another one.

## 4. Try it in the browser

```sh
npm run build
node ci/serve.mjs 8767
```

Open `http://127.0.0.1:8767/`. In the Models step, open **Load model packs**,
choose **Add to current catalog**, and select a core pack (`core.json`) together
with your exported `model.json`. If the page already has a core pack loaded, your
`model.json` alone is enough.

## 5. Build a firmware image

Load your own copy of a supported Machinedrum OS, select the example model and
build. The result is an OS update SysEx file.

The example is a starting point, not a finished instrument: test any new sound
engine for sound and timing, in the emulator and on hardware, before you share
it. The exporter supports DSP2 code and an optional DSP1 drive; manifests that
declare samples or ColdFire components are rejected.

See [CONTRIBUTING.md](../../CONTRIBUTING.md), [Model packs](../../docs/MODEL-PACKS.md)
and [Testing](../../docs/TESTING.md) for the rest of the contributor workflow.
