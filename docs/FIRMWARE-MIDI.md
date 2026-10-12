# Browser firmware sending

The builder's final page can send its current build directly through Web MIDI in
Chrome over HTTPS (or localhost). Choose **Download .syx** to save the file without granting MIDI access.
Only a MIDI output is needed for the standard OS update protocol. Unlike MDS
machine installation, firmware updates do not use the MDS acknowledgement protocol.

Choose **Send to Machinedrum**, allow MIDI and SysEx access, select the output, and follow
the boot-menu instructions. The second click, **I'm ready — send firmware**, starts
transmission. A single connected output is selected automatically; multiple outputs
require a selection. The browser cannot detect the DIN cable or boot-menu readiness.

The sender validates checksums, addresses, the OS address range, canonical packet
encoding and the end markers before sending any bytes. It sends a private snapshot
of the built SysEx, identical to the download. Each packet is followed by its full
DIN wire time (31,250 baud, 10 bits per byte), with **0 ms extra gap**. Late browser
timers slow the transfer; they never cause catch-up bursts. The final packet drains
before the UI reports that sending finished.

Keep the tab open and the computer awake. Background timer throttling may extend
the estimate. Editing and navigation within the builder are blocked during sending;
leaving or reloading triggers the browser's unsaved-work prompt. A shared Web Lock
prevents simultaneous Kitbasher firmware and MDS sends in tabs on the same origin.
It cannot stop other applications or sites from using the MIDI interface.

Cancel, a disconnected interface, or a send error stops further packets. Return to
MIDI UPGRADE and restart the whole transfer. A MIDI output that fails to open times
out after five seconds. MIDI permissions and missing outputs can be retried through
the same primary button. Unsupported browsers can still download the firmware.

“Sent” means the browser completed transmission. It does not verify reception or
installation; wait for the Machinedrum's upgrade result before restarting.

The startup-menu procedure is described in the
[Elektron Machinedrum manual](https://www.elektron.se/wp-content/uploads/2024/09/machinedrum_manual_OS1.63.pdf).

The final page shows one installation path at a time. Downloading opens optional
manual installation steps. After sending, users wait for the device to finish and
restart before continuing to the UW sample step. Builds without sample needs omit
that step. Builds with sample needs offer only their matching verified files,
deduplicated when several models use the same asset, with destination slots and
sample-manager instructions. UW sample sending still uses an external SDS-capable
utility; it is not sent through the firmware sender.
