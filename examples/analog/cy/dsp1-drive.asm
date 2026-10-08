code_origin:
drive:
    move #>$143777,r0
    move y:(r6+$8),b
    asr #$6,b,b
    move b,n0
    move x:>$ff,r1
    move #$3,r4
    move x:(r0+n0),x0
    move #>$143878,r0
    nop
    move x:(r0+n0),x1
    move #>$252eb7,y0
    mpy y0,x0,a
    add #>$16b45,a
    move a,x0
    move #>$67a0f9,y0
    mpy x1,y0,a
    add #>$185f07,a
    move a,x1
    move #>$555555,y0
    mpy y0,x0,a
    move a,x0
    jmp local_30
    move #>$143777,r0
    move y:(r6+$8),b
    asr #$6,b,b
    move b,n0
    move x:>$ff,r1
    move #$3,r4
    move x:(r0+n0),x0
    move #>$143878,r0
    nop
    move x:(r0+n0),x1
    move #>$555555,y0
    mpy y0,x0,a
    move a,x0
local_30:
    do #<$20,>local_41
    move y:(r4)+,y0
    mpy y0,x0,a
    asl #$9,a,a
    move a,y0
    mpy y0,y0,a
    asr #$2,a,a
    neg a
    add #>$600000,a
    move a,y1
    mpy y1,y0,a
    asl #$1,a,a
    move a,y1
    mpy y1,x1,a
    move a,x:(r1)+
local_41:
    jmp $00026f
