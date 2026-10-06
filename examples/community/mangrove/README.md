# FORMT

A formant oscillator after the original P-I MG voice: formant ratio with octave
folding, barrel shaping, air saturation, a square sub and feedback FM. Despite
the original's P-I name it needs no delay buffer; all of its state sits in its
voice block, and it uses the OS sine table.

| Control | Range |
|---|---|
| PTCH | 32.7 x 2^(value/24) Hz, in knob steps |
| DEC | Amp decay, 10 ms to 10 s |
| FRMT | The original formant-ratio and octave-fold mapping |
| BRRL | Barrel shaping, quadratic gain |
| AIR | 0.25 + value/64 |
| SQR | Square sub level, quadratic gain |
| FMFB | Feedback FM, eight levels from zero to one half |

The last knob is unused. A trigger resets the envelope and oscillator phase and
keeps the feedback and high-pass history. The voice keeps rendering through
inaudible tails, so later notes behave as in the original.
