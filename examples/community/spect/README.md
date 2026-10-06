# WAVSP

A spectral-array oscillator: the original E12-SP voice, with both 64 x 24
spectral banks, all 24 harmonics, scanning, focus and tilt. It updates four
harmonics and at most two waveform cycles per render.

| Control | Range |
|---|---|
| PTCH | About 43 to 673 Hz |
| DEC | Amp decay, 10 ms to 10 s |
| ARRY | All 128 spectral arrays |
| TILT | Spectral tilt, the original 0 to 2047 law |
| PART | Harmonics, the original 1 to 24 law |
| FOCS | The original focus regions |
| SCAN | Scan speed, all eight period classes |

A trigger restarts the envelope and the scan, and keeps the phase and the current
spectrum.

WAVSP keeps 153 words of per-track scratch: 129 guarded cycle samples and 24
harmonic amplitudes. It declares them in its manifest (`kind: "private"`) and
`init` clears the whole span, so no other model's memory is borrowed; see
[Model packs](../../../docs/MODEL-PACKS.md#memory-a-model-can-declare).

The original's pitch-to-tilt lookup adds an octave offset to its note-table
index and can read past the end of the 32-word table. Here the table repeats
across four octaves (128 words), so the lookup stays inside it. The synthesis instructions are otherwise unchanged.
