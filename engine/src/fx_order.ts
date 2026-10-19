import { Asm } from './cf_asm.js';
import { be32, concat, equal, hex, u32 } from './bytes.js';
import { reader, type CodeImage } from './sig.js';
import { decodeLinear } from './isa.js';
import { FX_ORDER_WORD } from './fx_order_dsp.js';

export const FX_ORDER_PAGE = 63;
// X.14 native menu ABI. Every affected instruction/table is checked below.
// These are existing RAM objects; the three scratch longs are unused menu entries,
// below the original eight-entry capacity and beyond our new four-entry count.
const S={page:0x281a46,slot:0x7120ca,settings:0x71216d,table:0x261864,
  row:0x261880,cache:0x261884,ready:0x261888,draw:0x22d6e4,edit:0x22f960,
  font:0x259954,surface:0x28194a,text:0x211384,rect:0x210f84};

function assertNativeMenu(images:CodeImage[]) {
  const read=reader(images);
  const expect=(at:number,bytes:string)=>{
    if(!equal(read(at,hex(bytes).length)??new Uint8Array(),hex(bytes)))
      throw new Error(`FX order: unfamiliar X.14 menu at $${at.toString(16)}`);
  };
  expect(S.table,'0024790d0025a7200000000300247667002479150024791f00000000000000000000000000000000000000000000003c0000003d0000003e00000000');
  expect(0x2c47f4,'203900281a464a80'); expect(0x2c4e5a,'203900281a464a80');
  expect(0x2d2fa2,'4eb90022d6e4'); expect(0x2c58de,'4ef90022f960'); expect(0x2c5efe,'4ef90022f960');
  expect(0x2c408a,'743eb480');
  expect(0x22f98e,'1030180149c0'); expect(0x22f9ba,'41f90071216c');
  // Resolution uses the low two bits; global export preserves seven bits.
  expect(0x22f988,'41f90071216c');
  expect(0x20c04e,'4eb900212b40');
  expect(0x208428,'4eb9002129e8'); // global SysEx completion/acknowledgement
}

/** Recognize table data independently from the emitted boot writes. Never let
 * arbitrary caller-supplied addresses bypass instruction validation. */
export function fxOrderGateSites(images:CodeImage[],patches:readonly (readonly [number,number])[]) {
  const p=new Map(patches),read=reader(images);
  if(p.get(S.table+8)!==4 || p.get(S.table+56)!==63)return null;
  assertNativeMenu(images);
  const dataSites=[S.table+8,S.table+24,S.table+56];
  for(const table of [0x2d2200,0x2c558e,0x2c5bb4]) {
    const at=table+106,old=read(at,4)!.slice();old.set(read(table+88,2)!);
    if(p.get(at)!==u32(old,0))throw new Error('FX order: invalid emitted page dispatch');
    dataSites.push(at);
  }
  const ranges:[number,number][]=[0x2c47f4,0x2c4e5a,0x22f98e,0x22f9ba].map(at=>[at,at+6]);
  return {ranges,dataSites};
}

/** `sites`: the OS's call sites of the DSP1 parameter sender that the build points at `sender` below. When
 * given, the first call writes `sender`'s target back into them (interrupts masked), so every later send calls
 * it directly instead of through this flash-resident wrapper. The sender runs ~20,000 times a second; the
 * per-call flash detour starved the panel on hardware (track-select wheel lag after a busy pattern). A stale
 * instruction-cache line still calling the wrapper is harmless: it keeps working after the first call. */
