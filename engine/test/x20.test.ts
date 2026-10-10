import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecipe, recipeFor, type X20RecipeFile } from '../src/x20_recipe.js';
import { cacheOpsIn, dsp2BootLoader, isCode, siteBytes, stageCode, windowA, writeList, x20Map, evalExpr } from '../src/x20_cf.js';
import { buildX20, trimX20, x20IsaGate } from '../src/x20.js';
import { anchorMismatches, relocationAudit } from '../src/x20_audit.js';
import { decodeLinear } from '../src/isa.js';
import { loadPacks } from '../src/node.js';
import { sha256 } from '../src/bytes.js';
import { Asm } from '../src/cf_asm.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const file = (): X20RecipeFile => JSON.parse(readFileSync(join(ROOT, 'bases/x20.json'), 'utf8'));
const R = parseRecipe(file());

test('x20 recipe: parses, and keeps every model off X.20\'s user-machine IDs (192 and up freeze the OS)', () => {
  assert.equal(R.id, 'x20');
  assert.ok(R.usable.length >= 25);
  assert.ok(R.usable.every((id) => id < 192));
  const f = file();
  f.ids.usable = [...f.ids.usable, 193];
  assert.throws(() => parseRecipe(f), /user-machine range/);
});

test('x20 recipe: the USR install/remove/check routines and the E12B erase guard are patched', () => {
  const usr = R.sites.filter((s) => s.group === 'usr').map((s) => s.at);
  for (const a of [0x21780e, 0x217818, 0x2177a0, 0x2177cc, 0x217c24, 0x217c3e, 0x217c44, 0x217c6a, 0x2660a2, 0x2660b2, 0x2660c6, 0x266134, 0x266160, 0x266188])
    assert.ok(usr.includes(a), `USR site ${a.toString(16)}`);
  const erase = R.sites.find((s) => s.at === 0x20da0a)!;
  assert.deepEqual(erase.value, { jmp: 'ERGUARD' });          // only the E12B instance: the +Drive machine banks erase through it too
});

test('x20 recipe: the boot loader stays clear of the machines\' free regions', () => {
  const f = file();
  f.dsp2.free = [['0x147c01', '0x147e00']];
  assert.throws(() => parseRecipe(f), /overlaps the boot loader/);
});

test('x20: recipe expressions', () => {
  const n = { MENU: 0x2fd000, M_U: 0xf5, CAP: 200 };
  assert.equal(evalExpr('MENU+M_U+2', n), 0x2fd0f7);
  assert.equal(evalExpr('CAP-1', n), 199);
  assert.equal(evalExpr('MENU-0x19a8', n), 0x2fd000 - 0x19a8);
  assert.throws(() => evalExpr('NOPE', n), /unknown name/);
});

test('x20: every site is as long as its anchor, and every code site decodes as ISA_A (no move #imm,(d16,An))', () => {
  const M = x20Map(R, 25, 0x124c06);
  const wa = windowA(R, M, new Map([[6, 0], [42, 10]]), new Uint8Array(64), 0xe6868);
  const names: Record<string, number> = { STACK: M.stack, RECS: M.recs, CAP: M.cap, MENU: M.menu, M_U: M.mU, M_L: M.mL,
    LIST: M.list, LIST_N: M.listN, BANK_END: 0x124c06, HTAB: wa.htab };
  const code: { at: number; bytes: Uint8Array }[] = [];
  const writes: [number, Uint8Array][] = [];
  for (const s of R.sites) {
    const b = siteBytes(s.value, names, wa.asm.labels);
    assert.equal(b.length, s.old.length, `site ${s.at.toString(16)}`);
    writes.push([s.at, b]);
    if (isCode(s.value)) code.push({ at: s.at, bytes: b });
  }
  const boot = dsp2BootLoader(R);
  const st = stageCode(R, writeList(writes), [0x100ca2dc], [0x100cfe18], wa, boot.receiver);
  const mem = [{ what: 'boot code', ram: R.ram.bootCode[0], bytes: st.asm.bytes }, { what: 'window A', ram: R.ram.window[0], bytes: wa.asm.bytes }];
  const ours = (a: number): boolean => mem.some((m) => a >= m.ram && a < m.ram + m.bytes.length);
  const entries = [st.asm.labels.APPLIER, st.asm.labels.DSP2PRE, ...['VALID', 'FAM', 'CLS', 'GUARD', 'ERGUARD', 'COPYLIST', 'USRCHKREC', 'USRINSMENU', 'USRREM'].map((n) => wa.asm.labels[n])];
  const r = x20IsaGate(mem, entries, ours, [...code, ...st.sites]);
  assert.deepEqual(r.rejects.map((i) => `${i.at.toString(16)} ${i.why}`), []);
  assert.ok(r.insns > 300);
  // the negative control: the encoding that froze hardware is refused
  const bad = x20IsaGate([], [], () => false, [{ at: 0x21780e, bytes: Buffer.from('2d7c002fd100ffec', 'hex') }]);
  assert.equal(bad.rejects.length, 1);
  assert.ok(decodeLinear(Buffer.from('4eb9002fc0a04e71', 'hex'), 0).every((i) => i.ok));
});

