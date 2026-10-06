# FM4OP

Four-operator FM with eight algorithms: the original EFM-4OP voice's optimized
operators, signed ratio behavior and block envelopes.

| Control | Range |
|---|---|
| PTCH | MIDI note, with fractional interpolation |
| DEC | Amp decay, 10 ms to 10 s |
| ALGO | One of eight algorithms |
| RAT1, RAT2 | One of sixteen ratios each |
| LVL | Level, a fractional gain |
| MENV | Modulator envelope decay, 10 ms to 10 s |
| FB | Feedback, a fractional gain |

It reads the OS sine table through the relocatable `md_sine` service and needs no
fixed ID, shared scratch or sample bank.
