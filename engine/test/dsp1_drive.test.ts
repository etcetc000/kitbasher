import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fromWordsLE} from '../src/bytes.js';
import {dsp1Window,dsp1SenderSites} from '../src/discover.js';
import {drivePlacementProblems, linkDrive, type Dsp1Core, type Dsp1Law} from '../src/features.js';

const encoded = (words: number[]) => Buffer.from(fromWordsLE(words)).toString('base64');
const hook = [0x062080, 0x26e, ...Array(15).fill(0), 0x0c006f];
const upload = (extra: number[] = []) => [0, 0x25e, hook.length, ...hook, ...extra, 3, 0];
const core: Dsp1Core = {
  head: [{space: 0, addr: 0x25e, words: encoded([0x0af080, 0xa08])}], tail: [], laws: [],
  dispatch: {base: 0xa08, limit: 0xc00, test: encoded([0x0141c4, 1]), jump: 0x0af0aa, tail: encoded([0x0af080, 0x26f])},
  cache_bytes: 16, stock_sender: 0, transport: {bytes: '', params: {}, fields: []},
};
const parent: Dsp1Law = {name: 'parent', rank: 0, emit: 0, requires: [], words: encoded([0x0af080, 0x26f]),
  org: 0xa80, entry: 0, relocs: [], records: []};
const child: Dsp1Law = {name: 'child', rank: 1, emit: 1, requires: ['parent'],
  words: encoded([0x0af080, 0xa80, 0x0af080, 0xaa0]), org: 0xaa0, entry: 0,
  relocs: [[1, '@parent', 1], [3, '@org', 1]], records: []};
const laws = new Map([['parent', parent], ['child', child]]);

test('drive sender discovery includes direct add-on calls and preserves register-loop routing',()=>{
  const image=(ram:number,hex:string)=>({what:'synthetic code',ram,bytes:Buffer.from(hex,'hex')});
  const os=[image(0x200000,'4eb9010007024e75'),image(0x1000000,'4eb9010007024e75')];
  const addon=image(0x2c0000,'4eb9010007024eb9010007564e75');
  assert.deepEqual(dsp1SenderSites(os,[addon],0x1000702),
    {sites:[0x200002,0x1000002,0x2c0002],immediates:false});
  assert.deepEqual(dsp1SenderSites(os,[],0x1000702),{sites:[0x200002,0x1000002],immediates:false});
  const registerLoop=image(0x2d0000,'203c010007024e75');
  assert.deepEqual(dsp1SenderSites(os,[registerLoop],0x1000702),{sites:[0x2d0002],immediates:true});
});

test('drive discovery avoids occupied words, including uploaded zero padding', () => {
  assert.deepEqual(dsp1Window(fromWordsLE(upload())), {hook: 0x25e, ret: 0x26f, program: [0xa08, 0xc00]});
  const occupied = [0, 0xa10, 47, ...Array(47).fill(0)];
  assert.deepEqual(dsp1Window(fromWordsLE(upload(occupied))), {hook: 0x25e, ret: 0x26f, program: [0xa3f, 0xc00]});
  assert.match(String(dsp1Window(fromWordsLE(upload([0, 0xa08, 504, ...Array(504).fill(0)])))), /entire drive program window/);
});

test('relocation moves the hook and inter-law targets, preserving stock returns and old layouts', () => {
  const before = JSON.stringify(core);
  const old = linkDrive(core, laws, ['child'], 0xb1a);
  assert.deepEqual(linkDrive(core, laws, ['child'], 0xb1a, [0xa08, 0xc00]), old);
  const next = linkDrive(core, laws, ['child'], 0xb1a, [0xa3f, 0xc00]);
  assert.deepEqual(next.selector, old.selector);
  assert.deepEqual(next.records[0].words, [0x0af080, 0xa3f]);
  assert.equal(next.records[1].addr, 0xa3f);
  const a = old.records[1].words, b = next.records[1].words;
  assert.equal(b[3], a[3] + 55); // dispatcher -> parent
  assert.equal(b[7], a[7] + 55); // dispatcher -> child
  assert.equal(b[9], 0x26f);    // dispatcher -> stock chain
  assert.equal(b[11], 0x26f);   // parent -> stock chain
  assert.equal(b[13], b[3]);    // child -> relocated parent
  assert.equal(b[15], b[7]);    // child -> itself
  assert.equal(JSON.stringify(core), before);
  assert.throws(() => linkDrive(core, laws, ['child'], 0xa40, [0xa3f, 0xc00]), /past/);
  assert.throws(() => linkDrive(core, laws, ['child'], 0xb1a, [0xa3f, 0xa40]), /past/);
  assert.throws(() => linkDrive({...core, head: []}, laws, ['child'], 0xb1a, [0xa3f, 0xc00]), /exactly one/);
});

test('readback guard rejects shadowing base code, return jumps and recovery records', () => {
  const base = upload([0, 0xa10, 47, ...Array(47).fill(0x123456)]);
  const linked = linkDrive(core, laws, ['child'], 0xb1a, [0xa3f, 0xc00]);
  assert.deepEqual(drivePlacementProblems(base, linked, 0x25e, 0x26f), []);
  const overwrite = {...linked, records: [...linked.records, {space: 0, addr: 0xa10, words: [0]}]};
  assert.match(drivePlacementProblems(base, overwrite, 0x25e, 0x26f).join(), /overwrites the base/);
  const ret = {...linked, records: [...linked.records, {space: 0, addr: 0x26f, words: [0]}]};
  assert.match(drivePlacementProblems(base, ret, 0x25e, 0x26f).join(), /overwrites the base/);
  assert.match(drivePlacementProblems(base, linked, 0x25e, 0x26f,
    [{space: 0, addr: 0xa3f, words: [0]}]).join(), /overlaps recovery/);
});
