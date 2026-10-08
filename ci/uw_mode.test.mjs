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

test('the first step cannot be left without a Yes or a No; there is no third answer', () => {
  assert.equal(U.gate(null, true).ok, false);
  assert.match(U.gate(null, true).why, /Yes or No.*UW option/);
  for (const other of ['unsure', 'maybe', undefined, '', true]) assert.equal(U.gate(other, true).ok, false);
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
  assert.deepEqual(radios.map((r) => r[1]), ['yes', 'no']);
  assert.ok(radios.every((r) => !/checked/.test(r[2])), 'no answer is pre-selected');
  assert.doesNotMatch(html, /Not sure/);
  // how to check: one small line, always visible, the same words as HOW_TO_CHECK
  assert.ok(q[0].includes(`<p class="fine" id="uw-help">${U.HOW_TO_CHECK}</p>`));
  assert.match(html, /id="firmware-next" class="wizard-primary" disabled/);
  // showStep refuses any step past the first, and the Next button follows the same gate
  const show = app.slice(app.indexOf('function showStep('), app.indexOf('function status('));
  assert.match(show, /n > 1 && needsUwAnswer\(\)/);
  const needs = app.slice(app.indexOf('function needsUwAnswer('), app.indexOf('async function onBuild('));
  assert.match(needs, /gate\(uwAnswer, !!fw\)/);
  assert.match(app, /\$\('firmware-next'\)\.toggleAttribute\('disabled', !asked\.ok/);
});

test('answers are saved in files; nothing pre-fills the answer, not storage and not a file', () => {
  assert.equal(U.uwOf('yes'), true);
  assert.equal(U.uwOf('no'), false);
  assert.equal(U.uwOf(null), undefined);
  // no stored answer: nothing to read back, and the page neither reads nor writes one
  for (const k of ['readStored', 'UW_STORAGE_KEY', 'answerOf']) assert.equal(k in U, false, k);
  assert.doesNotMatch(app, /kitbasher\.uw|UW_STORAGE_KEY|readStored/);
  assert.match(app, /setUwAnswer\(null\);/);                         // the page starts unanswered
  // the answer is set in one place only, from the user's click on a radio
  assert.deepEqual([...app.matchAll(/setUwAnswer\(([^)]*)\)/g)].map((m) => m[1]).sort(),
    ["a: UwAnswer", "null", "r.value === 'yes' ? 'yes' : 'no'"].sort());
  assert.equal(U.noUwOf('no'), true);
  assert.equal(U.noUwOf('yes'), false);
});

test("a restored file's answer is a hint only: the gate stays closed and the build refuses", () => {
  assert.equal(U.fileHint(true), 'This layout was saved for a Machinedrum with UW.');
  assert.equal(U.fileHint(false), 'This layout was saved for a Machinedrum without UW.');
  assert.equal(U.fileHint(undefined), null);
  const file = app.slice(app.indexOf('function fileAnswer('), app.indexOf('// ---- restoring a previous session'));
  assert.doesNotMatch(file, /setUwAnswer|uwAnswer =[^=]/);              // never sets the answer
  assert.match(file, /\$\('uw-file-hint'\)/);
  assert.match(html, /<p class="fine" id="uw-file-hint" hidden><\/p>/);
  assert.equal(U.gate(null, true).ok, false);                       // so with only a file, nothing proceeds
});

test('the build and download refuse without an answer, whatever path reached them', () => {
  assert.equal(U.uwForBuild('yes'), true);
  assert.equal(U.uwForBuild('no'), false);
  for (const a of [null, undefined, 'unsure']) assert.throws(() => U.uwForBuild(a), /Yes or No/);
  // the build takes the answer through uwForBuild (and engine build refuses a missing uw too)
  const bw = app.slice(app.indexOf('function buildWith('), app.indexOf('function showStorage('));
  assert.match(bw, /const uw = uwForBuild\(uwAnswer\);/);
  assert.doesNotMatch(bw, /uwOf\(/);
  // onBuild (Build, Continue, step tabs, keyboard) checks first, as does the background check and the download link
  const onBuild = app.slice(app.indexOf('async function onBuild('), app.indexOf('async function onBuild(') + 200);
  assert.match(onBuild, /if \(needsUwAnswer\(\)\) return;/);
  assert.match(app, /current\?\.ok \|\| !gate\(uwAnswer, true\)\.ok\) \{/);
  assert.match(app, /a\.addEventListener\('click', \(e\) => \{ if \(needsUwAnswer\(\)\) e\.preventDefault\(\); \}\);/);
  // the auto-advance after an OS load goes through the gate
  assert.match(app, /if \(fw && gate\(uwAnswer, true\)\.ok\) showStep\(2\);/);
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

test('step 1: one OS drop zone; restoring sits in a collapsed "Restore an earlier layout" with one drop zone', () => {
  const step1 = html.slice(html.indexOf('<section id="step-1"'), html.indexOf('<section id="step-2"'));
  assert.equal((step1.match(/type="file"/g) ?? []).length, 2);              // the OS, and the restore drop
  const restore = step1.match(/<details id="restore"[^>]*>([\s\S]*?)<\/details>/);
  assert.ok(restore, 'a disclosure');
  assert.doesNotMatch(restore[0], /<details[^>]* open/);                     // collapsed by default
  assert.match(restore[1], /<summary>Restore an earlier layout<\/summary>/);
  assert.match(restore[1], /id="project-file" type="file" accept="\.syx,\.bin,\.json/);
  assert.doesNotMatch(step1, /legacy-ids|before October 2026/);              // no preset: the previous .syx is the record
  assert.doesNotMatch(step1, /Keep your kits/);                              // no big box
  // the UW question: one row, no always-on effect line, the how-to-check line always shown
  const q = step1.match(/<fieldset id="uw-question"[\s\S]*?<\/fieldset>/)[0];
  assert.doesNotMatch(q, /uw-effect/);
  assert.match(q, /<p class="fine" id="uw-help">To check:/);
  // a Kitbasher build dropped as the OS is not built on: its layout comes back and the stock OS is asked for
  assert.match(app, /That's a Kitbasher build: layout restored\. Now drop the stock \$\{want\?\.name \?\? 'OS'\} it was built on\./);
  // the Download note: one quiet line, hidden once something is restored
  assert.match(html, /<p id="ids-warning" class="fine" hidden><\/p>/);
  assert.match(app, /Machine IDs are assigned fresh\./);
  // a restored project never ticks a model this unit cannot play (it would plan with it first)
  assert.match(app, /want\.has\(i\.dataset\.module!\) && !i\.disabled/);
  const refresh = app.slice(app.indexOf('function refresh('), app.indexOf('function refresh(') + 300);
  assert.match(refresh, /applyNoUw\(\);/);
});

test('the Download warning shows whenever nothing was restored; a map for another OS is applied, not dropped', () => {
  assert.match(app, /\$\('ids-warning'\)\.hidden = layoutEd\.restoredFrom !== null;/);
  assert.doesNotMatch(app, /kitbasher\.built/);
  const ui = readFileSync(new URL('../web/src/layout-ui.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /so it was set aside/);
  assert.match(ui, /private rebase\(\)/);
  assert.match(ui, /clear\(\): void \{ this\.map = null; this\.restoredFrom = null; \}/);
  assert.doesNotMatch(app, /legacyFor|legacy-ids|legacy_ids/);
});
