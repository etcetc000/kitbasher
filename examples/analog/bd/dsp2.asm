; Analog recreation. MODE selects only the documented analog-engine subset.
code_origin:
init:
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>code_origin+7
    move x0,y:(r0)+
    move #$0,x0
    move x0,x:(r6+$3f)
    move #$8,x0
    move x0,x:(r6+$3c)
    move #>$ffffff,x0
    move x0,x:(r6+$3e)
    bsr <local_3d
    rts
trigger:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$7,y0
    mpy y0,x0,a
    move a1,a
    add #>cmap,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,x:(r6+$3c)
    move y:(r6+$3),y0
    move y0,x:(r6+$3e)
    move x0,y:(r6+$3)
    bsr <local_4e
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
render:
    move y:(r6+$3),a
    move x:(r6+$3e),x0
    cmp x0,a
    bne <local_2e
    move x:(r6+$3c),x0
    move x0,y:(r6+$3)
    bra <local_2a
local_2a:
    bsr <local_71
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
local_2e:
    asr #$10,a,a
    move a1,x0
    move #$7,y0
    mpy y0,x0,a
    move a1,a
    add #>cmap,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,x:(r6+$3c)
    move y:(r6+$3),y0
    move y0,x:(r6+$3e)
    move x0,y:(r6+$3)
    bra <local_2a
local_3d:
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$30,>code_origin+68
    move x0,y:(r0)+
    move #>$1,x0
    move x0,y:(r6+$36)
    move #>$ffffff,x0
    move x0,y:(r6+$21)
    move #>$200,x0
    move x0,y:(r6+$20)
    rts
local_4e:
    move #>$7fffff,x0
    move x0,y:(r6+$30)
    move x0,y:(r6+$31)
    move x0,y:(r6+$33)
    move x0,y:(r6+$38)
    move #$0,x0
    move x0,y:(r6+$37)
    move x0,y:(r6+$32)
    move x0,y:(r6+$20)
    move y:(r6+$3),y0
    move #>$200000,x0
    mpy y0,x0,a
    lsr #$12,a
    move a1,a
    move #>$6,x0
    cmp x0,a
    tgt x0,a
    asl #$3,a,a
    add #>e0_mode+1,a
    move a1,r0
    move y:(r6+$4),y0
    move y:(r0),x0
    mpy y0,x0,a
    lsr #$12,a
    move a1,a
    sub #<$6,a
    bge <local_70
    move #$0,x0
    move x0,y:(r6+$34)
    move x0,y:(r6+$35)
local_70:
    rts
local_71:
    move y:(r6+$3),y0
    move #>$200000,x0
    mpy y0,x0,a
    lsr #$12,a
    move a1,a
    move #>$6,x0
    cmp x0,a
    tgt x0,a
    move y:(r6+$21),x0
    move a,y:(r6+$21)
    cmp x0,a
    beq <local_8e
    move y:(r6+$37),a
    move y:(r6+$38),b
    add b,a
    tst a
    bne <local_8e
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$9,>code_origin+139
    move x0,y:(r0)+
    move #>$1,x0
    move x0,y:(r6+$36)
local_8e:
    move y:(r6+$21),a
    asl #$3,a,a
    add #>e0_mode+1,a
    move a1,r0
    nop
    move y:(r0)+,a
    move a,y:(r6+$23)
    move y:(r0)+,a
    move a,y:(r6+$1c)
    move y:(r0)+,a
    move a,y:(r6+$1d)
    move y:(r0)+,a
    move a,y:(r6+$1e)
    move y:(r0)+,a
    move a,y:(r6+$24)
    move y:(r0),a
    move a,y:(r6+$1f)
    move y:(r6+$1),b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    move y:(r6+$1),a
    asr #$10,a,a
    add #>e0_finc,a
    move a1,r0
    nop
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$9)
    move y:(r6+$24),a
    sub #<$1,a
    blt <local_f0
    bgt <local_111
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swpr,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$25)
    move a,x0
    move y:(r6+$9),y0
    mpy y0,x0,a         y0,b
    asl #$5,a,a
    sub b,a
    move a,y:(r6+$c)
    move #>$7e145e,x0
    move x0,y:(r6+$d)
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_stms,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$b)
    move #$8,a
    move a,x0
    move y:(r6+$9),y0
    mpy y0,x0,a         y0,b
    asl #$5,a,a
    sub b,a
    move a,y:(r6+$a)
    move #>$7fffff,a
    move y:(r6+$9),x0
    sub x0,a
    move y:(r6+$a),x0
    sub x0,a
    move y:(r6+$c),x0
    cmp x0,a
    tgt x0,a
    move a,y:(r6+$c)
    bra <local_13e
