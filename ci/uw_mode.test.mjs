import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// web/src/uw-mode.ts: the UW question's gate and what the ID map and menu preview show per answer.
const source = readFileSync(new URL('../web/src/uw-mode.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const U = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/src/app.ts', import.meta.url), 'utf8');

test('the first step cannot be left unanswered, or with Not sure', () => {
  assert.equal(U.gate(null, true).ok, false);
  assert.match(U.gate(null, true).why, /UW option/);
  const unsure = U.gate('unsure', true);
  assert.equal(unsure.ok, false);
  assert.match(unsure.why, /ROM and RAM categories/);              // tells them how to check
  assert.equal(U.gate('yes', true).ok, true);
  assert.equal(U.gate('no', true).ok, true);
  assert.equal(U.gate('no', false).ok, false);                      // and the OS file is still needed
});

test('the page asks on step 1 with nothing pre-selected, and every way forward goes through the gate', () => {
  const q = html.match(/<fieldset id="uw-question"[\s\S]*?<\/fieldset>/);
  assert.ok(q, 'the question is on the page');
  const step1 = html.slice(html.indexOf('<section id="step-1"'), html.indexOf('<section id="step-2"'));
  assert.ok(step1.includes('id="uw-question"'), 'on the first step');
  const radios = [...q[0].matchAll(/<input type="radio" name="uw" value="(\w+)"([^>]*)>/g)];
  assert.deepEqual(radios.map((r) => r[1]), ['yes', 'no', 'unsure']);
  assert.ok(radios.every((r) => !/checked/.test(r[2])), 'no answer is pre-selected');
  assert.match(html, /id="firmware-next" class="wizard-primary" disabled/);
  // showStep refuses any step past the first, and the Next button follows the same gate
  const show = app.slice(app.indexOf('function showStep('), app.indexOf('function status('));
  assert.match(show, /gate\(uwAnswer, !!fw\)/);
  assert.match(show, /n > 1 && !asked\.ok/);
  assert.match(app, /\$\('firmware-next'\)\.toggleAttribute\('disabled', !asked\.ok/);
});

test('answers round-trip through files and storage; anything else is unanswered', () => {
  assert.equal(U.uwOf('yes'), true);
  assert.equal(U.uwOf('no'), false);
  assert.equal(U.uwOf('unsure'), undefined);
  assert.equal(U.uwOf(null), undefined);
  for (const a of ['yes', 'no']) assert.equal(U.answerOf(U.uwOf(a)), a);
  assert.equal(U.answerOf(undefined), null);                        // an old layout: ask again
  assert.equal(U.readStored(() => 'no'), 'no');
  assert.equal(U.readStored(() => 'unsure'), null);
  assert.equal(U.readStored(() => null), null);
  assert.equal(U.readStored(() => { throw new Error('blocked'); }), null);
  assert.equal(U.noUwOf('no'), true);
  assert.equal(U.noUwOf('yes'), false);
});

const STOCK = ['GND', 'TRX', 'EFM', 'E12', 'P-I', 'INP', 'MID', 'CTR', 'ROM', 'RAM'];

test('menu preview: with UW unchanged, without UW no ROM and RAM (the limit counts what is shown, as plan.ts does)', () => {
  assert.deepEqual(U.shownStock(STOCK, false), STOCK);
  assert.deepEqual(U.shownStock(STOCK, true), STOCK.slice(0, 8));
  assert.equal('menuLimit' in U, false);
});

test('ID map with UW: as before', () => {
  const free = U.idCell({ id: 175, state: 'free' }, false);
  assert.equal(free.state, 'free');
  assert.equal(U.usableId({ id: 175, state: 'free' }, false), true);
  const pw = U.idCell({ id: 175, state: 'free' }, false, { name: 'OSCPW', usual: 175 });
  assert.deepEqual([pw.state, pw.moved, pw.label], ['ours', false, 'OSCPW']);
  assert.equal(U.idCell({ id: 128, state: 'base', name: 'ROM01', why: 'its own ROM01' }, false).state, 'base');
});

test('ID map without UW: 128 and up unusable with the reason, moves and UW-only models explained', () => {
  for (const s of [{ id: 128, state: 'base', name: 'ROM01' }, { id: 175, state: 'free' }, { id: 191, state: 'base', name: 'ROM48' }]) {
    const c = U.idCell(s, true);
    assert.equal(c.state, 'nouw');
    assert.match(c.title, /without UW cannot use IDs 128 and up/);
    assert.equal(U.usableId(s, true), false);
  }
  assert.equal(U.idCell({ id: 127, state: 'free' }, true).state, 'free');
  assert.equal(U.usableId({ id: 127, state: 'free' }, true), true);
  const moved = U.idCell({ id: 16, state: 'free' }, true, { name: 'OSCPW', usual: 175, why: 'an ID a Machinedrum without UW cannot use (128 and up)' });
  assert.equal(moved.moved, true);
  assert.match(moved.title, /usual ID is 175: moved, an ID a Machinedrum without UW cannot use/);
  const wav = U.idCell({ id: 30, state: 'free' }, false, { name: 'WAVMR', usual: 30, needsUw: true });
  assert.match(wav.title, /plays a UW sample/);
});

test('the first step offers to restore a previous session, a Kitbasher .syx included, and the earlier IDs', () => {
  const step1 = html.slice(html.indexOf('<section id="step-1"'), html.indexOf('<section id="step-2"'));
  assert.match(step1, /id="restore"/);
  assert.match(step1, /id="project-file" type="file" accept="[^"]*\.syx/);
  assert.match(step1, /id="legacy-ids"/);
  assert.match(html, /id="ids-warning"/);
  // a restored project never ticks a model this unit cannot play (it would plan with it first)
  assert.match(app, /want\.has\(i\.dataset\.module!\) && !i\.disabled/);
  const refresh = app.slice(app.indexOf('function refresh('), app.indexOf('function refresh(') + 300);
  assert.match(refresh, /applyNoUw\(\);/);
});
