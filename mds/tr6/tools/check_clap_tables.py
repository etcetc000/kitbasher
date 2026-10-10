"""Check CP trigger configuration for all 128 integer control positions.

This checks coefficients and state, not 128 full audio renders. No MIDI is used.
"""
import argparse
import json
from pathlib import Path
import re

from generate_clap import generate,build_reference,STATE
from generate_bd import word
from mds_build import ROOT,assemble_package,mds_format,assembly
from render_bd import run


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',required=True); p.add_argument('--host',required=True)
    p.add_argument('--compiler',default='clang++'); p.add_argument('--out',type=Path,default=ROOT/'build/cp-tables')
    a=p.parse_args(); out=a.out.resolve(); out.mkdir(parents=True,exist_ok=True)
    exe=build_reference(out,a.compiler); c=json.loads(run([exe,'--tables']).stdout)
    source=generate(c); (out/'cp.asm').write_text(source)
    package,build=assemble_package(source,json.loads((ROOT/'machines/cp/cp.json').read_text()),a.assembler,
                                   {'mds_sine':(1,1),'mds_track':(2,6)})
    image=mds_format().parse_package(package); base=0x110023; ext=0x160000
    code=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
    for i in image['relocations']: code[i]+=base
    for i in image['imports']: code[i.patch_word]+={1:0x148000,6:ext}[i.symbol]
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    stub,_=assembly.assemble(f'move #>0,r1\njmp >${base+image["init_word"]:x}\n',0x1000,exe=a.assembler)
    (out/'init.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in stub))
    lines=['load P 110023 code.bin','load P 1000 init.bin','voice 800','scrub 1f','call 1000']
    for i in range(128):
        lines += [f'set Y 801 {i*128:x}',f'set Y 802 {i*128:x}',f'set Y 803 {(127-i)*128:x}',
                  'scrub 1f',f'call {base+image["mutate_word"]:x}',
                  'dump X 800 40','dump Y 800 40','dump X 160000 300']
    (out/'tables.script').write_text('\n'.join(lines)+'\n')
    r=run([Path(a.host).resolve(),'tables.script','tables.raw'],cwd=out,timeout=600)
    (out/'tables.log').write_text(r.stdout+'\n'+r.stderr)
    dumps=[[int(w,16) for w in row.split()] for row in re.findall(r'^dump (.+)$',r.stdout,re.M)]
    assert len(dumps)==128*3
    rng=0x0606c1a9; peak=0
    for i in range(128):
        x,y,coeff=dumps[i*3:i*3+3]
        native={n:(x[j] if j<64 else y[j-64+9]) for j,n in enumerate(STATE)}
        for _ in range(192*6):
            rng ^= rng<<13; rng &=0xffffffff; rng ^= rng>>17; rng ^= rng<<5; rng &=0xffffffff
        assert (native['noisehi']<<24|native['noiselo'])==rng, ('prewarm RNG',i)
        assert native['taps']==c['pitch'][i]['taps'], ('tap count',i)
        assert native['histpos']==192%native['taps'], ('history position',i)
        assert native['direct']==int(c['pitch'][i]['core_step']==1), ('direct path',i)
        assert native['decay']==word(c['decay'][i]), ('decay',i)
        assert native['invdecay']==word(1/(32*c['decay'][i])), ('inverse decay',i)
        assert native['noisegain']==word(c['noise'][127-i][0]), ('noise gain',i)
        assert native['spread']==word(c['noise'][127-i][1]), ('air spread',i)
        assert native['invdiff']==word(1/(1+.45*c['noise'][127-i][1])), ('diffuse decay',i)
        assert all(native[n]==0 for n in ('frame','core_frame','generated','fraction','center','time','timefrac')), ('reset',i)
        for j,v in enumerate(v for row in c['pitch'][i]['coefficients'] for v in row):
            w=coeff[j]; w=w-(1<<24) if w&0x800000 else w
            peak=max(peak,abs(w/8388608-v))
    result=dict(status='pass' if peak<.00001 else 'fail',integer_positions=128,
                peak_coefficient_error=peak,coefficient_error_limit=.00001,
                exact_prewarm_rng=True,full_audio_sweep=False,program_words=build['program_words'])
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))
    if result['status']!='pass': raise AssertionError('CP coefficient sweep failed')


if __name__=='__main__': main()
