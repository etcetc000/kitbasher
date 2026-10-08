# Contributing to Kitbasher

Thanks for helping. Bug reports, new bases, new models, documentation and tests
are all welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Install Node 22+, Python 3.11+ and Git. The checks need no firmware, emulator or
hardware.

```text
npm ci
python -m pip install --target build/manifest-deps -r requirements-dev.txt
npm run install-hooks
npm run doctor
```

On Windows, name your Python interpreter explicitly: `python` on `PATH` is often
the Microsoft Store stub, which can hang instead of running. Create
`.local/config.json` (git-ignored) with the absolute path:

```json
{ "python": "C:/path/to/python.exe" }
```

or set the `PYTHON` environment variable. On macOS and Linux the default is
`python3`.

`.local/config.json` holds all optional local paths. Every key can also come
from an environment variable:

| Key | Variable | Used by |
|---|---|---|
| `python` | `PYTHON` | Python tests and the dev server |
| `packDir` | `MD_PACKS` | `npm run dev` and the CLI: your local pack directory (default `~/Documents/kitbasher-packs`) |
| `uwAssets` | `MD_UW_ASSETS` | `npm run dev`: UW sample files to offer as downloads |
| `assembler` | `MD_ASSEMBLER` | `npm run test:assembly`, `npm run test:community` and the model exporter |
| `dspHost` | `MD_DSP_HOST` | `npm run test:ksstr` and `npm run test:ladder`: a DSP56300 instruction host (see `ci/ksstr_check.py`) |

Values must be absolute paths. Only `packDir` has a default.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Strict TypeScript, then the Node and Python unit suites |
| `npm run check` | `npm test` plus the site build; CI runs this |
| `npm run build` | Bundle the site into `web/dist` |
| `npm run dev -- [PACK_DIR] [PORT]` | Build and serve the site on `127.0.0.1` (default port 8767), rebuilding as you edit |
| `npm run test:assembly` | Instruction-encoding tests; needs the native assembler |
| `npm run test:community` | Export every model in `examples/community`, `examples/analog`, `examples/physical` and `examples/effects`; needs the native assembler |
| `npm run test:ksstr` | Run PHYKS on the DSP instruction host and compare every sample with its integer model; needs `dspHost` |
| `npm run test:ladder` | Run NFX4P on the DSP instruction host and compare every sample with its integer model; needs `dspHost` |
| `npm run doctor` | Check your toolchain and local paths |

Run `npm run check` before opening a pull request.

`npm run dev` watches the sources and rebuilds when you save. Style changes are
applied in place, so the firmware and models you loaded stay put; other changes
reload the page, and you load your firmware again. A failed build leaves the page
on the last good one. Live reload exists only on your machine and never reaches
the built site.

## Tests

- Engine tests live in `engine/test/*.test.ts`. List each new file in
  `ci/test_suites.json` under `unit`; `npm test` refuses unlisted files.
- Tooling tests are `ci/*.test.mjs` and are picked up automatically.
- Python tests are `ci/*_test.py`. List each one in `ci/python_suites.json`.

Tests use synthetic data only. They never need firmware, send MIDI or touch
hardware. See [docs/TESTING.md](docs/TESTING.md).

## Writing a model

The [scaffold example](examples/scaffold/README.md) walks through a complete
model: edit the manifest and DSP assembly, export a pack, and load it in the
page. The manifest format is defined by
[docs/model-manifest.schema.json](docs/model-manifest.schema.json), and
[docs/MODEL-PACKS.md](docs/MODEL-PACKS.md) explains how packs are loaded.

Packs placed in [catalog/](catalog/README.md) are bundled into the site. The
model sources already in the repository are listed in [docs/MODELS.md](docs/MODELS.md).

Every control of a bundled model needs its own help text in
`web/src/parameters.ts`; the site build refuses a gap. Give the model a browsing
entry in `engine/src/sound_catalog.ts` too, or it lands in **Other models**. A
knob with no function gets an empty label, never a placeholder such as `--`, so
the Machinedrum hides it.

### What a model contribution should show

A model has to keep its sound, controls and state behavior while fitting the
DSP's time budget. With a new or optimized model, include:

- **Cost.** DSP cycles per output sample at the worst measured steady,
  control-update and knob-turn scenario, counted with a cold instruction cache.
  The target is under 129. Give the single-block peak too, and say which
  scenarios you measured; a missing scenario is a gap, not a pass. Host
  instruction cycles alone are not a cold-cache figure: if you cannot run a
  cold-cache measurement, say so and include your assembled code and scenarios.
- **State.** Initialize from dirty memory; render before the first trigger; play
  attack, long tail, silence and retrigger; check every mode, parameter extremes,
  buffer wraps, reassignment to and from other machines, and several tracks at
  once. Every block writes all 32 samples. Silence is not proof that a voice is
  idle: feedback, delays and random generators can still be advancing.
- **Sound.** Compare against the reference through the same route and settings,
  and say whether the comparison is bit-exact or within a stated tolerance.
  Listen to attack, body and tail separately, including bright, resonant and
  maximum-drive settings. A quieter or shorter tail can look like a CPU win.

Keep workspaces track-local and declared in the manifest (see
[Model packs](docs/MODEL-PACKS.md#memory-a-model-can-declare)), never guessed
free addresses. Never widen a tolerance to turn an unexplained failure into a
pass. Overload recovery keeps the instrument playable; it does not make an
expensive model cheap.

## Pull requests

- Keep each pull request to one change, with a clear description of what and why.
- Add or update tests with the code they cover.
- Update the documentation when behaviour changes.
- `npm run check` passes.
- Never commit firmware. The pre-commit hook refuses SysEx files, firmware
  images and ROM-sized binaries, whatever their names.

## Hardware safety

Changes to DSP code, the boot chain or flash layout reach real instruments.
Read [docs/FIRMWARE-SAFETY.md](docs/FIRMWARE-SAFETY.md) first: it lists every
rule learned from a crashed or frozen unit, the gate that enforces each, and the
hardware burst test. For those changes:

- Describe how you tested: emulator runs, sound comparisons, worst-case timing
  (all tracks playing, repeated triggers, overload and recovery), and hardware.
- Report the exact firmware base and the hash of any image you flashed.
- Keep failing results. Do not widen a tolerance to make a test pass.
- Never change the boot block or the bootstrap-rewrite routine; the recovery
  path depends on them.

Maintainers may ask for hardware confirmation before merging changes like these.
