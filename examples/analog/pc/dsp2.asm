; Analog recreation. MODE selects only the documented analog-engine subset.
code_origin:
init:
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>local_7
    move x0,y:(r0)+
local_7:
    move #$0,x0
    move x0,x:(r6+$3f)
    move #$b,x0
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
    bsr <local_73
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
    bsr <local_88
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
    move #>$ffffff,m0
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>local_46
    move x0,y:(r0)+
local_46:
    move #$0,x0
    move x0,x:(r6+$20)
    move x0,x:(r6+$21)
    move x0,x:(r6+$22)
    move #>$19660d,x0
    move x0,x:(r6+$23)
    move #$0,x0
    move x0,x:(r6+$24)
    move x0,x:(r6+$25)
    move x0,x:(r6+$26)
    move x0,x:(r6+$27)
    move x0,x:(r6+$28)
    move x0,x:(r6+$29)
    move x0,x:(r6+$2a)
    move x0,x:(r6+$2b)
    move #>$5d3d,x0
    move x0,x:(r6+$2c)
    move #$0,x0
    move x0,x:(r6+$2d)
    move #>$2aaaab,x0
    move x0,x:(r6+$2e)
    move #$0,x0
    move x0,x:(r6+$2f)
    move #>$ffffff,x0
    move x0,x:(r6+$0)
    move x0,x:(r6+$1)
    move x0,x:(r6+$2)
    move x0,x:(r6+$3)
    move x0,x:(r6+$4)
    move x0,x:(r6+$5)
    move x0,x:(r6+$6)
    move x0,x:(r6+$7)
    move #>$3,x0
    move x0,y:(r6+$29)
    move #>$1,x0
    move x0,y:(r6+$32)
    move r6,a
    move a1,y:(r6+$2a)
    rts
local_73:
    move #>$7fffff,x0
    move x0,y:(r6+$30)
    move x0,y:(r6+$b)
    move x0,y:(r6+$a)
    move #$0,x0
    move x0,y:(r6+$31)
    move #>$1,x0
    move x0,y:(r6+$29)
    move y:(r6+$2a),a
    or #<$1,a
    move #>$19660d,y0
    move a1,x0
    mpy y0,x0,a
    asr a
    move a0,a
    move a1,y:(r6+$2a)
    move a1,x0
    rts
local_88:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$6,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),b
    cmp b,a
    beq <local_a3
    move a,y:(r6+$9)
    move y:(r6+$35),a
    move y:(r6+$30),b
    add b,a
    tst a
    bne <local_a3
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>local_9e
    move x0,y:(r0)+
local_9e:
    move #>$1,x0
    move x0,y:(r6+$32)
    move #$0,x0
    move x0,y:(r6+$b)
local_a3:
    move y:(r6+$9),a
    move a,b
    asl #$4,a,a
    asl #$2,b,b
    add b,a             r6,r3
    add #>e0_mrec,a
    move a1,r0
    move #$e,n3
    move (r3)+n3
    nop
    do #<$14,>local_b2
    move y:(r0)+,x0
    move x0,y:(r3)+
local_b2:
    move y:(r6+$f),x0
    move x0,x:(r6+$22)
    move y:(r6+$13),x0
    move x0,x:(r6+$26)
    move y:(r6+$1e),x0
    move x0,x:(r6+$29)
    move y:(r6+$1d),x0
    move x0,x:(r6+$2f)
    move y:(r6+$5),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_c6
    move y:(r6+$5),x0
    move x0,x:(r6+$0)
    move y:(r6+$5),a
    move #>e0_nolt,r0
    jsr ki
    move a,x:(r6+$8)
local_c6:
    move y:(r6+$6),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_d2
    move y:(r6+$6),x0
    move x0,x:(r6+$1)
    move y:(r6+$6),a
    move #>e0_ndct,r0
    jsr ki
    move a,x:(r6+$9)
local_d2:
    move y:(r6+$6),a
    move x:(r6+$2),x0
    cmp x0,a
    beq <local_de
    move y:(r6+$6),x0
    move x0,x:(r6+$2)
    move y:(r6+$6),a
    move #>e0_tamt,r0
    jsr ki
    move a,x:(r6+$a)
local_de:
    move y:(r6+$6),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_ea
    move y:(r6+$6),x0
    move x0,x:(r6+$3)
    move y:(r6+$6),a
    move #>e0_tdec,r0
    jsr ki
    move a,x:(r6+$b)
