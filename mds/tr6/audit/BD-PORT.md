# First TR6-BD port

2026-10-09. This is a functional simulator prototype, before CPU optimization.
It is not an installable or hardware-qualified machine.

These are the original baseline results. The later
[cutoff correction and optimization audit](BD-OPTIMIZATION.md) records a fixed
envelope condition-code bug, current timing and an idle-retrigger numerical
limitation discovered by the expanded checks.

The full Simple606 kick path is translated: swept sine body, independent click
and impulse envelopes, the source xorshift32 noise, low-pass filters, impulse
high-pass biquad, saturation, DC removal, output trim, and plugin heat. Trigger
captures transient, decay, tune, and XL; heat is read each block. Analog pitch
jitter is zero in both implementations. Plugin accent routing is not implemented.

## Numerical representation

- Audio and filter state use Q21, providing four-times headroom relative to Q23.
- Envelopes use Q23; body amplitude is stored divided by two. Fractional update
  remainders keep quiet tails from disappearing prematurely.
- Phase wraps at 24 bits and indexes the imported 32,768-entry sine table.
  Frequency retains six additional fractional bits; pitch-sweep remainders are
  carried between samples. The sine lookup is not interpolated.
- Trigger coefficient tables cover the 128 integer knob settings. Fractional
  `raw14` values currently floor to that setting. This is a documented modulation
  limitation, not full parameter-lock qualification.
- Saturation uses an 8,193-entry table over +/-4 with linear interpolation.
  Inputs stay inside this range in the tested cases. A broader range proof is
  still required before release.
- The output DC blocker retains its fractional remainder to prevent an idle
  limit cycle. Dirty state is explicitly initialized; silence writes 32 zeros.

The generator is the editable source; regenerate `machines/bd/bd.asm` after a
change. The generated program currently occupies **10,517 P words**, mostly
lookup tables. It uses 39 X state words and reads Y1 through Y5; the prototype
conservatively declares the full 64-word X and Y worksets. Program-memory fit
for the entire family is not established.

## Comparison evidence

`tools/render_bd.py` compiles the pinned, unmodified Simple606 headers using
Clang 22.1.8, C++14, `-O2` without fast math. The test harness exposes private
state for diagnostics without changing DSP expressions. Both implementations
run at 44.1 kHz with seed `0x606606` and identical knob mappings. Native DSP
output is compared with the reference float samples before WAV quantization.

| Case | Samples | Peak absolute error | Signal-to-error dB | Largest host cycle-table call |
|---|---:|---:|---:|---:|
| Default | 131,072 | 0.00008669 | 79.23 | 14,105 |
| All controls minimum | 131,072 | 0.00004894 | 79.23 | 14,123 |
| Maximum, XL and heat on | 524,288 | 0.00364670 | 43.13 | 15,333 |
| Retrigger every 4,384 samples | 131,072 | 0.00008801 | 79.88 | 13,619 |
| Ten silent blocks before trigger | 131,072 | 0.00008669 | 79.23 | 14,105 |

These are numerical comparisons, not listening judgments. The fixed peak-error
bounds are 0.0002 for the ordinary cases and 0.005 for maximum XL/heat. The latter
has a known oscillator difference: float32 updates in Simple606 settle at
102.4828568 Hz despite a target of 102.4800034 Hz. The port settles at
102.4800215 Hz. At sample 262,144 the phases are 3.964474 and 3.878921 radians.
The resulting drift is material to long waveform comparisons even though the
frequency difference is small. This is evidence of a numerical difference, not
proof of perceptual equivalence. Other fixed-point/filter differences remain.

All five cases also check output-buffer poisoning, neighboring output canaries,
reserved Y0 and every parameter word, unused state canaries, and final source/
native activity agreement. All single hits reach inactive state and end with a
zero block; retrigger remains active. Registers are scrubbed before each render.
The separate relocated-sine smoke test is bit-exact for 256 samples. Packaging
checks local and imported relocations against fresh assembly at two unaligned
program placements.

## Timing and toolchain limits

**The prototype exceeds the target before cache costs.** The largest measured
render call is 15,333 cycle-table clocks, or 479.16 per sample. These counts
exclude DSP56303 pipeline interlocks, instruction-cache misses, external-memory
wait states, and firmware dispatch. They must not be presented as cold-cache
results or copied into an admission declaration. No cold-cache result exists yet.

The current workflow requires an external DSP56303 assembler compatible with
Kitbasher's `packs/assembly.py`, and a `dsphost` instruction host. Tested binary
SHA-256 hashes:

```text
asm56:   63caeafa9ebef542d44848dc8bb5b0086a2e39b022fad643eb2801b504de0c24
dsphost: f615bfd80a90e51e7840fad00804ac9593822374f44d79d58ab11c5a90b9098f
```

The host accepts `dsphost SCRIPT OUT.raw`, with script commands `load P|X|Y`,
`set X|Y`, `voice`, `call`, `scrub`, `cycles`, `out`, and `dump`. Loads are packed
big-endian 24-bit words; output is little-endian sign-extended int32. `call`
supplies R6=voice, R7=0x100, M7=31 and linear M0..M6. Script addresses and dump
counts are hexadecimal. Generated scripts use relative filenames because the
host parser splits on whitespace. Neither binary nor the private lab is bundled;
a public host build recipe remains a reproducibility gap.

No firmware image is loaded. The host sine resource is generated mathematically
for these tests; it has not been compared with a device's actual sine resource.
The MDS package parser accepts the draft, but its zero cycle declaration prevents
upstream SysEx conversion. There is no claimed on-device install or timing pass.

Still required: the other voices, fractional controls, all parameter corners and
changes during tails, reassignment and multi-track isolation, listening review,
portable host setup, cold-cache measurement, CPU and shared-table optimization,
family resource fit, final package/SysEx validation, and hardware checks.
