// Machinedrum OS update SysEx <-> OS container (the flash bytes from 0x4000). The encoder
// reproduces the X.13 OS update file byte for byte: packets F0 00 20 3C 02 00 7E, checksum
// (2 nibbles), flash counter (6 nibbles), 64 data bytes packed 2+7+7 bits per 16-bit word; then an
// empty data message and the end message (7F) with the container length. No trailing newline: at least one Windows SysEx utility rejects a file with one.

import { Buf } from './bytes.js';

export const OS_START = 0x4000;
export const OS_LIMIT = 0x100000;
const HDR = [0xf0, 0x00, 0x20, 0x3c, 0x02, 0x00];

const nib = (v: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (v >>> (4 * (n - 1 - i))) & 0xf);

export function encodeSyx(container: Uint8Array): Uint8Array {
  if (container.length % 2) throw new Error('container must hold whole 16-bit words');
  const out = new Buf();
  for (let off = 0; off < container.length; off += 64) {
    const chunk = container.subarray(off, off + 64);
    const counter = OS_START + off;
    let s = ((counter >>> 16) & 0xff) + ((counter >>> 8) & 0xff) + (counter & 0xff);
    for (const b of chunk) s += b;
    const payload: number[] = [];
    for (let k = 0; k < chunk.length; k += 2) {
      const w = (chunk[k] << 8) | chunk[k + 1];
      payload.push((w >> 14) & 3, (w >> 7) & 0x7f, w & 0x7f);
    }
    out.push(HDR, [0x7e], nib(s & 0xff, 2), nib(counter, 6), payload, [0xf7]);
  }
  out.push(HDR, [0x7e, 0xf7]);
  out.push(HDR, [0x7f], nib(container.length, 6), [0xf7]);
  return out.bytes();
}

export function decodeSyx(syx: Uint8Array): Uint8Array {
  const data = new Buf();
  let i = 0;
  let expect = OS_START;
  let total: number | null = null;
  const hexval = (b: Uint8Array): number => parseInt(Array.from(b, (v) => v.toString(16)).join(''), 16);
  for (;;) {
    i = syx.indexOf(0xf0, i);
    if (i < 0) break;
    const j = syx.indexOf(0xf7, i);
    if (j < 0) throw new Error('unterminated SysEx message');
    const body = syx.subarray(i + 1, j);
    i = j + 1;
    for (let k = 0; k < 5; k++) if (body[k] !== HDR[k + 1]) throw new Error('not a Machinedrum OS update packet');
    if (body[5] === 0x7f) {
      total = hexval(body.subarray(6, 12));
    } else if (body[5] === 0x7e && body.length > 14) {
      const counter = hexval(body.subarray(8, 14));
      if (counter !== expect) throw new Error(`gap in the OS update at ${expect.toString(16)}`);
      const p = body.subarray(14);
      const chunk: number[] = [];
      for (let k = 0; k < p.length; k += 3) {
        const w = ((p[k] & 3) << 14) | ((p[k + 1] & 0x7f) << 7) | (p[k + 2] & 0x7f);
        chunk.push(w >> 8, w & 0xff);
      }
      let s = ((counter >>> 16) & 0xff) + ((counter >>> 8) & 0xff) + (counter & 0xff);
      for (const b of chunk) s += b;
      if (body[6] !== ((s >> 4) & 0xf) || body[7] !== (s & 0xf)) throw new Error(`checksum error at ${counter.toString(16)}`);
      data.push(chunk);
      expect += chunk.length;
    }
  }
  if (total !== data.length) throw new Error('the end message does not match the data length');
  return data.bytes();
}

/** The container an update carries: flash 0x4000 up to the last non-FF byte below 1 MiB, even. */
export function containerOf(flash: Uint8Array): Uint8Array {
  let end = OS_LIMIT;
  while (flash[end - 1] === 0xff) end--;
  end += (end - OS_START) % 2;
  return flash.slice(OS_START, end);
}
