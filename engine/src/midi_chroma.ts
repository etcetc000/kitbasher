// MIDI chromatic note input (--midi-chroma, off by default; X.14 and prepared OS 1.63).
//
// A note-on on the chromatic channel (base+4 by default: channel 5 with the factory base channel 1)
// plays the SELECTED track, the one the knobs edit: the note becomes the track machine's pitch-knob
// raw value through the OS's own CC handler (kit value, live parameter and, in EXTENDED
// mode, the lock staging, exactly as a pitch CC on the base channel), and the track is triggered in
// the same pass through the OS's own note-on handler in its direct-track form [9n, ~track, velocity],
// so the new pitch is in place at the onset. The note -> raw mapping comes from the selected models'
// pitch metadata (engine/src/pitch.ts): only quarter and chromatic laws play notes; every other
// machine (relative, continuous or no law, no metadata, stock machines) is triggered with its knobs
// untouched. ColdFire only: nothing reaches either DSP that a CC plus a note would not send.
//
// P-locks: with live record on, a played note also writes a pitch p-lock on the step the OS
// recorded the trig at; in grid record with trig keys held, on every held step. The lock writer
// allocates lock slots and is only ever called from the UI task, so the MIDI path (X.14: the audio
// interrupt; 1.63: the MIDI task) queues a request in a small ring and a call in the UI task drains it.
//
// X.14 (the add-on's real-time MIDI path, all add-on addresses verified byte for byte):
//   * the UART parser (0x2dc854) puts note-ons of the base range base..base+3 into the real-time
//     queue and drops the rest; its range test 0x2dcb54..0x2dcb67 becomes
//     `jsr hook_parse; beq.w enqueue; bmi.w drop; nop x3`: the base range continues as before, a
//     note-on with velocity on the chromatic channel is queued, everything else is dropped as before;
//   * the queue's consumer (0x2dce52, audio interrupt) calls the note-on handler with
//     `jsr $2cf672.l` at 0x2dcf08: that call goes to hook_note, which passes every message not on the
//     chromatic channel straight on (`jmp`, same stack);
//   * the note-on handler's call of the live trig recorder (`jsr $2379ac.l` at 0x2cf974) goes to
//     rec_hook, which reads the step the recorder set the trig on from its registers at return;
//   * the UI task's idle call (`jsr $229b38.l` at 0x22552e, operand at 0x225530) goes to drain, which
//     writes the queued locks with the OS's lock writer 0x21670a and then continues to 0x229b38.
// The code and its table go at the end of the RAM image the boot routine copies, inside the span of
// it earlier images ran from on hardware (plan.ts IND_EXT_SPAN).
//
// OS 1.63 (the prepared base) has no real-time queue: the UART interrupt's parser posts every
// complete message to the MIDI task's queue (and the UI task's), and the MIDI task dispatches it
// through the OS's channel-message table, so base-channel notes and CCs are handled in that task.
// Every site is found by signature (bases/lineage-163.json, chroma_*), none by address:
//   * the MIDI task's channel test for 0x80..0xBF (16 bytes, 0x209e10 on 1.63: drop unless the
//     channel is base..base+3) becomes `jsr hook_task; bmi.w next; nop x3`: the base range goes on to
//     the dispatch as before; a note-on with velocity on the chromatic channel is played right there
//     (the same CC, trigger and p-lock request as on X.14, in the task that plays base-channel notes),
//     and then dropped like every other message outside the base range;
//   * the note-on handler's call of the live trig recorder (0x20d040) goes to rec_hook, as on X.14;
//   * the UI loop's queue-count call (operand at 0x225524, `jsr <count>` before its idle call) goes to
//     drain, which writes the queued locks and continues to the count routine. (The idle call's own
//     operand is what dynamic labels retarget on 1.63, so drain is not put there.)
// The lock writer still runs only in the UI task: the MIDI task is a task of its own, and the two
// can preempt each other, so its requests go through the same ring, filled with interrupts masked.
// The DEV builds read MIDI through their own per-block queue: not implemented.

import { h, hex, u32 } from './bytes.js';
import { decodeLinear, type Insn } from './isa.js';
import type { Pitch } from './pitch.js';
import { findSig, reader, type CodeImage, type Hit } from './sig.js';

// ---- the X.14 sites --------------------------------------------------------------------------------

/** What both paths share: the OS state and routines the play and lock code use. */
export interface ChromaCommon {
  baseCh: number; selTrack: number; machineIds: number; kitParams: number;
  noteOn: number; ccHandler: number;
  recorder: number; trigHi: number;
  recSite: { site: number; old: string };
  livePattern: number; lockWriter: number; popup: number; popupFull: number;
  queuePost: number; uiQueue: number;
  /** the UI-task call drain takes the place of (its operand), and where drain continues */
  idle: { site: number; old: string; next: number };
  uiPattern: number; gridMode: number; held: number; knobTouched: number;
}

/** X.14: the add-on's real-time path, every site byte for byte. */
export interface ChromaSite extends ChromaCommon {
  kind?: 'x14';
  parser: { site: number; end: number; enqueue: number; drop: number; old: string };
  consumer: { site: number; old: string };
  /** main-OS code the lock path calls or depends on, byte for byte */
  anchors: Record<number, string>;
}

/** OS 1.63: the MIDI task, every address read from the base's code by signature. */
export interface ChromaTask extends ChromaCommon {
  kind: 'task';
  /** the MIDI task's channel test (16 bytes), and the loop head it drops to */
  filter: { site: number; end: number; loop: number; old: string };
  /** for the report: the task's queue, the UART parser that fills it, the dispatch table */
  midiQueue: number; parser: number; table: number;
}

export type Chroma = ChromaSite | ChromaTask;
export const isTask = (S: Chroma): S is ChromaTask => S.kind === 'task';

export const X14_CHROMA: ChromaSite = {
  baseCh: 0x100155c,      // long: the MIDI base channel 0..15
  selTrack: 0x2818da,     // long: the selected track 0..15
  machineIds: 0x7001aa,   // long per track: the machine ID
  kitParams: 0x70001a,    // 24 bytes per track: the kit's parameter values
  noteOn: 0x2cf672,       // note-on handler (msg, port); msg[1] >= 0x80 means track ~msg[1]
  ccHandler: 0x2dd464,    // real-time CC handler (msg, port 1: kit and live parameter)
  // cmp.l $14(a7),d0; blt.w drop; move.l $14(a7),d1; addq.l #3,d1; cmp.l d0,d1; blt.w drop
  parser: { site: 0x2dcb54, end: 0x2dcb68, enqueue: 0x2dcbb6, drop: 0x2dc940, old: 'b0af00146d00fde6222f00145681b2806d00fdda' },
  consumer: { site: 0x2dcf08, old: '4eb9002cf672508f' },   // jsr $2cf672.l; addq.l #8,a7
  recorder: 0x2379ac,     // live trig recorder (track): leaves the bit it set in d0, the trig word's base in a0
  trigHi: 0x780000,       // the recorder's a0 for steps 32..63
  recSite: { site: 0x2cf974, old: '4eb9002379ac588f' },     // jsr $2379ac.l; addq.l #4,a7
  livePattern: 0x28d202,  // long: the pattern the recorder writes into
  lockWriter: 0x21670a,   // (pattern, track, param, step, value) -> 1, or 0 when no lock slot is free
  popup: 0x21a10c, popupFull: 0x66,                         // the knob-lock paths' "locks full" popup
  queuePost: 0x2129e8, uiQueue: 0x2ab2ec,                   // post(queue, msg): what the UART parser wakes the UI with
  idle: { site: 0x225530, old: '00229b38', next: 0x229b38 }, // the UI loop's idle call operand (jsr at 0x22552e)
  uiPattern: 0x2ab2e8,    // long: the UI task's pattern
  gridMode: 0x281a3e,     // long: grid (step) recording
  held: 0x281aee,         // 64-bit big-endian mask of the trig keys held (0x281aee: steps 32..63)
  knobTouched: 0x281b12,  // long: a lock was edited while held (the release keeps the trig)
  anchors: {
    0x237a3e: '7001e7a88190602a',              // recorder <32: moveq #1,d0; lsl.l d3,d0; or.l d0,(a0); bra
    0x237a5a: '41f9007800002403',              // recorder >=32: lea $780000,a0; move.l d3,d2
    0x237a68: '7001e5a881b01c00',              // moveq #1,d0; lsl.l d2,d0; or.l d0,(a0,d1.l*4)
    0x237a70: '241f261f4e75',                  // restore d2/d3; rts (d0, a0 untouched)
    0x21670a: '4feffff048d7003c',              // lock writer entry
    0x216732: '4a806c044280606a',              // tst.l d0; bge; clr.l d0 (no slot -> 0)
    0x2129e8: '2f02226f000840c246fc2700',      // queue post: sr saved, interrupts masked
    0x22552e: '4eb900229b38',                  // UI loop: jsr idle stub (queue empty)
    0x224ab6: '4eb90021670a',                  // grid knob path: jsr lock writer
  },
};

