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
    move #$6,x0
    move x0,x:(r6+$3c)
    move #>$ffffff,x0
    move x0,x:(r6+$3e)
    bsr <local_3d
    rts
trigger:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$6,y0
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
    bsr <local_71
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
    bsr <local_7b
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
local_2e:
    asr #$10,a,a
    move a1,x0
    move #$6,y0
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
    do #<$37,>code_origin+68
    move x0,y:(r0)+
    move #$0,x0
    move x0,x:(r6+$0)
    move x0,x:(r6+$1)
    move x0,x:(r6+$2)
    move x0,x:(r6+$3)
    move x0,x:(r6+$4)
    move x0,x:(r6+$5)
    move x0,x:(r6+$6)
    move x0,x:(r6+$7)
    move x0,x:(r6+$8)
    move x0,x:(r6+$9)
    move x0,x:(r6+$a)
    move x0,x:(r6+$b)
    move x0,x:(r6+$c)
    move x0,x:(r6+$d)
    move #>$ffffff,x0
    move x0,x:(r6+$28)
    move x0,x:(r6+$29)
    move x0,x:(r6+$2a)
    move x0,x:(r6+$2b)
    move x0,x:(r6+$2c)
    move x0,x:(r6+$2d)
    move x0,x:(r6+$2e)
    move x0,x:(r6+$2f)
    move x0,x:(r6+$30)
    move x0,x:(r6+$31)
    move x0,x:(r6+$32)
    move x0,x:(r6+$33)
    move x0,x:(r6+$34)
    move #>e0_gates,r1
    move r6,r2
    move #$10,n2
    move (r2)+n2
    do #<$18,>code_origin+107
    move y:(r1)+,x0
    move x0,x:(r2)+
    move #>$ffffff,x0
    move x0,y:(r6+$9)
    move #>$ffffff,m0
    rts
local_71:
    move #>$7fffff,x0
    move x0,y:(r6+$38)
    move x0,y:(r6+$3a)
    move x0,y:(r6+$39)
    move x0,y:(r6+$b)
    move #$0,x0
    move x0,y:(r6+$36)
    move x0,y:(r6+$37)
    rts
local_7b:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$b,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),b
    cmp b,a
    beq <local_a0
    move a,y:(r6+$9)
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$8,>code_origin+140
    move x0,y:(r0)+
    move #>$ffffff,m0
    move y:(r6+$9),a
    move a,b
    asl #$3,a,a
    asl #$2,b,b
    add b,a
    move y:(r6+$9),b
    add b,a             r6,r2
    add #>e0_mrec,a
    move a1,r1
    move #$16,n2
    move (r2)+n2
    do #<$d,>code_origin+158
    move y:(r1)+,x0
    move x0,y:(r2)+
    move y:(r6+$1d),x0
    move x0,x:(r6+$6)
local_a0:
    move y:(r6+$4),a
    move x:(r6+$28),x0
    cmp x0,a
    bne <local_a8
    move y:(r6+$9),a
    move x:(r6+$29),x0
    cmp x0,a
    beq <local_c0
local_a8:
    move y:(r6+$4),x0
    move x0,x:(r6+$28)
    move y:(r6+$9),x0
    move x0,x:(r6+$29)
    move y:(r6+$4),a
    asr #$10,a,a
    move a1,x0
    move y:(r6+$17),y0
    mpy y0,x0,a
    move a1,a
    move a,y:(r6+$a)
    asl #$4,a,a
    move y:(r6+$16),x0
    add x0,a
    add #>e0_sets,a
    move a,y:(r6+$23)
    add #<$c,a
    move a1,r1
    move r6,x0
    move y:(r1),a
    add #<$10,a
    add x0,a
    move a1,y:(r6+$2e)
local_c0:
    move y:(r6+$5),a
    move x:(r6+$2a),x0
    cmp x0,a
    beq <local_cc
    move y:(r6+$5),x0
    move x0,x:(r6+$2a)
    move y:(r6+$5),a
    move #>e0_krv,r0
    jsr ki
    move a,x:(r6+$39)
