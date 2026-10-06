// Pitch metadata: what a model's pitch knob means, as data, and the one note <-> raw mapping.
//
// A model declares `panel.pitch` in its md-model/1 manifest; a compiled pack carries the same
// object as `PackModel.pitch`. The shared law for every absolute-pitch model is QUARTER:
// raw = 2 (MIDI - 24), so raw 0 = MIDI 24 (32.70 Hz), every even raw is a semitone, every odd raw
// the quarter tone between, and raw 127 = MIDI 87.5. Octave names follow the Machinedrum's own
// MIDI machine: MIDI 60 = C3 (MIDI 0 = C-2), so raw 0 is C0 and raw 72 is C3.
//
// This module is the TypeScript twin of md-firmware-mod's tools/pitch_meta.py; the two must agree.

export type PitchLaw = 'quarter' | 'chromatic' | 'continuous' | 'relative' | 'none';

export interface PitchZone {
  zone: number;                     // stop index of the MODE selector (panel.modes zone order)
  law?: PitchLaw;
  steps?: number;
  base_note?: number;
  range?: [number, number];
  center?: number;
}

export interface Pitch {
  knob: number | null;              // 0-based knob carrying pitch (null only with law 'none')
  law: PitchLaw;
  steps?: number;                   // raw steps per semitone: quarter 2, chromatic 1
  base_note?: number;               // MIDI note at raw 0 on the law's line
  range?: [number, number];         // raws where the law holds; outside, the end note is held
  center?: number;                  // relative: the raw that plays the mode's own voicing
  by_mode?: PitchZone[];            // per-stop overrides
  mode_knob?: number;               // 0-based knob whose stops by_mode indexes
  cents_per_step?: number;          // continuous only, when uniform
  tolerance_cents?: number;         // the checkers' bound (default 2)
  table?: string;                   // the per-raw table the pitch knob reads
}

export const PITCH_LAWS: readonly PitchLaw[] = ['quarter', 'chromatic', 'continuous', 'relative', 'none'];
export const QUARTER_BASE = 24;
export const QUARTER_STEPS = 2;
export const DEFAULT_TOLERANCE_CENTS = 2;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
export const hzMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

