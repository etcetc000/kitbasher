import { MIDI_BYTES_PER_SECOND, sendFirmware } from '../../engine/src/firmware_transfer.js';

/** One primary action: connect, prepare the device, then send this exact build. */
export class FirmwareMidi {
  readonly element = document.createElement('section');
  private button = document.createElement('button');
  private cancel = document.createElement('button');
  private ports = document.createElement('select');
  private setup = document.createElement('div');
  private message = document.createElement('p');
  private progress = document.createElement('progress');
  private access?: MIDIAccess;
  private controller?: AbortController;
  private disposed = false;
  private connecting = false;
  private prepared = false;
  private sending = false;

  constructor(private bytes: Uint8Array, private busy: (sending: boolean) => void,
    private changed: (state: 'setup' | 'sending' | 'sent' | 'error') => void = () => {}) {
    this.element.className = 'firmware-midi';
    this.element.setAttribute('aria-label', 'Send firmware over MIDI');
    this.button.type = this.cancel.type = 'button';
    this.button.className = 'wizard-primary';
    this.button.id = 'firmware-send';
    this.button.textContent = 'Send to Machinedrum';
    this.cancel.textContent = 'Cancel';
    this.cancel.hidden = true;
    this.cancel.addEventListener('click', () => this.controller?.abort(new DOMException('Cancelled', 'AbortError')));
    this.message.className = 'firmware-midi-status';
    this.message.setAttribute('role', 'status');
    this.message.textContent = `Send directly from Chrome. Allow about ${Math.ceil(bytes.length / MIDI_BYTES_PER_SECOND / 60)} minutes.`;
    const label = document.createElement('label');
    label.textContent = 'MIDI output';
    this.ports.id = 'firmware-midi-output';
    label.append(this.ports);
    const instructions = document.createElement('ol');
    for (const text of [
      'Back up your Machinedrum before updating.',
      'Connect your MIDI interface’s OUT cable to the Machinedrum’s MIDI IN.',
      'Hold FUNCTION while powering on, then press [5 LT] for MIDI UPGRADE.',
    ]) { const item = document.createElement('li'); item.textContent = text; instructions.append(item); }
    const note = document.createElement('p');
    note.textContent = 'When the screen says READY TO RECEIVE MIDI UPGRADE, you can send. Keep this tab open and your computer awake until it finishes.';
    this.setup.append(label, instructions, note);
    this.setup.hidden = true;
    this.progress.max = 100;
    this.progress.value = 0;
    this.progress.hidden = true;
    this.progress.setAttribute('aria-label', 'Firmware sent');
    const actions = document.createElement('div');
    actions.className = 'firmware-midi-actions';
    actions.append(this.button, this.cancel);
    this.element.append(this.setup, actions, this.progress, this.message);
    this.button.addEventListener('click', () => { void this.act(); });
    this.ports.addEventListener('change', () => this.readyButton());
  }

  private readyButton(): void {
    this.button.textContent = this.ports.value ? 'I’m ready — send firmware' : 'Check MIDI connection';
  }

  private refresh = (): void => {
    if (this.sending || this.disposed) return;
    const previous = this.ports.value;
    const outputs = Array.from(this.access?.outputs.values() ?? []).filter(p => p.state === 'connected');
    this.ports.replaceChildren(new Option(outputs.length ? 'Choose MIDI output' : 'No MIDI output found', ''));
    for (const output of outputs) this.ports.add(new Option(output.name || 'MIDI output', output.id));
    this.ports.value = outputs.some(p => p.id === previous) ? previous : outputs.length === 1 ? outputs[0].id : '';
    if (this.prepared) {
      this.readyButton();
      this.message.textContent = outputs.length ? '' : 'Plug in a MIDI interface, then check the connection again.';
    }
  };

