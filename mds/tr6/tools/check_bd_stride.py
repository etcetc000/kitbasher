"""Check half-rate BD frequency range and causal output interpolation natively."""
import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import shutil
import struct

from generate_bd import STATE
from render_bd import run


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def check_interpolation(raw):
    if not raw or len(raw)%8: raise AssertionError('Missing or incomplete output pairs')
    values=struct.unpack('<'+'i'*(len(raw)//4),raw); previous=0
    for offset in range(0,len(values),2):
        midpoint,current=values[offset:offset+2]
        if midpoint!=(previous+current)//2:
            raise AssertionError(f'Interpolation/history differs at output sample {offset}')
        previous=current
    return len(values)//2


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('render','host','out'): p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args(); source=a.render.resolve(); out=a.out.resolve()
    if out.exists(): p.error('Use a fresh output directory')
    rows=json.loads((source/'comparison.json').read_text())
    if not rows or any(r['reference_model'].get('render_stride')!=2 for r in rows):
        p.error('Requires completed stride-2 BD renders')
    paths=[source/name for name in ('assembly.json','code.bin','sine.bin','comparison.json')]
    paths += [source/(row['case']+'.raw') for row in rows]
    paths += [a.host.resolve(),Path(__file__).resolve(),Path(__file__).with_name('generate_bd.py'),Path(__file__).with_name('render_bd.py')]
    inputs={str(path):digest(path) for path in paths}
    render_pairs={r['case']:check_interpolation((source/(r['case']+'.raw')).read_bytes()) for r in rows}
    out.mkdir(parents=True)
    for name in ('code.bin','sine.bin'):
        shutil.copyfile(source/name,out/name)
        if digest(out/name)!=inputs[str(source/name)]: raise AssertionError('Copied image differs')
    labels=json.loads((source/'assembly.json').read_text())['labels']; base=0x110023
    cases=list(itertools.product((0,43,85,127),range(128)))
    lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800']
    for transient,tune in cases:
        lines+=['set Y ff 123456','set Y 120 654321']
        lines.extend(f'set Y {0x801+i:x} {value if i==4 else value*128:x}' for i,value in enumerate((transient,127,tune,127,1)))
        lines += [f'call {base+labels["init"]:x}',f'call {base+labels["trigger"]:x}',
                  'dump X 800 40','scrub 1f',f'call {base+labels["render"]:x}','out',
                  'dump X 800 40','dump Y ff 1','dump Y 120 1']
    script=out/'probe.script';script.write_text('\n'.join(lines)+'\n')
    result=run([a.host.resolve(),script.name,'probe.raw'],cwd=out,timeout=600)
    (out/'probe.log').write_text(result.stdout+result.stderr)
    dumps=[tuple(int(v,16) for v in line.split()) for line in re.findall(r'^dump (.+)$',result.stdout,re.M)]
    raw=(out/'probe.raw').read_bytes()
    if len(dumps)!=len(cases)*4 or len(raw)!=len(cases)*32*4: raise AssertionError('Incomplete range probe')
    frequency_errors=[];coefficient_errors=[]
    for i,(transient,tune) in enumerate(cases):
        before,after,low,high=dumps[i*4:i*4+4]
        if len(before)!=64 or len(after)!=64 or (low,high)!=((0x123456,),(0x654321,)):
            raise AssertionError('State/output bounds differ')
        check_interpolation(raw[i*128:(i+1)*128])  # INIT resets history per fixture.
        start=before[STATE.index('freq')]; final=after[STATE.index('freq')]
        if not 0<start<0x800000 or not 0<final<0x800000:
            raise AssertionError(f'Signed frequency overflow at TRANS={transient}, TUNE={tune}')
        shape=.1+.5*(transient/127)**.75
        expected=116.48*(1+.28*shape*shape)*2**((-12+24*tune/127)/12)
        error=abs(start*44100/(1<<30)-expected);frequency_errors.append(error)
        if error>.001: raise AssertionError(f'Frequency scale differs at TRANS={transient}, TUNE={tune}: {error} Hz')
        step=after[STATE.index('freqerr')];step=step-(1<<24) if step&0x800000 else step
        mean_hz=.5*(start+final+step)*44100/(1<<30)
        expected_k=2*math.sin(math.pi*mean_hz/22050)
        error=abs(after[STATE.index('z2')]/(1<<23)-expected_k);coefficient_errors.append(error)
        if error>1.e-6: raise AssertionError('Oscillator coefficient uses wrong rate or frequency scale')
    if inputs!={str(path):digest(path) for path in paths}: raise AssertionError('Inputs changed')
    report=dict(fixtures=len(cases),render_output_pairs=render_pairs,
        interpolation_exact=True,maximum_frequency_error_hz=max(frequency_errors),
        maximum_coefficient_error=max(coefficient_errors),input_sha256=inputs,
        output_sha256={str(path):digest(path) for path in (script,out/'probe.raw',out/'probe.log')},hardware_validated=False)
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('sha256')}))


if __name__=='__main__': main()
