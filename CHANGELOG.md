# Changelog

All notable changes to Kitbasher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- One pitch law for every pitched public model: PTCH raw = 2 × (MIDI − 24), so raw
  0 is MIDI 24 (C0) and raw 127 is MIDI 87.5, in quarter-tone steps with every even
  value a semitone; MIDI 60 is named C3. OSCAC, WAVSP, FMS4O, VADBD, VADSD, VADRC,
  VADPC and VADSY moved to it (major version 2.0.0, new PTCH defaults that play the
  old default note), and OSCSP, VOXFR and PHYKS already used it. The eleven compiled
  synths (FMS2O, FMS3O, FMSSW, OSCSW, OSCPW, WAVTB, VOXVO, OSC8B, WAVCH, OSCCH, WAVMR)
  moved from raw = MIDI to it too (their PTCH 48 still plays MIDI 48). VADHH and VADCY
  keep their own law, one semitone a step about raw 64, and only gain the pitch
  metadata (1.1.0; their code is unchanged). **No backward compatibility:** saved kits
  and pattern P-locks on these machines play different notes, and nothing converts
  them.
- PHYKS (1.0.0) reads its string through a fractional, interpolated delay, so every
  note is in tune to a tenth of a cent instead of up to 40 cents out at
  the top; it costs about 8 cycles a sample.

### Added

- Pitch metadata: `panel.pitch` in the model manifest and `pitch` on pack models
  (knob, law, steps, base note, range, per-mode overrides), with `rawToNote` /
  `noteToRaw` in `engine/src/pitch.ts`.
- Browser and command-line patcher that adds sound models to Machinedrum OS 1.63,
  X.13, X.14 and Em's DEV firmware, keeping every stock machine.
- Support for OS X.14 and for Em's DEV firmware md-26A01-183521, both tested in the
  emulator.
- Assembly models work on any base whose model runtime (DSP2 program, SRAM
  routines and add-on code) matches a tested one, even without a profile for
  that exact OS file.
- Automatic preparation of stock OS 1.63.
- Model packs loaded in the browser or bundled from `catalog/`.
- Model source exporter for DSP2 assembly, with a scaffold example.
- Model sources: seven analog drum and synth voices (VADBD, VADSD, VADRC, VADPC,
  VADHH, VADCY, VADSY), five community synth voices (OSCAC, FMS4O, OSCSP, VOXFR,
  WAVSP), a 30-program port of Befaco's Noise Plethora (NZEPL) and a
  Karplus–Strong string (PHYKS).
- Ten browsing categories in the page (kicks; snares, rims and claps; hats and
  cymbals; toms and hand percussion; FM; synths; wavetables; vocal; physical
  modeling; effects), which also set the default machine-select menu categories.
- Help text for every control of every model, shown as you hover or tap a knob.
- Automatic E12 trim: when your selection does not fit, the page trims the E12
  sample tails just enough to make room, and leaves them alone when everything
  fits. You can keep the originals or set the trim by hand.
- Models can declare up to 2,048 words of per-track scratch memory.
- Packs can carry their own browsing category, description and control help
  (`packs/annotate_browse.mjs`).
- The local development server rebuilds on save; style changes keep your loaded
  firmware and selection.
- E12 sample swapping: a Samples step after loading the OS shows the 16 E12
  machines as a pad grid (which machine plays which sample is read from the OS's
  own code). Click a pad to hear it, drop a WAV or AIFF file on it to replace it,
  or drop several files or a folder to fill the pads in order (sorted by name) after
  a review. Files are
  converted in the browser to 12-bit 44.1 kHz mono, and a new sample is never
  longer than the one it replaces. Per-sample "Don't trim"; the memory meters and
  auto trim use the swapped bank.
- Project files (`.kitbasher.json`): save samples, models, trim and layout, and load
  them with the same OS to build the same firmware.

### Changed

- Models renamed to engine-based names (VAD, FMS, OSC, WAV, VOX, NZE); old layout
  files still load.
- The DSP2 idle routine's padding loop is cut from 50 passes to one, freeing DSP
  time on every idle track (`--no-stub-trim` keeps the original).
- E12 trim is pair-aware: E12-SD and E12-RS trim their ring sample with their body
  sample, which removes a 1,378 Hz tone a deep trim used to leave behind.
- Byte-identical model tables are stored once.
- DSP1 drive code moves around DSP1 code a base already occupies, and falls back
  to a compact dispatcher when the standard layout overflows.
- Knobs without a function are hidden instead of showing a placeholder label.
- The analog machines (VAD) vary slightly from hit to hit: a few cents of random
  detune per hit, free-running oscillator phases on VADHH, VADCY and VADSY, and a
  slow pitch drift on VADSY. Knobs are unchanged; the cost is per hit or per block.
- Firmware status in the page is described in plain language.

### Removed

- Developer-only DSP1 recovery variants (`--dsp1-recover-variant`), the DSP1
  codec diagnostics and realignment options (`--dsp1-diag`, `--dsp1-realign`) and
  the emulator probe flags (`--ram-probe`, `--dsp2-probe`).
- The Noise Plethora generator's `--development` experiment mode.

### Fixed

- Every build is checked for boot-time memory safety: boot patches only write
  RAM or the base's initialized SRAM, flash relocations are applied to the file,
  and early code runs from flash that is already mapped.
- On X.14, DSP1 drive curves reach every track.
- On DEV 26A01, the kit editor draws a newly chosen category in full.
- On a Machinedrum without UW, the machine-select menu shows every added
  category and hides ROM and RAM, as on stock. Before, OS 1.63 and DEV builds hid
  the last two added categories and showed ROM and RAM (which load GND--), and
  X.13 builds hung at the boot screen.
- The page now asks whether your Machinedrum has the UW option before you go on,
  remembers the answer and saves it in layout and project files. With No,
  models that play UW samples are not selectable, machines that normally sit on
  ID 128 or above (OSCPW) move to a free ID below 128, the ID map marks 128 and
  up as unusable, and the menu preview shows your categories in place of ROM
  and RAM. `--no-uw` does the same on the command line.
