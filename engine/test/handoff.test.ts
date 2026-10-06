import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HANDOFF_BASE,HANDOFF_ORDERED} from '../src/handoff.js';

// Execute the actual emitted ordering against a producer starting on the handshake edge.
// A long unrelated interrupt stalls the core at each possible instruction boundary;
// peripheral transfers continue. One unserviced RX word can be held, later words overwrite it.
function transfer(words:number[],delayAt:number):number[]{
  let clock=0, next=Infinity, sent=0, pending:number|undefined, armed=false;
  const received:number[]=[];
  const advance=(n:number)=>{clock+=n;while(next<=clock&&sent<512){if(armed)received.push(sent);else pending=sent;sent++;next+=96;}};
  for(let pc=0;pc<words.length;){
    if(pc===delayAt)advance(2000);
    const w=words[pc],v=words[pc+1];
    if(w===0x44f000)pending=undefined; // stock drain, before release in either order
    if(w===0x567000)next=clock+140; // producer starts after handshake
    if(w===0x08f49c){armed=!!(v&0x800000);if(armed&&pending!==undefined){received.push(pending);pending=undefined;}}
    const n=w===0x014283?1:2;pc+=n;advance(n);
  }
  advance(60000);return received;
}
test('receive-before-release accepts all 512 words despite a long interrupt at every boundary',()=>{
  const expected=Array.from({length:512},(_,k)=>k);
  assert.deepEqual(transfer(HANDOFF_BASE,-1),expected,'stock works without interruption');
  assert.notDeepEqual(transfer(HANDOFF_BASE,7),expected,'control loses initial words after early release');
  for(let pc=0;pc<HANDOFF_ORDERED.length;pc++)assert.deepEqual(transfer(HANDOFF_ORDERED,pc),expected,`delay at word ${pc}`);
  assert.deepEqual([...HANDOFF_BASE].sort(),[...HANDOFF_ORDERED].sort(),'only instruction order changes');
});
