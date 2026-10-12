// The Kitbasher page. Everything runs in the browser: the firmware file never leaves the computer.
//
// Once a base is loaded, the Samples step shows its E12 bank and lets the user swap samples
// (web/src/samples-ui.ts); every change to the samples, the machine selection or the E12 trim
// re-plans the build
// (engine/src/plan.ts: the same placement the build does, without packing). Users can select
// freely; a selection that does not fit prompts for removing models or trimming samples.
// Build firmware checks compressed slot capacity and opens the download. Sample editing and
// category arrangement are optional tools on the Machines page.
//
// MDX X.20 B (engine/src/x20.ts): recognised by its file hash and taken through the same steps. Its
// plan (planX20) drives the meters (DSP2 words at the chosen trim, machine IDs, the new-machine list,
// the machine records), the layout editor (X.20's own menu families as fixed categories) and the
// build; what the recipe does not patch (sample swapping, the unmute fix, MIDI chromatic input, pitch
// note names) is shown turned off with the reason. Modified MDX builds carry an affiliation notice.
//
// Packs: the page bundles the packs that web/build.mjs includes. Users can load more pack files;
// they are read with the File API, never uploaded, and planned and checked exactly like the
// bundled ones.

import { baseSet, identify, NotPatchable, unsupported, type Base, type BaseProfileFile, type BaseSet, type LineageFile } from '../../engine/src/bases.js';
import { prepare163 } from '../../engine/src/prepare.js';
import { build, CompressedCapacityError, OsAreaCapacityError, type BuildReport, type BuildResult } from '../../engine/src/build.js';
import { firmwareFilename } from '../../engine/src/firmware_version.js';
import { FirmwareDelivery } from './firmware-delivery.js';
import { readFirmware, type Firmware } from '../../engine/src/container.js';
import type { TrimOptions } from '../../engine/src/e12.js';
import { checkPack, modelWords, needLines, needsUwSamples, type CorePack, type Pack, type PackModel } from '../../engine/src/packs.js';
import { merged, plan, trimFor, MIDI_CHROMA_CHANNEL, type Plan, type Trimmed } from '../../engine/src/plan.js';
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
import { readBank } from '../../engine/src/samples.js';
import { decodeProject, encodeProject, osOf, osOfRecipe, osProblem, PROJECT_EXTENSION, type Project } from '../../engine/src/project.js';
import { SamplesStep } from './samples-ui.js';
import { fileHint, gate, noUwOf, uwForBuild, uwOf, type UwAnswer } from './uw-mode.js';
import { recoverSession } from '../../engine/src/restore.js';
import { parseLayout, type Layout } from '../../engine/src/layout.js';
import { num } from '../../engine/src/bytes.js';
import { select } from '../../engine/src/selection.js';
import { parseRecipe, recipeFor, type X20Recipe, type X20RecipeFile } from '../../engine/src/x20_recipe.js';
import { buildX20, findX20Layout, planX20, readX20, trimX20Bank, X20_CATEGORIES, x20E12Bank, x20IdSlots, X20FlashError, type X20Plan, type X20Report, type X20Trimmed } from '../../engine/src/x20.js';
import { sha256 } from '../../engine/src/bytes.js';

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
  const files = await Promise.all(index.bases.map(async (f) => (await fetch(`data/bases/${f}`)).json() as Promise<BaseProfileFile | LineageFile | X20RecipeFile>));
  const bases = baseSet(files);
  const all = await Promise.all(index.packs.map(async (f) => (await fetch(`data/packs/${f}`)).json() as Promise<Pack | CorePack>));
  const core = (all.find((p) => p.family === 'CORE') as CorePack | undefined) ?? null;
  const packs = (all.filter((p) => p.family !== 'CORE') as Pack[]).sort((a, b) => a.order - b.order);
  return { bases, packs, core, source: index.source };
}

let data: Data;
const MDX_DISCLAIMER = 'Kitbasher is not affiliated with MDX. These modified builds are not official MDX releases and are not supported by its creator.';
let uiReady = false;
let input: Uint8Array | null = null;
let inputName = '';
let fw: Firmware | null = null;
let base: Base | null = null;
let current: Plan | null = null;
const trims = new Map<string, Trimmed>();       // per base file, per trim setting (cleared when the samples change)
let samples: SamplesStep;                        // the E12 samples and the user's swaps (web/src/samples-ui.ts)
let pendingProject: { project: Project; name: string } | null = null;  // loaded before its OS
/** the unmute toggle an OS load starts from: on, unless a loaded project turned it off */
let projectUnmute = true;
let layoutEd: LayoutEditor;                      // the menu categories and IDs (web/src/layout-ui.ts)
let step = 1;
let revision = 0;
let building = false;
let sendingFirmware = false;
let firmwareMidi: FirmwareDelivery | undefined;
let downloadUrl: string | null = null;
let fileRequest = 0;
let packedCapacityProblem = false;
let cachedBuild: { revision: number; result: AnyBuild } | null = null;
/** An X.20 file (a fixed per-release recipe, engine/src/x20.ts): its recipe, its stock E12B bank, its plan. */
let x20: X20RecipeFile | null = null;
let x20R: X20Recipe | null = null;
let x20Bank: ReturnType<typeof readX20>['bank0'] | null = null;
let x20Plan: X20Plan | null = null;
const x20Trims = new Map<string, X20Trimmed>();  // per trim setting
/** An X.20 build, as the page keeps it next to the 1.63-lineage ones */
type X20Built = { output: Uint8Array; report: X20Report; x20: true };
type AnyBuild = BuildResult | X20Built;
/** what X.20 B does not have, and why: shown where the option would be */
const X20_OFF = 'Not available on MDX OS X.20 B: MIDI chromatic note input and pitch note names ' +
  '(the recipe does not patch X.20\'s MIDI input or parameter display). ' +
  'Reusing the stock INP IDs 80..85 is not offered either: the stock INP machine would stay in the menu on the same ID.';
const X20_FIXED_WHY = 'new, renamed or reordered categories, and the order of machines within a category (the recipe sets each machine\'s category only)';
/** an OS is loaded: a 1.63-lineage base or an X.20 recipe file */
const loaded = (): boolean => !!fw || !!x20;
/** a plan that passed (the build may still find storage short) */
const buildable = (): boolean => x20 ? !!x20Plan?.ok : !!base && !!current?.ok;
/** the plan can be built: it fits and has a machine */
const planReady = (): boolean => x20 ? !!x20Plan?.ok && x20Plan.sel.length > 0 : !!current?.ok && current.sel.length > 0;
const keepSamples: TrimOptions = { db: -30, minSeconds: Infinity, cap: null };
let autoTrimOptions: TrimOptions = keepSamples;
const trimMode = (): string => document.querySelector<HTMLInputElement>('input[name=e12]:checked')!.value;

function clearDownload(): void {
  firmwareMidi?.dispose();
  firmwareMidi = undefined;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  $('result').replaceChildren();
  $('build-details').replaceChildren();
  $('download-needs').hidden = true;
}

