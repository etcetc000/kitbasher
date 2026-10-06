# Model packs

Models reach Kitbasher as *model packs*: JSON files in the `md-pack/1` format.
A complete pack set has one **core pack** (`"family": "CORE"`, usually
`core.json`), which carries the shared runtime code the models rely on, and one
or more **family packs**, each holding a group of models.

Packs carry relocatable DSP code and descriptors only; they never contain
firmware. You make a pack from model source with
`packs/assembly_export.py` (see the [scaffold example](../examples/scaffold/README.md)).

## In the browser

On the **Models** step, open **Load model packs** and choose your files. They are
read in your browser and never uploaded.

- **Add to current catalog** adds compatible packs to the models already shown.
  Packs that conflict with what is loaded (a different core, or clashing models
  or tables) are refused.
- **Replace catalog** swaps in a complete set. Select its `core.json` and every
  family pack together. The new set is validated before anything changes.

## On the command line

```text
node engine/dist/src/cli.js --catalog /path/to/pack-set --in my-os.syx --out patched.syx --clean-recovery
```

- `--catalog <dir>` uses exactly the packs in that directory and nothing else.
- `--packs <dir>` adds a pack directory and can be repeated. Without `--catalog`,
  the CLI also reads `catalog/` and your local pack directory, `MD_PACKS`
  (default `~/Documents/kitbasher-packs`), when they exist.

Do not combine `--catalog` with `--packs`. For stock OS 1.63, prepare the base
first; see [Supported bases](BASES.md#stock-os-163).

## Bundling packs into the site

`npm run build` bundles every pack in [`catalog/`](../catalog/README.md) into
`web/dist`, and the page offers those models to every visitor. The directory is
empty by default, and the site works without it.

To try a pack set locally without bundling it:

```text
npm run dev -- /path/to/pack-set
```

This serves the page on `127.0.0.1:8767` with that directory as its catalog,
held in memory. Set `uwAssets` in `.local/config.json` (or `MD_UW_ASSETS`) to a
directory of UW sample files, and the samples the packs' models declare are
checked and offered as downloads.

## Carrying browsing data in a pack

The page sorts models into ten browsing categories and shows help for every
control, from `engine/src/sound_catalog.ts` and `web/src/parameters.ts`. A model
the page has never heard of lands in **Other models** with generic help. To make a
pack describe itself on any copy of the page, add your model's entries to those
two files, then write annotated copies of the pack:

```text
npx tsc -p engine
node packs/annotate_browse.mjs my-pack.json --out annotated/
```

Each model in the copy carries a `browse` record: its category, description and
help per control. Packs without it keep working as before.

## Declaring what the pitch knob means

A manifest can say how its pitch knob maps to notes, in `panel.pitch`; the
exporter copies it onto the pack model (`pitch`), so compiled packs carry it too.
Every bundled synth, FM, wavetable, vocal and physical model declares one.

```json
"pitch": { "knob": 0, "law": "quarter", "steps": 2, "base_note": 24, "table": "pitch" }
```

| Field | Meaning |
|---|---|
| `knob` | The 0-based knob that carries pitch (`null` only with law `none`) |
| `law` | `quarter`, `chromatic`, `continuous`, `relative` or `none` |
| `steps` | Raw steps per semitone: 2 for `quarter`, 1 for `chromatic` |
| `base_note` | MIDI note at raw 0 |
| `range` | `[lo, hi]` raws where the law holds; outside them the end note is held |
| `center` | `relative` only: the raw that plays the mode's own voicing |
| `mode_knob`, `by_mode` | Per-stop overrides of the MODE knob: `{zone, base_note, law, range, center}` |
| `cents_per_step`, `tolerance_cents`, `table` | A uniform continuous law; the checkers' bound; the table the knob reads |

Every absolute-pitch model uses one law, **quarter**: raw = 2 × (MIDI − 24). Raw 0
is MIDI 24 (32.70 Hz), every even value is a semitone, every odd value the quarter
tone between, and raw 127 is MIDI 87.5. Notes are named as on the Machinedrum's
own MIDI machine, MIDI 60 = C3, so raw 0 is C0 and raw 72 is C3. Models whose modes
sit at different pitches keep each mode's base in `by_mode`; hats, cymbals and
cowbells are `relative`, two raws per semitone about raw 64.

`engine/src/pitch.ts` holds the one mapping (`rawToNote`, `noteToRaw`, `noteName`)
and checks the object against the panel: the knob must be captioned `PTCH`,
`NOTE` or `OSC1`, and a mode that relabels it to anything else must say
`law: "none"`.

## Renaming a model

A model's key (`VAD/BD`, `OSC/SW`, ...) is how a saved layout, a `--model`
selection and an exclusion name it. When a model gets a new key, list the keys it
had before in `aliases`, in its manifest (`model.json`) and in its pack entry:

```json
"key": "VAD/BD",
"aliases": ["AN/BD"],
```

A layout that names a former key, including one read back from a patched OS,
places the renamed model on the same ID and in the same category; the layout the
build writes then uses the current key. An alias that is another model's key, an
alias two models claim, and a layout naming one model under both keys are
refused with an error.

## Memory a model can declare

An assembly model's manifest lists the memory it owns in `memory`. Every model
has its 64-word X/Y voice block (`kind: "voice"`). On top of that it may declare
one of:

- **A P-I slice** (`kind: "pi"`): 1,536 words per track for delay lines and
  other audio buffers, cleared in chunks (`init: "chunked"`; with
  `"chunked-muted"` the model clears it a chunk per call and stays silent until it
  is done). The linker supplies `pi_ws`.
- **Per-track scratch** (`kind: "private"`): up to 2,048 words per track in X, Y
  or XY, initialized by the model and handed to the next model on the track
  (`init: "model"`, `release: "successor-init"`).

```json
{ "kind": "private", "space": "X", "words": 153, "alignment": 128,
  "lifetime": "track-assignment", "init": "model", "release": "successor-init" }
```

Scratch lives in a 16 x 2,048-word region carved from trimmed E12 sample memory,
reserved once whichever scratch models you select. The linker supplies `ws`
(the region's base) and `ws_slice` (2,048); a track finds its slice from
`md_track` (0..15):

```asm
init:
    move y:>md_track,a
    asl #11,a,a           ; track * 2048
    add #>ws,a
    move a,r0
    move a,y:(r6+$23)     ; remember the pointer in the voice block
    clr a
    rep #153
    move a,x:(r0)+        ; clear every declared word
    rts
```

Only the declared words belong to the model. Initialize each one before reading
it, including after another model used the track; nothing clears the region for
you. Tables are for immutable data only: never keep state in them, since two
models with identical tables share one copy. The
[Spectra example](../examples/community/spect/README.md) uses scratch this way.