/** The base has no verified chromatic-input hook sites; `message` says what differs. */
export class NoChroma extends Error {}

const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * The X.14 real-time MIDI path, every site and anchor byte for byte in the base's code images (the
 * ColdFire slot, the SRAM copy, the add-on). Throws NoChroma naming the first one that differs.
 */
export function findChroma(images: CodeImage[], S: ChromaSite = X14_CHROMA): ChromaSite {
  const read = reader(images);
  const want: [number, string, string][] = [
    [S.parser.site, S.parser.old, 'the UART parser\'s base-range test'],
    [S.consumer.site, S.consumer.old, 'the real-time queue\'s note-on call'],
    [S.recSite.site, S.recSite.old, 'the note-on handler\'s live-record call'],
    [S.idle.site, S.idle.old, 'the UI loop\'s idle call'],
    ...Object.entries(S.anchors).map(([a, v]) => [+a, v, `the OS code at ${h(+a)}`] as [number, string, string]),
  ];
  for (const [at, old, what] of want) {
    const got = read(at, old.length / 2);
    if (!got || hexOf(got) !== old) {
      throw new NoChroma(`X.14's real-time MIDI path: ${what} at ${h(at)} ${got ? `holds ${hexOf(got)}` : 'is not in the base\'s code'}`);
    }
  }
  if (S.parser.site % 4 || S.parser.end - S.parser.site !== 20 || S.consumer.site % 4 || S.recSite.site % 4 || S.idle.site % 4) {
    throw new NoChroma('the hook sites are not whole longwords');
  }
  return S;
}

/** The lineage signatures (bases/lineage-163.json) the MIDI-task path is found by. */
export const TASK_SIGNATURES = ['chroma_task', 'chroma_uart_isr', 'chroma_parser_post', 'chroma_note_on', 'chroma_rec_call', 'chroma_sel_track',
  'chroma_recorder', 'chroma_cc', 'chroma_cc_kit', 'chroma_grid_held', 'chroma_grid_lock', 'chroma_lock_writer', 'chroma_queue_post', 'chroma_ui_loop'] as const;

/**
 * OS 1.63's MIDI task (the prepared base), found by signature in the base's code. The UART
 * interrupt must call the parser that posts channel messages to the task's queue, the task must
 * dispatch through the table that names the note-on and CC handlers, and every routine and
 * variable the play and lock code uses must be the one the OS's own paths use. Throws NoChroma
 * naming the first thing that is missing, ambiguous or inconsistent.
 */
export function findChromaTask(images: CodeImage[], sigs: Record<string, string>): ChromaTask {
  const read = reader(images);
  const fail = (why: string): never => { throw new NoChroma(`OS 1.63's MIDI task: ${why}`); };
  for (const n of TASK_SIGNATURES) if (!sigs[n]) fail(`the lineage file has no signature '${n}'`);
  /** exactly one match, inside [lo, hi) when given (or exactly at lo when `at`) */
  const one = (name: string, what: string, win?: { lo: number; hi?: number }): Hit['caps'] & { at: { at: number; value: number } } => {
    let hits = findSig(images, sigs[name]);
    if (win) hits = hits.filter((x) => (win.hi === undefined ? x.at === win.lo : x.at >= win.lo && x.at < win.hi));
    if (hits.length !== 1) fail(`${what} (signature '${name}') ${hits.length ? `matches ${hits.length} times (${hits.slice(0, 3).map((x) => h(x.at)).join(', ')})` : 'is not found'}`);
    return { ...hits[0].caps, at: { at: hits[0].at, value: 0 } };
  };
  const long = (a: number, what: string): number => { const b = read(a, 4); if (!b) fail(`${what} at ${h(a)} is not in the base's code`); return u32(b!, 0); };
  const same = (what: string, ...v: number[]): void => { if (v.some((x) => x !== v[0])) fail(`${what} differ (${v.map(h).join(', ')})`); };

  const T = one('chroma_task', 'the MIDI task\'s loop');
  const isr = one('chroma_uart_isr', 'the UART interrupt\'s parser call');
  const parser = isr.parser.value;
  const P = one('chroma_parser_post', 'the parser\'s post of channel messages', { lo: parser, hi: parser + 0x400 });
  same('the MIDI task\'s queue and the one the parser posts to', T.midi_queue.value, P.midi_queue.value);
  const table = T.table.value;
  const noteOn = long(table + 4 * 9, 'the dispatch table\'s note-on entry'), ccHandler = long(table + 4 * 0xb, 'the dispatch table\'s CC entry');
  one('chroma_note_on', 'the note-on handler\'s entry (the direct-track form, the port argument)', { lo: noteOn });
  const R = one('chroma_rec_call', 'the note-on handler\'s live-record call', { lo: noteOn, hi: noteOn + 0x600 });
  const st = one('chroma_sel_track', 'the note-on handler\'s selected-track test', { lo: noteOn, hi: noteOn + 0x600 });
  const recorder = R.recorder.value;
  const rec = one('chroma_recorder', 'the live trig recorder\'s step write', { lo: recorder, hi: recorder + 0x100 });
  const cc = one('chroma_cc', 'the CC handler\'s entry', { lo: ccHandler });
  const kit = one('chroma_cc_kit', 'the CC handler\'s kit write', { lo: ccHandler, hi: ccHandler + 0x200 });
  same('the base channel and the CC handler\'s low byte of it', T.base_ch.value + 3, cc.base_ch_lo.value);
  const gh = one('chroma_grid_held', 'the grid knob path\'s held-step test');
  const gl = one('chroma_grid_lock', 'the grid knob path\'s lock write');
  same('the held-step mask\'s two longwords', gh.held.value + 4, gh.held_lo.value);
  same('the selected track (note-on handler, grid knob path)', st.sel_track.value, gl.sel_track.value);
  one('chroma_lock_writer', 'the lock writer\'s entry and its no-slot exit', { lo: gl.lock_writer.value });
  one('chroma_queue_post', 'the queue post (interrupts masked)', { lo: P.queue_post.value });
  const ui = one('chroma_ui_loop', 'the UI loop\'s queue count, idle call and wait');
  same('the UI task\'s queue (parser, UI loop)', P.ui_queue.value, ui.ui_queue.value, ui.ui_queue2.value);
  same('the queue get (MIDI task, UI loop)', T.queue_get.value, ui.queue_get.value);
  same('the base channel (MIDI task, UI loop)', T.base_ch.value, ui.base_ch.value);
  same('the UI task\'s pattern (UI loop, grid knob path)', ui.ui_pattern.value, gl.ui_pattern.value);
  const site = T.filter.at;
  const old = read(site, 16);
  if (!old || site % 4) fail(`the channel test at ${h(site)} is not a whole run of longwords`);
  const words = (at: number, n: number): string => hexOf(read(at, n)!);
  const S: ChromaTask = {
    kind: 'task',
    baseCh: T.base_ch.value, selTrack: st.sel_track.value, machineIds: cc.machine_base.value + 0x1a2, kitParams: kit.kit_params.value,
    noteOn, ccHandler, recorder, trigHi: rec.trig_hi.value,
    recSite: { site: R.site.at, old: words(R.site.at, 8) },
    livePattern: rec.live_pattern.value, lockWriter: gl.lock_writer.value, popup: gl.popup.value, popupFull: gl.popup_full.value,
    queuePost: P.queue_post.value, uiQueue: ui.ui_queue.value,
    idle: { site: ui.queue_count.at, old: words(ui.queue_count.at, 4), next: ui.queue_count.value },
    uiPattern: ui.ui_pattern.value, gridMode: gh.grid_mode.value, held: gh.held.value, knobTouched: gh.knob_touched.value,
    filter: { site, end: site + 16, loop: T.loop.at, old: words(site, 16) },
    midiQueue: T.midi_queue.value, parser, table,
  };
  if (S.recSite.site % 4 || S.idle.site % 4) fail('the hook sites are not whole longwords');
  return S;
}

