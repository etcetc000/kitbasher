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
    move #>$4f0000,x0
    move x0,x:(r6+$3c)
    move #>$ffffff,x0
    move x0,x:(r6+$3e)
    bsr <local_6c
    rts
trigger:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$3,y0
    mpy y0,x0,a
    move a1,a
    move a,x:(r6+$3d)
    add #>cown,a
    move a1,r0
    nop
    move y:(r0),x0
    move x:(r6+$3f),a
    cmp x0,a
    beq <local_2f
    move x0,x:(r6+$3f)
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>code_origin+40
    move x0,y:(r0)+
    move x:(r6+$3f),a
    tst a
    bne <local_2d
    bsr <local_6c
    bra <local_2f
local_2d:
    jsr code_origin+1097
local_2f:
    move x:(r6+$3d),a
    move x:(r6+$3f),b
    add b,a
    add #>cmap,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,x:(r6+$3c)
    move y:(r6+$3),y0
    move y0,x:(r6+$3e)
    move x0,y:(r6+$3)
    move x:(r6+$3f),a
    tst a
    bne <local_40
    bsr <local_be
    bra <local_42
local_40:
    jsr code_origin+1113
local_42:
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
render:
    move y:(r6+$3),a
    move x:(r6+$3e),x0
    cmp x0,a
    bne <local_56
    move x:(r6+$3c),x0
    move x0,y:(r6+$3)
    bra <local_4c
local_4c:
    move x:(r6+$3f),a
    tst a
    bne <local_51
    bsr <local_ce
    bra <local_53
local_51:
    jsr code_origin+1196
local_53:
    move x:(r6+$3e),x0
    move x0,y:(r6+$3)
    rts
local_56:
    asr #$10,a,a
    move a1,x0
    move #$3,y0
    mpy y0,x0,a
    move a1,a
    move x:(r6+$3f),b
    add b,a
    add #>cmap,a
    move a1,r0
    nop
    move y:(r0),a
    tst a
    blt <local_6a
    move a,x0
    move x0,x:(r6+$3c)
local_66:
    move y:(r6+$3),y0
    move y0,x:(r6+$3e)
    move x0,y:(r6+$3)
    bra <local_4c
local_6a:
    move x:(r6+$3c),x0
    bra <local_66
local_6c:
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>code_origin+115
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
    move #>$3c0000,x0
    move x0,y:(r6+$12)
    move #>$400000,x0
    move x0,y:(r6+$13)
    move #>$35c28f,x0
    move x0,y:(r6+$14)
    move #>$7fffff,x0
    move x0,y:(r6+$18)
    move #>$400000,x0
    move x0,y:(r6+$19)
    move #>$141d9f,x0
    move x0,y:(r6+$1a)
    move #>$733333,x0
    move x0,y:(r6+$1c)
    move #>$7a531e,x0
    move x0,y:(r6+$1e)
    move #>$2f5c29,x0
    move x0,y:(r6+$21)
    move #>$7a531e,x0
    move x0,x:(r6+$20)
    move #>$35c28f,x0
    move x0,x:(r6+$23)
    move #>$400000,x0
    move x0,x:(r6+$24)
    move #>$19660d,x0
    move x0,x:(r6+$2a)
    move #>$141d9f,x0
    move x0,x:(r6+$2e)
    move #>$7fffff,x0
    move x0,x:(r6+$2f)
    move #>$400000,x0
    move x0,x:(r6+$30)
    move #>$5d3d,x0
    move x0,x:(r6+$33)
    move #>$2aaaab,x0
    move x0,x:(r6+$35)
    move #>$2f5c29,x0
    move x0,x:(r6+$36)
    rts
local_be:
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
    rts
local_ce:
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$9,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),b
    cmp b,a
    beq <local_e9
    move a,y:(r6+$9)
    move y:(r6+$37),a
    move y:(r6+$30),b
    add b,a
    tst a
    bne <local_e9
    move r6,r0
    move #$30,n0
    move (r0)+n0
    move #$0,x0
    do #<$9,>code_origin+228
    move x0,y:(r0)+
    move #>$1,x0
    move x0,y:(r6+$33)
    move #$0,x0
    move x0,y:(r6+$e)
local_e9:
    move y:(r6+$8),a
    move a,y:(r6+$2a)
    move y:(r6+$5),a
    move a,y:(r6+$2b)
    move y:(r6+$9),a
    sub #<$6,a
    bne <local_f5
    move y:(r6+$8),a
    move a,y:(r6+$2b)
    move #>$400000,x0
    move x0,y:(r6+$2a)
