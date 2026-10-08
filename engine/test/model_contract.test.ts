import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkModelContract, requireInjection, type ModelContract } from '../src/model_contract.js';
import { ramImage, allocateIds } from '../src/plan.js';
import { legacyAllocate } from '../src/legacy_ids.js';
import type { Base } from '../src/bases.js';
import { checkPack, type CorePack, type Pack, type PackModel } from '../src/packs.js';
import { checkDynamicPlans, dynamicPlans, type ModelPanel } from '../src/model_panel.js';
import { tablePool } from '../src/table_pool.js';

test('immutable tables share by contents across names, while writable legacy tables stay isolated', () => {
  let next=100;
  const allocate=tablePool(n=>{const at=next;next+=n;return at;});
  assert.deepEqual(allocate('AQAA',1,'first/curve',true),{address:100,fresh:true});
  assert.deepEqual(allocate('AQAA',1,'second/bank',true),{address:100,fresh:false});
  assert.deepEqual(allocate('AgAA',1,'third/curve',true),{address:101,fresh:true});
  assert.deepEqual(allocate('AQAA',1,'legacy/scratch',false),{address:102,fresh:true});
  assert.deepEqual(allocate('AQAA',1,'legacy2/scratch',false),{address:103,fresh:true});
  assert.deepEqual(allocate('AQAA',1,'fourth/table',true),{address:100,fresh:false});
  assert.equal(next,104);
  let failed=true;
  const retry=tablePool(()=>failed?-1:200);
  assert.deepEqual(retry('AQAA',1,'a',true),{address:-1,fresh:true});failed=false;
  assert.deepEqual(retry('AQAA',1,'b',true),{address:200,fresh:true});
});

const panel = (): ModelPanel => ({name: 'TEST ', category: 'EX',
  knobs: Array.from({length: 8}, () => ({label: 'BASE', default: 0})), modes: [
    {knob: 2, zones: [{min: 64, max: 127, labels: {'2':'B'}}, {min: 0, max: 63, labels: {'2':'A','3':'TONE'}}]},
    {knob: 4, zones: [{min: 0, max: 127, labels: {'4':'TYPE'}}]},
  ]});

test('assembly scratch requires matching isolated workspace ownership', () => {
  const p=panel();p.modes=[];
  const contract={format:'md-model/1',key:'EX/test',version:'1.0.0',kit_abi:1,
    injection:{mode:'add'},panel:p,components:{dsp2:{source:'dsp2.asm',abi:'md-voice/1'}},
    memory:[
      {kind:'voice',space:'XY',words:64,alignment:64,lifetime:'track-assignment',init:'model',release:'successor-init'},
      {kind:'private',space:'X',words:153,alignment:128,lifetime:'track-assignment',init:'model',release:'successor-init'}],
    samples:[],budget:{render_cps:128,trigger_cycles:100,init_cycles:500},provenance:[]
  } as ModelContract;
  const model={key:contract.key,id:0,name:p.name,labels:p.knobs.map(k=>k.label),defaults:p.knobs.map(k=>k.default),
    contract,dyn_labels:[],workspace:true,workspace_kind:'private',code:{words:'DAAA',entry:{init:0,trigger:0,render:0},relocs:[],symbols:{}}
  } as unknown as PackModel;
  checkModelContract(model,'EX');
  for (const [field,value] of [['words',2049],['words',0],['words',1.5],['alignment',4096],['alignment',3],
      ['space','P'],['lifetime','trigger'],['init','chunked'],['release','plain-audio'],['dirty_span',{}]] as const) {
    const bad=structuredClone(model);Object.assign(bad.contract!.memory[1],{[field]:value});
    assert.throws(()=>checkModelContract(bad,'EX'),/unsupported resource contract/);
  }
  for (const descriptor of [{workspace:false},{workspace_kind:'pi'},{workspace_kind:null}]) {
    const bad=structuredClone(model);Object.assign(bad,descriptor);
    assert.throws(()=>checkModelContract(bad,'EX'),/unsupported resource contract/);
  }
});

test('muted P-I initialization permits only the existing isolated plain-audio slice', () => {
  const p=panel(); p.modes=[];
  const contract={format:'md-model/1',key:'EX/test',version:'1.0.0',kit_abi:1,
    injection:{mode:'add'},panel:p,components:{dsp2:{source:'dsp2.asm',abi:'md-voice/1'}},
    memory:[
      {kind:'voice',space:'XY',words:64,alignment:64,lifetime:'track-assignment',init:'model',release:'successor-init'},
      {kind:'pi',space:'XY',words:1536,alignment:512,lifetime:'track-assignment',init:'chunked-muted',release:'plain-audio'}],
    samples:[],budget:{render_cps:128,trigger_cycles:100,init_cycles:200},provenance:[]
  } as ModelContract;
  const model={key:contract.key,id:0,name:p.name,labels:p.knobs.map(k=>k.label),defaults:p.knobs.map(k=>k.default),
    contract,dyn_labels:[],workspace_kind:'pi',code:{words:'DAAA',entry:{init:0,trigger:0,render:0},relocs:[],symbols:{}}
  } as unknown as PackModel;
  checkModelContract(model,'EX');
  const pi=contract.memory[1];
  for (const [field,value] of [['words',1537],['alignment',256],['init','model'],['release','successor-init']] as const) {
    const altered=structuredClone(model);
    Object.assign(altered.contract!.memory[1],{[field]:value});
    assert.throws(()=>checkModelContract(altered,'EX'),/unsupported resource contract/);
  }
  pi.init='chunked';
  checkModelContract(model,'EX');
});

