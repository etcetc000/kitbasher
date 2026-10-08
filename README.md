# Kitbasher

Kitbasher adds new sound models to your Elektron Machinedrum's OS. Pick the
machines you want, and it builds an OS update that keeps every stock machine and
adds yours alongside them.

It works on stock OS 1.63, X.14 and Em's DEV firmware, and runs entirely in
your browser at **[kitbasher.xyz](https://kitbasher.xyz)**. Your firmware never leaves your
computer: nothing is uploaded, and there is no server-side build.

Kitbasher is a community project. It is not affiliated with or endorsed by Elektron.

## Using it

1. **Back up.** Keep the OS file you have installed now, and save your kits and
   patterns (GLOBAL › SYSEX SEND › ALL into a SysEx recorder). Sending that OS
   file again restores your machine.
2. **Load your OS and answer the UW question.** Open [kitbasher.xyz](https://kitbasher.xyz),
   drop in your OS file (`.syx` or `.bin`), and say whether your Machinedrum has
   the UW option: Yes or No. To check, open the machine menu of any track on
   your current firmware: if it has ROM and RAM categories, you have UW. Nothing
   goes ahead, and nothing is built, until you click Yes or No; the page does
   not remember the answer or take it from a restored file, and saves it with
   your layout.

   **Built with Kitbasher before?** Open *Restore an earlier layout* below the
   drop zone and drop the `.syx` you flashed (or your project or layout file),
   so your kits keep finding their machines (a Kitbasher `.syx` dropped as the OS
   file restores the same way; the page then asks for the stock OS):
   machine IDs are now given from the lowest free one (the same selection, OS,
   UW answer and menu layout always get the same IDs), and earlier builds used
   others. See [Machine IDs](docs/BASES.md#machine-ids).
3. **Swap samples (optional).** The E12 machines appear as a grid of pads: click
   one to hear it, drop a WAV or AIFF file on it to replace it, or drop several
   files or a folder to fill the pads in order. A new sample can be as long as the
   one it replaces; a longer file is cut to fit. See [E12 samples](docs/SAMPLES.md).
4. **Pick models.** Browse by category (kicks, snares, hats, percussion, FM,
   synths, wavetables, vocal, physical modeling, effects) and check the machines you want. Click a
   model to see its screen and what every control does. The meters show how much
   DSP memory, menu space and firmware storage your selection uses; if it does
   not fit, the page trims the tails of the built-in E12 samples just enough to
   make room, or you can keep them and choose fewer models.
5. **Arrange and download.** Keep the default menu categories or rearrange them,
   then download the new `.syx` file. **Save project** keeps your samples,
   models and layout in a [project file](docs/PROJECT-FILE.md) for next time.
6. **Send it.** Hold FUNCTION while powering on, choose [5 LT] MIDI UPGRADE, and
   send the file from a SysEx tool with a 20 ms gap between messages.

Some models use a sample in UW memory; the page lists those and offers the
sample files with instructions.

A Machinedrum without the UW option takes the same OS update. Answer No to the UW
question and the page leaves out what such a unit cannot use: models that play
UW samples (marked *needs UW*) and machine IDs of 128 and up (a machine that
a restored session puts there moves to a free ID below 128, and the page says
so). The machine menu then shows your categories where ROM and RAM
would be. See [Machinedrum without UW](docs/BASES.md#machinedrum-without-uw).

## Supported bases

| Base | Support |
|---|---|
| OS 1.63 (stock) | Prepared automatically with a small boot hook, then patched; tested in the emulator |
| OS X.14 | Patched directly; tested in the emulator |
| Em's DEV firmware (md-26912-190450) | Patched directly; tested on hardware |
| Em's DEV firmware (md-26A01-183521) | Patched directly; tested in the emulator |

Details per base are in [docs/BASES.md](docs/BASES.md).

## Models

Sources for five model families live in [`examples/`](examples/): seven analog
drum and synth recreations, five community synth voices, a 30-program port of
Befaco's Noise Plethora, a Karplus–Strong string and a ladder filter effect. [docs/MODELS.md](docs/MODELS.md) describes them, with
their credits and licenses.

## Safety

**Use at your own risk.** Kitbasher is free software provided as is, without
warranty of any kind (see sections 15 and 16 of the [GPL v3](COPYING)).
Installing modified firmware can make your Machinedrum unusable. The authors and
contributors accept no liability for damage, data loss or repair costs, however
caused. If you are not comfortable recovering a Machinedrum from a failed update,
do not install a patched OS.

Flashing firmware always carries some risk. Kitbasher is designed not to touch
the boot menu, so a failed or unwanted update can normally be recovered by sending
your original OS file the same way. Keep that file safe before you start. Every
build is also checked before you can download it, including that nothing it adds touches
memory the Machinedrum has not set up yet during boot.

Every rule that keeps a patched build from crashing or freezing the
Machinedrum, and the hardware test to run before you share an image, is in
[docs/FIRMWARE-SAFETY.md](docs/FIRMWARE-SAFETY.md).

Saved kits refer to machines by ID. When you rebuild for existing kits, drop
your previous Kitbasher `.syx`, project or layout file under *Restore an earlier
layout* on the first step so every
machine keeps its ID ([Machine IDs](docs/BASES.md#machine-ids)).

## Development

You need Node 22+ and Python 3.11+.

```text
npm ci
npm run doctor
npm run check
npm run dev
```

`npm run dev` serves the page at `http://127.0.0.1:8767` and rebuilds it as you
edit. The command-line patcher shares the browser's engine:

```text
node engine/dist/src/cli.js --in my-os.syx --out patched.syx --uw --clean-recovery
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) to get set up, and
[the documentation index](docs/README.md) for how it all fits together. To
write your own model, start with the [scaffold example](examples/scaffold/README.md).

## License

Kitbasher is free software under the GNU General Public License, version 3 or
(at your option) any later version; see [COPYING](COPYING). The model sources in
`examples/` use the same license. Bundled third-party code is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and model licenses in
[docs/MODELS.md](docs/MODELS.md).
