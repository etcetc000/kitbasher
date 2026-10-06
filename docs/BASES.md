# Supported bases

A *base* is the Machinedrum OS you start from. Kitbasher patches OS builds
derived from Elektron's OS 1.63 for the SPS-1UW, and adds models without
removing any stock machine.

| Base | Profile | How it is patched |
|---|---|---|
| OS 1.63 (stock) | `bases/stock-163.json` | Prepared once with a boot hook, then patched as the prepared base |
| OS 1.63, prepared | `bases/stock-163-prepared.json` | Patched directly |
| OS X.13 | `bases/x13.json` | Patched directly, chaining onto X.13's own add-on |
| OS X.14 | `bases/x14.json` | Patched directly, chaining onto X.14's own add-on |
| Em's DEV firmware (md-26912-190450) | `bases/dev-26912.json` | Patched directly, chaining onto DEV's add-on; nothing after the DSP2 slot moves |
| Em's DEV firmware (md-26A01-183521) | `bases/dev-26a01.json` | Patched directly, as for the earlier DEV build |

Each profile also records how far that base has been tested. X.13 and DEV 26912
images have been tested on hardware (Machinedrum MKII +Drive UW). Prepared 1.63,
X.14 and DEV 26A01 have passed the engine's gates and emulator checks of
controls, labels, kits, memory and audio. The page and the build report show the
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
overload recovery and the CPU indicator. A feature whose sites are not found is
switched off and reported, never guessed. To see what a base supports:

```text
node engine/dist/src/cli.js --discover my-os.syx
```

Some options also need the profile to record them as working on that base. The
reordered DSP2 host sender (`--host-reorder`) is enabled on DEV 26912 and refused
elsewhere: on prepared 1.63 it silences output, and it is not yet qualified on
X.14 or DEV 26A01.

## X.14

X.14 uploads the same DSP1 and DSP2 programs as X.13; its ColdFire code, SRAM
routines and add-on differ, so it has its own profile and runtime entry. Two
details matter to the patcher:

- X.14's add-on calls the DSP1 sender directly. Discovery finds that call as well
  as the OS's own, so DSP1 drive curves reach every track.
- X.13 and X.14 upload the DSP2 voice-retirement code twice. Clean recovery
  patches every copy, and refuses the build if any copy differs from the stock
  instructions it expects.

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

## Adding a base

To request support for another OS build, open a
[base support request](../.github/ISSUE_TEMPLATE/base_support.yml). A new
profile needs the build's slot hashes and a clean discovery report. An image
built from it that boots and plays on hardware moves it to *tested on hardware*.