  private async act(): Promise<void> {
    if (this.disposed || this.connecting || this.sending) return;
    this.message.removeAttribute('data-error');
    if (!this.prepared || !this.ports.value) {
      this.connecting = true;
      this.button.disabled = true;
      this.button.textContent = 'Connecting MIDI…';
      try {
        if (!navigator.requestMIDIAccess || !isSecureContext) throw new Error('Open Kitbasher in Chrome to send over MIDI, or choose Download .syx.');
        if (!this.access) {
          const access = await navigator.requestMIDIAccess({ sysex: true });
          if (this.disposed) return;
          this.access = access;
          this.access.addEventListener('statechange', this.refresh);
        }
        if (!this.access.sysexEnabled) {
          this.access.removeEventListener('statechange', this.refresh);
          this.access = undefined;
          throw new Error('Allow MIDI and SysEx access in your browser’s site settings, then try again.');
        }
        this.prepared = true;
        this.changed('setup');
        this.setup.hidden = false;
        this.refresh();
        this.progress.hidden = true;
      } catch (error) {
        this.prepared = false;
        this.button.textContent = 'Try MIDI again';
        this.message.dataset.error = 'true';
        this.message.textContent = error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Allow MIDI and SysEx access in your browser’s site settings, then try again. You can also download the firmware below.'
          : (error as Error).message;
      } finally { this.connecting = false; this.button.disabled = false; }
      return;
    }
    await this.send();
  }

  private async send(): Promise<void> {
    const output = this.access?.outputs.get(this.ports.value);
    if (!output || output.state !== 'connected') { this.refresh(); this.message.textContent = 'Reconnect your MIDI interface, then try again.'; return; }
    this.sending = true;
    this.changed('sending');
    this.busy(true);
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.button.disabled = this.ports.disabled = true;
    this.button.textContent = 'Sending firmware…';
    this.cancel.hidden = false;
    this.setup.hidden = true;
    this.progress.value = 0;
    this.progress.hidden = false;
    this.message.textContent = 'Opening MIDI output…';
    const unloading = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };
    const disconnected = (): void => {
      if (output.state !== 'connected') this.controller?.abort(new Error('MIDI disconnected. Reconnect it, return to MIDI UPGRADE, and send again.'));
    };
    window.addEventListener('beforeunload', unloading);
    output.addEventListener('statechange', disconnected);
    let ownsPort = false;
    const run = async (): Promise<void> => {
      signal.throwIfAborted();
      ownsPort = true;
      // A hung driver must not leave the page permanently blocked.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortOpen: () => void = () => {};
      const opened = output.open();
      try {
        await Promise.race([opened, new Promise<never>((_, reject) => {
          abortOpen = () => reject(signal.reason);
          signal.addEventListener('abort', abortOpen, { once: true });
          timer = setTimeout(() => { this.controller?.abort(new Error('MIDI output did not open. Reconnect your interface and try again.')); reject(signal.reason); }, 5000);
        })]);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abortOpen); }
      signal.throwIfAborted();
      let previous = -1;
      await sendFirmware(this.bytes, { signal, send: packet => { disconnected(); signal.throwIfAborted(); output.send(Array.from(packet)); },
        progress: value => {
          const percent = Math.floor(value.sentBytes * 100 / value.totalBytes);
          if (percent === previous) return;
          previous = percent;
          this.progress.value = percent;
          this.message.textContent = `Sending ${percent}% · About ${Math.ceil(value.remainingSeconds / 60)} min left. Keep the Machinedrum powered on.`;
        } });
    };
    const session = async (): Promise<void> => {
      try { await run(); }
      finally {
        if (ownsPort) {
          // Keep the cross-tab lock through port cleanup, but tolerate a hung driver.
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([output.close().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]); }
          finally { clearTimeout(timer); }
        }
      }
    };
    try {
      if (navigator.locks) await navigator.locks.request('kitbasher-midi', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another Kitbasher tab is using MIDI. Finish that transfer first.');
        await session();
      }); else await session();
      this.message.textContent = 'Sent. Wait for the Machinedrum to finish the upgrade, then restart it. The browser cannot confirm installation.';
      this.changed('sent');
    } catch (error) {
      this.changed('error');
      this.message.dataset.error = 'true';
      this.message.textContent = error instanceof DOMException && error.name === 'AbortError'
        ? 'Send cancelled. Return to MIDI UPGRADE and send the firmware again from the beginning.' : (error as Error).message;
    } finally {
      output.removeEventListener('statechange', disconnected);
      window.removeEventListener('beforeunload', unloading);
      this.sending = this.prepared = false;
      this.button.disabled = this.ports.disabled = false;
      this.button.textContent = 'Send firmware again';
      this.cancel.hidden = true;
      this.busy(false);
      this.refresh();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort(new DOMException('Build changed', 'AbortError'));
    this.access?.removeEventListener('statechange', this.refresh);
  }
}
