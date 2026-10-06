// Where a machine's code origin falls inside a 128-word instruction-cache sector.
//
// DSP2's machines all run from external SRAM through the 56300's instruction cache: 1,024 words in
// 8 sectors of 128, each sector holding one 128-word aligned span. So the origin's position inside a
// sector decides how many sectors a machine's executed code spans, and the number that matters is
// 8: a footprint spanning 8 sectors or fewer survives from one track to the next and from block to
// block, and one spanning 9 pays for its whole footprint again on every track of every block.
//
// The mask travels with the code. A pack carries, per model, the set of offsets measured best for
// that model's code (a sweep of all 128 offsets against a cache model and a kit metric), along with
// the code length it was measured on. A mask is a property of the code, so it ships beside it: when
// the code changes, the pack's exporter has to re-measure it, and the engine never applies offsets
// measured for different code. This module therefore holds no per-machine table, and a new model
// gets its placement from its pack with no change here.
//
// The mask also makes a machine's cache cost independent of the user's selection. Without it, each
// origin depends on which other machines are selected, and the same code at the worst offset the
// first-fit allocator can hand it costs up to 16.8 c/s per track more than the masked placement.

export const SECTOR = 128;
export const SECTORS = 8;

/** A machine's measured offset mask, as the pack's model entry carries it. */
export interface AlignEntry {
  /** 32 hex characters, bit i set = offset i is one of the measured best (bit 0 is offset 0) */
  offsets: string;
  /** executed-footprint sectors: at the origin it was measured at, inside the mask, at the worst offset */
  sectors: [number, number, number];
  /** the kit metric (16 of itself, c/s per track) at those three placements */
  metric: [number, number, number];
  /** code words the sweep ran on; a pack whose code no longer matches carries no mask at all */
  words: number;
}

/** What `alignOf` needs of a model: its code, and the mask the pack may carry for it. */
export interface AlignableModel {
  code: { words: string };
  align?: AlignEntry;
}

/** Bit `off` of a 32-hex-character mask. */
export function inMask(mask: string, off: number): boolean {
  const o = ((off % SECTOR) + SECTOR) % SECTOR;
  const nib = parseInt(mask[mask.length - 1 - (o >> 2)], 16);
  return ((nib >> (o & 3)) & 1) === 1;
}

/** The lowest address at or above `at` whose offset in a sector is in `mask`. */
export function alignUp(at: number, mask: string): number {
  for (let k = 0; k < SECTOR; k++) if (inMask(mask, at + k)) return at + k;
  throw new Error('align: an empty offset mask');
}

/**
 * The mask a pack carries for this model, or null when it carries none.
 *
 * `words` is the model's real code length, which the caller has already computed. A mask whose own
 * `words` disagrees with it is an error, not a miss: both come out of the same export, so a mismatch
 * means the pack was edited by hand, and the machine must not be placed on offsets measured for
 * other code.
 */
export function alignOf(m: AlignableModel, words: number): AlignEntry | null {
  const a = m.align;
  if (!a) return null;
  if (!/^[0-9a-f]{32}$/.test(a.offsets)) throw new Error(`align: a malformed offset mask ${a.offsets}`);
  if (a.words !== words) {
    throw new Error(`align: the pack's mask was measured on ${a.words} words, this code is ${words}`);
  }
  if (!/[1-9a-f]/.test(a.offsets)) throw new Error('align: an empty offset mask');
  return a;
}
