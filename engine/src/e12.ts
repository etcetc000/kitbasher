// The E12 sample bank: 21 samples of 12-bit audio, two per 24-bit word, addressed only through the
// table at 0x103d7b (start, length in samples = 2 * words + 34, 0), each followed by 153 silent
// words. Trimming a long sample's tail frees DSP2 memory for machines. The arithmetic matches a NumPy
// reference implementation (float64 throughout, round half to even), so a given trim setting
// always produces the same words.

export const PAD = 153;
export const LEN_EXTRA = 34;
export const SR = 44100;

export interface TrimOptions {
  db: number;          // cut where the rest of the sample stays below this, dB re its peak
  minSeconds: number;  // only samples at least this long are trimmed
  cap: number | null;  // and cut to at most this many seconds
  fade?: number;       // samples of linear fade at the cut
  pairs?: boolean;     // pair-aware trim (default on): see e12Pairs
}

export interface TrimEntry {
  entry: number; seconds: number; kept: number; words: number; new_words: number;
  /** shortened to this first sample's kept length (the pair rule) */
  for_partner?: number;
  /** a first sample padded with silence to this partner's length (see trimBank) */
  padded_for?: number;
}

/**
 * The E12 machines that play two samples at once (a body and a ring/noise layer) load them as a
 * pair of table entries: `move #>entry2,r1` / `move #>entry1,r0`. Their render advances one
 * position for both, stops it at the first sample's length (and parks it there, re-reading the
 * same 34-word window every block), and reads the second sample while position < its length.
 * Stock never notices: every first sample is longer than its partner. Trim a first sample below
 * its partner and the parked position stays inside the partner, so the partner's window repeats
 * every 32-sample block - a pitched tone at 44100/32 = 1378 Hz and harmonics that follows the
 * amp envelope (E12-SD's long DEC tail). Returns [first, second] entry pairs found in the code.
 */
export function e12Pairs(seg: number[], segBase: number, table: number, count: number): [number, number][] {
  const inTable = (v: number): boolean => v >= table && v < table + 3 * count && (v - table) % 3 === 0;
  const pairs: [number, number][] = [];
  const codeEnd = table - segBase;
  for (let i = 0; i + 3 < codeEnd && i + 3 < seg.length; i++) {
    if (seg[i] === 0x61f400 && inTable(seg[i + 1]) && seg[i + 2] === 0x60f400 && inTable(seg[i + 3])) {
      pairs.push([(seg[i + 3] - table) / 3, (seg[i + 1] - table) / 3]);
    }
  }
  return pairs;
}

/** The 12-bit samples of packed bank words, two per word (high half first), as signed values. */
export function unpack12(ws: ArrayLike<number>): number[] {
  const x = new Array<number>(2 * ws.length);
  for (let i = 0; i < ws.length; i++) {
    const hi = (ws[i] >> 12) & 0xfff;
    const lo = ws[i] & 0xfff;
    x[2 * i] = hi >= 2048 ? hi - 4096 : hi;
    x[2 * i + 1] = lo >= 2048 ? lo - 4096 : lo;
  }
  return x;
}

/** Two 12-bit samples per word, high half first; an odd count gets one silent sample. */
export function pack12(x: ArrayLike<number>): number[] {
  x = Array.from(x);
  const y = x.length % 2 ? [...(x as number[]), 0] : x as number[];
  const out: number[] = [];
  for (let i = 0; i < y.length; i += 2) out.push(((y[i] & 0xfff) << 12) | (y[i + 1] & 0xfff));
  return out;
}

export function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's round(x, 3) for a report; exactness does not matter here. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * seg: the P words of the bank's upload record, starting at `segBase`.
 * Returns the new words, a report, and where the bank now ends.
 *
 * `noTrim`: entries left whole whatever the options say (a swapped sample the user wants kept as
 * is); the pair rule does not shorten them either. With pairs on, a first sample that ends up
 * shorter than its partner -- possible only when one of them was swapped (stock firsts are all
 * longer) or the partner is kept whole -- is padded with silence to the partner's length rather
 * than cutting the partner: the partner is what the user hears, the padding only costs words, and
 * a swapped first is never longer than its stock entry, which is longer than the partner's.
 */
