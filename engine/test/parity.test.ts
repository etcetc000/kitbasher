// Feature parity across bases: every option a profile has to qualify (PROFILE_GATED) is either
// qualified on every profiled base, with the evidence, or refused there with the reason; every
// other feature discovery reports must be found on every profiled base (checked on the real files
// with firmware). A new option, a new base, a new feature or a dropped entry fails here until the
// profile or the lists below say which it is; the exemptions in force are listed below, so adding
// one is a visible change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotPatchable, PROFILE_GATED, resolveBase, type BaseProfileFile, type Resolved } from '../src/bases.js';
import { readFirmware } from '../src/container.js';
import { SUPPORT_KEYS } from '../src/discover.js';
import { loadBases } from '../src/node.js';
import { prepare163 } from '../src/prepare.js';

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

// ---- every feature, not only the gated options

/** Features discovery reports that are not profile-gated, and must therefore be found on every profiled base. */
const FOUND_EVERYWHERE = ['dynLabels', 'dsp1Drive', 'descFlash', 'ramWindow', 'idFixes', 'piClean', 'dsp1Recover', 'cpuIndicator',
  'ctrControlAll', 'modelRuntime', 'uwMenu'];

test('parity: every discovered feature is profile-gated or on the found-on-every-base list', () => {
  const gated = Object.keys(PROFILE_GATED);
  assert.deepEqual(gated.filter((k) => FOUND_EVERYWHERE.includes(k)), [], 'a feature is on both lists');
  assert.deepEqual([...SUPPORT_KEYS].sort(), [...gated, ...FOUND_EVERYWHERE].sort(),
    'a feature discovery reports is neither gated nor on FOUND_EVERYWHERE: gate it by profile (and qualify or exempt it on every base), or list it');
  for (const ex of Object.values(EXEMPT)) for (const k of Object.keys(ex)) assert.ok(gated.includes(k), `${k} is exempted but not profile-gated`);
});

// ---- with firmware (MD_FIRMWARE_DIR: a directory of OS files you own; skipped without it)

const FW = process.env.MD_FIRMWARE_DIR;
const fwSkip = !FW || !existsSync(FW) ? 'MD_FIRMWARE_DIR is not set to a directory of OS files' : false;

test('firmware: what each profiled base really supports differs only where EXEMPT says so', { skip: fwSkip }, async () => {
  const set = loadBases('bases');
  const got = new Map<string, Resolved>();
  for (const f of readdirSync(FW!).filter((n) => /\.(bin|syx)$/i.test(n))) {
    let bytes: Uint8Array = readFileSync(join(FW!, f));
    let r: Resolved;
    try {
      try { r = await resolveBase(readFirmware(bytes), set); }
      catch (e) {
        if (!(e instanceof NotPatchable) || e.profile?.id !== 'stock-163') continue;
        bytes = (await prepare163(bytes)).output;
        r = await resolveBase(readFirmware(bytes), set);
      }
    } catch { continue; }
    if (r.profile && !got.has(r.profile.id)) got.set(r.profile.id, r);
  }
  assert.ok(got.size >= 2, `fewer than two profiled bases in ${FW}`);
  for (const k of SUPPORT_KEYS) {
    const oks = [...got].map(([id, r]) => [id, r.base.support[k]] as const);
    for (const [id, s] of oks) {
      assert.ok(s, `${id}: no support entry for ${k}`);
      if (!s.ok) assert.ok(EXEMPT[id]?.[k], `${id}: ${k} is not supported (${s.why}) but not exempted, while ${oks.filter(([, x]) => x.ok).map(([i]) => i).join(', ') || 'no base'} support it`);
      else assert.ok(!EXEMPT[id]?.[k], `${id}: ${k} is exempted but supported`);
    }
  }
  // a profile's refusal is what the user reads, even where discovery also failed
  for (const [id, r] of got) {
    for (const k of Object.keys(PROFILE_GATED)) {
      const o = r.profile!.options![k];
      if (!o.ok) assert.ok((r.base.support as unknown as Record<string, { why: string }>)[k].why.startsWith(`refused on this base: ${o.why}`), `${id} ${k}`);
    }
  }
});
