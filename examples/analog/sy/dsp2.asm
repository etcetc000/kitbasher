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
    move #$4,x0
    move x0,x:(r6+$3c)
    move #>$ffffff,x0
    move x0,x:(r6+$3e)
    bsr <local_3d
    rts
trigger:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$b,y0
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
    bsr <local_59
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
    bsr <local_c3
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
local_2e:
    asr #$10,a,a
    move a1,x0
    move #$b,y0
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
    move #>$ffffff,m0
    move #>$ffffff,x0
    move x0,y:(r6+$9)
    move #>$3039,x0
    move x0,y:(r6+$13)
    move r6,a
    move a1,y:(r6+$1d)
    move r6,a
    add #>$2b5ad,a
    move a1,y:(r6+$3e)
    rts
local_59:
    move y:(r6+$a),x0
    move x0,y:(r6+$15)
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$f,y0
    mpy y0,x0,a
    move a1,a
    move a,y:(r6+$9)
    move y:(r6+$9),a
    add #>e0_stb,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,a
    move a1,b
    and #<$f,b
    move b,y:(r6+$b)
    asr #$4,a,a
    move a1,a
    move a,y:(r6+$a)
    move y:(r6+$a),a
    move y:(r6+$15),x0
    cmp x0,a
    beq <local_7c
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>code_origin+122
    move x0,y:(r0)+
    move #>$ffffff,m0
local_7c:
    move #>$7fffff,x0
    move x0,y:(r6+$c)
    move #$0,x0
    move x0,y:(r6+$f)
    move #$0,x0
    move x0,y:(r6+$10)
    move #$0,x0
    move x0,y:(r6+$e)
    move #$0,x0
    move x0,y:(r6+$12)
    move #>$1,x0
    move x0,y:(r6+$25)
    move #>$7fffff,x0
    move x0,y:(r6+$22)
    move #>$7fffff,x0
    move x0,y:(r6+$26)
    move y:(r6+$a),a
    tst a
    bne <local_98
    move y:(r6+$b),a
    and #<$4,a
    tst a
    beq <local_a6
    bra <local_9d
local_98:
    sub #<$1,a
    bne <local_9d
    move y:(r6+$b),a
    tst a
    beq <local_a6
local_9d:
    move #$0,x0
    move x0,y:(r6+$20)
    move #$0,x0
    move x0,y:(r6+$21)
    move #$0,x0
    move x0,y:(r6+$23)
    move #$0,x0
    move x0,y:(r6+$24)
    bra <local_b1
local_a6:
    move y:(r6+$23),a
    tst a
    bne <local_b1
    bsr <local_b8
    move a1,y:(r6+$23)
    mpy x0,x0,a
    move a,y:(r6+$24)
    bsr <local_b8
    move a1,y:(r6+$20)
    mpy x0,x0,a
    move a,y:(r6+$21)
local_b1:
    bsr <local_b8
    move #>$7ae,y0
    mpy y0,x0,a
    move a,y:(r6+$1e)
    bsr <local_b8
    rts
local_b8:
    move y:(r6+$1d),a
    or #<$1,a
    move #>$19660d,y0
    move a1,x0
    mpy y0,x0,a
    asr a
    move a0,a
    move a1,y:(r6+$1d)
    move a1,x0
    rts
local_c3:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$f,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),y0
    cmp y0,a
    beq <local_100
    move a,y:(r6+$9)
    move y:(r6+$a),a
    sub #<$3,a
    blt <local_d4
    move #>$1,a
    move a,y:(r6+$15)
    bra <local_d6
local_d4:
    move #$0,a
    move a,y:(r6+$15)
local_d6:
    move y:(r6+$9),a
    add #>e0_stb,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,a
    move a1,b
    and #<$f,b
    move b,y:(r6+$b)
    asr #$4,a,a
    move a1,a
    move a,y:(r6+$a)
    move y:(r6+$a),a
    sub #<$3,a
    blt <local_ea
    move #>$1,a
    move a,y:(r6+$16)
    bra <local_ec
local_ea:
    move #$0,a
    move a,y:(r6+$16)