export function trimBank(seg: number[], segBase: number, table: number, count: number, bankEnd: number,
  opt: TrimOptions, noTrim: ReadonlySet<number> = new Set()): { words: number[]; report: TrimEntry[]; end: number } {
  const fade = opt.fade ?? 256;
  const at = (a: number): number => a - segBase;
  const entries = Array.from({ length: count }, (_, i) => [seg[at(table + 3 * i)], seg[at(table + 3 * i + 1)], seg[at(table + 3 * i + 2)]]);
  const starts = entries.map((e) => e[0]);
  for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1]) throw new Error('E12 table is not in address order');
  if (starts[0] !== table + 3 * count) throw new Error('E12 samples do not start after the table');
  const ends = [...starts.slice(1), bankEnd];
  const out = seg.slice(0, at(starts[0]));
  const report: TrimEntry[] = [];
  let pos = starts[0];
  const thr = Math.pow(10, opt.db / 20);
  const xs: number[][] = [];
  const keeps: number[] = [];
  for (let i = 0; i < count; i++) {
    const [st, ln, z] = entries[i];
    const nw = ends[i] - st - PAD;
    if (ln !== 2 * nw + LEN_EXTRA || z !== 0) throw new Error(`E12 entry ${i}: unexpected length ${ln} for ${nw} words`);
    for (let a = st + nw; a < ends[i]; a++) if (seg[at(a)] !== 0) throw new Error(`E12 entry ${i}: pad not silent`);
    const x = unpack12(seg.slice(at(st), at(st + nw)));
    const n = x.length;
    let keep = n;
    if (!noTrim.has(i) && n / SR >= opt.minSeconds) {
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      const limit = peak * thr;
      // first index from which every |x| stays below the limit
      let q = n;
      for (let k = n - 1; k >= 0; k--) {
        if (Math.abs(x[k]) < limit) q = k;
        else break;
      }
      if (q < n) keep = Math.min(n, q + fade);
      if (opt.cap) keep = Math.min(keep, Math.max(Math.trunc(opt.cap * SR), fade));
    }
    xs.push(x);
    keeps.push(keep);
  }
  // Where the bank would end without the pair rule: the rule only shortens partners, so the
  // freed words are padded back at the end and nothing placed after the bank moves.
  const wordsOf = (k: number): number => Math.ceil(k / 2);
  const plainEnd = starts[0] + keeps.reduce((n, k) => n + wordsOf(k) + PAD, 0);
  const forPartner: (number | undefined)[] = new Array(count).fill(undefined);
  const padTo: number[] = new Array(count).fill(0);
  const paddedFor: (number | undefined)[] = new Array(count).fill(undefined);
  if (opt.pairs !== false) {
    const pairs = e12Pairs(seg, segBase, table, count);
    for (let changed = true; changed;) {
      changed = false;
      for (const [a, b] of pairs) {
        if (keeps[a] >= xs[a].length) continue;               // first sample untrimmed: stock behaviour
        if (noTrim.has(b)) continue;                          // kept whole: the first is padded below
        if (wordsOf(keeps[b]) > wordsOf(keeps[a])) { keeps[b] = keeps[a]; forPartner[b] = a; changed = true; }
      }
    }
    for (const [a, b] of pairs) {
      if (wordsOf(keeps[b]) > wordsOf(Math.max(keeps[a], padTo[a]))) { padTo[a] = 2 * wordsOf(keeps[b]); paddedFor[a] = b; }
    }
  }
  for (let i = 0; i < count; i++) {
    const x = xs[i], n = x.length, keep = keeps[i], nw = n / 2;
    const y = x.slice(0, keep);
    if (keep < n) {
      const f = Math.min(fade, keep);
      const step = -1 / f;                          // numpy.linspace(1, 0, f, endpoint=False)
      for (let k = 0; k < f; k++) {
        const j = keep - f + k;
        y[j] = roundHalfEven(y[j] * (k * step + 1));
      }
    }
    while (y.length < padTo[i]) y.push(0);
    const nwords = pack12(y);
    out[at(table + 3 * i)] = pos;
    out[at(table + 3 * i + 1)] = 2 * nwords.length + LEN_EXTRA;
    for (const w of nwords) out.push(w);
    for (let k = 0; k < PAD; k++) out.push(0);
    const row: TrimEntry = { entry: i, seconds: r3(n / SR), kept: r3(y.length / SR), words: nw, new_words: nwords.length };
    if (forPartner[i] !== undefined) row.for_partner = forPartner[i];
    if (paddedFor[i] !== undefined) row.padded_for = paddedFor[i];
    report.push(row);
    pos += nwords.length + PAD;
  }
  while (pos < plainEnd) { out.push(0); pos++; }
  if (out.length !== at(pos)) throw new Error('E12 trim: length bookkeeping');
  return { words: out, report, end: pos };
}