local_f5:
    move y:(r6+$9),a
    move x:(r6+$6),x0
    cmp x0,a
    beq <local_10d
    move a,x:(r6+$6)
    move y:(r6+$9),a
    asl #$4,a,a
    add #>e0_mrec,a
    move a1,r0
    move #$3,n0
    move (r0)+n0
    move #$5,n0
    move y:(r0)+,x0
    move x0,x:(r6+$e)
    move y:(r0),x0
    move x0,y:(r6+$16)
    move (r0)+n0
    nop
    move y:(r0),x0
    move x0,y:(r6+$1b)
    move #>$ffffff,x0
    move x0,x:(r6+$7)
local_10d:
    move y:(r6+$5),a
    move x:(r6+$7),x0
    cmp x0,a
    beq <local_118
    move a,x:(r6+$7)
    move y:(r6+$16),x0
    move y:(r6+$5),y0
    mpy y0,x0,a
    move x:(r6+$e),x0
    add x0,a
    move a,y:(r6+$15)
local_118:
    move y:(r6+$6),a
    move x:(r6+$d),x0
    cmp x0,a
    beq <local_124
    move a,x:(r6+$d)
    move y:(r6+$6),y0
    mpy y0,y0,a
    move a,x1
    move #>$733333,y0
    mpy x1,y0,a
    move a,y:(r6+$1c)
local_124:
    move y:(r6+$4),a
    move x:(r6+$4),x0
    cmp x0,a
    beq <local_142
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
local_142:
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
    move y:(r6+$1),a
    move x:(r6+$0),x0
    cmp x0,a
    beq <local_168
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
local_168:
    move y:(r6+$2a),a
    move x:(r6+$1),x0
    cmp x0,a
    beq <local_194
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
local_194:
    move x:(r6+$8),x0
    move x0,y:(r6+$10)
    move x:(r6+$9),x0
    move x0,y:(r6+$11)
    move y:(r6+$10),x0
    move y:(r6+$c),y0
    mpy y0,x0,a
    move #$2,x0
    tst a
    beq <local_1af
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
local_1af:
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
    beq <local_1d1
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
local_1d1:
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
    beq <local_1ee
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
local_1ee:
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
    bne <local_20e
    move #>$7fffff,x0
    move x0,y:(r6+$24)
    move #>$100000,x0
    move x0,y:(r6+$25)
    move y:(r6+$28),a
    tst a
    beq <local_20a
    move a,y:(r6+$b)
    move #>$2,x0
    move x0,y:(r6+$a)
    bra <local_21b
local_20a:
    move #>$3,x0
    move x0,y:(r6+$a)
    bra <local_21b
local_20e:
    sub #<$1,a
    bne <local_21b
    move #>$7fffff,x0
    move x0,y:(r6+$24)
    move y:(r6+$b),a
    sub #<$1,a
    move a,y:(r6+$b)
    tst a
    bgt <local_21b
    move #>$3,x0
    move x0,y:(r6+$a)
local_21b:
    move y:(r6+$7),a
    move x:(r6+$3),x0
    cmp x0,a
    beq <local_22f
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
local_22f:
    move y:(r6+$9),a
    sub #<$5,a
    jeq code_origin+978
    move y:(r6+$2b),a
    asl a
    add #>$800000,a
    move a,y:(r6+$2d)
    abs a
    move y:(r6+$37),x0
    move #>$6ccccd,x1
    mpy x1,x0,a         a,y0
    add #>$133333,a
    move #>$71eb85,x0
    mpy y0,x0,a         a,x1
    add #>$ccccd,a
    move a,x0
    mpy x1,x0,a
    move a,y:(r6+$2c)
    move #>$600000,x0
    mpy y0,x0,a
    asl a
    move a,y1
    move y:(r6+$22),a
    move y:(r6+$23),x0
    sub x0,a
    abs a
    asl #$6,a,a
    move a,x0
    move #>$498000,x1
    mpy x1,x0,a
    asl a
    move #>$7fffff,b
    sub a,b
    asl b
    bge <local_25c
    clr b
local_25c:
    move b,x0
    tfr x0,b
    move b,y:(r6+$11)
    move y:(r6+$5),a
    sub #>$5f0000,a
    bge <local_26c
    move y:(r6+$22),b
    move y:(r6+$23),x0
    asl b
    sub x0,b
    asl b
    move y:(r6+$5),a
    sub #>$580000,a
    bra <local_275
