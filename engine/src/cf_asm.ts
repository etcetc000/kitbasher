// A small two-pass ColdFire (ISA_A, MCF5206e) assembler for the engine's own boot-patch routines:
// only the instruction forms those routines use, each encoded from the ColdFire Programmer's
// Reference. Everything assembled here is also decoded by isa.ts (decodeLinear and the ISA gate)
// before it is written, so an encoding mistake fails the build rather than the instrument.
//
// Operands: d0..d7, a0..a7, (aN), (aN)+, -(aN), d16(aN), d8(aN,dM.l[*s]), #imm, #@label (a label's address
// as a long immediate), 0x...w / 0x...l (absolute), @label (absolute long to a label).

type Word = [number | (() => number), 2 | 4];
interface Ea { mode: number; reg: number; ext: Word[] }
type Item = { label: string } | { op: string; args: string[] } | { data: Uint8Array } | { align: number };

export interface Assembled { bytes: Uint8Array; labels: Record<string, number>; listing: { at: number; len: number; text: string }[] }

const REG = (s: string): { k: 'd' | 'a'; r: number } | null => {
  const m = /^([da])([0-7])$/.exec(s);
  return m ? { k: m[1] as 'd' | 'a', r: +m[2] } : null;
};

// only the branches the engine's routines use; anything else is refused as an unknown instruction
const CC: Record<string, number> = { bra: 0, bsr: 1, bhi: 2, bls: 3, bcc: 4, bcs: 5, bne: 6, beq: 7, bpl: 10, bmi: 11, bge: 12, blt: 13, bgt: 14, ble: 15 };

export class Asm {
  private items: Item[] = [];
  private labels = new Map<string, number>();
  private pass = 0;
  constructor(readonly org: number) {}
  label(n: string): void { this.items.push({ label: n }); }
  i(op: string, ...args: string[]): void { this.items.push({ op, args }); }
  bytes(name: string, data: ArrayLike<number>): void { this.items.push({ label: name }, { data: Uint8Array.from(data) }); }
  align(n: number): void { this.items.push({ align: n }); }

  private addr(n: string): number {
    const v = this.labels.get(n);
    if (v === undefined) throw new Error(`label ${n}`);
    return v;
  }

