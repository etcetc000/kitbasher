// The Kitbasher page. Everything runs in the browser: the firmware file never leaves the computer.
//
// Once a base is loaded, every change to the machine selection or the E12 trim re-plans the build
// (engine/src/plan.ts: the same placement the build does, without packing). Users can select
// freely; a selection that does not fit prompts for removing models or trimming samples.
// Continuing from Models also runs a full build in memory to check compressed slot capacity
// before the category step.
//
// Packs: the page bundles the packs that web/build.mjs includes. Users can load more pack files;
// they are read with the File API, never uploaded, and planned and checked exactly like the
// bundled ones.

import { baseSet, identify, NotPatchable, type Base, type BaseProfileFile, type BaseSet, type LineageFile } from '../../engine/src/bases.js';
import { prepare163 } from '../../engine/src/prepare.js';
import { build, CompressedCapacityError, type BuildReport, type BuildResult } from '../../engine/src/build.js';
import { readFirmware, type Firmware } from '../../engine/src/container.js';
import type { TrimOptions } from '../../engine/src/e12.js';
import { checkPack, needLines, type CorePack, type Pack, type PackModel } from '../../engine/src/packs.js';
import { merged, plan, trimFor, type Plan, type Trimmed } from '../../engine/src/plan.js';
import { drawLcd } from './lcd.js';
import { categories, describeModel } from './catalog.js';
import { addScreenHelp } from './screen-help.js';
import { findLayout, fingerprint } from '../../engine/src/layout.js';
import { LayoutEditor } from './layout-ui.js';
import { containerOf, encodeSyx } from '../../engine/src/syx.js';
import { uwDownloads } from './uw-downloads.js';
import { currentFirmwareFixes } from '../../engine/src/clean_recovery.js';
import { findTrimThreshold } from './auto-trim.js';
import { selectCatalog } from '../../engine/src/catalog.js';

