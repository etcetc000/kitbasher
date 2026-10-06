// The Samples step: the OS's E12 bank, one group per machine, each entry with its waveform, length
// and word cost, a play button, replace (file picker or drop), revert and "don't trim". Swapped
// samples are converted in the browser (web/src/convert.ts), never longer than the stock entry.
// The engine reads the bank and the entry -> machine map from the loaded OS
// (engine/src/samples.ts readBank); the trim and the memory meters in the Models step use the
// swapped bank (app.ts passes `edits()` to every plan and build).

import { PAD } from '../../engine/src/e12.js';
import type { BankEntry, E12Bank, E12Machine, SampleEdits } from '../../engine/src/samples.js';
import { convertFile, play, stopPlaying, SAMPLE_RATE, type ConvertOptions } from './convert.js';

const el = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const fmt = (n: number): string => n.toLocaleString('en');
const secs = (n: number): string => `${(n / SAMPLE_RATE).toFixed(3)} s`;
const words = (samples: number): number => Math.ceil(samples / 2) + PAD;

export interface SampleState {
  swaps: Map<number, Int16Array>;
  noTrim: Set<number>;
  sources: Map<number, string>;      // file names, for display and the project file
  notes: Map<number, string[]>;      // what the conversion did
}

export const emptyState = (): SampleState => ({ swaps: new Map(), noTrim: new Set(), sources: new Map(), notes: new Map() });

