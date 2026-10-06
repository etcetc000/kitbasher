"""Author the Noise Plethora DSP port; the importer never executes this file.

Writes a source directory (model.json, dsp2.asm, tables.asm) for packs/assembly_export.py.
Derived synthesis graphs: Befaco Noise Plethora, GPL-3.0-or-later.
"""
import argparse
import json
import math
import re
from pathlib import Path

Q = 1 << 23
PHASE_MAX = 0x7ffe00  # Original Teensy phase-increment ceiling, at 24-bit precision.
CATALOG = json.loads(Path(__file__).with_name('upstream-inventory.json').read_text())
PROGRAMS = [p['program'] for bank in CATALOG['banks'].values() for p in bank]
IMPLEMENTED = ('clusterSaw', 'FibonacciCluster', 'partialCluster', 'S_H', 'pwCluster',
               'crCluster2', 'sineFMcluster', 'TriFMcluster', 'BasuraTotal',
               'PrimeCluster', 'PrimeCnoise', 'phasingCluster', 'basurilla',
               'arrayOnTheRocks', 'WalkingFilomena', 'existencelsPain', 'whoKnows',
               'xModRingSqr', 'XModRingSine', 'CrossModRing', 'Atari', 'radioOhNo',
               'resonoise', 'Rwalk_BitCrushPW', 'Rwalk_LFree', 'satanWorkout',
               'Rwalk_SineFMFlange', 'grainGlitch', 'grainGlitchII', 'grainGlitchIII')


def q(value):
    return max(-Q, min(Q-1, round(value*Q)))


def block_table(name, values):
    return name+':\n'+'\n'.join('    .dc '+','.join(f'${v & 0xffffff:06x}' for v in values[i:i+8]) for i in range(0,len(values),8))+'\n'


# Knob laws computed instead of stored (DSP2 RAM): value = c0 + c1*x or c0 + c1*x^2, x = raw/127.
# lookup() emits the arithmetic for these; generate() replaces each table with exactly what that
# arithmetic yields, so anything else reading the table agrees bit for bit.
_F24, _F23 = (1 << 24) / 44100, (1 << 23) / 44100
KNOB_LAWS = {
    'saw_base': ('quad', 20*_F24, 1000*_F24), 'fib_base': ('quad', 40*_F24, 5000*_F24),
    'part_base': ('quad', 50*_F24, 1000*_F24), 'saw_spread': ('quad', 1.01/2*Q, .9/2*Q),
    'part_spread': ('lin', 1.01/4*Q, 1.1/4*Q), 'sh_rate': ('lin', 15*_F23, 5000*_F23),
    'pw_base': ('quad', 40*_F24, 8000*_F24), 'pw_width': ('lin', 32767*256, -.97*32767*256),
    'basura_base': ('quad', 200*_F24, 5000*_F24), 'basura_time': ('quad', 0, 4410),
    'basura_width': ('lin', .5*Q, -.45*Q), 'phasing_base': ('quad', 30*_F24, 5000*_F24),
    'phasing_spread': ('lin', .5*Q, .25*Q), 'basurilla_rate': ('quad', 10*_F24, 100*_F24),
    'basurilla_width': ('lin', 0, .95*Q), 'walk_bound': ('lin', 200, 1800), 'walk_width': ('lin', .1*Q, .8*Q),
    'existencelsPain_rate': ('quad', 50*Q/44100, 5000*Q/44100), 'whoKnows_rate': ('quad', 15*Q/44100, 500*Q/44100),
    'existencelsPain_depth': ('lin', .3/8*Q, 3/8*Q), 'whoKnows_depth': ('lin', .3/8*Q, 6/8*Q),
    'CrossModRing_depth': ('lin', 2/16*Q, 8/16*Q), 'radio_width': ('lin', .5*Q, .5*Q),
    'resonoise_square': ('quad', 20*_F24, 7777*_F24), 'resonoise_sine': ('quad', 20*_F24, 10000*_F24),
    'resonoise_fold': ('lin', .03*32767*256, .2*32767*256), 'bitwalk_width': ('lin', .2*Q, .55*Q),
    'lfree_bound': ('lin', 50, 500), 'grain_depth': ('lin', 0, Q/4),
    'grain_rate': ('quad', 500*_F24, 5000*_F24), 'grain_rate3': ('quad', 400*_F24, 5000*_F24),
    'flange_rate': ('lin', 0, 3*(1 << 31)/44100),
    # FM-group depths (fm_group_tables).
    'crx_dq': ('lin', 0, 8192), 'fmp_dq': ('lin', 819.2, 7372.8), 'prx_dq': ('lin', 0, 409.6),
    # Feedback graphs' node rates (graph_rates in generate), read by fb_step.
    'xModRingSqr_rate0': ('quad', 100*_F24, 5000*_F24), 'xModRingSqr_rate1': ('quad', 20*_F24, 1000*_F24),
    'XModRingSine_rate0': ('quad', 100*_F24, 8000*_F24), 'XModRingSine_rate1': ('quad', 60*_F24, 3000*_F24),
    'Atari_rate0': ('quad', 10*_F24, 50*_F24), 'Atari_rate1': ('lin', 10*_F24, 200*_F24),
}
DATA_REGS = ('x0', 'x1', 'y0', 'y1')


# Exponential knob laws read the shared 2^x table (fmx): value = lim(fmx[2048 + sign*8*(raw-64)] << 7),
# i.e. 2^(sign*(raw-64)/32)/4 at 1/256-octave resolution.
EXP_LAWS = {'pitch': 1, 'pitch_inverse': -1}
FMX = [min(Q-1, round(2**(i/256)*Q/512)) for i in range(-2048, 2049)]


def exp_law_values(name):
    sign = EXP_LAWS[name]
    return [min(Q-1, FMX[2048 + sign*8*(raw-64)] << 7) for raw in range(128)]


def knob_law(name):
    """(kind, c0, B): lin value = c0 + ((raw<<16)*B*2 >> 24); quad squares raw<<16 first."""
    kind, c0, c1 = KNOB_LAWS[name]
    B = round(c1*128/127) if kind == 'lin' else round(c1*16384/16129)
    assert -(1 << 23) <= B < (1 << 23) and 0 <= round(c0) < (1 << 23), name
    return kind, round(c0), B


def knob_law_values(name):
    kind, c0, B = knob_law(name)
    out = []
    for raw in range(128):
        d = raw << 16
        if kind == 'quad': d = (d*d*2) >> 24
        out.append(((d*B*2) >> 24) + c0)
    return out


class LawTables(dict):
    """The table dict: a knob-law table always holds what lookup()'s arithmetic yields."""
    def __init__(self, items):
        super().__init__()
        for k, v in items.items(): self[k] = v
    def __setitem__(self, k, v):
        super().__setitem__(k, knob_law_values(k) if k in KNOB_LAWS else exp_law_values(k) if k in EXP_LAWS else v)
    def update(self, other):
        for k, v in other.items(): self[k] = v


def lookup(control, table, dest):
    if table in KNOB_LAWS and control == 5:
        # DRIV's slot is gone: it always reads DRIV_DEFAULT, so the law is a constant.
        return f'    move #>${knob_law_values(table)[DRIV_DEFAULT] & 0xffffff:06x},{dest}\n'
    if table in EXP_LAWS:
        flip = '    neg a\n' if EXP_LAWS[table] < 0 else ''
        return f'''    move y:(r6+${control:x}),a
    and #>$7f0000,a
    asr #13,a,a
    sub #>512,a
{flip}    add #>fmx+2048,a
    move a1,r0
    nop
    move y:(r0),a
    asl #7,a,a
    move a,{dest}
'''
    if table in KNOB_LAWS and dest in DATA_REGS:
        kind, c0, B = knob_law(table)
        square = f'    mpy {dest},{dest},a\n    move a1,{dest}\n' if kind == 'quad' else ''
        offset = f'    add #>{c0},a\n' if c0 else ''
        return f'''    move y:(r6+${control:x}),a
    and #>$7f0000,a
    move a1,{dest}
{square}    mpyi #>${B & 0xffffff:06x},{dest},a
{offset}    move a1,{dest}
'''
    # Controls are 0..127 in 16.16 form, so the shift alone yields a valid index.
    return f'''    move y:(r6+${control:x}),a
    asr #16,a,a
    move a1,a
    add #>{table},a
    move a1,r0
    nop
    move y:(r0),{dest}
'''


def header():
    notice=Path(__file__).with_name('TEENSY-NOTICE.txt').read_text()
    return '; '+notice.replace('\n','\n; ')+'\n'+'''; Noise Plethora DSP56300 port, derived from Befaco programs.
; SPDX-License-Identifier: GPL-3.0-or-later
; Original program copyright: Befaco / Jeremy Bernstein / Julia Mugica / Ivan Paz.
; MD adaptation: 24-bit synthesis, per-voice envelope/pitch/band-pass controls.
; Controls Y+1 PTCH, +2 DEC, +3 MODE, +4 X, +5 Y, +6 ATK, +7 BPF, +8 BPQ.
; State Y+9 last mode, +10 active, +11 envelope, +12 attack flag, +13 pitch/4,
; +14 band-pass low, +15 output base, +16 band-pass band. X+0..15 phase steps, Y+32..47 phases.
; Program code below is written against the original layout (+1 MODE, +2 X, +3 Y, +4 PTCH,
; +5 DRIV, +6 ATK, +7 DEC, +8 LEVL); generate() renumbers it (CONTROL_SLOTS).

init:
    move r6,r0
    clr a
    do #64,init_x_end
    move a,x:(r0)+
init_x_end:
    move r6,r0
    move #>9,n0
    move (r0)+n0
    do #55,init_y_end
    move a,y:(r0)+
init_y_end:
    move #>$ffffff,x0
    move x0,y:(r6+$9)
    rts

trigger:
    move #>1,x0
    move x0,y:(r6+$a)
    move x0,y:(r6+$c)
    clr a
    move a,y:(r6+$b)
    rts

render:
    move #>md_output,r0
    nop
    move y:(r0),r7
    move r7,y:(r6+$f)
    move y:(r6+$a),a
    tst a
    jeq silence
'''


# Knob layout: PTCH and DEC first like every other model; a band-pass (BPF, BPQ) takes the
# slots the original's DRIV and LEVL knobs used. Program code addresses the original slots; remap_controls() renumbers them.
KNOBS=(('PTCH',64),('DEC',100),('MODE',0),('FREQ',32),('SPRD',30),('ATK',0),('BPF',80),('BPQ',0))
CONTROL_SLOTS={1:3,2:4,3:5,4:1,6:6,7:2}   # original slot -> new slot (MODE X Y PTCH ATK DEC)
DRIV_DEFAULT=0                            # DRIV's slot (drive, or SMTH/PWID) now reads this raw value
OUTPUT_LEVEL=100<<16                      # the former LEVL default, raw << 16
BANDPASS_SLOT='    ;@@bandpass@@\n'
BP_FC=(30,7300)                           # BPF 0..127: exponential centre frequency, Hz (f <= 1)
BP_Q=(1,32)                               # BPQ 0..127: exponential Q; Q 1 is the dry signal


def bandpass_tables():
    """bp_f: f = 2 sin(pi fc/fs) per BPF (below one, so one multiply; f^2 + 2f/Q < 4 always holds).
    bp_kd: damping k = 1/Q per BPQ."""
    f=[q(2*math.sin(math.pi*BP_FC[0]*(BP_FC[1]/BP_FC[0])**(k/127)/44100)) for k in range(128)]
    kd=[q(1/(BP_Q[0]*(BP_Q[1]/BP_Q[0])**(k/127))) for k in range(128)]
    return {'bp_f':f,'bp_kd':kd}


def bandpass():
    """Chamberlin filter over the block, in place, before the envelope, mixed as
    y = k*(low + band + high) = k*in + (1-k)*band (k = 1/Q): unity at the centre frequency,
    k elsewhere. Q 1 (BPQ 0) is the dry signal; higher BPQ narrows the peak and deepens the
    floor (-30 dB at Q 32). The input is scaled by k, so the states stay within full scale.
    a = low (full precision), y1 = band; Y+$e/$10 hold them between blocks."""
    return '''    move y:(r6+$7),a
    asr #16,a,a
    move a1,a
    add #>bp_f,a
    move a1,r0
    move y:(r6+$8),a
    asr #16,a,a
    move y:(r0),x0
    move a1,a
    add #>bp_kd,a
    move a1,r1
    move y:(r6+$f),r0
    move y:(r6+$f),r4
    move y:(r1),x1
    move y:(r6+$e),a
    move y:(r6+$10),y1
    do #32,bp_end
    mac x0,y1,a  y:(r0)+,y0
    mpy x1,y0,b
    mac -x1,y1,b
    add y1,b
    sub y1,b  b,y:(r4)+
    sub a,b
    tfr y1,b  b,y0
    mac x0,y0,b
    move b,y1
bp_end:
    move a,y:(r6+$e)
    move y1,y:(r6+$10)
'''


def remap_controls(source):
    """Move the original control slots to the new layout. DRIV's slot is gone: its table lookups
    read entry DRIV_DEFAULT and the drive store disappears (unity drive needs no stage)."""
    source=source.replace('    move x0,y:(r6+$e)\n','')
    source,count=re.subn(r'    move y:\(r6\+\$5\),a\n    asr #16,a,a\n    move a1,a\n    add #>(\w+),a\n',
                         lambda m:f'    move #>{m[1]}+{DRIV_DEFAULT},a\n',source)
    assert count<=5, count  # DRIV-slot knob laws are constants already (lookup)
    assert not re.search(r'y:\(r6\+\$[58]\)',source)
    return re.sub(r'y:\(r6\+\$([1-8])\)',lambda m:f'y:(r6+${CONTROL_SLOTS[int(m[1])]})',source)


def common_output():
    # The envelope's block-start value stays in x1 (the attack/decay paths leave it alone),
    # which frees Y+$10 for the band-pass state.
    return '''output:
'''+BANDPASS_SLOT+'''    ; Linear interpolation of block envelope endpoints avoids 32-sample steps.
    move y:(r6+$b),x1
    move y:(r6+$c),a
    tst a
    jeq decay_envelope
    move y:(r6+$6),a
    tst a
    jne attack_envelope
    move #>$7fffff,x0
    move x0,x1
    move x0,y:(r6+$b)
    clr a
    move a,y:(r6+$c)
    jmp decay_envelope
attack_envelope:
'''+lookup(6,'attack', 'y0')+'''    move y:(r6+$b),a
    add y0,a
    move a,x0
    move x0,y:(r6+$b)
    cmp #>$7fffff,a
    jlt gain_ramp
    clr a
    move a,y:(r6+$c)
    jmp gain_ramp
decay_envelope:
    move y:(r6+$7),a
    asr #16,a,a
    cmp #>127,a
    jeq gain_ramp
'''+lookup(7,'decay','y0')+'''    move y:(r6+$b),x0
    mpy x0,y0,a
    move a,y:(r6+$b)
gain_ramp:
    ; Level is fixed at the former LEVL default; drive is unity (the former DRIV default).
    move #>${OUTPUT_LEVEL:x},y0
    move x1,x0
    mpy x0,y0,b
    move b,y1
    move y:(r6+$b),x0
    mpy x0,y0,a
    sub y1,a
    asr #5,a,a
    move a,x1
    move y1,b
    move y:(r6+$f),r0
    move y:(r6+$f),r4
    move y:(r0),x0
    move (r4)+
    ; Software-pipelined: the next sample loads while this one is scaled (reads one past the end).
    do #32,gain_end
    add x1,b  b,y1
    mpy x0,y1,a  y:(r4)+,x0
    move a,y:(r0)+
gain_end:
    rts
silence:
    clr a
    do #32,silence_end
    move a,y:(r7)+
silence_end:
    rts
'''.replace('${OUTPUT_LEVEL:x}',f'${OUTPUT_LEVEL:x}')