local_26c:
    move y:(r6+$22),x0
    tfr x0,b
    asl b
    add x0,b
    move y:(r6+$23),x0
    sub x0,b
    move y:(r6+$5),a
    sub #>$660a02,a
local_275:
    abs a
    asl #$5,a,a
    move a,x0
    move #>$7fffff,a
    sub x0,a
    tfr b,a             a,y0
    abs a
    asl #$6,a,a
    move a,x0
    move #>$498000,x1
    mpy x1,x0,a
    asl a
    move #>$7fffff,b
    sub a,b
    asl b
    bge <local_289
    clr b
local_289:
    move b,x0
    tfr x0,b
    move b,x0
    mpy y0,x0,a
    move y:(r6+$3c),b
    tst b
    bge <local_294
    move a,y:(r6+$3d)
    move y:(r6+$11),x0
    move x0,y:(r6+$3c)
    bra <local_29f
local_294:
    move y:(r6+$3d),x0
    sub x0,a
    asr #$4,a,a
    add x0,a
    move a,y:(r6+$3d)
    move y:(r6+$11),a
    move y:(r6+$3c),x0
    sub x0,a
    asr #$4,a,a
    add x0,a
    move a,y:(r6+$3c)
local_29f:
    move y:(r6+$2d),a
    tst a
    blt <local_2ae
    move #>$7fffff,a
    sub y1,a
    move a,y:(r6+$2e)
    move #>$666666,x0
    mpy x0,y1,a
    move a,y:(r6+$2f)
    move #$0,x0
    move x0,y:(r6+$2d)
    move x0,y:(r6+$17)
    bra <local_34c
local_2ae:
    move #>$7fffff,a
    move #>$2ccccd,x0
    mac -x0,y1,a
    move a,y:(r6+$2e)
    move #>$666666,x0
    mpy x0,y1,a
    move a,y:(r6+$2f)
    move #>$400000,x0
    move x0,y:(r6+$2d)
    move y:(r6+$2c),a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_j0p,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$10)
    move y:(r6+$22),b
    asl #$4,b,b
    move y:(r6+$32),x0
    add x0,b
    move y:(r6+$23),x0
    tfr x0,a
    asl #$4,a,a
    add x0,a
    move y:(r6+$31),x0
    add x0,a
    move a1,x0
    move b1,y:(r6+$17)
    move x0,y:(r6+$3e)
    move y:(r6+$5),a
    sub #>$5f0000,a
    bge <local_2fb
    tfr b,a
    asl a
    sub x0,a
    asl a
    add #>$400000,a
    lsr #$9,a
    move a1,n1
    move #>md_sine,r1
    move #>$7fff,m1
    nop
    move x:(r1+n1),y0
    move y0,y:(r6+$11)
    move y:(r6+$2c),a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_t42g,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    bra <local_319
local_2fb:
    tfr b,a
    asl a
    add b,a
    sub x0,a
    add #>$400000,a
    lsr #$9,a
    move a1,n1
    move #>md_sine,r1
    move #>$7fff,m1
    nop
    move x:(r1+n1),y0
    move y0,y:(r6+$11)
    move y:(r6+$2c),a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_t3g,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
local_319:
    move a,x0
    move y:(r6+$11),y0
    mpy y0,x0,a
    move a,y:(r6+$11)
    move y:(r6+$17),b
    move y:(r6+$3e),x0
    tfr b,a
    sub x0,a
    add #>$400000,a
    lsr #$9,a
    move a1,n1
    move x:(r1+n1),y0
    move #>$35c28f,x0
    mpy y0,x0,a
    add #>$369446,a
    move y:(r6+$2c),y0
    mpy y0,y0,b         a,x0
    move b,y0
    mpy y0,x0,a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_j0s,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move y:(r6+$10),x0
    sub x0,a
    asr a
    move a,y0
    move y:(r6+$3c),x1
    mpy x1,y0,a
    asl a
    add x0,a
    move y:(r6+$11),x1
    move y:(r6+$3d),y0
    mac x1,y0,a
    move a,x0
    move y:(r6+$2f),y0
    mpy y0,x0,a
    move a,y:(r6+$17)
