// E12B: the flash file system OS X.20 keeps its E12 (INTERNAL) sample bank in, at flash
// 0x90000..0xf0000, and the sample codec its DSP2 boot stage decodes it with. X.20's loader lays the
// bank out in DSP2 from this directory at every boot, as 1.63 lays out its uploaded bank: 21
// samples from P:0x103dba, each followed by 153 silent words, the table at 0x103d7b.
//
// Sector (64 KiB; physical sectors 0..5 at 0x90000 + 0x10000 k):
//   +0x00 'E12B'  +0x04 u16 version (1)  +0x06 u16 logical sector (0..4)
//   +0x08 u32 generation (the newest copy of a logical sector wins)  +0x0c u32 limit (end of data)
//   +0x10 u32 CRC-32 of the directory (+0x20..+0x4b8)  +0x14 u32 CRC-32 of +0x00..+0x14
//   +0x18 u32 0xc0dec0de  +0x1c u32 0
//   +0x20 the directory: 21 entries of 0x38 bytes (every sector carries a full copy)
//   +0x4b8 sample data
// Entry: u32 samples, u32 bytes, u32 CRC-32 of the decoded words, u32 CRC-32 of the coded bytes,
//   char name[4], u16 state (1 used, 2 empty), u16 0, 5 x {u16 logical sector, u16 offset, u16 size}, u16 0.
//
// Codec: an MSB-first bit stream of blocks of up to 128 samples, each block byte aligned. Header
// byte h: 0xf0 raw (12 bits a sample), 0xf1 constant (one 12-bit value), otherwise
// h = (order << 4) | k, order 0..2 and k 0..11: per sample a unary q (zeros, then a one), k bits r,
// v = (q << k) | r, e = v >> 1 (~e when v is odd), x = (e + pred) & 0xfff with pred 0, p1 or
// 2 p1 - p2. A block's bits, header included, are at most 0x608. p1 and p2 carry across blocks.
// Samples are 12-bit; the decoder packs two per 24-bit DSP word, the first in the high half.
//
// The encoder reproduces the stock bank byte for byte (engine/test/e12b.test.ts checks it against
// an X.20 file when one is given): a constant block is always 0xf1; otherwise the fewest bits wins,
// ties going to raw, then order 0 with k 0..11, then order 1, then order 2.

export const E12B_FLASH = 0x90000;
export const E12B_END = 0xf0000;
export const SECTORS = 6;                 // physical
export const LOGICAL = 5;                 // the loader needs all five logical sectors present
export const SECTOR_SIZE = 0x10000;
export const HEADER = 0x4b8;
export const ENTRIES = 21;
export const ENTRY_SIZE = 0x38;
/** silent words after each sample in DSP2, beyond its own (samples - 2 * words) */
export const PAD_WORDS = 0x88;
const MAGIC = 0xc0dec0de;
const BLOCK = 128;
const MAX_BLOCK_BITS = 0x608;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const put16 = (b: Uint8Array, o: number, v: number): void => { b[o] = (v >>> 8) & 0xff; b[o + 1] = v & 0xff; };
const put32 = (b: Uint8Array, o: number, v: number): void => { put16(b, o, v >>> 16); put16(b, o + 2, v & 0xffff); };

export interface Fragment { sector: number; offset: number; size: number }
export interface Entry {
  samples: number; bytes: number; crcOut: number; crcIn: number;
  name: Uint8Array; state: number; fragments: Fragment[];
}
export interface Sector { phys: number; id: number; gen: number; limit: number; ok: boolean; raw: Uint8Array }

/** The six physical sectors of an E12B area (`area`: flash 0x90000..0xf0000), null where erased or not E12B. */
export function sectors(area: Uint8Array): (Sector | null)[] {
  if (area.length !== SECTORS * SECTOR_SIZE) throw new Error(`E12B area is ${area.length} bytes, expected ${SECTORS * SECTOR_SIZE}`);
  const out: (Sector | null)[] = [];
  for (let k = 0; k < SECTORS; k++) {
    const s = area.subarray(k * SECTOR_SIZE, (k + 1) * SECTOR_SIZE);
    if (String.fromCharCode(...s.subarray(0, 4)) !== 'E12B') { out.push(null); continue; }
    const limit = u32(s, 0xc);
    const ok = u16(s, 4) === 1 && u16(s, 6) < LOGICAL && u32(s, 8) !== 0 && u32(s, 0x1c) === 0 && u32(s, 0x18) === MAGIC &&
      limit >= HEADER && limit <= SECTOR_SIZE && crc32(s.subarray(0, 0x14)) === u32(s, 0x14) &&
      crc32(s.subarray(0x20, HEADER)) === u32(s, 0x10);
    out.push({ phys: k, id: u16(s, 6), gen: u32(s, 8), limit, ok, raw: s });
  }
  return out;
}

