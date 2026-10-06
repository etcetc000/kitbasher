import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualifyModelRuntime,runtimeComponents,type RuntimeEvidence} from '../src/model_runtime.js';
import type {Base} from '../src/bases.js';
import type {Firmware} from '../src/container.js';

async function fixture() {
  const fw={flash:new Uint8Array(0x5000),slots:[{raw:new Uint8Array(64)},{raw:Uint8Array.of(1,2,3)},
    {raw:Uint8Array.of(4,5,6)}]} as Firmware;
  const base={id:'unprofiled',qualified:false,qualification:{level:'discovered',profile:null},
    boot:{sram:{src:0x200000,dst:0x1000000,len:16}},os:{cfBase:0x200000},
    segments:[{ram:0x2c0000,bytes:Uint8Array.of(1,2,3,4)}],
    dsp2:{dispatch:{init:0x145af5,trigger:0x145bb6,render:0x145c77},
      workspace:{base:0x12d000,slice:2048},bankEnd:0x135206,bootWrites:{known:true,ranges:[]}}} as unknown as Base;
  const rule:RuntimeEvidence={id:'tested-runtime',abi:'md-voice/1',...await runtimeComponents(fw,base),evidence:'synthetic fixture'};
  return {fw,base,rule};
}

test('unprofiled firmware reuses exact runtime evidence without inheriting whole-base qualification',async()=>{
  const {fw,base,rule}=await fixture();
  const original=await qualifyModelRuntime(fw,base,[rule]);
  assert.equal(original.ok,true);
  assert.equal(original.reusedFrom,'tested-runtime');
  fw.slots[0].raw[40]=1; // Outside the SRAM component; discovery handles other CF hooks.
  fw.flash[0x4000]=1;
  fw.slots[2].raw[0]=9; // DSP1 is qualified by its own feature checks, not the voice ABI.
  const changed=await qualifyModelRuntime(fw,base,[rule]);
  assert.equal(changed.ok,true);
  assert.notEqual(original.sourceSha256,changed.sourceSha256,'input binding changes even when evidence is reused');
  assert.equal(base.qualified,false);
  assert.equal(base.qualification.profile,null);
});

test('a named profile cannot authorize unknown components, changed addresses or unsafe geometry',async()=>{
  const {fw,base,rule}=await fixture();
  base.qualification.profile='known-version';
  for(const mutate of [
    (f:Firmware)=>{f.slots[1].raw[0]^=1;},
    (f:Firmware)=>{f.slots[0].raw[0]^=1;},
    (_:Firmware,b:Base)=>{b.segments[0].bytes[0]^=1;},
    (_:Firmware,b:Base)=>{b.segments[0].ram+=4;},
    (_:Firmware,b:Base)=>{b.boot.sram.dst+=4;},
    (_:Firmware,b:Base)=>{b.dsp2.dispatch.render++;},
    (_:Firmware,b:Base)=>{b.dsp2.workspace.slice=1024;},
    (_:Firmware,b:Base)=>{b.dsp2.bootWrites!.known=false;},
  ]) {
    const f=structuredClone(fw),b=structuredClone(base);mutate(f,b);
    const result=await qualifyModelRuntime(f,b,[rule]);
    assert.equal(result.ok,false,result.why);
    assert.equal(result.reusedFrom,null);
  }
  assert.equal((await qualifyModelRuntime(fw,base,[])).ok,false);
  assert.equal((await qualifyModelRuntime(fw,base,[{...rule,evidence:''}])).ok,false);
});

test('component combinations require joint evidence and SRAM copies must be fully in bounds',async()=>{
  const {fw,base,rule}=await fixture();
  assert.equal((await qualifyModelRuntime(fw,base,[{...rule,sram:'other'},{...rule,dsp2:'other'}])).ok,false);
  base.boot.sram.len=65;
  await assert.rejects(qualifyModelRuntime(fw,base,[rule]),/invalid SRAM/);
});
