// Pitch note names (--pitch-labels, off by default; X.14 and prepared OS 1.63).
//
// On the parameter page the Machinedrum draws each knob's value under its dial as a number. With
// this option the pitch knob of a model that declares an absolute pitch law (engine/src/pitch.ts:
// 'quarter' or 'chromatic') shows the note it plays instead, in three 4-pixel cells the way Elektron's
// DEV firmware shows the pitch of a TONAL track: the letter, an accidental cell, the octave.
//
//   C-3   a natural note (the accidental cell is '-', tracker style, as DEV draws it)
//   C#3   a sharp
//   C+3   a quarter tone above a natural note (one glyph: a tall plus)
//   C‡3   a quarter tone above a sharp (one glyph: a plus with three bars)
//   C--1  an octave below 0 (MIDI 12..23) takes a fourth cell: the octave's sign
//
// Octaves follow the Machinedrum's own MIDI machine, MIDI 60 = C3 (engine/src/pitch.ts noteName),
// so on the shared quarter-tone law raw 0 is C-0, raw 72 is C-3 and raw 127 is D#5+ (D‡5).
// Everything else draws its number exactly as before: other knobs, other pages, stock machines,
// models with a relative, continuous or no pitch law, and a MODE stop whose law names no note.
//
// What DEV does (the reference). DEV 26912 and 26A01 replace one call in the OS's knob-value
// painter, the string draw under each dial (`jsr $211384.l` at 0x22999e; DEV's own routine is at
// 0x2d500c on 26912 and 0x2d4eae on 26A01). On page 0 of a track whose kit sets TUNING to TONAL (a
// per-track bit in the kit, mirrored at 0x2dd0d4), DEV draws knob 1 as letter, accidental and
// octave from two 12-character tables ("CCDDEFFGGAAB", "-#-#--#-#-#-"), with an odd raw shown by
// a glyph of a 3x5 font of its own (a plus, or a plus with bars after a sharp); knobs 5 to 7 of
// some of its own machines get relative "+7", "-3Q" or "OFF". That labelling follows DEV's TONAL
// law (raw 0 is its "C#1") and DEV's TONAL setting, not a model's pitch metadata, so on DEV the
// option is not offered (bases/dev-*.json): the call it hooks is DEV's already.
//
// The hook. The painter (0x228a24 on X.14 and 1.63: `paint(knob, value)`, knob in d6 and value in
// d4 for its whole body) ends the number's draw with `jsr <draw>.l` (font, framebuffer, x, y, -1,
// string), x centred on the knob's column from the string's width. That call's operand becomes
// our routine's address. It returns to the painter exactly as the draw does; for anything that is
// not a labelled pitch knob it jumps to the draw with the stack untouched. For one that is, it
// reads the track's machine ID and (for a model whose law depends on a MODE knob) that knob's kit
// value, maps the raw to a quarter-tone count q = 2 * MIDI through the model's law, and draws the
// three or four cells centred where the number was: the stock 5-pixel font for the letter, '-',
// '#' and the octave, and a two-glyph font of ours for the quarter tones.
//
// A model whose law depends on a MODE knob (VADPC, VADRC) follows that knob's kit value whenever
// the value is drawn. Turning the MODE knob redraws the whole page only when dynamic knob labels
// change a caption, so such a model is labelled only with dynamic labels on and when every two
// MODE stops with different pitch laws also differ in a caption; otherwise it keeps its number,
// and the report says why. A p-locked or LFO-modulated MODE is not followed (as for MIDI chromatic
// input). Every site and OS routine is found by signature (PITCH_LABEL_SIGNATURES); none is assumed.

import { fromBase64, h } from './bytes.js';
import { Asm } from './cf_asm.js';
import { decodeLinear, type Insn } from './isa.js';
import { resolvePitch, type Pitch } from './pitch.js';
import { findSig, type CodeImage } from './sig.js';

/** What the hook is written against, every value read from the base's code. */
export interface PitchLabelSite {
  painter: number;        // the knob-value painter's entry (paint(knob, value))
  call: number;           // the `jsr <draw>.l` that draws the value's string
  site: number;           // its operand, which the patch list retargets (4-aligned)
  draw: number;           // the OS's string draw (font, fb, x, y, max, string)
  width: number;          // the OS's string width (font, max, string)
  font: number;           // the 5-pixel font the painter draws values in
  page: number;           // long: the parameter page shown (0: the machine's eight knobs)
  track: number;          // long: the track shown
  machineIds: number;     // long per track: the machine ID
  kitParams: number;      // 24 bytes per track: the kit's parameter values (page 0: + knob)
}