def control_block(name):
    base = {'clusterSaw':'saw_base','FibonacciCluster':'fib_base','partialCluster':'part_base'}[name]
    result=name+':\n'+lookup(2,base,'x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move a,x0
    move r6,r1
'''
    if name=='FibonacciCluster':
        result+='''    ; Independent ratios preserve the non-monotonic early Fibonacci terms.
    move y:(r6+$3),a
    asr #16,a,a
    and #>$7f,a
    move a1,a
    asl #4,a,a
    add #>fib_ratios,a
    move a1,r0
    nop
    ; One word per ratio: ratio * 2^16 (below 2^23: every ratio is under 128).
    do #16,fib_setup_end
    move y:(r0)+,y0
    mpy x0,y0,a
    asl #7,a,a
    move a,x1
    move #>$7ffe00,y0
    move x1,a
    cmp y0,a
    tgt y0,a
    move a,x:(r1)+
fib_setup_end:
'''
    else:
        spread='saw_spread' if name=='clusterSaw' else 'part_spread'
        shift=1 if name=='clusterSaw' else 2
        result+=lookup(3,spread,'y0')+f'''    do #16,{name}_setup_end
    move x0,x:(r1)+
    mpy x0,y0,a
    asl #{shift},a,a
    move #>$7ffe00,x1
    cmp x1,a
    tgt x1,a
    move a,x0
{name}_setup_end:
'''
    amp=q(.2 if name=='FibonacciCluster' else .25)
    result+=f'    move #>${amp:x},y0\n    jmp saw_cluster\n'
    return result


def saw_cluster():
    # Preserve four groups of four and the final mixer's saturating channel order.
    result='''saw_cluster:
    move #>32,n4
    do #32,saw_end
    move r6,r0
    move r6,r4
    move (r4)+n4
    clr b
'''
    for group in range(4):
        for _ in range(4):
            result+='''    move x:(r0)+,x0  y:(r4),a
    add x0,a  a1,x1
    mac x1,y0,b  a1,y:(r4)+
'''
        if group:
            result+='''    move b,a
    add y1,a
    move a,y1
'''
        else:
            result+='    move b,y1\n'
        if group<3:
            result+='    clr b\n'
    result+='''    move y1,y:(r7)+
saw_end:
    jmp output
'''
    return result


def reset_program(names):
    return '''
reset_program:
    move r6,r0
    clr a
    do #64,reset_x_end
    move a,x:(r0)+
reset_x_end:
    move r6,r0
    move #>17,n0
    move (r0)+n0
    do #47,reset_y_end
    move a,y:(r0)+
reset_y_end:
    move #>$123457,x0
    move x0,y:(r6+$1f)
'''+f'''    ; Pulse phases carry a half-cycle representation bias for signed comparisons.
    move y:(r6+$9),a
    cmp #>{names.index('pwCluster')},a
    jne reset_basura
    move r6,r0
    move #>32,n0
    move (r0)+n0
    move #>$800000,x0
    do #6,reset_pulse_end
    move x0,y:(r0)+
reset_pulse_end:
    jmp reset_done
reset_basura:
    cmp #>{names.index('arrayOnTheRocks')},a
    jeq reset_array
    cmp #>{names.index('WalkingFilomena')},a
    jeq reset_walk
    cmp #>{names.index('Rwalk_BitCrushPW')},a
    jeq reset_bitwalk
    cmp #>{names.index('Rwalk_LFree')},a
    jeq reset_lfree
    cmp #>{names.index('satanWorkout')},a
    jeq reset_pink
    cmp #>{names.index('Rwalk_SineFMFlange')},a
    jeq reset_flange
    cmp #>{names.index('grainGlitch')},a
    jeq reset_grain
    cmp #>{names.index('grainGlitchII')},a
    jeq reset_grain
    cmp #>{names.index('grainGlitchIII')},a
    jeq reset_grain
    cmp #>{names.index('basurilla')},a
    jeq reset_prime
    cmp #>{names.index('existencelsPain')},a
    jeq reset_prime
    cmp #>{names.index('resonoise')},a
    jeq reset_prime
    cmp #>{names.index('PrimeCluster')},a
    jeq reset_prime
    cmp #>{names.index('PrimeCnoise')},a
    jne reset_basura_test
reset_prime:
    move #>1,x0
    move x0,y:(r6+$1f)
    jmp reset_done
reset_basura_test:
    cmp #>{names.index('BasuraTotal')},a
    jne reset_done
    move #>$face,x0
    move x0,y:(r6+$11)
    move #>$fedd,x0
    move x0,y:(r6+$12)
    move #>{round(500*(1<<24)/44100)},x0
    move x0,y:(r6+$15)
    jmp reset_done
reset_array:
    move #>md_track,r0
    nop
    move y:(r0),a
    and #>15,a
    add #>array_random,a
    move a1,r0
    nop
    move y:(r0),x0
    move x0,y:(r6+$16)
    jmp reset_done
reset_walk:
    move #>walk_initial,r0
    move r6,r1
    move #>16,n1
    move (r1)+n1
    do #16,walk_reset_end
    move y:(r0)+,x0
    move x0,x:(r1)+
walk_reset_end:
    move y:(r0)+,x0
    move x0,y:(r6+$1f)
    move y:(r0),x0
    move x0,y:(r6+$1e)
    jmp reset_done
reset_bitwalk:
    move #>bitwalk_initial,r0
    move r6,r1
    move #>16,n1
    move (r1)+n1
    do #9,bitwalk_reset_end
    move y:(r0)+,x0
    move x0,x:(r1)+
bitwalk_reset_end:
    move y:(r0)+,x0
    move x0,y:(r6+$1f)
    move y:(r0),x0
    move x0,y:(r6+$1e)
    jmp reset_done
reset_lfree:
    move #>lfree_initial,r0
    move r6,r1
    move #>16,n1
    move (r1)+n1
    do #4,lfree_reset_end
    move y:(r0)+,x0
    move x0,x:(r1)+
lfree_reset_end:
    move y:(r0)+,x0
    move x0,y:(r6+$1f)
    move y:(r0),x0
    move x0,y:(r6+$1e)
    ; Source levels sit between their half-periods at X+1,3,5,7.
    move #>$7fff00,x0
    move x0,x:(r6+1)
    move x0,x:(r6+3)
    move x0,x:(r6+5)
    move x0,x:(r6+7)
    jmp reset_done
reset_pink:
    move #>$7fff00,x0
    move x0,y:(r6+$30)
    jmp reset_done
reset_flange:
    move #>bitwalk_initial,r0
    move r6,r1
    move #>16,n1
    move (r1)+n1
    do #4,flange_reset_end
    move y:(r0)+,x0
    move x0,x:(r1)+
flange_reset_end:
    move #>flange_seed,r0
    nop
    move y:(r0)+,x0
    move x0,y:(r6+$1f)
    move y:(r0),x0
    move x0,y:(r6+$1e)
    jmp reset_done
reset_grain:
    move #>1,x0
    move x0,y:(r6+$17)
reset_done:
    rts
'''


def sample_hold():
    return 'S_H:\n'+lookup(2,'sh_rate','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$3fff00,x1
    cmp x1,a
    tgt x1,a
    move a,n0
'''+lookup(3,'sh_slew','y0')+'''    move #>$7fffff,a
    sub y0,a
    add #>1,a
    move a,y1
    do #32,sh_end
    move y:(r6+$20),a
    move n0,x0
    add x0,a
    cmp #>$7fffff,a
    jle sh_same
    and #>$7fffff,a
    move a1,y:(r6+$20)
    move y:(r6+$1f),x0
    move y0,y:(r6+$1b)
    move #>$19660d,y0
    mpy x0,y0,a
    asr a
    move a0,a
    add #>$3c6ef3,a
    move a1,y:(r6+$1f)
    move a1,y:(r6+$1e)
    move y:(r6+$1b),y0
    jmp sh_filter
sh_same:
    move a1,y:(r6+$20)
sh_filter:
    move y:(r6+$1e),x0
    move y:(r6+$1d),x1
    mpy x0,y0,a
    mac x1,y1,a
    move a,y:(r6+$1d)
    move a,y:(r7)+
sh_end:
    jmp output
'''


def pulse_cluster():
    result='pwCluster:\n'+lookup(2,'pw_base','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move a,x0
    move r6,r1
    move #>pw_ratios,r0
    nop
    do #6,pw_setup_end
    move y:(r0)+,y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$7ffe00,x1
    cmp x1,a
    tgt x1,a
    move a,x:(r1)+
pw_setup_end:
'''+lookup(3,'pw_width','y0')+f'''    move #>${q(.7):x},y1
    move #>32,n4
    do #32,pw_end
    move r6,r0
    move r6,r4
    move (r4)+n4
    clr b
'''
    for oscillator in range(6):
        # Preserve the original mixer's saturation after every channel addition.
        result+=f'''    move x:(r0)+,x0  y:(r4),a
    add x0,a  a1,x1
    move a1,y:(r4)+
    move x1,a
    cmp y0,a
    move #>${(-q(.7)) & 0xffffff:x},a
    tlt y1,a
    add a,b
    move b,b
'''
        if oscillator==3:
            result+='    move b,y:(r6+$1c)\n    clr b\n'
    result+='''    move y:(r6+$1c),x0
    add x0,b
    move b,y:(r7)+
pw_end:
    jmp output
'''
    return result


def sine_a():
    """A1 phase -> interpolated sine in A; B/r0/r4 are preserved."""
    # The shared sine (filt_sine1k): 1,024 points, phase>>14.
    return '''    asr #14,a,a
    and #>$3ff,a
    add #>filt_sine1k,a
    move a1,r5
    nop
    move y:(r5),a
'''


def basura_total():
    return 'BasuraTotal:\n'+lookup(2,'basura_base','x0')+'''    move x0,y:(r6+$16)
'''+lookup(3,'basura_time','y0')+'''    ; micros() events are quantized to the MD's 32-sample control cadence.
    move y:(r6+$13),a
    add #>32,a
    cmp y0,a
    jle basura_no_event
    clr a
    move a,y:(r6+$13)
    move #>1,x0
    move x0,y:(r6+$14)
    ; Exact original 32-bit Galois LFSR, split into two unsigned 16-bit halves.
    move y:(r6+$11),a
    move a1,x0
    asr a
    move y:(r6+$12),b
    move b1,x1
    and #>1,b
    asl #15,b,b
    add b,a
    move a1,y:(r6+$11)
    move x1,b
    asr b
    move b1,y:(r6+$12)
    move x0,a
    and #>1,a
    tst a
    jeq basura_zero
    move y:(r6+$11),a
    eor #>$8006,a
    move a1,y:(r6+$11)
    move y:(r6+$12),a
    eor #>$8000,a
    move a1,y:(r6+$12)
    move y:(r6+$16),a
    jmp basura_set_frequency
basura_zero:
    clr a
basura_set_frequency:
    move a1,y:(r6+$15)
    jmp basura_controls
basura_no_event:
    move a1,y:(r6+$13)
basura_controls:
    ; Full-level square drive is redundant: knob 4 controls pulse width instead.
    move #>$80000,x0
    move x0,y:(r6+$e)
'''+lookup(5,'basura_width','y0')+'''    move y0,n2
    move y:(r6+$15),x0
    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$7ffe00,x1
    cmp x1,a
    tgt x1,a
    move a,n3
    move y:(r6+$14),a
    tst a
    jne basura_square
    ; Preserve the original 500 Hz sine before the first timer event.
    do #32,basura_sine_end
    move y:(r6+$20),a
    move n3,x0
    add x0,a  a1,x1
    move a1,y:(r6+$20)
    move x1,a
'''+sine_a()+'''    move a,y:(r7)+
basura_sine_end:
    jmp output
basura_square:
    move n2,y0
    move #>$7fffff,y1
    do #32,basura_square_end
    move y:(r6+$20),a
    move n3,x0
    add x0,a  a1,x1
    move a1,y:(r6+$20)
    move x1,a
    asr a
    and #>$7fffff,a
    move a1,a
    cmp y0,a
    move #>$800001,a
    tlt y1,a
    move a,y:(r7)+
basura_square_end:
    jmp output
'''


def fm_scale(tag, double_depth=False):
    # Match the original 16-bit modulation input and default eight-octave depth.
    # The table preserves the original de Soras quadratic, not an ideal exp2.
    return '''    move a,x0
    move y:(r6+$11),y0
    mpy x0,y0,a
'''+('    asl a\n' if double_depth else '')+'''    asr #8,a,a
    move a1,x0
    asr #12,a,a
    add #>1,a
    move a1,y:(r6+$12)
    move x0,a
    and #>$fff,a
    add #>fm_mantissa,a
    move a1,r5
    nop
    move y:(r5),a
    move y:(r6+$12),b
    tst b
'''+f'''    jge {tag}_positive
    neg b
    move b,x1
    asr x1,a,a
    clr b
    move b,y:(r6+$12)
{tag}_positive:
    move a1,y:(r6+$13)
'''


def triangle_half(tag):
    """A1 phase -> half-amplitude triangle in A; avoids clipping its positive peak."""
    return f'''    move a1,x0
    abs a
    sub #>$400000,a
    abs a
    move #>$400000,b
    sub a,b
    move x0,a
    tst a
    jge {tag}_triangle_positive
    neg b
{tag}_triangle_positive:
    move b,a
'''


def park_miller_a(tag):
    """Original 31-bit white-noise sequence, split across Y30/31; output in A."""
    return f'''    ; Multiply the 31-bit seed by 16807 using the full accumulator.
    move y:(r6+$1f),x0
    move #>16807,y0
    mpy x0,y0,a
    move y:(r6+$1e),x0
    mpy x0,y0,b
    asl #16,b,b
    add b,a
    asr a
    move a0,x0
    move a1,x1
    ; Fold the product at bit 31 (modulo 2^31-1).
    asr #7,a,a
    move a1,y1
    move x0,b
    asr #16,b,b
    and #>$ff,b
    move b1,b
    move x1,a
    asl #8,a,a
    and #>$7f00,a
    add b,a
    move a1,y:(r6+$1e)
    move x0,a
    and #>$ffff,a
    add y1,a
    cmp #>$10000,a
    jlt {tag}_noise_no_carry
    sub #>$10000,a
    move y:(r6+$1e),b
    add #>1,b
    move b1,y:(r6+$1e)
{tag}_noise_no_carry:
    move a1,y:(r6+$1f)
    ; Teensy white noise uses the signed low sixteen bits of the new seed.
    asl #8,a,a
    move a1,a
'''


# ---------------------------------------------------------------------------
# FM group: crCluster2, sineFMcluster, TriFMcluster,
# PrimeCluster, PrimeCnoise, arrayOnTheRocks. See README.md, "How it fits".
# Shared tricks:
# * fmx: one direct 2^x table (1/256 octave, +/-8 octaves, value F/512) replaces
#   the per-sample exponent/mantissa evaluation and its sign branch.
# * Common-phase oscillators: when oscillator frequencies are fixed ratios of one
#   another, their phases are integer multiples k_i of ONE 48-bit phase accumulator.
#   A fractional mpy of that phase's high word by k_i leaves k_i*phase mod 1 in the
#   low product word (b0), so each oscillator costs a multiply and no state.
# * Parabolic sine p-p|p| (odd harmonics, 3rd at -28.6 dB) instead of a table.
FMX_PRIMES=(53,127,199,283,383,467,577,661,769,877,983,1087,1193,1297,1429,1523)
CRX_K=(256,314,390,456,547,711)   # pw_ratios * 256, within 2.2 cents
CRX_CLAMP=0x7ffe00//(2*max(CRX_K))  # top carrier stays at or below the original step ceiling
LEHMER_A=0x19660d
FMP_PROGRAMS=(('sineFMcluster',.333,2),('TriFMcluster',.07,4))
# Partial RMS sqrt(4/45) of x^2-1/3 against the original triangle's 1/sqrt(3) and the
# final 0.8 gives x0.465 / x1.55; rounded to powers of two (shift after the /16 sum).
PRX_SHIFT={'PrimeCluster':3,'PrimeCnoise':5}


def fm_group_tables():
    t={}
    t['fmx']=[min(Q-1,round(2**(i/256)*Q/512)) for i in range(-2048,2049)]
    # [carrier-0 step, modulator step] per X value (pitch applied in render).
    t['crx_rates']=[v for k in range(128) for v in
        (round((40+(k/127)**2*8000)*(1<<24)/44100), round((40+(k/127)**2*8000)*2.7*(1<<24)/44100))]
    t['crx_dq']=[round(8192*k/127) for k in range(128)]
    t['fmp_dq']=[round(8192*(.1+.9*k/127)) for k in range(128)]
    for name,ratio,_ in FMP_PROGRAMS:
        t['fmp_rates_'+name]=[v for k in range(128) for v in
            (round((300+(k/127)**2*8000)*(1<<24)/44100), round((300+(k/127)**2*8000)*ratio*(1<<24)/44100))]
    t['crx_k']=list(CRX_K)+[CRX_CLAMP]
    for name,law in (('PrimeCluster',lambda x:.5+10*x),('PrimeCnoise',lambda x:.5+12*x*x)):
        t['prx_u_'+name]=[round(law(k/127)*(1<<32)/44100) for k in range(128)]
    t['prx_dq']=[round(2048*.2*k/127) for k in range(128)]
    t['prx_primes']=list(FMX_PRIMES)
    t['prx_const']=[q(1/3),LEHMER_A]   # DC of sixteen x^2 waves /16, noise multiplier
    t['arx_rates']=[v for k in range(128) for v in
        (round((10+10000*(k/127)**2)*(1<<24)/44100), round((100+500*(k/127)**2)*(1<<24)/44100))]
    # Pairs (value, random weight) centred on phase 0 so a signed phase indexes directly.
    shape=json.loads(Path(__file__).with_name('array-waveform.json').read_text())['values']
    assert len(shape)==256
    pairs=[(0, Q//2 if v=='test' else -Q//2) if isinstance(v,str) else (v*256,0) for v in shape]
    t['arx_shape']=[w for i in range(257) for w in pairs[(i-128)&255]]
    return t


def knob_index(control, table, scale=0):
    """r0 = table + knob*(2**scale); fractional knob bits stay in a0 and are ignored."""
    return f'''    move y:(r6+${control:x}),a
    asr #16,a,a
'''+(f'    lsl #{scale},a\n' if scale else '')+f'''    add #>{table},a
    move a1,r0
'''


def cr_cluster2():
    # One parabolic-sine modulator (r1), exponential FM, six parabolic-sine carriers at
    # k_i/256 multiples of one common phase (X/Y$20). X$21 depth, Y$22 step, X$22 clamp.
    return 'crCluster2:\n'+knob_index(2,'crx_rates',1)+'''    move y:(r6+$d),y0
    move y:(r0)+,x0
    mpy x0,y0,a  y:(r0)+,x1
    asl #2,a,a
    move a,y:(r6+$22)
    mpy x1,y0,a
    asl #2,a,a
    move #>$7ffe00,x1
    cmp x1,a
    tgt x1,a
    move a,n1
'''+lookup(3,'crx_dq','x0')+'''    move #>crx_k,r4
    move x0,x:(r6+$21)
    move #>crx_k+6,r0
    move #$20,n5
    move y:(r0),x0
    move x0,x:(r6+$22)
    move r6,r5
    move #>fmx+2048,r2
    move (r5)+n5
    move #>-5,n4
    move r5,r3
    move y:(r6+$30),r1
    move (r3)+
    do #32,crx_end
    move r1,b
    abs b  b1,x1
    tfr x1,b  b,y1
    mac -x1,y1,b  (r1)+n1
    move x:(r3)+,x0  b,y1
    mpy x0,y1,b  y:(r3),y1
    move b1,n2
    move l:(r5),a
    move y:(r2+n2),x1
    mpy x1,y1,b  x:(r3)-,y1
    cmp y1,b
    tgt y1,b
    add b,a
    move a10,l:(r5)
    move a1,x0
    clr a  y:(r4)+,y0
    mpy x0,y0,b  y:(r4)+,y0
    move b0,b
    abs b  b1,x1
    add x1,a  b,y1
'''+''.join(f'''    mpy x0,y0,b{"  y:(r4)+,y0" if i<4 else "  y:(r4)+n4,y0" if i==4 else ""}
    mac -x1,y1,a  b0,b
    abs b  b1,x1
    add x1,a  b,y1
''' for i in range(1,6))+'''    mac -x1,y1,a
    move a,y:(r7)+
crx_end:
    move r1,y:(r6+$30)
    jmp output
'''


def fm_clusters():
    # crCluster2 is a common-modulator program (cr_cluster2). sineFM/TriFM keep six
    # independent parabolic-sine-modulated exponential FM pairs with triangle carriers.
    # The original modulator rates are ratio_i * rate_0, so modulator phases are k_i/256
    # multiples of one 48-bit phase (X/Y+$28, increment X/Y+$29). Modulators and FM
    # factors run once every H samples (sineFM 2, TriFM 4); carriers advance every sample.
    # Odd carriers are subtracted, so the six triangles (2|p|-1) need no DC term.
    # X+0..11 (depth, carrier base step) pairs, X+16..21 current steps, Y+$20..$25
    # carrier phases; modulator multipliers k_i come straight from crx_k.
    result=cr_cluster2()
    for name,_,hold in FMP_PROGRAMS:
        tag=name[:3].lower()
        voice='''    mpy x0,y0,b
    move b0,b
    abs b  b1,x1
    tfr x1,b  b,y1
    mac -x1,y1,b
    move x:(r0)+,x1  b,y1
    mpy x1,y1,b  x:(r0)+,y0
    move b1,n2
    nop
    move y:(r2+n2),x1
    mpy x1,y0,b  y:(r5)+,y0
    asl #9,b,b
    move b,x1  y:(r4),b
    add x1,b  x1,x:(r3)+
    move b1,b
    abs b  b1,y:(r4)+
'''
        result+=name+':\n'+knob_index(2,'fmp_rates_'+name,1)+'''    move y:(r6+$d),y0
    move y:(r0)+,x0
    mpy x0,y0,a  y:(r0),x0
    asl #2,a,a
    move a,y1
    mpy x0,y0,a
    asl #2,a,a
    move #>$7ffe00,x0
    cmp x0,a
    tgt x0,a
    move a,x0
'''+f'''    move #$29,n1
    move r6,r1
    move #>{hold<<14},y0
    mpy x0,y0,b
    move (r1)+n1
    move b10,l:(r1)-
    move y1,x0
'''+lookup(3,'fmp_dq','x1')+f'''    move #>$7ffe00,y1
    move #>pw_ratios,r4
    move r6,r0
    do #6,{tag}_u_end
    move y:(r4)+,y0
    mpy x0,y0,a  x1,x:(r0)+
    asl #2,a,a
    cmp y1,a
    tgt y1,a
    move a,x:(r0)+
{tag}_u_end:
    move #$10,n3
    move r6,r3
    move #$20,n4
    move r6,r4
    move (r3)+n3
    move r6,r0
    move (r4)+n4
    move #>fmx+2048,r2
    move #>crx_k,r5
    move #>-12,n0
    move #>-6,n3
    move n3,n4
    move #>-7,n5
    clr a
    do #{32//hold},{tag}_end
    move l:(r1)+,b
    move l:(r1)-,x
    add x,b  y:(r5)+,y0
    move b10,l:(r1)
    move b1,x0
    do #3,{tag}_a_end
'''+voice+'    add b,a\n'+voice+f'''    sub b,a
{tag}_a_end:
    asr a  (r0)+n0
    clr a  a,y:(r7)+
    move (r3)+n3
    move (r4)+n4
    move (r5)+n5
'''
        if hold>2: result+=f'    do #{hold-1},{tag}_b_end\n'
        result+='    move x:(r3)+,x1  y:(r4),b\n'
        for i in range(6):
            result+=f'''    add x1,b{"  x:(r3)+,x1" if i<5 else ""}
    move b1,b
    abs b  b1,y:(r4)+
    {"sub" if i&1 else "add"} b,a{"  y:(r4),b" if i<5 else "  (r4)+n4"}
'''
        result+=f'''    asr a  (r3)+n3
    clr a  a,y:(r7)+
'''
        # The DSP56300 leaves only the inner loop when nested DO loops share their last
        # instruction: the outer loop then falls through with its LA/LC still stacked.
        if hold>2: result+=f'{tag}_b_end:\n    nop\n'
        result+=f'''{tag}_end:
    jmp output
'''
    return result


def prime_clusters():
    # Sixteen prime partials share one white-noise exponential FM factor, so partial i's
    # phase is prime_i * (one 48-bit phase, X/Y$20).  Each partial is a squared-phase
    # (parabolic) wave, two instructions; a 24-bit Lehmer generator (Y$1f) supplies the
    # noise. X$21 frequency unit, Y$21 depth, Y$22 DC, Y$23 noise multiplier.
    result=''
    for name in ('PrimeCluster','PrimeCnoise'):
        tag=name[5:].lower()
        result+=name+':\n'+lookup(3,'prx_dq','x0')+'''    move #>prx_const,r1
    move x0,y:(r6+$21)
    move y:(r1)+,x0
    move x0,y:(r6+$22)
    move y:(r1),y1
    move y1,y:(r6+$23)
'''+knob_index(2,'prx_u_'+name)+f'''    move y:(r6+$d),y0
    move y:(r0),x0
    mpy x0,y0,a
    asl #2,a,a
    move a,x:(r6+$21)
    ; A zero common phase (mode reset) would start all sixteen x^2 waves coherently at 0.
    move x:(r6+$20),a
    move y:(r6+$20),x0
    or x0,a
    jne {tag}_started
    move #>$2c1a5b,x0
    move x0,x:(r6+$20)
{tag}_started:
    move r6,r1
    move #$21,n1
    move y:(r6+$1f),r3
    move #>prx_primes,r0
    move (r1)+n1
    move #>-15,n0
    move r1,r5
    move r1,r4
    move #>fmx+2048,r2
    move (r4)-
    move #>-2,n5
    do #32,{tag}_end
    move r3,x0
    mpy x0,y1,b
    asr b  x:(r1),x1  y:(r5)+,y1
    move b0,x0
    mpy x0,y1,b  b0,r3
    move b1,n2
    move l:(r4),a
    move y:(r2+n2),x0
    mpy x1,x0,b  y:(r0)+,y0
    add b,a
    move a10,l:(r4)
    move a1,x1
    mpy x1,y0,b  y:(r0)+,y0
    clr a  b0,x0
'''+''.join(f'''    mpy x1,y0,b{"  y:(r0)+,y0" if i<14 else "  y:(r0)+n0,y0" if i==14 else ""}
    mac x0,x0,a  b0,x0
''' for i in range(1,16))+f'''    mac x0,x0,a  y:(r5)+,y1
    asr #4,a,a
    sub y1,a  y:(r5)+n5,y1
    asl #{PRX_SHIFT[name]},a,a
    move a,y:(r7)+
{tag}_end:
    move r3,y:(r6+$1f)
    jmp output
'''
    return result


def phasing_cluster():
    """16 squares, each slowly detuned by its own triangle LFO (0.1-17 Hz, +/-0.04 octave).

    The LFOs and their (linearised) exponential detune run once per 32-sample block. Per sample
    each carrier is three instructions: add its step, store the wrapped phase while LSL moves the
    phase sign into carry, and ROL shifts that sign into B while the next carrier's step and phase
    load in parallel. Two bytes of eight signs index a table of +/-0.1 sums; the saturating store
    clips their total exactly as the original 0.1-per-square mixer does.
    """
    result='phasingCluster:\n'+lookup(2,'phasing_base','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move a,x0
    move r6,r1
    move r6,r2
    move #>48,n2
    move (r2)+n2
    move #>phasing_mod32,r3
'''+lookup(3,'phasing_spread','y0')+f'''    move #>${q(PHASING_K2):x},y1
    do #16,phasing_setup_end
    ; LFO triangle at the block start, then advance it by 32 samples.
    move y:(r2),a
    move y:(r3)+,x1
    add x1,a  a,b
    move a1,y:(r2)+
    abs b
    sub #>$400000,b
    move b,x1
    mpy x1,y1,b
    move b,x1
    move x0,b
    mac x0,x1,b
    move b,x:(r1)+
    mpy x0,y0,a
    asl a
    move #>$7ffe00,x1
    cmp x1,a
    tgt x1,a
    move a,x0
phasing_setup_end:
    move r6,r0
    move r6,r4
    move #>32,n4
    move #>16,n0
    move (r4)+n4
    move #>16,n4
    move #>phasing_byte,r5
    move #>phasing_byte,r2
    do #32,phasing_end
    clr b  x:(r0)+,x0  y:(r4),a
'''
    for i in range(16):
        result+='    add x0,a\n    lsl a  a1,y:(r4)+\n'
        result+=('    rol b  x:(r0)+,x0  y:(r4),a\n' if i<15 else '    rol b\n')
        if i==7: result+='    move b1,n5\n    clr b\n'
    result+='''    move b1,n2
    move (r0)-n0
    move (r4)-n4
    move y:(r5+n5),a
    move y:(r2+n2),x0
    add x0,a
    move a,y:(r7)+
phasing_end:
    jmp output
'''
    return result


def basurilla():
    return 'basurilla:\n'+lookup(2,'basurilla_rate','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move a,n3
'''+lookup(3,'basurilla_width','x0')+'''    move x0,n2
    ; The original second/third oscillators have zero magnitude: no audio blocks.
    ; Their offsets do not make them DC sources (Teensy returns before offset).
    do #32,basurilla_end
'''+park_miller_a('basurilla')+'''    move a1,y1
    move y:(r6+$20),a
    move n3,x0
    add x0,a  a1,x1
    move a1,y:(r6+$20)
    move x1,a
    asr a
    and #>$7fffff,a
    move a1,a
    move n2,x0
    cmp x0,a
    move #>0,b
    jge basurilla_gate_done
    move y1,x0
    move #>$7fffff,y0
    mpy x0,y0,b
basurilla_gate_done:
    move b,y:(r7)+
basurilla_end:
    jmp output
'''


def array_rocks():
    # FM group: parabolic-sine modulator, direct 2^x lookup, phases in r1/r3 and the
    # carrier step applied one sample later (in n3, saved in Y$24).
    # Y$21 depth, $22 carrier step, $23 per-track random; Y$20/$30 phases.
    return 'arrayOnTheRocks:\n'+knob_index(2,'arx_rates',1)+'''    move y:(r6+$d),y0
    move y:(r0)+,x0
    mpy x0,y0,a  y:(r0)+,x1
    asl #2,a,a
    move #>$7ffe00,x0
    cmp x0,a
    tgt x0,a
    move a,y:(r6+$22)
    mpy x1,y0,a
    asl #2,a,a
    move a,n1
'''+lookup(3,'crx_dq','x0')+'''    move y:(r6+$16),x1
    move x1,y:(r6+$23)
    move x0,y:(r6+$21)
    move r6,r5
    move #$21,n5
    move y:(r6+$30),r1
    move y:(r6+$20),r3
    move (r5)+n5
    move y:(r6+$24),n3
    move #>fmx+2048,r2
    move #>-2,n5
    do #32,array_end
    move r1,x1
    tfr x1,b  (r1)+n1
    abs b  y:(r5)+,x0
    tfr x1,b  b,y1
    mac -x1,y1,b  (r3)+n3
    move b,x1
    mpy x1,x0,b  y:(r5)+,y0
    move b1,n2
    move r3,a
    move y:(r2+n2),x1
    mpy x1,y0,b  y:(r5)+n5,x0
    asl #9,b,b
    move b,n3
    asr #16,a,b
    lsl #1,b
    add #>arx_shape+256,b
    move b1,r0
    lsl #8,a
    lsr #1,a
    move a1,y1
    move y:(r0)+,a
    move y:(r0)+,y0
    mac x0,y0,a  y:(r0)+,b
    mac x0,y0,a  y:(r0),y0
    mac x0,y0,b
    mac x0,y0,b  a,x0
    mac -x0,y1,a  b,x1
    mac x1,y1,a
    move a,y:(r7)+
array_end:
    move r1,y:(r6+$30)
    move r3,y:(r6+$20)
    move n3,y:(r6+$24)
    jmp output
'''


def filt_short(asm):
    """Group filt: numeric 2-word immediates that fit the 1-word forms (8-bit to an
    address/offset register, 6-bit add/sub/cmp, both right-aligned)."""
    import re
    def value(text): return int(text[1:],16) if text.startswith('$') else int(text)
    out=[]
    for line in asm.split('\n'):
        m=re.fullmatch(r'(\s+)move #>(\$[0-9a-fA-F]+|\d+),([rn][0-5])',line)
        if m and value(m[2])<=255: line=f'{m[1]}move #{value(m[2])},{m[3]}'
        m=re.fullmatch(r'(\s+)(add|sub|cmp) #>(\$[0-9a-fA-F]+|\d+),([ab])',line)
        if m and value(m[3])<=63: line=f'{m[1]}{m[2]} #{value(m[3])},{m[4]}'
        out.append(line)
    return '\n'.join(out)


def filt_shortened(generator):
    return lambda *args: filt_short(generator(*args))


FILT_EDGE_LIMIT=32<<12   # edge times are 1/4096 sample from the block start


def filt_edges(tag, count, weighted):
    """Event-driven PWM for `count` voices: high duration x:(r2)+, low y:(r4)+, next-edge
    time y:(r0)+ (1/4096 sample from the block start, one's-complemented while high).
    Rises add the voice weight into the X difference buffer, falls subtract it. x0 holds
    the block length. Unweighted: weight 1, y0 = buffer address. Weighted: weights y:(r3)+
    into y0, buffer at r5 (indexed through n5)."""
    def emit(step, op):
        if weighted:
            return f'''    asr #12,a,b
    move b1,n5
    add {step},a
    move x:(r5+n5),b
    {op} y0,b
    move b,x:(r5+n5)
'''
        return f'''    asr #12,a,b
    add y0,b
    move b1,r5
    add {step},a
    move x:(r5),b
    {op} #1,b
    move b,x:(r5)
'''
    return f'''    do #{count},{tag}_edges_end
    move x:(r2)+,x1  y:(r4)+,y1
'''+('    move y:(r3)+,y0\n' if weighted else '')+f'''    move y:(r0),a
    tst a
    jge {tag}_rise
    not a
    move a1,a
{tag}_fall:
    cmp x0,a
    jge {tag}_exit_fall
'''+emit('y1','sub')+f'''{tag}_rise:
    cmp x0,a
    jge {tag}_exit_rise
'''+emit('x1','add')+f'''    jmp {tag}_fall
{tag}_exit_fall:
    sub x0,a
    not a
    jmp {tag}_store
{tag}_exit_rise:
    sub x0,a
{tag}_store:
    move a1,y:(r0)+
    nop
{tag}_edges_end:
'''


def filt_period_tail():
    """A1 = walk position (negative -> 0) -> period (1/4096 sample) at x:(r2)+, pitch
    inverse at Y+$11."""
    return '''    move #0,x0
    cmp x0,a
    tlt x0,a
    add #>filt_period,a
    move a1,r5
    move y:(r6+$11),y0
    move y:(r5),x0
    mpy x0,y0,a
    asl #2,a,a
    move a,x:(r2)+
'''


def filt_duration_tail():
    """A1 = walk position -> PWM half durations: high = period*duty at x:(r2)+, low = the
    rest at y:(r4)+ (1/4096 sample). Pitch inverse at Y+$11, duty at Y+$12."""
    return filt_period_tail().replace('    move a,x:(r2)+\n','')+'''    move a,x0
    move y:(r6+$12),y0
    mpy x0,y0,b
    move b,x1
    tfr x0,a
    sub x1,a
    move x1,x:(r2)+
    move a,y:(r4)+
'''


@filt_shortened
def walking_filomena():
    # Sixteen walking PWM squares, event-driven: each block schedules every edge into
    # a 32-word difference buffer, so the per-sample work is one integrator, a majority
    # vote (more than eight high -> +1, fewer -> -1, a tie -> 0) and the SMTH slew.
    # Four voices walk per block (+/-20 Hz steps, about the old per-block +/-10 diffusion);
    # their high/low durations (duty, pitch) refresh with the walk, i.e. within 4 blocks.
    # X+0 high, X+16 positions, X+32 edge buffer; Y+$20 next edge, Y+$30 low.
    return 'WalkingFilomena:\n'+lookup(4,'pitch_inverse','x0')+'''    move x0,y:(r6+$11)
'''+lookup(3,'walk_width','x0')+'''    move x0,y:(r6+$12)
'''+lookup(2,'walk_bound','y1')+'''    ; First block after a reset: every duration from the initial positions.
    move y:(r6+$1b),a
    tst a
    jne walk_ready
    move r6,r2
    move #>16,n1
    move r6,r4
    move #>$30,n4
    move r6,r1
    move (r4)+n4
    move (r1)+n1
    do #16,walk_init_end
    move x:(r1)+,a
'''+filt_duration_tail()+'''walk_init_end:
    move r1,y:(r6+$1b)
walk_ready:
    move y:(r6+$1c),b
    tfr b,a
    add #1,a
    and #>3,a
    move a1,y:(r6+$1c)
    asl #2,b,b
    move b1,n2
    move r6,r2
    move #>16,n1
    move (r2)+n2
    move r2,r1
    move #>$30,n4
    move r2,r4
    move (r1)+n1
    move (r4)+n4
    do #4,walk_walk_end
'''+filt_walk_body('walk',20,100,'y1')+filt_duration_tail()+'''walk_walk_end:
    move r6,r2
    move #>$30,n4
    move r6,r4
    move r6,r0
    move #>$20,n0
    move r6,a
    add #>32,a
    move (r4)+n4
    move a1,y0
    move (r0)+n0
    move #>'''+str(FILT_EDGE_LIMIT)+''',x0
'''+filt_edges('walk',16,False)+lookup(5,'sh_slew','y1')+'''    move r6,r1
    move #>32,n1
    move y:(r6+$13),a
    move (r1)+n1
    sub #8,a
    move y:(r6+$14),b
    move r7,r5
    move x:(r1)+,x0
    do #32,walk_end
    add x0,a  x:(r1)+,x0  b,y:(r5)+
    tfr a,b  b,y0
    asl #23,b,b
    move b,x1
    mpy x1,y1,b
    mac -y0,y1,b
    add y0,b
walk_end:
    add #8,a
    move a1,y:(r6+$13)
    move b,y:(r6+$14)
    move r6,r1
    clr a
    move (r1)+n1
    rep #32
    move a,x:(r1)+
    ; SMTH is a useful replacement for redundant drive on a full-level pulse mix.
    move #>$80000,x0
    move x0,y:(r6+$e)
    jmp output
'''


FILT_EP_MULT=314573         # = 5 mod 8 for a full 2^22 MCG period; /2^23 = 0.0375 noise scale.
FILT_SVF_K=q(2*math.pi*1000/44100/2)   # f/2 per octave-zero, single 44.1 kHz pass.
FILT_SVF_FMAX=q(.8)          # f <= 1.6 keeps the q=1/4 Chamberlin recurrence stable.


@filt_shortened
def filter_programs():
    # Four swept Chamberlin band-passes on a S&H-noise or 10% pulse source.
    # One pass per sample (f stored halved, band state doubled), coefficients
    # computed once per block from the LFO and ramped linearly across it.
    result=''
    for name in ('existencelsPain','whoKnows'):
        result+=name+':\n'+lookup(2,name+'_rate','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$3fff00,x1
    cmp x1,a
    tgt x1,a
    asl a
    move a,y:(r6+$17)
'''+lookup(3,name+'_depth','x0')+f'''    move x0,y:(r6+$11)
    move #>{name}_lfo,x0
    move x0,y:(r6+$12)
'''
        if name=='existencelsPain':
            result+=f'''    ; 32 noise words (MCG, high product word = 0.05 x previous seed); zero the mix.
    move y:(r6+$1f),x1
    move #>{FILT_EP_MULT},y1
    move r6,r4
    move #>$20,n4
    move #0,x0
    move r7,r5
    move (r4)+n4
    do #32,ep_noise_end
    mpy x1,y1,a  x0,y:(r5)+
    asr a  a,y:(r4)+
    move a0,x1
ep_noise_end:
    move x1,y:(r6+$1f)
    ; Sample/hold: the 24-bit phase wraps at +1 (E set), latching that sample's noise.
    move y:(r6+$17),x0
    move y:(r6+$13),a
    move y:(r6+$14),b
    move r6,r1
    move #>$1f,n1
    move (r4)-n4
    move (r1)+n1
    do #32,ep_hold_end
    add x0,a  b,x:(r1)+  y:(r4)+,y1
    tes y1,b
    move a1,a
ep_hold_end:
    move b,x:(r1)+
    move a,y:(r6+$13)
    move b,y:(r6+$14)
    jmp filter_voices
'''
        else:
            result+=f'''    ; 10% pulse (phase domain -1..1, high below -0.8); DC is irrelevant to band-passes.
    move y:(r6+$17),x0
    move #>${q(-.8)&0xffffff:x},y0
    move #>${q(.075):x},x1
    move #0,y1
    move r6,r1
    move #>$1f,n1
    move y:(r6+$13),a
    move r7,r5
    move (r1)+n1
    do #32,wk_pulse_end
    add x0,a  b,x:(r1)+  y1,y:(r5)+
    clr b  a1,a
    cmp y0,a
    tlt x1,b
wk_pulse_end:
    move b,x:(r1)+
    move a,y:(r6+$13)
'''
    result+=f'''filter_voices:
    ; X+4k: low, band, f/2, LFO phase; X+$20 source; Y+$20 per-voice f/2 ramp.
    move r6,r1
    move #>$20,n1
    move r6,r3
    move (r1)+n1
    move #>4,n3
    move y:(r6+$12),r2
    move r1,n1
    move r7,n5
    do #4,fv_end
    move x:(r3+$3),a
    move y:(r2)+,b
    asl #5,b,b
    add b,a
    move a1,x:(r3+$3)
    move a1,b
    tfr b,a
    abs a
    move #>$400000,x0
    sub x0,a
    abs a
    neg a
    add x0,a
    move a,x1
    neg a
    tst b
    tge x1,a
    move a,x0
    move y:(r6+$11),y0
    mpy x0,y0,a
    asl a
    ; v = triangle*depth, 8 octaves full scale: the shared 2^x table (fmx, F/512, 1/256
    ; octave) at v>>12, times K, x512.
    asr #12,a,a
    add #>fmx+2048,a
    move a1,r5
    move #>{FILT_SVF_K},y0
    move y:(r5),x0
    mpy x0,y0,a
    asl #9,a,a
    move #>{FILT_SVF_FMAX},x0
    cmp x0,a
    tgt x0,a
    move x:(r3+$2),x0
    sub x0,a
    asr #5,a,a
    move a,x1
    tfr x0,a
    move n1,r4
    rep #32
    add x1,a  a,y:(r4)+
    move a,x:(r3+$2)
    move n1,r4
    move n1,r1
    move n5,r5
    move x:(r3+$1),x0
    move x:(r3),a
    move y:(r4)+,y0
'''
    body='''    tfr x1,b{store}
    sub a,b  y:(r5),y1
    asl #2,b,b
    mac -x0,#1,b
    tfr x0,b  b,x1
    mac x1,y0,b
    add y1,b  b,x0  y:(r4)+,y0
'''
    result+='    mac x0,y0,a  x:(r1)+,x1\n'+body.format(store='')
    result+='    do #31,fv_sample_end\n    mac x0,y0,a  x:(r1)+,x1\n'+body.format(store='  b,y:(r5)+')
    result+='''fv_sample_end:
    move b,y:(r5)+
    move a,x:(r3)
    move x0,x:(r3+$1)
    move (r3)+n3
fv_end:
    ; Band states carry 2x the input scale: x8 restores the original band*16.
    move n5,r4
    move n5,r5
    do #32,fv_scale_end
    move y:(r4)+,a
    asl #3,a,a
    move a,y:(r5)+
fv_scale_end:
    jmp output
'''
    return result


def pi_prepare():
    return '''pi_prepare:
    ; Track-private P-I allocation; clear only 512 words on each muted call.
    move #>md_track,r0
    nop
    move y:(r0),a
    and #>15,a
    move a1,a
    move a,b
    asl a
    add b,a
    asl #9,a,a
    add #>pi_ws,a
    move a1,x:(r6+$3e)
    move x:(r6+$3f),b
    cmp #>1536,b
    jge pi_ready
    add b,a
    move a1,r0
    move #>0,x0
    do #512,pi_clear_end
    move x0,y:(r0)+
pi_clear_end:
    add #>512,b
    move b1,x:(r6+$3f)
    clr a
    rts
pi_ready:
    move #>1,a
    rts
'''


def feedback_oscillator(tag, index, input_code, shape, depth_code='', delayed=False, linear=False):
    phase=f'y:(r6+${32+index:x})'; step=f'x:(r6+${index:x})'
    result=''
    if linear:
        # Linear-FM sine emits the old phase, then advances it, unlike exponential FM.
        result+=input_code+f'''    move a,x0
    move {step},y0
    mpy x0,y0,a
    add y0,a
    move a1,x0
    move {phase},a
    add x0,a  a1,x1
    move a1,{phase}
    move x1,a
'''
    elif input_code:
        if delayed:
            result+=f'''    move y:(r6+$15),a
    tst a
    jeq {tag}_unconnected
'''
        result+=depth_code+input_code+fm_scale(tag,double_depth=True)+f'''    move {step},x0
    move y:(r6+$13),y0
    move y:(r6+$12),x1
    mpy x0,y0,a
    ; Bound before shifting: deep FM must not overflow the accumulator.
    move #>$7ffe00,b
    asr x1,b,b
    cmp b,a
    jgt {tag}_clamp
    asl x1,a,a
    jmp {tag}_step
{tag}_clamp:
    move #>$7ffe00,a
{tag}_step:
    move {phase},x0
    add x0,a
    move a1,{phase}
    move a1,a
'''
        if delayed:
            result+=f'''    jmp {tag}_wave
{tag}_unconnected:
    move {phase},a
    move {step},x0
    add x0,a  a1,x1
    move a1,{phase}
    move x1,a
{tag}_wave:
'''
    else:
        result+=f'''    move {phase},a
    move {step},x0
    add x0,a  a1,x1
    move a1,{phase}
    move x1,a
'''
    if shape=='sine': result+=sine_a()
    elif shape=='saw_offset':
        result+=f'''    move a1,x0
    move #>${q(.8):x},y0
    mpy x0,y0,a
    add #>$7fffff,a
'''
    elif shape in ('pulse','atari_pulse'):
        result+='''    asr a
    and #>$7fffff,a
    move a1,a
'''
        if shape=='pulse': result+='    move y:(r6+$17),b\n'
        else:
            result+='''    move x:(r6+$10),b
    asr b
    add #>$400000,b
'''
        amp=q(.8) if shape=='pulse' else Q-1
        result+=f'''    cmp b,a
    move #>${(-amp)&0xffffff:x},a
    move #>${amp:x},y0
    tlt y0,a
'''
    else:
        amp=Q-1 if shape=='square_offset' else q(.8)
        result+=f'''    tst a
    move #>${amp:x},a
    jge {tag}_square_positive
    neg a
{tag}_square_positive:
'''
        if shape=='square_offset': result+='    add #>$7fffff,a\n'
    return result+f'    move a,x:(r6+${16+index:x})\n'


def feedback_programs():
    # Group fb rewrite below; feedback_oscillator remains for reference.
    return ''.join(FB_PROGRAMS[name]() for name in ('xModRingSqr','XModRingSine','CrossModRing','Atari','radioOhNo'))


# ---- Feedback graphs, cold-cache rewrite (group fb) -------------------------
# The 128-sample ring delay always starts a block at a multiple of 32, so the
# ring pointer, the 'valid' flag and every knob-derived step are per block.
# Square/pulse modulators take only two values, so their exponential-FM steps
# are two per-block constants: the loop adds base + (sign ? delta : 0).
FB_A=round(.8*Q)


def fb_mantissa(i):
    n=((i<<15)+134217728)<<3
    n=(n*n+(1<<31))>>32
    n=(((n*715827883+(1<<31))>>32)<<3)+715827882
    return n>>8


def fb_fm(inp, depth):
    """Original exp2 factor for a constant modulator: (mantissa, left shift)."""
    m=(inp*depth*2)>>31
    e=(m>>12)+1; mantissa=fb_mantissa(m&4095)
    if e<0: mantissa>>=-e; e=0
    return mantissa,e


def fb_step(control, table):
    # a = min(x1, rate[knob]*pitch); x1 holds the ceiling.
    return lookup(control,table,'x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    cmp x1,a
    tgt x1,a
'''


def fb_fm_const(mantissa, shift):
    # a = min(x1, (x0*mantissa)<<shift); shift<=7 cannot overflow A.
    assert shift<=7
    s=f'    move #>${mantissa:x},y0\n    mpy x0,y0,a\n'
    if shift: s+=f'    asl #{shift},a,a\n'
    return s+'    cmp x1,a\n    tgt x1,a\n'


def fb_ring_pointer():
    return '''    move x:(r6+$3e),a
    move y:(r6+$14),b
    add b,a
    move a1,r3
'''


def fb_advance(tag):
    # pos += 32 (mod 128); the ring holds a full delay once pos wraps to zero.
    return '''    move y:(r6+$14),a
    add #>32,a
    and #>127,a
    move a1,y:(r6+$14)
    move y:(r6+$15),b
    move #>1,x0
    teq x0,b
    move b1,y:(r6+$15)
    jmp output
'''


def fb_xmodringsqr():
    # Node 1 <- ring(node 0), node 0 <- node 1, both +/-0.8 squares, 1-octave depth.
    # Out = sq0*sq1 = P or ~P. Before the ring is valid node 1 is unmodulated and
    # emits its old phase: the loop runs on phase-step and the block restores it.
    pos,neg=fb_fm(FB_A,round(Q/16)),fb_fm(-FB_A,round(Q/16))
    product=(FB_A*FB_A)>>23
    return '''xModRingSqr:
    jsr pi_prepare
    tst a
    jeq silence
    move #>$7ffe00,x1
'''+fb_step(2,'xModRingSqr_rate0')+'''    move a,x0
'''+fb_fm_const(*pos)+'''    move a,n2
'''+fb_fm_const(*neg)+'''    move n2,y1
    sub y1,a
    move a1,n3
'''+fb_step(3,'xModRingSqr_rate1')+'''    move a,x0
'''+fb_fm_const(*pos)+'''    move a,y1
'''+fb_fm_const(*neg)+f'''    sub y1,a
    move y:(r6+$15),b
    tst b
    clr a ifeq
    tfr y1,b
    tfr x0,b ifeq
    move a1,n1
    move b1,y1
    tfr x0,a
    clr a ifne
    move a1,x:(r6+$5)
    move y:(r6+$21),b
    sub a,b
    move b1,x0
    move n2,y0
    move #>${product:x},n4
'''+fb_ring_pointer()+'''    move y:(r6+$20),b
    do #32,xModRingSqr_end
    btst #23,y:(r3)
    tfr x0,a  n1,x1
    add x1,a ifcs
    add y1,a  n3,x1
    btst #23,a1
    add x1,b ifcs
    add y0,b  a1,x0
    tfr b,a  b1,y:(r3)+
    eor x0,a  n4,x1
    tfr x1,a
    not a ifmi
    move a1,y:(r7)+
xModRingSqr_end:
    move b1,y:(r6+$20)
    move x:(r6+$5),b
    add x0,b
    move b1,y:(r6+$21)
'''+fb_advance('xModRingSqr')


def fb_fm_row(control, table):
    # r0 -> four words (mantissa+, shift+, mantissa-, shift-) for this knob.
    return f'''    move y:(r6+${control:x}),a
    asr #16,a,a
    move a1,a
    asl #2,a,a
    add #>{table},a
    move a1,r0
    nop
'''


def fb_fm_var():
    # a = min(x1, (x0*y0)<<y1), clamped before the shift (exponents reach 12).
    return '''    mpy x0,y0,a
    move x1,b
    asr y1,b,b
    cmp b,a
    tgt b,a
    asl y1,a,a
'''


def fb_atari():
    # Node 0 (0/1 square) <- ring(node 1), depth from Y; node 1 (+/-1 pulse, free)
    # has width (Q+sq0)/2: below Q, or below $fffffe while sq0 is high.
    # Node 1 phase is biased by Q so both widths are one signed compare.
    # The ring keeps sat(p1'-T): its sign bit is set while node 1 is high.
    # Out = one-pole slew of node 1; drive is fixed (DRIV is SMTH).
    return '''Atari:
    jsr pi_prepare
    tst a
    jeq silence
    move #>$7ffe00,x1
'''+fb_step(2,'Atari_rate0')+'''    move a,x0
'''+fb_fm_row(3,'fb_atari_fm')+'''    move y:(r0)+,y0
    move y:(r0)+,y1
'''+fb_fm_var()+'''    move a,n3
    move y:(r0)+,y0
    move y:(r0)+,y1
'''+fb_fm_var()+'''    move n3,b
    sub a,b
    move b1,y1
    move y:(r6+$15),b
    tst b
    tfr x0,a ifeq
    move a1,n2
    tfr y1,a
    clr a ifeq
    move a1,n3
    tfr x0,a
    clr a ifne
    move a1,x:(r6+$5)
    move y:(r6+$20),b
    sub a,b
    move b1,n0
'''+fb_step(3,'Atari_rate1')+'''    move a1,n4
'''+lookup(5,'sh_slew','y0')+'''    move #>$80000,x0
    move x0,y:(r6+$e)
    move #>$800000,x0
    move y:(r6+$21),a
    eor x0,a
    move a1,n1
    move #>$7ffffe,n5
    move #>$7fffff,x0
    move y:(r6+$1d),x1
'''+fb_ring_pointer()+'''    move n0,a
    move n3,y1
    do #32,Atari_end
    btst #23,y:(r3)
    add y1,a ifcs
    move n2,y1
    add y1,a  n5,y1
    move n1,b
    btst #23,a1
    sub y1,b ifcc
    mpy x0,y0,a  a1,n0
    tst b  b,y:(r3)+
    neg a ifpl
    mac -x1,y0,a  n1,b
    add x1,a  n4,y1
    add y1,b  a,x1
    move a,y:(r7)+
    move b1,n1
    move n0,a
    move n3,y1
Atari_end:
    move x1,y:(r6+$1d)
    move #>$800000,x0
    move n1,a
    eor x0,a
    move a1,y:(r6+$21)
    move x:(r6+$5),b
    move n0,x0
    add x0,b
    move b1,y:(r6+$20)
'''+fb_advance('Atari')


def fb_tables(tables):
    t=fb_radio_tables(tables)|fb_cmr_tables(tables)
    t['fb_sine']=fb_sine_table()
    rows=[]
    for k in range(128):
        depth=tables['Atari_depth'][k]
        for inp in (Q-1,-(Q-1)): rows.extend(fb_fm(inp,depth))
    t['fb_atari_fm']=rows
    return t


def fb_row(control, table, stride_shift):
    # r0 -> table + knob<<stride_shift.
    return f'''    move y:(r6+${control:x}),a
    asr #16,a,a
    move a1,a
    asl #{stride_shift},a,a
    add #>{table},a
    move a1,r0
'''


def fb_plain(base='n1'):
    # Flags gt: the node is delayed and the ring is not yet valid, so it runs
    # unmodulated (base s, delta 0) on phase-s (offset s) to emit its old phase.
    # In: a = other-base, base = base step, x0 = s.
    return f'''    clr a ifgt
    move a,x:(r2)
    move {base},a
    tfr x0,a ifgt
    move a,y:(r2)+
    tfr x0,a
    clr a ifle
    move a,x:(r4)+
'''


def fb_step_table(count, tag):
    # For each node: s=min(cap,rate*pitch), the two FM steps from y:(r1)+
    # (mantissa, shift) pairs and a delayed flag: y:(r2) <- base,
    # x:(r2)+ <- other-base, x:(r4)+ <- phase offset (see fb_plain).
    # Expects r0 rates, r1 FM constants, r2 L table, r4 offsets, n0 pitch,
    # n5 valid, x1 cap.
    return f'''    do #{count},{tag}_setup_end
    move y:(r0)+,x0
    move n0,y0
    mpy x0,y0,a
    asl #2,a,a
    cmp x1,a
    tgt x1,a
    move a,x0
    move y:(r1)+,y0
    move y:(r1)+,y1
'''+fb_fm_var()+'''    move a,n1
    move y:(r1)+,y0
    move y:(r1)+,y1
'''+fb_fm_var()+'''    move n1,y0
    sub y0,a
    move y:(r1)+,b
    move n5,y0
    sub y0,b
'''+fb_plain()+f'''{tag}_setup_end:
'''


def fb_radio():
    # Pairs (1<-ring0, 0<-1) at 5 octaves and (2<-ring1, 3<-2) at 8 octaves of
    # +/-0.8 pulses with width W: low while p>=2W, i.e. biased p'=p^Q >= T=2W-Q.
    # Mixed sat(v0+v2) in {Q-1,0,-Q} is accumulated as -Q[v0 low]+Q[v2 high].
    # L table x:/y:(r6+$28..$2b) = (delta, base) per node in graph order 1,0,2,3.
    phases=''.join(f'''    move y:(r6+${0x20+k:x}),a
    eor x0,a
'''+(f'''    move x:(r6+${0x30+e:x}),y0
    sub y0,a
''' if k in (1,2) else '')+f'''    move a1,n{k}
''' for e,k in enumerate((1,0,2,3)))
    restore=''.join(f'''    move n{k},a
'''+(f'''    move x:(r6+${0x30+e:x}),y0
    add y0,a
''' if k in (1,2) else '')+f'''    eor x0,a
    move a1,y:(r6+${0x20+k:x})
''' for e,k in enumerate((1,0,2,3)))
    return '''radioOhNo:
    jsr pi_prepare
    tst a
    jeq silence
    move #>$7ffe00,x1
'''+fb_row(2,'fb_radio_rates',2)+'''    move #>fb_radio_fm,r1
    move r6,r2
    move #>$28,n2
    move y:(r6+$d),n0
    move (r2)+n2
    move r6,r4
    move #>$30,n4
    move y:(r6+$15),n5
    move (r4)+n4
'''+fb_step_table(4,'radioOhNo')+'''    move #>$800000,x0
'''+phases+lookup(3,'radio_width','a')+'''    asl a
    add x0,a
    move a1,y1
'''+lookup(5,'sh_slew','r2')+'''    move #>$80000,x0
    move x0,y:(r6+$e)
    move y:(r6+$1d),r1
'''+fb_ring_pointer()+'''    add #>128,a
    move a1,r4
    move r6,r5
    move #>$28,n5
    nop
    move (r5)+n5
    nop
    move r5,n5
    move #>$800000,y0
    move l:(r5)+,x
    move n1,b
    clr a
    do #32,radioOhNo_end
    btst #23,y:(r3)
    add x1,b ifcs
    add x0,b  l:(r5)+,x
    move b1,b
    cmp y1,b  b1,n1
    move n0,b
    add x1,b ifge
    add x0,b  l:(r5)+,x
    move b1,b
    sub y1,b  b1,n0
    add y0,a ifpl
    move b,y:(r3)+
    move n2,b
    btst #23,y:(r4)
    add x1,b ifcs
    add x0,b  l:(r5)+,x
    move b1,b
    cmp y1,b  b1,n2
    sub y0,a iflt
    move n3,b
    add x1,b ifge
    add x0,b  n5,r5
    move b1,b
    sub y1,b  b1,n3
    move b,y:(r4)+
    move a,x0
    move r2,x1
    mpy x0,x1,a  r1,x0
    mac -x0,x1,a
    add x0,a  l:(r5)+,x
    move a,y:(r7)+
    clr a  a,r1
    move n1,b
radioOhNo_end:
    move r1,y:(r6+$1d)
    move #>$800000,x0
'''+restore+fb_advance('radioOhNo')


def fb_radio_tables(tables):
    t={}
    t['fb_radio_rates']=[tables[f'radioOhNo_rate{i}'][k] for k in range(128) for i in (1,0,2,3)]
    p5,n5=fb_fm(FB_A,round(5*Q/16)),fb_fm(-FB_A,round(5*Q/16))
    p8,n8=fb_fm(FB_A,round(8*Q/16)),fb_fm(-FB_A,round(8*Q/16))
    t['fb_radio_fm']=[*n5,*p5,1,*p5,*n5,0,*n8,*p8,1,*p8,*n8,0]
    return t


def fb_xmodringsine():
    # Linear FM, both sines read their old phase: v0=sin(p0), v1=sin(p1),
    # p0+=s0+s0*ring>>23, p1+=s1+s1*v0>>23, ring<-v1, out=v0*v1.
    # Both sines read the shared 1,024-point sine (filt_sine1k) at its midpoint, indexed by
    # the signed phase>>14.
    return '''XModRingSine:
    jsr pi_prepare
    tst a
    jeq silence
    move #>$400000,x1
'''+fb_step(2,'XModRingSine_rate0')+'''    move a1,n2
'''+fb_step(3,'XModRingSine_rate1')+'''    move a1,n3
    move y:(r6+$20),x0
    move x0,n0
    move y:(r6+$21),x0
    move x0,n1
    move #>filt_sine1k+512,r5
    move #>filt_sine1k+512,r4
'''+fb_ring_pointer()+'''    move n0,a
    ; The shared sine (filt_sine1k) at its midpoint with the signed phase>>14: both sines are
    ; negated (half a cycle on), which leaves out = v0*v1 and the FM pair's character alone.
    do #32,XModRingSine_end
    asr #14,a,b
    move b1,n5
    move n1,b
    asr #14,b,b
    move b1,n4
    move y:(r5+n5),y1
    move y:(r4+n4),x0
    mpy x0,y1,b  y:(r3),x1
    move x0,y:(r3)+
    move n2,y0
    move n0,a
    mac x1,y0,a  b,y:(r7)+
    add y0,a  n3,y0
    move n1,b
    mac y1,y0,b  a1,n0
    add y0,b  a1,a
    move b1,n1
XModRingSine_end:
    move n0,x0
    move x0,y:(r6+$20)
    move n1,x0
    move x0,y:(r6+$21)
'''+fb_advance('XModRingSine')


def fb_sine_table():
    sine=[round(math.sin(i*2*math.pi/256)*32767)*256 for i in range(257)]
    order=list(range(128,256))+list(range(128))
    deltas=[sine[i+1]-sine[i] for i in order]
    bases=[sine[i]+(i&1)*(sine[i+1]-sine[i]) for i in order]
    return deltas+bases


def fb_cmr():
    # Order 2,0,3,1: node 2 (0.8 saw + 1) <- ring0(node 1), node 0 <- ring1(node 3),
    # node 3 <- node 2 (continuous, exact exp FM per sample), node 1 <- node 0.
    # Rings hold the square phases (sign = low). Out = (sq0*sq1)*(saw2*sq3).
    # L table x:/y:(r6+$28..$2d): (d2,b2) (d0,b0) (A,Q-1) (depth,s3) (d1,b1) (P,A).
    product=(FB_A*FB_A)>>23
    return '''CrossModRing:
    jsr pi_prepare
    tst a
    jeq silence
    move #>$7ffe00,x1
'''+fb_row(2,'fb_cmr_rates',2)+'''    move y:(r6+$d),n0
    move y:(r6+$3),a
    asr #16,a,a
    move a1,a
    asl #2,a,a
    add #>fb_cmr_fm,a
    move a1,n1
    move r6,r4
    move #>$30,n4
    move r6,r2
    move (r4)+n4
    move #>$28,n2
    move y:(r6+$15),n5
    move (r2)+n2
    bsr <cmr_node
    bsr <cmr_node
    move y:(r0)+,x0
    move n0,y0
    mpy x0,y0,a
    asl #2,a,a
    cmp x1,a
    tgt x1,a
    move a,y:(r6+$2b)
    move #>2,n2
    move #>1,n5
    move (r2)+n2
    bsr <cmr_node
'''+lookup(3,'CrossModRing_depth','x0')+f'''    move x0,x:(r6+$2b)
    move #>${FB_A:x},x0
    move x0,x:(r6+$2a)
    move x0,y:(r6+$2d)
    move #>$7fffff,x0
    move x0,y:(r6+$2a)
    move #>${product:x},x0
    move x0,x:(r6+$2d)
    move y:(r6+$22),a
    move x:(r6+$30),y0
    sub y0,a
    move a1,n2
    move y:(r6+$20),a
    move x:(r6+$31),y0
    sub y0,a
    move a1,n0
    move y:(r6+$21),x0
    move x0,r0
    move y:(r6+$23),x0
    move x0,n3
    move #>fmx+1536,r1
'''+fb_ring_pointer()+'''    add #>128,a
    move a1,r4
    move r6,r5
    move #>$28,n5
    nop
    move (r5)+n5
    nop
    move r5,n5
    move n2,b
    move l:(r5)+,x
    move #>$7ffe00,y0
    do #32,CrossModRing_end
    btst #23,y:(r3)
    add x1,b ifcs
    add x0,b  l:(r5)+,x
    move b1,y1
    move n0,a
    btst #23,y:(r4)
    add x1,a ifcs
    add x0,a  l:(r5)+,x
    tfr x0,b  a1,n0
    mac x1,y1,b  y1,n2
    move b,y1
    move l:(r5)+,x
    mpy x1,y1,b
    asr #11,b,a
    move a1,n1
    nop
    move y:(r1+n1),x1
    mpy x0,x1,a
    asl #10,a,a
    asl a  n3,b
    cmp y0,a  l:(r5)+,x
    tgt y0,a
    add a,b
    move b1,y:(r4)+
    btst #23,n0
    move r0,a
    add x1,a ifcs
    add x0,a  b1,n3
    move a1,y:(r3)+
    move l:(r5)+,x
    mpy x0,y1,b  a1,r0
    btst #23,n3
    neg b ifcs
    move b,y1
    move n0,x0
    eor x0,a
    tfr x1,a
    not a ifmi
    move a1,x0
    mpy x0,y1,a  n5,r5
    move a,y:(r7)+
    move l:(r5)+,x
    move n2,b
CrossModRing_end:
    move n2,a
    move x:(r6+$30),y0
    add y0,a
    move a1,y:(r6+$22)
    move n0,a
    move x:(r6+$31),y0
    add y0,a
    move a1,y:(r6+$20)
    move r0,x0
    move x0,y:(r6+$21)
    move n3,x0
    move x0,y:(r6+$23)
'''+fb_advance('CrossModRing')+'''cmr_node:
    ; x0 <- min(cap, rate*pitch) -> x:(r4)+; y:(r2) <- step for a high input,
    ; x:(r2) <- low-input step minus it. r0 rates, n0 pitch, n1 FM row, x1 cap.
    move y:(r0)+,x0
    move n0,y0
    mpy x0,y0,a
    asl #2,a,a
    cmp x1,a
    tgt x1,a
    move a,x0
    move n1,r1
    nop
    move y:(r1)+,y0
    move y:(r1)+,y1
'''+fb_fm_var()+'''    move a,n3
    move y:(r1)+,y0
    move y:(r1)+,y1
'''+fb_fm_var()+'''    move n3,y0
    sub y0,a
    move #>1,b
    move n5,y0
    sub y0,b
'''+fb_plain('n3')+'''    rts
'''


def fb_cmr_tables(tables):
    t={}
    t['fb_cmr_rates']=[tables[f'CrossModRing_rate{i}'][k] for k in range(128) for i in (2,0,3,1)]
    rows=[]
    for k in range(128):
        depth=tables['CrossModRing_depth'][k]
        for inp in (FB_A,-FB_A): rows.extend(fb_fm(inp,depth))
    t['fb_cmr_fm']=rows
    return t


FB_PROGRAMS={'CrossModRing':fb_cmr,'XModRingSine':fb_xmodringsine,'xModRingSqr':fb_xmodringsqr,'Atari':fb_atari,'radioOhNo':fb_radio}


FILT_RESO_MULT=838861       # = 5 mod 8; /2^23 ~ 0.1, so the high word after the shift is noise/20.
FILT_RESO_FMAX=q(.78)


def filt_tables():
    """Tables private to the filt group's programs (resonoise, Rwalk_SineFMFlange)."""
    tables={'filt_sine1k':[q(math.sin(2*math.pi*i/1024)) for i in range(1024)]}
    coefficients=[]
    for j in range(2048):
        v=4*(((j<<13)^0x800000)-0x800000)/Q          # four times the wrapped 24-bit fraction
        w=(v+1)%4-1
        u=w if w<=1 else 2-w                          # triangle fold, period 4
        coefficients.append(min(FILT_RESO_FMAX,q(math.pi*1000/44100*2**(5*u))))
    tables['reso_coef']=coefficients
    tables['filt_period']=[min(0x7fffff,round(44100*4096/max(pos,25))) for pos in range(2048)]
    tables['filt_walk_delta']=[1]*16
    tables['filt_bit_weights']=[q(w) for w in FILT_BIT_WEIGHTS]
    tables['filt_flange_car']=[round((10+500*k/127+offset)*(1<<24)/44100) for k in range(128) for offset in (0,55,75,65)]
    return tables


@filt_shortened
def resonoise():
    # Square -> 100% linear-FM sine -> triangle folder -> 5-octave exponential cutoff of a
    # resonant low-pass on white noise. Pass 1 writes the per-sample cutoff (the folder and
    # the exponential are one table), pass 2 runs a single-rate Chamberlin low-pass.
    return 'resonoise:\n'+lookup(2,'resonoise_square','x0')+f'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>${PHASE_MAX:x},x1
    cmp x1,a
    tgt x1,a
    move a,n2
'''+lookup(3,'resonoise_fold','x0')+f'''    ; The fold depth glides 3/4 of the way to its target each block (~1 ms).
    move y:(r6+$16),y0
    move x0,a
    sub y0,a
    move a,x0
    move #>{q(.75)},x1
    mpy x0,x1,a
    add y0,a
    move a,y:(r6+$16)
    asl #2,a,a
    move a,y1
'''+lookup(2,'resonoise_sine','x0')+f'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$400000,x0
    cmp x0,a
    tgt x0,a
    asl a
    move a,x1
    move y:(r6+$1f),x0
    move x0,x:(r6)
    move y:(r6+$13),r2
    move y:(r6+$14),a
    move r6,r4
    move #>$1f,n4
    move #>filt_sine1k,r5
    move #>reso_coef,r3
    move (r4)+n4
    do #32,reso_ctl_end
    tfr a,b  x0,y:(r4)+
    lsr #14,b
    move b1,n5
    move r2,b
    move y:(r5+n5),x0
    tst b  (r2)+n2
    add x1,a ifge
    mpy x0,y1,b
    lsr #13,b
    move b1,n3
    nop
    move y:(r3+n3),x0
reso_ctl_end:
    move x0,y:(r4)+
    move r2,y:(r6+$13)
    move a1,y:(r6+$14)
    ; Pass 2: noise, Chamberlin low-pass (damping 3/8), output one sample late.
    move #>$20,n4
    move r6,r1
    move x:(r6+$1),a
    move x:(r6+$2),x0
    move #>{FILT_RESO_MULT},y1
    move (r4)-n4
    move y:(r6+$17),b
    move r7,r5
    move y:(r4)+,y0
    do #32,reso_svf_end
    mac x0,y0,a  x:(r1),x1  b,y:(r5)+
    mpy x1,y1,b
    asr b
    move b0,x1
    sub a,b  x1,x:(r1)
    asl #2,b,b
    mac -x0,#1,b
    mac -x0,#2,b
    tfr x0,b  b,x1
    mac x1,y0,b
    tfr a,b  b,x0  y:(r4)+,y0
    asl #4,b,b
reso_svf_end:
    move b,y:(r6+$17)
    move a,x:(r6+$1)
    move x0,x:(r6+$2)
    move x:(r6),x0
    move x0,y:(r6+$1f)
    jmp output
'''


FILT_BIT_WEIGHTS=(.03,.035,.04,.045,.05,.055,.06,.06,.125)


@filt_shortened
def bitcrush_walk():
    # Nine walking PWM squares on the event engine, summed with fixed unequal weights
    # (eight fine ones, the ninth at 1/8) into a 512-level mix that BITS truncates. The
    # ninth's step is a power of two, so it stays dry at every depth above two bits.
    # Three voices walk per block (+/-52 Hz, about the old per-block +/-30 diffusion).
    # X+0 high, X+16 positions, X+32 edge buffer; Y+$20 next edge, Y+$30 low.
    return 'Rwalk_BitCrushPW:\n'+lookup(4,'pitch_inverse','x0')+'''    move x0,y:(r6+$11)
'''+lookup(2,'bitwalk_width','x0')+'''    move x0,y:(r6+$12)
    ; First block after a reset: every duration from the initial positions.
    move y:(r6+$1b),a
    tst a
    jne bitwalk_ready
    move r6,r2
    move #>16,n1
    move r6,r4
    move #>$30,n4
    move r6,r1
    move (r4)+n4
    move (r1)+n1
    do #9,bitwalk_init_end
    move x:(r1)+,a
'''+filt_duration_tail()+'''bitwalk_init_end:
    move r1,y:(r6+$1b)
bitwalk_ready:
    move y:(r6+$1c),b
    tfr b,a
    add #1,a
    move #0,x0
    cmp #3,a
    tge x0,a
    move a1,y:(r6+$1c)
    tfr b,a
    asl b
    add a,b
    move b1,n2
    move r6,r2
    move #>16,n1
    move (r2)+n2
    move r2,r1
    move #>$30,n4
    move r2,r4
    move (r1)+n1
    move (r4)+n4
    move #>700,y1
    do #3,bitwalk_walk_end
'''+filt_walk_body('bitwalk',52,50,'y1')+filt_duration_tail()+'''bitwalk_walk_end:
    move r6,r2
    move #>$30,n4
    move r6,r4
    move r6,r0
    move #>$20,n0
    move r6,r5
    move #>32,n5
    move (r4)+n4
    move (r0)+n0
    move (r5)+n5
    move #>filt_bit_weights,r3
    move #>'''+str(FILT_EDGE_LIMIT)+''',x0
'''+filt_edges('bitwalk',9,True)+lookup(3,'bitwalk_mask','x1')+'''    ; Weighted sum (biased by -1/4), x4 to full scale, then the BITS mask.
    move r6,r1
    move #>32,n1
    move y:(r6+$13),a
    move (r1)+n1
    move #>$200000,y0
    sub y0,a
    move y:(r6+$14),b
    move r7,r5
    move x:(r1)+,x0
    do #32,bitwalk_end
    add x0,a  x:(r1)+,x0  b,y:(r5)+
    tfr a,b
    asl #2,b,b
    and x1,b
bitwalk_end:
    add y0,a
    move a1,y:(r6+$13)
    move b,y:(r6+$14)
    move r6,r1
    clr a
    move (r1)+n1
    rep #32
    move a,x:(r1)+
    jmp output
'''


def filt_lcg():
    """24-bit LCG on Y+$1f (cheaper than Park-Miller); new seed sign-extended in B."""
    return '''    move y:(r6+$1f),x0
    move #>$19660d,y0
    mpy x0,y0,a
    asr a
    move a0,a
    add #>$3c6ef3,a
    move a1,y:(r6+$1f)
    move a1,b
'''


def filt_walk_body(tag, stride, lower, bound_reg):
    """One voice's walk step at x:(r1)+; bit 23 of a fresh LCG draw picks the direction.
    Leaves the new position in A1."""
    return filt_lcg()+f'''    tst b
    move #>{stride},b
    move #>{-stride},x0
    tmi x0,b
    move x:(r1),a
    add b,a
    tfr a,b
    add #>10,b
    cmp #>{lower},a
    tlt b,a
    tfr a,b
    sub #>10,b
    cmp {bound_reg},a
    tgt b,a
    move a1,x:(r1)+
'''


def filt_walk(tag, count, stride, lower, bound_reg, tail):
    """One random-walk step per voice per block; X+16.. positions. The bound is in
    bound_reg; tail turns A1=position into a step stored at x:(r2)+."""
    return f'''    move r6,r1
    move #>16,n1
    move r6,r2
    move (r1)+n1
    do #{count},{tag}_walk_end
'''+filt_walk_body(tag,stride,lower,bound_reg)+tail+f'''{tag}_walk_end:
'''


def lfree_walk():
    """Four walking PWM sources with an interpolated edge sample, then smoothing.

    X holds each source's half-period and level interleaved (X+0,2,4,6 / X+1,3,5,7) so one XY move
    fetches period and counter and the next add fetches the level: the no-edge path is five
    instructions. Edge samples run in handlers at the top of the loop body, skipped by one jump.
    """
    result='Rwalk_LFree:\n'+lookup(2,'lfree_bound','x0')+'''    move x0,y:(r6+$11)
'''+lookup(4,'pitch_inverse','x0')+'''    move x0,y:(r6+$12)
'''+lookup(3,'sh_slew','x0')+'''    move x0,y:(r6+$13)
'''+lfree_controls()+'''    move r6,r0
    move #>8,n0
    move r6,r4
    move #>32,n4
    move (r4)+n4
    move #>4,n4
    move #>256,x1
    move y:(r6+$13),y1
    move y:(r6+$1d),n1
    do #32,lfree_end
    jmp lfree_main
'''
    for i in range(4):
        result+=f'''lfree_edge{i}:
    sub x0,a
    move a1,y:(r4)+
    move a1,x0
    mpy x0,y0,a
    asl #16,a,a
    neg a
    add y0,a
    move a1,x0
    add x0,b
    move y0,a
    neg a
    move (r0)-
    move a1,x:(r0)+
    jmp lfree_next{i}
'''
    result+='lfree_main:\n    clr b  x:(r0)+,x0  y:(r4),a\n'
    for i in range(4):
        result+=f'''    add x1,a  x:(r0)+,y0
    cmp x0,a
    jge lfree_edge{i}
    add y0,b  a1,y:(r4)+
lfree_next{i}:
'''
        if i<3: result+='    move x:(r0)+,x0  y:(r4),a\n'
    result+='''    ; The former room-size control now smooths the dry mix; zero keeps its edges.
    move b,x0
    mpy x0,y1,a
    move n1,x0
    mac -x0,y1,a
    add x0,a
    move a1,n1
    move (r0)-n0
    move (r4)-n4
    move a,y:(r7)+
lfree_end:
    move n1,y:(r6+$1d)
    jmp output
'''
    return result


def lfree_controls():
    """walk_controls('lfree',4,5,40,pwm=True), storing half-periods at X+0,2,4,6."""
    tag='lfree'
    result=f'''    move r6,r0
    move #>2,n0
    move r6,r1
    move #>16,n1
    move (r1)+n1
    do #4,{tag}_control_end
'''+park_miller_a(tag)+f'''    move y:(r6+$1f),a
    and #>1,a
    tst a
    move #>5,x0
    jne {tag}_direction_ready
    move #>-5,x0
{tag}_direction_ready:
    move x:(r1),a
    add x0,a
    cmp #>40,a
    jge {tag}_above_low
    add #>10,a
    jmp {tag}_position_ready
{tag}_above_low:
    move y:(r6+$11),x0
    cmp x0,a
    jle {tag}_position_ready
    sub #>10,a
{tag}_position_ready:
    move a1,x:(r1)+
    move #>1,x0
    cmp x0,a
    tlt x0,a
    move #>600,x0
    cmp x0,a
    tgt x0,a
    ; Half-period from the filter group's reciprocal table (filt_period = 32 x the PWM law).
    add #>filt_period,a
    move a1,r5
    nop
    move y:(r5),x0
    move y:(r6+$12),y0
    mpy x0,y0,a
    asr #3,a,a
    move #>5644800,x0
    cmp x0,a
    tgt x0,a
    move a,x:(r0)+n0
{tag}_control_end:
'''
    return result


SATAN_PINK = .114   # Kellet gains scaled to the Stenzel generator's RMS (0.196) and peak (~0.8)


def satan_workout():
    """Pink noise modulating PWM half-cycle durations.

    Pink source: Paul Kellet's three-pole 'economy' filter on a 24-bit LCG white source, with
    the filter states and coefficients streamed through XY parallel moves (the original Stenzel
    generator cost ~60 memory-bound instructions per sample). The noise's sign follows the
    current half-cycle by a multiply with its level, so the loop has one branch: the edge.
    Loop registers: R0 coefficients, R2 half-period, R4 filter states, R5 256, N1 seed,
    N2 position, N3 level, N5 modulation depth.
    """
    return 'satanWorkout:\n'+lookup(2,'satan_period','x0')+'''    move x0,y:(r6+$11)
'''+lookup(4,'pitch_inverse','y0')+'''    move y:(r6+$11),x0
    mpy x0,y0,a
    asl #2,a,a
    move #>5644800,x0
    cmp x0,a
    tgt x0,a
    move #>512,x0
    cmp x0,a
    tlt x0,a
    move a1,r2
'''+lookup(3,'unit','x0')+'''    move x0,n5
    move y:(r6+$24),n1
    move y:(r6+$20),n2
    move y:(r6+$30),n3
    move #>256,r5
    move #>satan_coef,r0
    move #>9,n0
    move r6,r4
    move #>$21,n4
    move (r4)+n4
    move #>3,n4
    do #32,satan_end
    ; White: 24-bit LCG, the low word of seed * 1664525 plus 1013904223.
    move n1,x0
    move x:(r0)+,y0
    mpy x0,y0,a  x:(r0)+,y1
    asr a
    move a0,a
    add y1,a
    move a1,n1
    move a1,x1
    ; Pink: three one-pole sections of the white source plus a direct term.
    clr b  x:(r0)+,x0  y:(r4),y0
    mpy x0,y0,a  x:(r0)+,x0
    mac x1,x0,a
    add a,b  a,y:(r4)+
    move x:(r0)+,x0  y:(r4),y0
    mpy x0,y0,a  x:(r0)+,x0
    mac x1,x0,a
    add a,b  a,y:(r4)+
    move x:(r0)+,x0  y:(r4),y0
    mpy x0,y0,a  x:(r0)+,x0
    mac x1,x0,a
    add a,b  a,y:(r4)+
    move x:(r0)+,x0
    mac x1,x0,b
    move b,x0
    move n5,y1
    mpy x0,y1,a
    move a,x0
    move n3,y0
    mpy x0,y0,a
    move a,x0
    move r2,y0
    move r2,b
    mac x0,y0,b
    move b1,b
    move n2,a
    move r5,x1
    add x1,a
    move (r0)-n0
    move (r4)-n4
    cmp b,a
    jlt satan_hold
    ; Edge: interpolate the crossing sample and flip the level.
    sub b,a
    move a1,n2
    move a1,y0
    move n3,x0
    mpy x0,y0,a
    asl #16,a,a
    move x0,b
    sub a,b
    move x0,a
    neg a
    move a1,n3
    move b1,x0
    jmp satan_out
satan_hold:
    move a1,n2
    move n3,x0
satan_out:
    move x0,y:(r7)+
satan_end:
    move n1,y:(r6+$24)
    move n2,y:(r6+$20)
    move n3,y:(r6+$30)
    jmp output
'''


FILT_FLANGE_CENTER=176*4096     # delay centre, 1/4096 samples (4 ms)
FILT_FLANGE_DEPTH=2*150*4096    # twice the +/-150 sample sweep (half-amplitude triangle)


@filt_shortened
def sine_fm_flange():
    # Four walking 20% pulses gate 100%-linear FM of four sines (carrier-major loops, the
    # modulator phase lives in r1/n1). The mix then runs through a swept flanger: a
    # 512-sample ring, written twice (+512) so a block's reads never wrap, read with a
    # per-block fractional delay of 26..326 samples swept by a RATE-speed triangle.
    tail=f'''    move #0,x0
    cmp x0,a
    tlt x0,a
    move a1,x0
    move #>${q((1<<24)/44100/512):x},y0
    mpy x0,y0,a
    asl #9,a,a
    move a,x0
    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>${PHASE_MAX:x},x0
    cmp x0,a
    tgt x0,a
    move a,x:(r2)+
'''
    return '''Rwalk_SineFMFlange:
    jsr pi_prepare
    tst a
    jeq silence
    ; One modulator walks per block, round robin, at +/-60 Hz (the old 4 x +/-30 diffusion).
    move y:(r6+$1c),b
    tfr b,a
    add #1,a
    and #>3,a
    move a1,y:(r6+$1c)
    move b1,n2
    move r6,r2
    move #>16,n1
    move (r2)+n2
    move r2,r1
    move #>700,y1
    move (r1)+n1
'''+filt_walk_body('flange',60,50,'y1')+tail+'''    ; Doubled carrier steps from one 4-wide row per FREQ value.
    move y:(r6+$2),a
    asr #14,a,a
    and #>$1fc,a
    add #>filt_flange_car,a
    move a1,r0
    move r6,r2
    move #>12,n2
    move y:(r6+$d),y0
    move (r2)+n2
    do #4,flange_step_end
    move y:(r0)+,x0
    mpy x0,y0,a
    asl #2,a,a
    move #>$400000,x0
    cmp x0,a
    tgt x0,a
    asl a
    move a,x:(r2)+
flange_step_end:
    ; X+0 mod steps, +4 mod phases, +8 carrier phases, +12 doubled carrier steps.
    move #>filt_sine1k,r5
    move #>$'''+f'{q(-.6)&0xffffff:x}'+''',y0
    move x:(r6+$3e),a
    add #>1024,a
    move a1,r0
    move r6,r3
    move #>4,n3
    move #>4,n4
    move r6,r2
    move (r3)+n3
    do #4,flange_carrier_end
    move r0,r4
    move (r0)+
    move x:(r2)+,n1
    move x:(r3),r1
    move x:(r3+$4),a
    move x:(r3+$8),x0
    move r1,b
    do #32,flange_osc_end
    cmp y0,b  (r1)+n1
    add x0,a iflt
    tfr a,b  y1,y:(r4)+n4
    lsr #14,b
    move b1,n5
    move r1,b
    move y:(r5+n5),y1
flange_osc_end:
    move y1,y:(r4)+n4
    move r1,x:(r3)+
    move a1,x:(r3+$3)
flange_carrier_end:
'''+lookup(3,'flange_rate','b')+f'''    ; Triangle LFO at the original RATE; delay = centre + depth * triangle.
    asr #2,b,b
    move x:(r6+$14),a
    add b,a
    move a1,x:(r6+$14)
    move a1,a
    abs a
    neg a
    add #>$400000,a
    move a,x0
    move #>{FILT_FLANGE_DEPTH},y0
    mpy x0,y0,a
    add #>{FILT_FLANGE_CENTER},a
    tfr a,b
    asr #12,b,b
    and #>$fff,a
    lsl #10,a
    move a1,x1
    move #>$400000,a
    sub x1,a
    move a1,y1
    move x:(r6+$3e),a
    move x:(r6+$15),x0
    add x0,a
    move a1,r3
    add #>512,a
    move a1,r4
    move b1,x0
    sub x0,a
    move a1,r5
    move #>1,x0
    sub x0,a
    move a1,r0
    move x:(r6+$15),a
    add #>32,a
    and #>$1ff,a
    move a1,x:(r6+$15)
    move x:(r6+$3e),a
    add #>1028,a
    move a1,r2
    do #32,flange_mix_end
    move y:(r2)+,a
    move y:(r2)+,y0
    add y0,a  y:(r2)+,y0
    add y0,a  y:(r2)+,y0
    add y0,a  y:(r5)+,y0
    mpy y0,y1,b  a,y:(r3)+
    move a,x0  y:(r0)+,y0
    mac y0,x1,b  x0,y:(r4)+
    mac x0,#1,b
    move b,y:(r7)+
flange_mix_end:
    jmp output
'''


# Linearised detune: 2**(0.005*8*tri) ~ 1 + K2*tri/2 with tri at half amplitude.
PHASING_K2 = 2*.005*8*math.log(2)
GRAIN_BANK = 469   # three banks + one pad word + the 128-word feedback ring fill the 1,536-word slice
GRAIN_RING = 1408  # 128-aligned ring offset inside the slice


def granular_programs():
    """Granular feedback (grainGlitch I-III), copy-free.

    Three fixed banks rotate between capture, latest-complete ("middle") and playback roles:
    a finished capture is faded in place and swapped with the middle bank, and a playback wrap
    swaps in the middle bank only when it holds a newer grain. The upstream effect copied whole
    grains (up to 511 packed samples) inside one sample, which priced these programs at ~2,200
    cold c/s. Samples are stored one per word. The ring advances 32 samples per block from a
    multiple of 32, so a block never wraps it and the 'ring filled' state changes only between
    blocks: each block runs either the connected or the unconnected loop.

    Loop registers: R0 playback position (9.14), R1 ring, R2 capture write, R3 playback bank,
    R4 exp table centre, R5 capture-state handler (waiting/capturing), N0 oscillator phase,
    N1 previous input, N2 capture end, N5 grain length << 14, Y1 FM depth.
    """
    result=''
    for mode,name in enumerate(('grainGlitch','grainGlitchII','grainGlitchIII')):
        t=f'g{mode}'
        result+=name+':\n    jsr pi_prepare\n    tst a\n    jeq silence\n'
        result+=lookup(2,'grain_rate3' if mode==2 else 'grain_rate','x0')+'''    move y:(r6+$d),y0
    mpy x0,y0,a
    asl #2,a,a
    move #>$7ffe00,x0
    cmp x0,a
    tgt x0,a
    move a,x:(r6)
'''+lookup(3,'grain_len3' if mode==2 else 'grain_len','x0')+f'''    move y:(r6+$17),a
    tst a
    jeq {t}_len_ready
    move x0,y:(r6+$14)
{t}_len_ready:
'''+lookup(3,'grain_speed14','x0')+'    move x0,x:(r6+1)\n'+lookup(3,'grain_depth','y1')
        if mode==1:
            result+=lookup(5,'sh_slew','x0')+'    move x0,y:(r6+$25)\n    move #>$80000,x0\n    move x0,y:(r6+$e)\n'
        result+=f'''    move y:(r6+$16),a
    tst a
    jne {t}_bases
    move x:(r6+$3e),a
    move a1,y:(r6+$16)
    move a1,y:(r6+$15)
    add #>{GRAIN_BANK},a
    move a1,y:(r6+$19)
    add #>{GRAIN_BANK},a
    move a1,y:(r6+$1a)
{t}_bases:
    move y:(r6+$14),x0
    move y:(r6+$16),a
    add x0,a
    move a1,n2
    move x0,a
    asl #14,a,a
    move a1,n5
    move x:(r6+$3e),a
    add #>{GRAIN_RING},a
    move y:(r6+$1c),x0
    add x0,a
    move a1,r1
    move y:(r6+$15),r2
    move y:(r6+$1a),r3
    move #>fmx+2048,r4
    move y:(r6+$1b),r0
    move y:(r6+$20),n0
    move y:(r6+$13),n1
    ; beginPitchShift() rearms capture on every control call, retaining the write head.
    move #>{t}_wait,r5
    move y:(r6+$1d),a
    tst a
    jeq {t}_unconnected
    do #32,{t}_loop_end
    move y:(r1),x0
    jmp (r5)
{t}_cap:
    move r2,a
    move n2,x1
    cmp x1,a
    jge {t}_complete
    move x0,y:(r2)+
    jmp {t}_play
{t}_cross:
    ; Sign crossing: start (or resume) capture with this sample.
    move #>{t}_cap,r5
    move #>1,a
    move a1,y:(r6+$17)
    jmp {t}_cap
{t}_complete:
    ; Finished grain: zero its first two samples, fade its last 19, make it the middle bank.
    move x0,n1
    move #>1,a
    move a1,y:(r6+$18)
    clr a
    move a,y:(r6+$17)
    move y:(r6+$16),r2
    nop
    move a,y:(r2)+
    move a,y:(r2)
    move y:(r6+$16),a
    move y:(r6+$14),x1
    add x1,a
    sub #>19,a
    move a1,r2
    move #>grain_fade+19,r5
    nop
    do #19,{t}_fade_end
    move y:(r2),x1
    move y:(r5)-,x0
    mpy x1,x0,a
    move a1,y:(r2)+
{t}_fade_end:
    move y:(r6+$16),a
    move y:(r6+$19),b
    move a1,y:(r6+$19)
    move b1,y:(r6+$16)
    move y:(r6+$14),x1
    move b1,a
    add #>1,a
    move a1,r2
    add x1,b
    move b1,n2
    move #>{t}_wait,r5
    jmp {t}_play
{t}_wrap:
    ; Playback wrapped: read the overshoot, restart, and take the middle bank if it is newer.
    sub x1,a
    move #<0,r0
    move y:(r6+$18),b
    tst b
    jeq {t}_read
    clr b
    move b,y:(r6+$18)
    move r3,b
    move y:(r6+$19),r3
    move b1,y:(r6+$19)
    move r3,y:(r6+$1a)
    jmp {t}_read
{t}_wait:
    move n1,a
    eor x0,a
    jmi {t}_cross
    move x0,n1
{t}_play:
    move r0,a
    move x:(r6+1),x1
    add x1,a
    move n5,x1
    cmp x1,a
    jge {t}_wrap
    move a1,r0
{t}_read:
    asr #14,a,a
    move a1,n3
    move x:(r6),x0
    move y:(r3+n3),x1
    ; Exponential FM from the grain: one read of the shared 2^x table (fmx, F/512) at
    ; 1/256-octave steps; asl #9 restores the x4 scale the grain law wants.
    mpy y1,x1,a
    asr #4,a,a
    move a1,n4
    move n0,b
    move y:(r4+n4),y0
    mpy x0,y0,a
    asl #9,a,a
    move a,x0
    add x0,b
    move b1,n0
    move b1,b
'''+grain_wave(mode)+'    move b1,y:(r1)+\n'+grain_out(mode)+f'''{t}_loop_end:
    jmp {t}_done
{t}_unconnected:
    ; Ring not yet filled: oscillator only, silent output.
    clr a
    do #32,{t}_unc_end
    move n0,b
'''+grain_wave(mode)+f'''    move b1,y:(r1)+
    move n0,b
    move x:(r6),x0
    add x0,b
    move b1,n0
    move a,y:(r7)+
{t}_unc_end:
{t}_done:
    move r0,y:(r6+$1b)
    move n0,y:(r6+$20)
    move n1,y:(r6+$13)
    move r2,y:(r6+$15)
    move y:(r6+$1c),a
    add #>32,a
    and #>$7f,a
    move a1,y:(r6+$1c)
    tst a
    jne output
    move #>1,x0
    move x0,y:(r6+$1d)
    jmp output
'''
    return result


def grain_wave(mode):
    """Sign-extended phase in B -> oscillator sample in B: square +32767/-32768, or saw for III."""
    if mode==2:
        return '    asr #8,b,b\n'
    return '    asr #23,b,b\n    eor #>$7fff,b\n'


def grain_out(mode):
    """Grain in X1, oscillator in B -> one output sample."""
    if mode==0:
        return '''    move b1,x0
    move x1,a
    or x0,a
    asl #8,a,a
    move a1,y:(r7)+
'''
    if mode==1:
        # Original gain 32000 on a sixteen-bit grain clips every nonzero sample to (nearly) full
        # scale; saturate in two steps, as a shift of 23 would overflow the guard bits.
        return '''    move x1,a
    asl #16,a,a
    move a,x0
    move x0,a
    asl #7,a,a
    move a,x0
    move y:(r6+$25),y0
    mpy x0,y0,a
    move y:(r6+$21),x0
    mac -x0,y0,a
    add x0,a
    move a,y:(r6+$21)
    move a,y:(r7)+
'''
    return '''    move x1,a
    asl #8,a,a
    move a1,y:(r7)+
'''


def check_do_ends(source):
    """Refuse two DO loops ending at one address (TriFMcluster hung DSP2 on hardware this way;
    the emulator's recursive loop handling exits both loops and hides it)."""
    targets={m[1] for m in re.finditer(r'^\s+do\s+[^,]+,(\w+)\s*$',source,re.M)}
    labels=[]
    for line in source.splitlines()+['']:
        label=re.match(r'^(\w+):\s*$',line)
        if label: labels.append(label[1]); continue
        if line.strip() and not line.lstrip().startswith(';'):
            shared=[l for l in labels if l in targets]
            if len(shared)>1: raise SystemExit('nested DO loops end at the same address: '+', '.join(shared))
            labels=[]


def generate(destination):
    missing=[name for name in PROGRAMS if name not in IMPLEMENTED]
    if missing:
        raise SystemExit('Full catalog is incomplete; remaining: '+', '.join(missing))
    names=PROGRAMS
    tables={
      'pitch':[q(2**((k-64)/32)/4) for k in range(128)],
      'attack':[q(1 if k==0 else min(1,32/(44100*(.001*1000**(k/127))))) for k in range(128)],
      'decay':[q(math.exp(-32/(44100*(.015*2000**(k/127))))) for k in range(128)],
      'saw_base':[round((20+(k/127)**2*1000)*(1<<24)/44100) for k in range(128)],
      'fib_base':[round((40+(k/127)**2*5000)*(1<<24)/44100) for k in range(128)],
      'part_base':[round((50+(k/127)**2*1000)*(1<<24)/44100) for k in range(128)],
      'saw_spread':[q((1.01+(k/127)**2*.9)/2) for k in range(128)],
      'part_spread':[q((1.01+k/127*1.1)/4) for k in range(128)],
    }
    tables=LawTables(tables)
    ratios=[]
    for raw in range(128):
        spread=(raw/127)**2/2+.1
        values=[1,2*spread+1]
        for _ in range(14): values.append(values[-2]+values[-1]*spread)
        for value in values:
            assert value<128  # ratio * 2^16 fits a word
            ratios.append(round(value*(1<<16)))
    tables['fib_ratios']=ratios
    tables['sh_rate']=[round((15+k/127*5000)*(1<<23)/44100) for k in range(128)]
    tables['sh_slew']=[q(1 if k==0 else 1-math.exp(-1/(44100*.00005*2000**(k/127)))) for k in range(128)]
    tables['pw_base']=[round((40+(k/127)**2*8000)*(1<<24)/44100) for k in range(128)]
    ratios=[1]
    for multiplier in (1.227,1.24,1.17,1.2,1.3): ratios.append(ratios[-1]*multiplier)
    tables['pw_ratios']=[q(ratio/4) for ratio in ratios]
    # Original shape input is DC: width = (signed 16-bit DC + 32768) / 65536.
    # Subtract the sign bias to compare against our sign-flipped 24-bit phase.
    tables['pw_width']=[int((1-.97*k/127)*32767)*256 for k in range(128)]
    sine=[round(math.sin(i*2*math.pi/256)*32767)*256 for i in range(257)]
    tables['sine_segments']=[value for i in range(256) for value in (sine[i+1]-sine[i],sine[i])]
    # Original exp2 quadratic evaluated for every possible 12-bit fractional input.
    mantissa=[]
    for i in range(4096):
        n=((i<<15)+134217728)<<3
        n=(n*n+(1<<31))>>32
        n=(((n*715827883+(1<<31))>>32)<<3)+715827882
        mantissa.append(n>>8)
    tables['fm_mantissa']=mantissa
    tables['basura_base']=[round((200+5000*(k/127)**2)*(1<<24)/44100) for k in range(128)]
    tables['basura_time']=[math.floor(4410*(k/127)**2) for k in range(128)]
    tables['basura_width']=[round((.5-.45*k/127)*(1<<23)) for k in range(128)]
    primes=(53,127,199,283,383,467,577,661,769,877,983,1087,1193,1297,1429,1523)
    tables['phasing_base']=[round((30+5000*(k/127)**2)*(1<<24)/44100) for k in range(128)]
    tables['phasing_spread']=[q((1+.5*k/127)/2) for k in range(128)]
    tables['phasing_mod']=[round(f*(1<<24)/44100) for f in (10,11,15,1,1,3,17,14,.11,5,2,7,1,.1,.7,.5)]
    tables['phasing_mod32']=[32*v for v in tables['phasing_mod']]
    # Eight carriers' signs per byte: the two bytes' sums add, and the store saturates the mix.
    tables['phasing_byte']=[round(.1*Q)*(8-2*bin(i).count('1')) for i in range(256)]
    tables['basurilla_rate']=[round((10+100*(k/127)**2)*(1<<24)/44100) for k in range(128)]
    tables['basurilla_width']=[q(.95*k/127) for k in range(128)]
    seed=1; random=[]
    for _ in range(16):
        seed=(seed*16807)%2147483647
        random.append(((seed%56000)-28000)*256)
    tables['array_random']=random
    tables['walk_bound']=[math.floor(200+1800*k/127) for k in range(128)]
    tables['walk_width']=[q(.1+.8*k/127) for k in range(128)]
    seed=1; positions=[]
    for _ in range(16):
        seed=(seed*16807)%2147483647  # Initial direction, overwritten by process().
        seed=(seed*16807)%2147483647; positions.append(seed%1800)
        seed=(seed*16807)%2147483647  # Unconnected y-coordinate.
    tables['walk_initial']=positions+[seed&65535,seed>>16]
    for name,offset,span,octaves,lfo in (
        ('existencelsPain',50,5000,3,(11,70,23,.01)),
        ('whoKnows',15,500,6,(21,70,90,77))):
        tables[name+'_rate']=[round((offset+span*(k/127)**2)*Q/44100) for k in range(128)]
        tables[name+'_depth']=[q((.3+octaves*k/127)/8) for k in range(128)]
        tables[name+'_lfo']=[round(f*(1<<24)/44100) for f in lfo]
    graph_rates={
        'xModRingSqr':(lambda x:100+5000*x*x,lambda y:20+1000*y*y),
        'XModRingSine':(lambda x:100+8000*x*x,lambda y:60+3000*y*y),
        'CrossModRing':(lambda x:20+807*x*x,lambda x:11+21*x,lambda x:1+29*x*x,lambda x:max(0,1-7*x)),
        'Atari':(lambda x:10+50*x*x,lambda y:10+200*y),
        'radioOhNo':(lambda x:20+2500*x*x,lambda x:1120-1100*x*x,lambda x:20+2900*x*x,lambda x:8000*(1-x*x)),
    }
    for name,formulas in graph_rates.items():
        for i,formula in enumerate(formulas):
            tables[f'{name}_rate{i}']=[round(formula(k/127)*(1<<24)/44100) for k in range(128)]
    tables['CrossModRing_depth']=[q((2+8*k/127)/16) for k in range(128)]
    tables['Atari_depth']=[q((3+8*k/127)/16) for k in range(128)]
    tables['radio_width']=[q((1+k/127)/2) for k in range(128)]
    tables.update(fb_tables(tables))
    tables['resonoise_square']=[round((20+7777*(k/127)**2)*(1<<24)/44100) for k in range(128)]
    tables['resonoise_sine']=[round((20+10000*(k/127)**2)*(1<<24)/44100) for k in range(128)]
    tables['resonoise_fold']=[int((.03+.2*k/127)*32767*256) for k in range(128)]
    for name,count,span in (('bitwalk',9,600),('lfree',4,500)):
        seed=1; positions=[]
        for _ in range(count):
            seed=(seed*16807)%2147483647
            seed=(seed*16807)%2147483647; positions.append(seed%span)
            seed=(seed*16807)%2147483647
        tables[name+'_initial']=positions+[seed&65535,seed>>16]
    tables['bitwalk_width']=[q(.2+.55*k/127) for k in range(128)]
    tables['bitwalk_mask']=[(0xffffff<<(24-(1+k*15//127)))&0xffffff for k in range(128)]
    tables['lfree_bound']=[math.floor(50+500*k/127) for k in range(128)]
    tables['pitch_inverse']=[q(2**(-(k-64)/32)/4) for k in range(128)]
    tables['pwm_period']=[round(44100*256/(2*max(1,k))) for k in range(601)]
    tables['satan_period']=[round(44100*256/(2*(8+6000*(k/127)**2))) for k in range(128)]
    tables['unit']=[q(k/127) for k in range(128)]
    tables['satan_coef']=[1664525,1013904223&0xffffff,q(.99765),q(.0990460*SATAN_PINK),q(.963),q(.2965164*SATAN_PINK),
                          q(.57),q(1.0526913*SATAN_PINK),q(.1848*SATAN_PINK)]
    tables['grain_fade']=[q(k/20) for k in range(21)]
    tables['grain_depth']=[q(k/127/4) for k in range(128)]
    # Playback position is 9.14 fixed point (the longest grain times 2**14 fits 23 bits).
    tables['grain_speed14']=[int(2**(6*k/127-3)*65536+.499)>>2 for k in range(128)]
    # exp2 at 1/256-octave steps over the grain FM's +/-2 octaves, scaled by 1/4.
    for suffix,base,span in (('',500,75),('3',400,55)):
        tables['grain_rate'+suffix]=[round((base+5000*(k/127)**2)*(1<<24)/44100) for k in range(128)]
        tables['grain_len'+suffix]=[max(100,min(GRAIN_BANK,int((25+span*k/127)*(GRAIN_BANK/4266)*44.1+.5))) for k in range(128)]
    seed=1
    for _ in range(12): seed=(seed*16807)%2147483647
    tables['flange_seed']=[seed&65535,seed>>16]
    for i,offset in enumerate((0,55,75,65)):
        tables[f'flange_carrier{i}']=[round((10+500*k/127+offset)*(1<<24)/44100) for k in range(128)]
    tables['flange_rate']=[int(3*k/127*(1<<31)/44100) for k in range(128)]
    tables['flange_sine']=[]
    for theta in range(0,32768,16):
        offset=(theta&0x3fff)>>3
        if theta&0x4000: offset=2047-offset
        section=offset//256
        tables['flange_sine'].append((0,6393,12539,18204,23170,27245,30273,32137)[section]+(49,48,44,38,31,23,14,4)[section]*((offset&255)//2))
    tables['pink_pattern']=[0,0x800,0x400,0x800,0x200,0x800,0x400,0x800,0x100,0x800,0x400,0x800,0x200,0x800,0x400,0x800]
    tables['pink_pnmask']=[]
    for n in (0,8,4,8,2,8,4,8,1,8,4,8,2,8,4,8):
        tables['pink_pnmask'] += [n,128,64,128,32,128,64,128,16,128,64,128,32,128,64,128]
    for tag,coefficients in (('a',(1.190566,.162580,.002208,.025475,-.001522,.007322)),
                             ('b',(.001774,.004529,-.001561,.000776,-.000486,.002017))):
        tables['pink_fir'+tag]=[int(sum(2048*c*(2*((n>>i)&1)-1) for i,c in enumerate(coefficients))) for n in range(64)]
    tables.update(fm_group_tables())
    tables.update(filt_tables())
    source=header()+lookup(4,'pitch','x0')+'    move x0,y:(r6+$d)\n'
    # Select and reset program-local state when switching graphs, preserving the envelope.
    # Table dispatch: a compare chain fetched up to ~230 code words per block for late modes,
    # which the cold-cache metric charges at 3 cycles a word. Same ceil() mode boundaries.
    tables['mode_index']=[next(i for i in range(len(names)) if k<math.ceil((i+1)*128/len(names)) or i==len(names)-1)
                          for k in range(128)]
    source+=lookup(1,'mode_index','x0')+"""    move y:(r6+$9),a
    cmp x0,a
    jeq same_program
    move x0,y:(r6+$9)
    jsr reset_program
same_program:
    move y:(r6+$9),a
    asl a
    add #>dispatch_table,a
    move a1,r0
    nop
    jmp (r0)
dispatch_table:
"""
    for name in names:
        source+=f'    jmp {name}\n'
    source+='\n'.join(control_block(name) for name in names if name in ('clusterSaw','FibonacciCluster','partialCluster'))+'\n'+saw_cluster()+'\n'+sample_hold()+'\n'+pulse_cluster()+'\n'+fm_clusters()+'\n'+basura_total()+'\n'+prime_clusters()+'\n'+phasing_cluster()+'\n'+basurilla()+'\n'+array_rocks()+'\n'+walking_filomena()+'\n'+filter_programs()+'\n'+feedback_programs()+'\n'+resonoise()+'\n'+bitcrush_walk()+'\n'+lfree_walk()+'\n'+satan_workout()+'\n'+sine_fm_flange()+'\n'+granular_programs()+'\n'+pi_prepare()+'\n'+common_output()+reset_program(names)
    source=remap_controls(source).replace(BANDPASS_SLOT,bandpass())
    tables.update(bandpass_tables())
    captions={'clusterSaw':('SAW','FREQ','SPRD'),'FibonacciCluster':('FIB','FREQ','SPRD'),'partialCluster':('PART','FREQ','SPRD'),
              'S_H':('S-H','RATE','SMTH'),'pwCluster':('PW','FREQ','PWID'),
              'crCluster2':('CR','FREQ','FM'),'sineFMcluster':('SFM','FREQ','FM'),'TriFMcluster':('TFM','FREQ','FM'),
              'BasuraTotal':('BSRA','FREQ','TIME'),'PrimeCluster':('PRIM','FREQ','NOIS'),
              'PrimeCnoise':('PRCN','FREQ','NOIS'),'phasingCluster':('PHAS','FREQ','SPRD'),
              'basurilla':('BSRL','FREQ','PWID'),'arrayOnTheRocks':('ARRY','FREQ','FM'),
              'WalkingFilomena':('WALK','BND','PWID'), 'existencelsPain':('PAIN','RATE','SWP'),
              'whoKnows':('WHO','RATE','SWP'),'xModRingSqr':('XMSQ','FRQ1','FRQ2'),
              'XModRingSine':('XMSN','FRQ1','FRQ2'),'CrossModRing':('XMR','FREQ','FM'),
              'Atari':('ATAR','FRQ1','FRQ2'),'radioOhNo':('RAD','FREQ','PWID'),
              'resonoise':('RESO','FREQ','FOLD'),'Rwalk_BitCrushPW':('BITW','PWID','BITS'),
              'Rwalk_LFree':('LFRE','BND','SMTH'),'satanWorkout':('SATN','FREQ','PWMD'),
              'Rwalk_SineFMFlange':('FLNG','FREQ','RATE'), 'grainGlitch':('GRN1','FREQ','GRAI'),
              'grainGlitchII':('GRN2','FREQ','GRAI'),'grainGlitchIII':('GRN3','FREQ','GRAI')}
    panel={'name':'NZEPL','category':'NP',
      'knobs':[{'label':label,'default':value} for label,value in KNOBS],
      # MODE (knob 2) selects the program and relabels itself and the program's X/Y knobs.
      'modes':[{'knob':2,'zones':[{'min':math.ceil(i*128/len(names)),'max':math.ceil((i+1)*128/len(names))-1,
          'labels':dict(zip(('2','3','4'),captions[name]))} for i,name in enumerate(names)]}]}
    manifest={'format':'md-model/1','key':'NZE/PL',
      # the former key stays an alias, so layouts saved with it still find the model
      'aliases':['NP/PLETHORA'],'version':'0.1.0','kit_abi':1,
      'injection':{'mode':'add'},'panel':panel,'components':{'dsp2':{'source':'dsp2.asm','tables':'tables.asm','abi':'md-voice/1'}},
      'memory':[{'kind':'voice','space':'XY','words':64,'alignment':64,'lifetime':'track-assignment','init':'model','release':'successor-init'},
                {'kind':'pi','space':'XY','words':1536,'alignment':512,'lifetime':'track-assignment','init':'chunked-muted','release':'plain-audio'}],
      'samples':[],'budget':{'render_cps':129,'trigger_cycles':100,'init_cycles':300},
      'provenance':[{'origin':'Befaco Noise Plethora, original banks A-C','license':'GPL-3.0-or-later',
       'reference':'https://github.com/Befaco/Noise_plethora/tree/'+CATALOG['upstream_revision']}]}
    check_do_ends(source)
    destination.mkdir(parents=True,exist_ok=False)
    (destination/'model.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (destination/'dsp2.asm').write_text(source)
    # Tables the DSP code never names stay out of the pack (DSP2 RAM is the scarce resource);
    # reference-tables.json keeps them for checking against the integer reference.
    live={k:v for k,v in tables.items() if re.search(r'\b'+k+r'\b',source)}
    reference={k:v for k,v in tables.items() if k not in live}
    (destination/'tables.asm').write_text('; Formula-generated tables, GPL-3.0-or-later\n'+''.join(block_table(k,v) for k,v in live.items()))
    (destination/'reference-tables.json').write_text(json.dumps(reference)+'\n')
    for notice in ('COPYING','TEENSY-NOTICE.txt'):
        (destination/notice).write_bytes(Path(__file__).with_name(notice).read_bytes())
    print(json.dumps({'destination':str(destination),'implemented':names}))


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out',required=True,type=Path)
    args=ap.parse_args()
    generate(args.out)
