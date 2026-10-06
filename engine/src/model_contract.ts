// Runtime subset of md-model/1. The source schema lives in docs/model-manifest.schema.json.
// Reject unsupported obligations even if a pack was constructed without the Python exporter.
import type { PackModel } from './packs.js';
import { fromBase64 } from './bytes.js';
import { checkDynamicPlans, type ModelPanel } from './model_panel.js';

export interface ModelContract {
  format: 'md-model/1'; key: string; version: string; kit_abi: number;
  injection: { mode: 'add' | 'replace'; id?: number; target?: { family: string; name: string; abi: string } };
  panel: ModelPanel;
  components: Record<string, { provider?: string; entry?: string; source?: string; tables?: string; law?: string; abi: string }>;
  memory: { kind: string; space: string; words: number; alignment: number; lifetime: string; init: string; release: string }[];
  samples: unknown[];
  budget: { render_cps: number; trigger_cycles: number; init_cycles: number; dsp1_cps?: number };
  provenance: unknown[];
}

export function requireInjection(c: ModelContract): void {
  if (c.format !== 'md-model/1') throw new Error('unsupported model manifest format');
  if (c.injection.mode !== 'add') throw new Error('unsupported injection: replace requires stock-target discovery and callback ABI adapter');
}

export function checkModelContract(m: PackModel, category: string): void {
  const c = m.contract;
  if (!c) return; // md-pack/1 models without a manifest contract skip these checks.
  requireInjection(c);
  const assembly = typeof c.components.dsp2?.source === 'string';
  if (c.key !== m.key || (assembly ? c.injection.id !== undefined || m.id !== 0 : c.injection.id !== m.id) || c.panel.name !== m.name || c.panel.category !== category)
    throw new Error(`${m.key}: manifest identity differs from exported descriptor`);
  if (c.panel.knobs.length !== 8 || c.panel.knobs.some((k, i) => k.label !== m.labels[i] || k.default !== m.defaults[i]))
    throw new Error(`${m.key}: manifest panel differs from exported descriptor`);
  checkDynamicPlans(c.panel, m.dyn_labels);
  if (c.components.dsp2.abi !== 'md-voice/1' || (assembly
      ? Object.keys(c.components).some(k => k !== 'dsp2' && k !== 'dsp1_drive') || !!c.components.dsp2.provider
      : Object.keys(c.components).join(',') !== 'dsp2' || c.components.dsp2.provider !== 'python'))
    throw new Error(`${m.key}: unsupported component contract`);
  const v = c.memory.find(v => v.kind === 'voice');
  const pi = c.memory.find(v => v.kind === 'pi');
  const hasPi = assembly && c.memory.length === 2 && pi?.kind === 'pi' && pi.space === 'XY' && pi.words === 1536 &&
      pi.alignment === 512 && pi.lifetime === 'track-assignment' && ['chunked', 'chunked-muted'].includes(pi.init) && pi.release === 'plain-audio';
  const scratch = c.memory.find(v => v.kind === 'private');
  const hasScratch = assembly && c.memory.length === 2 && !!scratch && ['X','Y','XY'].includes(scratch.space) &&
      Number.isInteger(scratch.words) && scratch.words > 0 && scratch.words <= 2048 &&
      Number.isInteger(scratch.alignment) && scratch.alignment > 0 && scratch.alignment <= 2048 &&
      !(scratch.alignment & (scratch.alignment - 1)) && scratch.lifetime === 'track-assignment' &&
      scratch.init === 'model' && scratch.release === 'successor-init' &&
      Object.keys(scratch).every(k => ['kind','space','words','alignment','lifetime','init','release'].includes(k));
  const drive = c.components.dsp1_drive;
  if (drive && (!assembly || drive.abi !== 'md-track-drive/1' || !drive.source || drive.law !== m.dsp1_drive))
    throw new Error(`${m.key}: drive source/contract mismatch`);
  if ((!hasPi && !hasScratch && c.memory.length !== 1) || !v || v.kind !== 'voice' || v.space !== 'XY' || v.words !== 64 || v.alignment !== 64 ||
      v.lifetime !== 'track-assignment' || v.init !== 'model' || v.release !== 'successor-init' ||
      c.samples.length || !!m.workspace !== hasScratch || (hasScratch ? m.workspace_kind !== 'private' : hasPi ? m.workspace_kind !== 'pi' : !!m.workspace_kind) ||
      m.pi_clean || (!drive && m.dsp1_drive) || m.needs?.length)
    throw new Error(`${m.key}: unsupported resource contract`);
  if (![c.budget.render_cps, c.budget.trigger_cycles, c.budget.init_cycles].every(v => Number.isFinite(v) && v >= 0))
    throw new Error(`${m.key}: invalid budget claims`);
  if (drive && (typeof c.budget.dsp1_cps !== 'number' || !Number.isFinite(c.budget.dsp1_cps) || c.budget.dsp1_cps < 0))
    throw new Error(`${m.key}: invalid DSP1 budget claim`);
  const bytes = fromBase64(m.code.words).length;
  if (!bytes || bytes % 3) throw new Error('invalid DSP word stream');
  const n = bytes / 3;
  if (Object.values(m.code.entry).some(v => !Number.isInteger(v) || v < 0 || v >= n)) throw new Error('entry outside code');
  for (const [i, sym, weight] of m.code.relocs) {
    if (!Number.isInteger(i) || i < 0 || i >= n || !Number.isInteger(weight) || !weight || Math.abs(weight) > 4 ||
        (sym !== '@org' && !Object.hasOwn(m.code.symbols, sym))) throw new Error('invalid model relocation');
  }
}
