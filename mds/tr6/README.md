# TR6

TR-606-inspired X.20 MDS ports of the pinned Simple606 DSP. Functional ports come
first; the optimization target is **under 129 cold-cache clocks per sample**.
The target firmware's separate admission requirements also need verification.
Optimization may trade perceptual fidelity for CPU, with the full-path ports
retained as references and changes documented through comparison renders.

The family is BD, SD, LT, HT, CH, OH, CY, with CP as an extension. Work is in
progress. Nothing here is hardware-qualified or ready for installation.

- [Viability audit](audit/TR6-VIABILITY.md)
- [Desktop reference renderer](audit/reference_render.cpp)
- [Source and tool setup](tools/bootstrap.py)
- [Kick port, comparison results, and remaining gaps](audit/BD-PORT.md)
- [Snare port and state-isolation evidence](audit/SD-PORT.md)
- [Low/high tom ports and comparison evidence](audit/TOMS-PORT.md)
- [Full 47-partial hats/cymbal engine and external-state checks](audit/METAL-PORT.md)
- [Clap extension, FIR/reconstruction path and comparisons](audit/CLAP-PORT.md)
- [TX8/TX9 and lab optimization findings; ordered-trace profiler](audit/OPTIMIZATION-INPUTS.md)

From this directory, with Python 3.11+, Clang C++14, and configured absolute
assembler/instruction-host paths:

```powershell
python tools/bootstrap.py
python tools/generate_bd.py
python tools/generate_sd.py
python tools/generate_toms.py
python tools/generate_metal.py
python tools/generate_clap.py
python tools/smoke.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_bd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_sd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_toms.py lt --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_toms.py ht --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py ch --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py oh --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_metal.py cy --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_clap.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_clap_tables.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_family.py
```

The host must support the script protocol documented in the kick report.
The resulting `.mds` packages have a zero cycle declaration and are development
artifacts. No installable SysEx is emitted. All eight drum ports are still
unoptimized and not cold-cache qualified.
The aggregate draft code and package sizes also exceed the published library
capacity field widths; individual package fit does not establish kit fit.

Keep downloads in `.audit-sources/`, tools in `.tools/`, and generated output in
`build/` or `audit/results/`; all are ignored. No firmware or personal lab data
belongs in this directory or its pull request.
