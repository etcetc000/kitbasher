# Testing

## The gate

`npm run check` runs everything CI runs:

- strict TypeScript compilation of `engine/` and `web/`;
- the engine unit tests listed in `ci/test_suites.json`;
- the tooling tests in `ci/*.test.mjs`, including a check that every relative
  link in every Markdown file resolves and that no example model labels an unused
  knob with a placeholder;
- the Python contract tests listed in `ci/python_suites.json`;
- the site build, which also refuses a bundled model with a control that has no
  help text.

`npm test` runs the same minus the site build. Neither needs firmware, model
packs, an emulator or hardware: every test builds its own synthetic input.

## Assembly encoding

`npm run test:assembly` checks real instruction encoding and relocation. Build
the encoder first (see the [scaffold example](../examples/scaffold/README.md)) and
set `assembler` in `.local/config.json` or `MD_ASSEMBLER`.

`npm run test:community` uses the same encoder to export every model in
`examples/community` and `examples/analog`, checking each at eight relocation
placements. The packs and a `result.json` go to a new directory under `build/`.

## Adding tests

- Engine: add `engine/test/<name>.test.ts` and list `<name>` in
  `ci/test_suites.json` under `unit`.
- Tooling: add `ci/<name>.test.mjs`; it runs automatically.
- Python: add `ci/<name>_test.py` and list it in `ci/python_suites.json`.

Tests never send MIDI or flash hardware.

## Changes that reach the instrument

Synthetic tests cannot prove that new DSP code sounds right or fits its time
budget. For DSP, recovery or flash-layout changes, also test sound against a
reference, idle and fully loaded timing, repeated triggers, mixed-kit overload
and recovery, and finally hardware. Keep failing results and the exact input
hashes; do not widen tolerances to make a result pass.
