# Security

## Reporting a vulnerability

Please report security issues privately, through a GitHub security advisory on
this repository (**Security › Report a vulnerability**), not in a public issue.
Include steps to reproduce and the version or commit you tested. We will
acknowledge your report and keep you updated while we work on a fix.

## How Kitbasher handles your files

- The page runs entirely in your browser. Your firmware and any pack files you
  load are read locally and are never uploaded; the site has no server-side build.
- The development server (`npm run dev`) listens on `127.0.0.1` only.
- Nothing in Kitbasher sends MIDI. You send the update to your instrument
  yourself, with a SysEx tool you choose.

Issues of interest include anything that could send a file off your computer,
run untrusted code from a model pack outside the instrument's DSP, or produce an
image that bypasses the engine's validation gates.
