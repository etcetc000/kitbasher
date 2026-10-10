# Supported bases

A *base* is the Machinedrum OS you start from. Kitbasher patches OS builds
derived from Elektron's OS 1.63 for the SPS-1UW, and adds models without
removing any stock machine.

| Base | Profile | How it is patched |
|---|---|---|
| OS 1.63 (stock) | `bases/stock-163.json` | Prepared once with a boot hook, then patched as the prepared base |
| OS 1.63, prepared | `bases/stock-163-prepared.json` | Patched directly |
| OS X.14 | `bases/x14.json` | Patched directly, chaining onto X.14's own add-on |
| Em's DEV firmware (md-26912-190450) | `bases/dev-26912.json` | Patched directly, chaining onto DEV's add-on; nothing after the DSP2 slot moves |
| Em's DEV firmware (md-26A01-183521) | `bases/dev-26a01.json` | Patched directly, as for the earlier DEV build |

X.13 is no longer supported: an OS tagged `X13 ` is refused before anything else.

Each profile also records how far that base has been tested. DEV 26912 images
have been tested on hardware (Machinedrum MKII +Drive UW), and so have X.14
images (Machinedrum with UW), including the unmute-latency fix and MIDI
chromatic note input. Prepared 1.63 and DEV 26A01 have passed the engine's
gates and emulator checks of controls, labels, kits, memory and audio. The page and the build report show the
level for the base you load.

## How a base is recognised

Each profile identifies its base by the OS tag and the SHA-256 of the ColdFire,
DSP1 and DSP2 slots (and of the add-on, where there is one). The engine then
*discovers* every patch site from signatures in `bases/lineage-163.json`, which
describe what all 1.63-derived builds share. Addresses cached in a profile are
compared with what discovery finds; discovery always wins.

An OS 1.63-derived build without a profile is still discovered and, when every
required site is found, patched. Features that need a profile's qualification are
refused on it, with the reason in the build report.

A base that changes the boot block or the bootstrap-rewrite routine is refused:
those are what let you recover by sending your original OS again.

## Model runtimes

Assembly models talk to the base through the `md-voice/1` interface: the DSP2
program, the ColdFire SRAM routines and the base's add-on code. Rather than trust
a version name, the engine fingerprints those three parts and looks the
combination up in `modelRuntimes` in `bases/lineage-163.json`. All three must
match one tested combination. A build that uses assembly models on a base with no
matching entry is refused with the part that differs.

Because the check is on the parts that matter, a base without a profile can still
take assembly models when its runtime matches a tested one. Its own qualification
stays *discovered*; only the model interface is reused. Every other feature is
still discovered and checked on the file you load, and the report binds the
result to that exact input.

To add a runtime, run `node engine/dist/src/cli.js --discover my-os.syx --report
report.json`, review the parts that changed, and test models on it before adding
its fingerprints. A copied hash is not a test.

## Stock OS 1.63

Stock 1.63 has no boot hook for the patch to chain onto. Kitbasher prepares it
once: it redirects the reset jump to a small hook right after the OS container
and repacks the ColdFire slot at its original length. Everything else stays
byte-identical to 1.63. The browser does this automatically when you load a
stock 1.63 file. On the command line:

```text
node engine/dist/src/cli.js --prepare-163 --in os163.syx --out os163-prepared.syx
```

## Features per base

Discovery checks each feature on the base you load: dynamic knob labels, DSP1
drive curves, menu descriptors in flash, control-all for added machines,
overload recovery, the CPU indicator, MIDI chromatic note input, pitch note names and the unmute-latency fix. A feature whose sites are not found is
switched off and reported, never guessed. To see what a base supports:

```text
node engine/dist/src/cli.js --discover my-os.syx
```

Some options also need the profile to record them as working on that base
(`options` in the profile: qualified with the evidence, or refused with the
reason):

| Option | Prepared 1.63 | X.14 | DEV 26912 | DEV 26A01 |
|---|---|---|---|---|
| Unmute-latency fix (`--unmute-fix`) | yes | yes | no: DEV enters its add-on from the sequencer | no: as DEV 26912 |
| MIDI chromatic note input (`--midi-chroma`) | yes | yes | no: MIDI goes through DEV's per-block queue | no: as DEV 26912 |
| Pitch note names (`--pitch-labels`) | yes | yes | no: the knob-value draw is DEV's own TONAL label | no: as DEV 26912 |
| Reordered DSP2 host sender (`--host-reorder`) | no: silences output in the emulator | no: not qualified | yes | no: not qualified |

A parity check (`engine/test/parity.test.ts`) runs with the tests: every profile
must qualify each of these options or refuse it with a reason, and the list of
refusals above is fixed there, so a new gap is a deliberate change. Every other
feature discovery reports must be on a list of features found on every base;
with your OS files (`firmwareDir`) the check also resolves each profiled base and
fails when a feature is missing on one base but not exempted. A refused option
shows the profile's reason first, then discovery's when it did not find it either.

## Unmute latency