/** The base has no hook site this option is written for; `message` says why. */
export class NoPitchLabels extends Error {}

// The painter's entry: knob -> d6, value -> d4, the value printed with "%d" into the frame's string.
const SIG_PAINTER = '4e56 ffa8 48d7 3cfc 2c2e 0008 282e 000c 2006 e588 721c 9280 2001 2239 ........ e0a9 700f c081 6700 .... ' +
  '7403 c486 2d42 ffd8 2006 6c02 5680 2a00 e485 7001 9085 2d40 ffd0 2639 ........ 43ee fffc 45f9 <sprintf> 0801 0002 6708 2044 ' +
  '4868 ffc0 6002 2f04 4879 <fmt> 2f09 4e92 4fef 000c';
// The kit value it shows on the parameter page, and the track and page it shows: kit + 24 * track + 8 * page + knob.
const SIG_KIT = '2242 41f1 2a00 2008 d0b9 <page> e788 d086 41f9 <kit> 1030 0800 49c0';
// The track's machine ID.
const SIG_MACHINE = '2439 <track> 0806 0000 6700 .... 2039 <page> e788';
const SIG_ID = '2002 e588 2040 d1fc <tracks> 2028 01a2 41f9 ........';
// The generic value: the knob's flags by d6, "-" for a negative value, the dial graphic by d4, then
// the string's width and its draw, centred on the knob's column; the draw call is the hook site.
const SIG_VALUE = '2039 ........ 0d00 6618 2039 <page> e788 2040 d1fc ........ 4a30 6800 6d00 .... 47f9 ........ 2273 6c00 7002 b089 6d40 ' +
  '2039 ........ e788 2040 d1fc ........ 4a30 6800 6c2a 4875 9805 486c 0034 4879 ........ 4879 ........ 45f9 ........ 4e92 2073 6c00 5e88 ' +
  '4870 d800 6000 .... 4a84 6c14 4879 ........ 486e fffc 4eb9 <sprintf> 4284 508f 486d 0008 486c 0034 4879 ........ 4879 ........ 45f9 ........ ' +
  '4e92 42a7 2f2e ffd4 486c 0039 4879 ........ 4eb9 ........ 4fef 0020 486d 000a 486c 0036 4879 ........ 41f9 ........ 2f30 4c00 4e92 ' +
  '240e 5982 2f02 4878 ffff 4879 <font> 4eb9 <width> 2f02 4878 ffff 2f07 2000 6a02 5280 e280 99c0 486c 0039 4879 <fb> 4879 <font2> ' +
  '@call 4eb9 <target> 4fef 0034';
// The same painter's other value draws, each `jsr <draw>.l` after the same width-centred arguments:
// the OS's string draw, which the hook site must call on a base where it is still the OS's.
const SIG_DRAW = '240e 5982 2f02 4878 ffff 4879 <font> 4eb9 <width> 4fef 0020 2e82 4878 ffff 2f0b 2000 6a02 5280 e280 95c0 486a 0039 ' +
  '4879 <fb> 4879 <font2> 4eb9 <draw>';

/** The signatures, for tests and for anyone checking a base by hand. */
export const PITCH_LABEL_SIGNATURES = { painter: SIG_PAINTER, kit: SIG_KIT, machine: SIG_MACHINE, id: SIG_ID, value: SIG_VALUE, draw: SIG_DRAW } as const;

