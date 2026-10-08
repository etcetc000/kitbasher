; SPDX-License-Identifier: MIT
; Original educational Karplus-Strong voice, md-voice/1, 32 samples/call.
; Y+1 PTCH, +2 DEC, +3 DAMP, +4 LEVL, +5 HAMR, +6 PICK, +7 BEND, +8 BDEC.
; State Y+9 active, +10 clear cursor, +11 write index, +12 excitation left,
; +13 previous delay sample, +14 random seed, +15 loop length, +16 feedback,
; +17 damping, +18 amplitude, +19 slice base, +20 pending excitation.
; +21 bend envelope, +22 hammer mix, +23 pick brightness, +24 impulse,
; +25 excitation low-pass state, +26 fractional delay (Q23), +27 previous interpolated
; sample (held in B during the sample loop). All addresses in these comments are decimal.
; Only this track's 1536-word P-I slice is touched. No global writable state.

init:
    move r6,r0
    move #$9,n0
    move (r0)+n0
    clr a
    do #$13,init_end
    move a,y:(r0)+
init_end:
    move #>$123457,x0
    move x0,y:(r6+$e)
    rts

trigger:
    move #>1,x0
    move x0,y:(r6+$9)
    move x0,y:(r6+$14)
    clr a
    move a,y:(r6+$a)
    move a,y:(r6+$b)
    move a,y:(r6+$d)
    move a,y:(r6+$1b)
    move a,y:(r6+$19)
    move #>$7fffff,x0
    move x0,y:(r6+$15)
    rts

render:
    ; Recompute the slice address from the dispatcher, not a retained pointer.
    move y:>md_track,a
    and #>$f,a
    move a1,a
    move a,b
    asl a
    add b,a
    asl #9,a,a
    add #>pi_ws,a
    move a,y:(r6+$13)
    ; Clear 512 words/call. Sixteen assignments never bulk-clear every line.
    move y:(r6+$a),a
    and #>$e00,a
    move a1,a
    cmp #>$600,a
    jge cleared
    move y:(r6+$13),x0
    add x0,a
    move a1,r0
    move #>0,x0
    do #$200,clear_end
    move x0,y:(r0)+
clear_end:
    move y:(r6+$a),a
    and #>$e00,a
    move a1,a
    add #>$200,a
    move a,y:(r6+$a)
    jmp silence
cleared:
    move y:(r6+$9),a
    tst a
    jeq silence
    ; PTCH: raw = 2 (MIDI - 24), half-semitone steps. `period` holds the whole loop delay in
    ; samples with 12 fraction bits (44100 / f x 4096).
    move y:(r6+$1),a
    asr #16,a,a
    and #>$7f,a
    add #>period,a
    move a1,r0
    nop
    move y:(r0),x0
    ; A positive pitch bend starts with a shorter delay and decays to PTCH.
    move y:(r6+$7),a
    asr a
    move a,y0
    move y:(r6+$15),x1
    mpy x1,y0,a
    move a,y0
    mpy x0,y0,a
    move a,x1
    move x0,a
    sub x1,a
    ; The DAMP averager delays the loop by DAMP/256 samples; take it off, then split what is
    ; left into the integer ring length and a fraction for the interpolating tap.
    move y:(r6+$3),b
    asr #12,b,b
    sub b,a
    tfr a,b
    asr #12,a,a
    move a1,n2
    and #>$fff,b
    asl #11,b,b
    move b1,y:(r6+$1a)
    move y:(r6+$8),a
    asr #16,a,a
    and #>$7f,a
    add #>bend_decay,a
    move a1,r0
    nop
    move y:(r0),y0
    move y:(r6+$15),x0
    mpy x0,y0,a
    move a,y:(r6+$15)
    ; Feedback curve from the model's own table (no external dependencies).
    move y:(r6+$2),a
    asr #16,a,a
    and #>$7f,a
    add #>feedback,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$10)
    move y:(r6+$3),a
    asr a
    move a,y:(r6+$11)
    move y:(r6+$4),a
    move a,y:(r6+$12)
    move y:(r6+$5),a
    asr #16,a,a
    and #>$7f,a
    add #>hammer,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$16)
    move y:(r6+$6),a
    asr #16,a,a
    and #>$7f,a
    add #>pick,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$17)
    ; The pending trigger survives clearing. Excite exactly one ring traversal.
    move y:(r6+$14),a
    tst a
    jeq ready
    move n2,x0
    move x0,y:(r6+$c)
    move #>$400000,x0
    move x0,y:(r6+$18)
    clr a
    move a,y:(r6+$14)
ready:
    move y:(r6+$b),a
    move n2,x0
    cmp x0,a
    jlt index_valid
    clr a
index_valid:
    move a1,n1
    move y:(r6+$13),r2
    move y:(r6+$1b),b
    move y:>md_output,r7
    do #32,sample_end
    move r2,a
    move n1,x0
    add x0,a
    move a1,r0
    nop
    move y:(r0),x0
    move y:(r6+$d),a
    sub x0,a
    move x0,y:(r6+$d)
    move a,y0
    ; Fractional delay: a linear tap between this sample and the one before it.
    move y:(r6+$1a),x1
    move x0,a
    mac x1,y0,a
    move y:(r6+$11),x1
    move a,x0
    sub x0,b
    move b,y0
    tfr x0,b
    move x0,a
    mac x1,y0,a
    move y:(r6+$10),y0
    move a,x0
    mpy x0,y0,a
    move a,y1
    move y:(r6+$c),a
    tst a
    jeq no_excitation
    sub #>1,a
    move a,y:(r6+$c)
    move y:(r6+$e),x0
    move #>$19660d,y0
    mpy x0,y0,a
    asr a
    move a0,a
    add #>$3c6ef3,a
    move a1,y:(r6+$e)
    move a1,a
    asr #3,a,a
    ; HAMR crossfades a noise burst into a single positive hammer impulse.
    move a,x0
    move y:(r6+$18),a
    sub x0,a
    move a,y0
    move y:(r6+$16),x1
    move x0,a
    mac x1,y0,a
    move a,x0
    clr a
    move a,y:(r6+$18)
    jmp filter_exciter
no_excitation:
    clr a
    move a,x0
filter_exciter:
    ; PICK low-passes only the excitation, including its tail after the burst.
    move x0,a
    move y:(r6+$19),x1
    sub x1,a
    move a,y0
    move y:(r6+$17),x0
    move x1,a
    mac x0,y0,a
    move a,y:(r6+$19)
    add y1,a
    move a,y1
    move y1,y:(r0)
    move y:(r6+$12),x0
    mpy x0,y1,a
    move a,y:(r7)+
    move n1,a
    add #>1,a
    move n2,x0
    cmp x0,a
    jlt next_index
    clr a
next_index:
    move a1,n1
sample_end:
    move n1,x0
    move x0,y:(r6+$b)
    move b,y:(r6+$1b)
    rts

silence:
    move y:>md_output,r7
    clr a
    do #32,silence_end
    move a,y:(r7)+
silence_end:
    rts