On every 1.63-derived OS the sequencer builds each step's notes one step ahead
and leaves a muted track out of them, so a track unmuted less than about one
step before its next trig stays silent for that trig. Builds fix this by
default (`engine/src/unmute.ts`): muted tracks are queued too, and the mute is
tested when each queue is played instead. The rule is that a trig plays when its
track is unmuted on the tick that plays it: the step's tick, or for a swung trig
the swing tick (the same tick at 50% swing, up to 0.6 of a step later at 80%).
An unmute that lands before that tick plays the trig on time;
one that lands after it does not, as on a base without the fix. Muting is
unchanged, and so are MIDI machines, which keep the base's behaviour.

Five instructions of the OS's sequencer call 360 bytes of code (and 44 of data)
placed after the knob labels in their RAM range, or alone in that range when no
selected machine has labels. Discovery finds the sequencer by signature, and the
base's profile must record the fix as run on it: OS 1.63 (prepared) and X.14
have it, X.14 on hardware (plain, p-locked and swung unmutes). The DEV builds enter their own code from the sequencer's tick handler
and buffer toggle, so discovery does not find it there. Turn it off with *Fix
unmute latency* on the Download step or `--no-unmute-fix`; the image is then
the one a build without the fix makes.

## X.14

X.14 has its own profile and runtime entry. Two details matter to the patcher:

- X.14's add-on calls the DSP1 sender directly. Discovery finds that call as well
  as the OS's own, so DSP1 drive curves reach every track.
- X.14 uploads the DSP2 voice-retirement code twice. Clean recovery
  patches every copy, and refuses the build if any copy differs from the stock
  instructions it expects.
- [MIDI chromatic note input](MIDI-CHROMATIC.md) (`--midi-chroma`) hooks X.14's
  real-time MIDI path in its add-on. On OS 1.63 it hooks the MIDI task instead,
  with the same behaviour; DEV reads MIDI through its own queue, which it does
  not patch.

## DEV 26A01

DEV 26A01 keeps the earlier DEV build's DSP2 program but changes the ColdFire
code, DSP1 and the add-on, which now unpacks 21 pieces instead of 19. Discovery
finds the new patch sites; nothing is reused from the older DEV profile.

- The base ends at flash `0xfec13`, leaving about 5 KB of flash after it for the
  patch. Larger selections still have to pass the normal storage check.
- DSP1's own upload occupies `P:0xa10..0xa3e`, where the drive dispatcher used to
  sit. The linker now places drive code in the free span after it, leaving 219
  words below the recovery handler. Other bases keep their original placement.
- DEV 26A01's kit editor draws a newly chosen category with the previous
  category's cached length. The patch refreshes that cache first, so the list of
  added machines draws in full.

## MDX X.20 B (public beta)

X.20 B is jmamma's community OS. It is still a public beta, so X.14, OS 1.63 and DEV
stay supported alongside it. Its loader streams a packed OS through the DSPs and
gets the ColdFire image back at boot, so nothing can be discovered in the file:
Kitbasher patches this one release with a fixed recipe, [`bases/x20.json`](../bases/x20.json),
and recognises the file by its SHA-256 (any other X.20 file is refused). The recipe
holds addresses, the bytes X.20 B has at each patch site, and hashes; no firmware bytes.

What a build changes (engine/src/x20.ts):

- **INTERNAL (E12) samples** are trimmed with the usual rule and re-encoded in
  X.20's E12B flash format; the DSP2 memory and flash they free hold the
  machines. **Replacing INTERNAL samples is turned off** on the patched OS (its
  flash file system refuses to erase or write the E12B bank, and DSP2 writes into
  the bank are refused), because the machines' code lives in that space.
- **User machines (USR) keep working.** X.20 reserves machine IDs 194..209 for
  its 16 user-machine slots, and a built-in machine on 192 or 193 freezes the OS
  when assigned, so added machines take IDs up to 191 only. The record table
  grows from 159 to 200 entries; X.20's user-machine install, remove and check
  routines reach that table and the menu through offsets from a base pointer, and
  the recipe patches them too (without that, every USR install fails with
  RECV FAIL). The +Drive machine banks keep their own erase.
- **DSP2 load.** The machines' code goes into DSP2 before DSP2's own loader runs:
  the build sends a short receiver through the bootstrap's `ELD` command, the
  code follows, and the receiver's wiper hands DSP2 back to its bootstrap. The
  dispatch words go after DSP2 starts, through the OS's own block write.
  Uploading all the code after DSP2 starts makes the OS miss DSP2's startup
  messages on hardware; `--dsp2-load upload` does it anyway, for the emulator
  only (whose DSP does not run code written through X memory).
- Added machines go into X.20's own menu families (analog drums in TRX, FM
  voices in EFM, effects in NFX, the rest in GND).