function parseEntry(b: Uint8Array, o: number): Entry {
  const fragments: Fragment[] = [];
  for (let i = 0; i < 5; i++) {
    const f = { sector: u16(b, o + 24 + 6 * i), offset: u16(b, o + 26 + 6 * i), size: u16(b, o + 28 + 6 * i) };
    if (f.size) fragments.push(f);
  }
  return { samples: u32(b, o), bytes: u32(b, o + 4), crcOut: u32(b, o + 8), crcIn: u32(b, o + 12),
    name: b.slice(o + 16, o + 20), state: u16(b, o + 20), fragments };
}

export interface Directory { entries: Entry[]; logical: Map<number, Sector> }

/** The newest valid directory, and the newest copy of each logical sector. */
export function directory(area: Uint8Array): Directory {
  const ok = sectors(area).filter((s): s is Sector => !!s && s.ok);
  if (!ok.length) throw new Error('no valid E12B sector');
  const best = ok.reduce((a, b) => (b.gen > a.gen ? b : a));
  const entries = Array.from({ length: ENTRIES }, (_, i) => parseEntry(best.raw, 0x20 + i * ENTRY_SIZE));
  const logical = new Map<number, Sector>();
  for (const s of ok) if (!logical.has(s.id) || s.gen > logical.get(s.id)!.gen) logical.set(s.id, s);
  return { entries, logical };
}

/** An entry's coded bytes, gathered from its fragments. */
export function entryBytes(e: Entry, d: Directory): Uint8Array {
  const out = new Uint8Array(e.fragments.reduce((n, f) => n + f.size, 0));
  let p = 0;
  for (const f of e.fragments) {
    const s = d.logical.get(f.sector);
    if (!s) throw new Error(`E12B: logical sector ${f.sector} is missing`);
    if (f.offset + f.size > SECTOR_SIZE) throw new Error('E12B: fragment past its sector');
    out.set(s.raw.subarray(f.offset, f.offset + f.size), p);
    p += f.size;
  }
  return out;
}

// ---- codec ------------------------------------------------------------------------------------

/** Decode `n` 12-bit samples (0..4095). Throws on anything the DSP2 decoder would not accept. */
export function decode(data: Uint8Array, n: number): number[] {
  let pos = 0;
  const bit = (): number => {
    if (pos >> 3 >= data.length) throw new Error('E12B: coded sample runs past its data');
    const v = (data[pos >> 3] >> (7 - (pos & 7))) & 1;
    pos++;
    return v;
  };
  const bits = (k: number): number => { let v = 0; for (let i = 0; i < k; i++) v = (v << 1) | bit(); return v; };
  const out: number[] = [];
  let p1 = 0, p2 = 0;
  for (let left = n; left > 0;) {
    const start = pos;
    const h = bits(8);
    const cnt = Math.min(left, BLOCK);
    let c = 0, order = 0, k = 0;
    if (h === 0xf1) c = bits(12);
    else if (h !== 0xf0) {
      order = h >> 4; k = h & 15;
      if (order > 2 || k > 11) throw new Error(`E12B: block header ${h.toString(16)}`);
    }
    for (let i = 0; i < cnt; i++) {
      let x: number;
      if (h === 0xf1) x = c;
      else if (h === 0xf0) x = bits(12);
      else {
        let q = 0;
        while (bit() === 0) { q++; if ((q << k) > 0xfff) throw new Error('E12B: unary code too long'); }
        const v = (q << k) | bits(k);
        let e = v >> 1;
        if (v & 1) e = ~e;
        const pred = order === 0 ? 0 : order === 1 ? p1 : 2 * p1 - p2;
        x = (e + pred) & 0xfff;
      }
      p2 = p1; p1 = x;
      out.push(x);
    }
    if (pos - start > MAX_BLOCK_BITS) throw new Error('E12B: block longer than 0x608 bits');
    while (pos & 7) if (bit()) throw new Error('E12B: block padding not zero');
    left -= cnt;
  }
  if (pos !== 8 * data.length) throw new Error('E12B: coded data longer than its samples');
  return out;
}

