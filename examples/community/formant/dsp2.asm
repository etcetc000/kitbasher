init:
    clr a
    move a,y:(r6+$9)
    move a,y:(r6+$a)
    move a,y:(r6+$b)
    move a,y:(r6+$c)
    move a,y:(r6+$d)
    move a,y:(r6+$e)
    move a,y:(r6+$f)
    move a,y:(r6+$10)
    move a,y:(r6+$11)
    move a,y:(r6+$12)
    move a,y:(r6+$13)
    move a,y:(r6+$14)
    move a,y:(r6+$15)
    move a,y:(r6+$16)
    move a,y:(r6+$17)
    move a,y:(r6+$18)
    move a,y:(r6+$19)
    move a,y:(r6+$1a)
    move a,y:(r6+$1b)
    move a,y:(r6+$1c)
    move a,y:(r6+$1d)
    move a,y:(r6+$1e)
    move a,y:(r6+$1f)
    move a,y:(r6+$20)
    move a,y:(r6+$21)
    move a,y:(r6+$22)
    move a,y:(r6+$23)
    move a,y:(r6+$24)
    move a,y:(r6+$25)
    move a,y:(r6+$26)
    move a,y:(r6+$27)
    move a,y:(r6+$28)
    move a,y:(r6+$29)
    move a,y:(r6+$2a)
    move a,y:(r6+$2b)
    move a,y:(r6+$2c)
    move a,y:(r6+$2d)
    move a,y:(r6+$2e)
    move a,y:(r6+$2f)
    move a,y:(r6+$30)
    move a,y:(r6+$31)
    move a,y:(r6+$32)
    move a,y:(r6+$33)
    move a,y:(r6+$34)
    move a,y:(r6+$35)
    move a,y:(r6+$36)
    move a,y:(r6+$37)
    move a,y:(r6+$38)
    move a,y:(r6+$39)
    move a,y:(r6+$3a)
    move a,y:(r6+$3b)
    move a,y:(r6+$3c)
    move a,y:(r6+$3d)
    move a,y:(r6+$3e)
    move a,y:(r6+$3f)
    rts
trigger:
    move #>$7fffff,a
    move a,y:(r6+$21)
    clr a
    move a,y:(r6+$20)
    rts
render:
    move y:(r6+$1),a
    asr #16,a,a
    move a,y:(r6+$3d)
    move a1,n0
    move #>pitch,r0
    move x:(r0+n0),a
    move a,y:(r6+$22)
        move y:(r6+$3),a
        asr #16,a,a
        move a,x0
        tfr x0,a
        asl a
        asl a
        asl a
        add x0,a
        asr a
        asr a
        move a,x1
        move y:(r6+$3d),a
        asl a
        move a,x0
        tfr x1,a
        sub x0,a
        add #>480,a
        move a,x1
        asr #4,a,a
        move a1,n0
        move #>third,r0
        move x:(r0+n0),a
        move a,y0
        asl #4,a,a
        move a,x0
        asl a
        add x0,a
        move a,x0
        tfr x1,a
        sub x0,a
        move a1,n0
        move #>exp48,r0
        move x:(r0+n0),a
        tfr y0,b
        sub #>10,b
        jlt negs
        move b1,x0
        asl x0,a,a
        jmp sdone
negs:   neg b
        move b1,x0
        asr x0,a,a
sdone:  move a,y:(r6+$23)
    move y:(r6+$4),x0
    mpy x0,x0,a
    move a,y:(r6+$24)
    move y:(r6+$5),a
    asr #16,a,a
    move a,x0
    tfr x0,a
    asl #14,a,a
    add #>$40000,a
    move a,y:(r6+$25)
    move y:(r6+$6),x0
    mpy x0,x0,a
    asr a
    move a,y:(r6+$26)
    move y:(r6+$7),a
    asr #20,a,a
    move a1,n0
    move #>feedback,r0
    move x:(r0+n0),a
    move a,y:(r6+$27)
    move y:(r6+$2),a
    asr #16,a,a
    move a1,n0
    move #>decay,r0
    move x:(r0+n0),a
    move a,y:(r6+$2b)
