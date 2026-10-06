# Third-party notices

Kitbasher is distributed under the GNU General Public License v2; see
[COPYING](COPYING). It includes or uses the following third-party work.

- **UCL** by Markus F. X. J. Oberhumer, GPL v2. The source and its notices are in
  `engine/wasm/ucl/`; the WebAssembly build recipe is `engine/wasm/build.sh`.
- **dsp56300** instruction encoder (optional, for exporting models from assembly
  source). Its sources are not included here; keep their license and attribution
  when you obtain and build them.
- **Node and Python packages** keep the licenses their packages state. Versions are
  pinned in `package-lock.json` and `requirements-dev.txt`.
- **Befaco Noise Plethora** (`examples/noise-plethora/`). The Noise
  Plethora-derived model source is GPL-3.0-or-later; see
  [its COPYING](examples/noise-plethora/COPYING). Its waveform and FM primitives
  follow the **Teensy Audio library** by Paul Stoffregen and contributors, under
  the MIT notice in
  [TEENSY-NOTICE.txt](examples/noise-plethora/TEENSY-NOTICE.txt); the FM
  approximation is credited upstream to Laurent de Soras. A pack or OS image that
  includes this model is distributed under GPL v3 or later.
- **Community voices** (`examples/community/`) were originally written by Nick
  Montgomery. Their original sources state no license; each manifest keeps the
  original attribution and records the license as `NOASSERTION`, which grants
  none.

Machinedrum firmware is supplied by each user and is not part of this project.
Model packs carry their own license and provenance records; see
[docs/MODELS.md](docs/MODELS.md).