local_f0:
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swpc,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$b)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swpr,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$25)
    bra <local_131
local_111:
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_stms,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$b)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swps,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$25)
local_131:
    move y:(r6+$25),x0
    move y:(r6+$9),y0
    mpy y0,x0,a
    asl #$5,a,a
    move #>$400000,x0
    cmp x0,a            y0,b
    tgt x0,a
    sub b,a
    move a,y:(r6+$a)
    move #$0,x0
    move x0,y:(r6+$c)
    move x0,y:(r6+$d)
local_13e:
    move y:(r6+$2),a
    asr #$12,a,a
    move a1,a
    add #>e0_dec,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$19)
    move y:(r6+$6),a
    asr #$12,a,a
    move a1,a
    add #>e0_hold,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$24)
    move a,x0
    move y:(r6+$20),a
    cmp x0,a
    bgt <local_157
    move #>$7fffff,x0
    move x0,y:(r6+$19)
local_157:
    move #$0,x0
    move y:(r6+$20),a
    tst a
    bne <local_15d
    move #>$5ce14,x0
local_15d:
    move x0,y:(r6+$1a)
    move y:(r6+$20),a
    sub #>$200,a
    bge <local_165
    move y:(r6+$20),a
    add #<$1,a
    move a,y:(r6+$20)
local_165:
    move y:(r6+$1f),y0
    move #>$5b3333,x0
    mpy y0,x0,a
    move a,y:(r6+$1f)
    move #$0,x0
    move x0,y:(r6+$e)
    move x0,y:(r6+$f)
    move x0,y:(r6+$10)
    move x0,y:(r6+$11)
    move x0,y:(r6+$12)
    move x0,y:(r6+$14)
    move x0,y:(r6+$15)
    move x0,y:(r6+$16)
    move x0,y:(r6+$18)
    move x0,y:(r6+$1b)
    move y:(r6+$21),a
    sub #<$2,a
    beq <local_17d
    sub #<$1,a
    beq <local_198
    sub #<$1,a
    beq <local_1c0
    bra <local_1cb
local_17d:
    move y:(r6+$4),a
    asr #$12,a,a
    move a1,a
    add #>e0_fmr,a
    move a1,r0
    move #>$7ae148,x0
    move y:(r0),a
    move a,y:(r6+$14)
    move y:(r6+$5),a
    move a,y:(r6+$15)
    move a,y0
    mpy y0,x0,a
    move a,y:(r6+$15)
    move y:(r6+$6),a
    asr #$12,a,a
    move a1,a
    add #>e0_fmd,a
    move a1,r0
    move #>$70a3d7,x0
    move y:(r0),a
    move a,y:(r6+$16)
    move x0,y:(r6+$e)
    bra <local_1e7
local_198:
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_pr2,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$14)
    move y:(r6+$6),a
    move a,y:(r6+$15)
    move a,y0
    move #>$666666,x0
    mpy y0,x0,a
    move a,y:(r6+$15)
    move #>$7fffff,x0
    move x0,y:(r6+$16)
    move y:(r6+$4),y0
    move #$8,x0
    mpy y0,x0,a
    lsr #$12,a
    move a1,a
    tst a
    bne <local_1bc
    move #>$7fffff,x0
    move x0,y:(r6+$18)
local_1bc:
    move #>$70a3d7,x0
    move x0,y:(r6+$e)
    bra <local_1e7
local_1c0:
    move y:(r6+$4),a
    move a,y:(r6+$1b)
    move a,y0
    move #>$b851f,x0
    mpy y0,x0,a
    move a,y:(r6+$1b)
    move #>$70a3d7,x0
    move x0,y:(r6+$e)
    bra <local_1e7
local_1cb:
    move y:(r6+$4),y0
    move y:(r6+$23),x0
    mpy y0,x0,a
    lsr #$12,a
    move a1,a
    sub #<$6,a
    blt <local_1d3
    bra <local_1d4
local_1d3:
    add #<$6,a
