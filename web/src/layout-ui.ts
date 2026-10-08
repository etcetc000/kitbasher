// The layout editor: the machine-select menu's categories and every machine's ID, under the
// user's control (engine/src/layout.ts). Self-contained: it mounts its own panel and styles.
//
//   - the base's own categories are listed first, read-only; ours follow and can be created,
//     renamed, deleted (when empty), reordered, and filled by drag and drop or with the buttons
//     and lists on each row (keyboard);
//   - the ID map shows all 192 IDs: free ones take a machine (drop one there, or pick it from the
//     row's ID list; an occupied one swaps), the others say why they cannot;
//   - the map exports and imports as JSON (md-layout/1) with a fingerprint, and a patched OS
//     given to the page brings its layout back.
//
// Until the user changes something, no map is passed to the engine: the build carries the default
// layout's table, and a map equal to it builds the same bytes.

import type { Base } from '../../engine/src/bases.js';
import type { Firmware } from '../../engine/src/container.js';
import {
  baseFamilies, defaultLayout, describeCharset, fingerprint, idSlots, menuLimits, nameProblem, parseLayout,
  type BaseFamily, type IdSlot, type Layout,
} from '../../engine/src/layout.js';
import type { Plan } from '../../engine/src/plan.js';
import { drawMenuLcd } from './lcd.js';
import { describeModel } from './catalog.js';
import { needsUwSamples } from '../../engine/src/packs.js';
import { idCell, shownStock, usableId } from './uw-mode.js';

