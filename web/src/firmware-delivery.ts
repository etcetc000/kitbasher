import { FirmwareMidi } from './firmware-midi.js';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
};

/** Show the installation task the user chose, then the optional UW sample step. */
export class FirmwareDelivery {
  readonly element = node('section', '', 'firmware-delivery');
  private midi: FirmwareMidi;
  private restoreSamples: () => void;

  constructor(bytes: Uint8Array, download: HTMLAnchorElement, samples: HTMLElement, busy: (sending: boolean) => void) {
    const hasSamples = samples.childElementCount > 0;
    const sampleParent = samples.parentNode!, sampleNext = samples.nextSibling;
    this.restoreSamples = () => { samples.hidden = true; sampleParent.insertBefore(samples, sampleNext); };
    samples.hidden = true;
    const title = node('h3', 'How would you like to install it?'); title.tabIndex = -1;
    const firmware = node('div'), manual = node('div', '', 'delivery-manual'); manual.hidden = true;
    const next = node('button', 'Get UW samples', 'wizard-primary'); next.type = 'button'; next.id = 'delivery-samples'; next.hidden = true;
    const back = node('button', 'Choose another way', 'delivery-back'); back.type = 'button'; back.hidden = true;
    const downloadWrap = node('div', '', 'delivery-download'); download.textContent = 'Download .syx'; downloadWrap.append(download);
    const reset = () => {
      this.element.dataset.stage = 'choose'; firmware.hidden = false; manual.hidden = true;
      this.midi.element.hidden = false; samples.hidden = true; next.hidden = true; back.hidden = true;
      this.midi.element.querySelector<HTMLElement>('.firmware-midi-actions')!.hidden = false;
      title.textContent = 'How would you like to install it?';
      download.textContent = 'Download .syx'; title.focus();
    };
    this.midi = new FirmwareMidi(bytes, sending => {
      downloadWrap.inert = sending; back.disabled = sending; next.disabled = sending; busy(sending);
    }, state => {
      if (state === 'setup' && !manual.hidden) return;
      this.element.dataset.stage = state; next.hidden = true;
      title.textContent = state === 'sending' ? 'Sending your firmware' : state === 'sent' ? 'Firmware sent' : 'Prepare your Machinedrum';
      back.hidden = state !== 'sent';
      if (state === 'sent') {
        this.midi.element.querySelector<HTMLElement>('.firmware-midi-actions')!.hidden = true;
        next.textContent = 'I’ve restarted — get UW samples'; next.hidden = !hasSamples;
      }
    });
    const help = node('details'); help.append(node('summary', 'How to install this file'));
    const steps = node('ol');
    for (const text of [
      'Back up your Machinedrum. Connect your interface’s MIDI OUT to the Machinedrum’s MIDI IN.',
      'Hold FUNCTION while powering on, then press [5 LT] for MIDI UPGRADE.',
      'When READY TO RECEIVE MIDI UPGRADE appears, send the downloaded .syx with your MIDI utility. Use a 20 ms gap if it asks for one.',
      'Wait for the Machinedrum to finish the upgrade, then restart it.',
    ]) steps.append(node('li', text));
    help.append(steps);
    manual.append(node('p', 'Use the downloaded .syx with your preferred MIDI utility.'), help);
    download.addEventListener('click', event => {
      if (event.defaultPrevented) return;
      this.element.dataset.stage = 'download'; this.midi.element.hidden = true; manual.hidden = false;
      title.textContent = 'Your firmware file'; back.hidden = false;
      download.textContent = 'Download .syx again'; next.textContent = 'Get UW samples'; next.hidden = !hasSamples;
    });
    next.addEventListener('click', () => {
      this.element.dataset.stage = 'samples'; firmware.hidden = true; samples.hidden = false;
      title.textContent = 'Load your UW samples'; next.hidden = true;
      back.textContent = 'Back to firmware'; back.hidden = false; title.focus();
    });
    back.addEventListener('click', () => { back.textContent = 'Choose another way'; reset(); });
    firmware.append(this.midi.element, manual, downloadWrap);
    this.element.append(title, firmware, samples, next, back);
    this.element.dataset.stage = 'choose';
  }

  dispose(): void { this.midi.dispose(); this.restoreSamples(); }
}
