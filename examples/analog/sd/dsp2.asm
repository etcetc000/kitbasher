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
    move #$7,x0
    move x0,x:(r6+$3c)
    move #>$ffffff,x0
    move x0,x:(r6+$3e)
    bsr <local_3d
    rts
trigger:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$5,y0
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
    bsr <local_58
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
    bsr <local_72
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
local_2e:
    asr #$10,a,a
    move a1,x0
    move #$5,y0
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
    move #>$ffffff,x0
    move x0,x:(r6+$0)
    move x0,x:(r6+$1)
    move x0,x:(r6+$2)
    move x0,x:(r6+$3)
    move x0,x:(r6+$4)
    move x0,x:(r6+$5)
    move x0,x:(r6+$6)
    move x0,x:(r6+$7)
    move x0,x:(r6+$d)
    move #>$3,x0
    move x0,y:(r6+$a)
    move #>$1,x0
    move x0,y:(r6+$33)
    move r6,a
    move a1,y:(r6+$3f)
    rts
local_58:
    move #>$7fffff,x0
    move x0,y:(r6+$30)
    move x0,y:(r6+$e)
    move x0,y:(r6+$c)
    move x0,y:(r6+$d)
    move #$0,x0
    move x0,y:(r6+$32)
    move x0,y:(r6+$31)
    move #>$1,x0
    move x0,y:(r6+$a)
    move #>$800000,x0
    move x0,y:(r6+$3c)
    move y:(r6+$3f),a
    or #<$1,a
    move #>$19660d,y0
    move a1,x0
    mpy y0,x0,a
    asr a
    move a0,a
    move a1,y:(r6+$3f)
    move a1,x0
    rts
local_72:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$9,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),b
    cmp b,a
    beq <local_8d
    move a,y:(r6+$9)
    move y:(r6+$37),a
    move y:(r6+$30),b
    add b,a
    tst a
    bne <local_8d
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$9,>code_origin+136
    move x0,y:(r0)+
    move #>$1,x0
    move x0,y:(r6+$33)
    move #$0,x0
    move x0,y:(r6+$e)
local_8d:
    move y:(r6+$9),a
    asl #$4,a,a
    add #>e0_mrec,a
    move a1,r0
    move r6,r3
    move #$12,n3
    move (r3)+n3
    nop
    do #<$10,>code_origin+154
    move y:(r0)+,x0
    move x0,y:(r3)+
    move y:(r6+$8),a
    move a,y:(r6+$2a)
    move y:(r6+$5),a
    move a,y:(r6+$2b)
    move y:(r6+$9),a
    sub #<$1,a
    bne <local_c6
    move #>$400000,x0
    move x0,y:(r6+$2a)
    move y:(r6+$8),b
    move y:(r6+$8),a
    and #>$3fe00,b
    asl #$5,b,b
    asr #$12,a,a
    move a1,a
    asl #$1,a,a
    add #>e0_balf,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0)+,x0
    move y:(r0)+,a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$10)
    move y:(r0),a
    sub x0,a
    tfr x0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$11)
    move y:(r6+$13),x0
    move y:(r6+$10),y0
    mpy y0,x0,a
    asl #$3,a,a
    move a,y:(r6+$13)
    move y:(r6+$14),x0
    move y:(r6+$11),y0
    mpy y0,x0,a
    asl #$3,a,a
    move a,y:(r6+$14)
local_c6:
    move y:(r6+$16),x0
    move y:(r6+$5),y0
    mpy y0,x0,a
    move y:(r6+$15),x0
    add x0,a
    move a,y:(r6+$15)
    move y:(r6+$2b),a
    asl #$1,a,a
    sub #>$7fffff,a
    move a,y0
    move y:(r6+$17),x0
    mpy y0,x0,a
    move a,y:(r6+$17)
    move y:(r6+$6),y0
    mpy y0,y0,a
    move a,x1
    move y:(r6+$1c),y0
    mpy x1,y0,a
    move a,y:(r6+$1c)
    move y:(r6+$1d),y0
    mpy x1,y0,a
    move a,y:(r6+$1d)
    move y:(r6+$6),x1
    move y:(r6+$1f),y0
    mpy x1,y0,a
    move a,y:(r6+$1f)
    move y:(r6+$20),y0
    mpy x1,y0,a
    move a,y:(r6+$20)
    move y:(r6+$4),a
    move x:(r6+$4),x0
    cmp x0,a
    beq <local_102
    move a,x:(r6+$4)
    tfr a,b
    and #>$3fe00,b
    asl #$5,b,b
    asr #$12,a,a
    move a1,a
    asl #$1,a,a
    add #>e0_nenv,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0)+,x0
    move y:(r0)+,a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$29)
    move y:(r0),a
    sub x0,a
    tfr x0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$11)
    move a,x0
    move x0,x:(r6+$b)
