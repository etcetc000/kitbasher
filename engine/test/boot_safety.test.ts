import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertBootRamWrites,assertEarlyInitializer,readBootRamWrites} from '../src/boot_safety.js';
import {bootRoutine} from '../src/coldfire.js';
import {be32,concat,hex} from '../src/bytes.js';

test('boot patch lists reject flash relocation destinations',()=>{
  assert.doesNotThrow(()=>assertBootRamWrites([[0x252092,0x100e2000],[0x2ffffc,0]]));
  for(const at of [0x100edd9a,0x100ee40a,0x100ee60a,0xedd9a,0x1001540,0x2ffffe,0x200001])
    assert.throws(()=>assertBootRamWrites([[at,0x2be1d0]]),/not initialized RAM/);
  assert.doesNotThrow(()=>assertBootRamWrites([[0x0100056a,0x2bc100]],{dst:0x01000000,len:0x1000}));
  assert.doesNotThrow(()=>assertBootRamWrites([[0x0100056a,0x2bc100]],{dst:0x01000088,len:2466}));
  assert.throws(()=>assertBootRamWrites([[0x01000084,0]],{dst:0x01000088,len:2466}),/not initialized RAM/);
  assert.throws(()=>assertBootRamWrites([[0x01001000,0]],{dst:0x01000000,len:0x1000}),/not initialized RAM/);
  assert.throws(()=>assertBootRamWrites([[0x100edd9a,0]],{dst:0x10000000,len:0x100000}),/not initialized RAM/);
});

test('boot initializer rejects high-alias entry, high-alias calls, illegal ISA and interior branches',()=>{
  const flash=new Uint8Array(0x100000),entry=0xed5a0;
  const code=concat([hex('4eb9'),be32(0x2ee000),hex('4e75')]);flash.set(code,entry);
  assert.doesNotThrow(()=>assertEarlyInitializer(flash,entry,code.length));
  assert.throws(()=>assertEarlyInitializer(flash,0x100ed5a0,code.length),/low flash/);
  flash.set(be32(0x100ed780),entry+2);
  assert.throws(()=>assertEarlyInitializer(flash,entry,code.length),/initialized RAM/);
  flash.set(hex('48e7c0004e714e75'),entry); // 68020 MOVEM predecrement is not ISA_A
  assert.throws(()=>assertEarlyInitializer(flash,entry,code.length),/ISA_A/);
  flash.set(hex('6000000120004e75'),entry);
  assert.throws(()=>assertEarlyInitializer(flash,entry,code.length),/boundaries/);
});

test('independent output readback refuses mutated boot stores, sources and empty loop counts',()=>{
  const flash=new Uint8Array(0x100000),routine=0xb0000,table=0xa0000;
  flash.set(bootRoutine(0xa1000,0x2bc000,16,table,1,0x213a0c,[0xa2000,0x2be100,8]),routine);
  flash.set(concat([be32(0x252092),be32(0x2bc000)]),table);
  assert.deepEqual(readBootRamWrites(flash,routine),[[0x252092,0x2bc000]]);
  for(const at of [0x100edd9a,0x100ee40a,0x100ee60a]){
    const bad=flash.slice();bad.set(be32(at),table);
    assert.throws(()=>readBootRamWrites(bad,routine),/not initialized RAM/);
  }
  for(const [offset,value] of [[2,0x100a1000],[8,0x100bc000],[14,0],
    [48+2,0xffffc],[48+8,0],[48+8,0xffffffff],[48+22,0x10013a0c]]){
    const bad=flash.slice();bad.set(be32(value),routine+offset);
    assert.throws(()=>readBootRamWrites(bad,routine),/range|RAM|OS entry/);
  }
});
