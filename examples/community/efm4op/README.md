# FMS4O

Four-operator FM with eight algorithms: the original EFM-4OP voice's optimized
operators, signed ratio behavior and block envelopes.

| Control | Range |
|---|---|
| PTCH | Raw = 2 × (MIDI − 24): MIDI 24 (C0, 32.7 Hz) at 0 to 87.5 (1.28 kHz) at 127, in quarter-tone steps; even values are semitones (72 = C3) |
| DEC | Amp decay, 10 ms to 10 s |
| ALGO | One of eight algorithms |
| RAT1, RAT2 | One of sixteen ratios each |
| LVL | Level, a fractional gain |
| MENV | Modulator envelope decay, 10 ms to 10 s |
| FB | Feedback, a fractional gain |

It reads the OS sine table through the relocatable `md_sine` service and needs no
fixed ID, shared scratch or sample bank.
