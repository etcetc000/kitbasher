# MDS machine library

The MDS page installs individual user machines into an X.20 Machine Bank. It is separate from Kitbasher's firmware builder. `catalog.json` is the curated public index; the website build validates each package and publishes content-addressed files. Capacity, controls, version and identity come from the package itself.

Set `hidden: true` on a catalog entry to withhold it from the generated index and download assets while retaining package validation; remove the flag to publish it again.

The collection contains the X.20 USR releases in `core/` (TX8, TX9, TXZ, SYN, P-I and NFX), the Simple606-inspired community TX6 port in `tx6/`, and hcar/murdenihcam's three SMP time-stretch machines in `community/murdenihcam/`. Core and SMP binaries are preserved byte-for-byte from their supplied releases. Core release links point to [jmamma/MDX](https://github.com/jmamma/MDX). Missing source or license information for other releases is explicitly recorded. The site repository's license does not override individual machine licenses. TX6 source attribution and its MIT notice are in each assembly file.

## Curating releases

TX6 version 2.0 puts TUNE first and DEC second on all eight machines. BD moves
TRAN to position 3; the other existing controls keep their positions. All
audio synthesis now runs at 44.1 kHz. The kick uses a smoother zero-crossing
start and a HEAT-controlled harmonic; both toms use two tonal modes. These
three voices are inspired revisions and change the sound. The clap adds TGHT:
0 keeps the original spacing, and 127 tightens the opening bursts, bringing
the main tail onset from about 33 ms to 4 ms. Its tail decay speed is unchanged.
TGHT = 0 preserves the previous clap audio exactly. Existing kits,
parameter locks and modulation targets need positions 1 and 3 swapped for BD,
or positions 1 and 2 for the other seven. Installing the new machines does not
convert saved kits.

1. Add a reviewed `.syx` or `.mds` containing **one machine** under `mds/`. Keep author attribution and any required license text alongside it. Do not add full firmware dumps.
2. Add an entry to `catalog.json` with `file`, its file `sha256`, `channel` (`core` or `community`), `author`, `summary`, `source` (HTTPS URL or null), `project`, `license`, and optional `notes`. Pin source links to the release commit when possible. Use notes for control changes that affect saved kits.
3. For an update, replace the entry for that stable machine ID with the reviewed release and update the SHA-256 pin. The build rejects unreviewed duplicate IDs, duplicate aliases/content, changed hashes, malformed packages, and declarations outside the X.20 admission budget. Hash validation does not establish that DSP code is safe; review and qualify the machine separately.
4. Run `node ci/workflow.mjs check`. Review the generated MDS page, parameter descriptions, capacities and source links before merging. A site deployment publishes the updated catalog.

Users can import local `.mds` or `.syx` files without publishing them. A local bank SysEx may contain multiple machine transfers. Non-MDS SysEx is rejected. Downloads rewrite only the destination slot, transaction and wire checksums; package bytes and their identities remain unchanged.

## Submit a community machine

Fork Kitbasher and open a pull request against `main`, using the [MDS submission template](../.github/PULL_REQUEST_TEMPLATE/mds-machine.md). Add your release under `mds/community/<author>/<machine>/` and append one entry per machine to the `machines` array in `mds/catalog.json`. No frontend code or separate registration is needed. Use `channel: "community"`; maintainers manage the core collection.

Copy this entry, replacing the example values with your release details:

```json
{
  "file": "mds/community/your-name/example/example.syx",
  "sha256": "replace-with-the-64-character-sha256-of-this-exact-file",
  "channel": "community",
  "author": "Your name",
  "summary": "A short description of the sound and useful controls.",
  "source": "https://github.com/your-name/your-project/tree/COMMIT/machine",
  "project": "https://github.com/your-name/your-project",
  "license": "MIT",
  "notes": "Compatibility notes or changes that affect existing kits."
}
```

`file` is relative to the repository root and must point to a single-machine `.syx` or `.mds`. `sha256` covers that exact file, not its unpacked program. `author`, `summary`, and `license` must be nonempty strings. Use an accurate license and include its required notices; only submit files you can redistribute. `source` and `project` must be HTTPS URLs or explicit `null` when unavailable. Pin source to a release commit. `notes` is optional.

