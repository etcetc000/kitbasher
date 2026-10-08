import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { be32, u32 } from '../src/bytes.js';
import type { Base } from '../src/bases.js';
import type { CorePack } from '../src/packs.js';
import { ramImage, resolveFeatures } from '../src/plan.js';
import { decodeLinear } from '../src/isa.js';
import { parseSig, reader, type CodeImage } from '../src/sig.js';
import { checkUnmuteCode, findUnmute, GRACE_TICKS, UNMUTE_SIGNATURES as SIG, unmuteBlock, unmutePatches, type Unmute } from '../src/unmute.js';

// Synthetic sequencers: every piece the fix is written against, laid out from the engine's own
// signatures (wildcards zero, captures given) at the addresses the 1.63-derived bases have them, with
// each base's own MIDI send and interrupt level. No firmware is read.

const DATA = {
  playLocks: 0x28d14c, slot: 0x7120ca, localOn: 0x71217a, dispatch: 0x206c8e, midiOut: 0x1001560, buf: 0x28d152,
  lockCnt: 0x28d13c, muteHi: 0x1001530, revMap: 0x7120dc,
  qa: 0x28d2e4, ca: 0x28d156, qaoff: 0x28d344, caoff: 0x28d15e, qb: 0x28d3a4, cb: 0x28d16e, qboff: 0x28d404, cboff: 0x28d176,
};
const SKIP = 0x23abfa, NOTE_QUEUE = 0x23aac0;

/** A signature's bytes with its captures filled in; `marks` and capture offsets for branch fix-ups. */
function lay(sig: string, caps: Record<string, number>, at: number): { bytes: Uint8Array; mark: (n: string) => number } {
  const s = parseSig(sig);
  const b = Uint8Array.from(s.bytes, (x) => x ?? 0);
  for (const c of s.caps) {
    const v = caps[c.name] ?? caps[c.name.replace(/\d$/, '')];
    if (v === undefined) continue;
    for (let k = 0; k < c.size; k++) b[c.at + k] = (v >>> (8 * (c.size - 1 - k))) & 0xff;
  }
  const mark = (n: string): number => {
    const m = s.marks.find((x) => x.name === n) ?? s.caps.find((x) => x.name === n);
    if (!m) throw new Error(n);
    return at + m.at;
  };
  return { bytes: b, mark };
}

interface Shape { uart: number; ipl: number; dev?: boolean }
const X14: Shape = { uart: 0x2d945c, ipl: 0x2400 };
const X13: Shape = { uart: 0x2d7daa, ipl: 0x2400 };
const P163: Shape = { uart: 0x213dc4, ipl: 0x2700 };
const DEV: Shape = { uart: 0x213dc4, ipl: 0x2700, dev: true };

function slot(shape: Shape): CodeImage {
  const img = new Uint8Array(0x50000);
  const put = (at: number, b: Uint8Array): void => img.set(b, at - 0x200000);
  const caps = { ...DATA, uart: shape.uart, ipl: shape.ipl };
  put(0x239762, lay(SIG.tick, caps, 0x239762).bytes);
  put(0x239f90, lay(SIG.playB, caps, 0x239f90).bytes);
  put(0x20cc70, lay(SIG.noteOn, caps, 0x20cc70).bytes);
  put(NOTE_QUEUE, lay(SIG.noteQueue, caps, NOTE_QUEUE).bytes);
  const w = lay(SIG.write, caps, 0x23ab14);
  assert.equal(w.mark('skip'), SKIP);
  put(0x23ab14, w.bytes);
  // the branch displacements, from the layout: every mute test goes to "next track"
  const b0 = lay(SIG.build, caps, 0x23a908);
  const disp = (opcodeAt: number, to: number): number => (to - (opcodeAt + 2)) & 0xffff;
  const s2 = b0.mark('s2');
  const b = lay(SIG.build, { ...caps, sk1: disp(b0.mark('sk1') - 2, SKIP), sk2: disp(s2 + 4, SKIP), sk3: disp(s2 + 10, SKIP) }, 0x23a908);
  put(0x23a908, b.bytes);
  const c0 = lay(SIG.classBranch, caps, 0x23aa10);
  put(0x23aa10, lay(SIG.classBranch, { ...caps, nq: disp(c0.mark('s3') + 2, NOTE_QUEUE) }, 0x23aa10).bytes);
  if (shape.dev) {
    // DEV enters its own code from the tick worker's entry and from the build's buffer toggle
    put(0x239762, Uint8Array.of(0x4e, 0xf9, 0x00, 0x2d, 0x68, 0x68, 0x4e, 0x71));
    put(0x23a908, Uint8Array.of(0x4e, 0xb9, 0x00, 0x2f, 0x3f, 0xa0));
  }
  return { what: 'ColdFire slot', ram: 0x200000, bytes: img };
}

const found = (shape: Shape): Unmute => {
  const r = findUnmute([slot(shape)]);
  assert.ok(r.unmute, r.why);
  return r.unmute;
};