export class SamplesStep {
  bank: E12Bank | null = null;
  state: SampleState = emptyState();
  private readonly list: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly message: HTMLElement;
  private playingEntry: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly onChange: () => void) {
    this.list = root.querySelector<HTMLElement>('#sample-list')!;
    this.summary = root.querySelector<HTMLElement>('#sample-summary')!;
    this.message = root.querySelector<HTMLElement>('#sample-message')!;
    // the waveforms take their colours from the theme: redraw when it changes
    new MutationObserver(() => { if (this.bank) this.render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** The edits the engine plans and builds with. */
  edits(): SampleEdits { return { swaps: this.state.swaps, noTrim: this.state.noTrim }; }

  private options(): ConvertOptions {
    return {
      normalise: this.root.querySelector<HTMLInputElement>('#sample-normalise')!.checked,
      trimSilence: this.root.querySelector<HTMLInputElement>('#sample-trim-silence')!.checked,
    };
  }

  /** A new OS: its bank (null: none, with why), and no swaps. */
  setBank(bank: E12Bank | null, why = ''): void {
    stopPlaying();
    this.playingEntry = null;
    this.bank = bank;
    this.state = emptyState();
    this.render();
    this.say(why, why ? 'error' : 'info');
  }

  private say(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.message.textContent = text;
    this.message.dataset.kind = kind;
    this.message.hidden = !text;
  }

  private lengthOf(e: BankEntry): number { return this.state.swaps.get(e.entry)?.length ?? e.samples; }

  /** Data words of every entry as the bank will hold them before any trim, firsts padded to their partners. */
  footprint(): { used: number; stock: number } {
    const b = this.bank!;
    const len = b.entries.map((e) => 2 * Math.ceil(this.lengthOf(e) / 2));
    for (const [a, p] of b.pairs) len[a] = Math.max(len[a], len[p]);
    return { used: len.reduce((n, k) => n + words(k), 0), stock: b.stockWords };
  }

  /** The partner a first sample is padded for: shorter than its partner after a swap. */
  private paddedFor(e: BankEntry): number | null {
    let pad: number | null = null;
    for (const p of e.pairs) {
      if (!p.first) continue;
      const partner = this.bank!.entries[p.partner];
      if (Math.ceil(this.lengthOf(e) / 2) < Math.ceil(this.lengthOf(partner) / 2)) pad = p.partner;
    }
    return pad;
  }

  render(): void {
    const b = this.bank;
    this.list.replaceChildren();
    if (!b) { this.summary.textContent = 'No E12 samples to show.'; return; }
    const f = this.footprint();
    const swapped = this.state.swaps.size;
    this.summary.textContent = `${swapped ? `${swapped} of ${b.entries.length} samples replaced. ` : `${b.entries.length} stock samples. `}` +
      `Sample memory before trimming: ${fmt(f.used)} words of ${fmt(f.stock)} stock` +
      (f.used < f.stock ? ` (${fmt(f.stock - f.used)} freed for models).` : '.');
    const machines = [...b.machines].sort((x, y) => x.id - y.id);
    for (const m of machines) {
      const rows = m.entries.map((i, k) => this.row(b.entries[i], m, m.entries.length > 1 ? (k === 0 ? 'main' : 'layer') : null));
      this.list.append(el('section', { class: 'family sample-machine', 'aria-labelledby': `sample-m-${m.id}` },
        el('header', {}, el('h3', { id: `sample-m-${m.id}` }, m.name),
          el('span', { class: 'count' }, m.entries.length > 1 ? 'plays two samples at once' : 'one sample')),
        el('div', { class: 'sample-rows' }, ...rows)));
    }
    const orphans = b.entries.filter((e) => !e.machines.length);
    if (orphans.length) {
      this.list.append(el('section', { class: 'family sample-machine' }, el('header', {}, el('h3', {}, 'Not played by a machine found in this OS')),
        el('div', { class: 'sample-rows' }, ...orphans.map((e) => this.row(e, null, null)))));
    }
  }

  private row(e: BankEntry, m: E12Machine | null, role: 'main' | 'layer' | null): HTMLElement {
    const swap = this.state.swaps.get(e.entry);
    const data = swap ?? e.data;
    const who = `sample ${e.entry}${m ? ` (${m.name}${role ? ` ${role}` : ''})` : ''}`;
    const canvas = el('canvas', { class: 'sample-wave', width: '240', height: '40', role: 'img', 'aria-label': `Waveform of ${who}` }) as HTMLCanvasElement;
    requestAnimationFrame(() => drawWave(canvas, data, e.samples, !!swap));
    const playing = this.playingEntry === e.entry;
    const playBtn = el('button', { type: 'button', class: 'sample-btn', 'aria-label': `${playing ? 'Stop' : 'Play'} ${who}`, 'aria-pressed': String(playing) }, playing ? 'Stop' : 'Play');
    playBtn.addEventListener('click', () => {
      if (this.playingEntry === e.entry) { stopPlaying(); this.playingEntry = null; this.render(); return; }
      this.playingEntry = e.entry;
      play(data, () => { if (this.playingEntry === e.entry) { this.playingEntry = null; this.render(); } });
      this.render();
    });
    const input = el('input', { type: 'file', accept: 'audio/*,.wav,.aif,.aiff', class: 'sample-file', 'aria-label': `Replace ${who} with an audio file` }) as HTMLInputElement;
    input.addEventListener('change', () => { if (input.files?.[0]) void this.replace(e, input.files[0]); });
    const replace = el('label', { class: 'sample-btn sample-replace' }, input, 'Replace…');
    const revert = el('button', { type: 'button', class: 'sample-btn', 'aria-label': `Revert ${who} to the stock sample` }, 'Revert');
    if (!swap) revert.setAttribute('disabled', '');
    revert.addEventListener('click', () => {
      this.state.swaps.delete(e.entry); this.state.sources.delete(e.entry); this.state.notes.delete(e.entry);
      this.say(`Sample ${e.entry} is the stock sample again.`, 'ok');
      this.changed();
    });
    const noTrimId = `no-trim-${e.entry}-${m?.id ?? 'x'}`;
    const noTrim = el('input', { type: 'checkbox', id: noTrimId }) as HTMLInputElement;
    noTrim.checked = this.state.noTrim.has(e.entry);
    noTrim.addEventListener('change', () => {
      if (noTrim.checked) this.state.noTrim.add(e.entry); else this.state.noTrim.delete(e.entry);
      this.changed();
    });
    const len = this.lengthOf(e);
    const facts = el('div', { class: 'sample-facts' },
      el('span', { class: 'sample-name' }, `Sample ${e.entry}${role ? ` · ${role}` : ''}`),
      el('span', {}, `${secs(len)}${swap ? ` of ${secs(e.samples)} max` : ''}`),
      el('span', {}, `${fmt(words(len))} words`));
    const notes: (Node | string)[] = [];
    if (swap) notes.push(el('span', { class: 'sample-swapped' }, `${this.state.sources.get(e.entry) ?? 'Your sample'}`),
      ...(this.state.notes.get(e.entry)?.length ? [` · ${this.state.notes.get(e.entry)!.join('; ')}`] : []));
    else notes.push('Stock sample');
    const others = e.machines.filter((x) => x.id !== m?.id).map((x) => x.name);
    if (others.length) notes.push(el('span', { class: 'sample-shared' }, ` · also played by ${others.join(', ')}: replacing it changes both`));
    for (const p of e.pairs.filter((q) => !m || m.entries.includes(q.partner))) {
      const partner = this.bank!.entries[p.partner];
      notes.push(el('span', { class: 'sample-pair' }, ` · paired with sample ${partner.entry}` +
        (p.first ? ' (it plays only while this one does)' : ' (plays only while the main sample does)')));
    }
    const pad = this.paddedFor(e);
    if (pad !== null) notes.push(el('span', { class: 'sample-warn' }, ` · shorter than sample ${pad}: padded with silence to its length so the layer does not repeat as a tone`));
    const row = el('div', { class: 'sample-row', 'data-entry': String(e.entry), ...(swap ? { 'data-swapped': '' } : {}) },
      canvas, facts,
      el('div', { class: 'sample-actions' }, playBtn, replace, revert,
        el('label', { class: 'sample-notrim', for: noTrimId }, noTrim, "Don't trim")),
      el('p', { class: 'fine sample-note' }, ...notes));
    row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('over');
      const f = ev.dataTransfer?.files[0];
      if (f) void this.replace(e, f);
    });
    return row;
  }

  private async replace(e: BankEntry, f: File): Promise<void> {
    this.say(`Converting ${f.name}…`);
    try {
      const r = await convertFile(f, e.samples, this.options());
      this.state.swaps.set(e.entry, r.data);
      this.state.sources.set(e.entry, f.name);
      this.state.notes.set(e.entry, r.notes.filter((n) => !n.startsWith('quantised')));
      this.say(`Sample ${e.entry} replaced with ${f.name} (${secs(r.data.length)})` +
        (r.cut ? `: it was longer than the stock sample, so it was cut to ${secs(e.samples)} with a short fade.` : '.'), r.cut ? 'info' : 'ok');
      this.changed();
    } catch (err) {
      this.say(`${f.name} not used: ${(err as Error).message}`, 'error');
    }
  }

  private changed(): void {
    this.render();
    this.onChange();
  }
}

function drawWave(c: HTMLCanvasElement, x: Int16Array, cap: number, mine: boolean): void {
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width, h = c.height, mid = h / 2;
  const css = getComputedStyle(c);
  const color = (k: string, d: string): string => css.getPropertyValue(k).trim() || d;
  g.clearRect(0, 0, w, h);
  g.fillStyle = color('--wave-bg', '#eef1f3');
  g.fillRect(0, 0, w, h);
  // the waveform over the stock length: a shorter sample leaves the rest of the box empty
  const span = Math.max(cap, x.length, 1);
  g.fillStyle = mine ? color('--wave-mine', '#a63d35') : color('--wave', '#596e79');
  for (let px = 0; px < w; px++) {
    const a = Math.floor((px * span) / w), b = Math.min(x.length, Math.floor(((px + 1) * span) / w));
    if (a >= x.length) break;
    let lo = 0, hi = 0;
    for (let i = a; i < Math.max(b, a + 1); i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); }
    const y0 = mid - (hi / 2048) * mid, y1 = mid - (lo / 2048) * mid;
    g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
  }
}