local_ec:
    move y:(r6+$16),a
    move y:(r6+$15),x0
    cmp x0,a
    bne <local_f7
    move y:(r6+$21),a
    move y:(r6+$22),b
    add b,a
    move y:(r6+$26),b
    add b,a
    tst a
    bne <local_100
local_f7:
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>code_origin+254
    move x0,y:(r0)+
    move #>$ffffff,m0
local_100:
    move y:(r6+$3e),a
    or #<$1,a
    move #>$19660d,y0
    move a1,x0
    mpy y0,x0,a
    asr a
    move a0,a
    move a1,y:(r6+$3e)
    move y:(r6+$1f),y1
    move #>$5c,y0
    tfr y1,a            a1,x0
    mac y0,x0,a
    move #>$2f8e,x1
    macr -y1,x1,a
    move a,y:(r6+$1f)
    move y:(r6+$1d),x0
    move #>$7ae,y0
    mac y0,x0,a
    move a,y:(r6+$3f)
    move y:(r6+$a),a
    tst a
    beq <local_11e
    sub #<$1,a
    beq <local_20c
    jmp code_origin+766
local_11e:
    move y:(r6+$8),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_134
    move y:(r6+$8),x0
    move x0,x:(r6+$0)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swo,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$8)
local_134:
    move x:(r6+$8),a
    move a,y:(r6+$15)
    move a,y0
    move y:(r6+$c),x0
    mpy y0,x0,a
    move a,y:(r6+$14)
    move y:(r6+$8),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_150
    move y:(r6+$8),x0
    move x0,x:(r6+$1)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swv,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$9)
local_150:
    move x:(r6+$9),a
    move a,y:(r6+$15)
    move a,x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    move y:(r6+$5),a
    asr #$10,a,a
    move a1,x0
    move #$a,y0
    mpy y0,x0,a
    move a1,a
    move a1,b
    and #<$1,b
    move b,y:(r6+$15)
    asr #$1,a,a
    move a1,a
    move a,y:(r6+$16)
    move y:(r6+$15),a
    add #>e0_w1d,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$17)
    move y:(r6+$16),a
    add #>e0_w2d,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$18)
    move y:(r6+$1),a
    asr a
    add #>$180000,a
    move y:(r6+$14),x0
    add x0,a
    move y:(r6+$3f),x0
    add x0,a
    move #$0,x0
    cmp x0,a
    bge <local_179
    move x0,a
local_179:
    move #>$7fffff,x0
    cmp x0,a
    ble <local_17e
    move x0,a
local_17e:
    move a,y:(r6+$19)
    move y:(r6+$4),a
    move #>$400000,x0
    sub x0,a
    asr #$2,a,a
    move a1,a
    move a,y:(r6+$1a)
    move y:(r6+$19),a
    move y:(r6+$1a),x0
    add x0,a
    move y:(r6+$1e),x0
    add x0,a
    move y:(r6+$1f),x0
    sub x0,a
    sub x0,a            r6,r3
    move a,y:(r6+$1a)
    move y:(r6+$18),x0
    move x0,n2
    move #$27,n3
    move (r3)+n3
    move y:(r6+$1a),a
    jsr code_origin+1054
    move y:(r6+$17),x0
    move x0,n2
    move r6,r3
    move #$30,n3
    move (r3)+n3
    move y:(r6+$19),a
    jsr code_origin+1054
    move y:(r6+$b),a
    and #<$2,a
    tst a
    beq <local_1a7
    move y:(r6+$30),a
    move #>$8eb,x0
    add x0,a
    move a,y:(r6+$30)
local_1a7:
    move y:(r6+$2),a
    move x:(r6+$2),x0
    cmp x0,a
    beq <local_1bd
    move y:(r6+$2),x0
    move x0,x:(r6+$2)
    move y:(r6+$2),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$2),a
    asr #$12,a,a
    add #>e0_dcA,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$a)
