# OSCSP

A saw and pulse synth: the original E12-JU voice's core, with PWM, a sub
oscillator and a detuned second oscillator pair.

| Control | Range |
|---|---|
| PTCH | Raw = 2 × (MIDI − 24): MIDI 24 (C0, 32.7 Hz) at 0 to 87.5 (1.28 kHz) at 127, in quarter-tone steps; even values are semitones (72 = C3), with fractional interpolation |
| DEC | Amp decay, 10 ms to 10 s |
| TONE | Filter coefficient, from near zero to near one |
| PWM | Pulse width, 0 to 127 |
| SUB | Sub oscillator level, 0 to about 0.25 |
| CHOR | Detune of the second oscillator pair, 0 to 127 |

Phase and filter state carry over between triggers. CHOR detunes rather than
running a delay-line chorus, so the voice needs no sample bank or delay buffer.
The last two knobs are unused; their labels are empty, so the Machinedrum hides
them.
