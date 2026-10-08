; NFX4P: Moog-style 4-pole ladder filter (Kocmoc uLADR) on the previous track's
; output, with a trig-driven AD envelope on the cutoff and an envelope or gate VCA.
; Ported from NFX-4P v6 (a custom Machinedrum OS 1.63 machine): the filter, envelope
; and VCA code is unchanged; see README.md for what the port changed.
;
; Voice block (Y, S = R6):
;   +$01..+$08  raw knobs (FREQ RESO MODE ENVA ATK DEC GAIN VCA), read only
;   +$09..+$0c  ladder poles p0..p3
;   +$11..+$13  envelope stage, level, dt
;   +$16..+$18  envelope level fraction, VCA gain, gate count
;   +$19        per-render scratch: the per-sample c2 step
;   +$21..+$28  control words converted from the knobs (controls, below)
.equ VCA_SLEW 190218                  ; VCA gain slew per sample: full scale / 44.1 (1 ms)

; Raw knob words -> control words: k = min(127, round(raw / 2^16)), then
; ctl[128 * knob + k] (tables.asm). Same rounding as the original ColdFire handler.
controls:
        move r6,r0
        move r6,r3
        move #>$21,n3
        move (r0)+                    ; S+1: the raw knobs
        move (r3)+n3                  ; S+$21: the control words
        move #>ctl,y1                 ; this knob's table
        move #>128,x1
        move #>127,x0
        do #8,controls_end
        move y:(r0)+,a
        add #>$8000,a
        asr #16,a,a
        cmp x0,a
        tgt x0,a                      ; k = min(127, (raw + 2^15) >> 16)
        add y1,a        y1,b
        add x1,b        a1,r2         ; the next knob's table
        move b1,y1
        move y:(r2),b
        move b1,y:(r3)+
controls_end:
        rts
init:
        clr a
        move a,y:(r6+$9)
        move a,y:(r6+$a)
        move a,y:(r6+$b)
        move a,y:(r6+$c)
        move a,y:(r6+$11)
        move a,y:(r6+$12)
        move a,y:(r6+$13)
        move a,y:(r6+$16)
        move a,y:(r6+$17)
        move a,y:(r6+$18)
        rts
trigger:
        jsr controls
; Every trig discharges the envelope capacitor; audio integrators remain intact.
        clr a
        move a,y:(r6+$12)
        move a,y:(r6+$16)
        move #>1,a
        move a1,y:(r6+$11)
        move y:(r6+$28),a             ; (re)open the gate: N samples (unused unless N >= 2)
        move a1,y:(r6+$18)
        rts
render:
        jsr controls
        move y:>md_output,r7
        move y:>md_track,a
        tst a
        jeq silent
; ---- Classify: envelope stage 0/1/2 only; active stages need base in clamp range.
        move y:(r6+$11),b
        tst b
        jeq ev_idle
        cmp #2,b
        jgt ev_idle
        tst b
        jlt ev_idle
        move y:(r6+$21),a
        cmp #>2097,a
        jlt ev_idle
        cmp #>$480000,a
        jgt ev_idle
; ---- Block-rate envelope: one exact 32-sample step.
        move #>$7fffff,y1
        move y:(r6+$12),y0            ; level
        cmp #1,b
        jne ev_decay
        move y:(r6+$25),a             ; ATK: mantissa, bit 23 = 2^-31 scale
        tst a
        jge ev_attack_k
        and #>$7fffff,a
        move a1,a
        asr #8,a,a                    ; k = mantissa * 2^-31
ev_attack_k:
        jsr ev_pow32                  ; X0 = 1 - (1 - k)^32
        tfr y1,b
        sub y0,b
        move b1,x1                    ; Q-1 - level
        move y0,a
        move y:(r6+$16),a0
        mac x0,x1,a                   ; level += e (2 (Q-1) - level)
        mac x0,y1,a
        tfr y1,b
        cmp b,a
        jlt ev_store                  ; still charging
        move y1,a                     ; peak: full scale, decay from the next block
        move #>2,b
        move b1,y:(r6+$11)
        jmp ev_store