/** The knob-value painter's string draw and what the hook reads, or NoPitchLabels saying why. */
export function findPitchLabels(images: CodeImage[]): PitchLabelSite {
  const fail = (why: string): never => { throw new NoPitchLabels(`the knob-value painter: ${why}`); };
  const one = (sig: string, what: string, lo?: number, hi?: number) => {
    let hits = findSig(images, sig);
    if (lo !== undefined) hits = hits.filter((x) => x.at >= lo && x.at < hi!);
    if (hits.length !== 1) fail(`${what} ${hits.length ? `matches ${hits.length} times (${hits.slice(0, 3).map((x) => h(x.at)).join(', ')})` : 'is not found'}`);
    return hits[0];
  };
  const P = one(SIG_PAINTER, 'its entry (knob, value, "%d")');
  const span = [P.at, P.at + 0x1200] as const;
  const V = one(SIG_VALUE, "the value's width and draw", ...span).caps;
  const K = one(SIG_KIT, 'its kit-value read', ...span).caps;
  const M = one(SIG_MACHINE, 'its track and page', ...span).caps;
  const ids = findSig(images, SIG_ID).filter((x) => x.at >= span[0] && x.at < span[1]);
  if (!ids.length) fail("its track's machine ID is not found");
  const I = ids[0].caps;
  if (ids.some((x) => x.caps.tracks.value !== I.tracks.value)) fail(`its machine-ID reads name ${[...new Set(ids.map((x) => h(x.caps.tracks.value)))].join(', ')}`);
  const draws = findSig(images, SIG_DRAW).filter((x) => x.at >= span[0] && x.at < span[1]);
  if (!draws.length) fail("no other value draw to name the OS's string draw");
  const D = draws[0].caps;
  const why: string[] = [];
  const same = (what: string, ...v: number[]): void => { if (v.some((x) => x !== v[0])) why.push(`${what} differ (${v.map(h).join(', ')})`); };
  same('the pages shown', V.page.value, K.page.value, M.page.value);
  same('the fonts', V.font.value, V.font2.value, D.font.value, D.font2.value);
  same('the width routines', V.width.value, D.width.value);
  same('the framebuffers', V.fb.value, D.fb.value);
  same('the string printers', P.caps.sprintf.value, V.sprintf.value);
  if (draws.some((x) => x.caps.draw.value !== D.draw.value)) why.push(`its other value draws call ${[...new Set(draws.map((x) => h(x.caps.draw.value)))].join(', ')}`);
  if (V.target.value !== D.draw.value) {
    why.push(`the value's draw at ${h(V.call.at)} calls ${h(V.target.value)}, not the OS's string draw ${h(D.draw.value)}: the base already replaced it with code of its own`);
  }
  const site = V.call.at + 2;
  if (site % 4) why.push(`the draw's operand at ${h(site)} is not a whole longword`);
  if (why.length) fail(why.join('; '));
  return {
    painter: P.at, call: V.call.at, site, draw: D.draw.value, width: V.width.value, font: V.font.value,
    page: V.page.value, track: M.track.value, machineIds: I.tracks.value + 0x1a2, kitParams: K.kit.value,
  };
}

/** The discovered values a profile caches. */
export const pitchLabelValues = (S: PitchLabelSite): Record<string, number[]> => ({
  'pitch_labels.site': [S.painter, S.call],
  'pitch_labels.calls': [S.draw, S.width],
  'pitch_labels.data': [S.font, S.page, S.track, S.machineIds, S.kitParams],
});

// ---- what the LCD shows ------------------------------------------------------------------------------

/** The letter and accidental cells of each semitone from C, as DEV draws them. */
export const LETTERS = 'CCDDEFFGGAAB';
export const ACCIDENTALS = '-#-#--#-#-#-';
/** Our font's glyph codes: a quarter tone above a natural note, and above a sharp. */
export const QUARTER = 1, QUARTER_SHARP = 2;
/** The highest quarter-tone count the cells can show: MIDI 143.5 (octave 9). The lowest is 0 (C-2). */
export const Q_MAX = 287;

export interface Cells { letter: string; acc: string | number; octave: string }

/** The cells for a quarter-tone count q = 2 * MIDI (0..Q_MAX). */
export function cellsOf(q: number): Cells {
  if (!Number.isInteger(q) || q < 0 || q > Q_MAX) throw new Error(`no note name for quarter-tone count ${q}`);
  const s = q >> 1, i = s % 12, oct = Math.floor(s / 12) - 2;
  const acc = q & 1 ? (ACCIDENTALS[i] === '#' ? QUARTER_SHARP : QUARTER) : ACCIDENTALS[i];
  return { letter: LETTERS[i], acc, octave: String(oct) };
}

/** The cells as text: the quarter-tone glyphs as '+' and '‡'. */
export const cellText = (c: Cells): string => `${c.letter}${c.acc === QUARTER ? '+' : c.acc === QUARTER_SHARP ? '‡' : c.acc}${c.octave}`;