const CSS = `
.layout-panel{margin-top:20px;padding:16px 20px}
.layout-panel .section-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.layout-panel .section-head h2{margin-right:auto}
.lay-fp{font-family:var(--mono);font-size:12px;background:var(--chip);border-radius:3px;padding:2px 7px}
.lay-fp[data-custom]{background:#e8eef7;color:#1e3f8a}
.lay-actions{display:flex;gap:6px;flex-wrap:wrap}
.lay-actions button,.lay-actions label.btn{border:1px solid var(--line);background:#fafbfc;border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer}
.lay-actions label.btn input{position:absolute;width:1px;height:1px;opacity:0}
.lay-actions label.btn:focus-within{outline:2px solid #467fa9;outline-offset:2px}
.lay-limits{margin:4px 0 12px;font-size:11px}
.lay-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px}
.lay-preview{align-self:start;position:sticky;top:16px}
.lay-preview select{margin:8px 0;max-width:100%}
.lay-preview label{display:block}
.lay-screen{background:#292c2d;border-radius:8px;padding:20px;max-width:360px;margin:8px 0}
.lay-screen canvas{display:block;width:100%;aspect-ratio:2;image-rendering:pixelated;background:#f27a3e;border:3px solid #161818;border-radius:2px}
.lay-advanced{border-top:1px solid var(--line);margin-top:20px;padding-top:12px}
.lay-advanced summary{cursor:pointer;font-weight:600}
.lay-id-controls{display:flex;flex-wrap:wrap;gap:10px 18px;margin:14px 0}
.lay-id-controls label{display:flex;align-items:center;gap:8px;font-size:12px}
.lay-id-controls select{max-width:180px}
@media (max-width:900px){.lay-grid{grid-template-columns:1fr}}
.lay-stock{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 12px}
.lay-stock span{font-family:var(--mono);font-size:11px;background:var(--chip);color:var(--muted);border-radius:3px;padding:1px 6px}
.lay-cat{border:1px solid var(--line);border-radius:5px;margin-bottom:10px;background:#fff}
.lay-cat[data-over]{border-color:#467fa9;box-shadow:0 0 0 2px #cfe0ef}
.lay-cat header{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);background:#fafbfc;border-radius:5px 5px 0 0}
.lay-cat header input{width:4.2em;font-family:var(--mono);font-weight:650;text-transform:none;border:1px solid var(--line);border-radius:3px;padding:1px 4px}
.lay-cat header input[aria-invalid=true]{border-color:var(--err);color:var(--err)}
.lay-cat header .count{color:var(--muted);font-size:11px;margin-right:auto}
.lay-cat ol{list-style:none;margin:0;padding:4px 0;min-height:26px}
.lay-cat li{display:grid;grid-template-columns:14px 6.4em minmax(0,1fr) auto auto;align-items:center;gap:6px;padding:2px 8px;font-size:12px}
.lay-cat li[data-drag]{opacity:.4}
.lay-cat li[data-over]{box-shadow:inset 0 2px 0 #467fa9}
.lay-cat li .grip{cursor:grab;color:#9aa5ac;user-select:none}
.lay-cat li .mname{font-family:var(--mono);font-weight:600;white-space:pre}
.lay-cat li>span:nth-child(2){white-space:nowrap}
.lay-cat li .blurb{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lay-cat li .moved{color:#1e3f8a;font-size:10px}
.icon{border:1px solid var(--line);background:#fff;border-radius:3px;font-size:11px;line-height:1;padding:3px 5px;cursor:pointer}
.lay-cat li.lay-empty{display:block;color:var(--muted);font-size:11px;padding:4px 8px}
.lay-add{border:1px dashed #b7c1c7;background:none;border-radius:4px;padding:5px 10px;font-size:12px;width:100%;cursor:pointer}
.lay-ids{display:grid;grid-template-columns:repeat(16,minmax(0,1fr));gap:2px;align-content:start}
.lay-ids .cell{font-family:var(--mono);font-size:9px;line-height:1.1;height:30px;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;border:1px solid transparent}
.lay-ids .cell b{font-weight:600;font-size:9px}
.lay-ids .cell[data-state=free]{background:#fff;border-color:var(--line);color:var(--muted)}
.lay-ids .cell[data-state=ours]{background:#e8eef7;border-color:#9fb6db;color:#1e3f8a}
.lay-ids .cell[data-state=ours][data-moved]{background:#dbe7ff;border-color:#1e3f8a}
.lay-ids .cell[data-state=base]{background:var(--chip);color:#a7b0b6}
.lay-ids .cell[data-state=dead]{background:repeating-linear-gradient(135deg,#f3f4f5 0 3px,#e6e9eb 3px 6px);color:#b5bcc1}
.lay-ids .cell[data-state=nouw]{background:repeating-linear-gradient(45deg,#f6efe9 0 3px,#eadbd0 3px 6px);color:#b59a86}
.lay-stock span[data-hidden]{text-decoration:line-through;opacity:.6}
.lay-ids .cell[data-over]{outline:2px solid #467fa9}
.lay-ids .cell[data-refuse]{outline:2px solid var(--err)}
.lay-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin:8px 0 0}
.lay-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px;border:1px solid var(--line)}
#lay-msg{min-height:1.5em;font-size:12px;margin-top:8px}
#lay-msg[data-kind=error]{color:var(--err)}
#lay-msg[data-kind=ok]{color:var(--ok)}
`;

const el = (tag: string, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};

export class LayoutEditor {
  /** the user's map; null until they change something (then the build gets it) */
  map: Layout | null = null;
  /** the answer to the page's UW question (true, false, or unanswered): saved with the layout */
  uw: boolean | undefined = undefined;
  private get noUw(): boolean { return this.uw === false; }
  /** why each machine the build moved is off its usual ID, by key */
  private moveWhy = new Map<string, string>();
  private needsUw = new Set<string>();
  private base: Base | null = null;
  private slots: IdSlot[] = [];
  private stock: BaseFamily[] = [];
  private plan: Plan | null = null;
  private eff: Layout | null = null;
  private names = new Map<string, string>();
  private blurbs = new Map<string, string>();
  private preferred = new Map<string, number>();
  private readonly root: HTMLElement;
  private drag: string | null = null;
  private advancedOpen = false;
  private previewCategory: string | null = null;
  private previewMachine = '';

