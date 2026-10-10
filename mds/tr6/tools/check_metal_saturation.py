"""Exercise the emitted cubic kernel, including limits not reached by audio cases."""
import argparse
import json
from pathlib import Path
import re

from compare_variants import digest
from mds_build import assembly
from render_bd import run


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path,help='Generated CH/OH/CY assembly with --cubic-saturation')
    p.add_argument('--assembler',required=True); p.add_argument('--host',required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); source=a.source.resolve(); out=a.out.resolve()
    if out.exists(): p.error('Use a new output directory')
    text=source.read_text()
    marker='    move #>$080000,x0\n    cmp x0,a\n    tgt x0,a\n'
    if text.count(marker)!=1 or text.count('lean_output:')!=1:
        raise ValueError('Expected one emitted cubic kernel and output boundary')
    kernel=text[text.index(marker):text.index('lean_output:')]
    if not kernel.endswith('    mpy x0,y0,a\n'):
        raise ValueError('Unexpected cubic kernel boundary')
    # Cover the prior tanh domain plus one/two Q19 steps around each limit/zero.
    values=sorted(set([round((-8+i/16)*(1<<19)) for i in range(257)]
                      +[v+d for v in (-(1<<19),0,1<<19) for d in (-2,-1,0,1,2)]))
    out.mkdir(parents=True)
    fixture=('    move #>$3000,r0\n    move #>$4000,r1\n'
             f'    do #{len(values)},curve_end\n    move x:(r0)+,a\n'
             +kernel+'    move a1,y:(r1)+\ncurve_end:\n    rts\n')
    (out/'curve.asm').write_text(fixture)
    code,_=assembly.assemble(fixture,0x110023,exe=a.assembler)
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    (out/'inputs.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in values))
    (out/'curve.script').write_text('load P 110023 code.bin\nload X 3000 inputs.bin\n'
        f'scrub 1f\ncall 110023\ndump Y 4000 {len(values):x}\n')
    result=run([Path(a.host).resolve(),'curve.script','curve.raw'],cwd=out)
    (out/'curve.log').write_text(result.stdout+'\n'+result.stderr)
    dumps=re.findall(r'^dump (.+)$',result.stdout,re.M)
    if len(dumps)!=1: raise AssertionError('Expected one output dump')
    words=[int(w,16) for w in dumps[0].split()]
    if len(words)!=len(values): raise AssertionError('Incomplete output')
    actual=[(w-(1<<24) if w&(1<<23) else w)/(1<<19) for w in words]
    expected=[max(-1,min(1,v/(1<<19))) for v in values]
    expected=[x-.25*x*x*x for x in expected]
    error=max(abs(x-y) for x,y in zip(actual,expected))
    bounded=all(-.750004<=x<=.750004 for x in actual)
    monotone=all(b>=a for a,b in zip(actual,actual[1:]))
    if error>=4e-6 or not bounded or not monotone:
        raise AssertionError('Cubic curve error, bound or monotonicity failure')
    paths=[source,Path(a.assembler).resolve(),Path(a.host).resolve(),Path(__file__).resolve(),
           out/'curve.asm',out/'code.bin',out/'inputs.bin',out/'curve.script',out/'curve.log']
    report=dict(cases=len(values),input_range=[-8,8],max_error_fs=error,
                bounded=bounded,monotone=monotone,input_sha256={str(path):digest(path) for path in paths})
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='input_sha256'}))


if __name__=='__main__': main()