/**
 * The label the pitch knob of a model with this metadata shows at `raw` (with the MODE knob on
 * stop `zone`), from engine/src/pitch.ts alone: what the routine must draw. Null: its number.
 */
export function expectedLabel(pitch: Pitch, raw: number, zone?: number): string | null {
  const p = resolvePitch(pitch, zone);
  if (p.law !== 'quarter' && p.law !== 'chromatic') return null;
  const [lo, hi] = p.range ?? [0, 127];
  const note = p.base_note! + Math.min(Math.max(raw, lo), hi) / p.steps!;
  return cellText(cellsOf(Math.round(2 * note)));
}

// ---- the table ------------------------------------------------------------------------------------

const NONE = 0xff;

/** One law as the routine reads it: q = q0 + k * (clamp(raw, lo, hi) - lo). */
export interface LabelLaw { lo: number; hi: number; k: number; q0: number }

/** The law a resolved pitch is labelled with, or why it is not. */
export function labelLaw(p: Omit<Pitch, 'by_mode'>): LabelLaw | string {
  if (p.law !== 'quarter' && p.law !== 'chromatic') return `${p.law} law`;
  if (p.base_note === undefined || (p.steps !== 1 && p.steps !== 2)) return 'no base note';
  if (!Number.isInteger(2 * p.base_note)) return `base note ${p.base_note} is not on the quarter-tone grid`;
  const [lo, hi] = p.range ?? [0, 127];
  const k = 2 / p.steps, q0 = 2 * p.base_note + k * lo, qhi = q0 + k * (hi - lo);
  if (q0 < 0 || qhi > Q_MAX) return `its notes run from MIDI ${q0 / 2} to ${qhi / 2}, outside the octaves the cells show (-2..9)`;
  return { lo, hi, k, q0 };
}

/** What the table needs of a selected machine. */
export interface LabelModel {
  id: number; name: string; pitch?: Pitch;
  dyn_labels?: { knob: number; mask: number[]; stop_of: number[]; blocks: string }[];
}

export interface LabelTable {
  /** per labelled machine: [id, knob | segments << 3, default law, MODE knob, (lo, hi, law) per segment] */
  entries: { id: number; name: string; bytes: number[] }[];
  laws: LabelLaw[];
  /** per machine: what its pitch knob shows */
  perModel: { id: number; name: string; shows: string }[];
  /** the IDs of the plain entries (pitch knob 1, law 0, no MODE segments), then 0xff; then the other entries, then 0xff */
  table: Uint8Array;
  lawBytes: Uint8Array;
}

/**
 * The table, keyed by the IDs this build gave the machines. `dyn`: dynamic knob labels are built,
 * so a MODE stop change that changes a caption redraws the page (and with it the pitch label).
 */