export function fxOrderCode(images:CodeImage[],org:number,sender:number,sites:readonly number[]=[]) {
  assertNativeMenu(images);
  const read=reader(images);
  const a=new Asm(org),i=(op:string,...args:string[])=>a.i(op,...args),abs=(n:number)=>`0x${n.toString(16)}.l`;
  const save=(regs:string,n:number)=>{i('lea',`-${n}(a7)`,'a7');i('movem.l',regs,'(a7)');};
  const restore=(regs:string,n:number)=>{i('movem.l','(a7)',regs);i('lea',`${n}(a7)`,'a7');};
  for(const [name,site,value] of [['up',0x2c47f4,0],['down',0x2c4e5a,1]] as const) {
    a.label(name); i('move.l',abs(S.page),'d0');i('cmpi.l','#63','d0');i('bne.b',name+'_native');
    i('moveq',`#${value}`,'d0');i('move.l','d0',abs(S.row));i('bra.w','redraw');
    a.label(name+'_native');i('move.l',abs(S.page),'d0');i('jmp',abs(site+6));
  }
  a.label('setting');
  i('clr.l','d1');i('move.b',abs(S.slot),'d1');i('move.l','d1','d2');i('lsl.l','#2','d2');
  i('move.l','d1','d0');i('lsl.l','#6','d0');i('sub.l','d2','d0');i('sub.l','d1','d0');
  i('move.l','d0','d2');i('lsl.l','#2','d2');i('sub.l','d0','d2');i('add.l','d1','d2');
  i('lea',abs(S.settings),'a0');i('adda.l','d2','a0');i('rts');
  a.label('sender');
  // Seeing a native parameter send proves DSP1 is initialized. Global loading
  // also runs during startup, before it is safe to touch the host port.
  i('move.l','d0','-(a7)');i('move.l',abs(S.ready),'d0');i('bne.w','sender_ready');
  i('moveq','#1','d0');i('move.l','d0',abs(S.ready));
  if(sites.length) {
    // unhook: the call sites get the real sender back; masked, so no interrupt sees a half-written address
    i('move.l','d3','-(a7)');a.bytes('unhook_save_sr',[0x40,0xc3,0x46,0xfc,0x27,0x00]); // move.w sr,d3; move.w #$2700,sr
    i('move.l',`#${sender>>>0}`,'d0');
    for(const s of sites)i('move.l','d0',abs(s));
    a.bytes('unhook_restore_sr',[0x46,0xc3]);i('move.l','(a7)+','d3');                  // move.w d3,sr
  }
  i('move.l','(a7)+','d0');
  i('bsr.w','sync');i('jmp',abs(sender));
  a.label('sender_ready');i('move.l','(a7)+','d0');i('jmp',abs(sender));
  a.label('global_apply');i('bsr.w','sync');i('jmp','0x212b40.l');
  a.label('global_import');i('bsr.w','sync');i('jmp','0x2129e8.l');
  a.label('sync');
  save('d0-d3/a0',20);i('tst.l',abs(S.ready));i('beq.w','sent');
  i('bsr.w','setting');i('clr.l','d2');i('move.b','(a0)','d2');
  i('lsr.l','#4','d2');i('moveq','#3','d1');i('and.l','d1','d2');
  i('move.l',abs(S.cache),'d0');i('cmp.l','d0','d2');i('beq.b','sent');
  // Follow the native atomic Y-write transaction: address, command, NOP, count,
  // data. No timeout can leave the DSP expecting the rest of a partial packet.
  a.bytes('save_sr',[0x40,0xc3,0x46,0xfc,0x27,0x00]);
  i('move.l',`#${FX_ORDER_WORD}`,'d1');i('move.l','d1','0x500004.l');
  i('moveq','#-119','d0');i('move.b','d0','0x500001.l');i('nop');
  i('clr.l','d1');i('move.l','d1','0x500004.l');i('move.l','d2','0x500004.l');
  i('move.l','d2',abs(S.cache));a.bytes('restore_sr',[0x46,0xc3]);
  a.label('sent');restore('d0-d3/a0',20);i('rts');
  // Preserve routing bits when the original single-row resolution editor runs.
  // These sites are inside the old body, so a later SWAP SPEEDS replacement
  // (which already preserves all other bits) simply makes them unreachable.
  a.label('resolution_read');i('clr.l','d0');i('move.b','1(a0,d1.l)','d0');
  i('move.l','d1','-(a7)');i('moveq','#1','d1');i('and.l','d1','d0');i('move.l','(a7)+','d1');i('rts');
  a.label('resolution_store');i('lea','0x71216c.l','a0');i('clr.l','d0');i('move.b','1(a0,d1.l)','d0');
  i('move.l','d1','-(a7)');i('moveq','#-2','d1');i('and.l','d1','d0');i('or.l','d0','d3');i('move.l','(a7)+','d1');i('rts');
  a.label('edit');i('move.l',abs(S.page),'d0');i('cmpi.l','#63','d0');i('beq.b','edit_fx');i('jmp',abs(S.edit));
  a.label('edit_fx');save('d2-d3/a2',12);i('move.l','16(a7)','d3');i('tst.l','d3');i('beq.w','edited');i('bsr.w','setting');
  i('clr.l','d0');i('move.b','(a0)','d0');i('tst.l',abs(S.row));i('bne.b','edit_srr');
  i('moveq','#-17','d1');i('and.l','d1','d0');i('tst.l','d3');i('bpl.b','store');
  i('moveq','#16','d1');i('or.l','d1','d0');i('bra.b','store');
  a.label('edit_srr');i('moveq','#-33','d1');i('and.l','d1','d0');i('tst.l','d3');i('bpl.b','store');
  i('moveq','#32','d1');i('or.l','d1','d0');
  a.label('store');i('move.b','d0','(a0)');i('bsr.w','sync');a.label('edited');i('bsr.w','redraw');restore('d2-d3/a2',12);i('rts');
  a.label('draw');i('move.l',abs(S.page),'d0');i('cmpi.l','#63','d0');i('beq.b','draw_fx');i('jmp',abs(S.draw));
  a.label('draw_fx');i('clr.l',abs(S.row));
  a.label('redraw');save('d2-d3/a2',12);
  i('clr.l','-(a7)');i('pea','52.w');i('pea','118.w');i('pea','3.w');i('pea','3.w');
  i('pea',abs(S.surface));i('jsr',abs(S.rect));i('lea','24(a7)','a7');
  i('bsr.w','setting');i('clr.l','d3');i('move.b','(a0)','d3');
  const text=(label:string,x:number,y:number)=>{
    i('pea',`@${label}`);i('pea','65535.w');i('pea',`${y}.w`);i('pea',`${x}.w`);
    i('pea',abs(S.surface));i('pea',abs(S.font));i('jsr',abs(S.text));i('lea','24(a7)','a7');
  };
  text('name',45,45);
  for(const [name,bit,y] of [['dist',4,34],['srr',5,22]] as const) {
    text(name,13,y);i('btst',`#${bit}`,'d3');i('bne.b',name+'_pre');
    text('post',91,y);i('bra.b',name+'_done');a.label(name+'_pre');text('pre',95,y);a.label(name+'_done');
  }
  i('tst.l',abs(S.row));i('bne.b','srr_selected');i('moveq','#33','d2');i('bra.b','highlight');
  a.label('srr_selected');i('moveq','#21','d2');a.label('highlight');
  i('pea','65535.w');i('move.l','d2','d0');i('addq.l','#7','d0');i('move.l','d0','-(a7)');
  i('pea','111.w');i('move.l','d2','-(a7)');i('pea','88.w');i('pea',abs(S.surface));
  i('jsr',abs(S.rect));i('lea','24(a7)','a7');restore('d2-d3/a2',12);i('rts');
  a.label('code_end');
  for(const [name,value] of Object.entries({name:'FX ORDER',dist:'DIST',srr:'SRR',pre:'PRE',post:'POST'}))a.bytes(name,new TextEncoder().encode(value+'\0'));
  a.align(4);const code=a.assemble();
  if(decodeLinear(code.bytes.subarray(0,code.labels.code_end-org),org).some(x=>!x.ok))throw new Error('FX order: non-ISA_A code');
  const changes=new Map<number,number>(),before=new Map<number,number>();
  const put=(at:number,data:Uint8Array)=>{
    // Boot patches are longwords, including hooks aligned to a halfword.
    const old=read(at,(data.length+3)&~3);if(!old)throw new Error('FX order: missing patch source');
    const next=old.slice();next.set(data);
    for(let k=0;k<next.length;k+=4){changes.set(at+k,u32(next,k));before.set(at+k,u32(old,k));}
  };
  for(const [at,name,op] of [[0x2c47f4,'up',0x4ef9],[0x2c4e5a,'down',0x4ef9],
    [0x22f98e,'resolution_read',0x4eb9],[0x22f9ba,'resolution_store',0x4eb9]] as const)
    put(at,concat([Uint8Array.of(op>>8,op&255),be32(code.labels[name])]));
  for(const [at,name] of [[0x2d2fa4,'draw'],[0x2c58e0,'edit'],[0x2c5f00,'edit'],[0x20c050,'global_apply'],[0x20842a,'global_import']] as const)put(at,be32(code.labels[name]));
  put(S.table+8,be32(4));put(S.table+24,be32(code.labels.name));put(S.table+56,be32(63));
  // Reuse the native mechanical-settings dispatch for the new page's draw and
  // left/right editing. The body wrappers distinguish page 63 from page 54.
  for(const table of [0x2d2200,0x2c558e,0x2c5bb4]) {
    const source=read(table+2*(54-10),2)!,target=read(table+2*(63-10),2)!;
    const expectedDefault=table===0x2d2200?'0228':'ff7a';
    if(!equal(target,hex(expectedDefault)))throw new Error('FX order: menu page 63 is already used');
    put(table+2*(63-10),source);
  }
  put(0x2c408a,hex('743f')); // native EXIT routing-page range: 60..63
  const {ranges,dataSites}=fxOrderGateSites(images,[...changes])!;
  return {code,patches:[...changes],checks:[...before],settings:S,ranges,dataSites};
}