const s12 = (v: number): number => { v &= 0xfff; return v >= 2048 ? v - 4096 : v; };
const zig = (e: number): number => (e >= 0 ? 2 * e : -2 * e - 1);

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  put(v: number, k: number): void {
    for (let i = k - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((v >> i) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  zeros(k: number): void { for (let i = 0; i < k; i++) this.put(0, 1); }
  align(): void { while (this.n) this.put(0, 1); }
  out(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** Code 12-bit samples (0..4095) as the stock encoder does. */
export function encode(x: ArrayLike<number>): Uint8Array {
  const w = new BitWriter();
  let p1 = 0, p2 = 0;
  for (let i = 0; i < x.length; i += BLOCK) {
    const block = Array.from({ length: Math.min(BLOCK, x.length - i) }, (_, j) => x[i + j] & 0xfff);
    if (block.every((v) => v === block[0])) {
      w.put(0xf1, 8); w.put(block[0], 12);
    } else {
      let best = { bits: 8 + 12 * block.length, order: -1, k: 0, vs: [] as number[] };
      for (let order = 0; order < 3; order++) {
        let q1 = p1, q2 = p2;
        const vs = block.map((v) => {
          const pred = order === 0 ? 0 : order === 1 ? q1 : 2 * q1 - q2;
          q2 = q1; q1 = v;
          return zig(s12(v - pred));
        });
        for (let k = 0; k < 12; k++) {
          let bits = 8, ok = true;
          for (const v of vs) {
            const q = v >> k;
            if ((q << k) > 0xfff) { ok = false; break; }
            bits += q + 1 + k;
          }
          if (ok && bits <= MAX_BLOCK_BITS && bits < best.bits) best = { bits, order, k, vs };
        }
      }
      if (best.order < 0) {
        w.put(0xf0, 8);
        for (const v of block) w.put(v, 12);
      } else {
        w.put((best.order << 4) | best.k, 8);
        for (const v of best.vs) { w.zeros(v >> best.k); w.put(1, 1); w.put(v & ((1 << best.k) - 1), best.k); }
      }
    }
    w.align();
    if (block.length > 1) p2 = block[block.length - 2];
    p1 = block[block.length - 1];
  }
  return w.out();
}

/** Two 12-bit samples per 24-bit word, the first in the high half; an odd count ends on a silent half. */
export function packWords(x: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i += 2) out.push(((x[i] & 0xfff) << 12) | (i + 1 < x.length ? x[i + 1] & 0xfff : 0));
  return out;
}

const wordBytes = (ws: number[]): Uint8Array => {
  const b = new Uint8Array(3 * ws.length);
  ws.forEach((v, i) => { b[3 * i] = (v >> 16) & 0xff; b[3 * i + 1] = (v >> 8) & 0xff; b[3 * i + 2] = v & 0xff; });
  return b;
};

/** Every entry's samples (null for an empty slot), from an E12B area; checked against the entry's CRCs. */
export function readBank(area: Uint8Array): { names: Uint8Array[]; samples: (number[] | null)[]; directory: Directory } {
  const d = directory(area);
  const samples = d.entries.map((e, i) => {
    if (e.state !== 1) return null;
    const data = entryBytes(e, d);
    if (data.length !== e.bytes || crc32(data) !== e.crcIn) throw new Error(`E12B entry ${i}: coded data CRC`);
    const x = decode(data, e.samples);
    if (crc32(wordBytes(packWords(x))) !== e.crcOut) throw new Error(`E12B entry ${i}: decoded samples CRC`);
    return x;
  });
  return { names: d.entries.map((e) => e.name), samples, directory: d };
}

export interface Bank {
  /** flash 0x90000..0xf0000 */
  area: Uint8Array;
  entries: Entry[];
  /** sectors holding sample data, and where the data ends in the last of them */
  used: number; end: number;
  /** DSP2 words the bank takes from the first sample on (samples and their silent pads) */
  words: number;
}

/**
 * Lay a bank out as the stock image is laid out: the samples in entry order from logical sector 0
 * offset 0x4b8, split at sector ends, each start rounded up to even; logical sector k in physical
 * sector k with generation genBase + k; the last data sector's limit at its data end, the sectors
 * after it header-only (the loader needs all five); physical sector 5 and every unused byte erased.
 */
export function buildBank(samples: (number[] | null)[], names: Uint8Array[], genBase = 1): Bank {
  if (samples.length !== ENTRIES || names.length !== ENTRIES) throw new Error(`E12B: ${ENTRIES} entries expected`);
  const entries: Entry[] = [];
  const blobs: Uint8Array[] = [];
  let sec = 0, off = HEADER, words = 0;
  samples.forEach((x, i) => {
    if (!x) {
      entries.push({ samples: 0, bytes: 0, crcOut: 0, crcIn: 0, name: names[i], state: 2, fragments: [] });
      blobs.push(new Uint8Array(0));
      return;
    }
    const data = encode(x);
    words += Math.ceil(x.length / 2) + PAD_WORDS;
    const e: Entry = { samples: x.length, bytes: data.length, crcIn: crc32(data), crcOut: crc32(wordBytes(packWords(x))),
      name: names[i], state: 1, fragments: [] };
    off += off & 1;
    for (let left = data.length; left;) {
      if (off >= SECTOR_SIZE) { sec++; off = HEADER; }
      const take = Math.min(left, SECTOR_SIZE - off);
      e.fragments.push({ sector: sec, offset: off, size: take });
      off += take;
      left -= take;
    }
    if (sec >= LOGICAL || e.fragments.length > 5) throw new Error('E12B: the bank does not fit its flash');
    entries.push(e);
    blobs.push(data);
  });
  const used = sec + 1;
  const dir = new Uint8Array(HEADER - 0x20);
  entries.forEach((e, i) => {
    const o = i * ENTRY_SIZE;
    put32(dir, o, e.samples); put32(dir, o + 4, e.bytes); put32(dir, o + 8, e.crcOut); put32(dir, o + 12, e.crcIn);
    dir.set(e.name.subarray(0, 4), o + 16);
    put16(dir, o + 20, e.state);
    e.fragments.forEach((f, k) => { put16(dir, o + 24 + 6 * k, f.sector); put16(dir, o + 26 + 6 * k, f.offset); put16(dir, o + 28 + 6 * k, f.size); });
  });
  const dirCrc = crc32(dir);
  const area = new Uint8Array(SECTORS * SECTOR_SIZE).fill(0xff);
  for (let k = 0; k < Math.max(used, LOGICAL); k++) {
    const h = new Uint8Array(0x20);
    h.set([0x45, 0x31, 0x32, 0x42]);
    put16(h, 4, 1); put16(h, 6, k); put32(h, 8, genBase + k);
    put32(h, 0xc, k < used - 1 ? SECTOR_SIZE : k === used - 1 ? off : HEADER);
    put32(h, 0x10, dirCrc);
    put32(h, 0x14, crc32(h.subarray(0, 0x14)));
    put32(h, 0x18, MAGIC);
    area.set(h, k * SECTOR_SIZE);
    area.set(dir, k * SECTOR_SIZE + 0x20);
  }
  entries.forEach((e, i) => {
    let p = 0;
    for (const f of e.fragments) { area.set(blobs[i].subarray(p, p + f.size), f.sector * SECTOR_SIZE + f.offset); p += f.size; }
  });
  return { area, entries, used, end: off, words };
}

/**
 * Flash the bank leaves free, as [lo, hi) flash addresses: from its data end (even) to the top of
 * the area, less the header (and directory) of each logical sector after it. Physical sector 5,
 * the file system's spare, is free too: the build refuses the OS's own erase and program of E12B.
 */
export function freeFlash(b: Bank): [number, number][] {
  const usedEnd = E12B_FLASH + (b.used - 1) * SECTOR_SIZE + b.end;
  const out: [number, number][] = [];
  let a = (usedEnd + 1) & ~1;
  if ((a - E12B_FLASH) % SECTOR_SIZE === 0 && (a - E12B_FLASH) / SECTOR_SIZE < LOGICAL) a += HEADER;   // data ended on a boundary
  for (let k = 1; k <= SECTORS; k++) {
    const s = E12B_FLASH + k * SECTOR_SIZE;
    if (s <= a) continue;
    if (s > a) out.push([a, s]);
    a = s + (k < LOGICAL ? HEADER : 0);
  }
  const merged: [number, number][] = [];
  for (const [lo, hi] of out) {
    if (merged.length && merged[merged.length - 1][1] === lo) merged[merged.length - 1][1] = hi;
    else if (hi > lo) merged.push([lo, hi]);
  }
  return merged;
}