local_1bd:
    move x:(r6+$a),a
    move a,y:(r6+$39)
    move y:(r6+$7),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_1d5
    move y:(r6+$7),x0
    move x0,x:(r6+$3)
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_dcB,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$b)
local_1d5:
    move x:(r6+$b),a
    move a,y:(r6+$2e)
    move y:(r6+$6),x0
    move x0,y:(r6+$15)
    move #>$7fffff,a
    sub x0,a
    move a,y:(r6+$16)
    move #$0,x0
    move x0,y:(r6+$3b)
    move x0,y:(r6+$3a)
    move x0,y:(r6+$3c)
    move x0,y:(r6+$2f)
    move x0,y:(r6+$38)
    move y:(r6+$b),a
    and #<$3,a
    tst a
    bne <local_1ec
    move y:(r6+$16),x0
    move x0,y:(r6+$3b)
    move y:(r6+$15),x0
    move x0,y:(r6+$3a)
    bra <local_202
local_1ec:
    sub #<$1,a
    tst a
    bne <local_1f4
    move y:(r6+$16),x0
    move x0,y:(r6+$3b)
    move y:(r6+$15),x0
    move x0,y:(r6+$3c)
    bra <local_202
local_1f4:
    sub #<$1,a
    tst a
    bne <local_1fd
    move #>$7fffff,x0
    move x0,y:(r6+$3b)
    move y:(r6+$15),x0
    move x0,y:(r6+$2f)
    bra <local_202
local_1fd:
    move #>$7fffff,x0
    move x0,y:(r6+$3c)
    move y:(r6+$15),x0
    move x0,y:(r6+$2f)
local_202:
    move #>$19660d,x0
    move x0,y:(r6+$37)
    move #>$3eb852,x0
    move x0,y:(r6+$3d)
    jsr code_origin+1125
    jmp code_origin+1110
local_20c:
    move y:(r6+$8),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_222
    move y:(r6+$8),x0
    move x0,x:(r6+$0)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swo,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$8)
local_222:
    move x:(r6+$8),a
    move a,y:(r6+$15)
    move a,y0
    move y:(r6+$c),x0
    mpy y0,x0,a
    move a,y:(r6+$14)
    move y:(r6+$8),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_23e
    move y:(r6+$8),x0
    move x0,x:(r6+$1)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swv,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$9)
local_23e:
    move x:(r6+$9),a
    move a,y:(r6+$15)
    move a,x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    move y:(r6+$5),a
    asr #$10,a,a
    move a1,x0
    move #>$2a0000,y0
    mpy y0,x0,a
    move a1,a
    move a,y:(r6+$15)
    move a1,x0
    move #>$124925,y0
    mpy y0,x0,a
    move a1,a
    move a,y:(r6+$16)
    move a1,b
    asl #$3,a,a
    sub b,a
    move a1,b
    move y:(r6+$15),a
    sub b,a
    move a,y:(r6+$17)
    move y:(r6+$16),a
    add #>e0_wrs,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$18)
    move y:(r6+$17),a
    sub #<$6,a
    blt <local_26d
    move #>$3,x0
    move x0,y:(r6+$19)
    move #>$2aaaab,x0
    move x0,y:(r6+$1a)
    move #>$2aaaab,x0
    move x0,y:(r6+$3c)
    bra <local_279
local_26d:
    move y:(r6+$17),a
    add #>e0_wrs,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$19)
    move #>$400000,x0
    move x0,y:(r6+$1a)
    move #$0,x0
    move x0,y:(r6+$3c)
local_279:
    move y:(r6+$1),a
    asr a
    add #>$180000,a
    move y:(r6+$14),x0
    add x0,a
    move y:(r6+$3f),x0
    add x0,a
    move #$0,x0
    cmp x0,a
    bge <local_282
    move x0,a
local_282:
    move #>$7fffff,x0
    cmp x0,a
    ble <local_287
    move x0,a