prepared:
    move y:>md_output,r7
; P-I MG per-sample loop, same arithmetic as v58-v71, with conditional transfers instead of jumps and table bases in r1/r2.
; Slots: $20 PH  $21 ENV  $22 INCV  $23 RAT  $24 BRL  $25 AIR  $26 SUB  $27 FB  $28 PREV  $29 HPX  $2a HPY
;        $2c K255 (=255)  $2d K1 (=$10000)  $2e KHP (=$7f5c29)  $2f NSUB (=-SUB)   written per block below
        move #>255,a
        move a,y:(r6+$2c)
        move #>$10000,a
        move a,y:(r6+$2d)
        move #>$7f5c29,a
        move a,y:(r6+$2e)
        move y:(r6+$26),a
        neg a
        move a,y:(r6+$2f)
        move #>md_sine,r1
        move #>soft,r2
        do #32,lend
        move y:(r6+$20),a           ; PH
        lsr a
        move a1,x0
        move y:(r6+$23),y0          ; RAT
        mpy y0,x0,a                 ; theta 8.16
        move a1,x1
        and #>$ffff,a
        asr a
        add #>8192,a
        and #>$7fff,a
        move a1,n1
        move x:(r1+n1),x0           ; cos
        tfr x0,a
        neg a                       ; v = -cos
        move y:(r6+$2d),b           ; $10000
        move #<0,x0
        cmp x1,b                    ; $10000 - theta
        tle x0,a                    ; theta >= 1.0 -> silence
        move a,x1
        move y:(r6+$24),y1          ; BRL
        mpy y1,x1,a
        asl #4,a,a
        add x1,a                    ; barrel: v + 16 v B (saturating on the store below)
        move a,x1
        move y:(r6+$25),y1          ; AIR
        mpy y1,x1,a
        asr #15,a,a
        add #>128,a
        move #<0,x0
        tlt x0,a
        move y:(r6+$2c),y1          ; 255
        cmp y1,a
        tgt y1,a
        move a1,n2
        move x:(r2+n2),x1           ; soft table
        move y:(r6+$26),x0          ; SUB
        move y:(r6+$2f),y0          ; -SUB
        move y:(r6+$20),b           ; PH sign
        tfr x0,a
        tst b
        tlt y0,a
        add x1,a                    ; + square
        move a,x1
        move y:(r6+$21),y0          ; ENV
        mpy x1,y0,a
        move a,y:(r6+$28)           ; PREV
        move a,x1
        move y:(r6+$29),x0          ; HPX
        sub x0,a
        move x1,y:(r6+$29)
        move y:(r6+$2a),y0          ; HPY
        move y:(r6+$2e),y1          ; hp coefficient
        mac y1,y0,a
        move a,y:(r6+$2a)
        move a,x1
        move y:(r6+$28),x0          ; PREV
        move y:(r6+$27),y0          ; FB
        mpy y0,x0,a
        move a,x0
        move y:(r6+$22),a           ; INCV
        asl a
        move a,y0
        mpy y0,x0,a
        move y:(r6+$22),x0
        add x0,a
        move y:(r6+$20),x0
        add x0,a
        move a1,y:(r6+$20)          ; PH
        tfr x1,a
        move a,y:(r7)+
lend:
    move y:(r6+$2b),x0
    mpy x0,x0,a
    move a,x0
    mpy x0,x0,a
    move a,x0
    mpy x0,x0,a
    move a,x0
    mpy x0,x0,a
    move a,x0
    mpy x0,x0,a
    move a,x0
    move y:(r6+$21),y0
    mpy y0,x0,a
    move a,y:(r6+$21)
    nop
    nop
    rts