test('MODE plans preserve independent selectors, boundaries and default captions', () => {
  const p = panel(), plans = dynamicPlans(p);
  assert.deepEqual(plans[0].mask, [2,3]);
  assert.deepEqual(plans[0].stop_of, [...Array(64).fill(0), ...Array(64).fill(1)]);
  assert.deepEqual(plans[0].formula, [0,1,6]);
  assert.equal(atob(plans[0].blocks), 'A   TONEB   BASE');
  assert.equal(atob(plans[1].blocks), 'TYPE');
  checkDynamicPlans(p, plans);
  for (const mutate of [
    () => { plans[0].stop_of[63] = 1; }, () => { plans[0].blocks = btoa('WRNG'); },
    () => { plans[0].formula = [0,1,5]; }, () => { plans[0].mask = [1,3]; },
  ]) {
    plans.splice(0, plans.length, ...dynamicPlans(p)); mutate();
    assert.throws(() => checkDynamicPlans(p, plans), /differ/);
  }
});

test('MODE runtime checks refuse gaps, overlaps, invalid labels and conflicting ownership', () => {
  for (const mutate of [
    (p: ModelPanel) => { p.modes[0].zones[0].min = 65; },
    (p: ModelPanel) => { p.modes[0].zones[0].min = 63; },
    (p: ModelPanel) => { p.modes[1].knob = 2; },
    (p: ModelPanel) => { p.modes[1].zones[0].labels = {'3':'BAD'}; },
    (p: ModelPanel) => { p.modes[0].zones[0].labels = {'8':'BAD'}; },
    (p: ModelPanel) => { p.modes[0].zones[0].labels = {'2':'TOOLONG'}; },
  ]) { const p = panel(); mutate(p); assert.throws(() => dynamicPlans(p)); }
});

test('irregular MODE zones retain a complete lookup map', () => {
  const p = panel(); p.modes = [{knob:2, zones:[
    {min:0,max:3,labels:{'3':'A'}}, {min:4,max:99,labels:{'3':'B'}}, {min:100,max:127,labels:{'3':'C'}},
  ]}];
  const [plan] = dynamicPlans(p);
  assert.equal(plan.formula, null);
  assert.deepEqual(plan.stop_of, [...Array(4).fill(0), ...Array(96).fill(1), ...Array(28).fill(2)]);
});

test('assembly add-ons allocate linearly across categories, skipping stock and dead slots', () => {
  const base={name:'fixture',os:{descriptorTable:0,cfBase:0,freeDescriptor:0,deadIds:[7,8]}} as unknown as Base;
  const model=(key:string)=>({key,name:key,id:0,contract:{injection:{mode:'add'},components:{dsp2:{source:'dsp2.asm'}}}} as unknown as PackModel);
  const listed=new Map(Array.from({length:6},(_,i)=>[i,'stock'] as const));
  const r=allocateIds(base,new Uint8Array(192*4),[{name:'MM',models:[model('a'),model('b')]},{name:'SD',models:[model('c')]}],false,undefined,listed);
  assert.deepEqual(r.problems,[]);
  assert.deepEqual(r.sel.map(s=>[s.family,s.id]),[['MM',6],['MM',9],['SD',10]]);
  assert.equal(r.moves.length,0);
});

test('replacement cannot fall through to add or automatic ID allocation', () => {
  assert.throws(() => requireInjection({format:'md-model/1',injection:{mode:'replace',id:38}} as ModelContract), /unsupported injection: replace/);
});

test('ID exhaustion explains that sample trimming cannot create an ID', () => {
  const base={name:'fixture',os:{descriptorTable:0,cfBase:0,freeDescriptor:0,deadIds:[7,8]}} as unknown as Base;
  const added={key:'MM/2',name:'MMNOI',id:0,contract:{injection:{mode:'add'},components:{dsp2:{source:'dsp2.asm'}}}} as unknown as PackModel;
  const listed=new Map(Array.from({length:192},(_,i)=>[i,'stock'] as const));
  const r=allocateIds(base,new Uint8Array(192*4),[{name:'MM',models:[added]}],false,undefined,listed);
  assert.equal(r.sel.length,0);
  assert.equal(r.problems.length,1);
  assert.match(r.problems[0],/remove a selected model; sample trimming does not free IDs/);
});

