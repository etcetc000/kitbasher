# MIDI chromatic note input

An optional build feature: play the selected track from a MIDI keyboard, at
pitch. It is **off by default**. Turn it on with the *MIDI chromatic note input*
box on the Download step, or `--midi-chroma` on the command line.

Supported on **OS X.14** and **OS 1.63** (the prepared base), with the same
behaviour on both. The DEV builds read MIDI through their own queue, which is
not implemented, so the option is not offered there (`--discover` names the
reason). Each base's profile has to record the option as tested on it; see
[Supported bases](BASES.md#features-per-base).

## Playing

- **Channel.** Notes on MIDI channel **base + 4** play the track. With the
  factory base channel 1 that is **channel 5**; it follows the base channel when
  you change it. With the base channel set to OFF nothing is played. The four base channels keep their usual jobs
  (track triggers, CC parameter control, Enhanced MIDI masks). On the command
  line, `--midi-chroma-channel` picks another one: `base+4` .. `base+15`, or an
  absolute `ch:1` .. `ch:16` (one inside the base range is ignored there).
- **Which track.** The selected track: the one the knobs edit.
- **Pitch.** The note sets the track machine's pitch knob from the model's
  pitch metadata, then triggers it in the same pass, so the new pitch is
  already there at the onset. The note's velocity is passed on. For the shared
  quarter-tone law, PTCH raw = 2 × (MIDI − 24): MIDI 60 (C3) is raw 72, MIDI 24
  (C0) is raw 0, and notes from MIDI 88 up hold raw 127. The value goes in exactly
  as a pitch CC on the base channel would: the kit, the live parameter and, in
  EXTENDED mode, the lock staging.
- **Velocity 0 and note-off** on the chromatic channel do nothing.
- The pitch goes in through the CC addressing of the base channels, so with a base
  channel above 13 the tracks that CC cannot reach (13..16 with base channel 14)
  are only triggered: their pitch does not change, and no pitch lock is recorded.

## Recording

- **Live record** (REC + PLAY): a played note records the trig, as a note on the
  base channel does, and a **pitch p-lock** on the step the trig landed on,
  whatever the quantize setting. Several notes on one step: the last one wins.
  This works in CLASSIC and EXTENDED mode.
- **Grid record with trig keys held**: hold one or more trig keys and play a note:
  **every held step** gets a pitch p-lock, and a trig that was already there is
  kept when you let go. The note is heard at its pitch.
- No free lock slot left in the pattern: the trig stays and the OS shows its own
  "locks full" message, as it does for knob locks.
- Outside live record, and in grid record with no trig key held, a note only
  plays: nothing is queued for the UI task.

## Which machines play notes

Only models whose pitch metadata has a note law (quarter or chromatic) play
notes; the build report and the command line list what each selected machine
does. Every other machine on the selected track is **triggered with its knobs
untouched**:

- the stock Machinedrum machines (support for them is planned);
- models with a relative pitch law (VADHH, VADCY), a continuous one (NZEPL), or
  no pitch metadata.

A model whose law depends on a MODE knob (VADPC, VADRC) follows the kit value of
that knob: a p-locked or LFO-modulated mode is not followed. A MODE position with
no note law (VADRC's third mode) triggers only.

## Known limitation

Each law covers a limited span. Notes outside it are clamped to the nearest end
of the range, so they repeat the end note. On models with a narrower range per
mode (VADPC's first mode starts at raw 10, for example) more low notes clamp.

## How it works

`engine/src/midi_chroma.ts` holds the routines and the table. The two bases read
MIDI differently, so each has its own entry into the same play and lock code.

### X.14

X.14's add-on parses MIDI in its interrupt and plays notes from a real-time
queue. The build checks every site byte for byte before patching:

- the UART parser's base-range test for note-ons (`0x2dcb54`, 20 bytes) becomes a
  call that keeps the base range as before and also queues note-ons on the
  chromatic channel;
- the real-time queue's call of the note-on handler (`0x2dcf08`) enters the
  routine, which passes every other message on unchanged;
- the note-on handler's call of the live trig recorder (`0x2cf974`) is wrapped to
  learn the step the trig went to;
- the UI task's idle call (operand at `0x225530`) first writes the queued p-locks
  with the OS's own lock writer (`0x21670a`), which runs only in that task.

### OS 1.63

OS 1.63 has no real-time queue. Its UART interrupt parses each message and posts
it to the MIDI task, which plays base-channel notes and CCs through the OS's
dispatch table. Discovery finds every site by signature
(`bases/lineage-163.json`, `chroma_*`), checks that the pieces agree with each
other (the queue the parser posts to is the one the task reads, the table names
the handlers, and so on), and the profile caches what it found:

- the MIDI task's channel test (`0x209e10`, 16 bytes) becomes a call that sends
  the base range on to the dispatch as before, and drops everything else as
  before, after playing a note-on with velocity on the chromatic channel;
- the note-on handler's call of the live trig recorder (`0x20d040`) is wrapped,
  as on X.14;
- the UI loop's queue-count call (operand at `0x225524`) first writes the queued
  p-locks. The idle call's own operand, X.14's site, is where dynamic labels
  hook in on 1.63, so drain uses the call just before it, on every pass of the
  UI loop.

A chromatic note is played in the MIDI task, in order with the messages around
it, through the same CC and note-on handlers a base-channel note uses, so it has
the timing a base-channel note has on 1.63. The lock
writer still runs only in the UI task. The MIDI task can be preempted by the UI
task, so it adds a request to the ring with interrupts masked, as the OS's own
queue post does. Running status, SysEx and clock are handled by the OS's parser
as before; the patch touches no byte of it.

On both bases nothing is sent to either DSP that a CC plus a note would not
send. The `midi-chroma-sites` gate refuses an image whose final boot patch list writes the
hook sites from anything else, or writes into the routines; the `midi-chroma` gate
reads the routines back and refuses them unless they are ISA_A and call only the
OS routines they name.

## Memory

The routines (896 bytes on X.14, 876 on 1.63) and their note table go at the end
of the RAM image, which must then end inside the range earlier images ran from on hardware (up to
`0x2bce14`). When it would not, menu descriptors move to flash first, as for any
RAM image that is too big (descriptors in flash: auto, the default).

With the full bundled catalog on X.14 (24 models) this is tight: five descriptors
move to flash, the routines and table take `0x2bca0c..0x2bcdfc` (1,008 bytes), and
24 bytes of the proven range are left. On prepared 1.63 the same selection moves
the same five descriptors, the routines and table take `0x2bca04..0x2bcde0` (988
bytes), and 52 bytes are left. Both coexist with the unmute-latency fix, whose
routines are in the label RAM range, and their hook sites are written by nothing
else (the `midi-chroma-sites` and `patch-list` gates). A build with descriptors kept in RAM
(`--desc-flash none`) is refused, naming how many bytes are missing and what to do:
let descriptors move to flash, untick a machine, or turn the option off. The page
shows the same message under the memory meters.

A build without the option is byte-identical to one from before the option
existed.
