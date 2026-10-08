// Feature parity across bases: every option a profile has to qualify (PROFILE_GATED) is either
// qualified on every profiled base, with the evidence, or refused there with the reason. A new
// option, a new base or a dropped entry fails here until the profile says which it is; the
// exemptions in force are listed below, so adding one is a visible change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PROFILE_GATED, type BaseProfileFile } from '../src/bases.js';

const profiles = readdirSync('bases').filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`bases/${f}`, 'utf8')) as BaseProfileFile)
  .filter((p) => p.format === 'md-base/2' && !p.refuse);

/** The exemptions in force: base -> option -> why it is not offered there (in short). */
const EXEMPT: Record<string, Record<string, string>> = {
  'stock-163-prepared': { hostSend: 'silent output in the emulator' },
  x14: { hostSend: 'not qualified' },
  'dev-26912': { unmuteFix: 'the sequencer is entered from DEV\'s add-on', midiChroma: 'MIDI via DEV\'s per-block queue' },
  'dev-26a01': { unmuteFix: 'the sequencer is entered from DEV\'s add-on', midiChroma: 'MIDI via DEV\'s per-block queue', hostSend: 'not qualified' },
};

test('parity: every profile qualifies every gated option with evidence, or refuses it with a reason', () => {
  assert.deepEqual(profiles.map((p) => p.id).sort(), ['dev-26912', 'dev-26a01', 'stock-163-prepared', 'x14']);
  const rows: string[] = [];
  for (const p of profiles) {
    for (const k of Object.keys(PROFILE_GATED)) {
      const o = p.options?.[k];
      assert.ok(o, `${p.id}: no entry for ${k} (${PROFILE_GATED[k]}): qualify it ({ ok: true, evidence }) or exempt it ({ ok: false, why })`);
      if (o.ok) assert.ok(o.evidence && o.evidence.trim().length > 10, `${p.id} ${k}: qualified without evidence`);
      else assert.ok(o.why && o.why.trim().length > 10, `${p.id} ${k}: refused without a reason`);
      rows.push(`${p.id} ${PROFILE_GATED[k]}: ${o.ok ? 'yes' : `exempt (${o.why})`}`);
    }
    const exempt = Object.keys(PROFILE_GATED).filter((k) => !p.options![k].ok).sort();
    assert.deepEqual(exempt, Object.keys(EXEMPT[p.id] ?? {}).sort(), `${p.id}: the exemptions changed; update EXEMPT here (and docs/BASES.md) if that is intended`);
  }
  console.log(rows.join('\n'));
});

test('parity: the gated options are the ones the page and CLI offer per base', () => {
  assert.deepEqual(PROFILE_GATED, { hostSend: '--host-reorder', unmuteFix: '--unmute-fix', midiChroma: '--midi-chroma' });
});