test('cf_asm: btst #n takes only the ISA_A modes (an absolute address froze hardware)', () => {
  const ok = new Asm(0x1000);
  ok.i('btst', '#0', 'd0'); ok.i('btst', '#1', '2(a5)'); ok.i('rts');
  assert.ok(decodeLinear(ok.assemble().bytes, 0x1000).every((i) => i.ok));
  const bad = new Asm(0x1000);
  bad.i('btst', '#1', '0x600002.l');
  assert.throws(() => bad.assemble(), /static form only/);
});

test('x20: DSP2 boot loader -- receiver and wiper, no cache instruction (they trap on hardware with the cache off)', () => {
  const b = dsp2BootLoader(R);
  assert.equal(b.receiver.length, 38);
  assert.ok(b.receiver.length <= 0x40);
  assert.equal(b.wiper.addr, 0x147d80);
  assert.equal(b.wiper.words[b.wiper.words.length - 1], 0x14f025);
  assert.deepEqual(cacheOpsIn(b.receiver, b.opcodes.receiver), []);
  assert.deepEqual(cacheOpsIn(b.wiper.words, b.opcodes.wiper), []);
  assert.deepEqual(cacheOpsIn([0x000003, 0x0be081, 0x0be080], new Set([0, 1, 2])), [0, 1]);   // pflush, plock (r0); jsr (r0) is not one
});

test('x20: the E12 trim keeps short samples, cuts the quiet tail of long ones with a fade, and pads pairs', () => {
  const long = Array.from({ length: 44100 }, (_, k) => (k < 2000 ? 1000 : 0));      // loud start, silent tail
  const short = Array.from({ length: 1000 }, () => 500);
  const tail = new Array(34).fill(0);
  const enc = (x: number[]): number[] => [...x.map((v) => v & 0xfff), ...tail];
  const { out, trimmed } = trimX20([enc(long), enc(short), null], [], { db: -30, minSeconds: 0.5, cap: null });
  assert.equal(trimmed, 1);
  assert.equal(out[1]!.length, 1000 + 34);
  assert.equal(out[0]!.length, 2000 + 256 + 34);
  assert.equal(out[2], null);
  const paired = trimX20([enc(long), enc(long)], [[0, 1]], { db: -30, minSeconds: 0.5, cap: 0.01 });
  assert.equal(paired.out[0]!.length, paired.out[1]!.length);
});

test('x20: the build refuses any file but the one the recipe names', async () => {
  const { packs, core } = loadPacks([join(ROOT, 'catalog')]);
  await assert.rejects(buildX20(new Uint8Array(100), file(), packs, core, { uw: true, trim: { db: -30, minSeconds: 0.5, cap: 0.55 } }), /hash differs/);
});

// ---- offline, against a decoded X.20 B OS image (KB_X20_OS; never committed)

const OS = process.env.KB_X20_OS;
const osSkip = !OS || !existsSync(OS) ? 'KB_X20_OS is not set to a decoded X.20 B ColdFire image' : false;

test('x20 recipe: every anchor holds in X.20 B', { skip: osSkip }, () => {
  assert.deepEqual(anchorMismatches(R, readFileSync(OS!)), []);
});

test('x20 recipe: relocation audit -- every reference to what the recipe moves is patched or explained', { skip: osSkip }, () => {
  const os = readFileSync(OS!);
  const spec = file().audit!;
  assert.deepEqual(relocationAudit(R, os, spec).unexplained, []);
  // the negative control: without the USR sites the routines behind the RECV FAIL are flagged
  const f = file();
  f.sites = f.sites.filter((s) => s.group !== 'usr');
  const r = relocationAudit(parseRecipe(f), os, spec);
  assert.ok(r.unexplained.length >= 10, r.unexplained.join('\n'));
});

// ---- with firmware (MD_FIRMWARE_DIR holding the X.20 B .syx; skipped without it)

const FW = process.env.MD_FIRMWARE_DIR;
const fwSkip = !FW || !existsSync(FW) ? 'MD_FIRMWARE_DIR is not set to a directory of OS files' : false;

test('firmware: X.20 B builds the bundled catalog, deterministically, with every gate passed', { skip: fwSkip }, async (t) => {
  let syx: Uint8Array | null = null;
  for (const f of readdirSync(FW!).filter((n) => /\.syx$/i.test(n))) {
    const b = readFileSync(join(FW!, f));
    if (recipeFor([file()], await sha256(b))) { syx = b; break; }
  }
  if (!syx) { t.skip('no X.20 B .syx in MD_FIRMWARE_DIR'); return; }
  const { packs, core } = loadPacks([join(ROOT, 'catalog')]);
  const opt = { uw: true, trim: { db: -30, minSeconds: 0.5, cap: 0.55 } };
  const a = await buildX20(syx, file(), packs, core, opt);
  const b = await buildX20(syx, file(), packs, core, opt);
  assert.equal(await sha256(a.output), await sha256(b.output));
  assert.ok(a.report.gates.every((g) => g.ok));
  assert.ok(a.report.machines.every((m) => m.id < 192));
  assert.equal(new Set(a.report.machines.map((m) => m.id)).size, a.report.machines.length);
  const noUw = await buildX20(syx, file(), packs, core, { ...opt, uw: false });
  assert.ok(noUw.report.machines.every((m) => m.id < 128));
});