local_ea:
    move y:(r6+$2),a
    move x:(r6+$4),x0
    cmp x0,a
    beq <local_f6
    move y:(r6+$2),x0
    move x0,x:(r6+$4)
    move y:(r6+$2),a
    move #>e0_decr,r0
    jsr ki
    move a,x:(r6+$c)
local_f6:
    move y:(r6+$7),a
    move x:(r6+$5),x0
    cmp x0,a
    beq <local_102
    move y:(r6+$7),x0
    move x0,x:(r6+$5)
    move y:(r6+$7),a
    move #>e0_drgt,r0
    jsr ki
    move a,x:(r6+$d)
local_102:
    move y:(r6+$8),a
    move x:(r6+$6),x0
    cmp x0,a
    beq <local_11b
    move y:(r6+$8),x0
    move x0,x:(r6+$6)
    move y:(r6+$8),b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    move y:(r6+$8),a
    asr #$10,a,a
    add #>e0_swpd,a
    move a1,r0
    nop
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$c)
    move y:(r6+$c),a
    move a,x:(r6+$e)
local_11b:
    move y:(r6+$1),a
    asr a
    add #>$180000,a
    move y:(r6+$1c),x0
    add x0,a
    move y:(r6+$2a),x0
    move #>$7ae,y0
    mac y0,x0,a
    clr b
    max a,b
    move b,x0
    move x0,a
    move a,y:(r6+$c)
    move y:(r6+$c),b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    move y:(r6+$c),a
    asr #$10,a,a
    add #>e0_finc,a
    move a1,r0
    nop
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$d)
    move x:(r6+$e),a
    sub #>$400000,a
    move a,x0
    move y:(r6+$a),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    add #>$400000,a
    move #>e0_octg,r0
    jsr gi
    move a,x0
    move y:(r6+$d),y0
    mpy y0,x0,a
    asl #$5,a,a
    move a,x0
    move x0,y:(r6+$22)
    move x0,x:(r6+$21)
    move y:(r6+$4),x0
    move y:(r6+$11),y0
    mpy y0,x0,a
    move y:(r6+$10),x0
    add x0,a
    move a,y:(r6+$20)
    move y:(r6+$c),x0
    move #>$666666,y0
    mpy y0,x0,a
    move a,y:(r6+$d)
    move y:(r6+$1),a
    asr a
    add #>$180000,a
    move y:(r6+$1c),x0
    add x0,a
    clr b
    max a,b
    move b,x0
    move x0,a
    move a,x0
    move #>$410410,y0
    mpy y0,x0,a
    asl a
    sub #>$17ffa8,a
    move y:(r6+$d),x0
    add x0,a
    move a,x0
    move y:(r6+$12),y0
    mpy y0,x0,a
    move y:(r6+$20),x0
    add x0,a
    clr b
    max a,b
    move b,x0
    move x0,a
    move #>gsin,r0
    jsr gi
    asl #$1,a,a
    move a,x0
    move x0,y:(r6+$27)
    move x0,x:(r6+$27)
    move y:(r6+$1b),x0
    move y:(r6+$a),y0
    mpy y0,x0,a
    move a,y:(r6+$a)
    move x:(r6+$8),a
    move a,y:(r6+$c)
    move a,x0
    move y:(r6+$14),y0
    mpy y0,x0,a
    move a,x0
    move y:(r6+$b),y0
    mpy y0,x0,a
    move a,y:(r6+$25)
    move a,x:(r6+$24)
    move x:(r6+$9),a
    move a,y:(r6+$c)
    move y:(r6+$9),a
    tst a
    bne <local_18d
    move y:(r6+$1a),x0
    move x0,y:(r6+$c)
local_18d:
    move y:(r6+$c),x0
    move y:(r6+$b),y0
    mpy y0,x0,a
    move a,y:(r6+$b)
    move x:(r6+$c),a
    move a,y:(r6+$c)
    move a,x0
    move y:(r6+$e),y0
    mpy y0,x0,a
    asl #$3,a,a
    move #>$7fffff,b
    sub a,b
    move b,y:(r6+$d)
    move b,y:(r6+$23)
    move b,x:(r6+$2a)
    move #$0,x0
    move x0,y:(r6+$24)
    move x0,x:(r6+$2b)
    move y:(r6+$29),a
    sub #<$1,a
    bne <local_1ae
    move #>$7fffff,x0
    move x0,y:(r6+$23)
    move x0,x:(r6+$2a)
    move #>$100000,x0
    move x0,y:(r6+$24)
    move x0,x:(r6+$2b)
    move #>$3,x0
    move x0,y:(r6+$29)
