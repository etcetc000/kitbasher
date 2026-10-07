// The Samples step: the OS's E12 bank as a pad grid, one tile per E12 machine in Machinedrum order
// (BD SD HT LT CP RS CB CH / OH RC CC BR TA TR SH BC); the two-sample machines split into a main
// and a layer half. Click a pad to select and play it; drop a file on a pad to replace it; drop
// several files or a folder to fill the pads in order from there (web/src/sample-fill.ts), shown
// for review before anything is converted. The detail strip under the grid has the larger
// waveform, Revert, Don't trim, the notes and a file picker.
//
// Swapped samples are converted in the browser (web/src/convert.ts) and never longer than the
// stock sample they replace. The engine reads the bank and which machine plays which sample from
// the loaded OS (engine/src/samples.ts readBank); the trim and the memory meters in the Models
// step use the swapped bank (app.ts passes `edits()` to every plan and build).

import type { TrimEntry } from '../../engine/src/e12.js';
import { seconds, type BankEntry, type E12Bank, type E12Machine, type SampleEdits } from '../../engine/src/samples.js';
import { PROJECT_FORMAT } from '../../engine/src/project.js';
import { bufferFor, convertFile, play, primeAudio, stopPlaying, warmAudio, type ConvertOptions } from './convert.js';
import { AUDIO_EXT, fillInOrder } from './sample-fill.js';

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
const secs = (n: number): string => `${seconds(n).toFixed(3)} s`;
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
  /** the bank as the current plan lays it (trimmed, padded): what the badges and the meter show */
  laid(): { report: TrimEntry[]; end: number } | null;
}

/** One pad: a machine's sample, or one half of a two-sample machine. */
interface Target { m: E12Machine; entry: number; part: 'main' | 'layer' | null }

