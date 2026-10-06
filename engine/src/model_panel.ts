// Independently validate author MODE zones and bind them to the exported label plan.
import type { DynPlan } from './features.js';

export interface PanelMode { knob: number; zones: { min: number; max: number; labels: Record<string, string> }[] }
export interface ModelPanel { name: string; category: string; knobs: { label: string; default: number }[]; modes: PanelMode[] }

export function dynamicPlans(panel: ModelPanel): DynPlan[] {
  const raw = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 127;
  const knob = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < 8;
  const caption = (s: string): boolean => typeof s === 'string' && /^[ -~]{0,4}$/.test(s);
  if (!Array.isArray(panel.knobs) || panel.knobs.length !== 8 ||
      panel.knobs.some(k => !k || !caption(k.label) || !raw(k.default)) || !Array.isArray(panel.modes))
    throw new Error('invalid manifest panel');
  const claimed = new Set<number>(), selectors = new Set<number>();
  return panel.modes.map(mode => {
    if (!mode || !knob(mode.knob) || selectors.has(mode.knob) || !Array.isArray(mode.zones) || !mode.zones.length)
      throw new Error('invalid or duplicate MODE selector');
    selectors.add(mode.knob);
    const zones = [...mode.zones].sort((a, b) => a.min - b.min);
    const targets = new Set<number>();
    const stop_of: number[] = [];
    for (const [stop, z] of zones.entries()) {
      if (!z || !raw(z.min) || !raw(z.max) || z.min !== stop_of.length || z.max < z.min ||
          !z.labels || typeof z.labels !== 'object' || Array.isArray(z.labels) || !Object.keys(z.labels).length)
        throw new Error('MODE zones must cover 0..127 exactly once');
      for (const [key, value] of Object.entries(z.labels)) {
        if (!/^[0-7]$/.test(key) || !caption(value)) throw new Error('invalid MODE caption');
        targets.add(Number(key));
      }
      while (stop_of.length <= z.max) stop_of.push(stop);
    }
    if (stop_of.length !== 128) throw new Error('MODE zones must cover 0..127 exactly once');
    const mask = [...targets].sort((a, b) => a - b);
    for (const k of mask) {
      if (claimed.has(k)) throw new Error('two MODE selectors cannot write the same caption');
      claimed.add(k);
    }
    const text = zones.map(z => mask.map(k => (z.labels[String(k)] ?? panel.knobs[k].label).padEnd(4)).join('')).join('');
    let formula: [number, number, number] | null = null;
    search: for (let n = 1; n < 256; n++) for (let a = 0; a < 8; a++) for (let b = 0; b < 16; b++) {
      if (stop_of.every((s, r) => (((r >> a) * n) >> b) === s)) { formula = [a, n, b]; break search; }
    }
    return { knob: mode.knob, mask, stop_of, formula, stops: zones.length, blocks: btoa(text) };
  });
}

export function checkDynamicPlans(panel: ModelPanel, actual: DynPlan[]): void {
  const expected = dynamicPlans(panel);
  if (!Array.isArray(actual) || expected.length !== actual.length || expected.some((p, i) => {
    const a = actual[i];
    return !a || p.knob !== a.knob || p.stops !== a.stops || p.blocks !== a.blocks ||
      JSON.stringify(p.mask) !== JSON.stringify(a.mask) || JSON.stringify(p.stop_of) !== JSON.stringify(a.stop_of) ||
      JSON.stringify(p.formula) !== JSON.stringify(a.formula);
  })) throw new Error('manifest MODE labels differ from exported descriptor');
}