test('earlier builds: automatic contributions yielded to later pinned IDs (legacy_ids.ts keeps that allocator)', () => {
  const base={name:'fixture',os:{descriptorTable:0,cfBase:0,freeDescriptor:0,deadIds:[7,8]}} as unknown as Base;
  const added={key:'MM/1',name:'MMSIN',id:0,contract:{injection:{mode:'add'},components:{dsp2:{source:'dsp2.asm'}}}} as unknown as PackModel;
  const pinned={key:'ND/0',name:'TEST ',id:6} as PackModel;
  const listed=new Map(Array.from({length:6},(_,i)=>[i,'stock'] as const));
  const fams=[{name:'MM',models:[added]},{name:'ND',models:[pinned]}];
  const r=legacyAllocate(base,new Uint8Array(192*4),fams,listed);
  assert.deepEqual(r.problems,[]);
  assert.deepEqual(r.sel.map(s=>[s.m.key,s.family,s.id]),[['MM/1','MM',9],['ND/0','ND',6]]);
  assert.deepEqual(r.moves,[]);
  // now: a pack's ID is not a pin; every model bottom-up in order, the dead range skipped
  const now=allocateIds(base,new Uint8Array(192*4),fams,false,undefined,listed);
  assert.deepEqual(now.problems,[]);
  assert.deepEqual(now.sel.map(s=>[s.m.key,s.family,s.id]),[['MM/1','MM',6],['ND/0','ND',9]]);
});

test('static-only selection leaves the knob callback executable when dynamic labels are enabled', () => {
  // Regression check: an empty selection must not insert six 00 bytes before moveq/rts.
  const base = {os:{descriptorSize:86,familyTable:0,cfBase:0,familyCount:0,
    levBar:{ctr:{ids:[124,127]},low:{ids:[88,95]}}},ext:{base:0x2bc000,end:0x2bd000},features:{dynLabels:{segment:[0x2be100,0x2bef60]}}} as unknown as Base;
  const core={knob_callback:'cAlOdQ==',dyn:{call_size:6}} as unknown as CorePack;
  const r=ramImage(base,new Uint8Array(8),core,[],[],{dyn:true,dsp1:null,host:false,ind:null,toFlash:new Set(),dynFlash:new Set(),idSpace:192,flashAt:0x100e0000,redrawValues:0});
  assert.deepEqual(Array.from(r.image.slice(0,4)),[0x70,9,0x4e,0x75]);
  assert.equal(r.dyn,null);
});

test('unknown top-level fields in a pack or manifest are ignored', () => {
  const contract = {
    format: 'md-model/1', key: 'TEST/0', version: '1', kit_abi: 1, extra: 'a',
    injection: { mode: 'add', id: 6 },
    panel: { name: 'TEST ', category: 'TEST', knobs: Array.from({ length: 8 }, () => ({ label: 'BASE', default: 0 })), modes: [] },
    components: { dsp2: { provider: 'python', abi: 'md-voice/1' } },
    memory: [{ kind: 'voice', space: 'XY', words: 64, alignment: 64, lifetime: 'track-assignment', init: 'model', release: 'successor-init' }],
    samples: [], budget: { render_cps: 1, trigger_cycles: 1, init_cycles: 1 }, provenance: [],
  };
  const model = { key: 'TEST/0', name: 'TEST ', id: 6, labels: Array(8).fill('BASE'), defaults: Array(8).fill(0), dyn_labels: [],
    code: { words: btoa('\0\0\0'), org: 0, entry: { init: 0, trigger: 0, render: 0 }, relocs: [], symbols: {} }, contract } as unknown as PackModel;
  for (const extra of ['a', 'b', undefined]) {
    const pack = { format: 'md-pack/1', family: 'TEST', order: 0, extra, shared: [], models: [model] } as unknown as Pack;
    checkPack(pack);
  }
  checkPack({ format: 'md-pack/1', family: 'CORE', extra: 'b' } as unknown as CorePack);
});

test('OSCSP unused controls stay absent in RAM and flash descriptors', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../examples/community/sawpw/model.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.panel.knobs.slice(6).map((k: {label: string}) => k.label), ['', '']);
  const base = {os:{descriptorSize:86,familyTable:0,cfBase:0,
    levBar:{ctr:{ids:[124,127]},low:{ids:[88,95]}}},ext:{base:0x2bc000,end:0x2bd000},features:{}} as unknown as Base;
  const core = {knob_callback:'cAlOdQ=='} as unknown as CorePack;
  const model = {name:'OSCSP',key:manifest.key,labels:manifest.panel.knobs.map((k: {label: string}) => k.label),
    defaults:manifest.panel.knobs.map((k: {default: number}) => k.default),dyn_labels:[]} as unknown as PackModel;
  for (const flash of [false, true]) {
    const r = ramImage(base,new Uint8Array(8),core,[],[{m:model,family:'COM',id:6,preferred:6,mapped:false}],
      {dyn:false,dsp1:null,host:false,ind:null,toFlash:new Set(flash ? ['OSCSP'] : []),dynFlash:new Set(),idSpace:192,flashAt:0x100e0000,redrawValues:0});
    const descriptor = flash ? r.flashBlock : r.image.subarray(r.descs[0][1]-r.base);
    assert.deepEqual([...descriptor.subarray(50,54)], [0x11,0x11,0x11,0]);
    assert.deepEqual([...descriptor.subarray(34,42)], Array(8).fill(0));
  }
});
