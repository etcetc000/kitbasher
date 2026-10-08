// The OS container: three packed slots (ColdFire, DSP2, DSP1) as [length][byte sum][NRV2B stream],
// a 4-byte tag, two packed data slots, then whatever a base keeps after them (X.14's add-on).
//
// The engine works on a flash view either way: a full 8 MiB flash image (the emulator's .bin) or
// the container a .syx carries, placed at 0x4000 in an erased 1 MiB. The output has the input's
// shape.

import { u32, sum32 } from './bytes.js';
import { nrv2bDecode } from './nrv2b.js';
import { decodeSyx, OS_LIMIT, OS_START } from './syx.js';

export const SLOT_BASE = OS_START;
export { OS_LIMIT };
export const FLASH_SIZE = 0x800000;

export interface Slot {
  at: number;          // flash offset of the length word
  length: number;      // header length (the stream may be shorter: a dead tail)
  sumOk: boolean;      // DEV 26912 leaves a stale checksum; nothing on the unit checks them
  used: number;        // bytes the NRV2B stream really uses
  raw: Uint8Array;     // unpacked
}

export interface Firmware {
  kind: 'flash' | 'syx';
  flash: Uint8Array;   // 8 MiB for 'flash', 1 MiB for 'syx'
  slots: Slot[];       // ColdFire, DSP2, DSP1
  tagAt: number;
  tag: string;
  data: Slot[];        // the two data slots
  tailAt: number;      // first byte after the data slots
  osEnd: number;       // one past the last non-FF byte below 1 MiB
}

function slotAt(flash: Uint8Array, at: number): Slot {
  const length = u32(flash, at);
  const stream = flash.subarray(at + 8, at + 8 + length);
  if (at + 8 + length > OS_LIMIT) throw new Error(`slot at ${at.toString(16)} runs past 1 MiB`);
  const { out, used } = nrv2bDecode(stream);
  return { at, length, sumOk: sum32(stream) === u32(flash, at + 4), used, raw: out };
}

export function readFirmware(input: Uint8Array): Firmware {
  let kind: Firmware['kind'];
  let flash: Uint8Array;
  if (input.length === FLASH_SIZE) {
    kind = 'flash';
    flash = new Uint8Array(input);                 // a copy (a Node Buffer's slice() would share its memory)
  } else if (input[0] === 0xf0) {
    kind = 'syx';
    const container = decodeSyx(input);
    flash = new Uint8Array(OS_LIMIT).fill(0xff);
    if (OS_START + container.length > OS_LIMIT) throw new Error('OS update larger than the OS area');
    flash.set(container, OS_START);
  } else {
    throw new Error('not a Machinedrum OS update (.syx) or an 8 MiB flash image (.bin)');
  }
  return parseFlash(flash, kind);
}

/** Walk the container in a flash view (8 MiB, or the 1 MiB a .syx is placed in). */
export function parseFlash(flash: Uint8Array, kind: Firmware['kind']): Firmware {
  const slots: Slot[] = [];
  let o = SLOT_BASE;
  for (let k = 0; k < 3; k++) {
    const s = slotAt(flash, o);
    slots.push(s);
    o += 8 + s.length;
  }
  const tagAt = o;
  const tag = String.fromCharCode(...flash.subarray(o, o + 4));
  o += 4;
  const data: Slot[] = [];
  for (let k = 0; k < 2; k++) {
    const s = slotAt(flash, o);
    if (!s.sumOk) throw new Error('data slot checksum');
    data.push(s);
    o += 8 + s.length;
  }
  let osEnd = OS_LIMIT;
  while (flash[osEnd - 1] === 0xff) osEnd--;
  return { kind, flash, slots, tagAt, tag, data, tailAt: o, osEnd };
}