local_34c:
    move y:(r6+$23),x0
    move x0,x:(r6+$21)
    move y:(r6+$22),x0
    move x0,x:(r6+$22)
    move y:(r6+$2c),x0
    move x0,x:(r6+$25)
    move y:(r6+$2d),x0
    move x0,x:(r6+$26)
    move y:(r6+$2e),x0
    move x0,x:(r6+$27)
    move y:(r6+$2f),x0
    move x0,x:(r6+$28)
    move y:(r6+$17),x0
    move x0,x:(r6+$29)
    move y:(r6+$1d),x0
    move x0,x:(r6+$2b)
    move y:(r6+$1c),x0
    move x0,x:(r6+$2c)
    move y:(r6+$26),x0
    move x0,x:(r6+$2d)
    move y:(r6+$24),x0
    move x0,x:(r6+$31)
    move y:(r6+$25),x0
    move x0,x:(r6+$32)
    move y:(r6+$27),x0
    move x0,x:(r6+$34)
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$16,m0
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
    do #<$20,>code_origin+965
    mpy y0,x0,a         y0,y:(r2)
    move a,y:(r5)+
    move x:(r0)+,x0      y:(r4)+,a
    add x0,a
    tfr a,b             x:(r0)+,x0      y:(r4)+,y0
    lsr #$9,b
    move b1,n1
    tfr y0,a            a1,y:(r5)+
    tfr a,b             x:(r1+n1),y1
    add x0,a            x:(r0)+,x0
    lsr #$9,b
    move b1,n1
    move a1,y:(r5)+
    move x:(r1+n1),y0
    mpy x0,y1,a         x:(r0)+,x0
    mac y0,x0,a         x:(r0)+,x0
    move a,y0
    mpy y0,x0,b         x:(r0)+,x0
    asl b
    add x0,b            x:(r0)+,x0
    lsr #$9,b
    move b1,n1
    mpy y0,x0,a         x:(r0)+,x0
    move x:(r1+n1),y1
    mac x0,y1,a         x:(r0)+,x0
    sub x0,a            x:(r0)+,x0      y:(r4)+,y0
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
    bne <local_3d1
    move #$0,x0
    move x0,y:(r6+$32)
    move x0,y:(r6+$31)
    move x0,y:(r6+$34)
    move x0,y:(r6+$35)
    move x0,y:(r6+$36)
    move x0,y:(r6+$38)
local_3d1:
    rts
    move y:(r6+$2b),a
    asl a
    add #>$800000,a
    move a,y:(r6+$2d)
    abs a
    move y:(r6+$37),x0
    move #>$6ccccd,x1
    mpy x1,x0,a         a,y0
    add #>$133333,a
    move #>$71eb85,x0
    mpy y0,x0,a         a,x1
    add #>$ccccd,a
    move a,x0
    mpy x1,x0,a
    move a,y:(r6+$2c)
    move #>$600000,x0
    mpy y0,x0,a
    asl a
    move a,y1
    move y:(r6+$2d),a
    tst a
    blt <local_3fa
    move #>$7fffff,a
    sub y1,a
    move a,y:(r6+$2e)
    move #>$666666,x0
    mpy x0,y1,a
    move a,y:(r6+$2f)
    move #$0,x0
    move x0,y:(r6+$2d)
    move x0,y:(r6+$17)
    bra <local_448
local_3fa:
    move #>$7fffff,a
    move #>$2ccccd,x0
    mac -x0,y1,a
    move a,y:(r6+$2e)
    move #>$666666,x0
    mpy x0,y1,a
    move a,y:(r6+$2f)
    move #>$400000,x0
    move x0,y:(r6+$2d)
    move y:(r6+$2c),a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_j0p,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$10)
    move y:(r6+$22),b
    asl #$4,b,b
    move y:(r6+$32),x0
    add x0,b
    move y:(r6+$23),x0
    tfr x0,a
    asl #$4,a,a
    add x0,a
    move y:(r6+$31),x0
    add x0,a
    tfr b,a             a1,x0
    asl a
    add b,a
    sub x0,a
    add #>$400000,a
    lsr #$9,a
    move a1,n1
    move #>md_sine,r1
    move #>$7fff,m1
    nop
    move x:(r1+n1),y0
    move y0,y:(r6+$11)
    move y:(r6+$2c),a
    move a,b
    and #>$7fff,b
    asl #$8,b,b
    asr #$f,a,a
    add #>e0_t3g,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,x0
    move y:(r6+$11),y0
    mpy y0,x0,a
    move y:(r6+$10),x0
    add x0,a
    move a,x0
    move y:(r6+$2f),y0
    mpy y0,x0,a
    move a,y:(r6+$17)
