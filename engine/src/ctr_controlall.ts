// FUNCTION + knob (control all) for a machine on IDs 124..127.
//
// With sixteen tracks of a machine on 124..127, FUNC + a data-entry knob moves only the selected
// track. The OS does this on purpose for control machines (stock CTR machines such as ID 123 behave
// the same way), and IDs 124..127 fall inside its "control machine" test, so added machines there
// are swept up with them.
//
// The ctr-range masks (`(id & $f8) == $78`, narrowed to `$fc` elsewhere in a patched image) are
// not the cause. Three other tests are. Two read a track's machine ID and ask `(id & $f0) == $70`:
//
//     adda.l  #$700008,a0
//     move.l  $1a2(a0),d0        ; = 0x7001aa + 4*track, a track's machine ID
//     andi.l  #$f0,d0            ; the gate: true of 0x70..0x7f, so of 124..127 as well
//     moveq   #$70,d1
//     cmp.l   d0,d1
//     beq     <the MID/CTR arm>
//
//   'kind'     the parameter page's setup, which fills the per-knob kind table the control-all
//              record is built from. Its fall-through is `move.b #$10,(a2)`: kind $10 means "this
//              knob takes part in control all", and the record builder refuses any other kind.
//              This is the test that stops the broadcast.
//   'encoder'  the encoder handler, which posts one of two message pairs ($21/$25 against
//              $02/$06) for the page's own bookkeeping. Same predicate, and it misclassifies
//              124..127 the same way.
//
// The third is the per-track skip in the broadcast loop; see `findLoopSkip` below.
//
// For the first two the fix is one mask byte per gate. `(id & $f4) == $70` is true of
//
//     0x70 0x71 0x72 0x73        the MID machines and their gap  -- unchanged
//     0x78 0x79 0x7a 0x7b        the four stock control machines -- unchanged
//
// and false of
//
//     0x74..0x77                 a gap in stock, and no build puts a machine there
//     0x7c..0x7f                 124..127, which now get the sixteen-track broadcast
//
// and the top nibble must still be 0111, so no ID outside 0x70..0x7f changes. `$f8` would also
// exclude the four stock control machines and `$fc` would exclude 0x74..0x7b; `$f4` is the only
// one-byte value that separates 0x7c..0x7f from 0x78..0x7b.
//
// The gates are found by signature, never by address. A 1.63-lineage base has many
// `(something & $f0) == $70` tests; only the two that read a track's machine ID through
// `adda.l #$700008 / move.l $1a2(a0)` and carry one of the two fall-through anchors above are
// patched. A base where either anchor is missing is reported rather than guessed at.

import { h } from './bytes.js';

export type GateKind = 'kind' | 'encoder';

export interface ControlAllGate {
  /** the address of the longword mask immediate to patch */
  site: number;
  /** what it must hold before (0x000000f0) */
  old: number;
  /** what it becomes (0x000000f4) */
  new: number;
  /** the address of the `andi.l` opword, for the report */
  test: number;
  /** which of the two gates this is */
  kind: GateKind;
}

export const GATE_OLD = 0x000000f0;
export const GATE_NEW = 0x000000f4;
/** the IDs whose behaviour the narrowing changes, and the only ones */
export const GATE_IDS: [number, number] = [0x7c, 0x7f];

/**
 * Every "(a track's machine ID & $f0) == $70, and if so treat it as a control machine" gate in one
 * code image that carries one of the two anchors above.
 *
 * `b` is the image's bytes and `base` the address its first byte has in ColdFire memory.
 */
