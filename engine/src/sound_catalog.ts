// The sound categories the page browses by, and the machine-select menu categories built from them.
// Descriptions are keyed by the model's panel name; a pack can also carry its own (`browse`).
// Categories describe a primary use; many machines cover several types of sound.
import type { PackModel } from './packs.js';

export const categories = [
  'Kick drums', 'Snares, rims & claps', 'Hi-hats & cymbals', 'Toms & hand percussion',
  'FM synthesis', 'Synths & textures', 'Physical modeling', 'Effects',
] as const;
type Category = typeof categories[number];
export const OTHER = 'Other models';

/** The machine-select menu shows 3 characters of a category name. */
export const MENU_CODES: Record<Category | typeof OTHER, string> = {
  'Kick drums': 'KIK', 'Snares, rims & claps': 'SNR', 'Hi-hats & cymbals': 'HAT', 'Toms & hand percussion': 'PRC',
  'FM synthesis': 'FM', 'Synths & textures': 'SYN', 'Physical modeling': 'PHY', 'Effects': 'FX',
  [OTHER]: 'OTH',
};

type Entry = { category: Category; description: string };
const entry = (category: Category, description: string): Entry => ({ category, description });
export const catalog: Record<string, Entry> = {
  VADBD: entry('Kick drums', 'Seven analog kick recreations: punch, round, FM, toy, soft, crisp and wood.'),
  VADSD: entry('Snares, rims & claps', 'Five analog snare recreations with body, noise, transient and drive controls.'),
  VADRC: entry('Snares, rims & claps', 'Two rimshots, plus an analog clap.'),
  VADPC: entry('Toms & hand percussion', 'Boom, low, mid and high toms, conga and ping percussion.'),
  VADHH: entry('Hi-hats & cymbals', 'Six analog hat recreations: two closed and two open hats, a third hat and a six-oscillator hat build.'),
  VADCY: entry('Hi-hats & cymbals', 'Two cymbals and a ride, plus two cowbells.'),
  VADSY: entry('Synths & textures', 'Eight dual-VCO configurations, two plain oscillator modes and a bit voice.'),
  OSCAC: entry('Synths & textures', 'Resonant acid bass with filter envelope, slide and random intervals.'),
  FMS4O: entry('FM synthesis', 'Four-operator FM with eight algorithms, ratio controls and feedback.'),
  OSCSP: entry('Synths & textures', 'Saw, pulse-width modulation and sub oscillator with detuning.'),
  VOXFR: entry('Synths & textures', 'A formant oscillator with barrel, air and feedback controls.'),
  WAVSP: entry('Synths & textures', 'Spectral-array scanning with tilt, focus and partial shaping.'),
  FMS2O: entry('FM synthesis', 'An FM voice with two frequency controls, feedback and a tone control.'),
  FMS3O: entry('FM synthesis', 'An FM voice with three frequency controls and separate modulation envelopes.'),
  FMSSW: entry('FM synthesis', 'An FM voice with frequency envelopes, operator balance and feedback.'),
  WAVTB: entry('Synths & textures', 'A digital wave voice with wave selection, position, modulation and oscillator sync.'),
  OSCSW: entry('Synths & textures', 'A sawtooth synth with unison spread and two sub oscillators.'),
  WAVMR: entry('Synths & textures', 'Two digital wave oscillators with timed wave crossfades, blend and separate bit-reduction controls.'),
  WAVCH: entry('Synths & textures', 'Four digital wave oscillators with chord intervals and an ensemble chorus.'),
  OSCCH: entry('Synths & textures', 'Four chord oscillators with wave shape, pulse width and an ensemble chorus.'),
  OSC8B: entry('Synths & textures', 'A SID-style synth with pulse-width motion, waveform selection, sync and ring modulation.'),
  OSCPW: entry('Synths & textures', 'A pulse synth with pulse-width control, unison spread and sub oscillators.'),
  NZEPL: entry('Synths & textures', 'Thirty noise and drone programs after the Befaco Noise Plethora: clusters, cross-modulation, filtered noise, walks and grains.'),
  VOXVO: entry('Synths & textures', 'A vocal synth with two vowel controls, voice selection, formant and resonance.'),
};
export function describe(name: string): { category: string; description: string } {
  return catalog[name.trim()] ?? { category: OTHER, description: 'Select this model to explore its synthesis controls.' };
}

export const isCategory = (c: unknown): c is Category => typeof c === 'string' && (categories as readonly string[]).includes(c);

/**
 * A model's browsing entry: what its pack says (`browse`, so a pack can sort and describe models
 * this catalog does not list), else the built-in catalog by name.
 */
export function describeModel(m: Pick<PackModel, 'name' | 'browse'>): { category: string; description: string } {
  const own = describe(m.name);
  return {
    category: isCategory(m.browse?.category) ? m.browse!.category! : own.category,
    description: m.browse?.description ?? own.description,
  };
}

/** The menu category a machine gets when no map places it: its sound category's code. */
export const menuCategory = (m: Pick<PackModel, 'name' | 'browse'>): string =>
  MENU_CODES[describeModel(m).category as Category | typeof OTHER];

/** Menu categories in browsing order, as a sort key. */
export const menuOrder = (code: string): number => {
  const i = Object.values(MENU_CODES).indexOf(code);
  return i < 0 ? Object.keys(MENU_CODES).length : i;
};