local_cc:
    move x:(r6+$39),a
    move a,y:(r6+$d)
    move y:(r6+$4),a
    sub #>$400000,a
    move a,x0
    move y:(r6+$21),y0
    mpy y0,x0,a
    move a,y:(r6+$24)
    move y:(r6+$8),a
    move x:(r6+$2b),x0
    cmp x0,a
    beq <local_e7
    move y:(r6+$8),x0
    move x0,x:(r6+$2b)
    move y:(r6+$8),a
    move #>e0_swpd,r0
    jsr ki
    move a,x:(r6+$35)
    move y:(r6+$8),a
    move #>e0_swpv,r0
    jsr ki
    move a,x:(r6+$36)
local_e7:
    move x:(r6+$35),a
    move a,x0
    move y:(r6+$b),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    move y:(r6+$1),x0
    move #>$555555,y0
    mpy y0,x0,a
    move y:(r6+$c),x0
    add x0,a
    add #>$255555,a
    move a,y:(r6+$c)
    move x:(r6+$36),a
    move a,x0
    move y:(r6+$b),y0
    mpy y0,x0,a
    move a,y:(r6+$b)
    move y:(r6+$22),a
    tst a
    beq <local_103
    move #>$400000,x0
    move x0,y:(r6+$d)
    move #>$500000,x0
    move x0,y:(r6+$c)
local_103:
    move y:(r6+$23),a
    move a1,r1
    add #<$6,a
    move a1,r2
    move #>e0_osc_meta,r4
    do #<$6,>code_origin+291
    move y:(r1)+,x0
    move y:(r6+$d),y0
    mpy y0,x0,a         y:(r4)+,n6
    asl a               y:(r6+n6),x0
    add x0,a            y:(r4)+,n6
    move y:(r6+$22),y0
    move y:(r6+n6),x0
    mac y0,x0,a
    move y:(r6+$c),x0
    add x0,a
    clr b
    max a,b
    move b,y1
    move y1,a
    move #>e0_gexp,r0
    jsr gi
    move a,y0
    move y:(r2)+,x0
    mpy y0,x0,a         y:(r4)+,n6
    asl #$3,a,a
    move a,x0
    move x0,x:(r6+n6)
    move y:(r6+$21),a
    tst a
    beq <local_13a
    move y:(r6+$5),a
    move x:(r6+$33),x0
    cmp x0,a
    beq <local_132
    move y:(r6+$5),x0
    move x0,x:(r6+$33)
    move y:(r6+$5),a
    move #>e0_pwt,r0
    jsr ki
    move a,y:(r6+$f)
local_132:
    move y:(r6+$30),a
    move y:(r6+$f),x0
    add x0,a
    move a1,y:(r6+$31)
    move y:(r6+$33),a
    move y:(r6+$f),x0
    add x0,a
    move a1,y:(r6+$34)
local_13a:
    move y:(r6+$6),a
    move x:(r6+$34),x0
    cmp x0,a
    beq <local_14c
    move y:(r6+$6),x0
    move x0,x:(r6+$34)
    move y:(r6+$6),a
    move #>e0_trat,r0
    jsr ki
    move a,x:(r6+$37)
    move y:(r6+$6),a
    move #>e0_tamt,r0
    jsr ki
    move a,x:(r6+$38)
local_14c:
    move y:(r6+$2),a
    move x:(r6+$2c),x0
    cmp x0,a
    bne <local_158
    move y:(r6+$6),a
    move x:(r6+$2d),x0
    cmp x0,a
    bne <local_158
    move y:(r6+$9),a
    move x:(r6+$2e),x0
    cmp x0,a
    beq <local_18b
local_158:
    move y:(r6+$2),x0
    move x0,x:(r6+$2c)
    move y:(r6+$6),x0
    move x0,x:(r6+$2d)
    move y:(r6+$9),x0
    move x0,x:(r6+$2e)
    move y:(r6+$2),x0
    move y:(r6+$19),y0
    mpy y0,x0,a
    move y:(r6+$18),x0
    add x0,a
    clr b
    max a,b
    move b,y1
    move y1,a
    move #>e0_gexp,r0
    jsr gi
    move a,y:(r6+$25)
    move a,x0
    move #>$7fffff,a
    sub x0,a
    move a,y:(r6+$28)
    move a,x:(r6+$c)
    move y:(r6+$25),x0
    move y:(r6+$1a),y0
    mpy y0,x0,a
    move a,x0
    move #>$7fffff,a
    sub x0,a
    move a,x:(r6+$a)
    move x:(r6+$37),a
    move y:(r6+$22),b
    tst b
    beq <local_17f
    clr a
