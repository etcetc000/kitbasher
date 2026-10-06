; Silent ABI scaffold: every render explicitly clears its 32-sample output.
init: rts
trigger: rts
render:
    move #>md_output,r0
    nop
    move y:(r0),r7
    clr a
    do #32,done
    move a,y:(r7)+
done:
    rts
