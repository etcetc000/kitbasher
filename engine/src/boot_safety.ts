// Boot-phase checks are separate from ISA legality. A legal instruction can
// still fetch an unmapped flash alias or attempt an ordinary store into flash.
import {equal, hex, u32} from './bytes.js';
import {decodeLinear} from './isa.js';

function ram(at: number, size: number): boolean {
  return Number.isSafeInteger(at) && !(at & 1) && at >= 0x200000 && size > 0 && at + size <= 0x300000;
}

export function assertBootRamWrites(patches: readonly (readonly [number, number])[], sram?: {dst:number;len:number}): void {
  for (const [at] of patches) if (!ram(at, 4) && !(sram && Number.isSafeInteger(at) && !(at&1) &&
      sram.dst>=0x01000000 && sram.len>0 && sram.dst+sram.len<=0x01010000 && at>=sram.dst && at+4<=sram.dst+sram.len))
    throw new Error(`Boot patch destination 0x${at.toString(16)} is not initialized RAM; relocate flash in the output file, never by a boot-time store`);
}

/** An early initializer runs before the OS maps flash at 0x10000000.
 * Runtime callback pointers may use that alias; boot instruction fetches may not. */
export function assertEarlyInitializer(flash: Uint8Array, entry: number, size: number): void {
  if (!Number.isSafeInteger(entry) || entry & 1 || entry < 0x4000 ||
      !Number.isSafeInteger(size) || size < 2 || size & 1 || entry + size > Math.min(flash.length, 0x100000))
    throw new Error('Early initializer must enter through low flash, within the OS image');
  const code=flash.subarray(entry,entry+size), ins=decodeLinear(code,entry), starts=new Set(ins.map(i=>i.at));
  if (!equal(code.subarray(-2),hex('4e75')) || ins.some(i=>!i.ok || i.mac))
    throw new Error('Early initializer must contain only qualified ISA_A instructions and end in RTS');
  for (const i of ins) {
    const inside=i.target!==undefined && i.target>=entry && i.target<entry+size;
    if ((i.flow==='branch' || inside) && (i.target===undefined || !starts.has(i.target)))
      throw new Error('Early initializer branch leaves its instruction boundaries');
    if ((i.flow==='call' || i.flow==='jump') && !inside && (i.target===undefined || !ram(i.target,2)))
      throw new Error('Early initializer may call only initialized RAM code, never the runtime flash alias');
  }
}

/** Independently read our emitted RAM-copy/patch-list boot routine from output.
 * Reject unknown instruction shapes instead of treating arbitrary bytes as a table. */
export function readBootRamWrites(flash: Uint8Array, routine: number, sram?: {dst:number;len:number}): [number, number][] {
  const range=(at:number,n:number)=>{
    if (!Number.isSafeInteger(at) || at&1 || n<=0 || at<0x4000 || at+n>Math.min(flash.length,0x100000))
      throw new Error('Boot routine or source range leaves low OS flash');
  };
  let at=routine,copies=0;
  for (;;) {
    range(at,26);
    if (!equal(flash.subarray(at,at+2),hex('41f9')) ||
        !equal(flash.subarray(at+6,at+8),hex('43f9'))) break;
    if (++copies>2 || !equal(flash.subarray(at+12,at+14),hex('203c')) ||
        !equal(flash.subarray(at+18,at+24),hex('22d8538066fa')))
      throw new Error('Unrecognized boot RAM-copy loop');
    const src=u32(flash,at+2),dst=u32(flash,at+8),size=u32(flash,at+14)*4;
    range(src,size);
    if (!ram(dst,size)) throw new Error('Boot copy destination leaves main RAM');
    at+=24;
  }
  if (!copies || !equal(flash.subarray(at,at+2),hex('41f9')) ||
      !equal(flash.subarray(at+6,at+8),hex('203c')) ||
      !equal(flash.subarray(at+12,at+22),hex('22582298538066f84ef9')) || !ram(u32(flash,at+22),2))
    throw new Error('Unrecognized boot patch loop or OS entry');
  const src=u32(flash,at+2),count=u32(flash,at+8);
  range(src,count*8);
  const patches: [number,number][]=Array.from({length:count},(_,i)=>[u32(flash,src+i*8),u32(flash,src+i*8+4)]);
  assertBootRamWrites(patches,sram);
  return patches;
}