local_102:
    move x:(r6+$b),x0
    move x0,y:(r6+$11)
    move y:(r6+$29),x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    move a,y0
    move y:(r6+$1b),x0
    mpy y0,x0,a
    move a,y:(r6+$26)
    move y:(r6+$11),x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    move a,y:(r6+$e)
    move #$0,x0
    move x0,y:(r6+$28)
    move y:(r6+$9),a
    sub #<$3,a
    bne <local_155
    move y:(r6+$5),y0
    move #>$2fa4ce,x0
    mpy y0,x0,a
    add #>$305845,a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>gsin,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    asl #$1,a,a
    move a,x0
    move x0,y:(r6+$18)
    move y:(r6+$5),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_nqt,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$19)
    move y:(r6+$6),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$6),a
    asr #$12,a,a
    add #>e0_nhpg,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$1a)
    move #>$7fffff,a
    move y:(r6+$29),x0
    move #>$35c28f,y0
    mac -y0,x0,a
    move a,y0
    move y:(r6+$13),x0
    mpy y0,x0,a
    move a,y:(r6+$13)
local_155:
    move y:(r6+$9),a
    sub #<$4,a
    bne <local_160
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_holdt,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$28)
local_160:
    move y:(r6+$1),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_177
    move y:(r6+$1),x0
    move x0,x:(r6+$0)
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
    move a,y:(r6+$f)
local_177:
    move y:(r6+$2a),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_1a3
    move y:(r6+$2a),x0
    move x0,x:(r6+$1)
    move y:(r6+$2a),b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    move y:(r6+$2a),a
    asr #$10,a,a
    add #>e0_swpd,a
    move a1,r0
    nop
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$10)
    move y:(r6+$2a),b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    move y:(r6+$2a),a
    asr #$10,a,a
    add #>e0_swpv,a
    move a1,r0
    nop
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$11)
    move y:(r6+$10),x0
    move x0,x:(r6+$8)
    move y:(r6+$11),x0
    move x0,x:(r6+$9)
local_1a3:
    move x:(r6+$8),x0
    move x0,y:(r6+$10)
    move x:(r6+$9),x0
    move x0,y:(r6+$11)
    move y:(r6+$10),x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move y:(r6+$3f),x0
    move #>$7e0,y0
    mac y0,x0,a
    move y:(r6+$20),x0
    move y:(r6+$d),y0
    mac y0,x0,a
    add #>$400000,a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_bndg,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x0
    move y:(r6+$f),y0
    mpy y0,x0,a
    asl #$6,a,a
    move a,x0
    move x0,y:(r6+$22)
    move y:(r6+$11),x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    move #>$6eb584,x0
    move y:(r6+$d),y0
    mpy y0,x0,a
    move a,y:(r6+$d)
    move y:(r6+$15),a
    move x:(r6+$5),x0
    cmp x0,a
    beq <local_1e4
    move a,x:(r6+$5)
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_octg,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$c)
local_1e4:
    move x:(r6+$c),a
    move a,x0
    move y:(r6+$22),y0
    mpy y0,x0,a
    asl #$3,a,a
    move a,x0
    move x0,y:(r6+$23)
    move y:(r6+$2),a
    move x:(r6+$2),x0
    cmp x0,a
    beq <local_201
    move a,x:(r6+$2)
    tfr a,b
    and #>$3fe00,b
    asl #$5,b,b
    asr #$12,a,a
    add #>e0_decr,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$10)
    move a,x0
    move x0,x:(r6+$a)
local_201:
    move x:(r6+$a),x0
    move x0,y:(r6+$10)
    move y:(r6+$12),y0
    mpy y0,x0,a
    asl #$3,a,a
    move #>$7fffff,b
    sub a,b
    move b,y:(r6+$24)
    move #$0,x0
    move x0,y:(r6+$25)
    move y:(r6+$a),a
    sub #<$1,a
    bne <local_221
    move #>$7fffff,x0
    move x0,y:(r6+$24)
    move #>$100000,x0
    move x0,y:(r6+$25)
    move y:(r6+$28),a
    tst a
    beq <local_21d
    move a,y:(r6+$b)
    move #>$2,x0
    move x0,y:(r6+$a)
    bra <local_22e
local_21d:
    move #>$3,x0
    move x0,y:(r6+$a)
    bra <local_22e
local_221:
    sub #<$1,a
    bne <local_22e
    move #>$7fffff,x0
    move x0,y:(r6+$24)
    move y:(r6+$b),a
    sub #<$1,a
    move a,y:(r6+$b)
    tst a
    bgt <local_22e
    move #>$3,x0
    move x0,y:(r6+$a)
local_22e:
    move y:(r6+$7),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_242
    move a,x:(r6+$3)
    tfr a,b
    and #>$3fe00,b
    asl #$5,b,b
    asr #$12,a,a
    add #>e0_drgt,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$27)