/** The base's chromatic-input path: X.14's real-time path, else OS 1.63's MIDI task; NoChroma says why neither. */
export function discoverChroma(images: CodeImage[], sigs: Record<string, string>): Chroma {
  try { return findChroma(images); } catch (e) {
    if (!(e instanceof NoChroma)) throw e;
    try { return findChromaTask(images, sigs); } catch (e2) {
      if (!(e2 instanceof NoChroma)) throw e2;
      throw new NoChroma(`neither MIDI path this option is written for: ${e.message}; ${e2.message}`);
    }
  }
}

// ---- the channel -----------------------------------------------------------------------------------

/** 'base+4' (the default) .. 'base+15', 'ch:1' .. 'ch:16' -> the configuration byte the code reads. */
export function channelByte(spec = 'base+4'): number {
  let m = /^base\+(\d+)$/.exec(spec);
  if (m) {
    const k = +m[1];
    if (k < 4 || k > 15) throw new Error(`MIDI chromatic channel ${spec}: base+4..base+15 (base..base+3 trigger tracks)`);
    return 0x10 | k;
  }
  m = /^ch:(\d+)$/.exec(spec);
  if (m) {
    const c = +m[1];
    if (c < 1 || c > 16) throw new Error(`MIDI chromatic channel ${spec}: ch:1..ch:16`);
    return c - 1;
  }
  throw new Error(`MIDI chromatic channel ${spec}: use base+N (4..15) or ch:N (1..16)`);
}

// ---- the note -> raw table -------------------------------------------------------------------------

const NONE = 0xff;
/** A law [off, steps, lo, hi]: raw = steps * note - off, clamped to lo..hi. */
export type Law = [number, number, number, number];

/** The model's law at a MODE stop (null: the top level), the by_mode row merged over it. */
function resolve(p: Pitch, zone: number | null): Pitch {
  const out: Pitch = { ...p };
  delete out.by_mode;
  if (zone !== null) {
    const row = p.by_mode?.find((r) => r.zone === zone);
    if (row) { const { zone: _z, ...rest } = row; Object.assign(out, rest); }
  }
  return out;
}

/**
 * The law record for a resolved pitch, or null where it plays no note (relative, continuous, none).
 * engine/src/pitch.ts noteToRaw rounds steps * (note - base_note) to the nearest raw (halves up):
 * for an integer note that is steps * note - off with off = -floor(0.5 - steps * base_note).
 */
export function lawOf(p: Pitch): Law | null {
  if (p.law !== 'quarter' && p.law !== 'chromatic') return null;
  if (p.knob === null || p.base_note === undefined || (p.steps !== 1 && p.steps !== 2)) return null;
  const off = -Math.floor(0.5 - p.steps * p.base_note);
  if (off < -128 || off > 127) return null;
  const [lo, hi] = p.range ?? [0, 127];
  return [off, p.steps, lo, hi];
}

/** The raw the ColdFire code computes for a law and a note. */
export function rawOf(law: Law, note: number): number { return Math.min(Math.max(law[1] * note - law[0], law[2]), law[3]); }

/** What the table needs of a selected machine. */
export interface ChromaModel { id: number; name: string; pitch?: Pitch; dyn_labels?: { knob: number; stop_of: number[] }[] }

export interface ChromaEntry { id: number; name: string; bytes: number[] }
export interface ChromaTable {
  entries: ChromaEntry[]; laws: Law[];
  /** per machine: what a chromatic note does on it */
  perModel: { id: number; name: string; kind: string }[];
  /** the IDs of the plain entries (pitch knob 0, law 0, no MODE segments), then 0xff; then the other entries, then 0xff */
  table: Uint8Array;
  lawBytes: Uint8Array;
}

/**
 * The table, keyed by the IDs this build gave the machines. Per machine with a playable law: the
 * pitch knob, a default law and MODE-knob segments [lo, hi, law] (a by_mode model's zones resolved
 * through its own MODE stops, `dyn_labels[].stop_of`). Laws are shared.
 */
export function buildTable(models: ChromaModel[]): ChromaTable {
  const laws: Law[] = [];
  const lawIdx = new Map<string, number>();
  const law = (rec: Law | null): number => {
    if (!rec) return NONE;
    const k = rec.join(',');
    if (!lawIdx.has(k)) { lawIdx.set(k, laws.length); laws.push(rec); }
    return lawIdx.get(k)!;
  };
  const entries: ChromaEntry[] = [];
  const perModel: ChromaTable['perModel'] = [];
  const only = (m: ChromaModel, why: string): void => { perModel.push({ id: m.id, name: m.name, kind: `trigger only (${why})` }); };
  for (const m of [...models].sort((a, b) => a.id - b.id)) {
    const p = m.pitch;
    if (!p) { only(m, 'no pitch metadata'); continue; }
    if (p.knob === null || p.knob === undefined) { only(m, 'no pitch knob'); continue; }
    const def = law(lawOf(resolve(p, null)));
    const segs: [number, number, number][] = [];
    let modeKnob = 0;
    if (p.by_mode?.length) {
      modeKnob = p.mode_knob ?? -1;
      const sel = (m.dyn_labels ?? []).find((d) => d.knob === modeKnob && d.stop_of?.length === 128);
      if (!sel) { only(m, `its pitch depends on knob ${modeKnob + 1}, whose MODE stops the pack does not carry`); continue; }
      const per = sel.stop_of.map((z) => law(lawOf(resolve(p, z))));
      for (let r = 0; r < 128;) {
        let e = r;
        while (e + 1 < 128 && per[e + 1] === per[r]) e++;
        if (per[r] !== def) segs.push([r, e, per[r]]);
        r = e + 1;
      }
    }
    if (def === NONE && !segs.length) { only(m, `${p.law} law`); continue; }
    if (segs.length > 31 || p.knob > 7 || modeKnob > 7 || modeKnob < 0) { only(m, 'its MODE stops do not fit the table'); continue; }
    entries.push({ id: m.id, name: m.name, bytes: [m.id, p.knob | (segs.length << 3), def, modeKnob, ...segs.flat()] });
    perModel.push({ id: m.id, name: m.name, kind: segs.length ? `${p.law}, ${segs.length} MODE segment${segs.length > 1 ? 's' : ''}` : p.law });
  }
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('MIDI chromatic input: two machines share an ID');
  if (entries.some((e) => e.id >= NONE)) throw new Error('MIDI chromatic input: machine ID 255 cannot be in the table');
  if (laws.length >= NONE) throw new Error('MIDI chromatic input: too many pitch laws');
  const plain = (e: ChromaEntry): boolean => e.bytes.length === 4 && e.bytes[1] === 0 && e.bytes[2] === 0;
  return {
    entries, laws, perModel,
    table: Uint8Array.from([...entries.filter(plain).map((e) => e.id), NONE, ...entries.filter((e) => !plain(e)).flatMap((e) => e.bytes), NONE]),
    lawBytes: Uint8Array.from(laws.flatMap(([off, steps, lo, hi]) => [off & 0xff, steps, lo, hi])),
  };
}