interface Data { bases: BaseSet; packs: Pack[]; core: CorePack | null; source: { commit: string } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const fmt = (n: number): string => n.toLocaleString('en');

async function loadData(): Promise<Data> {
  const index = await (await fetch('data/index.json')).json() as { bases: string[]; packs: string[]; source: { commit: string } };
  const files = await Promise.all(index.bases.map(async (f) => (await fetch(`data/bases/${f}`)).json() as Promise<BaseProfileFile | LineageFile>));
  const bases = baseSet(files);
  const all = await Promise.all(index.packs.map(async (f) => (await fetch(`data/packs/${f}`)).json() as Promise<Pack | CorePack>));
  const core = (all.find((p) => p.family === 'CORE') as CorePack | undefined) ?? null;
  const packs = (all.filter((p) => p.family !== 'CORE') as Pack[]).sort((a, b) => a.order - b.order);
  return { bases, packs, core, source: index.source };
}

let data: Data;
let input: Uint8Array | null = null;
let inputName = '';
let fw: Firmware | null = null;
let base: Base | null = null;
let current: Plan | null = null;
const trims = new Map<string, Trimmed>();       // per base file, per trim setting
let layoutEd: LayoutEditor;                      // the menu categories and IDs (web/src/layout-ui.ts)
let step = 1;
let revision = 0;
let building = false;
let downloadUrl: string | null = null;
let fileRequest = 0;
let packedCapacityProblem = false;
let cachedBuild: { revision: number; result: BuildResult } | null = null;
const keepSamples: TrimOptions = { db: -30, minSeconds: Infinity, cap: null };
let autoTrimOptions: TrimOptions = keepSamples;
const trimMode = (): string => document.querySelector<HTMLInputElement>('input[name=e12]:checked')!.value;

function clearDownload(): void {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $('result').replaceChildren();
}

function syncWizard(): void {
  $('memory-trim-slot').hidden = step !== 2;
  if (step > 1) $(`step-${step}`).querySelector('.wizard-actions')!.before($('room'));
  $('room').hidden = !fw || step === 1;
  const ready = !!current?.ok && current.sel.length > 0 && !packedCapacityProblem;
  $('firmware-next').toggleAttribute('disabled', !fw || building);
  $('models-next').toggleAttribute('disabled', !ready || building);
  $('categories-next').toggleAttribute('disabled', !ready || building);
  $('build').toggleAttribute('disabled', !ready || building);
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(b => {
    const n = Number(b.dataset.step);
    b.disabled = building || (n > 1 && !fw) || (n > 2 && !ready);
    if (n === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(b => { b.disabled = building; });
}

function showStep(n: number): void {
  if (building || (n > 1 && !fw) || (n > 2 && (!current?.ok || !current.sel.length || packedCapacityProblem))) return;
  if (step === 2 && n > 2 && !cachedBuild) { void onBuild(n === 3 ? 'categories' : 'download'); return; }
  step = n;
  for (let i = 1; i <= 4; i++) $(`step-${i}`).hidden = i !== n;
  syncWizard();
  const heading = $(`step-${n}`).querySelector<HTMLElement>('h2');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function status(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const s = $('status');
  s.textContent = msg;
  s.dataset.kind = kind;
}

const boxes = (): HTMLInputElement[] => Array.from(document.querySelectorAll<HTMLInputElement>('#machines input[type=checkbox]'));
let inspected: PackModel | null = null;

function inspectModel(m: PackModel, scroll = false): void {
  inspected = m;
  $('model-family').textContent = describeModel(m).category;
  $('model-name').textContent = m.name.trim();
  $('model-description').textContent = describeModel(m).description;
  const needs = needLines(m);
  $('model-needs').replaceChildren(...(needs.length ? [needs.join(' '), ' ', uwGuide()] : []));
  $('model-needs').toggleAttribute('hidden', !needs.length);
  drawLcd($('model-lcd') as HTMLCanvasElement, m);
  addScreenHelp($('model-lcd') as HTMLCanvasElement, m);
  document.querySelectorAll<HTMLElement>('.machine').forEach(row => {
    row.toggleAttribute('data-inspected', row.dataset.module === m.module);
    row.querySelector('button')?.setAttribute('aria-pressed', String(row.dataset.module === m.module));
  });
  if (scroll && window.matchMedia('(max-width: 760px)').matches) {
    $('inspector').scrollIntoView({ block: 'start' });
  }
}

function renderMachines(): void {
  const box = $('machines');
  box.replaceChildren();
  const models = merged(data.packs).flatMap(f => f.models.map(m => ({ m })));
  const groups = [...categories, 'Other models'].filter(category => models.some(({ m }) => describeModel(m).category === category));
  for (const [index, category] of groups.entries()) {
    const list = el('div', { class: 'machines' });
    const group = models.filter(({ m }) => describeModel(m).category === category);
    for (const { m } of group) {
      // Every model starts selected; auto trim and the meters account for workspace memory.
      const cb = el('input', { type: 'checkbox', 'aria-label': `Include ${m.name.trim()}`, 'data-module': m.module, checked: '' }) as HTMLInputElement;
      cb.addEventListener('change', () => { inspectModel(m); refresh(); });
      const labels = m.labels.filter(Boolean).join(' ');
      const requiresUW = m.needs?.some(n => n.kind === 'uw-sample') ?? false;
      const info = el('button', { type: 'button', class: 'machine-info', 'aria-label': `Preview ${m.name.trim()}${requiresUW ? ', requires UW' : ''}`, 'aria-controls': 'inspector', 'aria-pressed': 'false' },
        el('span', { class: 'machine-heading' }, el('span', { class: 'mname' }, m.name.trim()),
          requiresUW ? el('span', { class: 'uw-badge' }, 'requires UW') : ''),
        el('span', { class: 'machine-description' }, describeModel(m).description));
      info.addEventListener('click', () => inspectModel(m, true));
      list.append(el('div', { class: 'machine', 'data-module': m.module, 'data-labels': labels, title: labels },
        cb, info));
    }
    const all = el('button', { type: 'button', class: 'link', 'aria-label': `Select all ${category}` }, 'Select all');
    const none = el('button', { type: 'button', class: 'link', 'aria-label': `Clear ${category}` }, 'Clear');
    // Keep the user's full selection visible; capacity prompts offer trimming or pruning.
    all.addEventListener('click', () => { tickAll(list); refresh(); });
    none.addEventListener('click', () => { list.querySelectorAll('input').forEach((i) => { (i as HTMLInputElement).checked = false; }); refresh(); });
    box.append(el('section', { class: 'family', id: `category-${index}` },
      el('header', {}, el('h3', {}, category), el('span', { class: 'count' }, String(group.length)), all, none), list));
  }
  if (models.length) inspectModel((models.find(({ m }) => m.module === inspected?.module) ?? models[0]).m);
}

function tickAll(list: HTMLElement): void {
  for (const i of Array.from(list.querySelectorAll<HTMLInputElement>('input'))) {
    if (i.checked) continue;
    i.checked = true;
  }
}

const excludes = (): string[] => boxes().filter((i) => !i.checked).map((i) => i.dataset.module!);

function trimOptions(): TrimOptions {
  const mode = trimMode();
  if (mode === 'auto') return autoTrimOptions;
  if (mode === 'keep') return keepSamples;
  const cap = Number(($('cap') as HTMLInputElement).value);
  return { db: Number(($('db') as HTMLInputElement).value), minSeconds: 0.5, cap: cap > 0 ? cap : null };
}

function trimmed(opt = trimOptions()): Trimmed {
  const key = `${opt.db}|${opt.minSeconds}|${opt.cap}`;
  let t = trims.get(key);
  if (!t) { t = trimFor(fw!, base!, opt); trims.set(key, t); }
  return t;
}

// Existing layout IDs remain pinned; newly selected models can use an available ID.
const allowIdMove = (): boolean => true;

function planFor(exclude: string[], opt = trimOptions()): Plan {
  return plan(fw!, base!, data.packs, data.core!, { exclude, trim: opt, allowIdMove: allowIdMove(), layout: layoutEd.mapForPlan(), ...currentFirmwareFixes() }, trimmed(opt));
}

// Trimming can fix DSP placement, not ABI, menu, or other compatibility errors.
function autoPlan(exclude: string[], minDb: number): Plan {
  autoTrimOptions = keepSamples;
  const p = planFor(exclude);
  if (p.dsp2.fits && minDb === -40) return p;
  const cap = Number($<HTMLInputElement>('cap').value) || null;
  const found = findTrimThreshold(db => planFor(exclude, { db, minSeconds: 0.5, cap }),
    candidate => candidate.dsp2.fits, minDb);
  autoTrimOptions = { db: found.db, minSeconds: 0.5, cap };
  $<HTMLInputElement>('db').value = String(autoTrimOptions.db);
  return found.value;
}

function updateTrimControls(): void {
  const mode = trimMode();
  const keep = mode === 'keep';
  $('db-out').textContent = mode === 'auto' && autoTrimOptions === keepSamples
    ? 'not needed' : `${$<HTMLInputElement>('db').value} dB`;
  const cap = Number($<HTMLInputElement>('cap').value);
  $('cap-out').textContent = cap > 0 ? `${cap.toFixed(2)} s` : 'no cap';
  $('trim-effect').hidden = keep || (mode === 'auto' && autoTrimOptions === keepSamples);
  $('trim-controls').toggleAttribute('data-disabled', keep);
  $('db').toggleAttribute('disabled', mode !== 'trim');
  $('cap').toggleAttribute('disabled', keep);
}

function meter(id: string, used: number, cap: number, unit: string, over: boolean): void {
  const m = $(id);
  const pct = cap > 0 ? Math.min(100, (100 * used) / cap) : 100;
  (m.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
  m.dataset.state = over ? 'over' : pct > 90 ? 'tight' : 'ok';
  m.title = `${fmt(used)} / ${fmt(cap)} ${unit}`;
  m.querySelector('.num')!.textContent = over
    ? `${fmt(used - cap)} ${unit} over`
    : `${fmt(cap - used)} ${unit} free`;
}

/** Re-plan and show it: the meters, the problems, which machines can still be added, Build. */
function refresh(minAutoDb = -40): void {
  revision++;
  packedCapacityProblem = false;
  cachedBuild = null;
  $('room').hidden = !fw;
  $('m-packed').dataset.state = 'pending';
  $('m-packed').removeAttribute('title');
  $('m-packed').querySelector('.num')!.textContent = 'Checked when you continue';
  ($('m-packed').querySelector('.fill') as HTMLElement).style.width = '0';
  $('capacity-pending').hidden = false;
  $('capacity-problems').textContent = '';
  $('capacity-problems').hidden = true;
  clearDownload();
  const on = boxes().filter((i) => i.checked).length;
  $('summary').textContent = `${on} selected`;
  if (!data.core || !data.packs.length) {
    current = null;
    $('build').setAttribute('disabled', '');
    $('room').dataset.state = 'idle';
    $('room-note').textContent = 'No machine packs yet: load your pack files (core.json and the family packs) above.';
    $('room-needs').textContent = '';
    syncWizard();
    return;
  }
  if (!fw || !base) {
    current = null;
    $('build').setAttribute('disabled', '');
    document.querySelectorAll<HTMLElement>('#room .num').forEach(n => n.textContent = 'Load firmware to calculate');
    document.querySelectorAll<HTMLElement>('#room .fill').forEach(n => n.style.width = '0');
    $('room').dataset.state = 'idle';
    $('room-note').textContent = 'Load your OS file to see how much room there is.';
    layoutEd.render(null);
    syncWizard();
    return;
  }
  const p = trimMode() === 'auto' ? autoPlan(excludes(), minAutoDb) : planFor(excludes());
  updateTrimControls();
  current = p;
  layoutEd.render(p);
  $('room').dataset.state = p.ok ? 'ok' : 'over';
  const d = p.dsp2;
  const profileRequired = p.problems.some(problem => problem.includes('runtime ABI not qualified'));
  const hadProfileError = $('status').hasAttribute('data-profile-error');
  $('status').toggleAttribute('data-profile-error', profileRequired);
  if (profileRequired) {
    status('This firmware is not supported for the selected models. Load a supported original OS file.', 'error');
  } else if (hadProfileError) {
    status(`Loaded ${inputName}.`, 'ok');
  }
  meter('m-dsp2', d.demand, d.capacity, 'words', !p.ok && d.demand > d.capacity);
  meter('m-ram', p.ram.bytes, p.ram.limit, 'bytes', p.ram.bytes > p.ram.limit);
  $('room-note').textContent = p.ok ? 'Memory'
    : profileRequired ? 'Unsupported firmware'
    : d.demand > d.capacity || p.ram.bytes > p.ram.limit ? 'Not enough memory.' : 'Cannot continue — see details.';
  $('capacity-problems').textContent = p.problems.map(problem => problem.includes('runtime ABI not qualified')
    ? 'These models need a supported original OS file. Trimming samples will not fix this.' : problem).join(' · ');
  $('capacity-problems').hidden = !p.problems.length;
  $('room-needs').textContent = [...p.moves.map((m) => `${m.name} moves ${m.preferred}→${m.id} (${m.why}).`),
    ...p.sel.flatMap((s) => needLines(s.m))].join(' ');
  const trimming = p.trim.report.some(entry => entry.new_words < entry.words);
  $('make-room').hidden = false;
  $('make-room-help').hidden = p.ok || profileRequired;
  $('sample-options').hidden = false;
  $('make-room-help').textContent = !p.dsp2.fits
    ? trimMode() === 'auto' ? 'Still too large. Remove models or lower At most.' : 'Remove models or choose Auto trim.'
    : 'Review the details or remove models. Trimming only frees sample memory.';
  $('download-summary').textContent = `${p.sel.length} models. ${trimming ? 'E12 sample tails trimmed.' : 'Original E12 samples are kept.'}`;
  const needs = p.sel.flatMap(s => needLines(s.m));
  $('download-needs').hidden = !needs.length;
  $('download-needs').replaceChildren(...(needs.length ? [
    el('h3', {}, 'UW sample data: a separate step'),
    el('p', {}, needs.join(' ')),
    el('p', {}, 'These sample-based features require a UW Machinedrum. After installing the firmware, load the matching sample/wavetable SysEx through the UW sample manager, not the firmware upgrade screen. Back up your UW samples first and check the destination slot.'),
    uwDownloads(p.sel.map(s => s.m), data.packs),
    uwGuide(),
  ] : []));
  for (const i of boxes()) {
    const label = i.closest('.machine') as HTMLElement;
    i.disabled = false;
    label.removeAttribute('data-nofit');
    label.title = label.dataset.labels ?? '';
  }
  syncWizard();
}

function syncTrim(): void {
  updateTrimControls();
  refresh();
}

async function onFile(f: File): Promise<void> {
  const request = ++fileRequest;
  revision++;
  input = null; base = null; fw = null; current = null; cachedBuild = null;
  $('room').hidden = true;
  $('firmware-details').hidden = true;
  layoutEd.render(null);
  syncWizard();
  status(`Reading ${f.name}…`);
  clearDownload();
  try {
    let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer());
    let parsed = readFirmware(bytes);
    let b: Base;
    try {
      b = (await identify(parsed, data.bases)).base;
    } catch (e) {
      if (e instanceof NotPatchable && e.profile?.id === 'stock-163') {
        status('Preparing OS 1.63 for your selected models…');
        bytes = (await prepare163(bytes)).output;
        parsed = readFirmware(bytes);
        b = (await identify(parsed, data.bases)).base;
      } else {
        // an OS this page patched: not a base, but it carries its layout, which comes back
        const got = findLayout(parsed);
        if (!got) throw e;
        if (request !== fileRequest) return;
        layoutEd.adopt(got.layout, f.name);
        const fp = await fingerprint(got.layout);
        const want = data.bases.profiles.find((x) => x.id === got.layout.base);
        status(`${f.name} is an OS patched with a layout (${fp}, ${Object.keys(got.layout.machines).length} machines, ` +
               `${got.layout.categories.length} categories): the layout is restored. Now load the original ${want?.name ?? got.layout.base} file to patch it again.`, 'ok');
        refresh();
        return;
      }
    }
    if (request !== fileRequest) return;
    input = bytes; inputName = f.name; base = b; fw = parsed;
    trims.clear();
    layoutEd.setBase(parsed, b);
    $('firmware-info').textContent = `${b.qualification.profile ? b.name : 'Unrecognized firmware version'}.` +
      (b.qualification.level === 'hardware-proven' ? '' : " We haven't tested this version on a Machinedrum yet.");
    $('firmware-details').hidden = false;
    status(`Loaded ${f.name}.`, 'ok');
  } catch (e) {
    if (request !== fileRequest) return;
    input = null; base = null; fw = null;
    status(`${f.name}: ${(e as Error).message}`, 'error');
  }
  refresh();
  if (fw) showStep(2);
}

/** Pack files the user chose: read locally, checked, merged with what is there (same bytes twice is fine). */
async function onPackFiles(files: File[]): Promise<void> {
  const note = $('packs-status');
  try {
    const got = await Promise.all(files.map(async (f) => {
      const p = JSON.parse(await f.text()) as Pack | CorePack & { format?: string };
      if (!p || typeof p !== 'object' || !('family' in p)) throw new Error(`${f.name} is not a machine pack`);
      if (!('format' in p) || p.format === undefined) throw new Error(`${f.name} is not a machine pack`);
      checkPack(p as Pack);
      return p as Pack | CorePack;
    }));
    const mode = $<HTMLSelectElement>('pack-mode').value === 'replace' ? 'replace' : 'add';
    const next = selectCatalog(data, got, mode);
    data = { ...data, ...next };
    const n = merged(data.packs).reduce((k, f) => k + f.models.length, 0);
    note.textContent = `Loaded ${got.length} pack file${got.length === 1 ? '' : 's'}, read in this browser only: ` +
      `${n} machines${data.core ? '' : '; core.json still needed'}.` +
      ` Source: ${[...new Set(got.map(p => p.source?.commit?.slice(0, 8) || 'unspecified'))].join(', ')}.`;
    renderMachines();
    refresh();
  } catch (e) {
    note.textContent = `Pack files not loaded: ${(e as Error).message}`;
  }
}

function uwGuide(): HTMLElement {
  return el('a', { href: 'uw-samples.html', target: '_blank', rel: 'noopener' }, 'How to load UW sample data');
}

function reportView(r: BuildReport): HTMLElement {
  const stat = (k: string, v: string): HTMLElement => el('div', { class: 'stat' }, el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
  const moved = r.id_moves;
  return el('div', { class: 'report' },
    el('p', {class:'note'}, 'Overload recovery is enabled. If processing falls behind, existing voices may briefly cut out so new triggers can recover. The CPU! alert shows recent overruns.'),
    el('div', { class: 'stats' },
      stat('Machines', String(r.machines.length)),
      stat('DSP2 words free', fmt(r.dsp2.free_words)),
      stat('RAM image free', `${r.ext.free} B`),
      stat('OS flash headroom', `${(r.flash.headroom / 1024).toFixed(1)} KB`),
      stat('E12 words freed', fmt(r.e12.freed_words))),
    moved.length ? el('p', { class: 'note' }, `Assigned available IDs: ${moved.map((m) => `${m.name.trim()} ${m.preferred}→${m.id}`).join(', ')}. Use the same saved layout when rebuilding for existing kits.`) : '',
    r.needs.length ? el('p', { class: 'note' }, `Needs data in a UW slot: ${r.needs.join(' ')} `, uwGuide()) : '',
    r.pi_clean ? el('p', { class: 'note' }, `${r.pi_clean.machines.join(', ')} ${r.pi_clean.machines.length === 1 ? 'keeps' : 'keep'} state in the track's P-I slice: ` +
      `the ${r.pi_clean.ids.length} stock P-I machines now clear it first when put on a track (${r.pi_clean.words} DSP2 words).`) : '',
    el('details', {}, el('summary', {}, `Checks (${r.gates.length} passed)`),
      el('ul', { class: 'gates' }, ...r.gates.map((g) => el('li', {}, el('b', {}, g.name), ' ', g.detail)))),
    el('details', {}, el('summary', {}, `Menu: ${r.menus.length} categories after the base's own, ${r.layout_custom ? 'your' : 'the default'} layout table at ${r.flash.layout_table}`),
      el('ul', { class: 'gates', id: 'report-menus' }, ...r.menus.map((f) => el('li', {}, el('b', {}, f.name), ' ', f.machines.join(', '))))),
    el('details', {}, el('summary', {}, 'Machine IDs'),
      el('table', { class: 'ids' }, el('tr', {}, el('th', {}, 'Machine'), el('th', {}, 'Family'), el('th', {}, 'ID')),
        ...r.machines.map((m) => el('tr', {}, el('td', {}, m.name.trim()), el('td', {}, m.family), el('td', {}, String(m.id)))))));
}

async function onBuild(destination: 'categories' | 'download' = 'download'): Promise<void> {
  if (!input || !base || !current?.ok || building) return;
  building = true;
  let version = revision;
  let succeeded = false;
  clearDownload();
  syncWizard();
  const btn = $('build');
  btn.setAttribute('disabled', '');
  status(destination === 'categories' ? 'Checking that your selection fits…' : 'Building…');
  await new Promise((r) => setTimeout(r, 20));
  try {
    const t = performance.now();
    let result = cachedBuild?.revision === version ? cachedBuild.result : undefined;
    while (!result) {
      try {
        result = await build(input, base, data.packs, data.core!,
          { exclude: excludes(), trim: trimOptions(), allowIdMove: allowIdMove(), layout: layoutEd.mapForPlan(), ...currentFirmwareFixes() }, trimmed());
      } catch (error) {
        if (version !== revision) return;
        if (!(error instanceof CompressedCapacityError) || trimMode() !== 'auto') throw error;
        if (autoTrimOptions !== keepSamples && autoTrimOptions.db >= -10) throw error;
        const nextDb = autoTrimOptions === keepSamples ? -40 : Math.min(-10, Number((autoTrimOptions.db + 1).toFixed(1)));
        // Storage is known only after compression. Retry within the same finite
        // threshold range, and never treat ABI, menu, or other build errors as capacity.
        refresh(nextDb);
        version = revision;
        if (!current?.ok) throw new Error(current?.problems.join(' · ') || 'Selection does not fit.');
        status('Auto trimming to fit firmware storage…');
        await new Promise((r) => setTimeout(r, 20));
        if (version !== revision) return;
      }
    }
    if (version !== revision) return;
    cachedBuild = { revision: version, result };
    const { output, kind, report } = result;
    $('capacity-pending').hidden = true;
    $('room-note').textContent = 'Memory fits.';
    if (report.dsp2.packed_capacity !== null) {
      meter('m-packed', report.dsp2.packed, report.dsp2.packed_capacity, 'bytes', false);
    } else {
      $('m-packed').dataset.state = 'ok';
      $('m-packed').querySelector('.num')!.textContent = 'Fits; this base allows the storage slot to grow';
    }
    succeeded = true;
    if (destination === 'categories') { status('Your selection fits.', 'ok'); return; }
    const syx = kind === 'syx' ? output : encodeSyx(containerOf(output));
    const blob = new Blob([syx as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const stem = inputName.replace(/\.(syx|bin)$/i, '');
    const name = `${stem}-models.syx`;
    downloadUrl = URL.createObjectURL(blob);
    const a = el('a', { class: 'download', href: downloadUrl, download: name }, `Download ${name}`);
    $('result').replaceChildren(a, el('details', {}, el('summary', {}, 'Build details and checks'), reportView(report)));
    status(`Built in ${((performance.now() - t) / 1000).toFixed(1)} s.`, 'ok');
  } catch (e) {
    if (version !== revision) return;
    $('result').replaceChildren();
    const message = (e as Error).message;
    if (e instanceof CompressedCapacityError) {
      packedCapacityProblem = true;
      $('room').dataset.state = 'over';
      $('room-note').textContent = 'Not enough firmware storage.';
      $('capacity-problems').textContent = `Compressed firmware capacity exceeded by ${fmt(e.used - e.capacity)} bytes.`;
      $('capacity-problems').hidden = false;
      $('capacity-pending').hidden = true;
      meter('m-packed', e.used, e.capacity, 'bytes', true);
      $('make-room').hidden = false;
      $('make-room-help').hidden = false;
      $('sample-options').hidden = false;
      $('make-room-help').textContent = trimMode() === 'auto'
        ? 'Still too large. Remove models or lower At most.' : 'Remove models or choose Auto trim.';
      status('Your selection needs more room. Choose how to make space in the Models step.', 'error');
    } else status(message, 'error');
  } finally {
    building = false;
    syncWizard();
    if (packedCapacityProblem) showStep(2);
    else if (succeeded) showStep(destination === 'categories' ? 3 : 4);
  }
}

async function main(): Promise<void> {
  // Keep memory and sample controls together above the current step's actions.
  const trimSlot = el('div', { id: 'memory-trim-slot' });
  trimSlot.append($('make-room'));
  $('room').append(trimSlot);
  $('room').hidden = true;
  layoutEd = new LayoutEditor($('layout-anchor'), refresh);
  document.querySelectorAll<HTMLButtonElement>('[data-step], [data-back]').forEach(b => {
    b.addEventListener('click', () => showStep(Number(b.dataset.step ?? b.dataset.back)));
  });
  $('firmware-next').addEventListener('click', () => showStep(2));
  $('models-next').addEventListener('click', () => void onBuild('categories'));
  $('categories-next').addEventListener('click', () => showStep(4));
  $('enlarge-screen').addEventListener('click', () => {
    if (!inspected) return;
    drawLcd($('large-lcd') as HTMLCanvasElement, inspected);
    addScreenHelp($('large-lcd') as HTMLCanvasElement, inspected);
    ($('screen-dialog') as HTMLDialogElement).showModal();
  });

  const positionSidebar = () => {
    const available = window.innerHeight - 16;
    $('machine-sidebar').style.top = `${Math.min(16, available - $('machine-sidebar').offsetHeight)}px`;
    const rail = document.querySelector<HTMLElement>('.control-rail');
    if (rail) rail.style.setProperty('--rail-top', `${Math.min(16, window.innerHeight - rail.offsetHeight - 16)}px`);
  };
  const sidebarObserver = new ResizeObserver(positionSidebar);
  sidebarObserver.observe($('machine-sidebar'));
  window.addEventListener('resize', positionSidebar);
  try {
    data = await loadData();
  } catch (e) {
    status(`Could not load the machine packs: ${(e as Error).message}`, 'error');
    return;
  }
  status(data.packs.length ? 'Waiting for your OS file.' : 'Load your OS file, then add model packs in the Models step.');
  renderMachines();
  const drop = $('drop');
  const file = $('file') as HTMLInputElement;
  file.addEventListener('change', () => { if (file.files?.[0]) void onFile(file.files[0]); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void onFile(f);
  });
  // the trim is the expensive part of a plan: re-plan when a slider is let go, label while moving
  for (const id of ['db', 'cap']) {
    $(id).addEventListener('input', () => {
      $('db-out').textContent = `${($('db') as HTMLInputElement).value} dB`;
      const cap = Number(($('cap') as HTMLInputElement).value);
      $('cap-out').textContent = cap > 0 ? `${cap.toFixed(2)} s` : 'no cap';
    });
    $(id).addEventListener('change', syncTrim);
  }
  document.querySelectorAll('input[name=e12]').forEach((r) => r.addEventListener('change', syncTrim));
  syncTrim();
  $('build').addEventListener('click', () => void onBuild());
  const packFiles = $('pack-files') as HTMLInputElement;
  packFiles.addEventListener('change', () => { if (packFiles.files?.length) void onPackFiles(Array.from(packFiles.files)); });
}

void main();
