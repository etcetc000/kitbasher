// A ColdFire ISA_A whitelist decoder, for the MCF5206e (the Machinedrum SPS-1UW's CPU).
//
// The MCF5206e is a Version 2 ColdFire core implementing ISA_A (ColdFire Programmer's Reference
// Manual rev. 3, "ISA_A"), with the optional hardware divide unit (divs/divu .w/.l, rems/remu)
// and a MAC unit (the original 16x16 / 32x32 MAC, not EMAC), no FPU, no ISA_B/ISA_C additions.
// Every opword is decoded against the list of ISA_A instructions with the addressing modes each
// allows; anything else is a reject naming what it is (a 68020 form, a .b/.w arithmetic, a
// rotate, an ISA_B instruction, a full-format or x8-scaled index, a 32-bit branch, ...).
// Divide instructions are accepted (the part has the unit); MAC instructions are decoded as
// 'mac' and reported, since the part has them but none of our code may use them.
//
// `scanCode` walks code by recursive descent from entry points (branch and call targets followed,
// data never decoded as code), which is what lets stock X.13 and stock 1.63 serve as a positive
// control: every instruction reachable in them must decode.

export interface Insn { at: number; len: number; name: string; ok: boolean; why?: string; mac?: boolean;
                        flow: 'next' | 'stop' | 'branch' | 'jump' | 'call'; target?: number }

type Mode = 'Dn' | 'An' | '(An)' | '(An)+' | '-(An)' | '(d16,An)' | '(d8,An,Xi)' | 'abs.w' | 'abs.l' | '(d16,PC)' | '(d8,PC,Xi)' | '#imm';
const MODES: Mode[] = ['Dn', 'An', '(An)', '(An)+', '-(An)', '(d16,An)', '(d8,An,Xi)'];
const MODE7: Mode[] = ['abs.w', 'abs.l', '(d16,PC)', '(d8,PC,Xi)', '#imm'];

const ALL: Mode[] = [...MODES, ...MODE7];
const DATA: Mode[] = ALL.filter((m) => m !== 'An');
const MEMALT: Mode[] = ['(An)', '(An)+', '-(An)', '(d16,An)', '(d8,An,Xi)', 'abs.w', 'abs.l'];
const DATAALT: Mode[] = ['Dn', ...MEMALT];
const ALT: Mode[] = ['Dn', 'An', ...MEMALT];
const CTRL: Mode[] = ['(An)', '(d16,An)', '(d8,An,Xi)', 'abs.w', 'abs.l', '(d16,PC)', '(d8,PC,Xi)'];
const SHORT: Mode[] = ['Dn', '(An)', '(An)+', '-(An)', '(d16,An)'];      // mul.l, div.l, rem, static bit ops

class Reject extends Error {}