ev_decay:
        move y:(r6+$26),a             ; DEC coefficient
        jsr ev_pow32
        move y0,a
        move y:(r6+$16),a0
        mac -x0,y0,a                  ; level -= e level
        cmp #>128,a
        jgt ev_store
        clr a                         ; snap to zero: idle
        move a,y:(r6+$11)
ev_store:
        move a1,y:(r6+$12)
        move a0,y:(r6+$16)
; ---- dt: ramp to clamp(2 (base + depth*level), 4194, 0.55) over the block.
        move y:(r6+$24),x0            ; depth
        move x0,a
        tst a
        jeq ev_depth_zero
        move y:(r6+$12),y0            ; block-end level
        move y:(r6+$21),x1
        mpy x0,y0,a
        add x1,a
        asl a                         ; ladder dt = (4/OS) x NFX-SV's cutoff word
        move #>4194,y1
        cmp y1,a
        tlt y1,a
        move #>4613734,b
        cmp b,a
        tgt b,a
        move a1,a                     ; dt1
        move y:(r6+$13),b             ; dt0: the previous block's end value
        move b1,n0
        sub b,a
        jsr ev_step32                 ; ddt = (dt1 - dt0) / 32, toward zero
        move a1,n7
        asl #5,a,a
        add b,a                       ; dt_end = dt0 + 32 ddt
        move a1,y:(r6+$13)
        move a1,y0
        move y:(r6+$22),x0            ; fb/8
        mpy x0,y0,a
        move x0,b
        asr b
        add b,a
        move a1,x1                    ; c2(dt_end) = (fb/8) dt_end + fb/16
        move n0,y0
        mpy x0,y0,a
        add b,a
        move a1,n1                    ; c2(dt0)
        move a1,b
        tfr x1,a
        sub b,a
        jsr ev_step32                 ; dc2 = (c2(dt_end) - c2(dt0)) / 32, toward zero
        move a1,y:(r6+$19)
        move #1,n5                    ; per-sample dt/c2 ramp
        jmp filter_setup
; A = (A1, A0 = 0) -> A1 = A1 / 32 rounded toward zero.
ev_step32:
        tst a
        jge ev_step_up
        neg a
        asr #5,a,a
        move a1,a
        neg a
        rts
ev_step_up:
        asr #5,a,a
        move a1,a
        rts
; A = k (48-bit, 1.0 = 2^47) -> X0 = 1 - (1 - k)^32 (limited, truncated).
ev_pow32:
        do #5,ev_pow32_end
        move a,x0
        asl a
        mac -x0,x0,a                  ; e <- 2e - e^2
ev_pow32_end:
        move a,x0
        rts
ev_idle:                              ; idle: dt = base, unclamped
ev_depth_zero:                        ; clamp(base + 0) = base
        move y:(r6+$21),a
        asl a
        move #>4613734,x0
        cmp x0,a
        tgt x0,a
        move a1,n0                    ; dt = min(0.55, (4/OS) x base)
        move n0,y:(r6+$13)
        move #0,n5
 filter_setup:
; ---- Pass 3: ladder. R0 input (neighbour bank), R7 output, N0 dt (constant
; or per sample from the bank), N5 = 1 for per-sample dt.
        move y:>md_output,a
        eor #$20,a
        move a1,r0
p4_in_ready:
        move y:(r6+$23),a             ; MODE: sign set from 64 up
        move n5,b
        tst a
        jlt f_mode_p2
        tst b
        jne filt_p4_env
        jmp filt_p4_const
f_mode_p2:
        tst b
        jne filt_p2_env
        jmp filt_p2_const
; State into registers: p0..p3 in R1 R2 R3 R5; N2 = fb/8, N6 = gain^4/4,
; N3 = $fff and N4 = table base for the lookup; R6 stays the state base.
load_state:
        move y:(r6+$22),n2
        move y:(r6+$27),n6
        move y:(r6+$9),r1
        move y:(r6+$a),r2
        move y:(r6+$b),r3
        move y:(r6+$c),r5
        move #>$1fff,n3
        move #>tanh,n4
        rts