local_1d4:
    move a,y:(r6+$23)
    asl #$2,a,a
    move y:(r6+$23),y0
    move y0,b
    add b,a
    add #>e0_shp,a
    move a1,r0
    nop
    move y:(r0)+,x0
    move x0,y:(r6+$e)
    move y:(r0)+,x0
    move x0,y:(r6+$f)
    move y:(r0)+,x0
    move x0,y:(r6+$10)
    move y:(r0)+,x0
    move x0,y:(r6+$11)
    move y:(r0)+,x0
    move x0,y:(r6+$12)
local_1e7:
    move y:(r6+$21),a
    asl #$3,a,a
    add #>e0_mode,a
    move a1,r0
    nop
    move y:(r0),a
    tst a
    beq <local_207
    move y:(r6+$a),x0
    move y:(r6+$30),y0
    mpy y0,x0,a
    move y:(r6+$c),x0
    move y:(r6+$31),y0
    mac y0,x0,a
    move y:(r6+$9),y0
    move y0,b
    add b,a
    move #>$800,x0
    cmp x0,a
    tlt x0,a
    move a,y0
    move #>$2000,a
    asr #$3,a,a
    move y0,x0
    andi #$fe,ccr
    rep #<$18
    div x0,a
    move a0,a
    move a,y:(r6+$13)
local_207:
    move y:(r6+$5),a
    move a,y:(r6+$24)
    move a,x0
    move y:(r6+$1d),y0
    mpy y0,x0,a
    move a,y:(r6+$1d)
    move y:(r6+$1e),y0
    mpy y0,x0,a
    move a,y:(r6+$1e)
    move y:(r6+$21),a
    sub #<$1,a
    bne <local_22d
    move y:(r6+$24),x0
    move y:(r6+$1d),y0
    mpy y0,x0,a         y0,b
    sub a,b
    move b,y:(r6+$1d)
    move y:(r6+$24),x0
    move y:(r6+$1e),y0
    mpy y0,x0,a
    asl #$1,a,a
    move a,y:(r6+$1e)
    move y:(r6+$5),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_ctec,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$1c)
local_22d:
    move y:(r6+$37),a
    tst a
    bne <local_232
    move y:(r6+$18),x0
    move x0,y:(r6+$22)
local_232:
    move y:(r6+$22),x0
    move x0,y:(r6+$18)
    move #>$7fffff,a
    move y:(r6+$22),y0
    move y0,b
    sub b,a
    move a,y:(r6+$17)
    move y:(r6+$21),a
    asl #$3,a,a
    add #>e0_mode,a
    move a1,r0
    nop
    move y:(r0),a
    tst a
    jne code_origin+838
    move r6,r3
    move #$0,n3
    move (r3)+n3
    move y:(r6+$b),x0
    move x0,x:(r3)+
    move y:(r6+$a),x0
    move x0,x:(r3)+
    move y:(r6+$d),x0
    move x0,x:(r3)+
    move y:(r6+$c),x0
    move x0,x:(r3)+
    move y:(r6+$9),x0
    move x0,x:(r3)+
    move y:(r6+$14),x0
    move x0,x:(r3)+
    move y:(r6+$16),x0
    move x0,x:(r3)+
    move y:(r6+$15),x0
    move x0,x:(r3)+
    move y:(r6+$e),x0
    move x0,x:(r3)+
    move y:(r6+$f),x0
    move x0,x:(r3)+
    move y:(r6+$10),x0
    move x0,x:(r3)+
    move y:(r6+$18),x0
    move x0,x:(r3)+
    move y:(r6+$17),x0
    move x0,x:(r3)+
    move #>$19660d,x0
    move x0,x:(r3)+
    move y:(r6+$1b),x0
    move x0,x:(r3)+
    move y:(r6+$19),x0
    move x0,x:(r3)+
    move y:(r6+$1a),x0
    move x0,x:(r3)+
    move y:(r6+$1c),x0
    move x0,x:(r3)+
    move y:(r6+$1e),x0
    move x0,x:(r3)+
    move y:(r6+$1d),x0
    move x0,x:(r3)+
    move y:(r6+$1f),x0
    move x0,x:(r3)+
    move y:(r6+$14),a
    tst a
    bne <local_2db
    move y:(r6+$15),a
    tst a
    bne <local_2db
    move y:(r6+$18),a
    tst a
    bne <local_2db
    move r6,r0
    move #$0,n0
    move (r0)+n0
    move #$14,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$8,m4
    move r4,r5
    move #$8,m5
    move r6,r2
    move #$23,n2
    move (r2)+n2
    move r6,r3
    move #$24,n3
    move (r3)+n3
    move #>md_sine,r1
    move #>$7fff,m1
    move #$1,n4
    move #$1,n5
    do #<$20,>code_origin+722
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x1
    move a1,y:(r5)+
    mpy x1,y0,b         x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x1
    move a1,y:(r5)+
    mac x1,y0,b         x:(r0)+,x0
    add x0,b            x:(r0)+,x0
    move (r4)+n4
    move (r5)+n5
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x0
    move a1,y:(r5)+
    move b,y0
    move y0,a
    move y:(r4)+,y0
    add y0,a
    move a1,y:(r5)+
    move a1,b
    move (r4)+n4
    move (r5)+n5
    abs b               b,a
    sub #>$400000,b
    asl #$1,b,b
    move b,y1
    lsr #$9,a
    move a1,n1
    move x:(r1+n1),y0
    move x:(r0)+,x0
    mpy y0,x0,a         x:(r0)+,x0
    mpy y0,y0,b
    sub #>$400000,b
    move b,y0
    mac y0,x0,a         x:(r0)+,x0
    mac x0,y1,a
    move x:(r0)+,x0      a,y1
    move x:(r0)+,x0
    mpy x0,y1,a
    move x:(r0)+,x1      y:(r4)+,y0
    mpy x1,y0,a         a,b
    asr a               x:(r0)+,x0
    move a0,x1
    mac x1,x0,b         x1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x0
    add x0,a            b,y1
    move a,y0
    move y0,y:(r5)+
    mpy y1,y0,a         x:(r0)+,x0      y:(r4)+,y0
    move a,y1
    mpy y0,x0,b         x:(r0)+,x0
    move b1,y:(r5)+
    mpy x1,x0,a         x:(r0)+,x1
    add x1,a
    move a,x0
    move y1,a
    mac y0,x0,a
    move x:(r0)+,x0      a,y0
    mpy y0,x0,b
    asl #$1,b,b
    move b,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m1
    move #>$ffffff,m4
    move #>$ffffff,m5
    bra <local_3cd
