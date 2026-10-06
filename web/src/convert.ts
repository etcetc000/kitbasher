// Turning a user's audio file into E12 sample data: decode (WAV, AIFF or whatever the browser's
// decoder reads), resample to 44.1 kHz, mix to mono, optionally trim leading and trailing silence
// and normalise, cut to the entry's stock length with a short fade, then quantise to 12 bits with
// TPDF dither. Everything runs in the browser; `processAudio` is the pure part (tested in
// ci/convert.test.mjs) and has no imports so the test can load it alone.

export const SAMPLE_RATE = 44100;
export const FULL_12 = 2047;
/** samples of linear fade where a sample is cut to the cap */
export const CUT_FADE = 256;
/** leading and trailing audio quieter than this, relative to the peak, counts as silence */
export const SILENCE_DB = -60;

export interface ConvertOptions { normalise: boolean; trimSilence: boolean }

export interface Converted {
  data: Int16Array;              // 12-bit values, -2048..2047
  notes: string[];               // what was done, in words for the page
  cut: boolean;                  // longer than the cap: cut to it
  seconds: number;
}

const db = (v: number): string => `${(20 * Math.log10(v)).toFixed(1)} dB`;
const ms = (n: number, rate: number): string => { const v = (1000 * n) / rate; return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`; };

/**
 * channels: the decoded audio at 44.1 kHz, one Float32Array per channel (-1..1).
 * cap: the entry's stock length in samples. random: a source of uniform [0, 1) numbers.
 */
export function processAudio(channels: Float32Array[], cap: number, opt: ConvertOptions, random: () => number = Math.random): Converted {
  const notes: string[] = [];
  if (!channels.length || !channels[0].length) throw new Error('the file has no audio');
  const n = channels[0].length;
  let x = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) x[i] += c[i] / channels.length;
  if (channels.length > 1) notes.push(`${channels.length} channels mixed to mono`);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error('the file is silent');
  if (opt.trimSilence) {
    const floor = peak * Math.pow(10, SILENCE_DB / 20);
    let a = 0, b = x.length;
    while (a < b && Math.abs(x[a]) < floor) a++;
    while (b > a && Math.abs(x[b - 1]) < floor) b--;
    if (a > 0 || b < x.length) {
      // a few samples under the floor at the very end are not worth a line in the report
      if (a + x.length - b >= SAMPLE_RATE / 1000) {
        notes.push(`silence trimmed: ${ms(a, SAMPLE_RATE)} at the start, ${ms(x.length - b, SAMPLE_RATE)} at the end`);
      }
      x = x.slice(a, b);
    }
  }
  let gain = 1;
  if (opt.normalise) {
    gain = (FULL_12 - 1) / FULL_12 / peak;        // one step of headroom for the dither
    if (Math.abs(gain - 1) > 1e-6) notes.push(`normalised (${gain > 1 ? '+' : ''}${db(gain)})`);
  }
  let cut = false;
  if (x.length > cap) {
    notes.push(`cut from ${(x.length / SAMPLE_RATE).toFixed(3)} s to ${(cap / SAMPLE_RATE).toFixed(3)} s, the stock sample's length, with a ${ms(Math.min(CUT_FADE, cap), SAMPLE_RATE)} fade`);
    x = x.slice(0, cap);
    const f = Math.min(CUT_FADE, cap);
    for (let k = 0; k < f; k++) x[cap - f + k] *= 1 - (k + 1) / f;
    cut = true;
  }
  const out = new Int16Array(x.length);
  let clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.round(x[i] * gain * FULL_12 + (random() - random()));
    out[i] = Math.max(-2048, Math.min(FULL_12, v));
    if (out[i] !== v) clipped++;
  }
  if (clipped) notes.push(`${clipped} sample${clipped === 1 ? '' : 's'} clipped`);
  notes.push('quantised to 12 bits with TPDF dither');
  return { data: out, notes, cut, seconds: out.length / SAMPLE_RATE };
}

/** The source's own sample rate, from a WAV 'fmt ' or AIFF 'COMM' chunk; null when not found. */
export function headerRate(b: Uint8Array): number | null {
  const tag = (o: number): string => String.fromCharCode(...b.subarray(o, o + 4));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    for (let o = 12; o + 8 <= b.length;) {
      const size = dv.getUint32(o + 4, true);
      if (tag(o) === 'fmt ' && o + 16 <= b.length) return dv.getUint32(o + 12, true);
      o += 8 + size + (size & 1);
    }
  }
  if (b.length >= 12 && tag(0) === 'FORM' && (tag(8) === 'AIFF' || tag(8) === 'AIFC')) {
    for (let o = 12; o + 8 <= b.length;) {
      const size = dv.getUint32(o + 4, false);
      if (tag(o) === 'COMM' && o + 26 <= b.length) {
        // 80-bit IEEE extended: sign+exponent (15 bits), then a 64-bit mantissa with explicit integer bit
        const e = dv.getUint16(o + 16, false) & 0x7fff;
        const hi = dv.getUint32(o + 18, false), lo = dv.getUint32(o + 22, false);
        return Math.round((hi * 2 ** 32 + lo) * Math.pow(2, e - 16383 - 63));
      }
      o += 8 + size + (size & 1);
    }
  }
  return null;
}

/** Decode a file in the browser and convert it for an entry whose stock length is `cap` samples. */
export async function convertFile(file: File, cap: number, opt: ConvertOptions): Promise<Converted> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const rate = headerRate(bytes);
  // decoding in a 44.1 kHz context resamples to it
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let buf: AudioBuffer;
  try { buf = await ctx.decodeAudioData(bytes.slice().buffer); }
  catch { throw new Error(`${file.name}: this browser cannot decode it (use WAV or AIFF)`); }
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const r = processAudio(channels, cap, opt);
  if (rate && rate !== SAMPLE_RATE) r.notes.unshift(`resampled from ${rate} Hz to 44.1 kHz`);
  return r;
}

/** Play 12-bit data through the speakers; returns a function that stops it. */
let playing: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null;
export function play(data: Int16Array, onEnd?: () => void): () => void {
  stopPlaying();
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, Math.max(1, data.length), SAMPLE_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) ch[i] = data[i] / 2048;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => { if (playing?.src === src) { playing = null; void ctx.close(); } onEnd?.(); };
  src.start();
  playing = { ctx, src };
  return stopPlaying;
}
export function stopPlaying(): void {
  if (!playing) return;
  const p = playing;
  playing = null;
  try { p.src.stop(); } catch { /* already stopped */ }
  void p.ctx.close();
}