/** What the ColdFire lookup returns for (machine ID, note, the MODE knob's kit raw): the knob and raw, or null (trigger only). */
export function lookup(t: ChromaTable, id: number, note: number, modeRaw = 0): { knob: number; raw: number } | null {
  const e = t.entries.find((x) => x.id === id);
  if (!e) return null;
  const b = e.bytes, n = b[1] >> 3;
  let li = b[2];
  for (let k = 0; k < n; k++) {
    const [lo, hi, l] = b.slice(4 + 3 * k, 7 + 3 * k);
    if (modeRaw >= lo && modeRaw <= hi) { li = l; break; }
  }
  return li === NONE ? null : { knob: b[1] & 7, raw: rawOf(t.laws[li], note) };
}

// ---- a small ColdFire (ISA_A) assembler: only the forms the routines use ---------------------------

type Ext = [number | (() => number), number];
interface Ea { mode: number; reg: number; ext: Ext[] }
type Item = { label: string } | { op: string; args: string[] } | { data: Uint8Array } | { align: number };

const REG = (s: string): { k: string; r: number } | null => { const m = /^([da])([0-7])$/.exec(s); return m ? { k: m[1], r: +m[2] } : null; };
const CC: Record<string, number> = { bra: 0, bsr: 1, bhi: 2, bls: 3, bcc: 4, bcs: 5, bne: 6, beq: 7, bpl: 10, bmi: 11, bge: 12, blt: 13, bgt: 14, ble: 15 };