local_287:
    move a,y:(r6+$1b)
    move y:(r6+$4),a
    move #>$400000,x0
    sub x0,a
    asr #$2,a,a
    move a1,a
    move a,y:(r6+$15)
    move y:(r6+$1b),a
    move y:(r6+$15),x0
    add x0,a
    move y:(r6+$1e),x0
    add x0,a
    move y:(r6+$1f),x0
    sub x0,a
    sub x0,a            r6,r3
    move a,y:(r6+$16)
    move y:(r6+$18),x0
    move x0,n2
    move #$30,n3
    move (r3)+n3
    move y:(r6+$1b),a
    jsr code_origin+1054
    move #>$f1e3c,x0
    move x0,y:(r6+$38)
    move #>$70e1c4,x0
    move x0,y:(r6+$1b)
    move x0,y0
    move y:(r6+$31),x0
    mpy y0,x0,a
    move a,y:(r6+$31)
    move y:(r6+$32),x0
    mpy y0,x0,a
    move a,y:(r6+$32)
    move y:(r6+$33),x0
    mpy y0,x0,a
    move a,y:(r6+$33)
    move y:(r6+$35),x0
    mpy y0,x0,a
    move a,y:(r6+$35)
    move y:(r6+$36),x0
    mpy y0,x0,a         r6,r3
    move a,y:(r6+$36)
    move y:(r6+$19),x0
    move x0,n2
    move #$27,n3
    move (r3)+n3
    move y:(r6+$16),a
    jsr code_origin+1054
    move y:(r6+$2),a
    move x:(r6+$2),x0
    cmp x0,a
    beq <local_2d2
    move y:(r6+$2),x0
    move x0,x:(r6+$2)
    move y:(r6+$2),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$2),a
    asr #$12,a,a
    add #>e0_dcA,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$a)
local_2d2:
    move x:(r6+$a),a
    move a,y:(r6+$39)
    move y:(r6+$7),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_2ea
    move y:(r6+$7),x0
    move x0,x:(r6+$3)
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_dcB,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$b)
local_2ea:
    move x:(r6+$b),a
    move a,y:(r6+$2e)
    move #$0,x0
    move x0,y:(r6+$2f)
    move y:(r6+$1a),x0
    move x0,y:(r6+$3b)
    move y:(r6+$6),x0
    move y:(r6+$1a),y0
    mpy y0,x0,a
    move a,y:(r6+$3a)
    move #>$19660d,x0
    move x0,y:(r6+$37)
    move #>$48f5c3,x0
    move x0,y:(r6+$3d)
    jsr code_origin+1125
    jmp code_origin+1110
    move y:(r6+$8),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_314
    move y:(r6+$8),x0
    move x0,x:(r6+$0)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swo,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$8)
local_314:
    move x:(r6+$8),a
    move a,y:(r6+$15)
    move a,y0
    move y:(r6+$c),x0
    mpy y0,x0,a
    move a,y:(r6+$14)
    move y:(r6+$8),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_330
    move y:(r6+$8),x0
    move x0,x:(r6+$1)
    move y:(r6+$8),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$8),a
    asr #$12,a,a
    add #>e0_swv,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$9)
local_330:
    move x:(r6+$9),a
    move a,y:(r6+$15)
    move a,x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move a,y:(r6+$c)
    move y:(r6+$6),a
    asr #$12,a,a
    add #>e0_spd,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$15)
    move y:(r6+$f),a
    add #<$20,a
    move a,y:(r6+$f)
    move y:(r6+$15),x0
    cmp x0,a
    blt <local_353
    move #$0,x0
    move x0,y:(r6+$f)
    move y:(r6+$10),a
    add #<$1,a
    and #<$3,a
    move a,y:(r6+$10)
    move y:(r6+$7),a
    tst a
    beq <local_353
    move y:(r6+$26),a
    tst a
    beq <local_353
    move #>$7fffff,x0
    move x0,y:(r6+$22)
local_353:
    move y:(r6+$10),a
    tst a
    beq <local_374
    sub #<$2,a
    beq <local_362
    bgt <local_36b
    move y:(r6+$4),a
    asr #$12,a,a
    add #>e0_ch1,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$17)
    bra <local_376
local_362:
    move y:(r6+$4),a
    asr #$12,a,a
    add #>e0_ch2,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$17)
    bra <local_376
local_36b:
    move y:(r6+$4),a
    asr #$12,a,a
    add #>e0_ch3,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$17)
    bra <local_376
