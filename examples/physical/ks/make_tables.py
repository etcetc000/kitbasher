"""Regenerate original example curves; optional authoring tool, never run by intake."""
import math
from pathlib import Path

def generate():
    # PTCH: raw = 2 (MIDI - 24), MIDI 24..87.5 in half-semitone steps. The whole loop delay
    # in samples with 12 fraction bits; the render takes the DAMP averager's delay off it and
    # splits the rest into the ring length and the interpolating tap's fraction.
    period=[round(4096*44100/(440*2**((24+k/2-69)/12))) for k in range(128)]
    feedback=[round((.90+.0999*(k/127)**.5)*(1<<23)) for k in range(128)]
    hammer=[round(k/127*((1<<23)-1)) for k in range(128)]
    pick=[round((.02+.98*(k/127)**2)*((1<<23)-1)) for k in range(128)]
    # Envelope time constant 1..250 ms, updated once per 32-sample block.
    bend_decay=[round(math.exp(-32/(44100*.001*250**(k/127)))*((1<<23)-1)) for k in range(128)]
    lines=['; Original formula-generated constants. SPDX-License-Identifier: MIT']
    for name,words in [('period',period),('feedback',feedback),('hammer',hammer),('pick',pick),('bend_decay',bend_decay)]:
        lines.append(name+':')
        lines.extend('    .dc '+','.join(f'${w:06x}' for w in words[i:i+8]) for i in range(0,len(words),8))
    return '\n'.join(lines)+'\n'

if __name__=='__main__':
    Path(__file__).with_name('tables.asm').write_text(generate(), newline='\n')