test('discovery: the five sites and everything the routines call, on X.14, X.13 and prepared 1.63', () => {
  for (const shape of [X14, X13, P163]) {
    const U = found(shape);
    assert.deepEqual(U.sites.map((s) => [s.name, s.at, s.old.length]), [
      ['build start', 0x23a92c, 6], ['mute test', 0x23a9a2, 8], ['class branch', 0x23aa20, 6], ['step play', 0x2397e0, 6], ['tick', 0x23976a, 6]]);
    assert.deepEqual([U.dispatch, U.uartSend, U.skipTo, U.noteQueue, U.ipl], [0x206c8e, shape.uart, SKIP, NOTE_QUEUE, shape.ipl]);
    assert.deepEqual([U.mute, U.buf, U.lockCnt, U.playLocks, U.slot, U.localOn, U.revMap, U.midiOut],
      [0x1001520, 0x28d152, 0x28d13c, 0x28d14c, 0x7120ca, 0x71217a, 0x7120dc, 0x1001560]);
    assert.deepEqual(U.queues.map((q) => [q.base, q.count, q.on]),
      [[0x28d2e4, 0x28d156, true], [0x28d344, 0x28d15e, false], [0x28d3a4, 0x28d16e, true], [0x28d404, 0x28d176, false]]);
  }
});

test('discovery refuses a base that rewrites the tick worker or the build (DEV), and one whose pieces disagree', () => {
  const dev = findUnmute([slot(DEV)]);
  assert.equal(dev.unmute, null);
  assert.match(dev.why, /tick worker: not found/);
  // the B queue played through another dispatcher than the A queue
  const img = slot(X14);
  img.bytes.set(be32(0x206000), 0x239faa + 2 - 0x200000);
  const odd = findUnmute([img]);
  assert.equal(odd.unmute, null);
  assert.match(odd.why, /dispatchers differ/);
  // a mute test that no longer skips to the build loop's "next track"
  const img2 = slot(X14);
  img2.bytes.set([0x00, 0x10], 0x23a9a8 - 0x200000);
  assert.match(findUnmute([img2]).why, /"next track" targets differ/);
});

// The routines at 0x2be754, X.14: these 720 bytes are the build the emulator measurements were made on.
const X14_BLOCK_SHA256 = '09ab5ebce12063be2005385e59df8ea30a62965b134d53750851063d22cfcc26';

test('the routines: 642 bytes of ISA_A code and 78 of data, calling only what discovery found', () => {
  for (const shape of [X14, X13, P163]) {
    const U = found(shape);
    const b = unmuteBlock(U, 0x2be754);
    assert.equal(b.codeBytes, 642);
    assert.equal(b.bytes.length, 720);
    assert.equal(b.grace, GRACE_TICKS);
    const c = checkUnmuteCode(U, b.bytes.subarray(0, b.codeBytes), b.at);
    assert.deepEqual(c.problems, []);
    const ins = decodeLinear(b.bytes.subarray(0, b.codeBytes), b.at);
    const calls = ins.filter((i) => i.target !== undefined && (i.target < b.at || i.target >= b.at + b.bytes.length)).map((i) => i.target);
    assert.deepEqual([...new Set(calls)].sort(), [U.dispatch, U.uartSend, U.skipTo, U.noteQueue].sort());
    // h_tick runs the kept notes at the queue loops' own interrupt level
    const ipl = ins.filter((i) => u32(b.bytes, i.at - b.at) >>> 16 === 0x46fc).map((i) => (b.bytes[i.at - b.at + 2] << 8) | b.bytes[i.at - b.at + 3]);
    assert.deepEqual(ipl, [shape.ipl]);
    const g = b.labels.grace - b.at;
    assert.ok(b.bytes.subarray(b.codeBytes).every((x, k) => x === (b.codeBytes + k === g ? GRACE_TICKS : 0)), 'the data starts zeroed, the grace set');
  }
  const x14 = unmuteBlock(found(X14), 0x2be754);
  assert.equal(createHash('sha256').update(x14.bytes).digest('hex'), X14_BLOCK_SHA256);
  assert.throws(() => unmuteBlock(found(X14), 0x2be756), /4-aligned/);
});

