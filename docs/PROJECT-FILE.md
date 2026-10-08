# Project file

**Save project** on the page's Download step writes a `.kitbasher.json` file with your choices.
Load it on the Firmware step, under *Restore an earlier layout* (before or after the OS file), to pick up where you left off; every machine keeps its ID ([Machine IDs](BASES.md#machine-ids)). With the
same OS file and the same model packs, the page builds the same `.syx`, byte for byte.

The file holds your choices only: never the OS, and never the stock E12 samples. The code is
[engine/src/project.ts](../engine/src/project.ts).

## Format `kitbasher-project/1`

```json
{
 "format": "kitbasher-project/1",
 "os": { "base": "x14", "name": "OS X.14", "tag": "X14 ",
         "coldfire_sha256": "…", "dsp2_sha256": "…", "dsp1_sha256": "…" },
 "samples": {
  "swaps": [ { "entry": 12, "samples": 32876, "sha256": "…", "data": "…", "source": "snare.wav" } ],
  "no_trim": [3]
 },
 "trim": { "mode": "auto", "db": -17, "cap": 1 },
 "models": ["VADBD", "VADSD"],
 "layout": null,
 "uw": true
}
```

| Field | Meaning |
|---|---|
| `os` | The OS the project was made with: the base profile ID and the hashes the engine identifies bases by (the OS tag and the SHA-256 of the ColdFire, DSP2 and DSP1 slots; for stock 1.63, of the prepared image). A project is refused, with a message, when the loaded OS does not match. |
| `samples.swaps` | One item per replaced E12 sample. `entry` is the sample number (see [E12 samples](SAMPLES.md)), `samples` the sample count. `data` is the samples packed two 12-bit values to three bytes (big-endian, the first sample in the high 12 bits, a final zero when the count is odd), compressed with raw deflate (`CompressionStream('deflate-raw')`), then base64. `sha256` is of the unpacked samples as 16-bit little-endian signed integers; a mismatch refuses the file. `source` is the file name, for display only. |
| `samples.no_trim` | Sample numbers the E12 trim leaves whole. |
| `trim` | The Models step's sample setting: `mode` is `auto`, `keep` or `manual`; `db` and `cap` are the slider values (the trim threshold in dB, and At most in seconds, 0 for no limit). Auto mode recomputes its threshold from the same inputs, so it finds the same one. |
| `models` | The selected models, by module name. Models the page's catalog does not have are named when the file is loaded. |
| `layout` | Your menu layout in the `md-layout/1` format the Categories step exports, or `null` for the default layout. A layout file carries the same `uw` field. |
| `midi_chroma` | `{ "channel": "base+4" }` when *MIDI chromatic note input* was on ([MIDI chromatic note input](MIDI-CHROMATIC.md)): the chromatic channel, `base+4`..`base+15` or `ch:1`..`ch:16`. Absent means off. It is saved whatever OS is loaded, and applies where the OS supports it. The command line's `--restore` turns the option on from it (`--no-midi-chroma` overrides). |
| `uw` | Your answer to *Does your Machinedrum have the UW option?*: `true` or `false`. Absent in files saved before the question. Loading a file never changes an answer you gave on the page (it says so when they differ); with no answer given yet, the file's is used for that visit. With `false` the build keeps every machine below ID 128 and leaves out models that play UW samples ([Machinedrum without UW](BASES.md#machinedrum-without-uw)). |

Readers must refuse a file whose `format` is not one they know. Later versions will change the
format string.