export function buildLabelTable(models: LabelModel[], dyn: boolean): LabelTable {
  const laws: LabelLaw[] = [];
  const index = new Map<string, number>();
  const lawIdx = (l: LabelLaw | string): number => {
    if (typeof l === 'string') return NONE;
    const k = `${l.lo},${l.hi},${l.k},${l.q0}`;
    if (!index.has(k)) { index.set(k, laws.length); laws.push(l); }
    return index.get(k)!;
  };
  const entries: LabelTable['entries'] = [];
  const perModel: LabelTable['perModel'] = [];
  const number = (m: LabelModel, why: string): void => { perModel.push({ id: m.id, name: m.name, shows: `its number (${why})` }); };
  for (const m of [...models].sort((a, b) => a.id - b.id)) {
    const p = m.pitch;
    if (!p) { number(m, 'no pitch metadata'); continue; }
    if (p.knob === null || p.knob === undefined) { number(m, 'no pitch knob'); continue; }
    const top = labelLaw(resolvePitch(p));
    const def = lawIdx(top);
    const segs: [number, number, number][] = [];
    let modeKnob = 0;
    if (p.by_mode?.length) {
      modeKnob = p.mode_knob ?? -1;
      const plan = (m.dyn_labels ?? []).find((d) => d.knob === modeKnob && d.stop_of?.length === 128);
      if (!plan) { number(m, `its pitch law depends on knob ${modeKnob + 1}, whose MODE stops the pack does not carry`); continue; }
      const stops = Math.max(...plan.stop_of) + 1;
      const perStop = Array.from({ length: stops }, (_, z) => labelLaw(resolvePitch(p, z)));
      const key = (l: LabelLaw | string): string => (typeof l === 'string' ? 'none' : `${l.lo},${l.hi},${l.k},${l.q0}`);
      if (new Set(perStop.map(key)).size > 1) {
        if (!dyn) { number(m, `its pitch law changes with knob ${modeKnob + 1}, and without dynamic knob labels turning it does not redraw the page`); continue; }
        const blocks = fromBase64(plan.blocks), size = 4 * plan.mask.length;
        const caption = (z: number): string => Array.from(blocks.subarray(z * size, (z + 1) * size)).join(',');
        const silent: string[] = [];
        for (let a = 0; a < stops; a++) for (let b = a + 1; b < stops; b++) {
          if (key(perStop[a]) !== key(perStop[b]) && caption(a) === caption(b)) silent.push(`${a + 1} and ${b + 1}`);
        }
        if (silent.length) { number(m, `MODE stops ${silent.join(', ')} change its pitch law without changing a caption, so the page is not redrawn`); continue; }
      }
      const per = plan.stop_of.map((z) => lawIdx(perStop[z]));
      for (let r = 0; r < 128;) {
        let e = r;
        while (e + 1 < 128 && per[e + 1] === per[r]) e++;
        if (per[r] !== def) segs.push([r, e, per[r]]);
        r = e + 1;
      }
    }
    if (def === NONE && !segs.some((s) => s[2] !== NONE)) { number(m, typeof top === 'string' ? top : 'no note law'); continue; }
    if (segs.length > 31 || p.knob > 7 || modeKnob > 7 || modeKnob < 0) { number(m, 'its MODE stops do not fit the table'); continue; }
    entries.push({ id: m.id, name: m.name, bytes: [m.id, p.knob | (segs.length << 3), def, modeKnob, ...segs.flat()] });
    const none = segs.filter((s) => s[2] === NONE).length;
    perModel.push({ id: m.id, name: m.name, shows: `note names on knob ${p.knob + 1}` +
      (segs.length ? ` (follows knob ${modeKnob + 1}: ${segs.length} MODE segment${segs.length > 1 ? 's' : ''}${none ? `, ${none} of them with no note law, shown as numbers` : ''})` : '') });
  }
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('pitch note names: two machines share an ID');
  if (entries.some((e) => e.id >= NONE)) throw new Error('pitch note names: machine ID 255 cannot be in the table');
  if (laws.length >= NONE) throw new Error('pitch note names: too many pitch laws');
  const plain = (e: { bytes: number[] }): boolean => e.bytes.length === 4 && e.bytes[1] === 0 && e.bytes[2] === 0;
  return {
    entries, laws, perModel,
    table: Uint8Array.from([...entries.filter(plain).map((e) => e.id), NONE, ...entries.filter((e) => !plain(e)).flatMap((e) => e.bytes), NONE]),
    lawBytes: Uint8Array.from(laws.flatMap((l) => [l.lo, l.hi, l.k, 0, l.q0 >> 8, l.q0 & 255])),
  };
}

/** What the routine draws for (machine ID, knob, raw, the MODE knob's kit raw): the text, or null (its number). */
export function lookup(t: LabelTable, id: number, knob: number, raw: number, modeRaw = 0): string | null {
  const e = t.entries.find((x) => x.id === id);   // the plain list and the full entries hold the same records
  if (!e || (e.bytes[1] & 7) !== knob) return null;
  let li = e.bytes[2];
  for (let k = 0; k < e.bytes[1] >> 3; k++) {
    const [lo, hi, l] = e.bytes.slice(4 + 3 * k, 7 + 3 * k);
    if (modeRaw >= lo && modeRaw <= hi) { li = l; break; }
  }
  if (li === NONE) return null;
  const L = t.laws[li];
  return cellText(cellsOf(L.q0 + L.k * (Math.min(Math.max(raw, L.lo), L.hi) - L.lo)));
}

// ---- the routine ----------------------------------------------------------------------------------

export interface LabelCode {
  bytes: Uint8Array;
  /** the routine ends here; the data block follows */
  codeLen: number;
  labels: Record<string, number>;
  listing: { at: number; len: number; text: string }[];
}

