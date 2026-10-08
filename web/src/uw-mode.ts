// "Does your Machinedrum have the UW option?" The page asks before anything else and will not go on
// without a Yes or a No clicked in this visit: nothing is pre-selected, no answer is remembered in the
// browser, and a restored layout, project or .syx that records one only shows a hint. The answer
// decides what the build may use: a Machinedrum without UW takes 128 off any machine ID of 128 and
// up, has no UW sample memory, and hides the ROM and RAM menu categories (engine/src/uw_menu.ts puts
// the added categories in their place).
//
// No imports: the page and its tests (ci/uw_mode.test.mjs) use the same code.

export type UwAnswer = 'yes' | 'no' | null;

/** IDs a Machinedrum without UW can use: below this. */
export const NO_UW_ID_LIMIT = 128;
/** How many of the base's own categories (its last ones: ROM and RAM) a unit without UW hides. */
export const UW_ONLY_CATEGORIES = 2;

export const HOW_TO_CHECK = 'To check: on your current firmware, open the machine menu of any track. ' +
  'If it has ROM and RAM categories, your Machinedrum has the UW option. If it does not, it has no UW.';

export const UNANSWERED = 'Answer Yes or No: does your Machinedrum have the UW option?';

/** Whether the user may leave the first step: only with a Yes or a No. */
export function gate(answer: UwAnswer, haveFirmware: boolean): { ok: boolean; why: string | null } {
  if (answer === 'yes' || answer === 'no') return { ok: haveFirmware, why: haveFirmware ? null : 'Load your OS file first.' };
  return { ok: false, why: UNANSWERED };
}

/**
 * The answer as the build takes it (`uw`): true for Yes, false for No. With no answer it throws, so
 * no build or download can happen without one, whichever way it was reached.
 */
export function uwForBuild(answer: UwAnswer): boolean {
  if (answer === 'yes') return true;
  if (answer === 'no') return false;
  throw new Error(UNANSWERED);
}

/** The answer as the engine needs it: noUw for a No, nothing otherwise. */
export const noUwOf = (a: UwAnswer): boolean => a === 'no';

/** What a layout or project file records for an answer (nothing without one). */
export const uwOf = (a: UwAnswer): boolean | undefined => (a === 'yes' ? true : a === 'no' ? false : undefined);

/**
 * The hint a restored file's `uw` shows next to the question. It never answers it: the user still
 * clicks Yes or No.
 */
export function fileHint(uw: boolean | undefined): string | null {
  return uw === undefined ? null : `This layout was saved for a Machinedrum ${uw ? 'with' : 'without'} UW.`;
}

/** The base's categories a unit shows: without UW, all but its last two (ROM and RAM). */
export function shownStock<T>(stock: T[], noUw: boolean): T[] {
  return noUw && stock.length >= UW_ONLY_CATEGORIES ? stock.slice(0, stock.length - UW_ONLY_CATEGORIES) : stock;
}

export interface IdCell {
  id: number;
  /** free / ours / base / dead as today; 'nouw': an ID this Machinedrum cannot use */
  state: string;
  title: string;
  moved: boolean;
  label: string;
}

/**
 * One cell of the ID map. `slot` is the base's view of the ID (free, base, dead) and `ours` the
 * machine the build put there; `usual` that machine's usual ID, `why` the reason it moved.
 */
export function idCell(slot: { id: number; state: string; why?: string; name?: string }, noUw: boolean,
  ours?: { name: string; usual: number; why?: string; needsUw?: boolean }): IdCell {
  const id = slot.id;
  if (ours) {
    const moved = ours.usual !== id;
    const title = `${id}: ${ours.name}` +
      (moved ? ` (its usual ID is ${ours.usual}${ours.why ? `: moved, ${ours.why}` : ''})` : '') +
      (ours.needsUw ? ' — plays a UW sample' : '') +
      (id >= 124 && id <= 127 ? ' — the CTR-range fix is applied for this ID' : '');
    return { id, state: 'ours', title, moved, label: ours.name };
  }
  if (noUw && id >= NO_UW_ID_LIMIT) {
    return { id, state: 'nouw', moved: false, label: slot.state === 'base' ? (slot.name ?? '') : '',
      title: `${id}: a Machinedrum without UW cannot use IDs 128 and up (it plays ID ${id - NO_UW_ID_LIMIT} instead)` };
  }
  if (slot.state === 'free') return { id, state: 'free', moved: false, label: '', title: `${id}: free — drop a machine here` };
  return { id, state: slot.state, moved: false, label: slot.state === 'base' ? (slot.name ?? '') : '', title: `${id}: ${slot.why ?? ''}` };
}

/** Whether a machine may be put on this ID: a free one, and below 128 without UW. */
export const usableId = (slot: { id: number; state: string }, noUw: boolean): boolean =>
  slot.state === 'free' && !(noUw && slot.id >= NO_UW_ID_LIMIT);
