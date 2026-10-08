# Firmware safety

> **Use at your own risk.** Kitbasher is provided as is, without warranty of any
> kind; see sections 15 and 16 of the [GPL v3](../COPYING). The rules below lower
> the risk of a bad build; they do not remove it. Installing modified firmware can
> make your Machinedrum unusable, and the authors and contributors accept no
> liability for damage, data loss or repair costs.

A patched OS runs on three processors: the ColdFire (MCF5206e) that runs the
OS, DSP1 (the mixer) and DSP2 (the voices). Every rule below comes from a build
that crashed, froze or corrupted a Machinedrum, most of them on a MKII +Drive UW.
Each rule gives the failure it prevents, what enforces it, and how to check it
on hardware.

Read this before you change DSP code, the boot chain, flash or RAM layout, or
anything that talks to the DSPs. For model cost and state rules, see
[What a model contribution should show](../CONTRIBUTING.md#what-a-model-contribution-should-show).

**Recovery always works.** Kitbasher never touches the boot block (flash below
`0x4000`) or the bootstrap-rewrite routine, and refuses a base that has changed
either. If a flashed OS hangs, hold FUNCTION while powering on, choose MIDI
upgrade, and send your original OS file. Keep that file before you flash
anything.

## Contents

1. [ColdFire instructions](#1-coldfire-instructions)
2. [Boot-time memory](#2-boot-time-memory)
3. [Talking to DSP1 and DSP2](#3-talking-to-dsp1-and-dsp2)
4. [DSP timing](#4-dsp-timing)
5. [Overload, watchdog and recovery](#5-overload-watchdog-and-recovery)
6. [DSP code correctness](#6-dsp-code-correctness)
7. [Data correctness](#7-data-correctness)
8. [What the emulator cannot show](#8-what-the-emulator-cannot-show)
9. [Release procedure](#9-release-procedure)

## 1. ColdFire instructions

**Rule.** Every ColdFire instruction we add, and every instruction a patched word
lands in, must be ISA_A for the MCF5206e: no 68020 forms, no ISA_B/ISA_C, no
FPU, and no MAC in our code. Divide is allowed.

**Why.** `movem.l d0-d1,-(sp)` is a 68000/68020 form that ColdFire lacks.
Emulators run a 68020 core and execute it happily, so an image passed every
emulator check. On hardware, the first trigger of every newly added machine froze
the unit with the trig LED lit.

**Enforced.** The `isa` build gate (`engine/src/isa.ts`, `isa_gate.ts`,
`isa_scan.ts`) runs on every build. It decodes our code and the base's patched
code by recursive descent from every entry point, in the final image as read
back. Rewritten base code (the control-all loop skip and the CPU indicator's
flush hook) is decoded straight through from its start. Stock X.14 and 1.63 must
decode with zero rejects; that is the decoder's positive control.
`engine/test/isa_unit.test.ts` keeps the negative control: a planted
`movem.l d0-d1,-(sp)` and `bfextu` must be rejected.

**Verify.** Trigger each added machine once, and switch machines on a track, on
a fresh boot.

## 2. Boot-time memory

**Rule.** At boot, write only to main RAM or the base's initialized SRAM span.
Never store into flash, and never fetch code through the runtime flash alias
(`0x10000000`): the OS has not mapped it yet. Flash relocations go into the
output file, never into the boot patch list.

**Why.** A build queued ordinary stores to flash relocation sites as if they
were RAM. The emulator ignored the writes, and the unit hung on the boot screen.

**Enforced.** `engine/src/boot_safety.ts`:

- `assertBootRamWrites` refuses a boot patch destination outside main RAM or
  initialized SRAM.
- `assertEarlyInitializer` requires an early initializer to enter through low
  flash, to be ISA_A, to end in `rts`, and to call only initialized RAM.
- The `isa` gate re-reads the emitted boot routine and patch table from the
  final image. It refuses any loop shape it does not recognise before trusting
  the counts.

`engine/test/boot_safety.test.ts` replays the historical bad destinations. The
`boot-routine` gate checks that the hook chains onto the base's own add-on.

**Rule.** Keep ColdFire RAM additions inside the window the base profile
declares: `0x2bc000..0x2bd000` for the RAM image and `0x2be100..0x2bef60` for the
dynamic-label segment. The window must sit above the heap's peak and below every
address the base's code uses.

**Why.** On a MKII +Drive UW, boot writes from `0x2bd000` upward froze the unit
at the boot logo. The same image without those stores booted. No emulator models
this, so only hardware-proven ranges are used.

**Enforced.** The `ext-ram` and `dyn-segment` gates, together with the
`ram.window` in each `bases/*.json` profile. The CPU indicator stub is refused by
name if it would end past the window. With MIDI chromatic note input the whole RAM
image must end inside the span earlier images ran from on hardware
(`0x2bc000..0x2bce14`): descriptors move to flash first, and the `midi-chroma`
gate refuses an image that still ends past it. See [Supported bases](BASES.md).

**Rule.** Boot-time code must not use the stack before the OS sets one up: no
register pushes as the boot routine's first action.

**Why.** A boot routine that began by pushing registers froze at boot.

**Enforced.** The emitted boot routine is a fixed copy/patch/jump shape. The
read-back in `boot_safety.ts` refuses any other shape.

**Verify.** Watch the first boot after flashing reach the main screen. Then
power-cycle and boot again.

## 3. Talking to DSP1 and DSP2

The ColdFire reaches each DSP through its HDI08 host port. A transaction is a
fixed sequence: a host command (a vector write to CVR) plus one or more data
words that the DSP's handler expects in order. The real port buffers about two
words.

**Rule.** Send exactly the way the stock sender does: interrupts masked, words
written in order, no status polling. Never add a bounded poll (wait N times,
then give up) to a sender.

**Why.** An early DSP1 drive transport polled TRDY with a 256-iteration limit.
When the limit ran out after the host command, DSP1's handler was left armed and
waiting for words that never came. The next stock send was taken as the missing
words, which shifted the stock parameter stream by two words and put stock data
into the drive selector. The result was the DSP1 selector half-transaction:
8 of 48 selector switches never landed, and one rebuild left a garbage selector
on all 16 tracks. A transaction abandoned midway leaves the DSP's intake out of
frame for good.

**Enforced.** The DSP1 drive transport in `catalog/core.json` sends with the stock
sequence. The `host-reorder` gate (`engine/src/coldfire.ts` `hostSendCheck`)
checks the reordered DSP2 sender property by property: stock entry, word order,
CVR after both words, and stock's own data loop byte for byte. It is opt-in and
qualified per base (see [Supported bases](BASES.md#features-per-base)).

**Rule.** Keep work out of the ColdFire's per-step trigger loop. That loop runs
with interrupts masked and calls the DSP1 sender for every track. Anything hooked
into it must be O(1) when nothing changed.

**Why.** The first DSP1 drive hook did a full table lookup and register save on
every call. One step with 12-16 tracks triggering froze the audio with CPU! lit.
It never reproduced in the emulator, and it was found by a hardware bisect.

**Enforced.** The transport caches each track's last machine ID and exits early
(15 instructions, no lookup) when the ID has not changed. No static gate can see
this; the burst test in [section 9](#hardware-burst-test) can.

**Rule.** Any additional writer to a host port must own it for the whole
transaction, by masking the OS's writer or taking its lock. The OS issues a host
command roughly every 200 µs.

**Why.** An experimental loader interleaved its writes with the OS's. An OS
command slipped between a vector write and its arguments, and over a thousand
words landed at a wrong address.

**Rule.** Patch every copy and every call site. Some bases upload the same DSP
code twice, or call a sender from their add-on as well as from the OS.

**Why.** A missed add-on call left the drive selectors at zero on one base.

**Enforced.** Discovery finds sites by signature and fails closed. The
`clean-recovery` gate refuses a build if any copy of the retirement code differs
from what it expects ([Supported bases](BASES.md#x14)).

**Verify.** Switch drive laws on several tracks and confirm each one lands.
Then run the burst test.

## 4. DSP timing

**Rule.** Never remove or add stock pacing (padding loops, waits) on any
processor without a hardware burst test. Pacing is part of the protocol: DSP2's
per-track pace clocks the ColdFire's parameter streaming.

**Why.** The drive hook had replaced a stock 480-cycle DSP1 pacing pad, which
contributed to the 12-16-trigger freeze. Separately, an experiment that let
DSP2 skip ahead on silent tracks starved the ColdFire's stream, and triggers
were lost nondeterministically.

**Enforced.** The only pacing change shipped is the DSP2 idle-stub trim
(`engine/src/stub_trim.ts`, `stub-trim` gate). It cuts the silence stub's pad
loop from 50 passes to 1, a one-word change. The stub is found by its exact
words, and a stub of any other shape is left alone. Silent tracks stay bound to
the link's handshake, so the stream keeps its length. It was proven only after
the transport fast path and the interruptible P-I clean were in, and it held
the full burst test. `--no-stub-trim` keeps the stock stub.
`engine/test/stub_trim_unit.test.ts` covers it.

**Rule.** No long non-interruptible `rep` on a DSP path. `rep` blocks host and
DMA interrupts for its whole count. Use an interruptible `do` loop.

**Why.** The P-I slice clean zeroed 1,536 words with `rep #$600`. On a stock P-I
kit, a trigger on the P-I bass drum overran the CPU instantly. A one-word change
to `rep #1` proved that the clear was the cause.

**Enforced.** `engine/src/pi_clean.ts` clears with `do` (two stores per pass)
and is checked by the `pi-clean` gate.

**Rule.** P-I INIT is lazy: it runs on the first trigger after a machine change
or kit load, not at assignment. A kit load can run init on all 16 tracks in one
block. Expensive init lands on that first hit, so chunk bulk clears across
blocks (around 128 words per block) and keep the output muted until the clear is
done.

**Verify.** Load a stock P-I kit and double-hit the P-I bass drum straight
after the load.

## 5. Overload, watchdog and recovery

**Rule.** Know the stock DSP1 watchdog. DSP1 counts blocks that DSP2 delivered
late. On the third in a row, it stops the output DMA and spins forever, and the
unit stays silent until power-cycled. Half a percent over budget for three
blocks is enough to trip it.

**Enforced.** `engine/src/watchdog.ts` decodes it word for word.
`--dsp1-watchdog N` is a debug option that raises the trip count; it does not
make a kit fit.

**Rule.** Recovery must be clean: mute, recover and return without leaving a
tone, a frozen UI or corrupted voices. The default `--clean-recovery`
(`engine/src/clean_recovery.ts`) makes these changes without replacing any model
code:

- the overrun handler recovers instead of halting (`recover.ts`);
- DSP1 arms its receive DMA before releasing DSP2 (`handoff.ts`);
- output pacing (`outputpace.ts`) and a paced output clear (`clearpace.ts`);
- DSP2 voice retirement at the block boundary when rendering falls behind the
  codec (`retire.ts`).

**Why.** Earlier recovery attempts caused new failures:

- **A replayed half-buffer** played as a 1,378 Hz tone.
- **A mid-block re-arm** spliced voices together.
- **A `do` loop inside the handler** overwrote the saved status register. The
  main loop then resumed with interrupts masked: permanent silence with the UI
  alive, or a full freeze.

So the handler uses no system stack between saving and restoring it. It
resyncs only when DSP2 is proven parked, and it never writes DSP2's voice feed.

**Enforced.** The `dsp1-recover` gate, including its stack check, and the
`clean-recovery` gate. Hook anchors must match the base word for word, unknown
anchors fail closed, and the retirement area is reserved before models are
placed. `engine/test/recover.test.ts`, `clean_recovery.test.ts` and
`ordered_recovery.test.ts` model the handler.

**Rule.** The CPU indicator (`--cpu-indicator`, `engine/src/indicator.ts`) only
reports overruns. It reads DSP1's host flags, which costs DSP1 nothing. It shows
an inverted "CPU!" box over the transport icons and clears about 0.5 s after the
last overrun. It needs DSP1 recovery. The `cpu-indicator` gate reads back the
stub and its two hook words.

**Known gap.** A heavy overload can still leave later triggers sounding
ring-modulated or sample-rate-reduced until a power cycle. This is unsolved.
Recovery keeps the instrument playable; it does not make a kit fit.

**Verify.** Overload on purpose: 16 copies of a heavy model on one step, or a
control-all sweep of a mode knob on 16 tracks. Pass if CPU! appears and clears,
no tone remains, the UI and transport still respond, and later triggers sound
clean.

## 6. DSP code correctness

**Rule.** Nested `do` loops must not share an end address. Give each loop its
own last instruction.

**Why.** A ported noise-synth program had two nested loops that ended on the
same word. The real DSP56300 left state on its hardware stack every block, while
the emulator handled it differently. The result was a DSP2 hang on the first
trigger that recovery could not clear.

**Rule.** Restore every modulo register you set, and set `M` registers inside
your own call: the dispatcher resets them between tracks. Never set a modulo
register on a table that is not aligned for it. Recovery code that borrows `R0`
must set `M0` linear first.

**Why.** An inherited modulo register wrapped a 384-word clear into 32 words,
and stale output replayed.

**Rule.** Every block writes all 32 samples. Init clears everything it reads:
DSP2 external RAM holds power-on garbage on hardware (the emulator reads zero),
and the previous machine on the track leaves state behind.

**Rule.** Mind the instruction cache. DSP2 runs from external RAM through a
1,024-word cache of 8 sectors of 128 words. A per-block path spanning 8 sectors
or fewer is fetched once for all 16 tracks; one spanning 9 is refetched on every
track. What counts is the code's start address modulo 128, not just its length.
Plain 128-word alignment costs some machines 15-17 cycles per sample per track.
A knob-change block must keep the settled path plus the change path within 8
sectors. Control-all turns a knob on 16 tracks at once: one model played clean
when static and stalled under control-all, because its knob decode spanned 11
sectors.

**Enforced.** A pack carries a measured offset mask per model
(`engine/src/align.ts`). The `cache-align` gate places each masked machine on an
allowed offset and refuses a mask measured for different code
(`engine/test/align_unit.test.ts`). When code changes, re-measure the mask. The
loop-shape and modulo rules have no automatic check yet: they are review items
for every DSP change.

**Verify.** Run the model at worst case (static, one knob turning, then
control-all) on 16 tracks.

## 7. Data correctness

**Rule.** A trim that shortens data must respect every reader of its length. The
E12 machines that play a body and a ring sample stop at the body's length. If the
body is cut shorter than its ring, the player parks inside the ring and repeats
a 32-sample window: a 1,378 Hz tone.

**Enforced.** Pair-aware trimming in `engine/src/e12.ts` cuts both samples of a
pair to the same length. See [Making room](ARCHITECTURE.md#making-room).

**Verify.** Apply a hard trim, then play E12-SD and E12-RS at RING 0/32/64 with
long decay. Pass if no tone appears in the tail.

**Rule.** A UW sample set must be at least as long as the firmware it is used
with expects. A model that finds its sample shorter than its built-in length
constant plays silent.

**Why.** After a firmware update, wavetable models went silent: their older UW
sets were shorter than the new build's constants.

**Enforced.** Each sample a model needs is declared in its manifest with
`minimum_words` and a `without` description
([schema](model-manifest.schema.json)), and the page lists the samples a build
needs. `packs/uw_asset.py` checks a generated SysEx file's framing and declared
length. Send UW data with the SDS handshake; an open-loop send failed with
"wrong packet".

**Verify.** After sending samples, play every UW-dependent model.

**Rule.** IDs 124-127 sit inside the OS's "control machine" range tests. Added
machines there need those tests narrowed. Otherwise knob values snap back, the
level bar freezes, the defaults are wrong, and FUNCTION + knob (control all)
reaches only one track.

**Enforced.** `engine/src/ctr_controlall.ts` and the `ctr-coverage` and
`ctr-controlall` gates. Every site is found by signature; a missing site is
reported, never guessed.

**Verify.** Put a machine on 124-127 on 16 tracks, hold FUNCTION and turn a
knob. All 16 tracks should move, while stock CTR machines still move only one.

## 8. What the emulator cannot show

A clean emulator run is not proof of safety. Emulators of this hardware do not
model these:

- **DSP56300 pipeline interlocks.** They add a median of about 26% on hardware,
  and 12-47% per model.
- **Instruction-cache misses and external-memory wait states.** Sixteen copies of
  one model never went over budget in the emulator, and stalled on hardware.
- **The real host-port depth.** The emulator buffers thousands of words; the real
  port holds about two. Lost words show only on hardware. Three burst cases ran
  clean in the emulator, with zero late blocks, and froze the unit.
- **Its default 441-sample block slicing** freezes the ColdFire between a host
  command and its second word. That invents host-spin stalls of about 13,000
  cycles that hardware does not have. Use small slices (64 or 8 samples), and do
  not "fix" the spins it invents. One attempt at that lost commands, and another
  hung the OS.
- **Memory that hardware treats differently:** the RAM range that froze at the
  boot logo, flash writes, the runtime flash alias before mapping, power-on
  garbage, and illegal ColdFire opcodes.

Use the emulator to find bugs and to predict a voice count. Write the prediction
down before you flash, and let hardware decide.

## 9. Release procedure

### Gates

1. `npm run doctor` and `npm run check` (types, unit tests including
   `boot_safety` and the ISA controls, Python contract tests, site build). Both
   need no firmware.
2. Build the exact image with the CLI and `--gate-report`. Every engine gate
   must pass on that image:
   - `isa`, `boot-routine`, `ext-ram`, `dyn-segment`;
   - `patch-sites`, `readback`, `os-area`;
   - `dsp2-records`, `dsp2-slot`, `stub-trim`, `cache-align`, `pi-clean`;
   - `dsp1-drive-layout`, `dsp1-recover`, `clean-recovery`, `cpu-indicator`;
   - `ctr-coverage`, `ctr-controlall`, `model-runtime`, `machine-ids`;
   - `unmute-sites`, `unmute-fix`, `patch-list`.
3. Independent image checks, re-derived from the base and the exact output
   rather than from the build's own plan: the boot block and bootstrap routine
   are identical, flash after the OS is erased, DSP records sit only in free
   space, and the ISA scan finds zero rejects. The maintainers run these with
   tooling that is not yet in this repository.
4. Before publishing the site, run the leak check on `web/dist`. It must find
   no unlisted pack and no private machine name or code.
5. For DSP or timing changes, emulator runs with small slices: a 16-track burst
   and kit changes with no late or incomplete blocks, and a recorded voice-count
   prediction.

Record the base, the image's SHA-256 and the gate report. Keep failing results,
and never widen a tolerance to pass.

### Hardware burst test

Back up kits and UW samples, keep the original OS file, and start with the
monitor level low: overload produces full-scale bursts.

1. **Dense step.** A full 16-track kit with all 16 tracks triggering on one step,
   then 12-16 tracks on a kit of the new machines. Listen for at least a minute.
2. **P-I first trigger.** Load a stock P-I kit and double-hit the P-I bass drum
   right after the load.
3. **Kit switches while playing**, including to a heavy kit and back.
4. **Full 16-track kit** of the new or changed machines at normal tempo, static,
   then one knob turning, then control-all on a mode knob.
5. **Overload** (if recovery changed): CPU! appears and clears, and later
   triggers sound clean.
6. **Power cycle and repeat 1-4.** The first boot after a flash can behave
   differently from later ones: one bisect image froze once and never again
   after a power cycle. Near the edge, the result varies from boot to boot, so
   repeat a few power cycles before calling a result.

Report the hardware model, base, image hash, which steps held, and the voice
count where overruns begin. When a freeze appears, bisect by halves: build
images with half the features from the same pinned inputs, and confirm the
suspect by disabling it with a one-word change.