class Asm {
  private items: Item[] = [];
  labels = new Map<string, number>();
  private pass = 0;
  constructor(private org: number) {}
  label(n: string): void { this.items.push({ label: n }); }
  i(op: string, ...args: string[]): void { this.items.push({ op, args }); }
  bytes(name: string, data: ArrayLike<number>): void { this.items.push({ label: name }); this.items.push({ data: Uint8Array.from(data) }); }
  align(n: number): void { this.items.push({ align: n }); }
  private addr(n: string): number { const v = this.labels.get(n); if (v === undefined) throw new Error(`label ${n}`); return v; }
  private ea(s: string, size?: string): Ea {
    let m: RegExpExecArray | null;
    const r = REG(s);
    if (r) return { mode: r.k === 'd' ? 0 : 1, reg: r.r, ext: [] };
    if ((m = /^\(a([0-7])\)$/.exec(s))) return { mode: 2, reg: +m[1], ext: [] };
    if ((m = /^-\(a([0-7])\)$/.exec(s))) return { mode: 4, reg: +m[1], ext: [] };
    if ((m = /^\(a([0-7])\)\+$/.exec(s))) return { mode: 3, reg: +m[1], ext: [] };
    if ((m = /^(-?\d+)\(a([0-7])\)$/.exec(s))) return { mode: 5, reg: +m[2], ext: [[+m[1] & 0xffff, 2]] };
    if ((m = /^(-?\d+)?\(a([0-7]),d([0-7])\.l(?:\*([124]))?\)$/.exec(s))) {
      const d = +(m[1] ?? 0), sc = ({ 1: 0, 2: 1, 4: 2 } as Record<string, number>)[m[4] ?? '1'];
      if (d < -128 || d > 127) throw new Error(`index displacement ${s}`);
      return { mode: 6, reg: +m[2], ext: [[(+m[3] << 12) | 0x0800 | (sc << 9) | (d & 0xff), 2]] };
    }
    if ((m = /^#(-?(?:0x)?[0-9a-f]+)$/i.exec(s))) { const v = Number(m[1]); return { mode: 7, reg: 4, ext: [[size === 'l' ? v >>> 0 : v & 0xffff, size === 'l' ? 4 : 2]] }; }
    if ((m = /^((?:0x)?[0-9a-f]+)\.w$/i.exec(s))) return { mode: 7, reg: 0, ext: [[Number(m[1]) & 0xffff, 2]] };
    if ((m = /^((?:0x)?[0-9a-f]+)\.l$/i.exec(s))) return { mode: 7, reg: 1, ext: [[Number(m[1]) >>> 0, 4]] };
    if ((m = /^@(\w+)$/.exec(s))) { const n = m[1]; return { mode: 7, reg: 1, ext: [[() => this.addr(n), 4]] }; }
    throw new Error(`operand ${s}`);
  }
  private enc(op: string, args: string[], at: number): Ext[] {
    const ea6 = (e: Ea): number => (e.mode << 3) | e.reg;
    const D = (s: string): number => { const r = REG(s); if (!r || r.k !== 'd') throw new Error(`${op}: ${s} is not Dn`); return r.r; };
    const A = (s: string): number => { const r = REG(s); if (!r || r.k !== 'a') throw new Error(`${op}: ${s} is not An`); return r.r; };
    const W = (w: number, ...es: Ea[]): Ext[] => [[w, 2], ...es.flatMap((e) => e.ext)];
    const [a0, a1] = args;
    const m = /^(b\w\w|bra|bsr)\.([bw])$/.exec(op);
    if (m && m[1] in CC) {
      const t = this.labels.get(a0) ?? at + 2, d = t - (at + 2);
      if (m[2] === 'b') {
        if ((d < -128 || d > 127 || d === 0 || d === -1) && this.pass === 2) throw new Error(`${op} ${a0}: ${d} out of byte range`);
        return [[0x6000 | (CC[m[1]] << 8) | (d & 0xff), 2]];
      }
      return [[0x6000 | (CC[m[1]] << 8), 2], [d & 0xffff, 2]];
    }
    if (op === 'move.w' && (a0 === 'sr' || a1 === 'sr')) {   // move.w sr,Dn | move.w Dn,sr | move.w #imm,sr
      if (a0 === 'sr') return [[0x40c0 | D(a1), 2]];
      return a0.startsWith('#') ? [[0x46fc, 2], [Number(a0.slice(1)) & 0xffff, 2]] : [[0x46c0 | D(a0), 2]];
    }
    switch (op) {
      case 'move.b': case 'move.w': case 'move.l': {
        const sz = ({ b: 0x1000, w: 0x3000, l: 0x2000 } as Record<string, number>)[op[5]], s = this.ea(a0, op[5]), d = this.ea(a1, op[5]);
        return [[sz | (d.reg << 9) | (d.mode << 6) | ea6(s), 2], ...s.ext, ...d.ext];
      }
      case 'moveq': { const v = Number(a0.slice(1)); if (v < -128 || v > 127) throw new Error('moveq range'); return [[0x7000 | (D(a1) << 9) | (v & 0xff), 2]]; }
      case 'lea': return W(0x41c0 | (A(a1) << 9) | ea6(this.ea(a0)), this.ea(a0));
      case 'pea': return W(0x4840 | ea6(this.ea(a0)), this.ea(a0));
      case 'jsr': return W(0x4e80 | ea6(this.ea(a0)), this.ea(a0));
      case 'jmp': return W(0x4ec0 | ea6(this.ea(a0)), this.ea(a0));
      case 'rts': return [[0x4e75, 2]];
      case 'nop': return [[0x4e71, 2]];
      case 'tst.b': case 'tst.l': return W(0x4a00 | ((op === 'tst.l' ? 2 : 0) << 6) | ea6(this.ea(a0)), this.ea(a0));
      case 'cmpi.l': return [[0x0c80 | D(a1), 2], ...this.ea(a0, 'l').ext];
      case 'ori.l': return [[0x0080 | D(a1), 2], ...this.ea(a0, 'l').ext];
      case 'cmp.l': return W(0xb080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'cmpa.l': return W(0xb1c0 | (A(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'or.l': return W(0x8080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'andi.l': return [[0x0280 | D(a1), 2], ...this.ea(a0, 'l').ext];
      case 'bclr': return [[0x0880 | D(a1), 2], [Number(a0.slice(1)) & 0xff, 2]];
      case 'add.l': return W(0xd080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'sub.l': return W(0x9080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'and.l': return W(0xc080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'adda.l': return W(0xd1c0 | (A(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'muls.w': return W(0xc1c0 | (D(a1) << 9) | ea6(this.ea(a0, 'w')), this.ea(a0, 'w'));
      case 'addq.l': case 'subq.l': {
        const q = Number(a0.slice(1));
        if (q < 1 || q > 8) throw new Error('quick range');
        return W((op === 'addq.l' ? 0x5080 : 0x5180) | ((q & 7) << 9) | ea6(this.ea(a1)), this.ea(a1));
      }
      case 'lsl.l': case 'lsr.l': {
        const n = Number(a0.slice(1));
        if (n < 1 || n > 8) throw new Error('shift range');
        return [[(op === 'lsl.l' ? 0xe188 : 0xe088) | ((n & 7) << 9) | D(a1), 2]];
      }
      case 'not.l': return [[0x4680 | D(a0), 2]];
      case 'neg.l': return [[0x4480 | D(a0), 2]];
      case 'extb.l': return [[0x49c0 | D(a0), 2]];
      case 'btst': return REG(a0) ? [[0x0100 | (D(a0) << 9) | D(a1), 2]] : [[0x0800 | D(a1), 2], [Number(a0.slice(1)) & 0xff, 2]];
      case 'movem.l': {   // movem.l d2-d7/a2,8(a7) | movem.l 8(a7),d2-d7/a2: (An) or (d16,An) only on a ColdFire
        const list = (s: string): number => s.split('/').reduce((mask, g) => {
          const [x, y] = g.split('-');
          const rx = REG(x)!, ry = REG(y ?? x)!;
          for (let k = rx.r; k <= ry.r; k++) mask |= 1 << (k + (rx.k === 'a' ? 8 : 0));
          return mask;
        }, 0);
        const toMem = /^[da]/.test(a0), e = this.ea(toMem ? a1 : a0);
        if (e.mode !== 2 && e.mode !== 5) throw new Error('movem: (An) or (d16,An) only');
        return [[(toMem ? 0x48c0 : 0x4cc0) | ea6(e), 2], [list(toMem ? a0 : a1), 2], ...e.ext];
      }
    }
    throw new Error(`unknown instruction ${op}`);
  }
  assemble(): { bytes: Uint8Array; listing: { at: number; len: number; text: string }[] } {
    const run = (): { bytes: Uint8Array; listing: { at: number; len: number; text: string }[] } => {
      let at = this.org;
      const out: number[] = [];
      const listing: { at: number; len: number; text: string }[] = [];
      for (const it of this.items) {
        if ('label' in it) { if (this.pass === 1) this.labels.set(it.label, at); continue; }
        if ('align' in it) { while ((at - this.org) % it.align) { out.push(0); at++; } continue; }
        if ('data' in it) { out.push(...it.data); at += it.data.length; continue; }
        const words = this.enc(it.op, it.args, at), start = at;
        for (const [v0, n] of words) {
          const v = typeof v0 === 'function' ? v0() : v0;
          for (let k = n - 1; k >= 0; k--) out.push((v >>> (8 * k)) & 0xff);
          at += n;
        }
        listing.push({ at: start, len: at - start, text: `${it.op} ${it.args.join(',')}` });
      }
      return { bytes: Uint8Array.from(out), listing };
    };
    this.pass = 1;
    for (const it of this.items) if ('label' in it) this.labels.set(it.label, 0);
    run();
    this.pass = 2;
    const r = run();
    this.pass = 3;
    const r2 = run();
    if (hexOf(r.bytes) !== hexOf(r2.bytes)) throw new Error('assembler did not converge');
    return r2;
  }
}

// ---- the routines ----------------------------------------------------------------------------------

/** Entries in the ring of p-lock requests from the audio interrupt to the UI task (one kept free). */
export const RING = 4;
/** A request's step code: 0..63 the step the OS recorded the trig at; ARMED: no trig recorded (grid entry); IDLE: nothing. */
export const IDLE = 0x40, ARMED = 0x80;

export interface ChromaCode {
  bytes: Uint8Array;
  /** the routines end here; the data block follows */
  codeLen: number;
  labels: Record<string, number>;
  listing: { at: number; len: number; text: string }[];
}

/**
 * The routines at `org`, then the data block `dat` (4-aligned): +0 the armed request [track |
 * knob<<4, raw, step code, pattern]; +4 write index, +5 read index, +6 the channel byte, +7 0xFE
 * (the UI wake-up message, a status byte the UI task ignores); +8 dropped requests (long); +12 the
 * CC bases of the four tracks of a channel; +16 the ring; then the table and the laws.
 */
export function assemble(org: number, S: Chroma, t: ChromaTable, cfg: number): ChromaCode {
  const a = new Asm(org);
  const I = (op: string, ...x: string[]): void => a.i(op, ...x);
  const BASE = `${S.baseCh}.l`;
  // chch: d1 = the chromatic channel 0..15, or -1 when off. Preserves every other register.
  a.label('chch');
  I('moveq', '#0', 'd1'); I('move.b', '@cfg', 'd1'); I('bmi.b', 'chch_off');
  I('bclr', '#4', 'd1'); I('beq.b', 'chch_done');                 // absolute channel
  I('add.l', BASE, 'd1'); I('andi.l', '#15', 'd1');
  a.label('chch_done'); I('rts');
  a.label('chch_off'); I('moveq', '#-1', 'd1'); I('rts');

  if (isTask(S)) {
    // hook_task: called in place of the MIDI task's channel test, for a channel message (0x80..0xBF):
    // d0 = the status byte sign-extended, d2 = status & 0xF0, d3 = the base channel, a0 = the message.
    // The base range returns N clear (the task dispatches it, as before); everything else returns N
    // set (dropped, as before), a note-on with velocity on the chromatic channel played first.
    // Keeps d2, d3 and a0, which the dispatch reads.
    a.label('hook_task');
    I('moveq', '#15', 'd1'); I('and.l', 'd0', 'd1');
    I('move.l', 'd1', 'd0'); I('sub.l', 'd3', 'd0'); I('cmpi.l', '#3', 'd0'); I('bhi.b', 'ht_other');
    I('moveq', '#0', 'd0'); I('rts');
    a.label('ht_other');
    I('move.l', 'd1', 'd0'); I('bsr.b', 'chch'); I('cmp.l', 'd0', 'd1'); I('bne.b', 'ht_drop');
    I('cmpi.l', '#0x90', 'd2'); I('bne.b', 'ht_drop');
    I('tst.b', '2(a0)'); I('beq.b', 'ht_drop');
    I('move.l', 'a0', '-(a7)'); I('bsr.b', 'hn_mine'); I('addq.l', '#4', 'a7');
    a.label('ht_drop'); I('moveq', '#-1', 'd0'); I('rts');
  } else {
    // hook_parse: called in place of the parser's base-range test, note-on, d0 = channel, a1 = message.
    // Returns Z (enqueue), N (drop) or neither (continue: the base range). Clobbers d1 only.
    a.label('hook_parse');
    I('move.l', 'd0', 'd1'); I('sub.l', BASE, 'd1'); I('cmpi.l', '#3', 'd1'); I('bhi.b', 'hp_other');
    I('moveq', '#1', 'd1'); I('rts');
    a.label('hp_other');
    I('bsr.b', 'chch'); I('cmp.l', 'd0', 'd1'); I('bne.b', 'hp_drop');
    I('tst.b', '2(a1)'); I('beq.b', 'hp_drop');
    I('moveq', '#0', 'd1'); I('rts');
    a.label('hp_drop'); I('moveq', '#-1', 'd1'); I('rts');

    // hook_note(msg, port): in place of the real-time consumer's call of the note-on handler.
    a.label('hook_note');
    I('move.l', '4(a7)', 'a0');
    I('moveq', '#0', 'd0'); I('move.b', '(a0)', 'd0'); I('moveq', '#15', 'd1'); I('and.l', 'd1', 'd0');
    I('move.l', 'd0', 'd1'); I('sub.l', BASE, 'd1'); I('cmpi.l', '#3', 'd1'); I('bls.b', 'hn_orig');
    I('bsr.b', 'chch'); I('cmp.l', 'd0', 'd1'); I('beq.b', 'hn_mine');
    a.label('hn_orig'); I('jmp', `${S.noteOn}.l`);
  }
  // hn_mine: play the note whose message pointer is at 4(a7) on the selected track (X.14: reached
  // from hook_note, the consumer's argument; 1.63: called from hook_task, which pushed it). Keeps
  // d2-d7/a2; on 1.63 hook_task needs no more (the task's d2, d3 and a0 matter only to the dispatch).
  a.label('hn_mine');
  // frame: 0..7 message, 8..35 saved d2-d7/a2; the message pointer is at 40(a7)
  I('lea', '-36(a7)', 'a7'); I('movem.l', 'd2-d7/a2', '8(a7)');
  I('move.l', '40(a7)', 'a0');
  I('moveq', '#0', 'd3'); I('move.b', '1(a0)', 'd3');            // note
  I('moveq', '#0', 'd5'); I('move.b', '2(a0)', 'd5');            // velocity (> 0: no other note gets here)
  I('move.l', `${S.selTrack}.l`, 'd4');
  I('moveq', '#15', 'd0'); I('cmp.l', 'd4', 'd0'); I('bcs.w', 'hn_out');      // no track selected
  I('lea', `${S.machineIds}.l`, 'a0'); I('move.l', '(a0,d4.l*4)', 'd0');
  I('lea', '@dat', 'a2');                                       // kept across the OS calls (callee-saved)
  I('bsr.w', 'lookup'); I('tst.l', 'd0'); I('bmi.b', 'hn_trig');
  // the pitch knob goes in by the OS's CC path: status B0|(base + track/4). A base channel too high
  // to address the track that way: trigger only, nothing armed, so no lock is written either
  I('move.l', 'd4', 'd2'); I('lsr.l', '#2', 'd2'); I('add.l', BASE, 'd2');
  I('moveq', '#15', 'd3'); I('cmp.l', 'd2', 'd3'); I('bcs.b', 'hn_trig');
  // arm the p-lock request [track | knob<<4, raw, ARMED, -]: rec_hook fills in the step if the OS records the trig
  I('move.l', 'd1', 'd3'); I('lsl.l', '#4', 'd3'); I('or.l', 'd4', 'd3'); I('move.b', 'd3', '(a2)');
  I('move.b', 'd0', '1(a2)'); I('moveq', `#${ARMED - 256}`, 'd3'); I('move.b', 'd3', '2(a2)');
  // the CC [B0|(base + track/4), 16/40/72/96 + knob, raw]
  I('ori.l', '#0xb0', 'd2'); I('move.b', 'd2', '(a7)');
  I('moveq', '#3', 'd2'); I('and.l', 'd4', 'd2'); I('move.b', '12(a2,d2.l)', 'd2');
  I('add.l', 'd1', 'd2'); I('move.b', 'd2', '1(a7)'); I('move.b', 'd0', '2(a7)');
  I('pea', '1.w'); I('pea', '4(a7)'); I('jsr', `${S.ccHandler}.l`); I('addq.l', '#8', 'a7');
  a.label('hn_trig');
  // the trigger: the note-on handler's direct-track form [9n, ~track, velocity], port 1
  I('move.l', BASE, 'd2'); I('ori.l', '#0x90', 'd2'); I('move.b', 'd2', '(a7)');
  I('move.l', 'd4', 'd2'); I('not.l', 'd2'); I('move.b', 'd2', '1(a7)'); I('move.b', 'd5', '2(a7)');
  I('pea', '1.w'); I('pea', '4(a7)'); I('jsr', `${S.noteOn}.l`); I('addq.l', '#8', 'a7');
  // a p-lock request? (step code: the recorded step, ARMED (grid entry, the UI task decides) or IDLE)
  I('move.l', '(a2)', 'd1');
  I('moveq', '#0', 'd0'); I('move.b', '2(a2)', 'd0'); I('moveq', `#${IDLE}`, 'd2'); I('move.b', 'd2', '2(a2)');
  I('btst', '#6', 'd0'); I('bne.b', 'hn_out');
  // ARMED (no trig recorded): only worth the UI task's time in grid record with a trig key held
  I('btst', '#7', 'd0'); I('beq.b', 'hn_queue');
  I('tst.l', `${S.gridMode}.l`); I('beq.b', 'hn_out');
  I('move.l', `${S.held}.l`, 'd2'); I('or.l', `${S.held + 4}.l`, 'd2'); I('beq.b', 'hn_out');
  a.label('hn_queue');
  // enqueue (one slot stays free: full when write+1 == read) and wake the UI task. Full: the newest
  // request is replaced (the last note still wins) and counted; the UI task only ever reads the
  // slot at the read index, which is not the newest one while the ring is full. On 1.63 the
  // producer is a task, which the UI task may preempt: the enqueue runs with interrupts masked.
  if (isTask(S)) { I('move.w', 'sr', 'd6'); I('move.w', '#0x2700', 'sr'); }
  I('moveq', '#0', 'd0'); I('move.b', '4(a2)', 'd0');
  I('move.l', 'd0', 'd2'); I('addq.l', '#1', 'd2'); I('moveq', `#${RING - 1}`, 'd3'); I('and.l', 'd3', 'd2');
  I('moveq', '#0', 'd3'); I('move.b', '5(a2)', 'd3'); I('cmp.l', 'd3', 'd2'); I('bne.b', 'hn_put');
  I('addq.l', '#1', '8(a2)'); I('move.l', 'd0', 'd2'); I('subq.l', '#1', 'd0'); I('moveq', `#${RING - 1}`, 'd3'); I('and.l', 'd3', 'd0');
  a.label('hn_put');
  I('move.l', 'd1', '16(a2,d0.l*4)'); I('move.b', 'd2', '4(a2)');
  if (isTask(S)) I('move.w', 'd6', 'sr');
  I('pea', '7(a2)'); I('pea', `${S.uiQueue}.l`); I('jsr', `${S.queuePost}.l`); I('addq.l', '#8', 'a7');
  a.label('hn_out');
  I('movem.l', '8(a7)', 'd2-d7/a2'); I('lea', '36(a7)', 'a7'); I('rts');

  // rec_hook(track): in place of the note-on handler's call of the live trig recorder. The recorder
  // leaves the bit it set in d0 (1 << step % 32) and the trig word's base in a0 (0x780000 for steps
  // 32..63): the step is read from there, so the lock lands exactly where the trig did.
  a.label('rec_hook');
  I('move.l', '4(a7)', '-(a7)'); I('jsr', `${S.recorder}.l`); I('addq.l', '#4', 'a7');
  I('lea', '@dat', 'a1'); I('tst.b', '2(a1)'); I('bpl.b', 'rh_out');          // not a chromatic note
  I('moveq', '#-1', 'd1');
  a.label('rh_bit'); I('addq.l', '#1', 'd1'); I('lsr.l', '#1', 'd0'); I('bne.b', 'rh_bit');
  I('cmpa.l', `#${S.trigHi}`, 'a0'); I('bne.b', 'rh_lo'); I('moveq', '#32', 'd0'); I('add.l', 'd0', 'd1');
  a.label('rh_lo'); I('move.b', 'd1', '2(a1)');
  I('move.l', `${S.livePattern}.l`, 'd0'); I('move.b', 'd0', '3(a1)');       // the pattern the trig went to
  a.label('rh_out'); I('rts');

  // drain: a call in the UI task (X.14: its idle call, before it waits for an event; 1.63: its
  // queue-count call at the top of every pass), continuing to that call's own target with the stack
  // as it found it (the count call's argument still at 4(a7)).
  // Writes the queued p-locks with the OS's lock writer, in the task that writes every other lock:
  //   a recorded step: (that pattern, track, knob, step, raw);
  //   ARMED: grid recording with steps held: every held step of the UI's pattern, and the held
  //   step's trig is kept on release as after a knob turn; otherwise nothing.
  a.label('drain');
  I('lea', '-24(a7)', 'a7'); I('movem.l', 'd2-d7', '(a7)');
  a.label('dr_next');
  I('lea', '@dat', 'a1');
  I('moveq', '#0', 'd0'); I('move.b', '5(a1)', 'd0'); I('moveq', '#0', 'd1'); I('move.b', '4(a1)', 'd1');
  I('cmp.l', 'd0', 'd1'); I('beq.w', 'dr_end');
  I('move.l', '16(a1,d0.l*4)', 'd1');
  I('addq.l', '#1', 'd0'); I('moveq', `#${RING - 1}`, 'd2'); I('and.l', 'd2', 'd0'); I('move.b', 'd0', '5(a1)');
  // d2 pattern, d3 track, d4 knob, d5 step, d6 raw (the lock writer's arguments in order)
  I('moveq', '#0', 'd2'); I('move.b', 'd1', 'd2'); I('lsr.l', '#8', 'd1');
  I('moveq', '#0', 'd5'); I('move.b', 'd1', 'd5'); I('lsr.l', '#8', 'd1');
  I('moveq', '#0', 'd6'); I('move.b', 'd1', 'd6'); I('lsr.l', '#8', 'd1');
  I('moveq', '#15', 'd3'); I('and.l', 'd1', 'd3'); I('move.l', 'd1', 'd4'); I('lsr.l', '#4', 'd4');
  I('moveq', '#1', 'd7');                                                   // all writes succeeded
  I('moveq', '#63', 'd0'); I('cmp.l', 'd5', 'd0'); I('bcs.b', 'dr_grid');
  I('bsr.b', 'dr_lock'); I('bra.b', 'dr_done');
  a.label('dr_grid');
  I('tst.l', `${S.gridMode}.l`); I('beq.w', 'dr_next');
  I('move.l', `${S.uiPattern}.l`, 'd2');
  I('moveq', '#0', 'd5');
  a.label('dr_step');
  I('move.l', 'd5', 'd0'); I('lsr.l', '#5', 'd0'); I('neg.l', 'd0'); I('lea', `${S.held + 4}.l`, 'a0'); I('move.l', '(a0,d0.l*4)', 'd0');
  I('btst', 'd5', 'd0'); I('beq.b', 'dr_skip');
  I('bsr.b', 'dr_lock'); I('moveq', '#1', 'd0'); I('move.l', 'd0', `${S.knobTouched}.l`);
  a.label('dr_skip');
  I('addq.l', '#1', 'd5'); I('moveq', '#64', 'd0'); I('cmp.l', 'd5', 'd0'); I('bne.b', 'dr_step');
  a.label('dr_done');
  I('tst.l', 'd7'); I('bne.w', 'dr_next');
  // no free lock slot: the OS's own popup, as its knob-lock paths show it
  I('pea', `${S.popupFull}.w`); I('pea', '0xffff.w'); I('pea', '0xffff.w'); I('pea', '0xffff.w'); I('pea', '0xffff.w');
  I('jsr', `${S.popup}.l`); I('lea', '20(a7)', 'a7'); I('bra.w', 'dr_next');
  a.label('dr_end');
  I('movem.l', '(a7)', 'd2-d7'); I('lea', '24(a7)', 'a7'); I('jmp', `${S.idle.next}.l`);
  a.label('dr_lock');
  I('lea', '-20(a7)', 'a7'); I('movem.l', 'd2-d6', '(a7)'); I('jsr', `${S.lockWriter}.l`); I('lea', '20(a7)', 'a7');
  I('and.l', 'd0', 'd7'); I('rts');

  // lookup: d0 = machine ID, d3 = note, d4 = track -> d0 = raw (or -1: trigger only), d1 = knob.
  // Uses d2, d6, d7, a0, a1 (saved by hn_mine).
  a.label('lookup');
  I('lea', '@table', 'a0');
  a.label('lk_def');                                                        // the plain IDs: knob 0, law 0
  I('moveq', '#0', 'd1'); I('move.b', '(a0)+', 'd1'); I('cmp.l', 'd0', 'd1'); I('beq.b', 'lk_plain');
  I('cmpi.l', '#255', 'd1'); I('bne.b', 'lk_def');
  a.label('lk_next');
  I('moveq', '#0', 'd1'); I('move.b', '(a0)', 'd1'); I('cmpi.l', '#255', 'd1'); I('beq.b', 'lk_none');
  I('cmp.l', 'd0', 'd1'); I('beq.b', 'lk_found');
  I('move.b', '1(a0)', 'd1'); I('lsr.l', '#3', 'd1'); I('move.l', 'd1', 'd2'); I('add.l', 'd1', 'd1'); I('add.l', 'd2', 'd1');
  I('addq.l', '#4', 'd1'); I('adda.l', 'd1', 'a0'); I('bra.b', 'lk_next');
  a.label('lk_none'); I('moveq', '#-1', 'd0'); I('rts');
  a.label('lk_plain'); I('moveq', '#0', 'd0'); I('moveq', '#0', 'd1'); I('bra.b', 'lk_law');
  a.label('lk_found');
  I('moveq', '#0', 'd1'); I('move.b', '1(a0)', 'd1');
  I('moveq', '#0', 'd0'); I('move.b', '2(a0)', 'd0');
  I('move.l', 'd1', 'd2'); I('lsr.l', '#3', 'd2'); I('beq.b', 'lk_law');
  // the MODE knob's kit value: kit[24 * track + mode knob]
  I('moveq', '#24', 'd6'); I('muls.w', 'd4', 'd6');
  I('moveq', '#0', 'd7'); I('move.b', '3(a0)', 'd7'); I('add.l', 'd7', 'd6');
  I('lea', `${S.kitParams}.l`, 'a1'); I('move.b', '(a1,d6.l)', 'd7');
  I('lea', '4(a0)', 'a1');
  a.label('lk_seg');
  I('moveq', '#0', 'd6'); I('move.b', '(a1)', 'd6'); I('cmp.l', 'd6', 'd7'); I('bcs.b', 'lk_segnext');
  I('move.b', '1(a1)', 'd6'); I('cmp.l', 'd7', 'd6'); I('bcs.b', 'lk_segnext');
  I('move.b', '2(a1)', 'd0'); I('bra.b', 'lk_law');
  a.label('lk_segnext'); I('addq.l', '#3', 'a1'); I('subq.l', '#1', 'd2'); I('bne.b', 'lk_seg');
  a.label('lk_law');
  I('cmpi.l', '#255', 'd0'); I('beq.b', 'lk_none');
  I('moveq', '#7', 'd2'); I('and.l', 'd2', 'd1');                         // knob
  I('lea', '@laws', 'a1'); I('lsl.l', '#2', 'd0'); I('adda.l', 'd0', 'a1');
  I('move.l', 'd3', 'd2'); I('moveq', '#0', 'd0'); I('move.b', '1(a1)', 'd0'); I('muls.w', 'd0', 'd2');
  I('move.b', '(a1)', 'd0'); I('extb.l', 'd0'); I('sub.l', 'd0', 'd2');      // steps * note - off
  I('moveq', '#0', 'd0'); I('move.b', '2(a1)', 'd0'); I('cmp.l', 'd0', 'd2'); I('bge.b', 'lk_hi'); I('move.l', 'd0', 'd2');
  a.label('lk_hi');
  I('move.b', '3(a1)', 'd0'); I('cmp.l', 'd0', 'd2'); I('ble.b', 'lk_ok'); I('move.l', 'd0', 'd2');
  a.label('lk_ok'); I('move.l', 'd2', 'd0'); I('rts');
  a.label('code_end');

  a.align(4);
  a.label('dat');
  a.bytes('arm', [0, 0, IDLE, 0]);
  a.bytes('widx', [0]); a.bytes('ridx', [0]); a.bytes('cfg', [cfg]); a.bytes('wake', [0xfe]);
  a.bytes('drops', [0, 0, 0, 0]);
  a.bytes('ccb', [16, 40, 72, 96]);
  a.bytes('ring', new Array(4 * RING).fill(0));
  a.bytes('table', t.table);
  a.bytes('laws', t.lawBytes);
  a.align(4);
  a.label('end');
  const r = a.assemble();
  const labels = Object.fromEntries(a.labels);
  return { ...r, labels, codeLen: labels.code_end - org };
}

/** The OS routines the code may call or jump to; every other branch stays inside it. */
export const callees = (S: Chroma): number[] => [S.noteOn, S.ccHandler, S.recorder, S.lockWriter, S.popup, S.queuePost, S.idle.next];

/** The base code the hook replaces with new instructions (not a retargeted operand), as [lo, hi). */
export const chromaRewritten = (S: Chroma): [number, number] => (isTask(S) ? [S.filter.site, S.filter.end] : [S.parser.site, S.parser.end]);

/** The boot patch-list writes that enter the routines, and what each longword must hold before. */
export function chromaPatches(S: Chroma, L: Record<string, number>): { patches: [number, number][]; checks: [number, number][] } {
  const patches: [number, number][] = [];
  const words = (site: number, w16: number[]): void => { for (let k = 0; k < w16.length; k += 2) patches.push([site + 2 * k, ((w16[k] << 16) | w16[k + 1]) >>> 0]); };
  const call = (site: number, to: number, tail: number): [number, number][] =>
    [[site, ((0x4eb9 << 16) | (to >>> 16)) >>> 0], [site + 4, (((to & 0xffff) << 16) | tail) >>> 0]];
  const old = (site: number, s: string): [number, number][] => Array.from({ length: s.length / 8 }, (_, k) => [site + 4 * k, u32(hex(s), 4 * k)]);
  if (isTask(S)) {
    const f = S.filter;
    words(f.site, [0x4eb9, L.hook_task >>> 16, L.hook_task & 0xffff,
      0x6b00, (f.loop - (f.site + 8)) & 0xffff,          // bmi.w loop (at site+6, displacement from site+8): dropped
      0x4e71, 0x4e71, 0x4e71]);                          // to site+16, the dispatch, unchanged
    patches.push(...call(S.recSite.site, L.rec_hook, 0x588f));
    patches.push([S.idle.site, L.drain >>> 0]);
    return { patches, checks: [...old(f.site, f.old), ...old(S.recSite.site, S.recSite.old), ...old(S.idle.site, S.idle.old)] };
  }
  const p = S.parser;
  words(p.site, [0x4eb9, L.hook_parse >>> 16, L.hook_parse & 0xffff,
    0x6700, (p.enqueue - (p.site + 8)) & 0xffff,        // beq.w enqueue (at site+6, displacement from site+8)
    0x6b00, (p.drop - (p.site + 12)) & 0xffff,          // bmi.w drop    (at site+10)
    0x4e71, 0x4e71, 0x4e71]);                            // to site+20, the enhanced-mode test, unchanged
  patches.push(...call(S.consumer.site, L.hook_note, 0x508f), ...call(S.recSite.site, L.rec_hook, 0x588f));
  patches.push([S.idle.site, L.drain >>> 0]);
  const checks = [...old(p.site, p.old), ...old(S.consumer.site, S.consumer.old), ...old(S.recSite.site, S.recSite.old), ...old(S.idle.site, S.idle.old)];
  return { patches, checks };
}

/** Every longword the patch list writes for this feature, as [lo, hi) ranges. */
export function chromaRanges(S: Chroma): [number, number][] {
  const [lo, hi] = chromaRewritten(S);
  return isTask(S)
    ? [[lo, hi], [S.recSite.site, S.recSite.site + 8], [S.idle.site, S.idle.site + 4]]
    : [[lo, hi], [S.consumer.site, S.consumer.site + 8], [S.recSite.site, S.recSite.site + 8], [S.idle.site, S.idle.site + 4]];
}

/** The hook sites, in the order discovery reports and profiles cache them. */
export const chromaSites = (S: Chroma): number[] => (isTask(S)
  ? [S.filter.site, S.recSite.site, S.idle.site]
  : [S.parser.site, S.consumer.site, S.recSite.site, S.idle.site]);

/**
 * The routines as the image carries them: every instruction ISA_A, every branch inside them on an
 * instruction boundary, every call or jump out of them to one of the OS routines they name.
 */
export function checkChromaCode(code: Uint8Array, codeLen: number, org: number, S: Chroma): { ok: boolean; detail: string; insns: Insn[] } {
  const ins = decodeLinear(code.subarray(0, codeLen), org);
  const starts = new Set(ins.map((i) => i.at));
  const why: string[] = [];
  for (const i of ins) {
    if (!i.ok || i.mac) why.push(`${h(i.at)} ${i.name}: ${i.why ?? 'not ISA_A'}`);
    if (i.target === undefined) continue;
    const inside = i.target >= org && i.target < org + codeLen;
    if (inside ? !starts.has(i.target) : !callees(S).includes(i.target)) why.push(`${h(i.at)} ${i.name} -> ${h(i.target)}`);
  }
  if (ins.reduce((n, i) => n + i.len, 0) !== codeLen) why.push('the routines do not decode to their length');
  return { ok: why.length === 0, detail: why.join('; '), insns: ins };
}
