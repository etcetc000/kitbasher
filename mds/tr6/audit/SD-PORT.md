# TR6-SD functional prototype

2026-10-09. The pinned Simple606 snare now has a complete fixed-point MDS
prototype. This is a simulator comparison milestone, before CPU optimization.

The port preserves the bent shell sine, shaped attack and transient, short
impact pulse, two wire band-pass filters, wire low-pass filter, shaped wire
attack, quiet ring oscillator, and shared decay gate. The source's xorshift32
stream and snare-specific lower-24-bit noise conversion are retained. The random
stream advances even at zero Snappy. Filters reset on retrigger; the random
stream continues. All four controls are captured at trigger.

## Controls and representation

| Control | Mapping from integer setting `i` | Default |
|---|---|---:|
| DEC | `max(0.01, i / 127)` | 102 |
| TUNE | `2 ** ((-12 + 24*i/127) / 12)` | 64 |
| SNAP | `i / 127` | 95 |
| COLR | Same ratio mapping as TUNE | 64 |

Fractional `raw14` values currently floor to the integer setting. TUNE and COLR
cover the plugin's 0.5..2 range on a semitone curve. Setting 64 is approximately
1.00547, not exactly unity. The reference harness uses these exact mappings.
Plugin accent routing is not included.

Audio/filter state uses Q20, envelopes Q23, and oscillator frequency retains
four fractional phase-step bits. Exponentials become recurrences with retained
fractional remainders. The shell and wire attack curves use finite tables of
512 and 137 samples respectively; the impact table has 61 entries. These are
coefficient/envelope tables, not recorded drum samples. Oscillators use the
imported sine table without interpolation. The generated program occupies
**3,372 P words** and uses **48 X state words**. Y1..4 supply parameters; the
package currently declares full 64-word X and Y worksets conservatively.

**Output gain is 0.5 (about -6 dB).** The original untrimmed prototype failed
the `[127, 0, 127, 127]` corner: source peak 1.044528 exceeded signed Q23 output,
producing 0.044528 peak clipping error. The fixed output trim supplies headroom
without changing the internal signal path. Tests divide native output by this
gain before calculating error against the original source. This keeps the
acceptance threshold in the untrimmed domain; making output quieter cannot
make a synthesis error pass. Paired WAVs use the same output trim for listening.

## Evidence and commands

From `mds/tr6`, using the toolchain described in [the kick report](BD-PORT.md):

```powershell
python tools/generate_sd.py
python tools/render_sd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
python tools/render_sd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --sweep-decay
python tools/render_sd.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST --corners --out build/sd-corners
python tools/check_state.py --assembler $env:MD_ASSEMBLER --host $env:MD_DSP_HOST
```

The seven base cases cover default, minimum, maximum, zero Snappy, low color,
retrigger every 4,384 samples, and ten silent blocks before triggering. Each
renders 32,768 samples at 44.1 kHz with seed `0x6063`. The decay sweep adds all
128 integer settings; the corner run adds all 16 combinations of four knobs at
0 and 127. Sweep/corner cases render 16,384 samples, sufficient for the entire
16,323-sample maximum decay. Reused `sweep.*` scratch files prevent each setting
from accumulating another set of large scripts; JSON retains every result.

The seven base cases pass the fixed **0.0003 peak-error limit before trim**.
The largest measured base error is 0.00007037. All 128 decay settings pass,
including exact active state, duration, final frame index, and random state.
All 16 knob corners pass; their largest error is 0.00007964. The default has
about 78.86 dB signal-to-error ratio. No perceptual equivalence is claimed.

Every comparison checks dirty-state initialization, reserved/parameter words,
unused state, output-buffer guards and poisoning, pre-trigger silence, final
activity, and idle zeros. The native random state matches the original C++
exactly, including zero Snappy and repeated triggers.

The separate state harness interleaves one kick and two differently configured
snares for 512 blocks each. Each track matches its isolated render bit-for-bit.
BD-to-SD and SD-to-BD reassignment on a dirty shared workset also match isolated
renders bit-for-bit. Changing snare parameters during a tail leaves output
unchanged until retrigger. These are instruction-host tests, not full firmware
dispatch or hardware tests.

The largest measured host cycle-table call across these cases is **18,099 per
32-sample block (565.59/sample)**. This excludes cache misses, interlocks,
external-memory waits, and dispatch. It already exceeds the under-129 target.
No cold-cache result or installable cycle declaration is claimed. Draft export
remains disabled, as for BD.

Remaining work includes fractional controls, additional seeds and sustained
multi-track stress, accent routing, listening review, target sine-resource
verification, CPU optimization, cold-cache timing, and hardware qualification.