local_448:
    bra <local_34c
    move r6,r0
    move #$9,n0
    move (r0)+n0
    move #$0,x0
    do #<$37,>code_origin+1104
    move x0,y:(r0)+
    move #>$ffffff,m0
    move #>$ffffff,x0
    move x0,y:(r6+$9)
    move #>$3039,x0
    move x0,y:(r6+$13)
    rts
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
    add #>e1_stb,a
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
    beq <local_47c
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>code_origin+1146
    move x0,y:(r0)+
    move #>$ffffff,m0
local_47c:
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
    move x0,y:(r6+$20)
    move #$0,x0
    move x0,y:(r6+$21)
    move #$0,x0
    move x0,y:(r6+$22)
    move #>$1,x0
    move x0,y:(r6+$d)
    move y:(r6+$a),a
    sub #<$5,a
    bne <local_4ab
    move #>$7fffff,x0
    move x0,y:(r6+$21)
    move #>$3,x0
    move x0,y:(r6+$d)
    move y:(r6+$6),x0
    move x0,y:(r6+$22)
    move y:(r6+$5),a
    asr #$10,a,a
    move a1,x0
    move #$8,y0
    mpy y0,x0,a
    move a1,a
    move a,y:(r6+$11)
    move y:(r6+$4),a
    asr #$12,a,a
    add #>e1_rat,a
    move a1,r0
    nop
    move y:(r0),a
    move a,y:(r6+$12)
local_4ab:
    rts
    move y:(r6+$3),a
    asr #$10,a,a
    move a1,x0
    move #$f,y0
    mpy y0,x0,a
    move a1,a
    move y:(r6+$9),y0
    cmp y0,a
    beq <local_4e9
    move a,y:(r6+$9)
    move y:(r6+$a),a
    sub #<$3,a
    blt <local_4bd
    move #>$1,a
    move a,y:(r6+$15)
    bra <local_4bf
local_4bd:
    move #$0,a
    move a,y:(r6+$15)
local_4bf:
    move y:(r6+$9),a
    add #>e1_stb,a
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
    blt <local_4d3
    move #>$1,a
    move a,y:(r6+$16)
    bra <local_4d5
local_4d3:
    move #$0,a
    move a,y:(r6+$16)
local_4d5:
    move y:(r6+$16),a
    move y:(r6+$15),x0
    cmp x0,a
    bne <local_4e0
    move y:(r6+$21),a
    move y:(r6+$22),b
    add b,a
    move y:(r6+$26),b
    add b,a
    tst a
    bne <local_4e9
local_4e0:
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$0,x0
    do #<$7,>code_origin+1255
    move x0,y:(r0)+
    move #>$ffffff,m0
local_4e9:
    move y:(r6+$a),a
    bra <local_4eb
local_4eb:
    move #$0,x0
    move x0,y:(r6+$14)
    move y:(r6+$1),a
    tst a
    bge <local_4f1
    move #$0,a
local_4f1:
    move #>$7f0000,x0
    cmp x0,a
    ble <local_4f7
    move #>$7f0000,a
local_4f7:
    move a,b
    and #>$fe00,b
    asl #$7,b,b
    move b1,x1
    asr #$10,a,a
    add #>e1_fsvf,a
    move a1,r0
    move #>$400000,x0
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    move a,y1
    move y0,a
    mac y1,x1,a
    move a,y:(r6+$30)
    move x0,y:(r6+$31)
    move #>$e1999a,x0
    move x0,y:(r6+$35)
    move #>$5b3333,x0
    move x0,y:(r6+$36)
    move #$0,x0
    move x0,y:(r6+$2f)
    move x0,y:(r6+$2e)
    move x0,y:(r6+$29)
    move x0,y:(r6+$2b)
    move x0,y:(r6+$32)
    move #>$7fffff,x0
    move x0,y:(r6+$33)
    move y:(r6+$11),a
    tst a
    beq <local_541
    move y:(r6+$12),a
    sub #<$20,a
    move a,y:(r6+$12)
    tst a
    bgt <local_541
    move #>$7fffff,x0
    move x0,y:(r6+$21)
    move y:(r6+$11),a
    sub #<$1,a
    move a,y:(r6+$11)
    move y:(r6+$4),a
    asr #$12,a,a
    add #>e1_rat,a
    move a1,r0
    move #>$19660d,y0
    move y:(r0),a
    move a,y:(r6+$15)
    move y:(r6+$13),x0
    mpy y0,x0,a
    asr a
    move a0,a
    move a1,y:(r6+$13)
    move a1,a
    abs a
    move a,y0
    move y:(r6+$8),x0
    mpy y0,x0,a
    move a,y0
    move y:(r6+$15),x0
    mpy y0,x0,a
    move a1,b
    move x0,a
    add b,a
    move a,y:(r6+$12)
