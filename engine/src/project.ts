// The project file (.kitbasher.json, format kitbasher-project/1; docs/PROJECT-FILE.md): what a
// user chose on the page, so loading it with the same OS file rebuilds the same .syx. It names the
// OS by the hashes the engine identifies bases by, carries swapped E12 samples (packed to 12 bits,
// deflated, base64) and never the stock samples or the OS itself.

import type { Base } from './bases.js';
import { fromBase64, sha256, toBase64 } from './bytes.js';
import { parseLayout, type Layout } from './layout.js';
import { MAX_12, MIN_12 } from './samples.js';
import { channelByte } from './midi_chroma.js';

export const PROJECT_FORMAT = 'kitbasher-project/1';
export const PROJECT_EXTENSION = '.kitbasher.json';

export type TrimMode = 'auto' | 'keep' | 'manual';

export interface ProjectOs { base: string; name: string; tag: string; coldfire_sha256: string; dsp2_sha256: string; dsp1_sha256: string }

export interface ProjectSwap {
  entry: number;
  /** sample count (the packed data has one extra silent sample when it is odd) */
  samples: number;
  /** sha256 of the samples as 16-bit little-endian signed integers, before packing */
  sha256: string;
  /** the samples, two 12-bit values per 3 bytes (big-endian, first in the high half), deflate-raw, base64 */
  data: string;
  /** the file the user chose, for display only */
  source?: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  os: ProjectOs;
  samples: { swaps: ProjectSwap[]; no_trim: number[] };
  trim: { mode: TrimMode; db: number; cap: number };
  /** the selected models, by module */
  models: string[];
  /** the user's layout (md-layout/1), or null for the default one */
  layout: Layout | null;
  /** the answer to "does your Machinedrum have the UW option?"; absent: not answered (the page asks) */
  uw?: boolean;
  /**
   * MIDI chromatic note input was turned on (engine/src/midi_chroma.ts), with its channel; absent:
   * off. Kept whatever OS the project was saved with: it applies where the OS supports it.
   */
  midi_chroma?: { channel: string };
  /** false when the unmute-latency fix (engine/src/unmute.ts) was turned off; absent: on (the default) */
  unmute_fix?: false;
  /**
   * true when pitch note names (engine/src/pitch_labels.ts) were turned on; absent: off (the
   * default). Kept whatever OS the project was saved with: it applies where the OS supports it.
   */
  pitch_labels?: true;
}

/** A project in memory: what the page and the build use. */
export interface Project {
  os: ProjectOs;
  swaps: Map<number, Int16Array>;
  sources: Map<number, string>;
  noTrim: Set<number>;
  trim: ProjectFile['trim'];
  models: string[];
  layout: Layout | null;
  /** the answer to "does your Machinedrum have the UW option?"; undefined: not answered */
  uw?: boolean;
  /** MIDI chromatic note input and its channel; undefined: off */
  midiChroma?: { channel: string };
  /** false: the unmute-latency fix was turned off; undefined: the default (on where the OS has it) */
  unmuteFix?: false;
  /** true: pitch note names were turned on; undefined: off (the default) */
  pitchLabels?: true;
}

export function osOf(base: Base): ProjectOs {
  const i = base.identify;
  return { base: base.id, name: base.name, tag: i.tag, coldfire_sha256: i.coldfire_sha256, dsp2_sha256: i.dsp2_sha256, dsp1_sha256: i.dsp1_sha256 };
}

/** Why this project cannot be used with this OS, or null. */
export function osProblem(os: ProjectOs, base: Base): string | null {
  const have = osOf(base);
  if (os.base !== have.base) return `this project was made for ${os.name || os.base}, and the loaded OS is ${base.name}`;
  for (const k of ['tag', 'coldfire_sha256', 'dsp2_sha256', 'dsp1_sha256'] as const) {
    if (os[k] !== have[k]) return `this project was made for a different ${os.name || os.base} file (its ${k.replace('_sha256', '')} does not match the loaded OS)`;
  }
  return null;
}

export function pack12Bytes(x: ArrayLike<number>): Uint8Array {
  const n = x.length;
  const out = new Uint8Array(3 * Math.ceil(n / 2));
  for (let i = 0, o = 0; i < n; i += 2, o += 3) {
    const a = x[i] & 0xfff, b = (i + 1 < n ? x[i + 1] : 0) & 0xfff;
    out[o] = a >> 4; out[o + 1] = ((a & 0xf) << 4) | (b >> 8); out[o + 2] = b & 0xff;
  }
  return out;
}

export function unpack12Bytes(b: Uint8Array, n: number): Int16Array {
  if (b.length !== 3 * Math.ceil(n / 2)) throw new Error(`packed sample data is ${b.length} bytes, expected ${3 * Math.ceil(n / 2)} for ${n} samples`);
  const out = new Int16Array(n);
  const s = (v: number): number => (v >= 2048 ? v - 4096 : v);
  for (let i = 0, o = 0; i < n; i += 2, o += 3) {
    out[i] = s((b[o] << 4) | (b[o + 1] >> 4));
    if (i + 1 < n) out[i + 1] = s(((b[o + 1] & 0xf) << 8) | b[o + 2]);
  }
  return out;
}