local_374:
    move #$0,x0
    move x0,y:(r6+$17)
local_376:
    move y:(r6+$1),a
    asr a
    add #>$180000,a
    move y:(r6+$14),x0
    add x0,a
    move y:(r6+$17),x0
    add x0,a
    move y:(r6+$3f),x0
    add x0,a
    move #$0,x0
    cmp x0,a
    bge <local_381
    move x0,a
local_381:
    move #>$7fffff,x0
    cmp x0,a
    ble <local_386
    move x0,a
local_386:
    move a,y:(r6+$18)
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_wc,a
    move a1,r0
    move r6,r3
    move y:(r0),a
    move a,y:(r6+$19)
    move a,x0
    move x0,n2
    move #$30,n3
    move (r3)+n3
    move y:(r6+$18),a
    bsr <local_41e
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_wcpw,a
    move a1,r0
    move #$0,x0
    move y:(r0),a
    move a,y:(r6+$34)
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_wcdc,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$36)
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_wcd,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$35)
    move x0,y:(r6+$27)
    move x0,y:(r6+$28)
    move x0,y:(r6+$29)
    move x0,y:(r6+$2a)
    move x0,y:(r6+$2b)
    move x0,y:(r6+$2c)
    move x0,y:(r6+$2d)
    move x0,y:(r6+$2f)
    move x0,y:(r6+$3a)
    move y:(r6+$2),a
    move x:(r6+$2),x0
    cmp x0,a
    beq <local_3cc
    move y:(r6+$2),x0
    move x0,x:(r6+$2)
    move y:(r6+$2),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$2),a
    asr #$12,a,a
    add #>e0_dcA,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$a)
local_3cc:
    move x:(r6+$a),a
    move a,y:(r6+$39)
    move y:(r6+$5),a
    asr #$12,a,a
    add #>e0_wcn,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$38)
    move #>$7fffff,a
    move y:(r6+$38),x0
    sub x0,a
    move a,y:(r6+$1a)
    move a,y0
    move y:(r6+$31),x0
    mpy y0,x0,a
    move a,y:(r6+$31)
    move y:(r6+$32),x0
    mpy y0,x0,a
    move a,y:(r6+$32)
    move y:(r6+$33),x0
    mpy y0,x0,a
    move a,y:(r6+$33)
    move y:(r6+$35),x0
    mpy y0,x0,a
    move a,y:(r6+$35)
    move y:(r6+$36),x0
    mpy y0,x0,a
    move a,y:(r6+$36)
    move #>$7fffff,x0
    move x0,y:(r6+$1a)
    move y:(r6+$7),a
    tst a
    beq <local_411
    move y:(r6+$7),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_407
    move y:(r6+$7),x0
    move x0,x:(r6+$3)
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e0_dcB,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x:(r6+$b)
local_407:
    move x:(r6+$b),a
    move a,y:(r6+$2e)
    move #>$400000,x0
    move x0,y:(r6+$2d)
    move #$0,x0
    move x0,y:(r6+$3b)
    move y:(r6+$1a),x0
    move x0,y:(r6+$3c)
    bra <local_416
local_411:
    move #$0,x0
    move x0,y:(r6+$2e)
    move x0,y:(r6+$3c)
    move y:(r6+$1a),x0
    move x0,y:(r6+$3b)
local_416:
    move #>$19660d,x0
    move x0,y:(r6+$37)
    move #>$428f5c,x0
    move x0,y:(r6+$3d)
    bsr <local_465
    bra <local_456
local_41e:
    tst a
    bge <local_421
    move #$0,a
local_421:
    move #>$7f0000,x0
    cmp x0,a
    ble <local_427
    move #>$7f0000,a
