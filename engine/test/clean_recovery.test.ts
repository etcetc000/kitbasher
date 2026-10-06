import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFeatures,reserveRecovery,patchRetirement,memory,checkCleanRecovery,cleanDsp1Records,cleanBaseProblems} from '../src/clean_recovery.js';
import {retireRoutine,RETIRE_BASE,RETIRE_SITE} from '../src/retire.js';
import {PACE_SITE,PACE_BASE} from '../src/dsp1pace.js';
import {CLEAR_SITE,CLEAR_BASE,CLEAR_AT,CLEAR_WORDS} from '../src/clearpace.js';
import {outputPaceRoutine} from '../src/outputpace.js';
import {fromWordsLE} from '../src/bytes.js';
import type {Firmware} from '../src/container.js';
import type {Base} from '../src/bases.js';

test('clean recovery is explicit, preserves old recipes and rejects conflicting policies',()=>{
  assert.deepEqual(recoveryFeatures({}),{});
  assert.deepEqual(recoveryFeatures({cleanRecovery:true,cpuIndicator:false}),
    {cleanRecovery:true,cpuIndicator:false,dsp1Recover:true,dsp1Realign:false,dsp1RecoverVariant:'ordered'});
  for(const f of [{dsp1Realign:true},{dsp1Recover:false},{dsp1RecoverVariant:'v8'},{dsp1Diag:true}])
    assert.throws(()=>recoveryFeatures({cleanRecovery:true,...f}),/requires ordered/);
});
test('model allocator cannot occupy the recovery helper, without losing surrounding space',()=>{
  const rt=retireRoutine(),regions:[number,number][]=[[0x100000,0x120000],[0x146000,0x148000]];
  const reserved=reserveRecovery(regions);
  assert.deepEqual(regions,[[0x100000,0x120000],[0x146000,0x148000]],'input remains immutable');
  assert.ok(reserved.every(([a,b])=>b<=rt.at||a>=rt.at+rt.words.length));
  assert.equal(regions.reduce((n,[a,b])=>n+b-a,0)-reserved.reduce((n,[a,b])=>n+b-a,0),rt.words.length);
});
test('retirement patches only its anchor and rejects ambiguous or changed input',()=>{
  // The upload terminator is type 3 plus entry address.
  const before=[0,RETIRE_SITE,3,...RETIRE_BASE,2,0x800,2,0x123456,0x654321,3,0];
  const after=patchRetirement(before),rt=retireRoutine();
  assert.deepEqual(memory(after,2),memory(before,2));
  assert.deepEqual(Array.from({length:3},(_,i)=>memory(after).get(RETIRE_SITE+i)),rt.hook);
  assert.deepEqual(before.slice(3,6),RETIRE_BASE);
  const changed=before.slice();changed[3]^=1;assert.throws(()=>patchRetirement(changed),/anchor/);
  assert.throws(()=>patchRetirement([0,RETIRE_SITE,3,...RETIRE_BASE,...before]),/Ambiguous/);
  const d1=[...cleanDsp1Records().flatMap(r=>[r.space,r.addr,r.words.length,...r.words]),3,0];
  assert.ok(checkCleanRecovery(d1,after).ok);
  const damaged=after.slice();damaged[3]^=1;assert.equal(checkCleanRecovery(d1,damaged).ok,false);
});

test('recovery preview checks upload spans without changing anchor or overlap decisions',()=>{
  const rt=retireRoutine(),pace=outputPaceRoutine();
  const d1=[0,PACE_SITE,PACE_BASE.length,...PACE_BASE,0,CLEAR_SITE,CLEAR_BASE.length,...CLEAR_BASE];
  const d2=[0,RETIRE_SITE,RETIRE_BASE.length,...RETIRE_BASE];
  const base={dsp2:{freeRegions:[[rt.at,rt.at+rt.words.length]]}} as unknown as Base;
  const check=(extra1:number[]=[],extra2:number[]=[])=>{
    const fw={slots:[{}, {raw:fromWordsLE([...d2,...extra2,3,0])},
      {raw:fromWordsLE([...d1,...extra1,3,0])}]} as Firmware;
    return cleanBaseProblems(fw,base);
  };
  assert.deepEqual(check(),[]);
  // Neighbouring and empty records do not occupy the helper; even zero-valued
  // words inside it do. Check both ends in every DSP memory space.
  for(const [dsp,at,n] of [[1,pace.at,pace.words.length],[1,CLEAR_AT,CLEAR_WORDS.length],[2,rt.at,rt.words.length]]) {
    for(const space of [0,1,2]) for(const [start,count,overlap] of
      [[at-1,1,false],[at+n,1,false],[at,0,false],[at,1,true],[at+n-1,1,true],[at-1,2,true]] as const) {
      const extra=[space,start,count,...Array(count).fill(0)];
      const problems=dsp===1?check(extra):check([],extra);
      assert.equal(problems.some(p=>p.includes('overlaps loaded')),overlap,`${dsp}/${space}/${start}/${count}`);
    }
  }
  for(const [dsp,at,expected] of [[1,PACE_SITE,PACE_BASE],[1,CLEAR_SITE,CLEAR_BASE],[2,RETIRE_SITE,RETIRE_BASE]] as const) {
    const bad=[0,at,1,expected[0]^1], restored=[...bad,0,at,1,expected[0]];
    assert.match((dsp===1?check(bad):check([],bad)).join(' '),/unsupported stock anchor/);
    assert.deepEqual(dsp===1?check(restored):check([],restored),[],'last upload wins');
    assert.deepEqual(dsp===1?check([1,at,1,0]):check([],[1,at,1,0]),[],'X upload cannot replace P anchor');
  }
  const fw={slots:[{}, {raw:fromWordsLE([...d2,3,0])},{raw:fromWordsLE([...d1,3,0])}]} as Firmware;
  assert.deepEqual(cleanBaseProblems(fw,base),[]);
  fw.slots[2].raw[9]^=1;
  assert.match(cleanBaseProblems(fw,base).join(' '),/unsupported stock anchor/,'mutations are rechecked');
  fw.slots[2].raw[9]^=1;
  assert.match(cleanBaseProblems(fw,{dsp2:{freeRegions:[]}} as unknown as Base).join(' '),/outside discovered free memory/);
});

test('qualified overlapping uploads patch every stock copy and refuse conflicting copies',()=>{
  const record=[0,RETIRE_SITE,RETIRE_BASE.length,...RETIRE_BASE];
  const input=[...record,...record,3,0],rt=retireRoutine();
  const output=patchRetirement(input,true);
  assert.deepEqual(output.slice(3,6),rt.hook);
  assert.deepEqual(output.slice(9,12),rt.hook);
  for(const index of [3,9]) {
    const conflicting=input.slice();conflicting[index]^=1;
    assert.throws(()=>patchRetirement(conflicting,true),/stock anchor changed/);
  }
  assert.throws(()=>patchRetirement([0,0,1,0,3,0],true),/Ambiguous/);
});