export async function samplesSha256(x: ArrayLike<number>): Promise<string> {
  const b = new Uint8Array(2 * x.length);
  for (let i = 0; i < x.length; i++) { b[2 * i] = x[i] & 0xff; b[2 * i + 1] = (x[i] >> 8) & 0xff; }
  return sha256(b);
}

async function through(b: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeProject(p: Project): Promise<ProjectFile> {
  const swaps: ProjectSwap[] = [];
  for (const entry of [...p.swaps.keys()].sort((a, b) => a - b)) {
    const x = p.swaps.get(entry)!;
    const data = toBase64(await through(pack12Bytes(x), new CompressionStream('deflate-raw')));
    const sw: ProjectSwap = { entry, samples: x.length, sha256: await samplesSha256(x), data };
    const src = p.sources.get(entry);
    if (src) sw.source = src;
    swaps.push(sw);
  }
  return {
    format: PROJECT_FORMAT, os: p.os,
    samples: { swaps, no_trim: [...p.noTrim].sort((a, b) => a - b) },
    trim: p.trim, models: [...p.models].sort(), layout: p.layout,
    ...(p.uw === undefined ? {} : { uw: p.uw }),
    ...(p.midiChroma ? { midi_chroma: { channel: p.midiChroma.channel } } : {}),
    ...(p.unmuteFix === false ? { unmute_fix: false as const } : {}),
    ...(p.pitchLabels ? { pitch_labels: true as const } : {}),
  };
}

/** A project file's JSON, read and checked: every swap's data must unpack to its sample count and hash. */
export async function decodeProject(json: string): Promise<Project> {
  let o: ProjectFile;
  try { o = JSON.parse(json) as ProjectFile; } catch { throw new Error('not a Kitbasher project file (not JSON)'); }
  if (!o || typeof o !== 'object' || o.format !== PROJECT_FORMAT) throw new Error(`not a ${PROJECT_FORMAT} project file`);
  const os = o.os;
  if (!os || ['base', 'tag', 'coldfire_sha256', 'dsp2_sha256', 'dsp1_sha256'].some((k) => typeof (os as unknown as Record<string, unknown>)[k] !== 'string')) {
    throw new Error('project file: the OS fingerprint is missing');
  }
  const swaps = new Map<number, Int16Array>();
  const sources = new Map<number, string>();
  for (const s of o.samples?.swaps ?? []) {
    if (!Number.isInteger(s.entry) || s.entry < 0 || !Number.isInteger(s.samples) || s.samples < 1 || typeof s.data !== 'string') {
      throw new Error('project file: a sample swap needs an entry, a sample count and data');
    }
    if (swaps.has(s.entry)) throw new Error(`project file: entry ${s.entry} is swapped twice`);
    const x = unpack12Bytes(await through(fromBase64(s.data), new DecompressionStream('deflate-raw')), s.samples);
    for (const v of x) if (v < MIN_12 || v > MAX_12) throw new Error(`project file: entry ${s.entry} is not 12-bit`);
    if (await samplesSha256(x) !== s.sha256) throw new Error(`project file: entry ${s.entry}'s samples do not match their sha256`);
    swaps.set(s.entry, x);
    if (typeof s.source === 'string') sources.set(s.entry, s.source);
  }
  const noTrim = new Set<number>();
  for (const e of o.samples?.no_trim ?? []) {
    if (!Number.isInteger(e) || e < 0) throw new Error('project file: no_trim lists entries by number');
    noTrim.add(e);
  }
  const t = o.trim;
  if (!t || !['auto', 'keep', 'manual'].includes(t.mode) || typeof t.db !== 'number' || typeof t.cap !== 'number') {
    throw new Error('project file: trim needs a mode (auto, keep or manual), db and cap');
  }
  if (!Array.isArray(o.models) || o.models.some((m) => typeof m !== 'string')) throw new Error('project file: models must list module names');
  const layout = o.layout === null || o.layout === undefined ? null : parseLayout(JSON.stringify(o.layout));
  if (o.uw !== undefined && typeof o.uw !== 'boolean') throw new Error('project file: uw must be true or false');
  if (o.unmute_fix !== undefined && (o.unmute_fix as unknown) !== false) throw new Error('project file: unmute_fix must be false or absent');
  if (o.pitch_labels !== undefined && (o.pitch_labels as unknown) !== true) throw new Error('project file: pitch_labels must be true or absent');
  const mc = o.midi_chroma;
  if (mc !== undefined) {
    if (!mc || typeof mc !== 'object' || typeof mc.channel !== 'string') throw new Error('project file: midi_chroma must be { "channel": "base+4" } or absent');
    try { channelByte(mc.channel); } catch (e) { throw new Error(`project file: ${(e as Error).message}`); }
  }
  return { os: { base: os.base, name: String(os.name ?? os.base), tag: os.tag, coldfire_sha256: os.coldfire_sha256, dsp2_sha256: os.dsp2_sha256, dsp1_sha256: os.dsp1_sha256 },
           swaps, sources, noTrim, trim: { mode: t.mode, db: t.db, cap: t.cap }, models: o.models.map(String), layout, uw: o.uw ?? layout?.uw,
           ...(mc ? { midiChroma: { channel: mc.channel } } : {}),
           ...(o.unmute_fix === false ? { unmuteFix: false as const } : {}),
           ...(o.pitch_labels === true ? { pitchLabels: true as const } : {}) };
}
