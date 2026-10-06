// Semantic checks on the base's own code, independent of what its profile lists.
//
// The CTR-range test. The OS asks "is this a control machine?" as (id & 0xf8) == 0x78, four IDs
// too wide: a machine on 124..127 is handed a CTR machine's shared parameter state. The fix
// tightens the mask to 0xfc at every site that asks; missing a single one (for example the value
// painter at 0x226e62 in 1.63) leaves a frozen parameter display. So the build does not trust a
// site list: it finds every test by following the masked ID through the base's unpacked ColdFire
// code (the slot, the add-on, any scatter entries) and fails when a live one is not patched. The
// scan follows the value when it is compared at once, spilled to the stack frame and compared
// later, or kept in an address register.

/** Every `andi.l #$f8,Dn` whose Dn is later compared with 0x78: {operand address: how}. */
export function ctrRangeTests(b: Uint8Array, base: number): Map<number, string> {
  const out = new Map<number, string>();
  const at = (k: number): number => (k >= 0 && k < b.length ? b[k] : -1);
  const eq = (k: number, bytes: number[]): boolean => bytes.every((v, x) => at(k + x) === v);
  /** A `#$78` loaded into some Dm at k: [m, instruction length], else null. */
  const c78 = (k: number): [number, number] | null => {
    if ((at(k) & 0xf1) === 0x70 && at(k + 1) === 0x78) return [(at(k) >> 1) & 7, 2];            // moveq #$78,Dm
    if ((at(k) & 0xf1) === 0x10 && at(k + 1) === 0x3c && eq(k + 2, [0x00, 0x78])) return [(at(k) >> 1) & 7, 4]; // move.b #$78,Dm
    return null;
  };
  for (let i = 1; i + 4 <= b.length; i++) {
    if (!(b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 && b[i + 3] === 0xf8)) continue;
    if (i < 2 || b[i - 2] !== 0x02 || (b[i - 1] & 0xf8) !== 0x80) continue;
    const n = b[i - 1] & 7;                                   // the data register the mask was applied to
    let why: string | null = null;
    for (let k = i + 4; k < i + 4 + 0x20 && !why; k += 2) {  // compared right here
      const c = c78(k);
      if (c && eq(k + c[1], [0xb0 | (c[0] << 1), 0x80 | n])) why = 'direct';                    // cmp.l Dn,Dm
      else if (at(k) === 0x0c && (at(k + 1) & 0xf8) === 0x80 && (at(k + 1) & 7) === n && eq(k + 2, [0, 0, 0, 0x78])) why = 'cmpi.l';
    }
    for (let k = i + 4; k < i + 4 + 0x10 && !why; k += 2) {  // ... or kept somewhere and compared later
      let keep: ['frame', number[]] | ['areg', number];
      let nxt: number;
      if (at(k) === 0x2f && at(k + 1) === (0x40 | n)) { keep = ['frame', [at(k + 2), at(k + 3)]]; nxt = k + 4; }   // move.l Dn,$dd(a7)
      else if ((at(k) & 0xf1) === 0x20 && at(k + 1) === (0x40 | n)) { keep = ['areg', (at(k) >> 1) & 7]; nxt = k + 2; } // movea.l Dn,Am
      else continue;
      for (let j = nxt; j < Math.min(nxt + 0x200, b.length - 8); j += 2) {
        const c = c78(j);
        if (!c) continue;
        const p = j + c[1];
        if (keep[0] === 'frame' && eq(p, [0xb0 | (c[0] << 1), 0xaf, ...keep[1]])) {
          why = `spilled to $${((keep[1][0] << 8) | keep[1][1]).toString(16)}(a7)`;
          break;
        }
        if (keep[0] === 'areg' && eq(p, [0xb0 | (c[0] << 1), 0x88 | keep[1]])) {
          why = `kept in a${keep[1]}`;
          break;
        }
      }
    }
    if (why) out.set(base + i, why);
  }
  return out;
}

export interface CtrCoverage {
  found: Map<number, string>;      // every CTR-range test in the base's code
  missed: number[];                // found, not in the profile's list
  extra: number[];                 // in the profile's list, not a CTR-range test
}

/** The base's CTR-range tests against the profile's site list, over every piece of its code. */
export function ctrCoverage(images: [Uint8Array, number][], listed: number[]): CtrCoverage {
  const found = new Map<number, string>();
  for (const [b, org] of images) for (const [s, w] of ctrRangeTests(b, org)) found.set(s, w);
  const l = new Set(listed);
  return {
    found,
    missed: [...found.keys()].filter((s) => !l.has(s)).sort((a, z) => a - z),
    extra: listed.filter((s) => !found.has(s)).sort((a, z) => a - z),
  };
}
