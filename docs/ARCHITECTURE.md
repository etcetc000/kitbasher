# Architecture

The browser page (`web/src`) and the command-line patcher (`engine/src/cli.ts`)
share one TypeScript engine. Host I/O stays in thin adapters (`cli.ts`,
`node.ts` and the page); everything else works on bytes and typed records, so the
same code builds the same image in both places.

## How a build works

1. **Identify the base.** The engine reads the OS container, hashes its slots and
   matches a profile in `bases/`. It then discovers every patch site from
   signatures in `bases/lineage-163.json`, and checks each against the profile.
2. **Select models.** Packs from the catalog are validated, and each machine gets
   an ID and a place in the menu layout.
3. **Plan memory.** DSP code, tables, names and menus are placed in the free
   regions the discovery found, with capacity checked before anything is written.
4. **Link and verify.** Code is relocated to its final addresses, the image is
   rebuilt and recompressed, and independent gates read the result back.

## Where things live

| Work | Location |
|---|---|
| Base identification and discovery | `engine/src/discover.ts`, `bases.ts`, `bases/` |
| Model runtime fingerprints | `model_runtime.ts`, `modelRuntimes` in `bases/lineage-163.json` |
| Preparing stock 1.63 | `engine/src/prepare.ts` |
| Catalog and IDs | `catalog.ts`, `selection.ts`, `packs.ts` |
| Browsing categories, descriptions and menu categories | `sound_catalog.ts` |
| Help text for every control | `web/src/parameters.ts` |
| Memory placement and layout | `plan.ts`, `layout.ts`, `align.ts`, `table_pool.ts` |
| E12 sample trimming | `e12.ts`, `web/src/auto-trim.ts` |
| E12 sample swapping and the machine map | `samples.ts`, `web/src/samples-ui.ts`, `web/src/convert.ts` ([E12 samples](SAMPLES.md)) |
| Project file | `project.ts` ([format](PROJECT-FILE.md)) |
| DSP2 idle-stub trim | `stub_trim.ts` |
| Linking and image validation | `build.ts`, `isa_gate.ts`, `boot_safety.ts` |
| Overload recovery | `clean_recovery.ts`, `retire.ts`, `outputpace.ts` |
| MIDI chromatic note input | `midi_chroma.ts` ([user guide](MIDI-CHROMATIC.md)) |
| Model source export | `packs/assembly_export.py`, `model_manifest.py`, `model_panel.py` |
| Browsing data inside a pack | `packs/annotate_browse.mjs` |
| Bundled model packs | `catalog/` |
| Site build and dev server | `web/build.mjs`, `ci/serve_local.py`, `ci/live_reload.py` |
| Development commands | `ci/workflow.mjs` |

## Checks every build runs

The build refuses an image rather than guess. Besides placement and capacity,
these checks run on every build, in the browser and on the command line alike.

- **Boot memory.** An instruction can be legal for the ColdFire and still touch
  memory that is not ready during boot. `boot_safety.ts` requires every boot-time
  patch destination to be main RAM or inside the base's discovered SRAM span,
  applies flash relocations to the output file instead of queuing them as boot
  stores, keeps copy sources and the patch table in low flash, and requires early
  initializers to run from low flash: the runtime flash alias at `0x10000000` is
  not mapped yet. The ISA gate then reads the emitted boot routine and patch
  table back from the final image before trusting their counts.
- **Model runtime.** Assembly models need a tested `md-voice/1` runtime; see
  [Supported bases](BASES.md#model-runtimes).
- **Control help.** `web/build.mjs` refuses to build the site if any control of
  any bundled model lacks its own help text in `web/src/parameters.ts`.

## Making room

The selection has to fit DSP2 memory, the ColdFire RAM windows and the
compressed OS slot. Several mechanisms free space without touching how a stock
machine sounds:

- **E12 trim.** The E12 machines' samples have long, quiet tails. Trimming cuts
  each sample below a threshold (dB relative to its peak), never shorter than a
  minimum length and never longer than a cap. The page picks the gentlest
  threshold that fits your selection (`auto-trim.ts`: 1 dB steps from -40 dB,
  then refined to 0.1 dB) and trims nothing when everything already fits. You can
  keep the original samples or set the threshold by hand instead.
- **Pair-aware cut.** E12-SD and E12-RS play a body sample together with a ring
  sample, and keep reading the ring while the body is still sounding. If the body
  is trimmed shorter than its ring, the player loops a 32-sample window and you
  hear a 1,378 Hz tone. So when a pair's first sample is trimmed, its partner is
  cut to the same length with the same fade, and every other sample keeps its
  place. The ring layer then ends with the body.
- **DSP2 idle stub.** An idle track runs a short DSP2 routine whose padding loop
  makes 50 passes every block. The build cuts it to one pass, a single-word
  change checked by the `stub-trim` gate. `--no-stub-trim` keeps the base's stub.
- **Shared tables.** Assembly tables are immutable by contract, so two models
  that ship byte-identical tables share one copy (`table_pool.ts`). Older packs
  may keep scratch in their tables and are never shared.
- **DSP1 drive placement.** Drive curves go in the free span discovery finds in
  DSP1's program window. On bases whose own DSP1 code occupies part of it, the
  dispatcher moves to the next free span; when the standard layout overflows, a
  compact dispatcher fits in the hook window.

## Principles

- Discovery finds addresses in the base's own code; cached addresses in a profile
  are only compared against it, never trusted on their own.
- Pack building preserves instruction width and verifies relocations by
  assembling at several independent placements.
- Read-back checks stay independent of the values the patch intended to write.
- Firmware and model implementations are inputs, never embedded in the engine.
- The browser and the CLI produce byte-identical images from the same inputs.

See [Model packs](MODEL-PACKS.md), [Supported bases](BASES.md) and [Testing](TESTING.md).