export function findControlAllGates(b: Uint8Array, base: number): ControlAllGate[] {
  const out: ControlAllGate[] = [];
  const at = (k: number): number => (k >= 0 && k < b.length ? b[k] : -1);
  const eq = (k: number, bytes: number[]): boolean => bytes.every((v, x) => at(k + x) === v);
  for (let i = 0; i + 24 <= b.length; i += 2) {
    // adda.l #$700008,a0 ; move.l $1a2(a0),Dn ; andi.l #$f0,Dn ; moveq #$70,Dm ; cmp.l Dn,Dm ; beq
    if (!eq(i, [0xd1, 0xfc, 0x00, 0x70, 0x00, 0x08])) continue;
    // move.l $1a2(a0),Dn: opword $2028 | Dn<<9, so the high byte carries Dn in bits 3..1
    if ((at(i + 6) & 0xf1) !== 0x20 || at(i + 7) !== 0x28) continue;
    if (!eq(i + 8, [0x01, 0xa2])) continue;
    const n = (at(i + 6) >> 1) & 7;
    if (at(i + 10) !== 0x02 || at(i + 11) !== (0x80 | n)) continue;           // andi.l #..,Dn
    if (!eq(i + 12, [0x00, 0x00, 0x00, 0xf0])) continue;
    if ((at(i + 16) & 0xf1) !== 0x70 || at(i + 17) !== 0x70) continue;        // moveq #$70,Dm
    const m = (at(i + 16) >> 1) & 7;
    if (at(i + 18) !== (0xb0 | (m << 1)) || at(i + 19) !== (0x80 | n)) continue;  // cmp.l Dn,Dm
    if (at(i + 20) !== 0x67) continue;                                       // beq.b / beq.w
    const after = at(i + 21) !== 0x00 ? i + 22 : i + 24;
    let kind: GateKind | null = null;
    // 'kind': the fall-through declares the knob a control-all parameter -- move.b #$10,(An),
    // opword $10bc | An<<9, so the high byte carries An in bits 3..1
    if ((at(after) & 0xf1) === 0x10 && at(after + 1) === 0xbc && eq(after + 2, [0x00, 0x10])) kind = 'kind';
    // 'encoder': the fall-through loads the message poster -- lea.l <abs>.l,a1
    else if (eq(after, [0x43, 0xf9])) kind = 'encoder';
    if (kind === null) continue;
    out.push({ site: base + i + 12, old: GATE_OLD, new: GATE_NEW, test: base + i + 10, kind });
  }
  return out;
}

/** One line for the build report / discovery. */
export function gateLine(g: ControlAllGate[]): string {
  if (!g.length) return 'not found in this base: FUNC + knob on 124..127 cannot be fixed here';
  return g.map((x) => `${x.kind} ${h(x.site)} (test ${h(x.test)})`).join(', ');
}

/** Both gates, exactly once each, or null with the reason. */
export function bothGates(g: ControlAllGate[]): { kind: ControlAllGate; encoder: ControlAllGate } | null {
  const k = g.filter((x) => x.kind === 'kind');
  const e = g.filter((x) => x.kind === 'encoder');
  if (k.length !== 1 || e.length !== 1) return null;
  return { kind: k[0], encoder: e[0] };
}

// ---- the third gate: the per-track skip inside the sixteen-track broadcast loop ----------------
//
// The broadcast loop walks 0x7001aa and skips a track whose machine has no per-track synthesis
// parameter:
//
//     move.l  (a3),d1            ; the track's machine ID
//     move.l  d1,d0
//     andi.l  #$f0,d0
//     moveq   #$60,d2
//     cmp.l   d0,d2
//     beq.w   <next track>       ; a MIDI machine, 0x60..0x6f
//     move.b  #$70,d2
//     cmp.l   d0,d2
//     beq.w   <next track>       ; 0x70..0x7f -- which is where 124..127 are skipped
//
// The mask cannot be narrowed here: it is shared with the 0x60 compare, and `$f4` would stop
// four of the sixteen MIDI IDs (0x64..0x67, 0x6c..0x6f) being skipped. So the two tests are
// replaced by one range test on the unmasked ID, in the same number of bytes:
//
//     move.l  d1,d0              ; 2   (the same opword the site already has)
//     subi.l  #$60,d0            ; 6
//     cmpi.l  #$1b,d0            ; 6
//     bls.w   <next track>       ; 4   (the second beq.w's own displacement, unchanged)
//
// eighteen bytes for eighteen, and the predicate is the old one minus exactly 0x7c..0x7f:
// `(id - 0x60) <=u 0x1b` is true of 0x60..0x7b and false of everything else, where the old pair was
// true of 0x60..0x7f. Every MIDI machine and every stock control machine is skipped exactly as
// before; a machine on 124..127 is not.
//
// The signature is the pair of tests with both branches going to the same target.

