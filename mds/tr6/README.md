# TR6

TR-606-inspired X.20 MDS ports of the pinned Simple606 DSP. Functional ports come
first; the optimization target is **under 129 cold-cache clocks per sample**.
The target firmware's separate admission requirements also need verification.

The family is BD, SD, LT, HT, CH, OH, CY, with CP as an extension. Work is in
progress. Nothing here is hardware-qualified or ready for installation.

- [Viability audit](audit/TR6-VIABILITY.md)
- [Desktop reference renderer](audit/reference_render.cpp)
- [Source and tool setup](tools/bootstrap.py)
- [Kick port, comparison results, and remaining gaps](audit/BD-PORT.md)
- [Snare port and state-isolation evidence](audit/SD-PORT.md)
- [TX8/TX9 and lab optimization findings; ordered-trace profiler](audit/OPTIMIZATION-INPUTS.md)

From this directory, with Python 3.11+, Clang C++14, and configured absolute
assembler/instruction-host paths:

```powershell
python tools/bootstrap.py
python tools/generate_bd.py
python tools/generate_sd.py
python tools/smoke.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_bd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_sd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

The host must support the script protocol documented in the kick report.
The resulting `.mds` packages have a zero cycle declaration and are development
artifacts. No installable SysEx is emitted. LT, HT, CH, OH, CY and CP remain to be
ported; the kick and snare are not yet optimized or cold-cache qualified.

Keep downloads in `.audit-sources/`, tools in `.tools/`, and generated output in
`build/` or `audit/results/`; all are ignored. No firmware or personal lab data
belongs in this directory or its pull request.