local_17f:
    move a,x0
    move #>$7fffff,a
    sub x0,a
    move a,y:(r6+$26)
    move a,x:(r6+$8)
    move y:(r6+$26),a
    move y:(r6+$28),b
    cmp b,a
    tgt b,a
    move a,y:(r6+$26)
    move a,x:(r6+$8)
local_18b:
    move y:(r6+$4),a
    move x:(r6+$2f),x0
    cmp x0,a
    bne <local_193
    move y:(r6+$9),a
    move x:(r6+$30),x0
    cmp x0,a
    beq <local_1a5
local_193:
    move y:(r6+$4),x0
    move x0,x:(r6+$2f)
    move y:(r6+$9),x0
    move x0,x:(r6+$30)
    move y:(r6+$4),x0
    move y:(r6+$1c),y0
    mpy y0,x0,a
    move y:(r6+$1b),x0
    add x0,a
    clr b
    max a,b
    move b,y1
    move y1,a
    move #>e0_bpg,r0
    jsr gi
    move a,x:(r6+$7)
local_1a5:
    move y:(r6+$6),a
    move x:(r6+$31),x0
    cmp x0,a
    bne <local_1ad
    move y:(r6+$9),a
    move x:(r6+$32),x0
    cmp x0,a
    beq <local_1c9
local_1ad:
    move y:(r6+$6),x0
    move x0,x:(r6+$31)
    move y:(r6+$9),x0
    move x0,x:(r6+$32)
    move #>$cda88,x0
    move x0,y:(r6+$e)
    move x:(r6+$38),a
    move y:(r6+$22),b
    tst b
    beq <local_1ba
    move #>$7fffff,a
local_1ba:
    move a,x0
    move y:(r6+$1e),y0
    mpy y0,x0,a
    move a,x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    move a,x:(r6+$9)
    move y:(r6+$1f),x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    move a,x:(r6+$d)
    move y:(r6+$20),x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    move a,x:(r6+$b)
local_1c9:
    move r6,r0
    move #$d,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$a,m4
    move r4,r5
    move #$a,m5
    move y:(r6+$2e),a
    move a1,r1
    do #<$20,>code_origin+531
    clr a               x:(r0)+,x0      y:(r4)+,b
    add x0,b            r1,r3
    move b1,x1
    eor x1,a            b1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,b
    add x0,b
    move b1,x1
    eor x1,a            b1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,b
    add x0,b
    move b1,x1
    eor x1,a            b1,y:(r5)+
    lsr #$17,a
    move a1,y0
    clr a               x:(r0)+,x0      y:(r4)+,b
    add x0,b
    move b1,x1
    eor x1,a            b1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,b
    add x0,b
    move b1,x1
    eor x1,a            b1,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,b
    add x0,b
    move b1,x1
    eor x1,a            b1,y:(r5)+
    lsr #$17,a
    add y0,a
    asl a               x:(r0)+,x0      y:(r4)+,y1
    move a1,n3
    move (r3)+n3
    move y:(r4)+,y0
    move x:(r3)+,a
    move x:(r3),x1
    move x1,a0
    sub y0,a
    mac -x0,y1,a        x:(r0)+,x0
    move a,x1
    tfr y1,b
    mac x1,x0,b         y0,a
    move b,y1
    mac x0,y1,a         b,y:(r5)+
    move a,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         x1,n0
    move x:(r0)+,x1      a,y0
    mpy x1,y0,b         a,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         y1,n3
    move x:(r0)+,x1      a,y0
    mac x1,y0,b         a,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         b,n5
    move x:(r0)+,x1      a,y0
    mpy x1,y0,b         a,y:(r5)+
    move b,y0
    move n3,x1
    mpy x1,y0,a         n5,y0
    move n0,x1
    mac x1,y0,a
    asl #$4,a,a
    move a,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m4
    move #>$ffffff,m5
    move y:(r6+$38),a
    move y:(r6+$39),x0
    add x0,a
    move y:(r6+$3a),x0
    add x0,a
    sub #>$1000,a
    bge <local_22a
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$b,>code_origin+552
    move x0,y:(r0)+
    move #>$ffffff,m0
local_22a:
    rts