export interface LoopSkipFix {
  /** 4-aligned start of the longwords to write */
  site: number;
  /** where the replaced code starts (site plus the kept leading bytes): the ISA gate decodes from here */
  codeAt: number;
  /** what those bytes must hold */
  old: Uint8Array;
  /** what they become */
  new: Uint8Array;
}

/** The per-track skip, rewritten as one range test. Null when the base does not have the pair. */
export function findLoopSkip(b: Uint8Array, base: number): LoopSkipFix[] {
  const out: LoopSkipFix[] = [];
  const at = (k: number): number => (k >= 0 && k < b.length ? b[k] : -1);
  const imm = (k: number, v: number): [number, number] | null => {
    if ((at(k) & 0xf1) === 0x70 && at(k + 1) === v) return [(at(k) >> 1) & 7, 2];              // moveq #v,Dm
    if ((at(k) & 0xf1) === 0x10 && at(k + 1) === 0x3c && at(k + 2) === 0 && at(k + 3) === v)
      return [(at(k) >> 1) & 7, 4];                                                            // move.b #v,Dm
    return null;
  };
  for (let i = 2; i + 40 <= b.length; i += 2) {
    if (at(i) !== 0x02 || (at(i + 1) & 0xf8) !== 0x80) continue;                                // andi.l #..,Dn
    if (at(i + 2) !== 0 || at(i + 3) !== 0 || at(i + 4) !== 0 || at(i + 5) !== 0xf0) continue;
    const n = at(i + 1) & 7;
    // the instruction before it must be `move.l Dk,Dn`, which the replacement re-emits
    const mv = (at(i - 2) << 8) | at(i - 1);
    if ((mv & 0xf1f8) !== 0x2000 || ((mv >> 9) & 7) !== n) continue;
    const k = mv & 7;
    if (k === n) continue;
    let p = i + 6;
    const c60 = imm(p, 0x60);
    if (!c60) continue;
    p += c60[1];
    if (at(p) !== (0xb0 | (c60[0] << 1)) || at(p + 1) !== (0x80 | n)) continue;                 // cmp.l Dn,Dm
    p += 2;
    if (at(p) !== 0x67 || at(p + 1) !== 0x00) continue;                                         // beq.w
    const t1 = p + 2 + (((at(p + 2) << 8) | at(p + 3)) << 16 >> 16);
    p += 4;
    const c70 = imm(p, 0x70);
    if (!c70) continue;
    p += c70[1];
    if (at(p) !== (0xb0 | (c70[0] << 1)) || at(p + 1) !== (0x80 | n)) continue;
    p += 2;
    if (at(p) !== 0x67 || at(p + 1) !== 0x00) continue;
    const disp = ((at(p + 2) << 8) | at(p + 3)) << 16 >> 16;
    const t2 = p + 2 + disp;
    const end = p + 4;
    if (t1 !== t2) continue;                                   // both skips must go to the same place
    // the region to rewrite: the `#$60` load through the second beq.w, padded down to a longword
    const from = (i + 6) & ~3;
    const span = end - from;
    if (span % 4 !== 0) continue;                              // the base does not align: report nothing
    const old = b.slice(from, end);
    const nw = new Uint8Array(old.subarray(0, i + 6 - from));  // the bytes before the first test, kept
    const code = [
      0x20 | (n << 1), k,                                      // move.l Dk,Dn
      0x04, 0x80 | n, 0x00, 0x00, 0x00, 0x60,                  // subi.l #$60,Dn
      0x0c, 0x80 | n, 0x00, 0x00, 0x00, 0x1b,                  // cmpi.l #$1b,Dn
      0x63, 0x00, (disp >> 8) & 0xff, disp & 0xff,             // bls.w <next track>
    ];
    if (nw.length + code.length !== span) continue;            // 18 bytes for 18, or nothing
    const bytes = new Uint8Array(span);
    bytes.set(nw, 0);
    bytes.set(code, nw.length);
    out.push({ site: base + from, codeAt: base + i + 6, old, new: bytes });
  }
  return out;
}