Optionally set `hardware` to `"uw"` for UW-only releases or `"all"` for releases supporting UW and non-UW models. This author-specified requirement is shown in the picker and machine details; it is not inferred from the presence of sample API imports.

The package supplies its stable machine ID, family/category, short label, display name, version, parameter names/ranges/defaults, memory use and declared CPU cost. Those values are decoded automatically; do not duplicate or override them in the catalog entry. Keep the ID stable across updates, increment the package version, and replace its existing catalog entry instead of appending a duplicate. The SysEx destination slot is remapped to the user's selection by the browser.

For a reviewed original variant that retains another machine's descriptor ID, maintainers may set `sharedId` to that exact ID and document the provenance. This exception preserves the original package; it does not override its identity. Aliases and content hashes must still be unique. Normal contributions should use their own stable IDs. Selection, downloads and MIDI readback identify exact releases by content hash.

Calculate the file hash in PowerShell:

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath 'mds/community/your-name/example/example.syx').Hash.ToLowerInvariant()
```

Before submitting:

- Include the package, metadata entry, and source/license links or attribution files.
- Confirm the package is for MDS v1 on X.20, with a nonzero per-track cycle declaration no greater than 3,951 clocks per block. Provide timing evidence; the declaration alone is not a benchmark.
- Describe the sound, controls, memory needs, testing performed, and whether it was tested on hardware. Mention dependencies and existing-kit compatibility changes.
- Install dependencies with `npm ci`, then run `npm run check` using the repository's development setup. CI also runs the checks on the PR. Check the deployment preview for the correct family, controls and capacity.

CI rejects malformed packages, mismatched hashes, unreviewed duplicate machine IDs, duplicate aliases/content, invalid metadata and cycle declarations outside the admission limit. Maintainers review provenance, DSP behavior and test evidence; passing CI does not establish sound quality or DSP safety. **Approval alone does not publish a release: once the approved PR is merged and deployment succeeds, the machine appears automatically in the public list.** The build generates its download asset, and the page discovers families and filters from the updated catalog.

## MIDI installation

Use Chrome on HTTPS or localhost and grant MIDI SysEx access. Both MIDI directions are required: interface OUT → Machinedrum IN, and Machinedrum OUT → interface IN. Select the destination Machine Bank **on the device**. Connect MIDI at the bottom of the bank preview; the browser reads the bank automatically when the ports are selected. Missing ports or missing device replies produce an error before any machine data is sent. The protocol does not select or identify banks by a persistent bank ID. Keep that bank selected throughout installation.

The browser reads slots and capabilities, accounts for untouched slots and replacement deltas, and finds an installation order that fits at every commit. It does not erase slots. Reordering the selection changes its USR destinations; it does not rewrite category-menu metadata. Kits reference slot model IDs, so replacing a slot can change the sound of existing kits.

The main view shows short sound labels, a selection preview and one space estimate. Import, sorting, first-slot selection, downloads and detailed memory figures are under optional menus. MIDI settings collapse after connection; technical machine details remain available from each machine name.

The primary button guides each prerequisite: **Choose machines**, **Connect MIDI**, **Choose MIDI device**, or **Try connection again**, then **Send machines** when the device responds. It stays actionable when prerequisites are missing and shows progress while working. Connecting or retrying does not upload machines; only clicking **Send machines** installs from the sidebar preview. There is no separate review step. A fresh connection and bank check runs automatically before sending. If the bank changed since the preview, the browser updates it and stops so the user can check the new destinations before retrying. Each header/data/end message waits for its matching acknowledgment. WAIT extends the response window within a bounded overall deadline. Timeouts resend the identical message, including End of Dump if its final ACK was lost. A repairable CORRUPT NAK resends the requested packet once; terminal rejection stops the transfer. There is no open-loop fallback. A final committed ACK and a readback of the installed content ID, size and validity are required for success. Untouched slots are verified after each machine. A failed multi-machine operation can leave earlier successfully committed machines installed; retrying automatically checks the bank again.

“Stop after this machine” finishes the current transaction and stops before the next one. Disconnecting closes the ports. A browser-origin lock prevents two Kitbasher tabs from installing at once; other MIDI applications must be closed by the user.

Protocol reference: [MDS v1](https://github.com/jmamma/MDS/tree/main/docs).