/** A dropped file and the pad it goes to (`pad` names it: "SD", "RC layer"), or not placed. */
interface ReviewItem { file: File; target: number | null; pad: string | null; order: number }

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
    // resume the shared audio context on the first gesture anywhere, ahead of the first pad press
    for (const k of ['pointerdown', 'keydown']) document.addEventListener(k, primeAudio, { capture: true, passive: true });
  }

  /**
   * The edits' signature: which sample data sits on which entry, and the don't-trim set. Anything
   * that changes the state changes it, so a cache keyed on it cannot hand back a stale bank.
   */
  revision(): string {
    const ids = [...this.state.swaps].sort((a, b) => a[0] - b[0]).map(([e, d]) => `${e}:${dataId(d)}`);
    return `${ids.join(',')}|${[...this.state.noTrim].sort((a, b) => a - b).join(',')}`;
  }

  private snapshot: { rev: string; edits: SampleEdits } | null = null;
  /** The edits the engine plans and builds with: a copy per revision (the engine caches by it). */
  edits(): SampleEdits {
    const rev = this.revision();
    if (this.snapshot?.rev !== rev) this.snapshot = { rev, edits: { swaps: new Map(this.state.swaps), noTrim: new Set(this.state.noTrim) } };
    return this.snapshot.edits;
  }

  /** A project's samples (app.ts applyProject): conversions still running for the old state are dropped. */
  setState(state: SampleState): void {
    this.gen++;
    this.review = null;
    this.state = state;
  }

  // Bumped whenever the state is replaced wholesale (a new OS, a project, Revert all): a
  // conversion that started before is discarded when it finishes.
  private gen = 0;
  private pending = new Map<number, number>();
  private requests = 0;
  private applying = false;

  private opts: ConvertOptions = { normalise: true, trimSilence: true };
  private options(): ConvertOptions { return this.opts; }

  /** A new OS: its bank (null: none, with why), and no swaps. */
  setBank(bank: E12Bank | null, why = ''): void {
    stopPlaying();
    this.playingEntry = null;
    this.bank = bank;
    if (bank) warmAudio();
    this.gen++;
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

  /** The engine's row for an entry in the bank the current plan lays, if that plan has these edits. */
  private laidRow(entry: number): TrimEntry | null {
    const l = this.host.laid();
    return l?.report.find((r) => r.entry === entry) ?? null;
  }

  /** The sample words as laid (after trimming and padding), against the stock bank's. */
  footprint(): { used: number; stock: number } | null {
    const l = this.host.laid();
    return l ? { used: l.end - this.bank!.entries[0].start, stock: this.bank!.stockWords } : null;
  }

  /** The partner a first sample is padded for, as the engine laid it. */
  private paddedFor(e: BankEntry): number | null { return this.laidRow(e.entry)?.padded_for ?? null; }

  /** The first sample a partner was shortened for (the stock pair rule), as the engine laid it. */
  private cutFor(e: BankEntry): number | null { return this.laidRow(e.entry)?.for_partner ?? null; }

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
    if (this.paddedFor(e) !== null) bits.push(`padded with silence to sample ${this.paddedFor(e)}'s length`);
    else if (this.cutFor(e) !== null) bits.push(`shortened to match sample ${this.cutFor(e)}`);
    else if (this.cut(t.entry)) bits.push('cut to stock length');
    if (this.state.noTrim.has(t.entry)) bits.push("won't be trimmed");
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
    this.ui.append(this.gridEl(targets), this.detailEl(this.selected));
    if (focusKey) this.ui.querySelector<HTMLElement>(`.pad-target[data-key="${focusKey}"]`)?.focus();
    this.prebuild(targets);
  }

  /** Build every pad's AudioBuffer while the page is idle, so a press never waits for one. */
  private prebuild(targets: Target[]): void {
    const todo = targets.map((t) => this.state.swaps.get(t.entry) ?? this.bank!.entries[t.entry].data);
    const idle = (f: () => void): void => { if ('requestIdleCallback' in window) requestIdleCallback(f); else setTimeout(f, 0); };
    const step = (): void => {
      const d = todo.shift();
      if (!d) return;
      try { bufferFor(d); } catch { return; }
      idle(step);
    };
    idle(step);
  }

  /** Selection and playing state on the pads and the detail strip, without rebuilding the grid. */
  private marks(): void {
    if (!this.bank) return;
    const targets = this.targets();
    for (const btn of Array.from(this.ui.querySelectorAll<HTMLElement>('.pad-target'))) {
      const t = targets.find((x) => `${x.m.id}-${x.entry}` === btn.dataset.key);
      if (!t) continue;
      const sel = this.selected?.m.id === t.m.id && this.selected.entry === t.entry;
      btn.setAttribute('tabindex', sel ? '0' : '-1');
      btn.toggleAttribute('data-playing', this.playingEntry === t.entry);
      if (sel) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
      btn.setAttribute('aria-label', this.describe(t));
    }
    const old = this.ui.querySelector('.pad-detail');
    if (old && this.selected) old.replaceWith(this.detailEl(this.selected));
  }

  private messageEl(): HTMLElement {
    const m = el('p', { id: 'sample-message', class: 'fine', role: 'status', 'aria-live': 'polite', 'data-kind': this.messageKind }, this.message);
    m.hidden = !this.message;
    return m;
  }

  private meterEl(): HTMLElement {
    const f = this.footprint();
    const fill = el('div', { class: 'fill' });
    fill.style.width = f ? `${Math.min(100, (100 * f.used) / f.stock)}%` : '0';
    const swapped = this.state.swaps.size;
    return el('div', { class: 'meter sample-meter', 'data-state': f ? 'ok' : 'pending', ...(f ? { title: `${fmt(f.used)} / ${fmt(f.stock)} words` } : {}) },
      el('div', { class: 'top' }, el('span', {}, `Sample memory${swapped ? ` · ${swapped} replaced` : ''}`),
        el('span', { class: 'num', id: 'sample-summary' }, !f ? '' : `${Math.round((100 * f.used) / f.stock)}%`)),
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
      this.gen++;
      this.pending.clear();
      this.review = null;
      this.state = emptyState();
      this.say('');
      this.changed();
    });
    const save = el('button', { type: 'button', class: 'sample-btn', id: 'sample-save-kit' }, 'Save kit');
    save.addEventListener('click', () => this.host.saveKit());
    const loadIn = el('input', { type: 'file', accept: '.json,application/json', class: 'sample-file', id: 'sample-load-kit', 'aria-label': 'Load kit (a .kitbasher.json project file)' }) as HTMLInputElement;
    loadIn.addEventListener('change', () => { if (loadIn.files?.[0]) this.host.loadKit(loadIn.files[0]); loadIn.value = ''; });
    return el('div', { class: 'sample-toolbar' },
      el('div', { class: 'sample-options' }, check('sample-normalise', 'Normalise', 'normalise'),
        check('sample-trim-silence', 'Trim silence', 'trimSilence')),
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
      title: 'Click to play, drop to replace',
    }) as HTMLButtonElement;
    const canvas = el('canvas', { class: 'pad-wave', width: '160', height: t.part ? '44' : '96', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    requestAnimationFrame(() => drawWave(canvas, data, e.samples, !!swap));
    const fill = el('span', { class: 'pad-fill' });
    fill.style.width = `${Math.min(100, (100 * data.length) / e.samples)}%`;
    const badges = el('span', { class: 'pad-badges' }, ...this.badges(t));
    btn.append(
      el('span', { class: 'pad-head' }, el('span', { class: 'pad-part' }, t.part ?? ''), badges),
      canvas,
      el('span', { class: 'pad-len' }, secs(data.length)),
      el('span', { class: 'pad-bar', 'aria-hidden': 'true' }, fill));
    // a mouse or pen press sounds on pointerdown; a touch sounds on the tap (so scrolling the grid
    // stays silent); a click with no pointer (Space, or a screen reader) plays too
    let touch = false;
    btn.addEventListener('pointerdown', (ev) => { touch = ev.pointerType === 'touch'; if (!touch && ev.button === 0) this.activate(t); });
    btn.addEventListener('click', (ev) => { if (ev.detail === 0 || touch) this.activate(t); touch = false; });
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
      if (chip !== '') this.assignChip(Number(chip), t);
      else void this.onFilesDropped(dt, t);
    });
    return btn;
  }

  private badges(t: Target): HTMLElement[] {
    const e = this.bank!.entries[t.entry];
    const out: HTMLElement[] = [];
    const badge = (kind: string, icon: string, text: string): HTMLElement => {
      const b = el('span', { class: 'pad-badge', 'data-kind': kind, title: text, role: 'img', 'aria-label': text });
      b.append(svg(icon));
      return b;
    };
    const others = e.machines.filter((x) => x.id !== t.m.id).map((x) => x.name);
    if (others.length) out.push(badge('shared', ICON.link, `Shared with ${others.join(', ')}`));
    const pad = this.paddedFor(e);
    const short = this.cutFor(e);
    if (pad !== null) out.push(badge('warn', ICON.warn, 'Padded'));
    else if (short !== null) out.push(badge('warn', ICON.warn, 'Shortened'));
    else if (this.cut(t.entry)) out.push(badge('warn', ICON.warn, 'Cut to fit'));
    if (this.state.noTrim.has(t.entry)) out.push(badge('lock', ICON.lock, "Won't be trimmed"));
    return out;
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
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) void this.replace(t.entry, f).then((ok) => { if (ok) this.changed(); });
    });
    return el('section', { class: 'pad-detail', 'aria-label': 'Selected pad' },
      el('div', { class: 'pad-detail-head' },
        el('h3', {}, `${t.m.name}${t.part ? ` · ${t.part}` : ''}`),
        el('span', { class: 'fine' }, `${swap ? `${this.state.sources.get(t.entry) ?? 'Your sample'} · ` : ''}${secs(data.length)}`)),
      canvas,
      el('div', { class: 'sample-actions' }, playBtn,
        el('label', { class: 'sample-btn sample-replace' }, input, 'Replace…'), revert,
        el('label', { class: 'sample-notrim', for: 'detail-no-trim' }, noTrim, "Don't trim")));
  }

  private reviewEl(): HTMLElement {
    const items = this.review!;
    const placed = items.filter((i) => i.target !== null).sort((x, y) => x.order - y.order);
    const extra = items.filter((i) => i.target === null);
    const chip = (i: ReviewItem): HTMLElement => {
      const k = items.indexOf(i);
      const c = el('span', { class: 'review-chip', draggable: 'true', 'data-assigned': String(i.target !== null),
        title: 'Drag onto a pad' },
        ...(i.pad ? [el('b', {}, `${i.pad} ← `)] : []), i.file.name);
      c.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData(DRAG_CHIP, String(k)); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; });
      return c;
    };
    const apply = el('button', { type: 'button', class: 'wizard-primary', id: 'review-apply' }, `Apply ${placed.length}`);
    if (!placed.length || this.applying) apply.setAttribute('disabled', '');
    apply.addEventListener('click', () => void this.applyReview());
    const cancel = el('button', { type: 'button', class: 'sample-btn', id: 'review-cancel' }, 'Cancel');
    cancel.addEventListener('click', () => { this.review = null; this.say(''); this.render(); });
    return el('section', { class: 'review-bar', id: 'review-bar', 'aria-label': 'Files to apply' },
      el('div', { class: 'review-head' },
        el('strong', {}, `${placed.length} files`),
        el('span', { class: 'review-actions' }, cancel, apply)),
      el('div', { class: 'review-chips' }, ...placed.map(chip)),
      extra.length ? el('div', { class: 'review-chips', 'data-unmatched': '' }, el('span', { class: 'fine' }, 'Left over:'), ...extra.map(chip)) : '');
  }

  // ---- actions

  /** A pad pressed: play it (or stop it, pressed again while playing), then show it selected. */
  private activate(t: Target): void {
    const same = this.selected?.m.id === t.m.id && this.selected.entry === t.entry;
    if (same && this.playingEntry === t.entry) { stopPlaying(); this.playingEntry = null; }
    else this.startPlay(t);
    this.selected = t;
    requestAnimationFrame(() => this.marks());
  }

  private togglePlay(t: Target): void {
    if (this.playingEntry === t.entry) { stopPlaying(); this.playingEntry = null; } else this.startPlay(t);
    this.marks();
  }

  /** Sound first: nothing else happens between the press and the start. */
  private startPlay(t: Target): void {
    const data = this.state.swaps.get(t.entry) ?? this.bank!.entries[t.entry].data;
    this.playingEntry = t.entry;
    try {
      play(data, () => { if (this.playingEntry === t.entry) { this.playingEntry = null; this.marks(); } });
    } catch { this.playingEntry = null; }
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
      this.marks();
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
    this.selected = this.targets().find((x) => `${x.m.id}-${x.entry}` === key)!;
    this.marks();
    pads[next].focus();
  }

  private revert(entry: number): void {
    this.pending.delete(entry);                   // a conversion still running for it is dropped
    if (!this.state.swaps.has(entry)) { return; }
    this.state.swaps.delete(entry); this.state.sources.delete(entry); this.state.notes.delete(entry);
    this.say('');
    this.changed();
  }

  /**
   * Convert a file onto an entry. False, and nothing changed, when it fails or when the state moved
   * on while it ran (a new OS or project, Revert all, a revert or a newer file for this entry).
   */
  private async replace(entry: number, f: File, gen = this.gen): Promise<boolean> {
    const bank = this.bank;
    if (!bank || gen !== this.gen) return false;
    const e = bank.entries[entry];
    const req = ++this.requests;
    this.pending.set(entry, req);
    this.say(`Converting ${f.name}…`);
    try {
      const r = await convertFile(f, e.samples, this.options());
      if (gen !== this.gen || this.bank !== bank || this.pending.get(entry) !== req) return false;
      this.pending.delete(entry);
      this.state.swaps.set(entry, r.data);
      this.state.sources.set(entry, f.name);
      this.state.notes.set(entry, r.notes.filter((n) => !n.startsWith('quantised')));
      this.say(r.cut ? `${f.name} cut to ${secs(e.samples)}.` : '', 'info');
      return true;
    } catch (err) {
      if (this.pending.get(entry) === req) this.pending.delete(entry);
      if (gen === this.gen) this.say(`${f.name} not used: ${(err as Error).message}`, 'error');
      return false;
    }
  }

  /** Files dropped on a pad (`t`) or on the grid (null): one audio file on a pad replaces it, a project loads, anything else goes to review. */
  private async onFilesDropped(dt: DataTransfer, t: Target | null): Promise<void> {
    const gen = this.gen;                       // a drop made before Revert all, a new OS or a project is dropped too
    const files = await droppedFiles(dt);
    if (gen !== this.gen) return;
    const kit = await projectIn(files);
    if (gen !== this.gen) return;
    if (kit) { this.host.loadKit(kit); return; }
    const audio = files.filter((f) => AUDIO_EXT.test(f.name));
    if (!audio.length) { this.say('Only WAV and AIFF files work.', 'error'); return; }
    if (t && audio.length === 1) {
      this.selected = t;
      if (await this.replace(t.entry, audio[0], gen)) this.changed();
      return;
    }
    this.startReview(audio, t);
  }

  /** The pads' main samples in grid order, for filling in order (a shared sample is one slot). */
  private slots(): { pad: string; entry: number; m: E12Machine }[] {
    return this.targets().filter((t) => t.part !== 'layer').map((t) => ({ pad: codeOf(t.m), entry: t.entry, m: t.m }));
  }

  /** Several files: fill the pads in order from the pad dropped on (BD for the grid), for review. */
  private startReview(files: File[], at: Target | null): void {
    const slots = this.slots();
    const start = at ? Math.max(0, slots.findIndex((s) => s.m.id === at.m.id)) : 0;
    const byName = new Map<string, File[]>();
    for (const f of files) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
    const take = (name: string): File => byName.get(name)!.shift()!;
    const { placed, extra } = fillInOrder(files.map((f) => f.name), slots, start);
    const pads = this.targets();
    const orderOf = (pad: string): number => pads.findIndex((x) => codeOf(x.m) === pad && x.part !== 'layer');
    this.review = [
      ...placed.map((p) => ({ file: take(p.name), target: p.entry, pad: p.pad, order: orderOf(p.pad) })),
      ...extra.map((n) => ({ file: take(n), target: null, pad: null, order: Infinity })),
    ];
    this.say('');
    this.render();
    this.ui.querySelector<HTMLElement>('#review-bar')?.scrollIntoView({ block: 'nearest' });
  }

  /** A review file dragged onto a pad: it goes there, and whatever was there is not placed. */
  private assignChip(k: number, t: Target): void {
    const items = this.review;
    if (!items?.[k]) return;
    for (const i of items) if (i.target === t.entry) { i.target = null; i.pad = null; i.order = Infinity; }
    const pads = this.targets();
    items[k].target = t.entry;
    items[k].pad = `${codeOf(t.m)}${t.part === 'layer' ? ' layer' : ''}`;
    items[k].order = pads.findIndex((x) => x.m.id === t.m.id && x.entry === t.entry);
    this.render();
  }

  /** Convert and place every placed file; runs once (Apply is disabled while it does). */
  private async applyReview(): Promise<void> {
    if (this.applying) return;
    const items = (this.review ?? []).filter((i) => i.target !== null);
    const gen = this.gen;
    this.applying = true;
    this.ui.querySelector('#review-apply')?.setAttribute('disabled', '');
    let ok = 0;
    try {
      for (const i of items) {
        if (gen !== this.gen) break;
        if (await this.replace(i.target!, i.file)) ok++;
      }
    } finally { this.applying = false; }
    if (gen !== this.gen) return;            // a new OS, project or Revert all: nothing more to do
    this.review = null;
    this.say(ok === items.length ? '' : `${items.length - ok} of ${items.length} files could not be used.`, 'error');
    this.changed();
  }

  /** The state changed: re-plan first, so the pads show what the engine now lays. */
  private changed(): void {
    this.host.onChange();
    this.render();
  }
}

/**
 * The project file in a drop: one .json file on its own, or any .json whose content is a
 * kitbasher-project/1 file. Anything else that is not audio is ignored.
 */
async function projectIn(files: File[]): Promise<File | null> {
  const json = files.filter((f) => /\.json$/i.test(f.name));
  if (files.length === 1 && json.length === 1) return json[0];
  for (const f of json) {
    try { if ((JSON.parse(await f.text()) as { format?: unknown }).format === PROJECT_FORMAT) return f; } catch { /* not JSON */ }
  }
  return null;
}

// a stable id per sample array, for the edits' signature
const ids = new WeakMap<Int16Array, number>();
let nextId = 0;
function dataId(d: Int16Array): number {
  let id = ids.get(d);
  if (id === undefined) { id = ++nextId; ids.set(d, id); }
  return id;
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

