# Pitch note names

An optional build feature: on the parameter page, the pitch knob of an added
model shows the **note it plays** under its dial instead of a number. It is
**off by default**. Turn it on with *Show pitch as note names* on the Download
step, or `--pitch-labels` on the command line.

Supported on **OS X.14** and **OS 1.63** (the prepared base), with the same
behaviour on both. The DEV builds are not offered it (see [DEV](#dev) below).
Each base's profile has to record the option as tested on it; see
[Supported bases](BASES.md#features-per-base).

## What the screen shows

The value under a dial is three small cells, as Elektron's DEV firmware draws
the pitch of a TONAL track: the note letter, an accidental cell, the octave.

| Value (shared law) | Note | Shown |
|---|---|---|
| raw 0 | MIDI 24 | `C-0` |
| raw 72 | MIDI 60 | `C-3` |
| raw 73 | MIDI 60.5 | `C+3`: a quarter tone above C3, one glyph (a tall plus) |
| raw 74 | MIDI 61 | `C#3` |
| raw 75 | MIDI 61.5 | `C‡3`: a quarter tone above C#3, one glyph (a plus with three bars) |
| raw 127 | MIDI 87.5 | `D‡5` |

- The accidental cell of a natural note is `-`, as DEV and trackers write it.
- Octaves follow the Machinedrum's own MIDI machine: MIDI 60 is C3, MIDI 24 is C0
  (the same names as [MIDI chromatic note input](MIDI-CHROMATIC.md)).
- A note below C0 (MIDI 0 to 23, which some MODE stops of VADPC reach) takes a
  fourth cell for the octave's sign: `C--2` is MIDI 0, `G#-2` MIDI 8.
- The label sits where the number sat, centred on the knob's column.

## Which knobs

Only the pitch knob of a model whose pitch metadata has a note law, quarter or
chromatic (`panel.pitch` in [the model manifest](MODEL-PACKS.md)). The build
report and the command line list what every selected machine's pitch knob shows.
Everything else keeps its number:

- every other knob, every other page (AMP, EQ, FX, LFO, ...), and the stock
  machines;
- models with a relative pitch law (VADHH, VADCY), a continuous one (NZEPL), or no
  pitch metadata (NFX4P);
- a value outside the law's range shows the note the end of the range plays,
  since that is what the knob plays there.

### Models whose pitch follows a MODE knob

VADPC and VADRC declare a different law (or none) for some stops of their MODE
knob. The label reads that knob's kit value whenever it draws, so it always shows
the note the current stop plays, and a stop with no note law (VADRC's third)
shows the number.

Turning the MODE knob redraws the whole page only when it changes a knob caption
(dynamic knob labels), so such a model gets note names only when:

- dynamic knob labels are on (the default), and
- every two MODE stops with different pitch laws also differ in a caption.

Otherwise it keeps its number, and the report says why (with `--no-dyn-labels`,
VADPC and VADRC keep their numbers). As with MIDI chromatic input, a p-locked or
LFO-modulated MODE knob is not followed: the label reads the kit value.

## How it works

The OS draws each knob's value with one routine (`0x228a24` on X.14 and 1.63:
the knob in `d6`, the value in `d4`), which ends with a call of the OS's string
draw (`jsr $211384.l` at `0x22999e`). The patch list points that one call's
operand (`0x2299a0`) at a routine of ours. It returns exactly as the draw does,
and for anything that is not a labelled pitch knob it jumps to the draw with the
stack untouched, so every other value is drawn by the OS as before. For a
labelled one it reads the track's machine ID (and, for a MODE-dependent law, the
MODE knob's kit value), maps the raw value through the model's law to a
quarter-tone count, and draws the cells with the OS's draw: the OS's own 5-pixel
font for letters, `-`, `#` and digits, and a two-glyph font of ours for the
quarter tones.

Discovery finds the routine and every address it uses by signature
(`engine/src/pitch_labels.ts`); nothing is assumed. The `pitch-labels-site` gate
checks that nothing else writes the call, and the `pitch-labels` gate reads the
routine back out of the built image: ISA_A throughout, branches only inside it,
calls only to the OS's string draw and width.

**Memory.** The routine and its table go at the end of the RAM image (after
MIDI chromatic input's routines when both are on), which must end inside the
span earlier images ran from on hardware (`0x2bc000..0x2bce14`). For the bundled
catalog that is 518 bytes of code and 158 of data (`0x2bcb1c..0x2bcdc0` on
X.14), so three descriptors move to flash to make room (OSCPW, WAVTB, OSCSW);
with MIDI chromatic input as well, fourteen do. A selection with no labelled
pitch knob builds no routine and no hook. With the option off, the image is the
same byte for byte as a build without it.

## DEV

The DEV builds already replace the very call this option hooks. On a track whose
kit sets TUNING to TONAL, DEV draws knob 1 as letter, accidental and octave from
its own two 12-character tables, with its own 3x5 glyphs for the quarter tones,
and DEV's own machines show some other knobs as relative intervals. That label
follows DEV's TONAL law and setting, not a model's pitch metadata, so on an added
model it would name the wrong note. Putting our routine in front of DEV's has not
been run, so the option is not offered on DEV 26912 or DEV 26A01; `--discover`
names DEV's routine (`0x2d500c` and `0x2d4eae`).

## Testing

`engine/test/pitch_labels.test.ts` runs the routine in the ColdFire interpreter
for every catalog model, every raw value and every MODE stop, and checks the cells
against `engine/src/pitch.ts`. With your OS files (`firmwareDir`) it also runs
the OS's own knob-value painter of X.14 and 1.63 into the routine and the OS's
string draw, and reads the note back off the framebuffer, and it checks that a
build without the option is unchanged. Not yet tested on hardware.
