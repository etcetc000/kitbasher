// Several files dropped on the Samples step fill the pads in order: the files sorted by name the
// way people number them ("Kick 2" before "Kick 10"), the pads in grid order (BD SD HT LT CP RS CB
// CH OH RC CC BR TA TR SH BC), main samples only, starting at the pad the drop landed on. A sample
// two pads share (E12-SD and E12-RS both play sample 12) is one slot, filled once. No imports, so
// ci/sample_fill.test.mjs can load it alone.

export const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc)$/i;

/** A pad's main sample: `pad` names it ("SD"), `entry` is the bank sample it plays. */
export interface Slot { pad: string; entry: number }

export interface Placement { name: string; pad: string; entry: number }

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural order: digit runs compare as numbers, case and accents aside; ties broken by the raw name. */
export function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Files to pads: `names` in natural order onto `slots` from index `start`, each bank sample once.
 * Returns where each file goes and the files left over when the pads run out.
 */
export function fillInOrder(names: string[], slots: Slot[], start = 0): { placed: Placement[]; extra: string[] } {
  const sorted = naturalSort(names);
  const used = new Set<number>();
  const placed: Placement[] = [];
  let i = Math.max(0, start);
  for (const name of sorted) {
    while (i < slots.length && used.has(slots[i].entry)) i++;
    if (i >= slots.length) break;
    placed.push({ name, pad: slots[i].pad, entry: slots[i].entry });
    used.add(slots[i].entry);
    i++;
  }
  return { placed, extra: sorted.slice(placed.length) };
}