/** MIDI note -> name with MIDI 60 = C3; a quarter tone above a semitone gets '+'. */
export function noteName(note: number): string {
  const n = Math.floor(note + 1e-9);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}${note - n > 0.25 ? '+' : ''}`;
}

/** The law in force at MODE stop `zone` (by_mode overrides merged over the top level). */
export function resolvePitch(p: Pitch, zone?: number): Omit<Pitch, 'by_mode'> {
  const { by_mode, ...out } = p;
  const row = zone === undefined ? undefined : by_mode?.find(r => r.zone === zone);
  if (row) { const { zone: _z, ...rest } = row; Object.assign(out, rest); }
  return out;
}

const span = (p: Omit<Pitch, 'by_mode'>): [number, number] => p.range ?? [0, 127];

/**
 * The MIDI note (fractional for a quarter tone) raw plays, or null where the law names no note.
 * A relative law returns the offset in semitones from its centre's voicing.
 */
export function rawToNote(raw: number, pitch: Pitch, zone?: number): number | null {
  const p = resolvePitch(pitch, zone);
  const [lo, hi] = span(p);
  const r = Math.min(Math.max(raw, lo), hi);
  switch (p.law) {
    case 'quarter': case 'chromatic': return p.base_note! + r / p.steps!;
    case 'relative': return (r - p.center!) / p.steps!;
    case 'continuous': return p.cents_per_step !== undefined && p.base_note !== undefined
      ? p.base_note + r * p.cents_per_step / 100 : null;
    default: return null;
  }
}

export interface NoteRaw { raw: number; clamped: boolean; note: number }

/**
 * The raw value that plays MIDI `note` (for a relative law: the semitone offset), rounded to the
 * nearest raw and clamped into the law's range. `clamped` says the note was outside the range and
 * the raw plays the end note instead; `note` is what the raw actually plays.
 */
export function noteToRaw(note: number, pitch: Pitch, zone?: number): NoteRaw {
  const p = resolvePitch(pitch, zone);
  const [lo, hi] = span(p);
  let x: number;
  if (p.law === 'quarter' || p.law === 'chromatic') x = (note - p.base_note!) * p.steps!;
  else if (p.law === 'relative') x = p.center! + note * p.steps!;
  else if (p.law === 'continuous' && p.cents_per_step !== undefined && p.base_note !== undefined)
    x = (note - p.base_note) * 100 / p.cents_per_step;
  else throw new Error(`pitch law ${p.law} has no note mapping`);
  const r = Math.floor(x + 0.5);
  const raw = Math.min(Math.max(r, lo), hi);
  return { raw, clamped: raw !== r, note: rawToNote(raw, pitch, zone)! };
}

const KEYS = ['knob', 'law', 'steps', 'base_note', 'range', 'center', 'by_mode', 'mode_knob',
  'cents_per_step', 'tolerance_cents', 'table'];
const ZONE_KEYS = ['zone', 'law', 'steps', 'base_note', 'range', 'center'];
const PITCH_CAPTIONS = ['PTCH', 'NOTE', 'OSC1'];

interface PanelLike { knobs: { label: string }[]; modes: { knob: number; zones: { min: number; labels: Record<string, string> }[] }[] }

/** Throws unless `p` is a valid pitch object for this panel (labels, MODE selectors). */
export function checkPitch(p: Pitch, panel: PanelLike, who = 'model'): void {
  const fail = (why: string): never => { throw new Error(`${who}: invalid pitch metadata (${why})`); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('not an object');
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) fail(`unknown key ${k}`);
  if (!PITCH_LAWS.includes(p.law)) fail(`law ${String(p.law)}`);
  const isKnob = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 8;
  if (!(p.knob === null && p.law === 'none') && !isKnob(p.knob)) fail('knob');
  const pitched = (law: PitchLaw) => law === 'quarter' || law === 'chromatic' || law === 'relative';
  const rowCheck = (row: Partial<Pitch> & { zone?: number }) => {
    const law = row.law ?? p.law;
    const steps = row.steps ?? p.steps;
    if (law === 'quarter' && steps !== 2) fail('quarter needs steps 2');
    if (law === 'chromatic' && steps !== 1) fail('chromatic needs steps 1');
    if ((law === 'quarter' || law === 'chromatic') && typeof (row.base_note ?? p.base_note) !== 'number') fail(`${law} needs base_note`);
    if (law === 'relative' && (!Number.isInteger(row.center ?? p.center) || ![1, 2].includes(steps as number))) fail('relative needs center and steps');
    if (row.range !== undefined && !(Array.isArray(row.range) && row.range.length === 2 &&
        row.range.every(v => Number.isInteger(v)) && row.range[0] >= 0 && row.range[0] < row.range[1] && row.range[1] <= 127)) fail('range');
  };
  rowCheck(p);
  for (const k of ['cents_per_step', 'tolerance_cents'] as const)
    if (p[k] !== undefined && !(typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) > 0)) fail(k);
  if (p.table !== undefined && (typeof p.table !== 'string' || !p.table)) fail('table');
  if (p.knob !== null && pitched(p.law) && !PITCH_CAPTIONS.includes(panel.knobs[p.knob].label)) fail(`knob ${p.knob} is not a pitch caption`);
  if (p.by_mode !== undefined || p.mode_knob !== undefined) {
    if (!Array.isArray(p.by_mode) || !isKnob(p.mode_knob)) fail('by_mode needs mode_knob');
    const mode = panel.modes.find(m => m.knob === p.mode_knob) ?? fail('mode_knob names no MODE selector');
    const zones = [...mode.zones].sort((a, b) => a.min - b.min);
    const seen = new Set<number>();
    for (const row of p.by_mode!) {
      if (!row || typeof row !== 'object' || Object.keys(row).some(k => !ZONE_KEYS.includes(k)) ||
          !Number.isInteger(row.zone) || row.zone < 0 || row.zone >= zones.length || seen.has(row.zone)) fail('by_mode zone');
      seen.add(row.zone);
      if (row.law !== undefined && !PITCH_LAWS.includes(row.law)) fail('by_mode law');
      rowCheck(row);
    }
    // a stop that relabels the pitch knob to something that is not a pitch caption plays no note
    if (p.knob !== null) zones.forEach((z, i) => {
      const caption = z.labels[String(p.knob)];
      const law = resolvePitch(p, i).law;
      if (caption !== undefined && !PITCH_CAPTIONS.includes(caption) && pitched(law)) fail(`zone ${i} relabels the pitch knob ${caption} but keeps law ${law}`);
    });
  } else if (p.knob !== null) {
    for (const mode of panel.modes) for (const [i, z] of [...mode.zones].sort((a, b) => a.min - b.min).entries()) {
      const caption = z.labels[String(p.knob)];
      if (caption !== undefined && !PITCH_CAPTIONS.includes(caption) && pitched(p.law)) fail(`zone ${i} relabels the pitch knob ${caption} without a by_mode row`);
    }
  }
}
