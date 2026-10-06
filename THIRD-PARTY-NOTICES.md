# Third-party notices

Kitbasher is distributed under the GNU General Public License, version 3 or
later; see [COPYING](COPYING). It includes or uses the following third-party work.

- **UCL** by Markus F. X. J. Oberhumer, GPL v2 or later, used here under GPL v3. Its source and notices are in
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
  approximation is credited upstream to Laurent de Soras.
- **Community voices** (`examples/community/`) were written by Nick Montgomery
  and are published here with his permission under GPL v3 or later.

The compiled packs `catalog/synths.json` and `catalog/core.json` are distributed
as data without source; see [Compiled models](docs/MODELS.md#compiled-models).

Machinedrum firmware is supplied by each user and is not part of this project.
Model packs carry their own license and provenance records; see
[docs/MODELS.md](docs/MODELS.md).
