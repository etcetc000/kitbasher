// Byte helpers shared by the engine. Everything the engine touches is big-endian ColdFire
// longwords or little-endian 24-bit DSP words.

export function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

export function be32(v: number): Uint8Array {
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

export function be16(v: number): Uint8Array {
  return Uint8Array.of((v >>> 8) & 0xff, v & 0xff);
}

export function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function sum32(b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s = (s + b[i]) >>> 0;
  return s;
}

/** A growable byte buffer, modelled on Python's bytearray. */
export class Buf {
  private data = new Uint8Array(1 << 16);
  length = 0;

  push(...parts: (Uint8Array | number[])[]): this {
    for (const p of parts) {
      this.reserve(this.length + p.length);
      this.data.set(p, this.length);
      this.length += p.length;
    }
    return this;
  }

  fill(value: number, n: number): this {
    this.reserve(this.length + n);
    this.data.fill(value, this.length, this.length + n);
    this.length += n;
    return this;
  }

  /** pad with `value` until length is a multiple of `n` */
  align(n: number, value: number): this {
    while (this.length % n) this.fill(value, 1);
    return this;
  }

  set(at: number, p: Uint8Array): void {
    if (at + p.length > this.length) throw new Error('Buf.set past the end');
    this.data.set(p, at);
  }

  slice(a = 0, b = this.length): Uint8Array {
    return this.data.slice(a, b);
  }

  bytes(): Uint8Array {
    return this.data.slice(0, this.length);
  }

  private reserve(n: number): void {
    if (n <= this.data.length) return;
    let cap = this.data.length;
    while (cap < n) cap *= 2;
    const d = new Uint8Array(cap);
    d.set(this.data.subarray(0, this.length));
    this.data = d;
  }
}

export async function sha256(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function wordsLE(b: Uint8Array): number[] {
  if (b.length % 3) throw new Error('DSP data is not whole 24-bit words');
  const out = new Array<number>(b.length / 3);
  for (let i = 0, j = 0; i < b.length; i += 3, j++) out[j] = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  return out;
}

export function fromWordsLE(w: number[]): Uint8Array {
  const out = new Uint8Array(w.length * 3);
  for (let i = 0, j = 0; i < w.length; i++, j += 3) {
    const v = w[i] & 0xffffff;
    out[j] = v & 0xff; out[j + 1] = (v >> 8) & 0xff; out[j + 2] = (v >> 16) & 0xff;
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const h = (v: number): string => '0x' + v.toString(16);

/** "0x1234" or a number -> number */
export const num = (v: string | number): number => (typeof v === 'number' ? v : parseInt(v, 16));
