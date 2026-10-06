# Changelog

All notable changes to Kitbasher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Browser and command-line patcher that adds sound models to Machinedrum OS 1.63,
  X.13, X.14 and M's DEV firmware, keeping every stock machine.
- Support for OS X.14 and for M's DEV firmware md-26A01-183521, both tested in the
  emulator.
- Assembly models work on any base whose model runtime (DSP2 program, SRAM
  routines and add-on code) matches a tested one, even without a profile for
  that exact OS file.
- Automatic preparation of stock OS 1.63.
- Model packs loaded in the browser or bundled from `catalog/`.
- Model source exporter for DSP2 assembly, with a scaffold example.
- Model sources: seven analog drum and synth voices (VADBD, VADSD, VADRC, VADPC,
  VADHH, VADCY, VADSY), five community synth voices (OSCAC, FMS4O, OSCSP, VOXFR,
  WAVSP) and a 30-program port of Befaco's Noise Plethora (NZEPL).
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