  constructor(host: HTMLElement, private readonly onChange: () => void) {
    if (!document.getElementById('layout-styles')) document.head.append(el('style', { id: 'layout-styles' }, CSS));
    this.root = el('section', { class: 'panel layout-panel', id: 'layout-panel', 'aria-labelledby': 'layout-title', hidden: '' });
    host.before(this.root);
  }

  /** where the map came from when it was restored (a file, a patched OS, the earlier IDs); null: nothing restored */
  restoredFrom: string | null = null;
  /** the map is the earlier allocator's for the current selection: the page recomputes it when the selection changes */
  legacy = false;

  /** No map: the default layout, and nothing restored. */
  clear(): void { this.map = null; this.restoredFrom = null; this.legacy = false; }

  /**
   * A map made for another OS is applied to this one: every machine keeps its ID where this OS
   * has it free; the others move to free IDs, and the Models step lists each move.
   */
  private rebase(): void {
    if (!this.map || !this.base || this.map.base === this.base.id) return;
    const was = this.map.base;
    this.map = { ...this.map, base: this.base.id };
    if (was) this.say(`The layout was made for ${was}; it is applied to ${this.base.name}. Machines keep their IDs where ${this.base.name} has them free; any that move are listed on the Models step. Reset to default to drop it.`, 'info');
  }

  /** A base was loaded: its IDs and its own categories. A map made for another base is applied to it. */
  setBase(fw: Firmware | null, base: Base | null): void {
    this.base = base;
    this.slots = fw && base ? idSlots(fw, base) : [];
    this.stock = fw && base ? baseFamilies(fw, base) : [];
    this.rebase();
  }

  /** A map read from a file or a patched OS: it becomes the user's. */
  /** called when a map is adopted (a file, a patched OS, a project): the page handles its UW answer */
  onAdopt: ((l: Layout, from: string) => void) | null = null;

  adopt(l: Layout, from: string): void {
    this.map = l;
    this.restoredFrom = from;
    this.legacy = false;
    this.rebase();
    this.onAdopt?.(l, from);
    void fingerprint(l).then((fp) => this.say(`Layout ${fp} restored from ${from}.`, 'ok'));
  }

  mapForPlan(): Layout | undefined { return this.map ?? undefined; }

