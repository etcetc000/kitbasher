# PHYKS: eight-control Karplus–Strong string

An original plucked and hammered string voice built on the Karplus–Strong delay
loop. It uses its track's existing 1,536-word P-I delay slice, five local
coefficient tables and the 64-word voice block. It has no UW samples, DSP1 stage,
ColdFire code or shared routines, and it calls no external code.

| Control | Behavior |
|---|---|
| PTCH | raw = 2 × (MIDI − 24): MIDI 24..87.5 in quarter-tone steps (even values are semitones, 72 = C3); fractional delay |
| DEC | String feedback: 0.90..0.9999, with a square-root control curve |
| DAMP | Feedback-loop averaging: increasing it attenuates high harmonics |
| LEVL | Linear output level; zero is exactly silent |
| HAMR | Crossfade between a noise burst and a single positive hammer impulse |
| PICK | Excitation brightness; low values soften the pluck/hammer |
| BEND | Initial positive pitch bend, from zero to approximately one octave |
| BDEC | Pitch-bend envelope time constant, 1..250 ms, logarithmic |

HAMR changes the excitation; it does not select a different synthesis model.
PICK filters the excitation, while DAMP filters the recirculating string. BDEC
affects the sound only when BEND is above zero. The noise seed is deterministic
on assignment and advances between hits. Every control has a function.

The pitch table holds the whole loop delay with 12 fraction bits. Each block takes
the DAMP averager's own delay (DAMP/256 samples) off it and splits the rest into the
ring length and the fraction for a linear-interpolated tap between this sample and
the one before it, so every raw is in tune within 0.1 cent at any DAMP (it was up
to 40 cents out with an integer delay). The tap adds a little high-frequency loss
at fractions near one half. BEND updates the delay length once per 32-sample render block. This
is a deliberately small original implementation, not a port of any commercial
instrument's string model.

Version 1.0.0 changed only the tuning: PTCH keeps its law, and saved kits play the
same notes, now in tune.

## Trigger, clearing and ownership

Each trigger clears the track's delay slice in three 512-word chunks, one per
render block, with an interruptible `do` loop (no `rep`). Those three output
blocks are silent: 96 samples, about 2.18 ms at 44.1 kHz, from the first render
after the trigger. A retrigger restarts the clear and keeps the pending
excitation, so triggers repeated faster than the clear postpone the sound. This
is not a measured sequencer or MIDI onset latency.

The voice derives its slice from `md_track` on every render and keeps no pointer
or header in the delay memory. The manifest declares `chunked-muted`
initialization and `plain-audio` release: the next machine on the track, stock
P-I machines included, may hear the slice's last audio as it would after another
P-I machine.

## Export and check

```text
python packs/assembly_export.py examples/physical/ks --out my-packs/phy-ks --assembler /path/to/asm56.exe
```

The exporter reads only `model.json`, `dsp2.asm` and `tables.asm`. The pack has
257 DSP words, 640 table words and 21 relocations, and passes the eight
relocation placements. `make_tables.py` regenerates the five 128-entry tables
from their formulas; the exporter never runs it. `npm run test:assembly` checks
that a fresh export matches the bundled `catalog/physical-ks.json`.

`ci/ksstr_check.py` (`npm run test:ksstr`, with `dspHost` configured) runs the
linked code on a DSP instruction host and compares every sample against an
independent integer model of the delay loop: 47 cases and 245,760 samples,
covering both extremes of every control, muted level, pretrigger silence,
retriggers during clearing, control motion, poisoned neighbouring slices and
interleaved tracks 0 and 15. Every control changes the output, and neighbouring
slices stay untouched.

| Check | Result |
|---|---|
| Integer-reference comparison | Exact; 0 mismatches (1.0.0: track 0's 23 cases re-run on the current host, whose track-15 mapping fails before and after the change alike) |
| Worst render block, instruction host | 104.56 cycles/sample (0.2.0: 96.56; the fractional delay adds 8.0) |
| Init / trigger | 40 / 30 cycles |
| Declared budget | 129 cycles/sample (128 before 1.0.0); init 200, trigger 100 |
| Cold-cache bound | 128.7 cycles/sample (all 257 code words missed once per block, 3 cycles each) |
| Hardware | Not tested |

The cold-cache figure is an estimate, not a measurement: it does not include
data-memory wait states. The code occupies at most three of the eight 128-word
instruction-cache sectors. Switching PHYKS and a stock P-I machine on the same
track, and the burst test in [Firmware safety](../../../docs/FIRMWARE-SAFETY.md#hardware-burst-test),
have not been run on hardware yet.

## License

MIT (see [LICENSE](LICENSE)), compatible with Kitbasher's GPL v3 or later.
