import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex } from '../src/bytes.js';
import { fxOrderCode, fxOrderGateSites } from '../src/fx_order.js';
import { Cpu } from './cf_interp.js';

// Only the native ABI anchors, no firmware blob. Runtime tests execute the
// emitted instructions, intercepting just native drawing and sender calls.
function fixture() {
  const bytes=new Uint8Array(0xe0000),set=(at:number,value:string)=>bytes.set(hex(value),at-0x200000);
  set(0x261864,'0024790d0025a7200000000300247667002479150024791f00000000000000000000000000000000000000000000003c0000003d0000003e00000000');
  for(const at of [0x2c47f4,0x2c4e5a])set(at,'203900281a464a80');
  set(0x2d2fa2,'4eb90022d6e4');for(const at of [0x2c58de,0x2c5efe])set(at,'4ef90022f960');
  set(0x2c408a,'743eb480');set(0x22f98e,'1030180149c0');set(0x22f9ba,'41f90071216c');set(0x22f988,'41f90071216c');
  set(0x20c04e,'4eb900212b40');
  set(0x208428,'4eb9002129e8');
  for(const at of [0x2d2200,0x2c558e,0x2c5bb4])set(at+106,at===0x2d2200?'0228':'ff7a');
  return [{what:'native ABI fixture',ram:0x200000,bytes}];
}
const f=fxOrderCode(fixture(),0x100e0000,0x1000702),S=f.settings;
function cpu() {
  const c=new Cpu();c.load(0x100e0000,f.code.bytes);
  for(const at of [S.rect,S.text,0x1000702])c.stubs.set(at,()=>{});
  c.w32(S.page,63);return c;
}
test('FX order edits affect only the selected effect and global slot, preserving resolution and Swap Speeds',()=>{
  const c=cpu();
  for(let slot=0;slot<8;slot++)for(let initial=0;initial<128;initial++)for(const row of [0,1])for(const dir of [-1,0,1]) {
    c.w8(S.slot,slot);for(let j=0;j<8;j++)c.w8(S.settings+178*j,j===slot?initial:0x71);
    c.w32(S.row,row);const stack=c.a[7];c.call(f.code.labels.edit,[dir]);
    const bit=row?32:16;
    assert.equal(c.r8(S.settings+178*slot),dir===0?initial:(initial&~bit)|(dir<0?bit:0));
    assert.equal(c.a[7],stack);
    for(let j=0;j<8;j++)if(j!==slot)assert.equal(c.r8(S.settings+178*j),0x71);
  }
});
test('FX order transport sends one complete masked packet only when the effective order changes',()=>{
  const c=cpu(),writes:[number,number,number][]=[];
  const w32=c.w32.bind(c),w8=c.w8.bind(c);
  c.w32=(at,v)=>{if(at===0x500004)writes.push([at,v>>>0,c.sr]);w32(at,v);};
  c.w8=(at,v)=>{if(at===0x500001)writes.push([at,v&255,c.sr]);w8(at,v);};
  let native=0;c.stubs.set(0x1000702,c=>{native++;assert.equal(c.arg(0),7);});
  for(const mode of [0,1,1,3,2,0]) {
    c.w8(S.settings,(mode<<4)|65);c.sr=0x2300;c.d.set([91,82,73,64,55,46,37,28]);
    const before=[...c.d],stack=c.a[7],n=writes.length,previous=c.r32(S.cache);
    c.call(f.code.labels.sender,[7]);c.call(f.code.labels.sync);assert.deepEqual([...c.d],before);assert.equal(c.a[7],stack);assert.equal(c.sr,0x2300);
    assert.deepEqual(writes.slice(n),mode===previous?[]:[[0x500004,0x23f,0x2700],[0x500001,0x89,0x2700],[0x500004,0,0x2700],[0x500004,mode,0x2700]]);
  }
  assert.equal(native,6);
});
test('native resolution edits read only resolution and retain every other saved setting bit',()=>{
  const c=cpu();
  for(let initial=0;initial<128;initial++)for(const resolution of [0,1]) {
    c.a[0]=S.settings-1;c.d[1]=178*5;c.w8(S.settings+178*5,initial);
    c.call(f.code.labels.resolution_read);assert.equal(c.d[0],initial&1);assert.equal(c.d[1],178*5);
    c.d[3]=resolution;c.call(f.code.labels.resolution_store);assert.equal(c.d[3],(initial&~1)|resolution);
    assert.equal(c.a[0],S.settings-1);assert.equal(c.d[1],178*5);
  }
});
test('startup defers transport until DSP readiness and global application synchronizes later changes',()=>{
  const c=cpu();let packets=0,native=0,panel=0;
  const w8=c.w8.bind(c);
  c.w8=(at,v)=>{if(at===0x500001)packets++;w8(at,v);};
  c.stubs.set(0x1000702,()=>{native++;});c.stubs.set(0x212b40,()=>{panel++;});
  c.w8(S.settings,0x30);c.call(f.code.labels.global_apply);
  assert.equal(packets,0);assert.equal(panel,1);
  c.call(f.code.labels.sender);assert.equal(packets,1);assert.equal(c.r32(S.cache),3);
  c.w8(S.settings,0x10);c.call(f.code.labels.sender);
  assert.equal(packets,1);assert.equal(native,2);
  c.call(f.code.labels.global_apply);assert.equal(packets,2);assert.equal(c.r32(S.cache),1);
  c.call(f.code.labels.global_apply);assert.equal(packets,2);assert.equal(panel,3);
  let ack=0;c.stubs.set(0x2129e8,c=>{assert.equal(c.arg(0),123);ack++;});
  c.w8(S.settings+178,0x20);c.call(f.code.labels.global_import,[123]);
  assert.equal(packets,2);assert.equal(ack,1); // inactive slot import
  c.w8(S.settings,0x20);c.call(f.code.labels.global_import,[123]);
  assert.equal(packets,3);assert.equal(c.r32(S.cache),2);assert.equal(ack,2);
});
test('the first native send unhooks the wrapper: every call site gets the real sender back, masked',()=>{
  const sites=[0x20ac5e,0x100056a,0x2d6406],g=fxOrderCode(fixture(),0x100e0000,0x1000702,sites);
  const c=new Cpu();c.load(0x100e0000,g.code.bytes);c.stubs.set(0x1000702,()=>{});
  const writes:[number,number,number][]=[],w32=c.w32.bind(c);
  c.w32=(at,v)=>{if(sites.includes(at))writes.push([at,v>>>0,c.sr]);w32(at,v);};
  for(const s of sites)w32(s,g.code.labels.sender);
  c.w8(g.settings.settings,0);c.sr=0x2300;c.d.set([91,82,73,64,55,46,37,28]);
  const before=[...c.d],stack=c.a[7];
  c.call(g.code.labels.sender,[7]);
  assert.deepEqual(writes,sites.map(s=>[s,0x1000702,0x2700]));
  for(const s of sites)assert.equal(c.r32(s),0x1000702);
  assert.deepEqual([...c.d],before);assert.equal(c.a[7],stack);assert.equal(c.sr,0x2300);
  c.call(g.code.labels.sender,[7]);assert.equal(writes.length,sites.length,'unhooked once');
  assert.ok(f.code.bytes.length<g.code.bytes.length,'without sites the wrapper is unchanged');
});
test('an occupied page or changed menu ABI is refused before any image is written',()=>{
  for(const at of [0x26186c,0x2d226a,0x2c55f8,0x2c5c1e,0x22f98e,0x2c47f4,0x208428]) {
    const images=fixture();images[0].bytes[at-0x200000]^=1;
    assert.throws(()=>fxOrderCode(images,0x100e0000,0x1000702),/FX order:/);
  }
});
test('ISA readback recognizes only the expected emitted page dispatch data',()=>{
  assert.equal(fxOrderGateSites(fixture(),[]) ,null);
  assert.ok(fxOrderGateSites(fixture(),f.patches));
  for(const at of [0x2d226a,0x2c55f8,0x2c5c1e]) {
    const bad=f.patches.map(([s,v]):[number,number]=>[s,s===at?v^1:v]);
    assert.throws(()=>fxOrderGateSites(fixture(),bad),/invalid emitted page dispatch/);
  }
});