/**
 * The routine at `org`, then its data: our font (two quarter-tone glyphs), the letter and
 * accidental tables, the three cell strings, the table and the laws.
 */
export function assemble(org: number, S: PitchLabelSite, t: LabelTable): LabelCode {
  const a = new Asm(org);
  const I = (op: string, ...x: string[]): void => a.i(op, ...x);
  const L = (v: number): string => `0x${v.toString(16)}.l`;
  // pl_draw: in place of the value's `jsr <draw>.l` (font, fb, x, y, -1, string at 4..24(a7)), with
  // the painter's knob in d6 and value in d4. Uses d0, d1, a0, a1 as the draw may; keeps the rest.
  a.label('pl_draw');
  I('tst.l', L(S.page)); I('bne.w', 'pl_orig');                          // page 0: the machine's knobs
  I('move.l', L(S.track), 'd0'); I('moveq', '#15', 'd1'); I('cmp.l', 'd0', 'd1'); I('bcs.w', 'pl_orig');
  I('move.l', '24(a7)', 'a0'); I('move.b', '(a0)', 'd1'); I('extb.l', 'd1');
  I('cmpi.l', '#45', 'd1'); I('beq.w', 'pl_orig');                       // "-": the painter had no value
  I('lea', L(S.machineIds), 'a0'); I('move.l', 'd0', 'd1'); I('lsl.l', '#2', 'd1'); I('move.l', '(a0,d1.l)', 'd1');
  I('lea', '-20(a7)', 'a7'); I('movem.l', 'd2-d3/d5/a2-a3', '(a7)');
  I('lea', '24(a7)', 'a3');                                              // a3: the draw's arguments
  // the machine's entry: [id, knob | segments << 3, default law, MODE knob, (lo, hi, law) ...]
  I('lea', '@table', 'a1');
  a.label('pl_plain');                                                   // the plain IDs: knob 1, law 0
  I('moveq', '#0', 'd2'); I('move.b', '(a1)+', 'd2'); I('cmp.l', 'd1', 'd2'); I('beq.b', 'pl_isplain');
  I('cmpi.l', '#255', 'd2'); I('bne.b', 'pl_plain');
  a.label('pl_find');
  I('moveq', '#0', 'd2'); I('move.b', '(a1)', 'd2'); I('cmpi.l', '#255', 'd2'); I('beq.w', 'pl_none');
  I('cmp.l', 'd1', 'd2'); I('beq.b', 'pl_found');
  I('moveq', '#0', 'd2'); I('move.b', '1(a1)', 'd2'); I('lsr.l', '#3', 'd2'); I('move.l', 'd2', 'd3'); I('add.l', 'd2', 'd2'); I('add.l', 'd3', 'd2');
  I('addq.l', '#4', 'd2'); I('adda.l', 'd2', 'a1'); I('bra.b', 'pl_find');
  a.label('pl_isplain');
  I('moveq', '#0', 'd3'); I('tst.l', 'd6'); I('beq.b', 'pl_law'); I('bra.w', 'pl_none');
  a.label('pl_found');
  I('moveq', '#0', 'd2'); I('move.b', '1(a1)', 'd2');
  I('moveq', '#7', 'd3'); I('and.l', 'd2', 'd3'); I('cmp.l', 'd6', 'd3'); I('bne.w', 'pl_none');   // the pitch knob?
  I('moveq', '#0', 'd3'); I('move.b', '2(a1)', 'd3');                   // its default law
  I('lsr.l', '#3', 'd2'); I('beq.b', 'pl_law');
  // the MODE knob's kit value: kit[24 * track + MODE knob]
  I('moveq', '#24', 'd5'); I('muls.w', 'd0', 'd5'); I('moveq', '#0', 'd1'); I('move.b', '3(a1)', 'd1'); I('add.l', 'd1', 'd5');
  I('lea', L(S.kitParams), 'a0'); I('moveq', '#0', 'd1'); I('move.b', '(a0,d5.l)', 'd1');
  I('lea', '4(a1)', 'a0');
  a.label('pl_seg');
  I('moveq', '#0', 'd5'); I('move.b', '(a0)', 'd5'); I('cmp.l', 'd5', 'd1'); I('bcs.b', 'pl_segnext');
  I('move.b', '1(a0)', 'd5'); I('cmp.l', 'd1', 'd5'); I('bcs.b', 'pl_segnext');
  I('move.b', '2(a0)', 'd3'); I('bra.b', 'pl_law');
  a.label('pl_segnext');
  I('addq.l', '#3', 'a0'); I('subq.l', '#1', 'd2'); I('bne.b', 'pl_seg');
  a.label('pl_law');
  I('cmpi.l', '#255', 'd3'); I('beq.w', 'pl_none');
  // the law [lo, hi, k, -, q0.w]: q = q0 + k * (clamp(raw, lo, hi) - lo)
  I('lea', '@laws', 'a0'); I('muls.w', '#6', 'd3'); I('adda.l', 'd3', 'a0');
  I('moveq', '#0', 'd1'); I('move.b', '(a0)', 'd1');
  I('move.l', 'd4', 'd2'); I('cmp.l', 'd1', 'd2'); I('bge.b', 'pl_lo'); I('move.l', 'd1', 'd2');
  a.label('pl_lo');
  I('moveq', '#0', 'd3'); I('move.b', '1(a0)', 'd3'); I('cmp.l', 'd3', 'd2'); I('ble.b', 'pl_hi'); I('move.l', 'd3', 'd2');
  a.label('pl_hi');
  I('sub.l', 'd1', 'd2'); I('moveq', '#0', 'd3'); I('move.b', '2(a0)', 'd3'); I('muls.w', 'd3', 'd2');
  I('moveq', '#0', 'd3'); I('move.w', '4(a0)', 'd3'); I('add.l', 'd3', 'd2');
  // q -> semitone (d2 mod 12, d3 octaves from MIDI 0) and the quarter tone (d5)
  I('moveq', '#1', 'd5'); I('and.l', 'd2', 'd5'); I('lsr.l', '#1', 'd2'); I('moveq', '#0', 'd3');
  a.label('pl_oct');
  I('moveq', '#12', 'd1'); I('cmp.l', 'd1', 'd2'); I('bcs.b', 'pl_cells'); I('sub.l', 'd1', 'd2'); I('addq.l', '#1', 'd3'); I('bra.b', 'pl_oct');
  a.label('pl_cells');
  // the cells: letter at buf+0, accidental at buf+2, octave at buf+4 (each NUL-terminated)
  I('lea', '@buf', 'a2');
  I('lea', '@letters', 'a0'); I('move.b', '(a0,d2.l)', 'd1'); I('move.b', 'd1', '(a2)');
  I('lea', '@accs', 'a0'); I('move.b', '(a0,d2.l)', 'd1');
  I('tst.l', 'd5'); I('beq.b', 'pl_acc');
  // a quarter tone: our glyph 1 after a natural note, 2 after a sharp
  I('cmpi.l', '#35', 'd1'); I('beq.b', 'pl_qsharp'); I('moveq', `#${QUARTER}`, 'd1'); I('bra.b', 'pl_acc');
  a.label('pl_qsharp');
  I('moveq', `#${QUARTER_SHARP}`, 'd1');
  a.label('pl_acc');
  I('move.b', 'd1', '2(a2)');
  I('subq.l', '#2', 'd3'); I('bmi.b', 'pl_neg');
  I('moveq', '#48', 'd1'); I('add.l', 'd3', 'd1'); I('move.b', 'd1', '4(a2)'); I('moveq', '#0', 'd1'); I('move.b', 'd1', '5(a2)'); I('bra.b', 'pl_place');
  a.label('pl_neg');
  I('moveq', '#45', 'd1'); I('move.b', 'd1', '4(a2)'); I('moveq', '#48', 'd1'); I('sub.l', 'd3', 'd1'); I('move.b', 'd1', '5(a2)');
  a.label('pl_place');
  // centred where the number was: c = x + width(number) / 2; three cells from c - 5, four from c - 7
  I('move.l', '20(a3)', '-(a7)'); I('pea', '0xffff.w'); I('move.l', '(a3)', '-(a7)'); I('jsr', L(S.width)); I('lea', '12(a7)', 'a7');
  I('lsr.l', '#1', 'd0'); I('add.l', '8(a3)', 'd0');
  I('moveq', '#5', 'd1'); I('tst.b', '5(a2)'); I('beq.b', 'pl_three'); I('moveq', '#7', 'd1');
  a.label('pl_three');
  I('sub.l', 'd1', 'd0'); I('move.l', 'd0', 'd2');
  I('move.l', 'a2', 'a0'); I('move.l', '(a3)', 'a1'); I('bsr.b', 'pl_put');
  I('addq.l', '#4', 'd2'); I('lea', '2(a2)', 'a0'); I('move.l', '(a3)', 'a1');
  I('tst.l', 'd5'); I('beq.b', 'pl_stock'); I('lea', '@font', 'a1');
  a.label('pl_stock');
  I('bsr.b', 'pl_put');
  I('addq.l', '#4', 'd2'); I('lea', '4(a2)', 'a0'); I('move.l', '(a3)', 'a1'); I('bsr.b', 'pl_put');
  I('movem.l', '(a7)', 'd2-d3/d5/a2-a3'); I('lea', '20(a7)', 'a7'); I('rts');
  a.label('pl_none');
  I('movem.l', '(a7)', 'd2-d3/d5/a2-a3'); I('lea', '20(a7)', 'a7');
  a.label('pl_orig');
  I('jmp', L(S.draw));
  // pl_put: draw the string at a0 in the font at a1, at x = d2 on the number's row and framebuffer
  a.label('pl_put');
  I('move.l', 'a0', '-(a7)'); I('pea', '0xffff.w'); I('move.l', '12(a3)', '-(a7)'); I('move.l', 'd2', '-(a7)');
  I('move.l', '4(a3)', '-(a7)'); I('move.l', 'a1', '-(a7)'); I('jsr', L(S.draw)); I('lea', '24(a7)', 'a7'); I('rts');
  a.label('code_end');
  a.align(4);
  // our font, laid out as the OS's: default width, height, per-character widths (none), offsets, glyphs.
  // Glyph columns as the OS's 5-pixel font has them: 1 is a tall plus, 2 a plus with three bars.
  a.bytes('font', [0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0, 0]);
  I('dc.l', '@offs'); I('dc.l', '@glyphs');
  a.bytes('offs', [0, 0, 0, 0, 0, 3]);
  a.bytes('glyphs', [0x20, 0xf8, 0x20, 0xa8, 0xf8, 0xa8]);
  a.bytes('letters', Array.from(LETTERS, (c) => c.charCodeAt(0)));
  a.bytes('accs', Array.from(ACCIDENTALS, (c) => c.charCodeAt(0)));
  a.bytes('buf', new Array(8).fill(0));
  a.bytes('table', t.table);
  a.align(2);
  a.bytes('laws', t.lawBytes);
  a.align(4);
  a.label('end');
  const r = a.assemble();
  return { bytes: r.bytes, codeLen: r.labels.code_end - org, labels: r.labels, listing: r.listing };
}