/** Decode one instruction at `off` of `b` (run-time address `at`). */
export function decode(b: Uint8Array, off: number, at: number): Insn {
  const w = (k: number): number => {
    if (off + k + 2 > b.length) throw new Reject('runs past the end of the code');
    return (b[off + k] << 8) | b[off + k + 1];
  };
  let len = 2;
  const ext = (n: number): number => { const k = len; len += n; return n === 2 ? w(k) : ((w(k) << 16) | w(k + 2)) >>> 0; };
  const op = w(0);
  /** the effective address in bits 5..0 (or `mode`,`reg`), checked against `allowed`; returns the mode */
  const ea = (allowed: Mode[], size: 1 | 2 | 4, mode = (op >> 3) & 7, reg = op & 7): Mode => {
    const m: Mode = mode < 7 ? MODES[mode] : (reg < 5 ? MODE7[reg] : ('?' as Mode));
    if ((m as string) === '?') throw new Reject(`addressing mode 7/${reg} does not exist`);
    if (!allowed.includes(m)) throw new Reject(`addressing mode ${m} not allowed here`);
    if (m === '(d16,An)' || m === 'abs.w' || m === '(d16,PC)') ext(2);
    else if (m === 'abs.l') ext(4);
    else if (m === '#imm') ext(size === 4 ? 4 : 2);
    else if (m === '(d8,An,Xi)' || m === '(d8,PC,Xi)') {
      const x = ext(2);
      if (x & 0x100) throw new Reject('full-format index extension (68020 memory-indirect / base displacement)');
      if (((x >> 9) & 3) === 3) throw new Reject('index scale x8');
      if (!(x & 0x800)) throw new Reject('word-sized index register (ColdFire has only .l index)');
    }
    return m;
  };
  const eaAt = (): number => { const mode = (op >> 3) & 7, reg = op & 7; return mode === 7 && reg === 1 ? (w(2) << 16 | w(4)) >>> 0 : mode === 7 && reg === 2 ? at + 2 + ((w(2) << 16) >> 16) : -1; };
  const I = (name: string, flow: Insn['flow'] = 'next', target?: number): Insn => ({ at, len, name, ok: true, flow, target });
  try {
    const hi4 = op >> 12;
    const reg9 = (op >> 9) & 7;
    const opm = (op >> 6) & 7;
    switch (hi4) {
      case 0x0: {
        if ((op & 0xff00) === 0x0800 && ((op >> 6) & 3) !== 3 || (op & 0xffc0) === 0x08c0) {  // static bit ops
          ext(2);
          ea(((op >> 6) & 3) === 0 ? [...SHORT] : SHORT, 1);
          return I(['btst', 'bchg', 'bclr', 'bset'][(op >> 6) & 3] + ' #imm');
        }
        if (op & 0x100) {                                                   // dynamic bit ops
          if (((op >> 3) & 7) === 1) throw new Reject('movep (68000 only)');
          const t = (op >> 6) & 3;
          ea(t === 0 ? DATA : DATAALT, 1);
          return I(['btst', 'bchg', 'bclr', 'bset'][t] + ' Dn');
        }
        const kind = (op >> 9) & 7;
        const size = (op >> 6) & 3;
        const imm = ['ori', 'andi', 'subi', 'addi', '', 'eori', 'cmpi', ''][kind];
        if (imm && size === 2 && ((op >> 3) & 7) === 0) { ext(4); return I(`${imm}.l #imm,Dn`); }
        if (kind === 4) throw new Reject('bit op with an illegal size');
        throw new Reject(imm ? `${imm}${size === 3 ? ' (cas/cmp2/chk2 or to CCR/SR)' : size === 2 ? '.l to memory' : ['.b', '.w'][size]} (not ISA_A)` : 'moves/cas/cmp2 (not ColdFire)');
      }
      case 0x1: case 0x2: case 0x3: {                                      // move / movea
        const size = hi4 === 1 ? 1 : hi4 === 2 ? 4 : 2;
        const s = ea(ALL, size as 1 | 2 | 4);
        if (size === 1 && s === 'An') throw new Reject('move.b from An');
        const dmode = (op >> 6) & 7, dreg = (op >> 9) & 7;
        if (dmode === 1) {
          if (size === 1) throw new Reject('movea.b');
          return I(`movea.${size === 4 ? 'l' : 'w'}`);
        }
        // ColdFire limits the source/destination pairs an instruction may carry (at most 3 words)
        const d = ea(dmode === 7 ? (dreg < 2 ? ['abs.w', 'abs.l'] : []) : DATAALT, size as 1 | 2 | 4, dmode, dreg);
        const simple: Mode[] = ['Dn', 'An', '(An)', '(An)+', '-(An)'];
        const ok = simple.includes(s) || (['(d16,An)', '(d16,PC)'].includes(s) && [...simple, '(d16,An)'].includes(d)) || simple.includes(d);
        if (!ok) throw new Reject(`move ${s},${d} (a source/destination pair ColdFire does not encode)`);
        return I(`move.${size === 1 ? 'b' : size === 2 ? 'w' : 'l'}`);
      }
      case 0x4: {
        if (op === 0x4e71) return I('nop');
        if (op === 0x4e75) return I('rts', 'stop');
        if (op === 0x4e73) return I('rte', 'stop');
        if (op === 0x4e72) { ext(2); return I('stop', 'stop'); }
        if (op === 0x4afc) return I('illegal', 'stop');
        if (op === 0x4ac8) return I('halt', 'stop');
        if (op === 0x4acc) return I('pulse');
        if (op === 0x4e7b) { ext(2); return I('movec'); }
        if ((op & 0xfff0) === 0x4e40) return I('trap');
        if ((op & 0xfff8) === 0x4e50) { ext(2); return I('link.w'); }
        if ((op & 0xfff8) === 0x4e58) return I('unlk');
        if ((op & 0xfff8) === 0x4840) return I('swap');
        if ((op & 0xfff8) === 0x4880) return I('ext.w');
        if ((op & 0xfff8) === 0x48c0) return I('ext.l');
        if ((op & 0xfff8) === 0x49c0) return I('extb.l');
        if ((op & 0xfff8) === 0x4080) return I('negx.l');
        if ((op & 0xfff8) === 0x4480) return I('neg.l');
        if ((op & 0xfff8) === 0x4680) return I('not.l');
        if ((op & 0xfff8) === 0x40c0) return I('move.w sr,Dn');
        if ((op & 0xfff8) === 0x42c0) return I('move.w ccr,Dn');
        if ((op & 0xffc0) === 0x46c0) { ea(['Dn', '#imm'], 2); return I('move.w to sr'); }
        if ((op & 0xffc0) === 0x44c0) { ea(['Dn', '#imm'], 2); return I('move.b to ccr'); }
        if ((op & 0xffc0) === 0x4840) { const m = ea(CTRL, 4); void m; return I('pea'); }
        if ((op & 0xfb80) === 0x4880 && (op & 0x40)) {                     // movem.l
          ext(2);
          ea(['(An)', '(d16,An)'], 4);
          return I('movem.l');
        }
        if ((op & 0xfb80) === 0x4880) throw new Reject('movem.w (not ColdFire)');
        if ((op & 0xffc0) === 0x4c00) { ext(2); ea(SHORT, 4); return I('mul.l'); }
        if ((op & 0xffc0) === 0x4c40) { ext(2); ea(SHORT, 4); return I('div.l / rem.l'); }
        if ((op & 0xff00) === 0x4200 && ((op >> 6) & 3) !== 3) { ea(DATAALT, 4); return I('clr'); }
        if ((op & 0xff00) === 0x4a00 && ((op >> 6) & 3) !== 3) { const s = (op >> 6) & 3; ea(s === 0 ? DATA : ALL, s === 2 ? 4 : 2); return I('tst'); }
        if ((op & 0xffc0) === 0x4ec0) { const t = eaAt(); ea(CTRL, 4); return I('jmp', 'jump', t >= 0 ? t : undefined); }
        if ((op & 0xffc0) === 0x4e80) { const t = eaAt(); ea(CTRL, 4); return I('jsr', 'call', t >= 0 ? t : undefined); }
        if ((op & 0xf1c0) === 0x41c0) { ea(CTRL, 4); return I('lea'); }
        if ((op & 0xfff0) === 0x4e60) throw new Reject('move usp (not ISA_A)');
        if (op === 0x4e74) throw new Reject('rtd (not ColdFire)');
        if ((op & 0xfff8) === 0x4808) throw new Reject('link.l (not ColdFire)');
        if ((op & 0xf140) === 0x4100) throw new Reject('chk (not ColdFire)');
        if ((op & 0xffc0) === 0x4800) throw new Reject('nbcd (not ColdFire)');
        if ((op & 0xffc0) === 0x4ac0) throw new Reject('tas (not ISA_A)');
        throw new Reject('not an ISA_A instruction');
      }
      case 0x5: {
        if ((op & 0xc0) === 0xc0) {
          if ((op & 0xfff8) === 0x51f8 || (op & 0xfff8) === 0x50f8) {
            if (op === 0x51fa) { ext(2); return I('tpf.w'); }
            if (op === 0x51fb) { ext(4); return I('tpf.l'); }
            if (op === 0x51fc) return I('tpf');
          }
          if (((op >> 3) & 7) === 0) return I('scc');
          if (((op >> 3) & 7) === 1) throw new Reject('dbcc (not ColdFire)');
          throw new Reject('scc/trapcc to memory (not ColdFire)');
        }
        if (((op >> 6) & 3) !== 2) throw new Reject(`addq/subq.${((op >> 6) & 3) === 0 ? 'b' : 'w'} (not ISA_A)`);
        ea(ALT, 4);
        return I(op & 0x100 ? 'subq.l' : 'addq.l');
      }
      case 0x6: {
        const d8 = op & 0xff;
        const cc = (op >> 8) & 15;
        let t: number;
        if (d8 === 0) t = at + 2 + ((ext(2) << 16) >> 16);
        else if (d8 === 0xff) throw new Reject('32-bit branch displacement (68020 / ISA_B)');
        else t = at + 2 + ((d8 << 24) >> 24);
        return I(cc === 0 ? 'bra' : cc === 1 ? 'bsr' : 'bcc', cc === 0 ? 'jump' : cc === 1 ? 'call' : 'branch', t);
      }
      case 0x7: if (op & 0x100) throw new Reject('mvs/mvz or illegal moveq'); return I('moveq');
      case 0x8: case 0x9: case 0xb: case 0xc: case 0xd: {
        const nm = { 0x8: 'or', 0x9: 'sub', 0xb: 'cmp/eor', 0xc: 'and', 0xd: 'add' }[hi4 as 8]!;
        if (hi4 === 0x8 && (opm === 5 || opm === 6) && ((op >> 4) & 3) === 0) throw new Reject('pack/unpk (68020, not ColdFire)');
        if (opm === 2) { ea(hi4 === 0x9 || hi4 === 0xd || hi4 === 0xb ? ALL : DATA, 4); return I(`${nm}.l <ea>,Dn`); }
        if (opm === 7 && (hi4 === 0x9 || hi4 === 0xd || hi4 === 0xb)) { ea(ALL, 4); return I(`${nm === 'cmp/eor' ? 'cmpa' : nm + 'a'}.l`); }
        if (opm === 3 && (hi4 === 0x9 || hi4 === 0xd || hi4 === 0xb)) throw new Reject(`${nm}a.w (not ColdFire)`);
        if (opm === 6) {
          if ((hi4 === 0x9 || hi4 === 0xd) && ((op >> 3) & 7) === 0) return I(`${nm}x.l`);
          if ((hi4 === 0x9 || hi4 === 0xd) && ((op >> 3) & 7) === 1) throw new Reject(`${nm}x -(An) (not ColdFire)`);
          ea(hi4 === 0xb ? DATAALT : MEMALT, 4);
          return I(hi4 === 0xb ? 'eor.l Dn,<ea>' : `${nm}.l Dn,<ea>`);
        }
        if (hi4 === 0x8 && (opm === 3 || opm === 7)) { ea(DATA, 2); return I(opm === 3 ? 'divu.w' : 'divs.w'); }
        if (hi4 === 0xc && (opm === 3 || opm === 7)) { ea(DATA, 2); return I(opm === 3 ? 'mulu.w' : 'muls.w'); }
        if (opm === 4 && ((op >> 4) & 3) === 0 && (hi4 === 8 || hi4 === 0xc)) throw new Reject(hi4 === 8 ? 'sbcd/pack (not ColdFire)' : 'abcd/exg (not ColdFire)');
        if (hi4 === 0xc && (opm === 5 || opm === 6) && ((op >> 3) & 0x1f) >= 8) throw new Reject('exg (not ColdFire)');
        throw new Reject(`${nm}.${['b', 'w', 'l'][opm & 3] ?? '?'} (only the .l forms are ISA_A)`);
      }
      case 0xa: {                                                            // MAC unit (MCF5206e has one)
        ext(2);
        return { ...I('mac'), mac: true };
      }
      case 0xe: {
        if ((op & 0xc0) === 0xc0) throw new Reject('memory shift/rotate or bit field (not ColdFire)');
        if (((op >> 6) & 3) !== 2) throw new Reject(`shift .${((op >> 6) & 3) === 0 ? 'b' : 'w'} (only .l in ISA_A)`);
        const t = (op >> 3) & 3;
        if (t > 1) throw new Reject(t === 2 ? 'roxl/roxr (not ColdFire)' : 'rol/ror (not ISA_A)');
        return I(`${t ? 'ls' : 'as'}${op & 0x100 ? 'l' : 'r'}.l`);
      }
      case 0xf: {
        if ((op & 0xff00) === 0xfb00) { ext(2); if ((op & 0xffc0) === 0xfbc0) ext(2); return I('wddata/wdebug'); }
        if ((op & 0xff20) === 0xf420 && (op & 0x18) === 0x08) return I('cpushl');
        throw new Reject('line F: FPU / coprocessor / cache op (not on the MCF5206e)');
      }
      default: throw new Reject('not an ISA_A instruction');
    }
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    return { at, len: Math.max(2, len), name: `.word ${op.toString(16).padStart(4, '0')}`, ok: false, why: e.message, flow: 'stop' };
  }
}