local_541:
    move y:(r6+$7),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$7),a
    asr #$12,a,a
    add #>e1_dcC,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$28)
    move y:(r6+$2),b
    and #>$3fe00,b
    asl #$5,b,b
    move y:(r6+$2),a
    asr #$12,a,a
    add #>e1_dcA,a
    move a1,r0
    move b1,x1
    move y:(r0)+,y0
    move y:(r0),a
    sub y0,a
    tfr y0,a            a,y1
    mac y1,x1,a
    move a,y:(r6+$2a)
    move #>$400000,x0
    move x0,y:(r6+$2c)
    move #>$400000,x0
    move x0,y:(r6+$2d)
    move #>$19660d,x0
    move x0,y:(r6+$27)
    move #>$1c28f6,x0
    move x0,y:(r6+$34)
    bsr <local_589
    bra <local_56f
local_56f:
    move y:(r6+$21),a
    move y:(r6+$22),b
    add b,a
    tst a
    bne <local_588
    move y:(r6+$24),a
    abs a
    move y:(r6+$25),b
    abs b
    add b,a
    move #>$400,x0
    cmp x0,a
    bgt <local_588
    move r6,r0
    move #$23,n0
    move (r0)+n0
    move #$0,x0
    do #<$3,>code_origin+1412
    move x0,y:(r0)+
    move #>$ffffff,m0
    move #$0,x0
    move x0,y:(r6+$26)
local_588:
    rts
local_589:
    move r6,r3
    move #$20,n3
    move (r3)+n3
    move r6,r0
    move #$27,n0
    move (r0)+n0
    do #<$10,>code_origin+1427
    move y:(r0)+,x0
    move x0,x:(r3)+
    move r6,r0
    move #$20,n0
    move (r0)+n0
    move #$f,m0
    move r6,r4
    move #$20,n4
    move (r4)+n4
    move #$5,m4
    move r4,r5
    move #$5,m5
    move #>md_sine,r1
    move #>$7fff,m1
    do #<$20,>code_origin+1502
    move x:(r0)+,x1      y:(r4)+,y0
    mpy x1,y0,a
    asr a
    move a0,a
    move a1,y:(r5)+
    move a1,y1
    move x:(r0)+,x1      y:(r4)+,y0
    mpy x1,y0,a         x:(r0)+,x1
    add x1,a
    move a,y0
    move y0,y:(r5)+
    move x:(r0)+,x1      y:(r4)+,b
    move b,x0
    mpy x1,x0,a         x:(r0)+,x1
    add x1,a
    move a,x0
    move x0,y:(r5)+
    move x:(r0)+,x1
    mpy x1,y0,b         x:(r0)+,x1
    mac x1,x0,b
    move b,x0
    mpy x0,y1,b         x:(r0)+,x1
    mac x1,y0,b         y:(r4)+,y0
    move b,a
    sub y0,a            x:(r0)+,x1
    move a,x0
    move y0,a
    mac x1,x0,a
    move a,y:(r5)+
    sub y0,b            x:(r0)+,x1      y:(r4)+,y0
    move y:(r4)+,x0
    move y0,a
    mac x1,x0,a
    move a,y0
    move y0,y:(r5)+
    move b,a
    sub y0,a            x:(r0)+,y1
    mac -x0,y1,a
    move a,y1
    move x0,a
    mac y1,x1,a
    move a,x0
    move x0,y:(r5)+
    move x:(r0)+,x1
    mpy x1,y0,b         x:(r0)+,x1
    mac x1,x0,b
    move x:(r0)+,x1      b,y1
    mpyr y1,x1,b
    asl #$3,b,b
    move b,x0
    mpy x0,x0,b
    move b,y0
    mpy y0,x0,b
    move x:(r0)+,x1      b,y0
    mpy x1,y0,b
    move x:(r0)+,x1
    mac x1,x0,b
    asl #$1,b,b
    move b,y:(r7)+
    move #>$ffffff,m0
    move #>$ffffff,m1
    move #>$ffffff,m4
    move #>$ffffff,m5
    rts