; Ladder loops. Per Euler step the table address is formed in B (MAC with a shift
; from the table base) so that R4 is written three clocks before it addresses; with
; the cutoff envelope those clocks carry the dt and c2 ramps. Each pole's MAC pair is
; ordered so that no move reads an accumulator the instruction before it wrote, and
; the next sample is read while the output is formed. All of it is bit-exact with the
; straight-line form (ci/ladder_check.py).
filt_p4_const:
        jsr load_state
        move n2,x0
        move n0,y0
        mpy x0,y0,a                   ; dt fb/8
        move n2,b
        asr b
        add b,a
        move a1,n1                    ; c2 = error fb p3 coefficient / 16
        move n6,x0                    ; gain^4/4
        move y:(r0)+,y0               ; the first sample
        do #32,filt_p4_const_end
        mpy x0,y0,a     r5,y0         ; sample * gain^4/4; p3
        move n1,x0                    ; c2
        mpy -x0,y0,a    a1,x1         ; -c2 p3; in16 = sample * gain^4 / 4
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move x:(r4)+,x0  a,y0         ; T[i]: one clock after the R4 and fraction writes, +3 on hardware
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move n1,x0
        move a,y0
        mpy -x0,y0,a    y0,r5         ; -c2 p3; p3 -> R5
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move x:(r4)+,x0  a,y0         ; T[i]: one clock after the R4 and fraction writes, +3 on hardware
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move #>5033165,x0
        asr a           a,r5          ; p3, 4th pole, /2; p3 -> R5
        move y:(r0)+,y0               ; the next sample (the last pass reads one past the bank)
        move a,y1
        mpy x0,y1,a
        asl #3,a,a                    ; 2.4 * out, 12 V over 5 V full scale
        move n6,x0                    ; the next sample's gain^4/4
        move a,y:(r7)+
filt_p4_const_end:
        jmp filter_done
filt_p4_env:
        jsr load_state
        move y:(r6+$19),n2            ; dc2 (the per-sample c2 step)
        move n1,b
        move n2,x0
        add x0,b                      ; the first sample's c2
        move n6,x0                    ; gain^4/4
        move b1,n1
        move y:(r0)+,y0               ; the first sample
        do #32,filt_p4_env_end
        mpy x0,y0,a     r5,y0         ; sample * gain^4/4; p3
        move n1,x0                    ; c2
        mpy -x0,y0,a    a1,x1         ; -c2 p3; in16 = sample * gain^4 / 4
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a        n7,y1         ; Y1 = ddt
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move n0,b                     ; dt += ddt: fills the three clocks before R4 addresses
        add y1,b
        move x:(r4)+,x0  a,y0         ; T[i]
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a     b1,n0
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move n1,x0
        move a,y0
        mpy -x0,y0,a    y0,r5         ; -c2 p3; p3 -> R5
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a        n2,y1         ; Y1 = dc2
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move n1,b                     ; the next sample's c2 += dc2: fills the three clocks before R4 addresses
        add y1,b
        move x:(r4)+,x0  a,y0         ; T[i]
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a     b1,n1
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move #>5033165,x0
        asr a           a,r5          ; p3, 4th pole, /2; p3 -> R5
        move y:(r0)+,y0               ; the next sample (the last pass reads one past the bank)
        move a,y1
        mpy x0,y1,a
        asl #3,a,a                    ; 2.4 * out, 12 V over 5 V full scale
        move n6,x0                    ; the next sample's gain^4/4
        move a,y:(r7)+
filt_p4_env_end:
        jmp filter_done