test('the patched sequencer words, per base: each site becomes jsr <routine> (+ nop), as whole longwords', () => {
  for (const shape of [X14, X13, P163]) {
    const img = slot(shape);
    const U = found(shape);
    const b = unmuteBlock(U, 0x2be754);
    const { patches, checks, ranges } = unmutePatches(U, b, reader([img]));
    assert.deepEqual(patches.map(([a, v]) => [a.toString(16), v.toString(16).padStart(8, '0')]), [
      ['23a92c', '4eb9002b'], ['23a930', 'e75442b9'],              // build start -> h_clr; then the base's next clr.l
      ['23a9a2', '4eb9002b'], ['23a9a6', 'e76e4e71'],              // mute test -> h_mute; nop
      ['23aa20', '4eb9002b'], ['23aa24', 'e77a2079'],              // class branch -> h_cls; then the base's movea.l
      ['2397e0', '4eb9002b'], ['2397e4', 'e7ca4a90'],              // step play -> h_play; then the base's tst.l (a0)
      ['23976a', '4eb9002b'], ['23976e', 'e9246700'],              // tick -> h_tick; then the base's beq
    ]);
    assert.deepEqual([b.labels.h_clr, b.labels.h_mute, b.labels.h_cls, b.labels.h_play, b.labels.h_tick], [0x2be754, 0x2be76e, 0x2be77a, 0x2be7ca, 0x2be924]);
    // what each longword holds in the base, and the replaced instructions
    const rd = reader([img]);
    for (const [a, v] of checks) assert.equal(v, u32(rd(a, 4)!, 0));
    assert.deepEqual(ranges, [[0x23a92c, 0x23a932], [0x23a9a2, 0x23a9aa], [0x23aa20, 0x23aa26], [0x2397e0, 0x2397e6], [0x23976a, 0x239770]]);
    // the patched sites decode as the calls they are
    const out = img.bytes.slice();
    for (const [a, v] of patches) out.set(be32(v), a - 0x200000);
    for (const [lo, hi] of ranges) {
      const ins = decodeLinear(out.subarray(lo - 0x200000, hi - 0x200000), lo);
      assert.ok(ins.every((i) => i.ok), `${lo.toString(16)}: ${ins.map((i) => i.name)}`);
      assert.equal(ins[0].target, U.sites.map((s) => b.labels[s.label])[ranges.findIndex((r) => r[0] === lo)]);
    }
  }
  // a site that is no longer what discovery found is refused
  const img = slot(X14);
  const U = found(X14);
  img.bytes[0x23a92c - 0x200000] = 0x4e;
  assert.throws(() => unmutePatches(U, unmuteBlock(U, 0x2be754), reader([img])), /not what discovery found/);
});

// ---- the option: on by default where the base has it, off leaves the build as it was

const fixture = (unmute: Unmute | null): Base => ({
  name: 'fixture', support: { unmuteFix: unmute ? { ok: true, why: 'found' } : { ok: false, why: 'the tick worker: not found' } },
  os: { descriptorSize: 86, familyTable: 0, cfBase: 0, familyCount: 0, levBar: { ctr: { ids: [124, 127] }, low: { ids: [88, 95] } } },
  ext: { base: 0x2bc000, end: 0x2bd000 },
  features: { dynLabels: { segment: [0x2be100, 0x2bef60] }, unmute },
} as unknown as Base);
const core = { knob_callback: 'cAlOdQ==', dyn: { call_size: 6 } } as unknown as CorePack;
const ram = (base: Base, unmute?: boolean) => ramImage(base, new Uint8Array(8), core, [], [],
  { dyn: false, dsp1: null, host: false, ind: null, toFlash: new Set(), dynFlash: new Set(), idSpace: 192, flashAt: 0x100e0000, redrawValues: 0, unmute });

test('resolveFeatures: on by default where found; off when asked; asked for where not found is a problem', () => {
  const yes = fixture(found(X14)), no = fixture(null);
  assert.equal(resolveFeatures(yes, {}).unmute, true);
  assert.equal(resolveFeatures(yes, { unmuteFix: false }).unmute, false);
  const quiet = resolveFeatures(no, {});
  assert.equal(quiet.unmute, false);
  assert.deepEqual(quiet.problems, []);
  assert.match(quiet.notes.join(' '), /unmute-latency fix .*not supported on fixture: the tick worker: not found/);
  const asked = resolveFeatures(no, { unmuteFix: true });
  assert.equal(asked.unmute, false);
  assert.match(asked.problems.join(' '), /unmute-latency fix/);
});

test('off: the RAM image is the one the build had before; on: the routines alone in the label RAM range', () => {
  const base = fixture(found(X14));
  const before = ram(base);
  const off = ram(base, false);
  assert.deepEqual(off, before);
  assert.equal(off.unmute, null);
  const on = ram(base, true);
  assert.deepEqual(on.image, before.image);                 // the main RAM image is untouched
  assert.equal(on.bytes, before.bytes);
  assert.equal(on.dyn, null);
  assert.ok(on.unmute);
  assert.equal(on.unmute.home, 'own');
  assert.equal(on.unmute.block.at, 0x2be100);
  assert.equal(on.unmute.segment!.length, 720);
  assert.equal(on.unmute.limit, 0x2bef60 - 0x2be100);
  assert.deepEqual(on.unmute.segment, unmuteBlock(found(X14), 0x2be100).bytes);
});

test('the CLI takes --unmute-fix or --no-unmute-fix, not both', () => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const r = spawnSync(process.execPath, [cli, '--in', 'missing.syx', '--out', 'out.syx', '--uw', '--unmute-fix', '--no-unmute-fix'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /--unmute-fix and --no-unmute-fix: choose one/);
  assert.doesNotMatch(r.stderr, /ENOENT/);                                       // refused before reading the input
});
