# Existing lab perceptual scoring for TR6

TR6 uses the established optimization-lab `score_audio.py` and `perceptual.py`,
not a new RMS or spectral-centroid scoring algorithm. `mel-proxy-v1` compares
salience-weighted mel-band levels at FFT sizes 256, 1,024 and 4,096 with a
quarter-window hop. Lower loss is closer; units are weighted mel-band dB
differences, not percentage degradation or a calibrated audibility threshold.
Worst-frame/p95, attack-envelope, tail, level, clipping, DC and polarity
diagnostics remain separate. The lab exports worst-ranked listening pairs.

`tools/score_variants.py` validates case coverage, controls, samples, output gain
and actual host-script trigger schedules, then calls the external lab CLI.
It stages only the native int32 Q23 streams. Float32 desktop `.reference.raw`
files never enter the scorer's raw-input glob. Full native reference ports are
the fidelity baseline even when a candidate's numerical test uses a modified
C++ model. No time alignment, resampling or gain normalization is applied.

Each scoring run uses a new directory and retains raw input hashes, available
assembly/package/control/script/log hashes, adapter/scorer hashes, dependency
versions, configuration and the original case metadata. These first runs score
retained renders. Their artifact provenance is captured at scoring time; it
does not retrospectively attest the original render-tool binary identities.
Future render-and-score runs should capture source/host identity at execution.
The existing timing reports retain their separate host-tool hashes and limits.

## Paired native results

All **86 pairs** were scored: five BD compact-table cases, nine compact-table
cases for each metal voice, and nine cases for each of six reduced-model
voice/partial-count combinations. All reports have zero categorical flags; that
does not make the differences acceptable. Envelope errors below are measured
at actual output gain (BD unity, metal 0.5), not before the documented trim.

| Candidate | Cases | Median loss | p95 loss | Worst loss | Worst spectral case | Largest 1 ms envelope error FS |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| BD compact table | 5 | 0.00773 | 0.00862 | 0.00873 | maximum | 0.0000742 |
| CH compact table | 9 | 0.00763 | 0.00923 | 0.01007 | maximum | 0.0001231 |
| OH compact table | 9 | 0.00793 | 0.01149 | 0.01154 | maximum | 0.0001271 |
| CY compact table | 9 | 0.00679 | 0.00853 | 0.00900 | maximum | 0.0001435 |
| CH 3, no wobble | 9 | 0.77017 | 1.15385 | 1.26883 | short high pitch | 0.05845 |
| CH 6, no wobble | 9 | 0.76491 | 1.14208 | 1.26312 | short high pitch | 0.04701 |
| OH 3, no wobble | 9 | 0.61240 | 0.77578 | 0.83344 | maximum | 0.04253 |
| OH 6, no wobble | 9 | 0.63117 | 0.78591 | 0.83752 | maximum | 0.04219 |
| CY 3, no wobble | 9 | 0.69894 | 0.80460 | 0.81881 | low pitch | 0.07672 |
| CY 6, no wobble | 9 | 0.66819 | 0.80553 | 0.82016 | low pitch | 0.07696 |

Reduced-model worst-frame distances reach 3.81 dB, versus 0.114 dB or less in
the compact-table tests. CH's largest three-partial envelope error is a retrigger
case, while its largest spectral loss is the short/high-pitch case. Ranking by
overall RMS alone would miss this distinction. The extra three partials cost
4,224 raw clocks/block without a consistent improvement across the paired
spectral and transient diagnostics. This motivates testing the faster option
further; it does not constitute listening acceptance or CPU qualification.

## Reproduce

The external lab currently lives at
`md-firmware-mod/lab/optimization-lab/`. Its pinned dependencies are NumPy 2.3.5
and SciPy 1.17.0; this run used Python 3.14.2. Neither private firmware nor scorer
source is copied into Kitbasher. Providing these external tools remains a setup
requirement for reproducing scores outside the local workspace.

```powershell
python tools/score_variants.py build/bd-comparison build/bd-lut8 --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-v1/bd-lut8
python tools/score_variants.py build/ch-comparison build/ch-p3-static-lut8 --allow-model-change --lab $env:MD_OPTIMIZATION_LAB --out build/perceptual-v1/ch-p3-static-lut8
```

Repeat the second command for OH/CY, 6 partials and the compact-table-only
directories. Earlier CH/OH baseline directories need `--baseline-extra
build/ch-boundary` or `build/oh-boundary`. Fresh full baseline runs include those
cases. Do not reuse an output directory. Reports and audition files are in
`build/perceptual-v1/{variant}/scores/`; `summary.md` links the selected WAVs.

Scorer SHA-256 identities for the paired results:

```text
perceptual.py 39454813fbce1db78d71a6ab1c35de56b7bf43c7d928ac811e0bc509a898318a
score_audio.py ea0be78d5e1133e13563316341108fb4e50e8518b337353f6c6d01a0585bcd38
```

All nine existing lab perceptual tests pass, including silence/identity,
gain preservation, polarity, pitch/noise ranking, transients, tails and input
handling. Local A/B guards remain separate from the perceptual scorer.

## Multi-seed model probe

`tools/score_metal_ensemble.py` invokes the existing external `wmd_stats.py`
ensemble method, without copying its algorithm. For each voice's default and
maximum settings it renders 16 original C++ seeds, split into two disjoint groups
of eight, plus eight matching seeds for each reduced C++ model: **192 renders**.
It scores mean mel-band power across seeds and records the original split-group
distance for context. Both sides use the same 0.5 output gain. No renormalization
or time alignment is performed. Source, executable, scorer and audio hashes,
seed lists, controls and final RNG states are retained in `report.json`.

| Voice/case | Original disjoint-group distance | Three-partial distance | Six-partial distance |
| --- | ---: | ---: | ---: |
| CH default | 0.72427 | 0.22108 | 0.22087 |
| CH maximum | 0.68082 | 0.30386 | 0.29547 |
| OH default | 0.73585 | 0.25562 | 0.25231 |
| OH maximum | 0.69182 | 0.33789 | 0.33467 |
| CY default | 0.75749 | 0.26908 | 0.26307 |
| CY maximum | 0.71965 | 0.28550 | 0.28106 |

Six partials improve ensemble spectral loss by 0.00020–0.00839 here, while adding
4,224 raw clocks/block (about 20%). This supports using three partials for the
next CPU experiment and retaining six as a comparison. The independent-group
distance is **not an acceptance threshold**: the candidate/reference groups
share seeds and noise while the original split groups do not. Ensemble averaging
can also hide individual attack or transient problems. No WMD-specific threshold
is transferred to TR6.

This is a floating-point **model probe**, not additional native DSP seed coverage
or a listening verdict. Native default-seed comparisons and state checks remain
separate. The existing `wmd_stats` windowing/ensemble aggregation differs from
the paired `perceptual.py` calculation; do not compare their numeric scales as
equivalent scores. Native multi-seed extremes, quiet tails and listening still
need qualification before accepting the approximation.

```powershell
python tools/score_metal_ensemble.py --scorer $env:MD_WMD_STATS --out build/metal-ensemble-v1
```

`MD_WMD_STATS` points to `md-firmware-mod/tools/wmd_stats.py`, SHA-256
`119ff1f8c5016c95f5fe441d3768b1f456736065937ea5fe710ff526c783657f`.
The C++ reference's optional seed argument leaves its original default behavior
unchanged. All ensemble artifacts remain local and ignored.