export interface CodeMem { what: string; ram: number; bytes: Uint8Array }
export interface Scan { insns: Map<number, Insn>; rejects: Insn[]; mac: Insn[]; seeds: number }

/**
 * Recursive descent from `entries` over `mem`: every reachable instruction decoded; calls and
 * branches followed, `jmp (An)` / `jsr (An)` not (their targets are not in the code). `within`
 * limits the walk (a blob of ours: the walk must not wander into the base).
 */
export function scanCode(mem: CodeMem[], entries: number[], within?: (a: number) => boolean): Scan {
  const insns = new Map<number, Insn>();
  const find = (a: number): CodeMem | undefined => mem.find((m) => a >= m.ram && a + 2 <= m.ram + m.bytes.length);
  const work = [...entries];
  while (work.length) {
    let a = work.pop()!;
    for (;;) {
      if (insns.has(a) || (within && !within(a))) break;
      const m = find(a);
      if (!m || a & 1) break;
      const i = decode(m.bytes, a - m.ram, a);
      insns.set(a, i);
      if (!i.ok) break;
      if (i.target !== undefined && (i.flow === 'call' || i.flow === 'branch' || i.flow === 'jump')) work.push(i.target);
      if (i.flow === 'stop' || i.flow === 'jump') break;
      a += i.len;
    }
  }
  const all = [...insns.values()];
  return { insns, rejects: all.filter((i) => !i.ok), mac: all.filter((i) => i.mac), seeds: entries.length };
}

/** Linear decode of a blob we emit whole (no data inside): every word must be an instruction. */
export function decodeLinear(b: Uint8Array, at: number, len = b.length): Insn[] {
  const out: Insn[] = [];
  for (let o = 0; o < len;) { const i = decode(b, o, at + o); out.push(i); o += i.len; }
  return out;
}