local_242:
    move r6,r3
    move #$20,n3
    move (r3)+n3
    move y:(r6+$1e),x0
    move x0,x:(r3)+
    move y:(r6+$1f),x0
    move x0,x:(r3)+
    move y:(r6+$23),x0
    move x0,x:(r3)+
    move y:(r6+$22),x0
    move x0,x:(r3)+
    move y:(r6+$14),x0
    move x0,x:(r3)+
    move y:(r6+$13),x0
    move x0,x:(r3)+
    move y:(r6+$17),x0
    move x0,x:(r3)+
    move #>$19660d,x0
    move x0,x:(r3)+
    move y:(r6+$1d),x0
    move x0,x:(r3)+
    move y:(r6+$1c),x0
    move x0,x:(r3)+
    move y:(r6+$26),x0
    move x0,x:(r3)+
    move y:(r6+$1a),x0
    move x0,x:(r3)+
    move y:(r6+$18),x0
    move x0,x:(r3)+
    move y:(r6+$19),x0
    move x0,x:(r3)+
    move y:(r6+$24),x0
    move x0,x:(r3)+
    move y:(r6+$25),x0
    move x0,x:(r3)+
    move #>$5d3d,x0
    move x0,x:(r3)+
    move y:(r6+$27),x0
    move x0,x:(r3)+
    move #>$2aaaab,x0
    move x0,x:(r3)+
    move y:(r6+$21),x0
    move x0,x:(r3)+
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$13,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$8,m4
    move r4,r5
    move #$8,m5
    move r6,r2
    move #$39,n2
    move (r2)+n2
    move r6,r3
    move #$3a,n3
    move (r3)+n3
    move #>md_sine,r1
    move #>$7fff,m1
    move x:(r0)+,x0      y:(r4)+,y0
    do #<$20,>code_origin+717
    mpy y0,x0,a         x:(r0)+,x1
    mpy x1,y0,b         a,y:(r5)+
    move b,x1            y0,y:(r2)
    move x:(r0)+,x0      y:(r4)+,a
    add x0,a
    tfr a,b             x:(r0)+,x0      y:(r4)+,y0
    lsr #$9,b
    move b1,n1
    tfr y0,a            a1,y:(r5)+
    move x:(r1+n1),y1
    mpy y1,x1,b
    asl #$2,b,b
    add a,b
    add x0,a            x:(r0)+,x0
    lsr #$9,b
    move b1,n1
    move a1,y:(r5)+
    move x:(r1+n1),y0
    mpy x0,y1,a         x:(r0)+,x0
    mac y0,x0,a         x:(r0)+,x0
    move a,y0
    mpy y0,y0,b
    move b,y1
    mac x0,y1,a         x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         a,y:(r3)
    asr a               x:(r0)+,x0
    move a0,y1
    mpy x0,y1,a         x:(r0)+,x0      y1,y:(r5)+
    add x0,a            y:(r2),y0
    move a,x1
    mpy x1,y0,a         y:(r3),y0
    add y0,a            x:(r0)+,x0
    move a,y:(r3)
    mpy x0,y1,a         x:(r0)+,x0      y:(r4)+,y0
    sub y0,a
    tfr y0,b            a,y1
    mac x0,y1,b         x:(r0)+,x0      y:(r4)+,y0
    tfr y1,a            b,y:(r5)+
    move y:(r4)+,x1
    sub x1,a            x:(r0)+,y1
    mac -y1,y0,a
    mac -y1,y0,a
    tfr y0,b            a,y1
    mac x0,y1,b
    move b,y0
    tfr x1,b            y0,y:(r5)+
    mac y0,x0,b         x:(r0)+,x0      y:(r4)+,y1
    move b,y0
    mpy x0,y1,b         x:(r0)+,x0      y0,y:(r5)+
    add x0,b            y:(r3),a
    move b,y1
    add y0,a            y1,y:(r5)+
    asr a
    move a,y0
    mpy y1,y0,a         x:(r0)+,x0      y:(r4)+,y0
    sub y0,a
    tfr y0,b            a,y1
    mac x0,y1,b         x:(r0)+,x0
    mpy x0,y1,a         b,y:(r5)+
    asl #$5,a,a
    move a,x0
    mpy x0,x0,a         x0,x1
    move a,y0
    mpy x1,y0,a         x:(r0)+,x0
    tfr x1,b            a,y0
    mac -y0,x0,b        x:(r0)+,x0
    move b,y0
    mpy y0,x0,a         y:(r4)+,y0
    asl #$2,a,a
    move x:(r0)+,x0      a,y:(r7)+
    move y:(r6+$37),a
    move y:(r6+$30),b
    add b,a
    tst a
    bne <local_2d9
    move #$0,x0
    move x0,y:(r6+$32)
    move x0,y:(r6+$31)
    move x0,y:(r6+$34)
    move x0,y:(r6+$35)
    move x0,y:(r6+$36)
    move x0,y:(r6+$38)
local_2d9:
    rts
