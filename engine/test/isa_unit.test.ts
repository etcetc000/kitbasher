import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex } from '../src/bytes.js';
import { decode } from '../src/isa.js';
import { negativeControl } from '../src/isa_scan.js';

const d = (h: string) => decode(hex(h), 0, 0x1000);

test('negative control: the planted movem.l d0-d1,-(sp) and bfextu are rejected', () => {
  const n = negativeControl();
  assert.equal(n.movem.ok, false);
  assert.equal(n.bfextu.ok, false);
});

test('rejects what ISA_A lacks, accepts what it has', () => {
  const bad: [string, RegExp][] = [
    ['48e7c000', /-\(An\)/],                 // movem.l d0-d1,-(sp)
    ['4c9f0003', /movem\.w/],                // movem.w (sp)+,d0-d1
    ['40e7', /not an ISA_A|-\(An\)/],        // move.w sr,-(sp)
    ['e9c01008', /bit field/],               // bfextu
    ['0ad00040', /cas|not ColdFire|not ISA_A/], // cas.b
    ['00d01000', /cas|cmp2|chk2/],           // chk2/cmp2.b
    ['81490001', /pack|sbcd/],               // pack
    ['e398', /rol\/ror/],                    // rol.l #1,d0
    ['e390', /roxl/],                        // roxl.l #1,d0
    ['e348', /shift \.w/],                   // lsl.w #1,d0
    ['d041', /only the \.l/],                // add.w d1,d0
    ['c041', /only the \.l/],                // and.w d1,d0
    ['b041', /only the \.l/],                // cmp.w d1,d0
    ['5240', /addq\/subq\.w/],               // addq.w #1,d0
    ['60ff00000010', /32-bit branch/],       // bra.l
    ['20301e00', /x8/],                      // move.l (a0,d1.l*8),d0
    ['20301910', /full-format/],             // move.l ([a0,d1.l]),d0 memory indirect
    ['20301000', /word-sized index/],        // move.l (a0,d1.w),d0
    ['c141', /exg/],                         // exg d0,d1
    ['4808fffc0000', /link\.l/],             // link.l a0,#
    ['4e740004', /rtd/],                     // rtd #4
    ['0e500000', /moves/],                   // moves.w (a0),d0
    ['23fc1234567800001000', /pair/],        // move.l #imm,abs.l (5 words)
    ['4a80'.replace('4a80', '4ac0'), /tas/], // tas d0
    ['f2000000', /line F/],                  // an FPU op
    ['5ac8fffe', /dbcc/],                    // dbpl
    ['0240ffff', /andi\.w/],                 // andi.w
    ['4440', /not an ISA_A/],                // neg.w d0
  ];
  for (const [h, why] of bad) {
    const i = d(h);
    assert.equal(i.ok, false, `${h} accepted as ${i.name}`);
    assert.match(i.why!, why, `${h}: ${i.why}`);
  }
  const good = ['2f02', '48d77cfc', '4cd77cfc', '4e75', '4eb900229dd2', '0280000000f8', '0c8000000078', 'e588', 'e2a8',
                '203900280930', '23c000280930', '2f3c12345678', '4fef000c', '1d40fffb', '4c010800', '4c410800', '82c1',
                '41f900252092', '20301800', '6606', '6000fffe', '7009', '4280', '4a39002d26ac', '4ef9002c0f2e', '51fc', '4e7bf801'];
  for (const h of good) { const i = d(h); assert.ok(i.ok, `${h}: ${i.why}`); assert.equal(i.len, h.length / 2, h); }
});

