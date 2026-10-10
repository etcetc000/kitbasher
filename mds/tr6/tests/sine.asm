; Original ABI smoke fixture, not a TR6 voice.
; A phase accumulator wraps at 2^24; the host sine table has 2^15 entries.
init:
    clr a
    move a1,x:(r6+$0)
    rts
trigger:
    clr a
    move a1,x:(r6+$0)
    rts
render:
    move x:(r6+$0),a
    move y:(r6+$1),x0
    move y:(r6+$2),x1
    do #32,samples_done
    move a1,b
    asr #9,b,b
    and #>$7fff,b
    move b1,r0
    move x:(r0+>mds_sine),y0
    mpy x1,y0,b
    move b,y:(r7)+
    add x0,a
samples_done:
    move a1,x:(r6+$0)
    rts
