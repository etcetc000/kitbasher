# Compact saturation tables

The first optimization candidate reduces the interpolated tanh tables in BD,
CH, OH and CY from 8,193 to 257 points. It preserves their domains (BD ±4;
metal ±8), synthesis paths, controls, state layouts and output gain. The original
13-bit table generators and committed machine assembly remain the reference.
Use `--tanh-bits 8` to build the candidate; values 8–13 are supported.

All 32 complete source comparisons pass the existing bounds: five BD and nine
per metal voice. Metal RNG state, frame/lifetime/activity, local/external/output
guards and silence checks pass with zero tanh clamps. These tests use external
track 3; the earlier track 0/15 and interleaved-state results describe the
full-table baseline, not additional compact-candidate runs.

| Voice | Program words, before → candidate | Package bytes, before → candidate | Worst pre-trim peak delta from native baseline | Worst pre-trim error from C++ source |
| --- | ---: | ---: | ---: | ---: |
| BD | 10,517 → 2,581 | 33,256 → 8,456 | 0.00011397 | 0.00366148 |
| CH | 11,036 → 3,100 | 34,880 → 10,080 | 0.00059939 | 0.00059677 |
| OH | 11,035 → 3,099 | 34,880 → 10,080 | 0.00058318 | 0.00057948 |
| CY | 11,035 → 3,099 | 34,880 → 10,080 | 0.00057340 | 0.00060934 |

BD's long XL case retains the documented float32 phase drift; its original
0.005 source-error bound was not relaxed. Other BD cases retain 0.0002 and metal
cases retain 0.003. Minimum native-baseline delta SNR across cases is 75.55 dB
for BD, 64.06 for CH, 63.69 for OH and 63.66 for CY. These are numerical
comparisons, not listening approval. The A/B tool verifies identical desktop
reference streams, controls, sample counts and output gains before comparing.

The four packages save **31,744 program words / 99,200 package bytes**. This
includes 95,232 code bytes and 3,968 relocation-bitmap bytes. Replacing only
these four packages leaves the seven-voice family at **26,421 words / 85,360
bytes**, or **39,282 words / 125,944 bytes** with CP. Both still exceed the
published 16-bit library-byte capacity field; actual device capacity is unknown.

Raw call-cycle maxima are unchanged in every paired case: BD 15,333; CH 245,437;
OH/CY 245,405 clocks/block. Ordered CH default replays also have identical raw
cycles, modeled interlocks and instruction-word misses with either table size.
Table data-read waits are not modeled. This is a storage improvement, not a
demonstrated CPU improvement. All candidate packages still declare zero admitted
cycles and fail the upstream installation gate as drafts.

## Reproduce

After building the full-table baselines, run from `mds/tr6/`:

```powershell
python tools/render_bd.py --tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py ch --tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py oh --tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py cy --tanh-bits 8 --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/compare_variants.py build/bd-comparison build/bd-lut8
python tools/compare_variants.py build/ch-comparison build/ch-lut8
python tools/compare_variants.py build/oh-comparison build/oh-lut8
python tools/compare_variants.py build/cy-comparison build/cy-lut8
python tools/check_family.py --package bd=build/bd-lut8/bd.mds --package ch=build/ch-lut8/ch.mds --package oh=build/oh-lut8/oh.mds --package cy=build/cy-lut8/cy.mds --out build/family-lut8.json
python -m unittest discover -s tests -p 'test_*.py'
```

Each candidate directory contains source, draft package, assembly/relocation
report, host scripts/logs, source/native raw audio and WAVs, `comparison.json`,
`baseline-comparison.json` and a local `compare.html` A/B page. Files are ignored
and remain local. If using the earlier eight-case CH/OH baselines, append
`--baseline-extra build/ch-boundary` or `--baseline-extra build/oh-boundary` to
the matching comparison command. Fresh baseline runs include those cases.

Assembly was independently checked at both linker placements by the package
builder. The default generators still reproduce committed full-table assembly.
Six profiler/comparison tests pass. Listening review and broader control/seed
coverage remain open. CPU work must simplify or restructure the oscillators,
noise and filters; compact tables alone cannot reach under 129 clocks/sample.