function attachFirmwareSender(bytes: Uint8Array): void {
  const link = $('result').querySelector<HTMLAnchorElement>('.download')!;
  $('build-details').replaceChildren(...Array.from($('result').children).filter(element => element !== link));
  firmwareMidi = new FirmwareDelivery(bytes, link, $('download-needs'), sending => {
    sendingFirmware = sending;
    // Prevent navigation or rebuilding while these exact bytes are being sent.
    for (const selector of ['.site-nav', '.wizard-steps', '#delivery-options', '#step-5 > .wizard-actions']) {
      document.querySelector<HTMLElement>(selector)!.inert = sending;
    }
  });
  $('result').replaceChildren(firmwareMidi.element);
}

function syncWizard(): void {
  document.body.dataset.view = String(step);
  $('memory-trim-slot').hidden = step !== 3;
  $('step-3').querySelector('.wizard-actions')!.before($('room'));
  $('room').hidden = !loaded() || step !== 3;
  const ready = planReady() && !packedCapacityProblem;
  const asked = gate(uwAnswer, loaded());
  $('firmware-next').toggleAttribute('disabled', !uiReady || building);
  $('file').toggleAttribute('disabled', !uiReady || building);
  $('project-file').toggleAttribute('disabled', !uiReady || building);
  $('firmware-next').textContent = !loaded() ? 'Choose firmware' : !asked.ok ? 'Answer the UW question' : 'Choose machines';
  $('firmware-loaded').hidden = !loaded();
  $('firmware-loaded').textContent = loaded() ? `Loaded: ${inputName}` : '';
  const modifiedMdx = !!x20 || base?.id === 'x14';
  for (const id of ['qualification-note', 'mdx-disclaimer']) {
    $(id).hidden = !modifiedMdx;
    $(id).textContent = modifiedMdx ? MDX_DISCLAIMER : '';
  }
  $('samples-next').toggleAttribute('disabled', !loaded() || building);
  $('project-save').toggleAttribute('disabled', !loaded() || building);
  $('models-next').toggleAttribute('disabled', building);
  $('models-next').textContent = building ? 'Building firmware…' : !boxes().some(i => i.checked) ? 'Choose machines' : !ready ? 'Make room' : 'Build firmware';
  $('categories-next').toggleAttribute('disabled', building);
  $('build').toggleAttribute('disabled', !ready || building);
  $('build').hidden = !!downloadUrl;
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(b => {
    const n = Number(b.dataset.step);
    b.disabled = building || (n > 1 && !asked.ok) || (n > 3 && !ready);
    if (n === ([2, 4].includes(step) ? 3 : step)) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-back]').forEach(b => { b.disabled = building; });
}

function showStep(n: number): void {
  if (sendingFirmware || building || (n > 1 && !loaded()) || (n > 3 && (!planReady() || packedCapacityProblem))) return;
  // the UW question is answered before anything else
  if (n > 1 && needsUwAnswer()) return;
  if ((n === 5 && !downloadUrl) || (step <= 3 && n === 4 && !cachedBuild)) { void onBuild(n === 4 ? 'categories' : 'download'); return; }
  step = n;
  for (let i = 1; i <= 5; i++) $(`step-${i}`).hidden = i !== n;
  if (n === 2) samples.render();             // the pads show the bank as the current plan lays it
  syncWizard();
  const heading = $(`step-${n}`).querySelector<HTMLElement>('h2');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function status(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const s = $('status');
  delete s.dataset.uwError;
  s.textContent = msg;
  s.dataset.kind = kind;
}

const boxes = (): HTMLInputElement[] => Array.from(document.querySelectorAll<HTMLInputElement>('#machines input[type=checkbox]'));

// "Does your Machinedrum have the UW option?" (web/src/uw-mode.ts): asked on the first step, which
// the page does not leave without a Yes or a No clicked in this visit. Nothing is pre-selected and
// nothing is remembered in the browser; a restored file's answer is only a hint. A No means no
// machine on IDs 128 and up and no model that plays a UW sample (engine/src/selection.ts
// allocateIds). Saved in layout and project files.
let uwAnswer: UwAnswer = null;
const noUw = (): boolean => noUwOf(uwAnswer);
/** The restored layout follows the user's answer (none until there is one). */
function syncLayoutUw(): void {
  const uw = uwOf(uwAnswer);
  layoutEd.uw = uw;
  if (layoutEd.map && layoutEd.map.uw !== uw) {
    const { uw: _drop, ...rest } = layoutEd.map;
    layoutEd.map = uw === undefined ? rest : { ...rest, uw };
  }
}
/** Only the user's click on Yes or No sets the answer. */
function setUwAnswer(a: UwAnswer): void {
  if ($('status').dataset.uwError === 'true') status('');
  uwAnswer = a;
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=uw]'))) r.checked = r.value === a;
  syncLayoutUw();
  applyNoUw();
  syncWizard();
}
/**
 * The UW answer a restored file records: shown as a hint next to the question, never taken as the
 * answer. A different answer from the user's is pointed out; theirs stands.
 */
function fileAnswer(uw: boolean | undefined, from: string): void {
  const hint = fileHint(uw);
  $('uw-file-hint').textContent = hint ?? '';
  $('uw-file-hint').hidden = !hint;
  syncLayoutUw();
  if (uw === undefined) return;
  const said = uw ? 'yes' : 'no';
  if (uwAnswer === null) {
    status(`${from} was saved for a Machinedrum ${uw ? 'with' : 'without'} UW. Answer the UW question (Yes or No) to continue.`, 'info');
  } else if (said !== uwAnswer) {
    status(`${from} was saved for a Machinedrum ${uw ? 'with' : 'without'} UW; you answered ${uwAnswer === 'yes' ? 'Yes' : 'No'}, so that is what this build uses. Change your answer on the first step if ${from} is right.`, 'error');
  }
}

// ---- restoring a previous session: the machine IDs saved kits rely on
const RESTORE_OPEN_KEY = 'kitbasher.restoreOpen';
const catalogModels = (): PackModel[] => select(data.packs, {}).fams.flatMap((f) => f.models);

/** A layout from a file, a patched OS or the earlier-IDs preset becomes the user's map. */
function adoptLayout(l: Layout, from: string, extra = ''): void {
  const baseId = x20?.id ?? base?.id;
  if (!l.base && baseId) l = { ...l, base: baseId };
  layoutEd.adopt(l, from);                              // its UW answer: layoutEd.onAdopt
  const wanted = new Set(catalogModels().filter(m => m.key in l.machines || m.aliases?.some(k => k in l.machines)).map(m => m.module));
  for (const i of boxes()) i.checked = wanted.has(i.dataset.module!) && !i.disabled;
  $('project-status').textContent = `Machine IDs restored from ${from}: ${Object.keys(l.machines).length} machines keep their IDs.${extra}`;
  refresh();
}

/** A Kitbasher-built OS (.syx or .bin): its layout table, or else its descriptors matched to the catalog. */
async function restoreFromOs(bytes: Uint8Array, name: string): Promise<boolean> {
  // an X.20 build carries its layout table in E12B flash (engine/src/x20.ts findX20Layout)
  const x20Layout = findX20Layout(bytes, data.bases.recipes.map((f) => f.id));
  if (x20Layout) { adoptLayout(x20Layout, name); return true; }
  let parsed: Firmware;
  try { parsed = readFirmware(bytes); } catch { return false; }
  const r = recoverSession(parsed, catalogModels(), base?.os.descriptorTable ?? num(data.bases.lineage.anchors.descriptor_table));
  if (!r) return false;
  adoptLayout(r.layout, name, (r.how === 'descriptors' ? ' (read from its machines: it has no layout table)' : '') +
    (r.unknown.length ? ` Not in this catalog, so not restored: ${r.unknown.map((u) => `${u.name} (ID ${u.id})`).join(', ')}.` : ''));
  return true;
}

/** Models that play a UW sample: "needs UW", and not selectable on a Machinedrum without UW. */
function applyNoUw(): void {
  const on = noUw();
  for (const i of boxes()) {
    if (i.dataset.uw !== '1') continue;
    if (on) i.checked = false;
    i.disabled = on;
    i.closest('.machine')?.classList.toggle('unavailable', on);
  }
}
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
  const models = merged(data.packs).flatMap(f => f.models.map(m => ({ m, size: modelWords(m, f.shared) })));
  const groups = [...categories, 'Other models'].filter(category => models.some(({ m }) => describeModel(m).category === category));
  for (const [index, category] of groups.entries()) {
    const list = el('div', { class: 'machines' });
    const group = models.filter(({ m }) => describeModel(m).category === category);
    for (const { m, size } of group) {
      // Every model starts selected; auto trim and the meters account for workspace memory.
      const requiresUW = needsUwSamples(m);
      const cb = el('input', { type: 'checkbox', 'aria-label': `Include ${m.name.trim()}`, 'data-module': m.module, checked: '', ...(requiresUW ? { 'data-uw': '1' } : {}) }) as HTMLInputElement;
      cb.addEventListener('change', () => { inspectModel(m); refresh(); });
      const labels = m.labels.filter(Boolean).join(' ');
      const info = el('button', { type: 'button', class: 'machine-info', 'aria-label': `Preview ${m.name.trim()}${requiresUW ? ', requires UW' : ''}`, 'aria-controls': 'inspector', 'aria-pressed': 'false' },
        el('span', { class: 'machine-heading' }, el('span', { class: 'mname' }, m.name.trim()),
          el('span', { class: 'model-size', title: `${size.toLocaleString('en')} words of DSP memory` }, wordsLabel(size)),
          requiresUW ? el('span', { class: 'uw-badge', title: 'Plays a sample from UW sample memory: not available on a Machinedrum without UW' }, 'needs UW') : ''),
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
  applyNoUw();
  if (models.length) inspectModel((models.find(({ m }) => m.module === inspected?.module) ?? models[0]).m);
}

/** A model's DSP memory, short: 640 words, 1.6k words. */
const wordsLabel = (n: number): string => n < 1000 ? `${n} words` : `${(n / 1000).toFixed(1)}k words`;

function tickAll(list: HTMLElement): void {
  for (const i of Array.from(list.querySelectorAll<HTMLInputElement>('input'))) {
    if (i.checked || i.disabled) continue;
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
  // the samples' revision is part of the key: a missed clear cannot hand back a stale bank
  const key = `${opt.db}|${opt.minSeconds}|${opt.cap}|${samples.revision()}`;
  let t = trims.get(key);
  if (!t) { t = trimFor(fw!, base!, opt, samples.edits()); trims.set(key, t); }
  return t;
}

// Existing layout IDs remain pinned; newly selected models can use an available ID.
const allowIdMove = (): boolean => true;
/** The default firmware fixes, with the unmute-latency fix as the Download step's toggle says (on: wherever this OS has it). */
const firmwareFixes = (): ReturnType<typeof currentFirmwareFixes> => {
  const f = currentFirmwareFixes();
  return { ...f, features: { ...f.features, unmuteFix: $<HTMLInputElement>('unmute-fix').checked ? undefined : false } };
};

/** MIDI chromatic note input (off by default): offered only on an OS whose MIDI path the engine verified. */
const chromaTicked = (): boolean => $<HTMLInputElement>('midi-chroma').checked;
const chromaOn = (): boolean => !!base?.support.midiChroma?.ok && chromaTicked();
/** the chromatic channel: the default, or what a loaded project chose (the page has no channel control) */
let chromaChannel = MIDI_CHROMA_CHANNEL;
/** Pitch note names (off by default): offered only on an OS whose knob-value painter the engine verified. */
const labelsTicked = (): boolean => $<HTMLInputElement>('pitch-labels').checked;
const labelsOn = (): boolean => !!base?.support.pitchLabels?.ok && labelsTicked();
/** The Download-step options on top of the default fixes: the unmute-latency fix, MIDI chromatic input, pitch note names. */
function firmwareOptions(): ReturnType<typeof currentFirmwareFixes> {
  const o = firmwareFixes();
  return { ...o, features: { ...o.features, ...(chromaOn() ? { midiChroma: { channel: chromaChannel } } : {}), ...(labelsOn() ? { pitchLabels: true } : {}) } };
}
function syncChromaOption(): void {
  // on X.20 B the options are shown turned off, with the reason ($('x20-unavailable'))
  $('midi-chroma-option').hidden = !x20 && !base?.support.midiChroma?.ok;
  $('pitch-labels-option').hidden = !x20 && !base?.support.pitchLabels?.ok;
  for (const id of ['midi-chroma', 'pitch-labels']) {
    const box = $<HTMLInputElement>(id);
    box.disabled = !!x20;
    if (x20) box.checked = false;
  }
  // X.20 B has its own unmute fix (the recipe's unmute feature: MUTE-mode TRIG keys act on press)
  $<HTMLInputElement>('unmute-fix').disabled = false;
  $('x20-unavailable').hidden = !x20;
  $('x20-unavailable').textContent = x20 ? X20_OFF : '';
}

/** The meters a base has: the 1.63 lineage's RAM image, or X.20's IDs, list and records. */
function syncMeters(): void {
  $('m-ram').hidden = !!x20;
  for (const id of ['m-ids', 'm-list', 'm-records']) $(id).hidden = !x20;
  $('capacity-all').textContent = x20 ? 'All must fit.' : 'All three must fit.';
}

function planFor(exclude: string[], opt = trimOptions()): Plan {
  return plan(fw!, base!, data.packs, data.core!, { exclude, trim: opt, allowIdMove: allowIdMove(), uw: uwOf(uwAnswer), layout: layoutEd.mapForPlan(), samples: samples.edits(), ...firmwareOptions() }, trimmed(opt));
}

/** The X.20 E12B bank at a trim (cached: the auto trim asks for many). */
function x20Trimmed(opt: TrimOptions): X20Trimmed {
  const key = `${opt.db}|${opt.minSeconds}|${opt.cap}`;
  let t = x20Trims.get(key);
  if (!t) { t = trimX20Bank(x20R!, x20Bank!, { db: opt.db, minSeconds: opt.minSeconds, cap: opt.cap }, samples.edits()); x20Trims.set(key, t); }
  return t;
}

function planX20For(exclude: string[], opt = trimOptions()): X20Plan {
  // before the UW question is answered the plan is a UW one, as plan() takes no answer as with UW
  return planX20(x20R!, x20Trimmed(opt), data.packs, { uw: uwAnswer !== 'no', exclude, layout: layoutEd.mapForPlan() });
}

/** Auto trim on X.20: the gentlest threshold whose DSP2 placement fits (as autoPlan does). */
function autoPlanX20(exclude: string[], minDb: number | null): X20Plan {
  autoTrimOptions = keepSamples;
  const p = planX20For(exclude);
  if (p.dsp2.fits && minDb === null) return p;
  const cap = Number($<HTMLInputElement>('cap').value) || null;
  const found = findTrimThreshold(db => planX20For(exclude, { db, minSeconds: 0.5, cap }),
    candidate => candidate.dsp2.fits, minDb ?? -40);
  autoTrimOptions = { db: found.db, minSeconds: 0.5, cap };
  $<HTMLInputElement>('db').value = String(autoTrimOptions.db);
  return found.value;
}

// Trimming can fix DSP placement, not ABI, menu, or other compatibility errors.
function autoPlan(exclude: string[], minDb: number | null): Plan {
  autoTrimOptions = keepSamples;
  const p = planFor(exclude);
  if (p.dsp2.fits && minDb === null) return p;
  const cap = Number($<HTMLInputElement>('cap').value) || null;
  const found = findTrimThreshold(db => planFor(exclude, { db, minSeconds: 0.5, cap }),
    candidate => candidate.dsp2.fits, minDb ?? -40);
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
function refresh(minAutoDb: number | null = null): void {
  revision++;
  applyNoUw();                                      // before planning: no plan with a model this unit cannot play
  packedCapacityProblem = false;
  cachedBuild = null;
  $('room').hidden = !fw;
  $('m-packed').dataset.state = 'pending';
  $('m-packed').removeAttribute('title');
  $('m-packed').querySelector('.num')!.textContent = 'Checking…';
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
  if (x20 && x20R && x20Bank) { refreshX20(minAutoDb); return; }
  x20Plan = null;
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
    ? 'These models need a supported OS file.' : problem).join(' · ');
  $('capacity-problems').hidden = !p.problems.length;
  $('room-needs').textContent = [...p.moves.map((m) => `${m.name} moves ${m.preferred}→${m.id}.`),
    ...p.sel.flatMap((s) => needLines(s.m))].join(' ');
  $('make-room').hidden = false;
  $('make-room-help').hidden = p.ok || profileRequired;
  $('sample-options').hidden = false;
  $('make-room-help').textContent = !p.dsp2.fits
    ? trimMode() === 'auto' ? 'Still too large. Remove models or lower At most.' : 'Remove models or choose Auto trim.'
    : 'Remove models.';
  const swapped = samples.state.swaps.size;
  $('download-summary').textContent = `${p.sel.length} models.${swapped ? ` ${swapped} sample${swapped === 1 ? '' : 's'} replaced.` : ''}`;
  const needs = p.sel.flatMap(s => needLines(s.m));
  $('download-needs').hidden = true;
  // nothing restored: a kit made with an earlier Kitbasher build may not find its machines
  $('ids-warning').hidden = layoutEd.restoredFrom !== null;
  $('ids-warning').textContent = 'Machine IDs are assigned fresh. To keep your kits\' machines, drop your previous Kitbasher .syx under "Restore an earlier layout" on step 1.';
  $('download-needs').replaceChildren(...(needs.length ? [
    el('p', {}, 'Load these after updating the firmware, using C6 or another sample sender.'),
    uwDownloads(p.sel.map(s => s.m), data.packs),
    uwInstructions(),
  ] : []));
  for (const i of boxes()) {
    const label = i.closest('.machine') as HTMLElement;
    i.disabled = false;
    label.removeAttribute('data-nofit');
    label.title = label.dataset.labels ?? '';
  }
  applyNoUw();
  syncWizard();
  scheduleStorageCheck();
}

/** refresh() on X.20 B: its plan, its meters, the layout editor; the same problems, needs and Download summary. */
function refreshX20(minAutoDb: number | null): void {
  const p = trimMode() === 'auto' ? autoPlanX20(excludes(), minAutoDb) : planX20For(excludes());
  updateTrimControls();
  current = null;
  x20Plan = p;
  layoutEd.render(p);
  $('room').dataset.state = p.ok ? 'ok' : 'over';
  $('status').removeAttribute('data-profile-error');
  meter('m-dsp2', p.dsp2.demand, p.dsp2.capacity, 'words', p.dsp2.demand > p.dsp2.capacity || !p.dsp2.fits);
  meter('m-ids', p.ids.used, p.ids.available, 'IDs', p.ids.used > p.ids.available);
  meter('m-list', p.list.used, p.list.room, 'entries', p.list.used > p.list.room);
  if (p.records) {
    meter('m-records', p.records.used, p.records.cap, 'records', p.records.used > p.records.cap);
    $('m-records').title = `At most ${fmt(p.records.used)} of ${fmt(p.records.cap)} machine records: X.20's own take at most ${p.records.stock} (its stock cap), plus one per added machine`;
  } else {
    $('m-records').dataset.state = 'pending';
    ($('m-records').querySelector('.fill') as HTMLElement).style.width = '0';
    $('m-records').querySelector('.num')!.textContent = "Not computed: the recipe does not give X.20's own record count";
  }
  $('room-note').textContent = p.ok ? 'Memory' : !p.dsp2.fits ? 'Not enough memory.' : 'Cannot continue — see details.';
  $('capacity-problems').textContent = p.problems.join(' · ');
  $('capacity-problems').hidden = !p.problems.length;
  $('room-needs').textContent = [...p.moves.map((m) => `${m.name.trim()} moves ${m.preferred}→${m.id} (${m.why}).`),
    ...p.sel.flatMap((s) => needLines(s.m))].join(' ');
  $('make-room').hidden = false;
  $('make-room-help').hidden = p.ok;
  $('sample-options').hidden = false;
  $('make-room-help').textContent = !p.dsp2.fits
    ? trimMode() === 'auto' ? 'Still too large. Remove models or lower At most.' : 'Remove models or choose Auto trim.'
    : 'Remove models.';
  const swapped = samples.state.swaps.size;
  $('download-summary').textContent = `${p.sel.length} models for ${x20R!.name}.${swapped ? ` ${swapped} sample${swapped === 1 ? '' : 's'} replaced.` : ''}`;
  const needs = p.sel.flatMap(s => needLines(s.m));
  $('download-needs').hidden = true;
  $('ids-warning').hidden = layoutEd.restoredFrom !== null;
  $('ids-warning').textContent = 'Machine IDs are assigned fresh. To keep your kits\' machines, drop your previous Kitbasher .syx under "Restore an earlier layout" on step 1.';
  $('download-needs').replaceChildren(...(needs.length ? [
    el('p', {}, 'Load these after updating the firmware, using C6 or another sample sender.'),
    uwDownloads(p.sel.map(s => s.m), data.packs),
    uwInstructions(),
  ] : []));
  for (const i of boxes()) {
    const label = i.closest('.machine') as HTMLElement;
    i.disabled = false;
    label.removeAttribute('data-nofit');
    label.title = label.dataset.labels ?? '';
  }
  applyNoUw();
  syncWizard();
  scheduleStorageCheck();
}

function syncTrim(): void {
  updateTrimControls();
  refresh();
}

async function onFile(f: File): Promise<void> {
  if (sendingFirmware) return;
  const request = ++fileRequest;
  revision++;
  input = null; base = null; fw = null; current = null; cachedBuild = null;
  x20 = null; x20R = null; x20Bank = null; x20Plan = null; x20Trims.clear();
  layoutEd.leaveX20();
  syncChromaOption();
  syncMeters();
  $('room').hidden = true;
  $('firmware-options').hidden = true;
  // a new OS starts from the default, or from what a loaded project chose
  $<HTMLInputElement>('unmute-fix').checked = projectUnmute;
  $('firmware-details').hidden = true;
  layoutEd.render(null);
  syncWizard();
  status(`Reading ${f.name}…`);
  clearDownload();
  try {
    let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer());
    // MDX X.20 and later: a fixed recipe for that exact file, found by its hash; then the same steps
    const recipe = recipeFor(data.bases.recipes, await sha256(bytes));
    if (recipe) {
      const R = parseRecipe(recipe);
      const { bank0 } = readX20(bytes, R);
      if (request !== fileRequest) return;
      x20 = recipe; x20R = R; x20Bank = bank0;
      input = bytes; inputName = f.name;
      layoutEd.setX20({ id: R.id, name: R.name, families: R.features.categories ? X20_CATEGORIES : Object.keys(R.families), slots: x20IdSlots(R), why: X20_FIXED_WHY });
      try { samples.setBank(x20E12Bank(R, bank0)); }
      catch (e) { samples.setBank(null, `Sample swapping is not available for this file: ${(e as Error).message}`); }
      $('firmware-info').textContent = `${R.name}: a public beta OS. Kitbasher patches this exact file with a fixed recipe. ` +
        MDX_DISCLAIMER + ' ' +
        'User machines (USR) keep working. ' + X20_OFF;
      $('firmware-details').hidden = false;
      $('firmware-options').hidden = false;              // shown turned off, with the reason
      syncChromaOption();
      syncMeters();
      status(`Loaded ${f.name} (${R.name}, public beta).`, 'ok');
      if (pendingProject) applyProject(pendingProject.project, pendingProject.name);
      refresh();
      if (gate(uwAnswer, true).ok) showStep(3);
      else { status('Answer the UW question to continue.'); $('status').dataset.uwError = 'true'; }
      return;
    }
    // an X.20 build Kitbasher made: not built on; its layout table comes back and the stock X.20 file is asked for
    const builtX20 = findX20Layout(bytes, data.bases.recipes.map((r) => r.id));
    if (builtX20) {
      if (request !== fileRequest) return;
      adoptLayout(builtX20, f.name);
      const was = data.bases.recipes.find((r) => r.id === builtX20.base)!;
      status(`That's a Kitbasher build for ${was.name}: layout restored. Now drop the stock ${was.name} file it was built on.`, 'info');
      refresh();
      return;
    }
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
        if (unsupported(parsed.tag)) throw e;              // X.13, stock or built on: refused, nothing restored
        // an OS this page patched: not a base, but it carries its layout, which comes back
        // a Kitbasher build is not built on: its layout comes back, and the stock OS is asked for
        const got = findLayout(parsed);
        if (request !== fileRequest) return;
        if (!(await restoreFromOs(bytes, f.name))) throw e;
        // the stock file the user has: for a prepared base, the OS it was prepared from (stock 1.63)
        const profile = (id: string | undefined) => data.bases.profiles.find((x) => x.id === id);
        const built = profile(got?.layout.base);
        const want = profile((built as { prepared?: { from?: string } } | undefined)?.prepared?.from) ?? built;
        status(`That's a Kitbasher build: layout restored. Now drop the stock ${want?.name ?? 'OS'} it was built on.`, 'info');
        refresh();
        return;
      }
    }
    if (request !== fileRequest) return;
    input = bytes; inputName = f.name; base = b; fw = parsed;
    trims.clear();
    layoutEd.setBase(parsed, b);
    try { samples.setBank(readBank(parsed, b)); }
    catch (e) { samples.setBank(null, `Sample swapping is not available for this OS: ${(e as Error).message}`); }
    $('firmware-info').textContent = `${b.qualification.profile ? b.name : 'Unrecognized firmware version'}.` +
      (b.id === 'x14' ? ` ${MDX_DISCLAIMER}` : b.qualification.level === 'hardware-proven' ? '' : " We haven't tested this version on a Machinedrum yet.");
    $('firmware-details').hidden = false;
    // the unmute-latency fix is offered only where this OS has the sequencer it is written against
    $('firmware-options').hidden = !b.support.unmuteFix?.ok;
    syncChromaOption();
    status(`Loaded ${f.name}.`, 'ok');
    if (pendingProject) applyProject(pendingProject.project, pendingProject.name);
  } catch (e) {
    if (request !== fileRequest) return;
    input = null; base = null; fw = null;
    x20 = null; x20R = null; x20Bank = null;
    syncChromaOption();
    syncMeters();
    samples.setBank(null);
    status(`${f.name}: ${(e as Error).message}`, 'error');
  }
  refresh();
  if (fw && gate(uwAnswer, true).ok) showStep(3);
  else if (fw) { status('Answer the UW question to continue.'); $('status').dataset.uwError = 'true'; }
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

function uwInstructions(): HTMLElement {
  return el('details', { class: 'uw-instructions' }, el('summary', {}, 'How to load these samples'),
    el('ol', {},
      el('li', {}, 'Back up your UW samples. Loading these files replaces the slots shown above.'),
      el('li', {}, 'Connect both MIDI cables: interface OUT to Machinedrum IN, and Machinedrum OUT to interface IN.'),
      el('li', {}, 'On the Machinedrum, open GLOBAL → FILE → SAMPLE MGR → RECEIVE. Choose ORG and press YES.'),
      el('li', {}, 'In C6 on Windows, select your interface for MIDI input and output and enable SDS Handshake. Send one downloaded .syx at a time. Wait for receiving and loading to finish before the next file.')),
    el('p', { class: 'fine' }, 'Keep the files unchanged. Check each sample’s name and slot afterward. Kitbasher does not send UW samples yet; Elektron Transfer only supports firmware updates for Machinedrum.'),
    uwGuide());
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
    el('p', { class: 'note', id: 'report-uw' }, noUw()
      ? 'Built for a Machinedrum without UW: every machine is on an ID below 128, no model needs UW samples, and the ROM and RAM categories make room for yours in the machine menu.'
      : 'Built for a Machinedrum with UW.'),
    moved.length ? el('p', { class: 'note' }, `Assigned available IDs: ${moved.map((m) => `${m.name.trim()} ${m.preferred}→${m.id}${/without UW/.test(m.why) ? ' (no IDs of 128 and up without UW)' : ''}`).join(', ')}. Use the same saved layout when rebuilding for existing kits.`) : '',
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

/** The build ran out of firmware storage: the compressed DSP slot, or (on bases where that slot
 *  grows) the OS area. Trimming samples or removing models fixes either. */
const storageFull = (e: unknown): e is CompressedCapacityError | OsAreaCapacityError | X20FlashError =>
  e instanceof CompressedCapacityError || e instanceof OsAreaCapacityError || e instanceof X20FlashError;

function buildWith(trim: TrimOptions): Promise<AnyBuild> {
  // throws without a Yes or a No (and engine build refuses a missing answer too)
  const uw = uwForBuild(uwAnswer);
  if (x20) {
    return buildX20(input!, x20, data.packs, data.core!, { uw, exclude: excludes(), layout: layoutEd.mapForPlan(),
      features: { unmute: $<HTMLInputElement>('unmute-fix').checked },
      trim: { db: trim.db, minSeconds: trim.minSeconds, cap: trim.cap }, samples: samples.edits() }).then((r): X20Built => ({ ...r, x20: true }));
  }
  return build(input!, base!, data.packs, data.core!,
    { exclude: excludes(), trim, allowIdMove: allowIdMove(), uw, layout: layoutEd.mapForPlan(), samples: samples.edits(), ...firmwareOptions() }, trimmed(trim));
}

function showStorage(result: AnyBuild): void {
  $('capacity-pending').hidden = true;
  $('room-note').textContent = 'Memory fits.';
  if ('x20' in result) {
    // X.20: the machines' code, the list and the layout table in the E12B flash the trim frees
    meter('m-packed', result.report.flash.used, result.report.flash.capacity, 'bytes', false);
    syncWizard();
    return;
  }
  const report = result.report;
  if (report.dsp2.packed_capacity !== null) {
    meter('m-packed', report.dsp2.packed, report.dsp2.packed_capacity, 'bytes', false);
  } else {
    $('m-packed').dataset.state = 'ok';
    $('m-packed').querySelector('.num')!.textContent = 'Fits; this base allows the storage slot to grow';
  }
  syncWizard();
}

function showStorageProblem(e: CompressedCapacityError | OsAreaCapacityError | X20FlashError): void {
  packedCapacityProblem = true;
  $('room').dataset.state = 'over';
  $('room-note').textContent = 'Not enough firmware storage.';
  $('capacity-problems').textContent = `Firmware storage exceeded by ${fmt(e.used - e.capacity)} bytes.`;
  $('capacity-problems').hidden = false;
  $('capacity-pending').hidden = true;
  meter('m-packed', e.used, e.capacity, 'bytes', true);
  $('make-room').hidden = false;
  $('make-room-help').hidden = false;
  $('sample-options').hidden = false;
  $('make-room-help').textContent = trimMode() === 'auto'
    ? 'Still too large. Remove models or lower At most.' : 'Remove models or choose Auto trim.';
  syncWizard();
}

/**
 * Firmware storage is known only after compressing a build, so it is checked in the background
 * while the Models step is open. In Auto trim the check also settles the gentlest threshold that
 * fits storage, and the page shows that one: Continue builds exactly the trim on screen.
 */
let storage: { revision: number; done: Promise<void> } | null = null;

function scheduleStorageCheck(): void {
  storage = null;
  if (!input || (x20 ? !x20Plan?.ok : !base) || !x20 && !current?.ok || !gate(uwAnswer, true).ok) {
    $('m-packed').querySelector('.num')!.textContent = '';
    return;
  }
  const version = revision;
  // a short pause, so a run of clicks checks once
  storage = { revision: version, done: new Promise<void>((r) => setTimeout(r, 300)).then(() => checkStorage(version)) };
}

async function checkStorage(version: number): Promise<void> {
  if (version !== revision || cachedBuild?.revision === version) return;
  const attempt = async (trim: TrimOptions): Promise<AnyBuild | Error> => {
    await new Promise((r) => setTimeout(r, 0));          // let the page answer clicks between builds
    if (version !== revision) return new Error('stale');
    try { return await buildWith(trim); } catch (e) { return e as Error; }
  };
  let got = await attempt(trimOptions());
  if (version !== revision) return;
  if (storageFull(got) && trimMode() === 'auto') {
    // The gentlest threshold that fits, to 0.5 dB: -40 dB first (usually enough), then halving
    // between the last failing threshold and the strongest one.
    const cap = Number($<HTMLInputElement>('cap').value) || null;
    const at = (db: number): TrimOptions => ({ db, minSeconds: 0.5, cap });
    let lo = autoTrimOptions === keepSamples ? -40.5 : autoTrimOptions.db;
    let hi = Math.max(-40, lo + 0.5);
    let best = await attempt(at(hi));
    if (storageFull(best) && hi < -10) { lo = hi; hi = -10; best = await attempt(at(hi)); }
    while (!(best instanceof Error) && hi - lo > 0.5) {
      const mid = Math.round(lo + hi) / 2;
      const r = await attempt(at(mid));
      if (version !== revision) return;
      if (r instanceof Error) { if (!storageFull(r)) { best = r; break; } lo = mid; }
      else { hi = mid; best = r; }
    }
    if (version !== revision) return;
    if (!(best instanceof Error)) {
      refresh(hi);                                       // the plan, meters and slider at the new trim
      cachedBuild = { revision, result: best };
      storage = { revision, done: Promise.resolve() };
      showStorage(best);
      return;
    }
    got = best;
  }
  if (got instanceof Error) {
    if (storageFull(got)) showStorageProblem(got);
    else $('m-packed').querySelector('.num')!.textContent = '';
    return;
  }
  cachedBuild = { revision: version, result: got };
  showStorage(got);
}

/** Back to the question when it is unanswered: no build, check or download goes ahead without it. */
function needsUwAnswer(): boolean {
  const asked = x20 ? gate(uwAnswer, true) : gate(uwAnswer, !!fw);
  if (asked.ok) return false;
  status(asked.why!, 'error');
  $('status').dataset.uwError = 'true';
  if (step !== 1) { step = 1; for (let i = 1; i <= 5; i++) $(`step-${i}`).hidden = i !== 1; syncWizard(); }
  $('uw-question').querySelector<HTMLInputElement>('input')?.focus();
  return true;
}

async function onBuild(destination: 'categories' | 'download' = 'download'): Promise<void> {
  if (sendingFirmware || !input || !buildable() || building) return;
  if (needsUwAnswer()) return;
  building = true;
  let succeeded = false;
  status(destination === 'categories' ? 'Checking that your selection fits…' : 'Building…');
  // The background check settles the trim (and may re-plan with it): wait for it, then build that.
  while (storage && storage.revision === revision && cachedBuild?.revision !== revision) {
    const s = storage;
    await s.done;
    if (storage === s) break;
  }
  const version = revision;
  clearDownload();
  syncWizard();
  const btn = $('build');
  btn.setAttribute('disabled', '');
  status(destination === 'categories' ? 'Checking that your selection fits…' : 'Building…');
  await new Promise((r) => setTimeout(r, 20));
  try {
    const t = performance.now();
    const result = cachedBuild?.revision === version ? cachedBuild.result : await buildWith(trimOptions());
    if (version !== revision) return;
    cachedBuild = { revision: version, result };
    showStorage(result);
    succeeded = true;
    if (destination === 'categories') { status('Your selection fits.', 'ok'); return; }
    if ('x20' in result) { downloadX20(result, t); return; }
    const { output, kind, report } = result;
    const syx = kind === 'syx' ? output : encodeSyx(containerOf(output));
    const blob = new Blob([syx as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
    const name = firmwareFilename(report.base);
    downloadUrl = URL.createObjectURL(blob);
    const a = el('a', { class: 'download', href: downloadUrl, download: name, title: name }, 'Download firmware');
    a.addEventListener('click', (e) => { if (needsUwAnswer()) e.preventDefault(); });
    $('result').replaceChildren(a, el('p', { class: 'note' }, `Kitbasher ${report.firmware.display} · Based on ${base!.name}`),
      el('details', {}, el('summary', {}, 'Build details and checks'), reportView(report)));
    attachFirmwareSender(syx);
    status(`Built in ${((performance.now() - t) / 1000).toFixed(1)} s.`, 'ok');
  } catch (e) {
    if (version !== revision) return;
    $('result').replaceChildren();
    const message = (e as Error).message;
    if (storageFull(e)) {
      showStorageProblem(e);
      status('Your selection needs more room. Choose how to make space in the Models step.', 'error');
    } else status(message, 'error');
  } finally {
    building = false;
    syncWizard();
    if (packedCapacityProblem) showStep(3);
    else if (succeeded) showStep(destination === 'categories' ? 4 : 5);
  }
}

/** The X.20 build's download and report; syncWizard supplies the shared MDX notice. */
function downloadX20(result: X20Built, t: number): void {
  const blob = new Blob([result.output as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
  const name = firmwareFilename(result.report.base);
  downloadUrl = URL.createObjectURL(blob);
  const a = el('a', { class: 'download', href: downloadUrl, download: name, title: name }, 'Download firmware');
  a.addEventListener('click', (e) => { if (needsUwAnswer()) e.preventDefault(); });
  $('result').replaceChildren(a,
    el('p', { class: 'note' }, `Kitbasher ${result.report.firmware.display} · Based on MDX X.20 B`),
    el('details', {}, el('summary', {}, 'Build details and checks'), x20ReportView(result.report)));
  attachFirmwareSender(result.output);
  status(`Built in ${((performance.now() - t) / 1000).toFixed(1)} s.`, 'ok');
}

const X20_FEATURE_NAMES: Record<string, string> = { unmute: 'the unmute fix (MUTE-mode TRIG keys act on press)', categories: 'menu categories',
  dyn_labels: 'dynamic knob labels', id_masks: 'the class-mask fix for IDs 88..95', title_rom: 'the machine-title fix' };
function x20ReportView(r: X20Report): HTMLElement {
  const stat = (k: string, v: string): HTMLElement => el('div', { class: 'stat' }, el('span', { class: 'k' }, k), el('span', { class: 'v' }, v));
  return el('div', { class: 'report' },
    el('div', { class: 'stats' },
      stat('Build ID', r.boot_label.id),
      stat('Build target', r.boot_label.uw ? 'UW' : 'Non-UW'),
      stat('Machines', String(r.machines.length)),
      stat('DSP2 words free', fmt(r.dsp2.free)),
      stat('E12B flash free', `${fmt(r.flash.free_left)} B`),
      stat('E12 words freed', fmt(r.e12.freed_words)),
      stat('E12 samples trimmed', String(r.e12.trimmed))),
    el('p', { class: 'note', style: 'overflow-wrap:anywhere' }, `Build fingerprint (${r.boot_label.scheme}): ${r.boot_label.sha256}`),
    el('p', { class: 'note', id: 'report-uw' }, noUw()
      ? 'Built for a Machinedrum without UW: every machine is on an ID below 128 and no model needs UW samples.'
      : 'Built for a Machinedrum with UW.'),
    r.moves.length ? el('p', { class: 'note' }, `Assigned available IDs: ${r.moves.map((m) => `${m.name.trim()} ${m.preferred}→${m.id} (${m.why})`).join(', ')}. Use the same saved layout when rebuilding for existing kits.`) : '',
    el('details', {}, el('summary', {}, `Checks (${r.gates.filter((g) => g.ok).length} of ${r.gates.length} passed)`),
      el('ul', { class: 'gates' }, ...r.gates.map((g) => el('li', {}, el('b', {}, g.ok ? g.name : `FAILED: ${g.name}`), ' ', g.detail)),
        ...r.notes.map((n) => el('li', {}, n)))),
    el('p', { class: 'note', id: 'report-features' }, r.features.length ? `Fixes and features in this build: ${r.features.map((f) => X20_FEATURE_NAMES[f.name] ?? f.name).join(', ')}.` : 'No optional fixes in this build.'),
    el('details', {}, el('summary', {}, `Menu: your machines in ${r.menus.filter((f) => f.machines.length).length} categories, layout table at ${r.flash.layout ?? 'none'}`),
      el('ul', { class: 'gates', id: 'report-menus' }, ...r.menus.filter((f) => f.machines.length).map((f) => el('li', {}, el('b', {}, f.name), ' ', f.machines.join(', '))))),
    el('details', {}, el('summary', {}, 'Machine IDs'),
      el('table', { class: 'ids' }, el('tr', {}, el('th', {}, 'Machine'), el('th', {}, 'Family'), el('th', {}, 'ID')),
        ...r.machines.map((m) => el('tr', {}, el('td', {}, m.name), el('td', {}, r.layout.machines[m.key]?.category ?? m.family), el('td', {}, String(m.id)))))));
}

/** Whether a plan's bank was laid with these edits (the same sample data on the same entries). */
function sameEdits(laid: Trimmed['edits'], now: { swaps: ReadonlyMap<number, ArrayLike<number>>; noTrim: ReadonlySet<number> }): boolean {
  const swaps = laid?.swaps ?? new Map<number, ArrayLike<number>>(), noTrim = laid?.noTrim ?? new Set<number>();
  return swaps.size === now.swaps.size && noTrim.size === now.noTrim.size &&
    [...now.swaps].every(([e, d]) => swaps.get(e) === d) && [...now.noTrim].every((e) => noTrim.has(e));
}

// ---- the project file (engine/src/project.ts, docs/PROJECT-FILE.md)

function projectNow(): Project {
  const mode = trimMode();
  return {
    os: x20 ? osOfRecipe(x20) : osOf(base!),
    swaps: samples.state.swaps, sources: samples.state.sources, noTrim: samples.state.noTrim,
    trim: { mode: mode === 'trim' ? 'manual' : mode === 'keep' ? 'keep' : 'auto',
            db: Number($<HTMLInputElement>('db').value), cap: Number($<HTMLInputElement>('cap').value) },
    models: boxes().filter((i) => i.checked).map((i) => i.dataset.module!),
    layout: layoutEd.mapForPlan() ?? null,
    uw: uwOf(uwAnswer),
    // what the user chose, even on an OS that cannot have it, so the project keeps it
    // (not on X.20 B, which has none of them)
    midiChroma: !x20 && chromaTicked() ? { channel: chromaChannel } : undefined,
    pitchLabels: !x20 && labelsTicked() ? true : undefined,
    // saved only when off, the default being on
    unmuteFix: $<HTMLInputElement>('unmute-fix').checked ? undefined : false,
  };
}

async function saveProject(): Promise<void> {
  if (!loaded()) return;
  const text = JSON.stringify(await encodeProject(projectNow()), null, 1);
  const stem = inputName.replace(/\.(syx|bin)$/i, '');
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `${stem}${PROJECT_EXTENSION}` }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  status(`Project saved as ${stem}${PROJECT_EXTENSION}. Load it with ${inputName} to build the same firmware.`, 'ok');
}

async function onProjectFile(f: File): Promise<void> {
  if (sendingFirmware) return;
  const note = $('project-status');
  try {
    if (/\.(syx|bin)$/i.test(f.name)) {
      if (!await restoreFromOs(new Uint8Array(await f.arrayBuffer()), f.name)) throw new Error(`${f.name} is not an OS Kitbasher built`);
      return;
    }
    const text = await f.text();
    if (JSON.parse(text)?.format !== 'kitbasher-project/1') { adoptLayout(parseLayout(text), f.name); return; }
    const p = await decodeProject(text);
    if (loaded()) {
      const problem = osProblem(p.os, x20 ? osOfRecipe(x20) : base!);
      if (problem) throw new Error(`${problem}. Load the ${p.os.name || p.os.base} file it was made with first.`);
      if (applyProject(p, f.name)) { refresh(); showStep(3); }
    } else {
      pendingProject = { project: p, name: f.name };
      note.textContent = `${f.name} is ready: now load the ${p.os.name || p.os.base} file it was made with.`;
      status(note.textContent, 'ok');
    }
  } catch (e) {
    pendingProject = null;
    note.textContent = `Project not loaded: ${(e as Error).message}`;
    status(note.textContent, 'error');
  }
}

/** Put a project's choices on the page. Refused (false) unless the loaded OS is the project's. */
function applyProject(p: Project, name: string): boolean {
  pendingProject = null;
  const problem = osProblem(p.os, x20 ? osOfRecipe(x20) : base!);
  const count = samples.bank?.entries.length ?? 0;
  const bad = [...p.swaps.keys(), ...p.noTrim].filter((e) => e >= count);
  const why = problem ?? (!samples.bank && (p.swaps.size || p.noTrim.size)
    ? "this OS's E12 samples could not be read, so a project with sample changes cannot be used with it"
    : bad.length ? `this OS has no E12 sample ${bad[0]}` : null);
  if (why) {
    $('project-status').textContent = `Project not loaded: ${why}.`;
    status(`${name} not loaded: ${why}.`, 'error');
    return false;
  }
  samples.setState({ swaps: new Map(p.swaps), noTrim: new Set(p.noTrim), sources: new Map(p.sources), notes: new Map() });
  trims.clear(); x20Trims.clear();
  const radio = document.querySelector<HTMLInputElement>(`input[name=e12][value=${p.trim.mode === 'manual' ? 'trim' : p.trim.mode}]`);
  if (radio) radio.checked = true;
  $<HTMLInputElement>('db').value = String(p.trim.db);
  $<HTMLInputElement>('cap').value = String(p.trim.cap);
  $<HTMLInputElement>('midi-chroma').checked = !x20 && !!p.midiChroma;
  chromaChannel = p.midiChroma?.channel ?? MIDI_CHROMA_CHANNEL;
  $<HTMLInputElement>('pitch-labels').checked = !x20 && !!p.pitchLabels;
  projectUnmute = p.unmuteFix !== false;
  $<HTMLInputElement>('unmute-fix').checked = projectUnmute;
  const want = new Set(p.models);
  const have = new Set(boxes().map((i) => i.dataset.module!));
  if (p.uw !== undefined) fileAnswer(p.uw, name);
  applyNoUw();
  // a model this Machinedrum cannot play stays unticked
  for (const i of boxes()) i.checked = want.has(i.dataset.module!) && !i.disabled;
  const missing = p.models.filter((m) => !have.has(m));
  if (p.layout) layoutEd.adopt(p.layout, name); else layoutEd.clear();
  updateTrimControls();
  $('project-status').textContent = `Loaded ${name}.`;
  status(`Loaded project ${name}: ${p.swaps.size} sample${p.swaps.size === 1 ? '' : 's'} replaced, ${want.size - missing.length} models.` +
    (missing.length ? ` Not in this page's catalog (load their packs to include them): ${missing.join(', ')}.` : ''), missing.length ? 'error' : 'ok');
  return true;
}

async function main(): Promise<void> {
  // Keep memory and sample controls together above the current step's actions.
  const trimSlot = el('div', { id: 'memory-trim-slot' });
  trimSlot.append($('make-room'));
  $('room').append(trimSlot);
  $('room').hidden = true;
  layoutEd = new LayoutEditor($('layout-anchor'), () => {
    refresh();
  });
  layoutEd.onAdopt = (l, from) => fileAnswer(l.uw, from);
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=uw]'))) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      setUwAnswer(r.value === 'yes' ? 'yes' : 'no');
      refresh();
    });
  }
  setUwAnswer(null);                                   // never pre-selected: not from storage, not from a file
  document.querySelectorAll<HTMLButtonElement>('[data-step], [data-back]').forEach(b => {
    b.addEventListener('click', () => showStep(Number(b.dataset.step ?? b.dataset.back)));
  });
  $('firmware-next').addEventListener('click', () => { if (!loaded()) { $('file').click(); return; } showStep(3); });
  $('samples-next').addEventListener('click', () => showStep(3));
  $('models-next').addEventListener('click', () => {
    if (!boxes().some(i => i.checked)) { $('machines').focus(); $('machines').scrollIntoView({ block: 'start' }); return; }
    if (!planReady() || packedCapacityProblem) { $<HTMLDetailsElement>('capacity-details').open = true; $('capacity-details').scrollIntoView({ block: 'nearest' }); return; }
    void onBuild('download');
  });
  $('categories-next').addEventListener('click', () => showStep(3));
  document.querySelector('.builder-tools')!.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button')) document.querySelector<HTMLDetailsElement>('.builder-tools')!.open = false;
  });
  samples = new SamplesStep($('samples-panel'), {
    onChange: () => { trims.clear(); x20Trims.clear(); refresh(); },
    saveKit: () => void saveProject(),
    loadKit: (f) => void onProjectFile(f),
    laid: () => (current && fw && sameEdits(current.trim.edits, samples.edits()) ? { report: current.trim.report, end: current.trim.end }
      : x20Plan && sameEdits(x20Plan.bank.edits, samples.edits()) ? { report: x20Plan.bank.report, end: x20Plan.bank.bankEnd } : null),
  });
  samples.render();
  const projectFile = $<HTMLInputElement>('project-file');
  projectFile.addEventListener('change', () => { if (projectFile.files?.[0]) void onProjectFile(projectFile.files[0]); projectFile.value = ''; });
  $('project-save').addEventListener('click', () => void saveProject());
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
  status(data.packs.length ? '' : 'Choose your firmware, then add model packs under Machines.');
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
  const rdrop = $('restore-drop');
  rdrop.addEventListener('dragover', (e) => { e.preventDefault(); rdrop.classList.add('over'); });
  rdrop.addEventListener('dragleave', () => rdrop.classList.remove('over'));
  rdrop.addEventListener('drop', (e) => {
    e.preventDefault();
    rdrop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void onProjectFile(f);
  });
  const restore = $<HTMLDetailsElement>('restore');
  try { restore.open = localStorage.getItem(RESTORE_OPEN_KEY) === '1'; } catch { /* storage unavailable */ }
  restore.addEventListener('toggle', () => { try { localStorage.setItem(RESTORE_OPEN_KEY, restore.open ? '1' : '0'); } catch { /* storage unavailable */ } });
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
  $('unmute-fix').addEventListener('change', () => refresh());
  $('midi-chroma').addEventListener('change', () => refresh());
  $('pitch-labels').addEventListener('change', () => refresh());
  const packFiles = $('pack-files') as HTMLInputElement;
  packFiles.addEventListener('change', () => { if (packFiles.files?.length) void onPackFiles(Array.from(packFiles.files)); });
  uiReady = true;
  syncWizard();
}

void main();
