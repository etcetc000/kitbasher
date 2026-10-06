// Byte signatures over the base's code, and the instruction-aware operand scan discovery uses.
//
// A signature is a string of tokens:
//   4eb9 0c81ffff      literal bytes (any even number of hex digits)
//   ....               wildcard bytes, one per two dots
//   <name>             a 4-byte capture (its address and big-endian value are returned)
//   <name:1> <name:2>  a 1- or 2-byte capture
//   @name              a mark: the address of the next byte, nothing consumed
// A signature is written from the base's own instructions with every operand that is an address
// wildcarded or captured, so it still matches when the code around it moved.

import { u32 } from './bytes.js';

/** A piece of the base's code at its run-time address: the ColdFire slot, SRAM, the add-on, scatter entries. */
export interface CodeImage { what: string; ram: number; bytes: Uint8Array }

interface Cap { name: string; at: number; size: 1 | 2 | 4 }
export interface Sig { text: string; bytes: (number | null)[]; caps: Cap[]; marks: { name: string; at: number }[] }

export interface Hit {
  at: number;                                            // run-time address of the signature's first byte
  image: string;
  caps: Record<string, { at: number; value: number }>;   // capture name -> its run-time address and value
}

export function parseSig(text: string): Sig {
  const bytes: (number | null)[] = [];
  const caps: Cap[] = [];
  const marks: { name: string; at: number }[] = [];
  for (const t of text.trim().split(/\s+/)) {
    if (!t) continue;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^<([a-z0-9_]+)(?::([124]))?>$/i))) {
      const size = Number(m[2] ?? 4) as 1 | 2 | 4;
      caps.push({ name: m[1], at: bytes.length, size });
      for (let i = 0; i < size; i++) bytes.push(null);
    } else if ((m = t.match(/^@([a-z0-9_]+)$/i))) {
      marks.push({ name: m[1], at: bytes.length });
    } else if (/^(\.\.)+$/.test(t)) {
      for (let i = 0; i < t.length / 2; i++) bytes.push(null);
    } else if (/^([0-9a-f]{2})+$/i.test(t)) {
      for (let i = 0; i < t.length; i += 2) bytes.push(parseInt(t.slice(i, i + 2), 16));
    } else {
      throw new Error(`bad signature token '${t}' in '${text}'`);
    }
  }
  if (bytes[0] === null) throw new Error(`signature must start with a literal byte: '${text}'`);
  return { text, bytes, caps, marks };
}

/** Every match of `sig` in the images, at even addresses (instructions are word-aligned). */
export function findSig(images: CodeImage[], sig: Sig | string): Hit[] {
  const s = typeof sig === 'string' ? parseSig(sig) : sig;
  const out: Hit[] = [];
  const first = s.bytes[0]!;
  const n = s.bytes.length;
  for (const img of images) {
    const b = img.bytes;
    const start = img.ram & 1;
    for (let k = start; k + n <= b.length; k += 2) {
      if (b[k] !== first) continue;
      let ok = true;
      for (let i = 1; i < n; i++) {
        const v = s.bytes[i];
        if (v !== null && b[k + i] !== v) { ok = false; break; }
      }
      if (!ok) continue;
      const caps: Hit['caps'] = {};
      for (const c of s.caps) {
        const at = k + c.at;
        const value = c.size === 4 ? u32(b, at) : c.size === 2 ? (b[at] << 8) | b[at + 1] : b[at];
        caps[c.name] = { at: img.ram + at, value };
      }
      for (const m of s.marks) caps[m.name] = { at: img.ram + k + m.at, value: 0 };
      out.push({ at: img.ram + k, image: img.what, caps });
    }
  }
  return out;
}

/**
 * Whether a 16-bit ColdFire opcode is followed at once by a 32-bit absolute address or immediate
 * (its first extension). Covers the forms the 1.63 lineage's compiler emits and the engine's own
 * code uses; enough to tell an operand from data that happens to hold the same value.
 */
export function absFirst(op: number): boolean {
  if ((op & 0xf1ff) === 0x41f9) return true;                           // lea abs.l,An
  if (op === 0x4879 || op === 0x4eb9 || op === 0x4ef9) return true;    // pea / jsr / jmp abs.l
  const src = op & 0x003f;
  const size = op & 0xf000;
  if ((size === 0x1000 || size === 0x2000 || size === 0x3000) && (src === 0x39 || (src === 0x3c && size === 0x2000))) return true; // move abs.l,<ea> / move.l #imm,<ea>
  if ((op & 0xffc0) === 0x23c0 || (op & 0xffc0) === 0x13c0 || (op & 0xffc0) === 0x33c0) return (op & 0x30) === 0;    // move Rn,abs.l
  if ([0x4ab9, 0x4a39, 0x4a79, 0x42b9, 0x4239, 0x4279, 0x2f39, 0x2f3c, 0x23fc].includes(op)) return true;
  const f8 = op & 0xfff8;
  if ([0x0c80, 0x0680, 0x0480, 0x0280, 0x0080, 0x0a80].includes(f8)) return true;                // cmpi/addi/subi/andi/ori/eori.l #imm,Dn
  const r = op & 0xf1ff;
  if ([0xd1fc, 0xb1fc, 0x91fc, 0xb0b9, 0xd0b9, 0x90b9, 0xb0bc, 0xd0bc, 0x90bc, 0x80b9, 0xc0b9].includes(r)) return true;
  return false;
}

export interface Operand { at: number; value: number; op: number; image: string }

/** Every absolute 32-bit operand (address or immediate) in the images whose value `want` accepts. */
export function operands(images: CodeImage[], want: (v: number) => boolean): Operand[] {
  const out: Operand[] = [];
  for (const img of images) {
    const b = img.bytes;
    for (let k = (img.ram & 1) + 2; k + 4 <= b.length; k += 2) {
      const v = u32(b, k);
      if (!want(v)) continue;
      const op = (b[k - 2] << 8) | b[k - 1];
      if (absFirst(op)) out.push({ at: img.ram + k, value: v, op, image: img.what });
    }
  }
  return out;
}

/** The bytes at a run-time address, from whichever image holds them. */
export function reader(images: CodeImage[]): (addr: number, n: number) => Uint8Array | null {
  return (addr, n) => {
    for (const i of images) if (addr >= i.ram && addr + n <= i.ram + i.bytes.length) return i.bytes.subarray(addr - i.ram, addr - i.ram + n);
    return null;
  };
}
