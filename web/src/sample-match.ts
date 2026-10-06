// Which E12 machine a dropped file is for, from its name: "Kick 01.wav" -> BD, "open_hat.aif" -> OH.
// Used by the Samples step's bulk drop (web/src/samples-ui.ts), which shows the result for review
// before anything is converted. No imports, so ci/sample_match.test.mjs can load it alone.

/** The E12 machines in Machinedrum order, as the pad grid lays them out. */
export const E12_CODES = ['BD', 'SD', 'HT', 'LT', 'CP', 'RS', 'CB', 'CH', 'OH', 'RC', 'CC', 'BR', 'TA', 'TR', 'SH', 'BC'] as const;
export type E12Code = typeof E12_CODES[number];

export interface Match { name: string; code: E12Code | null; part: 'main' | 'layer'; why?: string }

export const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc)$/i;

/** Lower-case words of a file name: extension dropped, split at punctuation, digits and camelCase. */
export function words(name: string): string[] {
  const stem = name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return stem.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, '$1$3 $2$4')
    .toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^\d+$/.test(w));
}

// Phrases first (two words in either order), then single words, most specific first: "snare rim"
// is a rimshot, "open hat" an open hat, "hat" alone a closed one.
const PHRASES: [string, string, E12Code][] = [
  ['hi', 'tom', 'HT'], ['high', 'tom', 'HT'], ['lo', 'tom', 'LT'], ['low', 'tom', 'LT'],
  ['open', 'hat', 'OH'], ['open', 'hihat', 'OH'], ['open', 'hh', 'OH'],
  ['closed', 'hat', 'CH'], ['closed', 'hihat', 'CH'], ['closed', 'hh', 'CH'],
  ['bass', 'drum', 'BD'], ['side', 'stick', 'RS'], ['cow', 'bell', 'CB'],
];
const WORDS: [string[], E12Code][] = [
  [['bd', 'kick', 'kik', 'kck', 'bassdrum'], 'BD'],
  [['rs', 'rim', 'rimshot', 'sidestick'], 'RS'],
  [['sd', 'snare', 'snr'], 'SD'],
  [['ht', 'hitom', 'hightom', 'tomhi'], 'HT'],
  [['lt', 'lotom', 'lowtom', 'tomlo'], 'LT'],
  [['cp', 'clap', 'handclap'], 'CP'],
  [['cb', 'cowbell'], 'CB'],
  [['oh', 'ohh', 'ohat', 'open', 'openhat'], 'OH'],
  [['ch', 'chh', 'chat', 'closed', 'closedhat', 'hat', 'hihat', 'hh'], 'CH'],
  [['rc', 'ride'], 'RC'],
  [['cc', 'crash'], 'CC'],
  [['br', 'brush'], 'BR'],
  [['ta', 'tamb', 'tambo', 'tambourine'], 'TA'],
  [['tr', 'trash'], 'TR'],
  [['sh', 'shaker', 'shake', 'maraca', 'maracas'], 'SH'],
  [['bc', 'bigclap'], 'BC'],
];
const LAYER = ['layer', 'ring', 'noise'];

/** One file's machine, or null with why. `part` is 'layer' when the name says so (two-sample machines). */
export function matchName(name: string): Match {
  const w = words(name);
  const has = (x: string): boolean => w.includes(x);
  const part: Match['part'] = w.some((x) => LAYER.includes(x)) ? 'layer' : 'main';
  for (const [a, b, code] of PHRASES) if (has(a) && has(b)) return { name, code, part };
  for (const [list, code] of WORDS) if (list.some(has)) return { name, code, part };
  return { name, code: null, part, why: w.length ? 'no machine in its name' : 'no name to go by' };
}

/**
 * Match a set of files. Audio files only (others are reported unmatched); a second file for a
 * machine and part already taken is unmatched too, so nothing is silently dropped.
 */
export function matchFiles(names: string[]): Match[] {
  const taken = new Map<string, string>();
  return names.map((name) => {
    if (!AUDIO_EXT.test(name)) return { name, code: null, part: 'main', why: 'not a WAV or AIFF file' };
    const m = matchName(name);
    if (!m.code) return m;
    const key = `${m.code}/${m.part}`;
    if (taken.has(key)) return { name, code: null, part: m.part, why: `${m.code} is already taken by ${taken.get(key)}` };
    taken.set(key, name);
    return m;
  });
}
