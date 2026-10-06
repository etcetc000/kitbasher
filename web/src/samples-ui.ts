// The Samples step: the OS's E12 bank as a pad grid, one tile per E12 machine in Machinedrum order
// (BD SD HT LT CP RS CB CH / OH RC CC BR TA TR SH BC); the two-sample machines split into a main
// and a layer half. Click a pad to select and play it; drop a file on a pad to replace it; drop
// several files or a folder for a matched-by-name review (web/src/sample-match.ts). The detail strip under the grid has the larger
// waveform, Revert, Don't trim, the notes and a file picker.
//
// Swapped samples are converted in the browser (web/src/convert.ts) and never longer than the
// stock sample they replace. The engine reads the bank and which machine plays which sample from
// the loaded OS (engine/src/samples.ts readBank); the trim and the memory meters in the Models
// step use the swapped bank (app.ts passes `edits()` to every plan and build).

import { PAD } from '../../engine/src/e12.js';
import { type BankEntry, type E12Bank, type E12Machine, type SampleEdits } from '../../engine/src/samples.js';
import { convertFile, play, stopPlaying, SAMPLE_RATE, type ConvertOptions } from './convert.js';
import { AUDIO_EXT, matchFiles, type Match } from './sample-match.js';

const el = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const svg = (path: string): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = path;
  return s;
};
const ICON = {
  link: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>',
  warn: '<path fill="currentColor" d="M8 1.5l7 12.5H1z"/><path fill="var(--panel,#fff)" d="M7.25 6h1.5v4h-1.5zM7.25 11h1.5v1.5h-1.5z"/>',
  lock: '<rect x="3" y="7" width="10" height="7.5" rx="1.2" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};
const fmt = (n: number): string => n.toLocaleString('en');
const secs = (n: number): string => `${(n / SAMPLE_RATE).toFixed(3)} s`;
const words = (samples: number): number => Math.ceil(samples / 2) + PAD;
const codeOf = (m: E12Machine): string => m.name.replace(/^E12/, '');
const DRAG_CHIP = 'application/x-kitbasher-chip';

export interface SampleState {
  swaps: Map<number, Int16Array>;
  noTrim: Set<number>;
  sources: Map<number, string>;      // file names, for display and the project file
  notes: Map<number, string[]>;      // what the conversion did
}

export const emptyState = (): SampleState => ({ swaps: new Map(), noTrim: new Set(), sources: new Map(), notes: new Map() });

/** What the step asks of the page. */
export interface SamplesHost {
  onChange(): void;                  // the edits changed: re-plan
  saveKit(): void;                   // the project file (app.ts saveProject)
  loadKit(f: File): void;            // a project file chosen or dropped (app.ts onProjectFile)
}

/** One pad: a machine's sample, or one half of a two-sample machine. */
interface Target { m: E12Machine; entry: number; part: 'main' | 'layer' | null }

interface ReviewItem { file: File; match: Match; target: number | null }

export class SamplesStep {
  bank: E12Bank | null = null;
  state: SampleState = emptyState();
  private selected: Target | null = null;
  private playingEntry: number | null = null;
  private review: ReviewItem[] | null = null;
  private readonly ui: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly host: SamplesHost) {
    this.ui = root.querySelector<HTMLElement>('#sample-ui')!;
    // the waveforms take their colours from the theme: redraw when it changes
    new MutationObserver(() => { if (this.bank) this.render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** The edits the engine plans and builds with. */
  edits(): SampleEdits { return { swaps: this.state.swaps, noTrim: this.state.noTrim }; }

  private opts: ConvertOptions = { normalise: true, trimSilence: true };
  private options(): ConvertOptions { return this.opts; }

  /** A new OS: its bank (null: none, with why), and no swaps. */
  setBank(bank: E12Bank | null, why = ''): void {
    stopPlaying();
    this.playingEntry = null;
    this.bank = bank;
    this.state = emptyState();
    this.review = null;
    this.selected = null;
    this.render();
    this.say(why, why ? 'error' : 'info');
  }

  private message = '';
  private messageKind: 'info' | 'ok' | 'error' = 'info';
  private say(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.message = text;
    this.messageKind = kind;
    const m = this.ui.querySelector<HTMLElement>('#sample-message');
    if (m) { m.textContent = text; m.dataset.kind = kind; m.hidden = !text; }
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

  private cut(entry: number): boolean { return (this.state.notes.get(entry) ?? []).some((n) => /^cut /.test(n)); }

  /** The pads in grid order: the E12 machines in Machinedrum order, halves main then layer. */
  private targets(): Target[] {
    const b = this.bank!;
    const machines = [...b.machines].sort((x, y) => x.id - y.id);
    return machines.flatMap((m): Target[] => m.entries.length > 1
      ? [{ m, entry: m.entries[0], part: 'main' as const }, { m, entry: m.entries[1], part: 'layer' as const }]
      : [{ m, entry: m.entries[0], part: null }]);
  }

  private describe(t: Target): string {
    const e = this.bank!.entries[t.entry];
    const swap = this.state.swaps.get(t.entry);
    const bits = [`${t.m.name}${t.part ? ` ${t.part}` : ''}`, `sample ${t.entry}`,
      swap ? `replaced with ${this.state.sources.get(t.entry) ?? 'your sample'}` : 'stock',
      swap ? `${secs(swap.length)} of ${secs(e.samples)}` : secs(e.samples)];
    const others = e.machines.filter((x) => x.id !== t.m.id).map((x) => x.name);
    if (others.length) bits.push(`shared with ${others.join(', ')}`);
    if (this.paddedFor(e) !== null) bits.push(`padded with silence to sample ${this.paddedFor(e)}`);
    if (this.cut(t.entry)) bits.push('cut to the stock length');
    if (this.state.noTrim.has(t.entry)) bits.push("don't trim");
    if (this.playingEntry === t.entry) bits.push('playing');
    return bits.join(', ');
  }

  // ---- rendering

  render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.closest?.('.pad-target')?.getAttribute('data-key') ?? null;
    this.ui.replaceChildren();
    const b = this.bank;
    if (!b) { this.ui.append(el('p', { class: 'fine' }, 'No E12 samples to show.'), this.messageEl()); return; }
    const targets = this.targets();
    if (!this.selected || !targets.some((t) => t.m.id === this.selected!.m.id && t.entry === this.selected!.entry)) this.selected = targets[0];
    this.ui.append(this.meterEl(), this.toolbarEl(), this.messageEl());
    if (this.review) this.ui.append(this.reviewEl());
    this.ui.append(this.gridEl(targets), this.legendEl(), this.detailEl(this.selected));
    if (focusKey) this.ui.querySelector<HTMLElement>(`.pad-target[data-key="${focusKey}"]`)?.focus();
  }

  private messageEl(): HTMLElement {
    const m = el('p', { id: 'sample-message', class: 'fine', role: 'status', 'aria-live': 'polite', 'data-kind': this.messageKind }, this.message);
    m.hidden = !this.message;
    return m;
  }

  private meterEl(): HTMLElement {
    const f = this.footprint();
    const pct = Math.min(100, (100 * f.used) / f.stock);
    const fill = el('div', { class: 'fill' });
    fill.style.width = `${pct}%`;
    const swapped = this.state.swaps.size;
    return el('div', { class: 'meter sample-meter', 'data-state': 'ok', title: `${fmt(f.used)} / ${fmt(f.stock)} words` },
      el('div', { class: 'top' }, el('span', {}, `Sample memory${swapped ? ` · ${swapped} of ${this.bank!.entries.length} replaced` : ''}`),
        el('span', { class: 'num', id: 'sample-summary' }, `${fmt(f.used)} of ${fmt(f.stock)} words` +
          (f.used < f.stock ? ` · ${fmt(f.stock - f.used)} freed for models` : ''))),
      el('div', { class: 'bar' }, fill));
  }

  private toolbarEl(): HTMLElement {
    const check = (id: string, label: string, k: keyof ConvertOptions): HTMLElement => {
      const i = el('input', { type: 'checkbox', id }) as HTMLInputElement;
      i.checked = this.opts[k];
      i.addEventListener('change', () => { this.opts = { ...this.opts, [k]: i.checked }; });
      return el('label', { for: id }, i, label);
    };
    const revertAll = el('button', { type: 'button', class: 'sample-btn', id: 'sample-revert-all' }, 'Revert all');
    if (!this.state.swaps.size && !this.state.noTrim.size) revertAll.setAttribute('disabled', '');
    revertAll.addEventListener('click', () => {
      this.state = emptyState();
      this.say('All samples are the stock ones again.', 'ok');
      this.changed();
    });
    const save = el('button', { type: 'button', class: 'sample-btn', id: 'sample-save-kit' }, 'Save kit');
    save.addEventListener('click', () => this.host.saveKit());
    const loadIn = el('input', { type: 'file', accept: '.json,application/json', class: 'sample-file', id: 'sample-load-kit', 'aria-label': 'Load kit (a .kitbasher.json project file)' }) as HTMLInputElement;
    loadIn.addEventListener('change', () => { if (loadIn.files?.[0]) this.host.loadKit(loadIn.files[0]); loadIn.value = ''; });
    return el('div', { class: 'sample-toolbar' },
      el('div', { class: 'sample-options' }, check('sample-normalise', 'Normalise new samples', 'normalise'),
        check('sample-trim-silence', 'Trim silence at the start and end', 'trimSilence')),
      el('div', { class: 'sample-actions' }, revertAll, save, el('label', { class: 'sample-btn sample-replace' }, loadIn, 'Load kit…')));
  }

  private gridEl(targets: Target[]): HTMLElement {
    const grid = el('div', { class: 'pad-grid', role: 'group', 'aria-label': 'E12 pads: arrows move, Space plays, Enter replaces, Delete reverts', id: 'pad-grid' });
    const machines = [...new Set(targets.map((t) => t.m))];
    for (const m of machines) {
      const mine = targets.filter((t) => t.m === m);
      grid.append(el('div', { class: 'pad-tile', 'data-machine': codeOf(m), ...(mine.length > 1 ? { 'data-pair': '' } : {}) },
        el('div', { class: 'pad-name' }, el('span', { class: 'pad-prefix' }, 'E12'), codeOf(m)),
        ...mine.map((t) => this.targetEl(t))));
    }
    // a drop on the grid but not on a pad: a bulk drop
    grid.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes('Files')) return;
      ev.preventDefault();
      grid.toggleAttribute('data-over', !(ev.target as HTMLElement).closest('.pad-target'));
    });
    grid.addEventListener('dragleave', (ev) => { if (ev.target === grid) grid.removeAttribute('data-over'); });
    grid.addEventListener('drop', (ev) => {
      grid.removeAttribute('data-over');
      if ((ev.target as HTMLElement).closest('.pad-target') || !ev.dataTransfer) return;
      ev.preventDefault();
      void this.onFilesDropped(ev.dataTransfer, null);
    });
    return grid;
  }

  private targetEl(t: Target): HTMLElement {
    const e = this.bank!.entries[t.entry];
    const swap = this.state.swaps.get(t.entry);
    const data = swap ?? e.data;
    const key = `${t.m.id}-${t.entry}`;
    const sel = this.selected?.m.id === t.m.id && this.selected.entry === t.entry;
    const btn = el('button', {
      type: 'button', class: 'pad-target', 'data-key': key, 'data-entry': String(t.entry), 'data-state': swap ? 'mine' : 'stock',
      'aria-label': this.describe(t), tabindex: sel ? '0' : '-1', ...(sel ? { 'aria-current': 'true' } : {}),
      ...(this.playingEntry === t.entry ? { 'data-playing': '' } : {}),
      title: 'Click to play; drop a WAV or AIFF file here to replace it',
    }) as HTMLButtonElement;
    const canvas = el('canvas', { class: 'pad-wave', width: '160', height: t.part ? '44' : '96', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    requestAnimationFrame(() => drawWave(canvas, data, e.samples, !!swap));
    const fill = el('span', { class: 'pad-fill' });
    fill.style.width = `${Math.min(100, (100 * data.length) / e.samples)}%`;
    const badges = el('span', { class: 'pad-badges' }, ...this.badges(t));
    btn.append(
      el('span', { class: 'pad-head' }, el('span', { class: 'pad-part' }, t.part ?? `sample ${t.entry}`), badges),
      canvas,
      el('span', { class: 'pad-len' }, secs(data.length)),
      el('span', { class: 'pad-bar', 'aria-hidden': 'true' }, fill));
    btn.addEventListener('click', () => this.activate(t));
    btn.addEventListener('keydown', (ev) => this.onKey(ev, t));
    btn.addEventListener('dragover', (ev) => {
      const types = ev.dataTransfer?.types ?? [];
      if (!types.includes('Files') && !types.includes(DRAG_CHIP)) return;
      ev.preventDefault();
      ev.stopPropagation();
      btn.setAttribute('data-over', '');
    });
    btn.addEventListener('dragleave', () => btn.removeAttribute('data-over'));
    btn.addEventListener('drop', (ev) => {
      btn.removeAttribute('data-over');
      const dt = ev.dataTransfer;
      if (!dt) return;
      ev.preventDefault();
      ev.stopPropagation();
      const chip = dt.getData(DRAG_CHIP);
      if (chip !== '') this.assignChip(Number(chip), t.entry);
      else void this.onFilesDropped(dt, t);
    });
    return btn;
  }

  private badges(t: Target): HTMLElement[] {
    const e = this.bank!.entries[t.entry];
    const out: HTMLElement[] = [];
    const badge = (kind: string, icon: string, text: string): HTMLElement => {
      const b = el('span', { class: 'pad-badge', 'data-kind': kind, title: text });
      b.append(svg(icon), el('span', { class: 'sr-only' }, text));
      return b;
    };
    const others = e.machines.filter((x) => x.id !== t.m.id).map((x) => x.name);
    if (others.length) out.push(badge('shared', ICON.link, `Shared with ${others.join(', ')}`));
    const pad = this.paddedFor(e);
    if (pad !== null) out.push(badge('warn', ICON.warn, `Padded with silence to sample ${pad}'s length`));
    else if (this.cut(t.entry)) out.push(badge('warn', ICON.warn, 'Cut to the stock length'));
    if (this.state.noTrim.has(t.entry)) out.push(badge('lock', ICON.lock, "Don't trim"));
    return out;
  }

  private legendEl(): HTMLElement {
    const item = (kind: string, icon: string, text: string): HTMLElement => {
      const s = el('span', { class: 'pad-badge', 'data-kind': kind });
      s.append(svg(icon));
      return el('li', {}, s, text);
    };
    return el('ul', { class: 'pad-legend', 'aria-label': 'Legend' },
      el('li', {}, el('span', { class: 'pad-swatch', 'data-state': 'stock' }), 'Stock sample'),
      el('li', {}, el('span', { class: 'pad-swatch', 'data-state': 'mine' }), 'Your sample'),
      item('shared', ICON.link, `Shared sample${this.sharedNote()}`),
      item('warn', ICON.warn, 'Padded or cut'),
      item('lock', ICON.lock, "Don't trim"),
      el('li', { class: 'pad-hint' }, 'Drop one file on a pad to replace it, or several files or a folder on the grid to match them by name.'));
  }

  /** " (12: SD and RS)": the samples more than one machine plays */
  private sharedNote(): string {
    const shared = this.bank!.entries.filter((e) => e.machines.length > 1);
    return shared.length ? ` (${shared.map((e) => `${e.entry}: ${e.machines.map(codeOf).join(' and ')}`).join('; ')})` : '';
  }

  private detailEl(t: Target): HTMLElement {
    const e = this.bank!.entries[t.entry];
    const swap = this.state.swaps.get(t.entry);
    const data = swap ?? e.data;
    const canvas = el('canvas', { class: 'detail-wave', width: '1000', height: '120', role: 'img', 'aria-label': `Waveform of ${t.m.name}${t.part ? ` ${t.part}` : ''}` }) as HTMLCanvasElement;
    requestAnimationFrame(() => drawWave(canvas, data, e.samples, !!swap));
    const playing = this.playingEntry === t.entry;
    const playBtn = el('button', { type: 'button', class: 'sample-btn', id: 'detail-play', 'aria-pressed': String(playing) }, playing ? 'Stop' : 'Play');
    playBtn.addEventListener('click', () => this.togglePlay(t));
    const revert = el('button', { type: 'button', class: 'sample-btn', id: 'detail-revert' }, 'Revert');
    if (!swap) revert.setAttribute('disabled', '');
    revert.addEventListener('click', () => this.revert(t.entry));
    const noTrim = el('input', { type: 'checkbox', id: 'detail-no-trim' }) as HTMLInputElement;
    noTrim.checked = this.state.noTrim.has(t.entry);
    noTrim.addEventListener('change', () => {
      if (noTrim.checked) this.state.noTrim.add(t.entry); else this.state.noTrim.delete(t.entry);
      this.changed();
    });
    const input = el('input', { type: 'file', accept: 'audio/*,.wav,.aif,.aiff', class: 'sample-file', id: 'detail-file', 'aria-label': `Replace ${t.m.name}${t.part ? ` ${t.part}` : ''} with an audio file` }) as HTMLInputElement;
    input.addEventListener('change', () => { if (input.files?.[0]) void this.replace(t.entry, input.files[0]); input.value = ''; });
    const notes: string[] = [];
    if (swap) notes.push(`${this.state.sources.get(t.entry) ?? 'Your sample'}: ${secs(swap.length)} of at most ${secs(e.samples)}.`, ...(this.state.notes.get(t.entry) ?? []));
    else notes.push(`Stock sample, ${secs(e.samples)}.`);
    const others = e.machines.filter((x) => x.id !== t.m.id).map((x) => x.name);
    if (others.length) notes.push(`Also played by ${others.join(', ')}: replacing it changes both.`);
    for (const p of e.pairs.filter((q) => t.m.entries.includes(q.partner))) {
      notes.push(p.first ? `Main sample: its layer (sample ${p.partner}) plays only while this one does.` : `Layer: plays only while the main sample (sample ${p.partner}) does.`);
    }
    const pad = this.paddedFor(e);
    if (pad !== null) notes.push(`Shorter than sample ${pad}: padded with silence to its length so the layer does not repeat as a tone.`);
    return el('section', { class: 'pad-detail', 'aria-label': 'Selected pad' },
      el('div', { class: 'pad-detail-head' },
        el('h3', {}, `${t.m.name}${t.part ? ` · ${t.part}` : ''}`),
        el('span', { class: 'fine' }, `Sample ${t.entry} · ${secs(data.length)} · ${fmt(words(data.length))} words`)),
      canvas,
      el('div', { class: 'sample-actions' }, playBtn,
        el('label', { class: 'sample-btn sample-replace' }, input, 'Replace…'), revert,
        el('label', { class: 'sample-notrim', for: 'detail-no-trim' }, noTrim, "Don't trim")),
      el('ul', { class: 'pad-notes fine' }, ...notes.map((n) => el('li', {}, n))));
  }

  private reviewEl(): HTMLElement {
    const items = this.review!;
    const name = (entry: number): string => {
      const t = this.targets().find((x) => x.entry === entry)!;
      return `${codeOf(t.m)}${t.part === 'layer' ? ' layer' : ''}`;
    };
    const matched = items.filter((i) => i.target !== null);
    const chip = (i: ReviewItem): HTMLElement => {
      const k = items.indexOf(i);
      const c = el('span', { class: 'review-chip', draggable: 'true', 'data-assigned': String(i.target !== null), title: i.match.why ?? 'Drag onto a pad' },
        i.file.name, i.target !== null ? el('b', {}, ` → ${name(i.target)}`) : '');
      c.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData(DRAG_CHIP, String(k)); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; });
      return c;
    };
    const apply = el('button', { type: 'button', class: 'wizard-primary', id: 'review-apply' }, `Apply ${matched.length}`);
    if (!matched.length) apply.setAttribute('disabled', '');
    apply.addEventListener('click', () => void this.applyReview());
    const cancel = el('button', { type: 'button', class: 'sample-btn', id: 'review-cancel' }, 'Cancel');
    cancel.addEventListener('click', () => { this.review = null; this.say('Nothing was changed.'); this.render(); });
    return el('section', { class: 'review-bar', id: 'review-bar', 'aria-label': 'Files to apply' },
      el('div', { class: 'review-head' },
        el('strong', {}, `${matched.length} matched, ${items.length - matched.length} unmatched`),
        el('span', { class: 'fine' }, 'Drag a file onto a pad to place it, or onto another pad to move it.'),
        el('span', { class: 'review-actions' }, cancel, apply)),
      el('div', { class: 'review-chips' }, ...matched.map(chip)),
      items.length > matched.length ? el('div', { class: 'review-chips', 'data-unmatched': '' }, ...items.filter((i) => i.target === null).map(chip)) : '');
  }

  // ---- actions

  private activate(t: Target): void {
    const same = this.selected?.m.id === t.m.id && this.selected.entry === t.entry;
    this.selected = t;
    if (same && this.playingEntry === t.entry) { stopPlaying(); this.playingEntry = null; this.render(); return; }
    this.startPlay(t);
  }

  private togglePlay(t: Target): void {
    if (this.playingEntry === t.entry) { stopPlaying(); this.playingEntry = null; this.render(); return; }
    this.startPlay(t);
  }

  private startPlay(t: Target): void {
    const data = this.state.swaps.get(t.entry) ?? this.bank!.entries[t.entry].data;
    this.playingEntry = t.entry;
    try {
      play(data, () => { if (this.playingEntry === t.entry) { this.playingEntry = null; this.render(); } });
    } catch { this.playingEntry = null; }
    this.render();
  }

  private onKey(ev: KeyboardEvent, t: Target): void {
    const pads = Array.from(this.ui.querySelectorAll<HTMLElement>('.pad-target'));
    const here = pads.findIndex((p) => p.dataset.key === `${t.m.id}-${t.entry}`);
    let next = -1;
    if (ev.key === 'ArrowRight') next = Math.min(pads.length - 1, here + 1);
    else if (ev.key === 'ArrowLeft') next = Math.max(0, here - 1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = pads.length - 1;
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      // the nearest pad in the row above or below, by position (8 or 4 tiles a row, halves stacked)
      const r = pads[here].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const down = ev.key === 'ArrowDown';
      let best = -1, bestDy = Infinity, bestDx = Infinity;
      pads.forEach((p, i) => {
        const q = p.getBoundingClientRect();
        const dy = down ? q.top - r.bottom : r.top - q.bottom;
        if (dy < -1) return;
        const dx = Math.abs(q.left + q.width / 2 - cx);
        if (dy < bestDy - 4 || (Math.abs(dy - bestDy) <= 4 && dx < bestDx)) { best = i; bestDy = dy; bestDx = dx; }
      });
      next = best;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.selected = t;
      this.render();
      this.ui.querySelector<HTMLInputElement>('#detail-file')?.click();
      return;
    } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      this.selected = t;
      this.revert(t.entry);
      return;
    } else return;
    ev.preventDefault();
    if (next < 0 || next === here) return;
    const key = pads[next].dataset.key!;
    const target = this.targets().find((x) => `${x.m.id}-${x.entry}` === key)!;
    this.selected = target;
    this.render();
    this.ui.querySelector<HTMLElement>(`.pad-target[data-key="${key}"]`)?.focus();
  }

  private revert(entry: number): void {
    if (!this.state.swaps.has(entry)) { this.say(`Sample ${entry} is already the stock sample.`); return; }
    this.state.swaps.delete(entry); this.state.sources.delete(entry); this.state.notes.delete(entry);
    this.say(`Sample ${entry} is the stock sample again.`, 'ok');
    this.changed();
  }

  private async replace(entry: number, f: File): Promise<boolean> {
    const e = this.bank!.entries[entry];
    this.say(`Converting ${f.name}…`);
    try {
      const r = await convertFile(f, e.samples, this.options());
      this.state.swaps.set(entry, r.data);
      this.state.sources.set(entry, f.name);
      this.state.notes.set(entry, r.notes.filter((n) => !n.startsWith('quantised')));
      this.say(`Sample ${entry} replaced with ${f.name} (${secs(r.data.length)})` +
        (r.cut ? `: it was longer than the stock sample, so it was cut to ${secs(e.samples)} with a short fade.` : '.'), r.cut ? 'info' : 'ok');
      return true;
    } catch (err) {
      this.say(`${f.name} not used: ${(err as Error).message}`, 'error');
      return false;
    }
  }

  /** Files dropped on a pad (`t`) or on the grid (null): one audio file on a pad replaces it, a project loads, anything else goes to review. */
  private async onFilesDropped(dt: DataTransfer, t: Target | null): Promise<void> {
    const files = await droppedFiles(dt);
    const kit = files.find((f) => /\.json$/i.test(f.name));
    if (kit) { this.host.loadKit(kit); return; }
    const audio = files.filter((f) => AUDIO_EXT.test(f.name));
    if (!audio.length) { this.say(files.length ? 'Only WAV and AIFF files can be used.' : 'Nothing to use in that drop.', 'error'); return; }
    if (t && audio.length === 1) {
      this.selected = t;
      if (await this.replace(t.entry, audio[0])) this.changed();
      return;
    }
    this.startReview(audio);
  }

  private startReview(files: File[]): void {
    const byCode = new Map(this.bank!.machines.map((m) => [codeOf(m), m]));
    this.review = matchFiles(files.map((f) => f.name)).map((match, i) => {
      const m = match.code ? byCode.get(match.code) : undefined;
      const target = m ? (match.part === 'layer' && m.entries.length > 1 ? m.entries[1] : m.entries[0]) : null;
      return { file: files[i], match, target };
    });
    // two files can still land on one sample (SD and RS share their main): keep the first
    const seen = new Set<number>();
    for (const r of this.review) {
      if (r.target === null) continue;
      if (seen.has(r.target)) { r.match = { ...r.match, why: `sample ${r.target} is already taken` }; r.target = null; } else seen.add(r.target);
    }
    this.say('');
    this.render();
    this.ui.querySelector<HTMLElement>('#review-bar')?.scrollIntoView({ block: 'nearest' });
  }

  private assignChip(k: number, entry: number): void {
    const items = this.review;
    if (!items?.[k]) return;
    for (const i of items) if (i.target === entry) i.target = null;
    items[k].target = entry;
    this.render();
  }

  private async applyReview(): Promise<void> {
    const items = (this.review ?? []).filter((i) => i.target !== null);
    let ok = 0;
    for (const i of items) if (await this.replace(i.target!, i.file)) ok++;
    this.review = null;
    this.say(`${ok} of ${items.length} sample${items.length === 1 ? '' : 's'} replaced.`, ok === items.length ? 'ok' : 'error');
    this.changed();
  }

  private changed(): void {
    this.render();
    this.host.onChange();
  }
}

/** Every file in a drop, folders walked (webkitGetAsEntry); read before the drop event ends. */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? []).map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null));
  if (!entries.some((e) => e?.isDirectory)) return Array.from(dt.files ?? []);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) { out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej))); return; }
    const reader = (e as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await walk(c);
    }
  };
  for (const e of entries) if (e) await walk(e);
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  // over the stock length: a shorter sample leaves the rest of the box empty
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

