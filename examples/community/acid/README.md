# OSCAC

A resonant acid bass: the original E12-AC voice's core, with its random-interval
generator and its slide and tonal behavior.

| Control | Range |
|---|---|
| PTCH | Base pitch, about 43 to 673 Hz before random intervals and quantization |
| DEC | Amp decay, 10 ms to 10 s |
| CUT | Filter cutoff, index 0 to 2047 |
| RES | Resonance, 0 to 127 |
| ENV | Filter envelope amount |
| FDEC | Filter envelope decay, the original 0 to 127 law |
| RAND | Random-interval amount, feeding the original eight interval classes |
| SLID | Centered at 64: the lower half also quantizes to minor pentatonic; distance from the center sets the glide time |

The first note jumps straight to pitch, as in the original. The interval class
chosen during a render applies to the next trigger. Both envelopes restart on
each trigger; phase, filter and glide state and the random generator carry over.
`init` clears all of the voice's state.