filt_p2_const:
        jsr load_state
        move n2,x0
        move n0,y0
        mpy x0,y0,a                   ; dt fb/8
        move n2,b
        asr b
        add b,a
        move a1,n1                    ; c2 = error fb p3 coefficient / 16
        move n6,x0                    ; gain^4/4
        move y:(r0)+,y0               ; the first sample
        do #32,filt_p2_const_end
        mpy x0,y0,a     r5,y0         ; sample * gain^4/4; p3
        move n1,x0                    ; c2
        mpy -x0,y0,a    a1,x1         ; -c2 p3; in16 = sample * gain^4 / 4
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move x:(r4)+,x0  a,y0         ; T[i]: one clock after the R4 and fraction writes, +3 on hardware
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move n1,x0
        move a,y0
        mpy -x0,y0,a    y0,r5         ; -c2 p3; p3 -> R5
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move x:(r4)+,x0  a,y0         ; T[i]: one clock after the R4 and fraction writes, +3 on hardware
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move #>5033165,x0
        move r2,b
        asr b           a,r5          ; p1, 2nd pole, /2; p3 -> R5
        move y:(r0)+,y0               ; the next sample (the last pass reads one past the bank)
        move b,y1
        mpy x0,y1,a
        asl #3,a,a                    ; 2.4 * out, 12 V over 5 V full scale
        move n6,x0                    ; the next sample's gain^4/4
        move a,y:(r7)+
filt_p2_const_end:
        jmp filter_done
filt_p2_env:
        jsr load_state
        move y:(r6+$19),n2            ; dc2 (the per-sample c2 step)
        move n1,b
        move n2,x0
        add x0,b                      ; the first sample's c2
        move n6,x0                    ; gain^4/4
        move b1,n1
        move y:(r0)+,y0               ; the first sample
        do #32,filt_p2_env_end
        mpy x0,y0,a     r5,y0         ; sample * gain^4/4; p3
        move n1,x0                    ; c2
        mpy -x0,y0,a    a1,x1         ; -c2 p3; in16 = sample * gain^4 / 4
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a        n7,y1         ; Y1 = ddt
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move n0,b                     ; dt += ddt: fills the three clocks before R4 addresses
        add y1,b
        move x:(r4)+,x0  a,y0         ; T[i]
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a     b1,n0
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move n1,x0
        move a,y0
        mpy -x0,y0,a    y0,r5         ; -c2 p3; p3 -> R5
        add x1,a                      ; arg/16 = in16 - c2 p3
        move n3,x0                    ; mask
        asl a           a2,n5         ; arg/8; sign (A2 read two instructions after the add)
        abs a
        move n4,b                     ; tanh table base
        move a,y1                     ; |arg/8|, limited: x >= 8 -> last entry
        mac y1,#13,b                  ; table address of T[i] (B1)
        tfr y1,a        n2,y1         ; Y1 = dc2
        and x0,a        b1,r4
        asl #10,a,a                   ; interpolation fraction, Q23
        move n1,b                     ; the next sample's c2 += dc2: fills the three clocks before R4 addresses
        add y1,b
        move x:(r4)+,x0  a,y0         ; T[i]
        move x:(r4),y1                ; T[i+1]
        mpy y0,y1,a     b1,n1
        mac -y0,x0,a
        add x0,a        n5,b
        move n0,x0                    ; dt for the stages
        tst b           a1,a
        neg a ifmi                    ; T = sat(in - error fb p3)
        move r1,b
        move a,y0                     ; T
        mac x0,y0,b     r1,y1
        macr -x0,y1,b   r2,a          ; p0 += dt (T - p0), rounded
        move r2,y1
        mac -x0,y1,a    b,y0          ; the same sum in the other order: bit-exact
        macr x0,y0,a    b,r1          ; p1 += dt (p0 - p1)
        move r3,b
        move a,y0
        mac x0,y0,b     r3,y1
        macr -x0,y1,b   a,r2          ; p2 += dt (p1 - p2)
        move r5,a
        move b,y0
        mac x0,y0,a     r5,y1
        macr -x0,y1,a   b,r3          ; p3 += dt (p2 - p3), in A
        move #>5033165,x0
        move r2,b
        asr b           a,r5          ; p1, 2nd pole, /2; p3 -> R5
        move y:(r0)+,y0               ; the next sample (the last pass reads one past the bank)
        move b,y1
        mpy x0,y1,a
        asl #3,a,a                    ; 2.4 * out, 12 V over 5 V full scale
        move n6,x0                    ; the next sample's gain^4/4
        move a,y:(r7)+
