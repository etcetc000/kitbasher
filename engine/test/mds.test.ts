import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CMD, X20_CAPS, concat, crc32, decodeMessage, encodeMessage, hex, machineMessages, parseCaps, parsePackage, parseSlots, parseSysex, planBank, type MdsMachine, type MdsMessage, type MdsSnapshot } from '../src/mds.js';
import { MdsClient, MIDI_CONNECTION_ERROR, type MdsTransport } from '../src/mds_transfer.js';
const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../../mds/${name}`, import.meta.url)));
const bank = await parseSysex(file('tx6/tx6-bank.syx'));
const kick = bank[0];
const empty = (): MdsSnapshot => ({ generation: 2, caps: { ...X20_CAPS }, slots: Array.from({ length: 16 }, (_, slot) => ({ slot, flags: 0, model: 194 + slot, words: 0, bytes: 0, alias: '', contentId: '0000000000000000' })) });
function installed(s: MdsSnapshot, slot: number, machine: MdsMachine) {
  const old = s.slots[slot]; s.caps.freeWords += (old.flags & 1 ? old.words : 0) - machine.words; s.caps.freeBytes += (old.flags & 1 ? old.bytes : 0) - machine.bytes.length;
  s.slots[slot] = { slot, model: 194 + slot, flags: 5, words: machine.words, bytes: machine.bytes.length, alias: machine.alias, contentId: machine.contentId.slice(0, 16) }; s.generation++;
}
function capsBody(s: MdsSnapshot) {
  const b = new Uint8Array(38), d = new DataView(b.buffer), c = s.caps;
  [c.maxPackage, c.maxWords, c.maxPacket, c.totalWords, c.freeWords, c.totalBytes, c.freeBytes].forEach((n, i) => d.setUint16(i * 2, n));
  b.set([16, 194, 209, 1], 14); d.setUint16(18, 1); d.setUint32(22, c.features); d.setUint32(30, 71680); d.setUint32(34, c.trackLimit * 16); return b;
}
function slotsBody(s: MdsSnapshot) {
  const b = new Uint8Array(356), d = new DataView(b.buffer); d.setUint32(0, s.generation);
  for (const p of s.slots) { const at = 4 + 22 * p.slot; b[at] = p.flags; b[at + 1] = p.model; d.setUint16(at + 2, p.words); d.setUint16(at + 4, p.bytes); b.set(new TextEncoder().encode(p.alias).slice(0, 8), at + 6); b.set(Buffer.from(p.contentId, 'hex'), at + 14); } return b;
}
function ack(m: MdsMessage, committed = m.command === CMD.end, id = kick.contentId): Uint8Array {
  const body = new Uint8Array(14); body[0] = m.command; body[1] = committed ? 1 : 0;
  if (committed) { new DataView(body.buffer).setUint32(2, 9); body.set(Buffer.from(id.slice(0, 16), 'hex'), 6); }
  return encodeMessage(CMD.ack, m.transaction, m.slot, m.sequence, body);
}
class FakeMidi implements MdsTransport {
  time = 0; sent: Uint8Array[] = []; replies: Uint8Array[] = [];
  constructor(readonly respond: (m: MdsMessage, io: FakeMidi) => Uint8Array[]) {}
  send(bytes: Uint8Array) { this.sent.push(bytes.slice()); this.replies.push(...this.respond(decodeMessage(bytes), this)); }
  async receive(timeout: number) { const reply = this.replies.shift(); this.time += reply ? 1 : timeout; return reply ?? null; }
  client() { return new MdsClient(this, () => this.time, 20, 1000); }
}

test('capability query matches the published protocol byte vector', () => {
  assert.equal(hex(encodeMessage(CMD.caps, 1)), 'f000203c020074010600017f7f00017f0009f7');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('connection check stops after five seconds without sending any machine data', async () => {
  const io = new FakeMidi(() => []);
  await assert.rejects(new MdsClient(io, () => io.time).snapshot(), { message: MIDI_CONNECTION_ERROR });
  assert.equal(io.time, 5000);
  assert.deepEqual(io.sent.map(b => decodeMessage(b).command), [CMD.slots]);
});

test('connection deadline is shared across replies, retries and unrelated traffic', async () => {
  const io = new FakeMidi(m => m.command === CMD.slots
    ? [encodeMessage(CMD.slotsReply, m.transaction, 127, 127, slotsBody(empty()))]
    : [encodeMessage(CMD.capsReply, (m.transaction + 1) % 16384, 127, 127, capsBody(empty()))]);
  const receive = io.receive.bind(io);
  io.receive = async ms => { const b = await receive(ms); if (b) io.time += 1199; return b; };
  await assert.rejects(new MdsClient(io, () => io.time, 2000).snapshot(), { message: MIDI_CONNECTION_ERROR });
  assert.equal(io.time, 5000);
  assert.deepEqual(io.sent.map(b => decodeMessage(b).command), [CMD.slots, CMD.caps, CMD.caps]);
});

test('query WAIT retries the same read-only request within the five-second connection budget', async () => {
  let queries = 0;
  const io = new FakeMidi(m => {
    if (queries++ === 0) return [encodeMessage(CMD.wait, m.transaction, 127, 127, Uint8Array.of(m.command, 11))];
    return [encodeMessage(m.command === CMD.slots ? CMD.slotsReply : CMD.capsReply, m.transaction, 127, 127, m.command === CMD.slots ? slotsBody(empty()) : capsBody(empty()))];
  });
  assert.deepEqual(await new MdsClient(io, () => io.time).snapshot(), empty());
  assert.deepEqual(io.sent[0], io.sent[1]);
  assert.ok(io.time >= 2000 && io.time < 5000);
  assert.deepEqual(io.sent.map(b => decodeMessage(b).command), [CMD.slots, CMD.slots, CMD.caps, CMD.slots]);
});

test('persistent query WAIT still times out after five seconds without machine data', async () => {
  const io = new FakeMidi(m => [encodeMessage(CMD.wait, m.transaction, 127, 127, Uint8Array.of(m.command, 11))]);
  await assert.rejects(new MdsClient(io, () => io.time).snapshot(), { message: MIDI_CONNECTION_ERROR });
  assert.equal(io.time, 5000);
  assert.equal(io.sent.length, 3);
  assert.ok(io.sent.every(b => decodeMessage(b).command === CMD.slots));
});

test('query WAIT accepts a deferred reply without resending and ignores unrelated WAIT', async () => {
  const io = new FakeMidi(m => [
    encodeMessage(CMD.wait, m.transaction, 127, 127, Uint8Array.of(m.command, 11)),
    encodeMessage(m.command === CMD.slots ? CMD.slotsReply : CMD.capsReply, m.transaction, 127, 127, m.command === CMD.slots ? slotsBody(empty()) : capsBody(empty())),
  ]);
  assert.deepEqual(await new MdsClient(io, () => io.time).snapshot(), empty());
  assert.equal(io.sent.length, 3);
  const unrelated = new FakeMidi(m => [encodeMessage(CMD.wait, m.transaction, 127, 127, Uint8Array.of(CMD.end, 11))]);
  await assert.rejects(new MdsClient(unrelated, () => unrelated.time).snapshot(), { message: MIDI_CONNECTION_ERROR });
  assert.equal(unrelated.sent.length, 1);
});

test('post-commit query WAIT does not interrupt an eight-machine installation', async () => {
  const machines = (await Promise.all(['BD', 'CB', 'CL', 'CP', 'CY', 'HH', 'MA', 'RS'].map(name => parseSysex(file(`core/TX8/TX8-${name}.syx`))))).flat();
  const s = empty(), reviewed = structuredClone(s); let busyUntil = 0;
  const io = new FakeMidi((m, io) => {
    if (m.command === CMD.slots || m.command === CMD.caps) {
      if (io.time < busyUntil) return [encodeMessage(CMD.wait, m.transaction, 127, 127, Uint8Array.of(m.command, 11))];
      return [encodeMessage(m.command === CMD.slots ? CMD.slotsReply : CMD.capsReply, m.transaction, 127, 127, m.command === CMD.slots ? slotsBody(s) : capsBody(s))];
    }
    if (m.command === CMD.end) { installed(s, m.slot, machines[m.slot]); busyUntil = io.time + 1500; }
    return [ack(m, m.command === CMD.end, machines[m.slot].contentId)];
  });
  const result = await new MdsClient(io, () => io.time).install(machines.map((machine, slot) => ({ machine, slot })), reviewed, () => {});
  assert.equal(result.stopped, false);
  assert.deepEqual(result.snapshot.slots.slice(0, 8).map(s => s.contentId), machines.map(m => m.contentId.slice(0, 16)));
  assert.equal(io.sent.filter(b => decodeMessage(b).command === CMD.header).length, 8);
});
test('real released bank decodes; destinations change without changing package identity', async () => {
  assert.equal(bank.length, 8); assert.equal(kick.version, '2.1'); assert.equal(kick.parameters.find(p => p.name === 'XL')?.max, 127);
  const tight = bank.find(m => m.alias === 'TX6-CP')?.parameters.find(p => p.name === 'TGHT');
  assert.ok(tight); assert.equal(tight.default, 0); assert.equal(tight.max, 127);
  for (const machine of bank) {
    assert.equal(machine.version, '2.1');
    assert.deepEqual(machine.parameters.slice(0, 2).map(p => p.name), ['TUNE', 'DEC']);
  }
  const frames = machineMessages(kick, 15, 14200); const [again] = await parseSysex(concat(frames));
  assert.deepEqual(again.bytes, kick.bytes); assert.ok(frames.every(f => decodeMessage(f).slot === 15));
  assert.equal(hex(concat(machineMessages(kick, 0, 1))), hex(file('tx6/bd/bd.syx')));
});
test('rejects bad checksums, unused packing bits, truncation and unrelated SysEx', async () => {
  const wire = encodeMessage(2, 7, 0, 0, Uint8Array.of(255)); wire[15] ^= 1; assert.throws(() => decodeMessage(wire), /checksum/);
  const packed = encodeMessage(2, 7, 0, 0, Uint8Array.of(255)); packed[14] |= 1; packed[packed.length - 4]++; assert.throws(() => decodeMessage(packed), /packing/);
  await assert.rejects(parseSysex(file('tx6/bd/bd.syx').slice(0, -1)), /Incomplete/);
  await assert.rejects(parseSysex(Uint8Array.from([240, 1, 2, 247])), /MDS/);
});
test('rejects reordered packets, inconsistent descriptor and corrupted package content ID', async () => {
  const frames = machineMessages(kick, 0, 1); [frames[1], frames[2]] = [frames[2], frames[1]]; await assert.rejects(parseSysex(concat(frames)), /reordered/);
  const bad = kick.bytes.slice(); bad[88] ^= 1; const d = new DataView(bad.buffer); d.setUint32(84, 0); d.setUint32(84, crc32(bad)); await assert.rejects(parsePackage(bad), /content ID/);
  const f = machineMessages(kick, 0, 1), header = decodeMessage(f[0]); header.body[10] ^= 1; f[0] = encodeMessage(1, 1, 0, 127, header.body); await assert.rejects(parseSysex(concat(f)), /descriptor/);
});
test('accepts interspersed realtime bytes without counting them in the checksum', async () => {
  const bytes = file('tx6/bd/bd.syx'); const withClock = Uint8Array.from(Array.from(bytes).flatMap((v, i) => i % 9 ? [v] : [v, 248]));
  assert.equal((await parseSysex(withClock))[0].contentId, kick.contentId);
});
test('device capabilities and slot readback are decoded at protocol offsets', () => {
  const s = empty(); installed(s, 3, kick); assert.deepEqual(parseCaps(capsBody(s)), s.caps); assert.deepEqual(parseSlots(slotsBody(s)), { generation: s.generation, slots: s.slots });
});
test('capacity includes untouched machines, replacement deltas, exact fits and duplicates', () => {
  const s = empty(); installed(s, 0, bank[7]); installed(s, 10, bank[1]);
  const p = planBank([{ slot: 0, machine: kick }], s); assert.equal(p.words, kick.words + bank[1].words); assert.equal(p.bytes, kick.bytes.length + bank[1].bytes.length); assert.equal(p.occupied, 2);
  assert.ok(planBank([{ slot: 0, machine: kick }, { slot: 0, machine: bank[1] }]).problems.length);
  const exact = empty(); exact.caps.totalWords = exact.caps.freeWords = kick.words; exact.caps.totalBytes = exact.caps.freeBytes = kick.bytes.length; assert.deepEqual(planBank([{ slot: 0, machine: kick }], exact).problems, []);
  exact.caps.totalWords--; exact.caps.freeWords--; assert.match(planBank([{ slot: 0, machine: kick }], exact).problems.join(), /DSP words/);
});
test('in-use replacements and missing services block; already valid installed machines skip', () => {
  const s = empty(); installed(s, 0, kick); s.slots[0].flags |= 8;
  assert.equal(planBank([{ slot: 0, machine: kick }], s).changes.length, 0);
  assert.match(planBank([{ slot: 0, machine: bank[1] }], s).problems.join(), /in use/);
  s.caps.features = 0; assert.match(planBank([{ slot: 1, machine: kick }], s).problems.join(), /services/);
});
test('finds a fitting replacement order when greedy growth would block both resources', () => {
  const s = empty(); s.caps.totalWords = s.caps.totalBytes = 10; s.caps.freeWords = s.caps.freeBytes = 2;
  for (let i = 0; i < 3; i++) s.slots[i] = { ...s.slots[i], flags: 5, words: 4, bytes: 4 };
  const machine = (w: number, b: number) => ({ ...kick, words: w, bytes: new Uint8Array(b) });
  const p = planBank([{ slot: 0, machine: machine(6, 6) }, { slot: 1, machine: machine(5, 0) }, { slot: 2, machine: machine(0, 5) }], s);
  assert.deepEqual(p.problems, []); assert.deepEqual(p.changes.map(a => a.slot), [1, 2, 0]);
});
test('final fit does not permit an impossible intermediate bank', () => {
  const s = empty(); s.caps.totalWords = s.caps.totalBytes = 10; s.caps.freeWords = s.caps.freeBytes = 0;
  for (let i = 0; i < 2; i++) s.slots[i] = { ...s.slots[i], flags: 5, words: 5, bytes: 5 };
  const p = planBank([{ slot: 0, machine: { ...kick, words: 6, bytes: new Uint8Array(4) } }, { slot: 1, machine: { ...kick, words: 4, bytes: new Uint8Array(6) } }], s);
  assert.match(p.problems.join(), /No safe replacement order/);
});
test('WAIT and unrelated ACKs do not advance; every packet waits for its matching ACK', async () => {
  const io = new FakeMidi(m => [encodeMessage(CMD.wait, m.transaction, m.slot, m.sequence, Uint8Array.of(m.command, 0)), encodeMessage(CMD.ack, m.transaction + 1, m.slot, m.sequence, new Uint8Array(14)), ack(m)]);
  await io.client().send(kick, 3); assert.equal(io.sent.length, Math.ceil(kick.bytes.length / 420) + 2);
});
test('lost final ACK retries the identical End of Dump, without restarting the header', async () => {
  let ends = 0; const io = new FakeMidi(m => m.command === CMD.end && ends++ === 0 ? [] : [ack(m)]);
  await io.client().send(kick, 0); const sent = io.sent.map(decodeMessage);
  assert.equal(sent.filter(m => m.command === CMD.header).length, 1); assert.equal(sent.filter(m => m.command === CMD.end).length, 2); assert.deepEqual(io.sent.at(-1), io.sent.at(-2));
});
test('repair NAK resends a named packet once; repeated corruption and terminal NAK stop', async () => {
  let repaired = false; const io = new FakeMidi(m => { if (m.command === CMD.data && m.sequence === 2 && !repaired) { repaired = true; return [encodeMessage(CMD.nak, m.transaction, m.slot, 1, Uint8Array.of(2, 6, 0, 1))]; } return [ack(m)]; });
  await io.client().send(kick, 0); assert.equal(io.sent.map(decodeMessage).filter(m => m.command === 2 && m.sequence === 1).length, 2);
  const twice = new FakeMidi(m => [encodeMessage(CMD.nak, m.transaction, m.slot, m.sequence, Uint8Array.of(m.command, 6, 0, 1))]); await assert.rejects(twice.client().send(kick, 0), /twice/);
  const terminal = new FakeMidi(m => [encodeMessage(CMD.nak, m.transaction, m.slot, m.sequence, Uint8Array.of(m.command, 18, 15, 111))]); await assert.rejects(terminal.client().send(kick, 0), /Cycle budget/); assert.equal(terminal.sent.length, 1);
});
test('timeouts never fall back to open loop; a final mismatched content ID never succeeds', async () => {
  const silent = new FakeMidi(() => []); await assert.rejects(silent.client().send(kick, 0), /timed out/); assert.equal(silent.sent.length, 4); assert.ok(silent.sent.every(b => decodeMessage(b).command === CMD.header));
  const wrong = new FakeMidi(m => [ack(m, m.command === CMD.end, '00'.repeat(32))]); await assert.rejects(wrong.client().send(kick, 0), /did not confirm/);
});
test('WAIT has a bounded deadline and CANCEL terminates', async () => {
  const waiting = new FakeMidi((m, io) => { io.time += 1100; return [encodeMessage(CMD.wait, m.transaction, m.slot, m.sequence, Uint8Array.of(m.command, 0))]; });
  // Replenish WAIT without sending anything else.
  waiting.receive = async () => { waiting.time += 1100; return encodeMessage(CMD.wait, decodeMessage(waiting.sent[0]).transaction, 0, 127, Uint8Array.of(1, 0)); };
  await assert.rejects(waiting.client().send(kick, 0), /WAIT/); assert.equal(waiting.sent.length, 1);
  const cancelled = new FakeMidi(m => [encodeMessage(CMD.cancel, m.transaction, m.slot, m.sequence, Uint8Array.of(m.command, 0))]); await assert.rejects(cancelled.client().send(kick, 0), /cancelled/);
});
test('installation refuses a changed reviewed bank before sending a header', async () => {
  const reviewed = empty(), changed = empty(); changed.generation++;
  const io = new FakeMidi(m => [encodeMessage(m.command === CMD.slots ? CMD.slotsReply : CMD.capsReply, m.transaction, 127, 127, m.command === CMD.slots ? slotsBody(changed) : capsBody(changed))]);
  await assert.rejects(io.client().install([{ slot: 0, machine: kick }], reviewed, () => {}), /changed since the connection check/); assert.ok(io.sent.every(b => decodeMessage(b).command !== CMD.header));
});

test('missing MIDI return path prevents any machine data from being sent', async () => {
  const io = new FakeMidi(() => []);
  await assert.rejects(io.client().install([{ slot: 0, machine: kick }], empty(), () => {}), { message: MIDI_CONNECTION_ERROR });
  assert.equal(io.sent.length, 3);
  assert.ok(io.sent.every(bytes => decodeMessage(bytes).command === CMD.slots));
});
test('successful installation requires valid readback and preserves untouched slots', async () => {
  const s = empty(); installed(s, 15, bank[1]); const reviewed = structuredClone(s);
  const io = new FakeMidi(m => {
    if (m.command === CMD.slots) return [encodeMessage(CMD.slotsReply, m.transaction, 127, 127, slotsBody(s))];
    if (m.command === CMD.caps) return [encodeMessage(CMD.capsReply, m.transaction, 127, 127, capsBody(s))];
    if (m.command === CMD.end) installed(s, m.slot, kick); return [ack(m)];
  });
  const result = await io.client().install([{ slot: 0, machine: kick }], reviewed, () => {}); assert.equal(result.snapshot.slots[0].contentId, kick.contentId.slice(0, 16)); assert.deepEqual(result.snapshot.slots[15], reviewed.slots[15]);
});
test('final committed ACK without a matching slot readback fails installation', async () => {
  const s = empty();
  const io = new FakeMidi(m => {
    if (m.command === CMD.slots) return [encodeMessage(CMD.slotsReply, m.transaction, 127, 127, slotsBody(s))];
    if (m.command === CMD.caps) return [encodeMessage(CMD.capsReply, m.transaction, 127, 127, capsBody(s))];
    return [ack(m)];
  });
  await assert.rejects(io.client().install([{ slot: 0, machine: kick }], s, () => {}), /did not verify/);
});
test('stop request completes one machine and never starts the next', async () => {
  const s = empty(), reviewed = structuredClone(s); let stop = false;
  const io = new FakeMidi(m => {
    if (m.command === CMD.slots) return [encodeMessage(CMD.slotsReply, m.transaction, 127, 127, slotsBody(s))];
    if (m.command === CMD.caps) return [encodeMessage(CMD.capsReply, m.transaction, 127, 127, capsBody(s))];
    if (m.command === CMD.data) stop = true;
    if (m.command === CMD.end) installed(s, m.slot, kick);
    return [ack(m)];
  });
  const result = await io.client().install([{ slot: 0, machine: kick }, { slot: 1, machine: bank[1] }], reviewed, () => {}, () => stop);
  assert.equal(result.stopped, true); assert.equal(s.slots[0].flags, 5); assert.equal(s.slots[1].flags, 0);
  assert.equal(io.sent.map(decodeMessage).filter(m => m.command === CMD.header).length, 1);
});
test('changing an untouched slot during a commit stops remaining installs', async () => {
  const s = empty(), reviewed = structuredClone(s);
  const io = new FakeMidi(m => {
    if (m.command === CMD.slots) return [encodeMessage(CMD.slotsReply, m.transaction, 127, 127, slotsBody(s))];
    if (m.command === CMD.caps) return [encodeMessage(CMD.capsReply, m.transaction, 127, 127, capsBody(s))];
    if (m.command === CMD.end) { installed(s, m.slot, kick); installed(s, 15, bank[2]); }
    return [ack(m)];
  });
  await assert.rejects(io.client().install([{ slot: 0, machine: kick }, { slot: 1, machine: bank[1] }], reviewed, () => {}), /Another slot changed/);
  assert.equal(io.sent.map(decodeMessage).filter(m => m.command === CMD.header).length, 1);
});
test('disconnection rejects immediately without sending subsequent packets', async () => {
  const io = new FakeMidi(() => []); io.receive = async () => { throw new Error('MIDI device disconnected'); };
  await assert.rejects(io.client().send(kick, 0), /disconnected/); assert.equal(io.sent.length, 1);
});
