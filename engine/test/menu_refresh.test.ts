import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hex,be32,concat} from '../src/bytes.js';
import type {Base} from '../src/bases.js';
import {decodeLinear} from '../src/isa.js';
import {menuRefreshSite,menuRefreshCode,menuRefreshPatches} from '../src/menu_refresh.js';

function fixture() {
  const main=new Uint8Array(128), segment=new Uint8Array(128);
  main.set(hex('20390028b72ce7882040d1fc0025239a20504280600252804a9866fa23c00028c2d84e75'),16);
  segment.set(hex('4e7528390028b9c02a390028c2d82c390028b7302039002818dae58841f9007001aa2e300800'),0);
  const base={id:'dev-26a01',os:{cfBase:0x200000,familyTable:0x252396},segments:[{ram:0x2c0000,bytes:segment}]} as unknown as Base;
  return {main,segment,base};
}

test('DEV menu hook is signature-bound and preserves the neighbouring return',()=>{
  const {main,base}=fixture(), site=menuRefreshSite(base,main)!;
  assert.equal(site.hook,0x2c0002);
  assert.equal(site.count,0x200010);
  const patches=menuRefreshPatches(site,0x2bc100);
  assert.equal(patches[0][0],0x2c0000);
  assert.equal(patches[1][0],0x2c0004);
  assert.deepEqual(concat(patches.map(([,word])=>be32(word))),hex('4e754eb9002bc100'));
  const code=menuRefreshCode(site), instructions=decodeLinear(code,0x2bc100);
  assert.ok(instructions.length>0 && instructions.every(i=>i.ok));
  assert.equal(code.length,30);
});

test('unqualified bases are unchanged and ambiguous or altered DEV code fails closed',()=>{
  const {main,segment,base}=fixture();
  assert.equal(menuRefreshSite({...base,id:'stock-163'},main),null);
  assert.equal(menuRefreshSite({...base,id:'dev-26912'},main),null);
  main[16]^=1;
  assert.throws(()=>menuRefreshSite(base,main),/verified drawer and list counter/);
  main[16]^=1;
  segment.set(segment.slice(2,40),64);
  assert.throws(()=>menuRefreshSite(base,main),/verified drawer and list counter/);
});