filt_p2_env_end:
        jmp filter_done
filter_done:
        move r6,r4                    ; state base for the VCA pass
        move r1,y:(r6+$9)
        move r2,y:(r6+$a)
        move r3,y:(r6+$b)
        move r5,y:(r6+$c)
; ---- Pass 4: VCA, one linear gain ramp per block (v10). R4 = state base.
.equ VCA_STEP32 6086976               ; 32 x VCA_SLEW: full scale in 1 ms, per block
; Target: the envelope level at the block end (+$28 = 1), or for the gate (+$28 >= 2)
; full scale while more than half a block of the gate count (+$18) remains (the
; count drops by 32 per block). The change toward it is clamped to 32 slew steps
; (full scale in 1 ms) and spread as dg per sample (toward zero, so the ramp
; never overshoots); the block-end gain (+$17) snaps to the target within 32 LSB.
; A block held at full scale skips the multiply: exact unity.
 vca_pass:
        move y:(r4+$28),a
        tst a
        jeq vca_off
        cmp #1,a
        jeq vca_env
        move y:(r4+$18),a             ; gate: samples still open
        clr b
        move #>$7fffff,y1
        cmp #16,a
        tgt y1,b                      ; open while more than half a block remains
        move #>32,x0
        sub x0,a
        tst a
        jge vca_count
        clr a
 vca_count:
        move a1,y:(r4+$18)
        tfr b,a
        jmp vca_target
 vca_env:
        move y:(r4+$12),a             ; envelope level at the block end
 vca_target:
        move a,y1                     ; target T
        move y:(r4+$17),b             ; gain g at the block start
        sub b,a
        move #>VCA_STEP32,x1
        cmp x1,a
        tgt x1,a
        move #>-VCA_STEP32,x1
        cmp x1,a
        tlt x1,a                      ; d = clamp(T - g, +-32 slew steps)
        tst a
        jge vca_up
        neg a
        asr #5,a,a
        move a1,a
        neg a
        jmp vca_step
 vca_up:
        asr #5,a,a
        move a1,a
 vca_step:
        move a1,x1                    ; dg = d/32, toward zero
        asl #5,a,a
        add b,a                       ; g + 32 dg
        move a1,x0
        move y1,a
        sub x0,a
        abs a
        cmp #32,a
        move x0,a
        tlt y1,a                      ; within 32 LSB of the target: snap to it
        move a1,y:(r4+$17)
        move x1,a
        tst a
        jne vca_ramp
        move #>$7fffff,x0
        cmp x0,b
        jeq vca_off                   ; held at full scale: exact unity
 vca_ramp:
; Software-pipelined: three instructions per sample and no interlocks (the old
; four-instruction loop stalled twice per sample). The gain stays in 0..$7fffff,
; so the signed mpy (which takes parallel moves) equals the old mpysu. R5 reads
; one sample ahead (the last pass reads the word after the bank and drops it);
; R1 writes. B runs two steps ahead of the gain in X0.
        move y:>md_output,r5          ; output bank, linear (no reliance on M7 wrap)
        add x1,b                      ; g0 = g + dg
        move r5,r1
        move b,x0       y:(r5)+,y0    ; X0 = g0, Y0 = y0
        add x1,b                      ; g1
        do #32,vca_end
        mpy y0,x0,a     b,x0  y:(r5)+,y0      ; y(n) g(n); X0 = g(n+1); Y0 = y(n+1)
        add x1,b                      ; g(n+2)
        move a,y:(r1)+                ; two instructions after the mpy: no stall
 vca_end:
 vca_off:
        rts
silent:
        clr a
        do #32,silent_done
        move a,y:(r7)+
silent_done:
        rts
; The tables (tables.asm, generated by make_tables.py) are the model's own: ctl, the
; 8 x 128 control words, read through the external Y alias, and tanh, tanh(8 m) for
; m = 0..1 in 1,024 intervals (1,025 Q23 words), read through the external X alias.