Not available on X.20 yet: the room meters and sample swapping in the browser,
restoring a layout (machine IDs are assigned fresh, bottom-up), MIDI chromatic
input, pitch note names and the unmute fix. DSP1 is not patched: X.20's DSP1
bootstrap runs a `PFLUSH` on an `ELD` with its instruction cache off, which is an
illegal instruction on real hardware, so any DSP1 change needs another route.

Gates, all hard failures: the file's hash; every ColdFire instruction the build
adds, in its own routines and at every OS and loader site, decodes as ISA_A
(MCF5206e: the emulators run 68k forms such as `btst #n,abs.l` and
`move.l #imm,d16(An)` that the CPU traps on); the DSP boot code holds no cache
instruction. Offline, with a decoded X.20 B image (`KB_X20_OS`, see
[Testing](TESTING.md)), the tests check every anchor and run a relocation audit:
every instruction that reaches a table the recipe moves is patched or explained
in the recipe's `audit` list.

## Machinedrum without UW

The same OS files run on a Machinedrum with and without the UW option. At boot
the OS reads which one it is on and, without UW, takes the ROM and RAM machine
categories out of the machine-select menu. The same boot step counts the
categories and records, for every machine, which category and place the
machine menu opens on.

- Stock 1.63 and the DEV builds drop the *last two* categories. With added
  categories after the base's own, that would hide two of them and show ROM and
  RAM, which play nothing without UW.
- X.14 moves the categories after ROM and RAM down over them, but only after
  recording where each machine is, so the menu would open on the wrong category
  for every added machine (and NFX).

Every build therefore adds a short routine that, on a unit without UW, removes
ROM and RAM from its menu table *before* the base counts the categories, and
turns the base's own step off. The menu then shows the base's categories
without ROM and RAM followed by yours, and opens on the right one. The
`uw-menu` check in the build report names the routine and the base's step it
replaced; a build for a Machinedrum without UW fails if the base's step is not
found.

Two things need a UW Machinedrum, so the page asks first: *Does your
Machinedrum have the UW option?* There are two answers, Yes and No, and one
line under them says how to check (a UW unit's machine menu has ROM and RAM).
Nothing is pre-selected, and the page does not leave the first step, check,
build or download until you click one in this visit: the answer is not
remembered in the browser, and a restored layout, project or `.syx` that
records one only shows a hint ("This layout was saved for a Machinedrum with
UW") without answering for you. The engine's `build` refuses to run without an
explicit `uw` (true or false); a layout's own `uw` does not count. The answer
is saved as `uw` in layout and project files and in the layout table of the OS
it builds. With a No:

- **No machine IDs of 128 and up.** Without UW the OS takes 128 off any machine
  ID of 128 or more, so a machine there would be selected as another, empty one.
  New IDs stay below 128; a machine a restored session puts at 128 or above
  (OSCPW was on 175 in earlier builds) moves to the lowest free ID below 128, and
  the page, the ID map and the build report show the move. The build fails,
  saying so, only if no ID below 128 is left. On the command line: `--no-uw`.
- **No models that play a UW sample** (marked *needs UW* on the page; WAVTB,
  WAVCH and WAVMR today). They cannot be selected; `--no-uw` leaves them out and
  names them.
- The ID map hatches 128 and up as unusable, and the menu preview shows your
  categories where ROM and RAM would be.

With a Yes nothing changes.

## Machine IDs

Saved kits find machines by ID. Kitbasher gives each selected model the lowest
free ID, in menu order: the same selection on the same OS, with the same UW
answer and the same menu layout, always gets the same IDs. A model's pack no
longer fixes its ID.

**This changed in October 2026.** Earlier builds put some models on fixed IDs
(OSCPW 175, WAVTB 124, OSC8B 126, VOXVO 127, WAVCH 6, FMSSW 10, FMS2O 11,
FMS3O 12, OSCSW 13, OSCCH 14, WAVMR 30) and the rest after them. To keep kits
made with an earlier build working, restore that build's IDs on the first
step, under *Restore an earlier layout* (a Kitbasher build dropped as the OS
file is read the same way; the page then asks for the stock OS it was built on):

- drop the **.syx you flashed** (or the .bin): Kitbasher reads the layout table
  every build carries, or, failing that, the machines it added, matched to the
  catalog by their names now or before the October 2026 rename (the page names
  any it does not know, and keeps their IDs free);
- or your **project file** or **layout file**.

Every machine the restored session names keeps its ID; models it does not name
take free IDs. Machines of the session that you do not select now keep their
IDs reserved, so a later build that selects them again finds them free; only
when no other ID is left is one given to a new model, and the build report says
so. A session made for another OS is applied to the one you load: machines keep
their IDs where that OS has them free, and the others move (each move is
listed). On the command line: `--restore <file>`. Exactly one of
`--uw` or `--no-uw` is required for every build; a restored session's UW answer
is reported but never used in its place.

## Adding a base

To request support for another OS build, open a
[base support request](../.github/ISSUE_TEMPLATE/base_support.yml). A new
profile needs the build's slot hashes and a clean discovery report. An image
built from it that boots and plays on hardware moves it to *tested on hardware*.