/** The OS routines the routine may call or jump to; every other branch stays inside it. */
export const labelCallees = (S: PitchLabelSite): number[] => [S.draw, S.width];

/** The one patch-list write that enters the routine (the draw call's operand), and what it must hold before. */
export function labelPatches(S: PitchLabelSite, L: Record<string, number>): { patches: [number, number][]; checks: [number, number][] } {
  return { patches: [[S.site, L.pl_draw >>> 0]], checks: [[S.site, S.draw]] };
}

/**
 * The routine as the image carries it: every instruction ISA_A, every branch inside it on an
 * instruction boundary, every call or jump out of it to the OS's string draw or width.
 */
export function checkLabelCode(code: Uint8Array, codeLen: number, org: number, S: PitchLabelSite): { ok: boolean; detail: string; insns: Insn[] } {
  const ins = decodeLinear(code.subarray(0, codeLen), org);
  const starts = new Set(ins.map((i) => i.at));
  const why: string[] = [];
  for (const i of ins) {
    if (!i.ok || i.mac) why.push(`${h(i.at)} ${i.name}: ${i.why ?? 'not ISA_A'}`);
    if (i.target === undefined) continue;
    const inside = i.target >= org && i.target < org + codeLen;
    if (inside ? !starts.has(i.target) : !labelCallees(S).includes(i.target)) why.push(`${h(i.at)} ${i.name} -> ${h(i.target)}`);
  }
  if (ins.reduce((n, i) => n + i.len, 0) !== codeLen) why.push('the routine does not decode to its length');
  return { ok: why.length === 0, detail: why.join('; '), insns: ins };
}
