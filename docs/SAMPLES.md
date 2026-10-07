# E12 samples

The page's Samples step lets you replace any of the E12 machines' samples with your own.
This page describes how the E12 bank works, which machine plays which sample, and the rules a
swap follows. The code is in [engine/src/samples.ts](../engine/src/samples.ts) and
[engine/src/e12.ts](../engine/src/e12.ts); the browser side in
[web/src/samples-ui.ts](../web/src/samples-ui.ts) and [web/src/convert.ts](../web/src/convert.ts).

## The bank

DSP2 holds 21 samples of 12-bit audio at 44.1 kHz, two samples per 24-bit word. The E12 code
reaches them only through the table at P:`0x103d7b`: one (start, length, 0) entry per sample,
the length in samples being 2 × words + 34. Every sample is followed by 153 silent pad words,
which playback reads past the end. The bank occupies P:`0x103dba`..`0x135206` (201,804 words of
samples and pads) on every supported base.

## Which machine plays which sample

The engine reads this from the loaded OS rather than from a table: for each machine it follows
the DSP2 dispatch tables (indexed by machine ID + 1) to the machine's INIT and TRIGGER routines.

- Single-sample machines: INIT stores the entry number in the track state
  (`move #>k,x0` / `move x0,y:(r6+$f)`), and TRIGGER adds the table address to it.
- Two-sample machines: TRIGGER loads both entries' table addresses directly
  (`move #>second,r1` / `move #>first,r0`).

On OS 1.63, X.13, X.14 and both DEV releases this gives the same map:

| Machine | ID | Sample(s) | | Machine | ID | Sample(s) |
|---|---|---|---|---|---|---|
| E12BD | 48 | 7 | | E12OH | 56 | 8 |
| E12SD | 49 | 12 + 15 | | E12RC | 57 | 9 + 10 |
| E12HT | 50 | 17 | | E12CC | 58 | 3 |
| E12LT | 51 | 18 | | E12BR | 59 | 20 + 0 |
| E12CP | 52 | 1 | | E12TA | 60 | 16 |
| E12RS | 53 | 12 + 11 | | E12TR | 61 | 19 |
| E12CB | 54 | 2 | | E12SH | 62 | 14 + 13 |
| E12CH | 55 | 4 | | E12BC | 63 | 6 + 5 |

Every one of the 21 samples is played by at least one machine. Sample 12 is the main sample of
both E12SD and E12RS, so replacing it changes both; the page says so on its row.

Nothing else assumes where a sample is or how long it is. A scan of every word of the DSP2
upload (P, X and Y records), DSP1 and the ColdFire code finds no other reference to the table, a
sample's start or a sample's length; the two DSP2 immediates that fall inside the bank's address
range are filter coefficients. The render routines take the start and length from the table at
trigger time. So any sample can be re-laid with other content, as long as the table says where it
is and its pad follows.

## Rules for a swap

- **Never longer than the stock sample.** The cap is the stock sample's length in samples. A
  longer file is cut to it with a 256-sample fade, and the page says so. The bank therefore never
  grows past its stock footprint, and every model memory figure stays an upper bound.
- **Two-sample machines.** Playback advances one position for both samples and stops at the
  main sample's length; the layer is read while the position is inside it. If the main sample
  ends before its layer, the stopped position stays inside the layer and its 32-sample window
  repeats every block: a 1378 Hz tone. Stock main samples are all longer than their layers. When
  a swap (or "Don't trim" on a layer) makes a main sample shorter than its layer, the build pads
  the main sample with silence to the layer's length. The layer is what you hear, so it is left
  as it is; the padding only costs memory, and never more than the main sample's stock length.
  The page marks such rows. The existing trim rule still applies when trimming shortens a main
  sample: its layer is shortened to match unless the layer is marked "Don't trim".
- **Don't trim.** Each sample can be excluded from the E12 trim, so a sample you made to a
  particular length is never cut further.
- **Identity.** With no swaps, or with every sample swapped for its own stock data, the build
  is byte-for-byte the build without the Samples step, with trimming on or off.

## The Samples step

The 16 E12 machines are laid out as pads in Machinedrum order (BD SD HT LT CP RS CB CH /
OH RC CC BR TA TR SH BC); the two-sample machines have a main and a layer half. Click a
pad to select and play it. Drop one file on a pad to replace it (or one half of it).
Drop several files or a folder to fill the pads in order
([web/src/sample-fill.ts](../web/src/sample-fill.ts)): the files sorted by name with
numbers in numeric order ("Kick 2" before "Kick 10"), the pads in grid order, main
samples only, one file per pad, starting at the pad you drop on, or at BD when you drop
on the grid between pads. E12-SD and E12-RS share their main sample, so it is filled
once and the second of the two is skipped. A review bar shows each pad and its file
before **Apply** or **Cancel**; files left over when the pads run out are listed as not
placed, and any file can be dragged onto another pad first.
Dropping a `.kitbasher.json` loads it as a project. With the keyboard, the arrow keys
move between pads, Space plays, Enter opens the file picker and Delete reverts.

## Converting a file

In the browser: decode (WAV or AIFF, or anything else the browser decodes), resample to 44.1 kHz,
mix to mono, optionally trim silence at both ends (below -60 dB of the peak) and normalise, cut to
the cap with a fade, then quantise to 12 bits with TPDF dither. The row reports each step.

Sample swaps can be saved in a [project file](PROJECT-FILE.md).