local_2db:
    move r6,r0
    move #$0,n0
    move (r0)+n0
    move #$14,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$8,m4
    move r4,r5
    move #$8,m5
    move r6,r2
    move #$23,n2
    move (r2)+n2
    move r6,r3
    move #$24,n3
    move (r3)+n3
    move #>md_sine,r1
    move #>$7fff,m1
    move #$1,n4
    move #$1,n5
    do #<$20,>code_origin+829
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x1
    move a1,y:(r5)+
    mpy x1,y0,b         x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x1
    move a1,y:(r5)+
    mac x1,y0,b         x:(r0)+,x0
    add x0,b            x:(r0)+,x0
    move b,y0
    mpy y0,x0,a         y:(r4)+,y0
    asl #$3,a,a
    add y0,a
    move a1,y:(r5)+
    lsr #$9,a
    move a1,n1
    move x:(r1+n1),y1
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x0
    move a1,y:(r5)+
    move y1,a
    asl #$8,a,a
    mpy y1,y0,a         a,x1
    move a,y0
    mpy y0,x0,a         b,y0
    add y0,a            y:(r4)+,y0
    add y0,a
    move a1,y:(r5)+
    move a1,b
    move (r4)+n4
    move (r5)+n5
    abs b               b,a
    sub #>$400000,b
    asl #$1,b,b
    move b,y1
    lsr #$9,a
    move a1,n1
    move x:(r1+n1),y0
    move x:(r0)+,x0
    mpy y0,x0,a         x:(r0)+,x0
    mpy y0,y0,b
    sub #>$400000,b
    move b,y0
    mac y0,x0,a         x:(r0)+,x0
    mac x0,y1,a
    move a,y1
    mpy y1,x1,b         x:(r0)+,x0
    move b,y0
    mpy y0,x0,a         x:(r0)+,x0
    mac x0,y1,a
    move x:(r0)+,x1      y:(r4)+,y0
    mpy x1,y0,a         a,b
    asr a               x:(r0)+,x0
    move a0,x1
    mac x1,x0,b         x1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x0
    add x0,a            b,y1
    move a,y0
    move y0,y:(r5)+
    mpy y1,y0,a         x:(r0)+,x0      y:(r4)+,y0
    move a,y1
    mpy y0,x0,b         x:(r0)+,x0
    move b1,y:(r5)+
    mpy x1,x0,a         x:(r0)+,x1
    add x1,a
    move a,x0
    move y1,a
    mac y0,x0,a
    move x:(r0)+,x0      a,y0
    mpy y0,x0,b
    asl #$1,b,b
    move b,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m1
    move #>$ffffff,m4
    move #>$ffffff,m5
    bra <local_3cd
    move r6,r3
    move #$0,n3
    move (r3)+n3
    move y:(r6+$b),x0
    move x0,x:(r3)+
    move y:(r6+$a),x0
    move x0,x:(r3)+
    move y:(r6+$9),x0
    move x0,x:(r3)+
    move y:(r6+$13),x0
    move x0,x:(r3)+
    move y:(r6+$11),x0
    move x0,x:(r3)+
    move y:(r6+$12),x0
    move x0,x:(r3)+
    move y:(r6+$e),x0
    move x0,x:(r3)+
    move y:(r6+$f),x0
    move x0,x:(r3)+
    move y:(r6+$10),x0
    move x0,x:(r3)+
    move #>$19660d,x0
    move x0,x:(r3)+
    move y:(r6+$1b),x0
    move x0,x:(r3)+
    move y:(r6+$19),x0
    move x0,x:(r3)+
    move y:(r6+$1a),x0
    move x0,x:(r3)+
    move y:(r6+$1c),x0
    move x0,x:(r3)+
    move y:(r6+$1e),x0
    move x0,x:(r3)+
    move y:(r6+$1d),x0
    move x0,x:(r3)+
    move y:(r6+$1f),x0
    move x0,x:(r3)+
    move r6,r0
    move #$0,n0
    move (r0)+n0
    move #$10,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$8,m4
    move r4,r5
    move #$8,m5
    move r6,r2
    move #$23,n2
    move (r2)+n2
    move r6,r3
    move #$24,n3
    move (r3)+n3
    move #>md_sine,r1
    move #>$7fff,m1
    move #$3,n4
    move #$3,n5
    do #<$20,>code_origin+965
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x1
    move a1,y:(r5)+
    mpy x1,y0,b         x:(r0)+,x0
    add x0,b            x:(r0)+,x1
    move (r4)+n4
    move (r5)+n5
    move y:(r4)+,y0
    add y0,b
    move b1,y:(r5)+
    move b1,b
    move b,x0            b,y:(r3)
    mpy x0,x0,a         y:(r4)+,y0
    move a,y1
    sub y0,a            y1,y:(r5)+
    move a,y0
    mpy x1,y0,a         x:(r0)+,x0
    asl #$c,a,a
    move a,y1
    move b,a
    asl #$8,a,a
    move a,x1
    mpy x0,y1,b         x:(r0)+,x0
    mac x1,x0,b
    move b,y:(r2)
    move y:(r3),b
    abs b               b,a
    sub #>$400000,b
    asl #$1,b,b
    move b,y1
    lsr #$9,a
    move a1,n1
    move x:(r1+n1),y0
    move x:(r0)+,x0
    mpy y0,x0,a         x:(r0)+,x0
    mpy y0,y0,b
    sub #>$400000,b
    move b,y0
    mac y0,x0,a         x:(r0)+,x0
    mac x0,y1,a         y:(r2),y0
    add y0,a            x:(r0)+,x1      y:(r4)+,y0
    mpy x1,y0,a         a,b
    asr a               x:(r0)+,x0
    move a0,x1
    mac x1,x0,b         x1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x:(r0)+,x0
    add x0,a            b,y1
    move a,y0
    move y0,y:(r5)+
    mpy y1,y0,a         x:(r0)+,x0      y:(r4)+,y0
    move a,y1
    mpy y0,x0,b         x:(r0)+,x0
    move b1,y:(r5)+
    mpy x1,x0,a         x:(r0)+,x1
    add x1,a
    move a,x0
    move y1,a
    mac y0,x0,a
    move x:(r0)+,x0      a,y0
    mpy y0,x0,b
    asl #$1,b,b
    move b,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m1
    move #>$ffffff,m4
    move #>$ffffff,m5
local_3cd:
    move y:(r6+$37),a
    move y:(r6+$38),b
    add b,a
    tst a
    bne <local_3dc
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$9,>code_origin+985
    move x0,y:(r0)+
    move #>$1,x0
    move x0,y:(r6+$36)
local_3dc:
    rts