  render(p: Plan | null): void {
    this.plan = p;
    if (!p || !this.base) { this.root.hidden = true; return; }
    // A refused plan can leave a selected model without an ID. Keep selection
    // and capacity warnings usable until the user removes enough models.
    const placed = new Map(p.sel.map(s => [s.m.key, s.id]));
    if (p.menus.some(f => f.models.some(m => !placed.has(m.key)))) {
      this.eff = null;
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.names = new Map(p.sel.map((s) => [s.m.key, s.m.name.trim()]));
    this.blurbs = new Map(p.sel.map((s) => [s.m.key, describeModel(s.m).description]));
    this.preferred = new Map(p.sel.map((s) => [s.m.key, s.preferred]));
    this.moveWhy = new Map(p.moves.flatMap((mv) => p.sel.filter((s) => s.m.name.trim() === mv.name.trim()).map((s) => [s.m.key, mv.why] as [string, string])));
    this.needsUw = new Set(p.sel.filter((s) => needsUwSamples(s.m)).map((s) => s.m.key));
    this.eff = p.layout ?? defaultLayout(this.base, p.menus, (k) => placed.get(k)!);
    this.draw();
  }

  // ---- edits: each starts from the layout the build has and becomes the user's map

  private edit(f: (l: Layout) => string | void): void {
    if (!this.eff) return;
    const l: Layout = structuredClone(this.eff);
    const msg = f(l);
    if (typeof msg === 'string' && msg.startsWith('!')) { this.say(msg.slice(1), 'error'); return; }
    this.legacy = false;                                   // edited by hand: no longer recomputed
    this.renumber(l);
    this.map = l;
    this.say(msg || '', 'info');
    this.onChange();
  }

  /** orders 0..n-1 within each category, as listed now */
  private renumber(l: Layout): void {
    for (const c of l.categories) {
      Object.entries(l.machines).filter(([, m]) => m.category === c).sort((a, b) => a[1].order - b[1].order)
        .forEach(([, m], i) => { m.order = i; });
    }
  }

  private inCat(l: Layout, c: string): string[] {
    return Object.entries(l.machines).filter(([k, m]) => m.category === c && this.names.has(k))
      .sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  }

  private place(key: string, cat: string, before: string | null): void {
    this.previewCategory = cat;
    this.edit((l) => {
      const list = this.inCat(l, cat).filter((k) => k !== key);
      const at = before ? list.indexOf(before) : -1;
      list.splice(at < 0 ? list.length : at, 0, key);
      l.machines[key].category = cat;
      list.forEach((k, i) => { l.machines[k].order = i; });
      return `${this.names.get(key)} in ${cat}, position ${list.indexOf(key) + 1}.`;
    });
  }

  private setId(key: string, id: number): void {
    const s = this.slots[id];
    if (!s || !usableId(s, this.noUw)) { this.say(`${this.names.get(key)} cannot take ID ${id}: ${s && s.state === 'free' ? 'a Machinedrum without UW cannot use IDs 128 and up' : s?.why ?? 'outside 0..191'}.`, 'error'); return; }
    this.edit((l) => {
      const other = Object.keys(l.machines).find((k) => k !== key && this.names.has(k) && l.machines[k].id === id);
      const was = l.machines[key].id;
      l.machines[key].id = id;
      if (other) { l.machines[other].id = was; return `${this.names.get(key)} on ID ${id}; ${this.names.get(other)} swapped to ${was}.`; }
      return `${this.names.get(key)} on ID ${id}.`;
    });
  }

  private rename(from: string, to: string): string | null {
    const lim = menuLimits(this.base!);
    const why = nameProblem(to, lim, this.stock.map((f) => f.name));
    if (why) return why;
    if (to !== from && this.eff!.categories.includes(to)) return `there is already a category ${to}`;
    if (this.previewCategory === from) this.previewCategory = to;
    this.edit((l) => {
      l.categories = l.categories.map((c) => (c === from ? to : c));
      for (const m of Object.values(l.machines)) if (m.category === from) m.category = to;
      return `Category ${from} renamed ${to}.`;
    });
    return null;
  }

  // ---- drawing

  private say(msg: string, kind: 'info' | 'ok' | 'error'): void {
    const m = this.root.querySelector<HTMLElement>('#lay-msg');
    if (m) { m.textContent = msg; m.dataset.kind = kind; }
    this.pending = [msg, kind];
  }
  private pending: [string, string] = ['', 'info'];

  private draw(): void {
    const l = this.eff!;
    const lim = menuLimits(this.base!);
    const fp = el('span', { class: 'lay-fp', title: 'Layout fingerprint: two people with the same fingerprint have the same IDs and menu', ...(this.map ? { 'data-custom': '' } : {}) }, '…');
    void fingerprint(l).then((f) => { fp.textContent = `${this.map ? 'Custom' : 'Default'} layout ${f}`; fp.dataset.fp = f; });
    const exp = el('button', { type: 'button', id: 'lay-export' }, 'Save layout');
    exp.addEventListener('click', () => this.exportMap());
    const imp = el('input', { type: 'file', id: 'lay-import', accept: '.json,application/json', 'aria-label': 'Load layout file' }) as HTMLInputElement;
    imp.addEventListener('change', () => { if (imp.files?.[0]) void this.importMap(imp.files[0]); });
    const reset = el('button', { type: 'button', id: 'lay-reset' }, 'Reset to default');
    if (!this.map) reset.setAttribute('disabled', '');
    reset.addEventListener('click', () => { this.clear(); this.say('Default categories and automatic ID assignments restored.', 'info'); this.onChange(); });
    const head = el('div', { class: 'section-head' }, el('h2', { id: 'layout-title' }, 'Arrange categories'),
      el('div', { class: 'lay-actions' }, exp, el('label', { class: 'btn' }, 'Load layout', imp), reset));
    const intro = el('p', { class: 'fine' }, 'Arrange the machine menu. Save your layout to reuse it.');
    const limits = el('p', { class: 'lay-limits fine' },
      `Category names can use up to ${lim.nameShown} characters. Drag machines or use the lists and arrows to arrange them.`);

    // categories
    const menu = el('div', { class: 'lay-menu' },
      el('h3', {}, 'Built-in categories (read-only)'),
      el('div', { class: 'lay-stock' }, ...this.stock.map((f) => shownStock(this.stock, this.noUw).includes(f)
        ? el('span', { title: f.machines.map((m) => m.name).join(' ') }, `${f.name} ${f.machines.length}`)
        : el('span', { 'data-hidden': '', title: `${f.name}: hidden on a Machinedrum without UW; your categories take its place` }, `${f.name} ${f.machines.length}`))),
      el('h3', {}, 'Your categories, in menu order'));
    l.categories.forEach((c, ci) => menu.append(this.catCard(l, c, ci)));
    const add = el('button', { type: 'button', class: 'lay-add', id: 'lay-new' }, '+ New category');
    add.addEventListener('click', () => this.edit((x) => {
      let n = 1;
      while (x.categories.includes(`NW${n}`)) n++;
      // the engine's count (plan.ts): the categories the unit shows against the menu's limit
      if (shownStock(this.stock, this.noUw).length + x.categories.length >= lim.maxFamilies) return `!The menu takes ${lim.maxFamilies} categories.`;
      x.categories.push(`NW${n}`);
      this.previewCategory = `NW${n}`;
      return `Category NW${n} added: rename it, then drag machines into it.`;
    }));
    menu.append(add);

    // ID map
    const byId = new Map(Object.entries(l.machines).filter(([k]) => this.names.has(k)).map(([k, m]) => [m.id, k]));
    const ids = el('div', { class: 'lay-ids', role: 'grid', 'aria-label': 'Machine IDs 0 to 191' });
    for (const s of this.slots) {
      const k = byId.get(s.id);
      const c = idCell(s, this.noUw, k ? { name: this.names.get(k)!, usual: this.preferred.get(k)!, why: this.moveWhy.get(k), needsUw: this.needsUw.has(k) } : undefined);
      const cell = el('div', { class: 'cell', role: 'gridcell', 'data-id': String(s.id), 'data-state': c.state, title: c.title, ...(c.moved ? { 'data-moved': '' } : {}) },
        el('span', {}, String(s.id)), k ? el('b', {}, c.label) : c.label ? el('span', {}, c.label) : '');
      if (k) { cell.draggable = true; cell.addEventListener('dragstart', (e) => this.start(e, k)); }
      cell.addEventListener('dragover', (e) => {
        if (!this.drag) return;
        e.preventDefault();
        cell.toggleAttribute(usableId(s, this.noUw) ? 'data-over' : 'data-refuse', true);
      });
      cell.addEventListener('dragleave', () => { cell.removeAttribute('data-over'); cell.removeAttribute('data-refuse'); });
      cell.addEventListener('drop', (e) => { e.preventDefault(); const d = this.drag; this.drag = null; if (d) this.setId(d, s.id); });
      ids.append(cell);
    }
    const legend = el('div', { class: 'lay-legend' },
      el('span', {}, el('i', { style: 'background:#fff' }), 'free'), el('span', {}, el('i', { style: 'background:#e8eef7' }), 'yours'),
      el('span', {}, el('i', { style: 'background:#dbe7ff;border-color:#1e3f8a' }), 'yours, off its usual ID'),
      el('span', {}, el('i', { style: 'background:var(--chip)' }), `${this.base!.name}'s own`),
      el('span', {}, el('i', { style: 'background:repeating-linear-gradient(135deg,#f3f4f5 0 3px,#e6e9eb 3px 6px)' }), 'MIDI range, no sound'),
      this.noUw ? el('span', {}, el('i', { style: 'background:repeating-linear-gradient(45deg,#f6efe9 0 3px,#eadbd0 3px 6px)' }), '128 and up: not usable without UW') : '');
    const grid = el('div', { class: 'lay-grid' }, menu, this.menuPreview(l));
    const advanced = el('details', { class: 'lay-advanced', id: 'lay-advanced' }) as HTMLDetailsElement;
    advanced.open = this.advancedOpen;
    advanced.addEventListener('toggle', () => { if (advanced.isConnected) this.advancedOpen = advanced.open; });
    const controls = el('div', { class: 'lay-id-controls' });
    for (const c of l.categories) for (const k of this.inCat(l, c)) {
      controls.append(el('label', {}, this.names.get(k)!, this.idSelect(l, k)));
    }
    advanced.append(el('summary', {}, 'Advanced: machine IDs'),
      el('p', { class: 'fine' }, 'You normally do not need to change these. Saved kits identify machines by ID. Changing an ID can make an existing kit play a different machine. Only edit these assignments when you understand the effect on your kits; save the layout to keep them consistent.'),
      fp, controls, ids, legend,
      el('p', { class: 'fine' }, 'Choose an ID above or drag a machine onto a free slot. Dropping onto another selected machine swaps their IDs. Category changes keep these assignments unchanged.'));
    const msg = el('div', { id: 'lay-msg', role: 'status', 'aria-live': 'polite', 'data-kind': this.pending[1] }, this.pending[0]);
    this.root.replaceChildren(head, intro, limits, grid, advanced, msg);
  }

  private menuPreview(l: Layout): HTMLElement {
    // without UW the unit hides ROM and RAM and shows ours in their place (engine/src/uw_menu.ts)
    const categories = [...shownStock(this.stock, this.noUw).map(f => ({ key: `stock:${f.name}`, name: f.name, machines: f.machines.map(m => m.name.trim()) })),
      ...l.categories.map(c => ({ key: c, name: c, machines: this.inCat(l, c).map(k => this.names.get(k)!) }))];
    if (!categories.some(c => c.key === this.previewCategory)) this.previewCategory = l.categories[0] ?? categories[0]?.key ?? null;
    const select = el('select', { id: 'lay-preview-category', 'aria-label': 'Preview category' }) as HTMLSelectElement;
    for (const c of categories) {
      const opt = el('option', { value: c.key }, c.key.startsWith('stock:') ? `${c.name} (built-in)` : c.name) as HTMLOptionElement;
      opt.selected = c.key === this.previewCategory;
      select.append(opt);
    }
    const canvas = el('canvas', { role: 'img', id: 'lay-menu-screen' }) as HTMLCanvasElement;
    const machine = el('select', { id: 'lay-preview-machine', 'aria-label': 'Preview machine' }) as HTMLSelectElement;
    const caption = el('p', { class: 'fine', id: 'lay-preview-caption', 'aria-live': 'polite' });
    const paint = () => {
      const selected = categories.find(c => c.key === select.value);
      this.previewCategory = selected?.key ?? null;
      this.previewMachine = machine.value;
      const visible = categories.filter(c => c.machines.length);
      drawMenuLcd(canvas, visible, visible.findIndex(c => c.key === selected?.key), machine.selectedIndex);
      canvas.setAttribute('aria-label', selected?.machines.length
        ? `Machine menu preview. ${selected.name}: ${selected.machines.join(', ')}.`
        : `Machine menu preview. ${selected?.name ?? 'Category'} is empty and will not appear in the menu.`);
      caption.textContent = selected?.machines.length
        ? `${selected.name}: ${selected.machines.length} selectable machines, in menu order. Screen illustration; use the lists above to browse.`
        : 'Add a machine to this category to make it appear in the menu.';
    };
    const changeCategory = () => {
      const names = categories.find(c => c.key === select.value)?.machines ?? [];
      machine.replaceChildren(...names.map(n => {
        const opt = el('option', { value: n }, n) as HTMLOptionElement;
        opt.selected = n === this.previewMachine;
        return opt;
      }));
      machine.disabled = !names.length;
      paint();
    };
    select.addEventListener('change', changeCategory);
    machine.addEventListener('change', paint);
    changeCategory();
    return el('aside', { class: 'lay-preview', 'aria-label': 'Machine menu preview' },
      el('h3', {}, 'On your Machinedrum'),
      el('label', {}, 'Category ', select), el('label', {}, 'Machine ', machine),
      el('div', { class: 'lay-screen' }, canvas), caption);
  }

  private start(e: DragEvent, key: string): void {
    this.drag = key;
    e.dataTransfer?.setData('text/plain', key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  private catCard(l: Layout, c: string, ci: number): HTMLElement {
    const keys = this.inCat(l, c);
    const lim = menuLimits(this.base!);
    const name = el('input', { value: c, maxlength: String(lim.nameShown), 'aria-label': `Category name ${c}`, title: `Allowed: ${describeCharset(lim.charset)}`, spellcheck: 'false', 'data-cat': c }) as HTMLInputElement;
    name.addEventListener('input', () => {
      const v = name.value.toUpperCase() === name.value ? name.value : name.value.toUpperCase();
      if (v !== name.value) name.value = v;
      const why = nameProblem(v, lim, this.stock.map((f) => f.name)) ?? (v !== c && l.categories.includes(v) ? `there is already a category ${v}` : null);
      name.setAttribute('aria-invalid', String(!!why));
      name.title = why ?? '';
      this.say(why ? `Name not used: ${why}.` : '', why ? 'error' : 'info');
    });
    name.addEventListener('change', () => {
      if (name.value === c) return;
      const why = this.rename(c, name.value);
      if (why) { this.say(`Name not used: ${why}.`, 'error'); name.value = c; name.removeAttribute('aria-invalid'); }
    });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    const btn = (label: string, aria: string, on: () => void, disabled = false, title = ''): HTMLElement => {
      const b = el('button', { type: 'button', class: 'icon', 'aria-label': aria, title: title || aria }, label);
      if (disabled) b.setAttribute('disabled', '');
      b.addEventListener('click', on);
      return b;
    };
    const move = (d: number) => () => this.edit((x) => { const [v] = x.categories.splice(ci, 1); x.categories.splice(ci + d, 0, v); return `${c} moved ${d < 0 ? 'up' : 'down'}.`; });
    const del = btn('Delete', `Delete category ${c}`, () => this.edit((x) => {
      x.categories = x.categories.filter((y) => y !== c);
      for (const [k, m] of Object.entries(x.machines)) if (m.category === c) delete x.machines[k];   // unselected machines only
      return `Category ${c} deleted.`;
    }), keys.length > 0, keys.length ? `Move its ${keys.length} machines to another category first` : `Delete category ${c}`);
    del.setAttribute('data-del', c);
    const header = el('header', {}, name, el('span', { class: 'count' }, `${keys.length} machine${keys.length === 1 ? '' : 's'}`),
      btn('↑', `Move category ${c} up`, move(-1), ci === 0), btn('↓', `Move category ${c} down`, move(1), ci === l.categories.length - 1), del);
    const ol = el('ol', { 'aria-label': `Machines in ${c}` });
    keys.forEach((k, i) => ol.append(this.row(l, k, c, i, keys)));
    if (!keys.length) ol.append(el('li', { class: 'lay-empty' }, 'Empty. Drag machines here; an empty category is not written to the menu.'));
    const card = el('section', { class: 'lay-cat', 'data-cat': c }, header, ol);
    card.addEventListener('focusin', () => {
      const select = this.root.querySelector<HTMLSelectElement>('#lay-preview-category');
      if (select && select.value !== c) { select.value = c; select.dispatchEvent(new Event('change')); }
    });
    card.addEventListener('dragover', (e) => { if (this.drag) { e.preventDefault(); card.setAttribute('data-over', ''); } });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget as Node)) card.removeAttribute('data-over'); });
    card.addEventListener('drop', (e) => { e.preventDefault(); const d = this.drag; this.drag = null; if (d) this.place(d, c, null); });
    return card;
  }

  private idSelect(l: Layout, k: string): HTMLSelectElement {
    const m = l.machines[k];
    const nm = this.names.get(k)!;
    const idSel = el('select', { 'aria-label': `ID of ${nm}`, 'data-key': k, class: 'lay-id' }) as HTMLSelectElement;
    const owner = new Map(Object.entries(l.machines).filter(([x]) => this.names.has(x)).map(([x, v]) => [v.id, x]));
    for (const s of this.slots) {
      const o = owner.get(s.id);
      const usable = usableId(s, this.noUw);
      const label = !usable ? `${s.id} — ${s.state === 'free' ? 'not usable without UW' : s.why}` : o && o !== k ? `${s.id} — swap with ${this.names.get(o)}` : `${s.id}${s.id === this.preferred.get(k) ? ' (usual)' : ''}`;
      const opt = el('option', { value: String(s.id) }, label) as HTMLOptionElement;
      if (!usable) opt.disabled = true;
      if (s.id === m.id) opt.selected = true;
      idSel.append(opt);
    }
    idSel.addEventListener('change', () => this.setId(k, Number(idSel.value)));
    return idSel;
  }

  private row(l: Layout, k: string, c: string, i: number, keys: string[]): HTMLElement {
    const nm = this.names.get(k)!;
    const blurb = this.blurbs.get(k) ?? '';
    const up = el('button', { type: 'button', class: 'icon', 'aria-label': `Move ${nm} up` }, '↑');
    const down = el('button', { type: 'button', class: 'icon', 'aria-label': `Move ${nm} down` }, '↓');
    if (i === 0) up.setAttribute('disabled', '');
    if (i === keys.length - 1) down.setAttribute('disabled', '');
    up.addEventListener('click', () => this.place(k, c, keys[i - 1]));
    down.addEventListener('click', () => this.place(k, c, keys[i + 2] ?? null));
    const li = el('li', { draggable: 'true', 'data-key': k },
      el('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
      el('span', {}, el('span', { class: 'mname' }, nm)),
      el('span', { class: 'blurb', title: blurb }, blurb), up, down);
    li.addEventListener('dragstart', (e) => { this.start(e, k); li.setAttribute('data-drag', ''); });
    li.addEventListener('dragend', () => { li.removeAttribute('data-drag'); this.drag = null; });
    li.addEventListener('dragover', (e) => { if (this.drag && this.drag !== k) { e.preventDefault(); e.stopPropagation(); li.setAttribute('data-over', ''); } });
    li.addEventListener('dragleave', () => li.removeAttribute('data-over'));
    li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const d = this.drag; this.drag = null; if (d && d !== k) this.place(d, c, k); });
    return li;
  }

  // ---- files

  private async exportMap(): Promise<void> {
    if (!this.eff) return;
    // the fingerprint of what the file holds, UW answer included
    const out: Layout = { ...this.eff, ...(this.uw === undefined ? {} : { uw: this.uw }) };
    const fp = await fingerprint(out);
    const text = JSON.stringify({ ...out, fingerprint: fp }, null, 1);
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `md-layout-${out.base}-${fp}.json` }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    a.remove();
    this.say('Layout saved, including categories and machine IDs. Load it next time to keep your assignments.', 'ok');
  }

  private async importMap(f: File): Promise<void> {
    try {
      const l = parseLayout(await f.text());
      this.adopt(l, f.name);
      this.onChange();
    } catch (e) {
      this.say(`Map not imported: ${(e as Error).message}`, 'error');
    }
  }
}