  private ea(s: string, size: 'b' | 'w' | 'l'): Ea {
    let m: RegExpExecArray | null;
    const r = REG(s);
    if (r) return { mode: r.k === 'd' ? 0 : 1, reg: r.r, ext: [] };
    if ((m = /^\(a([0-7])\)$/.exec(s))) return { mode: 2, reg: +m[1], ext: [] };
    if ((m = /^\(a([0-7])\)\+$/.exec(s))) return { mode: 3, reg: +m[1], ext: [] };
    if ((m = /^-\(a([0-7])\)$/.exec(s))) return { mode: 4, reg: +m[1], ext: [] };
    if ((m = /^(-?\d+)\(a([0-7])\)$/.exec(s))) {
      const d = +m[1];
      if (d < -32768 || d > 32767) throw new Error(`displacement ${s}`);
      return { mode: 5, reg: +m[2], ext: [[d & 0xffff, 2]] };
    }
    if ((m = /^(-?\d+)?\(a([0-7]),d([0-7])\.l(?:\*([124]))?\)$/.exec(s))) {
      const d = +(m[1] ?? 0);
      const sc = ({ 1: 0, 2: 1, 4: 2 } as Record<string, number>)[m[4] ?? '1'];
      if (d < -128 || d > 127) throw new Error(`index displacement ${s}`);
      return { mode: 6, reg: +m[2], ext: [[(+m[3] << 12) | 0x0800 | (sc << 9) | (d & 0xff), 2]] };
    }
    if ((m = /^#@(\w+)$/.exec(s))) {
      if (size !== 'l') throw new Error(`${s}: a label immediate is long`);
      const n = m[1];
      return { mode: 7, reg: 4, ext: [[() => this.addr(n), 4]] };
    }
    if ((m = /^#(-?(?:0x)?[0-9a-f]+)$/i.exec(s))) {
      const v = Number(m[1]);
      return { mode: 7, reg: 4, ext: [[size === 'l' ? v >>> 0 : v & 0xffff, size === 'l' ? 4 : 2]] };
    }
    if ((m = /^((?:0x)?[0-9a-f]+)\.w$/i.exec(s))) return { mode: 7, reg: 0, ext: [[Number(m[1]) & 0xffff, 2]] };
    if ((m = /^((?:0x)?[0-9a-f]+)\.l$/i.exec(s))) return { mode: 7, reg: 1, ext: [[Number(m[1]) >>> 0, 4]] };
    if ((m = /^@(\w+)$/.exec(s))) { const n = m[1]; return { mode: 7, reg: 1, ext: [[() => this.addr(n), 4]] }; }
    throw new Error(`operand ${s}`);
  }

  private enc(op: string, args: string[], at: number): Word[] {
    const ea6 = (e: Ea): number => (e.mode << 3) | e.reg;
    const D = (s: string): number => { const r = REG(s); if (!r || r.k !== 'd') throw new Error(`${op}: ${s} is not Dn`); return r.r; };
    const A = (s: string): number => { const r = REG(s); if (!r || r.k !== 'a') throw new Error(`${op}: ${s} is not An`); return r.r; };
    const W = (w: number, ...es: Ea[]): Word[] => [[w, 2], ...es.flatMap((e) => e.ext)];
    const [a0, a1] = args;
    const b = /^(b\w\w|bra|bsr)\.([bw])$/.exec(op);
    if (b && b[1] in CC) {
      const t = this.labels.get(a0) ?? at + 2;
      const d = t - (at + 2);
      if (b[2] === 'b') {
        if ((d < -128 || d > 127 || d === 0 || d === -1) && this.pass >= 2) throw new Error(`${op} ${a0}: ${d} out of byte range`);
        return [[0x6000 | (CC[b[1]] << 8) | (d & 0xff), 2]];
      }
      return [[0x6000 | (CC[b[1]] << 8), 2], [d & 0xffff, 2]];
    }
    switch (op) {
      case 'move.b': case 'move.w': case 'move.l': {
        const sz = op[5] as 'b' | 'w' | 'l';
        const s = this.ea(a0, sz), d = this.ea(a1, sz);
        const words = 1 + (s.ext.reduce((n, [, k]) => n + k, 0) + d.ext.reduce((n, [, k]) => n + k, 0)) / 2;
        if (words > 3) throw new Error(`${op} ${a0},${a1}: ${words} words (a ColdFire MOVE is at most 3)`);
        return [[{ b: 0x1000, w: 0x3000, l: 0x2000 }[sz] | (d.reg << 9) | (d.mode << 6) | ea6(s), 2], ...s.ext, ...d.ext];
      }
      case 'moveq': {
        const v = Number(a0.slice(1));
        if (v < -128 || v > 127) throw new Error('moveq range');
        return [[0x7000 | (D(a1) << 9) | (v & 0xff), 2]];
      }
      case 'lea': return W(0x41c0 | (A(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'pea': return W(0x4840 | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'jsr': return W(0x4e80 | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'jmp': return W(0x4ec0 | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'rts': return [[0x4e75, 2]];
      case 'dc.l': {   // data: a long, or a label's address
        const m = /^@(\w+)$/.exec(a0);
        if (m) return [[() => this.addr(m[1]), 4]];
        return [[Number(a0) >>> 0, 4]];
      }
      case 'nop': return [[0x4e71, 2]];
      case 'tst.b': case 'tst.l': return W(0x4a00 | ((op === 'tst.l' ? 2 : 0) << 6) | ea6(this.ea(a0, op[4] as 'b' | 'l')), this.ea(a0, op[4] as 'b' | 'l'));
      case 'clr.l': return W(0x4280 | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'cmp.l': return W(0xb080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'add.l': return W(0xd080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'sub.l': return W(0x9080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'and.l': return W(0xc080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'cmpi.l': return [[0x0c80 | D(a1), 2], ...this.ea(a0, 'l').ext];
      case 'or.l':
        if (REG(a1)?.k === 'd') return W(0x8080 | (D(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
        return W(0x8180 | (D(a0) << 9) | ea6(this.ea(a1, 'l')), this.ea(a1, 'l'));    // or.l Dn,<ea> (memory)
      case 'adda.l': return W(0xd1c0 | (A(a1) << 9) | ea6(this.ea(a0, 'l')), this.ea(a0, 'l'));
      case 'muls.w': return W(0xc1c0 | (D(a1) << 9) | ea6(this.ea(a0, 'w')), this.ea(a0, 'w'));
      case 'addq.l': case 'subq.l': {
        const q = Number(a0.slice(1));
        if (q < 1 || q > 8) throw new Error('quick range');
        return W((op === 'addq.l' ? 0x5080 : 0x5180) | ((q & 7) << 9) | ea6(this.ea(a1, 'l')), this.ea(a1, 'l'));
      }
      case 'lsl.l': case 'lsr.l': {
        const left = op === 'lsl.l';
        if (REG(a0)?.k === 'd') return [[(left ? 0xe1a8 : 0xe0a8) | (D(a0) << 9) | D(a1), 2]];        // count in a register
        const n = Number(a0.slice(1));
        if (n < 1 || n > 8) throw new Error('shift range');
        return [[(left ? 0xe188 : 0xe088) | ((n & 7) << 9) | D(a1), 2]];
      }
      case 'extb.l': return [[0x49c0 | D(a0), 2]];
      case 'btst': case 'bset': {
        if (REG(a0)?.k === 'd') return W((op === 'btst' ? 0x0100 : 0x01c0) | (D(a0) << 9) | ea6(this.ea(a1, 'b')), this.ea(a1, 'b'));
        // the static form, #n: ISA_A takes it on Dn, (An), (An)+, -(An) and d16(An) only -- not on an
        // absolute address (a `btst #n,abs.l` froze real hardware at boot; the emulators run it)
        const n = /^#(\d+)$/.exec(a0);
        if (!n || +n[1] > 31) throw new Error(`${op}: a data register or #0..31`);
        const e = this.ea(a1, 'b');
        if (e.mode === 1 || e.mode > 5) throw new Error(`${op} #n,${a1}: ISA_A has the static form only on Dn, (An), (An)+, -(An) and d16(An)`);
        return [[(op === 'btst' ? 0x0800 : 0x08c0) | ea6(e), 2], [+n[1], 2], ...e.ext];
      }
      case 'movem.l': {   // movem.l d0-d7/a0-a4,(a7)  |  movem.l (a7),d0-d7/a0-a4   (ColdFire: (An) or d16(An) only)
        const list = (s: string): number => s.split('/').reduce((mask, g) => {
          const [x, y] = g.split('-');
          const rx = REG(x)!, ry = REG(y ?? x)!;
          for (let k = rx.r; k <= ry.r; k++) mask |= 1 << (k + (rx.k === 'a' ? 8 : 0));
          return mask;
        }, 0);
        const toMem = /^[da]\d/.test(a0);
        const e = this.ea(toMem ? a1 : a0, 'l');
        if (e.mode !== 2 && e.mode !== 5) throw new Error('movem: (An) or d16(An) only');
        return [[(toMem ? 0x48c0 : 0x4cc0) | ea6(e), 2], [list(toMem ? a0 : a1), 2], ...e.ext];
      }
    }
    throw new Error(`unknown instruction ${op}`);
  }

  private run(): { bytes: Uint8Array; listing: Assembled['listing'] } {
    let at = this.org;
    const out: number[] = [];
    const listing: Assembled['listing'] = [];
    for (const it of this.items) {
      if ('label' in it) { if (this.pass === 1) this.labels.set(it.label, at); continue; }
      if ('align' in it) { while ((at - this.org) % it.align) { out.push(0); at++; } continue; }
      if ('data' in it) { out.push(...it.data); at += it.data.length; continue; }
      const start = at;
      for (const [v0, n] of this.enc(it.op, it.args, at)) {
        const v = typeof v0 === 'function' ? v0() : v0;
        for (let k = n - 1; k >= 0; k--) out.push((v >>> (8 * k)) & 0xff);
        at += n;
      }
      listing.push({ at: start, len: at - start, text: `${it.op} ${it.args.join(',')}` });
    }
    return { bytes: Uint8Array.from(out), listing };
  }

  /** Lays out the labels, then encodes until the bytes no longer change. */
  assemble(): Assembled {
    for (const it of this.items) if ('label' in it) this.labels.set(it.label, this.org);
    this.pass = 1; this.run();
    this.pass = 2; const r = this.run();
    this.pass = 3; const r2 = this.run();
    if (r.bytes.length !== r2.bytes.length || r.bytes.some((x, k) => x !== r2.bytes[k])) throw new Error('assembler did not converge');
    return { ...r2, labels: Object.fromEntries(this.labels) };
  }
}