local_1ae:
    move x:(r6+$a),a
    move a,y:(r6+$c)
    move a,x0
    move y:(r6+$18),y0
    mpy y0,x0,a
    move y:(r6+$19),x0
    add x0,a
    move a,y:(r6+$28)
    move x:(r6+$b),a
    move a,y:(r6+$c)
    move y:(r6+$18),a
    tst a
    beq <local_1be
    move y:(r6+$c),x0
    move x0,y:(r6+$17)
    move x0,x:(r6+$20)
local_1be:
    move y:(r6+$17),a
    move y:(r6+$d),b
    cmp b,a
    tgt b,a
    move a,y:(r6+$17)
    move a,x:(r6+$20)
    move y:(r6+$28),x0
    move y:(r6+$15),y0
    mpy y0,x0,a
    move a,y:(r6+$15)
    move a,x:(r6+$25)
    move y:(r6+$28),x0
    move y:(r6+$16),y0
    mpy y0,x0,a
    move a,y:(r6+$16)
    move a,x:(r6+$28)
    move x:(r6+$d),a
    move a,y:(r6+$26)
    move a,x:(r6+$2d)
    move y:(r6+$1f),y0
    move a,x0
    mpy y0,x0,a
    asl a               r6,r0
    move a,x0
    move x0,y:(r6+$26)
    move x0,x:(r6+$2d)
    move #$20,n0
    move (r0)+n0
    move #$f,m0
    move r6,r4
    move #$30,n4
    move (r4)+n4
    move #$6,m4
    move r4,r5
    move #$6,m5
    move #>md_sine,r1
    move #>$7fff,m1
    do #<$20,>local_224
    move x:(r0)+,x0      y:(r4)+,y0
    move y0,n2
    mpy y0,x0,a         x:(r0)+,x0
    move a,y:(r5)+
    move y:(r4)+,a
    add x0,a
    tfr a,b
    lsr #$9,b
    move b1,n1
    move a1,y:(r5)+
    move x:(r1+n1),y1
    move x:(r0)+,x0
    mpy x0,y1,a
    move x:(r0)+,x0      y:(r4)+,y0
    mpy y0,x0,a         a,n3
    asr a               x:(r0)+,x0
    move a0,a
    move a1,y:(r5)+
    move a1,y1
    mpy x0,y1,a         x:(r0)+,x0
    move n2,y0
    mac y0,x0,a         y:(r4)+,x1
    move y:(r4)+,y0
    sub y0,a            x:(r0)+,y1
    mac -y1,x1,a
    mac -y1,x1,a        x1,b
    move x:(r0)+,x0      a,y1
    mac x0,y1,b
    move b,x1
    move y0,b
    mac x1,x0,b         x1,y:(r5)+
    move b,y0
    move x:(r0)+,x0      y0,y:(r5)+
    move n2,y0
    mpy y0,x0,a         n3,y0
    add y0,a            x:(r0)+,x0
    move x1,y0
    mac y0,x0,a
    asr a               x:(r0)+,x1      y:(r4)+,y1
    mpy y1,x1,b         x:(r0)+,x0
    add x0,b            a,y0
    move b,y1
    move y1,y:(r5)+
    mpy y1,y0,a         x:(r0)+,x0      y:(r4)+,y0
    sub y0,a            y0,b
    move a,y1
    mac x0,y1,b         x:(r0)+,x0
    move y1,y0
    mpy y0,x0,a         b,y:(r5)+
    asl #$5,a,a
    move a,x1
    move x1,y0
    mpy x1,y0,a         x1,b
    move a,y0
    mpy x1,y0,a         x:(r0)+,x0
    move a,y0
    mac -y0,x0,b        x:(r0)+,x0
    move b,y0
    mpy y0,x0,a
    asl #$2,a,a
    move a,y:(r7)+
local_224:
    move #>$ffffff,m0
    move #>$ffffff,m4
    move #>$ffffff,m5
    move #>$ffffff,m1
    move y:(r6+$35),a
    move y:(r6+$30),b
    add b,a
    tst a
    bne <local_236
    move #$0,x0
    move x0,y:(r6+$31)
    move x0,y:(r6+$33)
    move x0,y:(r6+$34)
    move x0,y:(r6+$36)
local_236:
    rts