local_427:
    move a,b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    asr #$10,a,a
    add #>e0_osc_pitch,a
    move a1,r0
    move #$80,n0
    move y:(r0)+,y0
    move y:(r0)+n0,a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r3+$0)
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$1c)
    move n2,a
    asl #$1,a,a
    move a1,b
    asl #$1,a,a
    add b,a
    move a1,a
    add #>e0_wav,a
    move a1,r0
    nop
    move y:(r0)+,x0
    move x0,y:(r3+$1)
    move y:(r0)+,x0
    move x0,y:(r3+$3)
    move y:(r0)+,y1
    move y:(r0)+,x0
    move x0,y:(r3+$5)
    move y:(r0)+,x0
    move x0,y:(r3+$6)
    move y:(r0),x0
    move x0,y:(r3+$4)
    move y:(r6+$1c),x0
    mpy x0,y1,a
    move a,y:(r3+$2)
    rts
local_456:
    move y:(r6+$22),a
    move y:(r6+$26),b
    add b,a
    tst a
    bne <local_464
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>code_origin+1122
    move x0,y:(r0)+
    move #>$ffffff,m0
local_464:
    rts
local_465:
    move r6,r3
    move #$20,n3
    move (r3)+n3
    move r6,r0
    move #$27,n0
    move (r0)+n0
    do #<$17,>code_origin+1135
    move y:(r0)+,x0
    move x0,x:(r3)+
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$16,m0
    move r6,r4
    move #$20,n4
    move (r4)+n4
    move #$6,m4
    move r4,r5
    move #$6,m5
    move #>md_sine,r1
    move #>$7fff,m1
    do #<$20,>code_origin+1229
    move #$0,a
    move x:(r0)+,x1      y:(r4)+,b
    add x1,b
    add b,a             b1,y:(r5)+
    move a1,x0
    lsr #$9,a
    move a1,n1
    move x:(r0)+,x1
    move x:(r1+n1),y1
    mpy y1,x1,b         x:(r0)+,x1
    mpy x0,x0,a         y:(r4)+,y0
    move a,y1
    sub y0,a            y1,y:(r5)+
    move a,y0
    mpy x1,y0,a         x:(r0)+,x1
    asl #$c,a,a
    add a,b             x0,a
    abs a
    move a,y0
    mac x1,y0,b         x:(r0)+,x1
    move x0,a
    sub x1,a            x:(r0)+,x1
    asl #$6,a,a
    move a,y0
    mac x1,y0,b         x:(r0)+,x1
    add x1,b            x:(r0)+,x1      y:(r4)+,y0
    asl #$1,b,b
    move b,y1
    mpy y1,y0,b
    mpy x1,y0,a         b,n2
    move x:(r0)+,x1      a,y:(r5)+
    move n2,y0
    mpy x1,y0,a         x:(r0)+,x1      y:(r4)+,b
    add x1,b
    add b,a             b1,y:(r5)+
    move a1,x0
    lsr #$9,a
    move a1,n1
    move x:(r0)+,x1
    move x:(r1+n1),y1
    mpy y1,x1,b         x:(r0)+,x1
    mpy x0,x0,a         y:(r4)+,y0
    move a,y1
    sub y0,a            y1,y:(r5)+
    move a,y0
    mpy x1,y0,a         x:(r0)+,x1
    asl #$c,a,a
    add a,b             x0,a
    abs a
    move a,y0
    mac x1,y0,b         x:(r0)+,x1
    move x0,a
    sub x1,a            x:(r0)+,x1
    asl #$6,a,a
    move a,y0
    mac x1,y0,b         x:(r0)+,x1
    add x1,b            x:(r0)+,x1      y:(r4)+,y0
    asl #$1,b,b
    mpy x1,y0,a         b,y1
    asr a
    move a0,y0
    move x:(r0)+,x1      y0,y:(r5)+
    mac x1,y0,b         x:(r0)+,x1      y:(r4)+,y0
    move b,y1
    mpy y1,y0,b
    mpy x1,y0,a         b,n3
    move x:(r0)+,x1      a,y:(r5)+
    move n2,y0
    mpy x1,y0,b         x:(r0)+,x1
    move n3,y1
    mac y1,x1,b         x:(r0)+,x1
    mpy y1,y0,a
    move a,y0
    mac x1,y0,b         x:(r0)+,x1
    move b,y1
    mpyr y1,x1,b
    asl #$1,b,b
    move b,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m1
    move #>$ffffff,m4
    move #>$ffffff,m5
    rts
