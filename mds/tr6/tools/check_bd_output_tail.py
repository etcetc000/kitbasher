"""Check that rounded BD feedback releases even at its fixed-point floor."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import re
import shutil

from generate_bd import STATE
from render_bd import run


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--render',type=Path,required=True)
    p.add_argument('--host',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); source=a.render.resolve(); out=a.out.resolve()
    if out.exists(): p.error('Use a fresh output directory')
    model=json.loads((source/'comparison.json').read_text())[0]['reference_model']
    if model.get('output_filter')!='rounded-dc': p.error('Expected rounded DC model')
    out.mkdir(parents=True)
    paths=[source/name for name in ('assembly.json','code.bin','sine.bin','comparison.json')]
    paths += [a.host.resolve(),Path(__file__).resolve(),Path(__file__).with_name('generate_bd.py').resolve(),Path(__file__).with_name('render_bd.py').resolve()]
    digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    inputs={str(path):digest(path) for path in paths}
    for name in ('code.bin','sine.bin'):
        shutil.copyfile(source/name,out/name)
        if digest(out/name)!=inputs[str(source/name)]: raise AssertionError('Copied image differs')
    labels=json.loads((source/'assembly.json').read_text())['labels']; base=0x110023
    values=(0,1,-1,99,-99,100,-100,101,-101,192,-192,256,-256,4096,-4096)
    cases=list(itertools.product(values,(0,31),(0,127))); blocks=64
    lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800']
    for value,silent,heat in cases:
        lines+=['set Y ff 123456','set Y 120 654321']
        lines.extend(f'set Y {0x801+i:x} {v*128:x}' for i,v in enumerate((51,102,75,heat,0)))
        lines += [f'call {base+labels["init"]:x}',f'call {base+labels["trigger"]:x}']
        for name,v in dict(amp=0,clickenv=0,impenv=0,bodylp=0,dcin=0,dcout=value,dcerr=0,silent=silent).items():
            lines.append(f'set X {0x800+STATE.index(name):x} {v&0xffffff:x}')
        for _ in range(blocks): lines+=['scrub 1f',f'call {base+labels["render"]:x}','out']
        lines+=['dump X 800 1','dump Y ff 1','dump Y 120 1']
    script=out/'probe.script'; script.write_text('\n'.join(lines)+'\n')
    result=run([a.host.resolve(),script.name,'probe.raw'],cwd=out,timeout=600)
    (out/'probe.log').write_text(result.stdout+result.stderr)
    dumps=[int(v,16) for v in re.findall(r'^dump ([0-9a-fA-F]+)$',result.stdout,re.M)]
    raw=(out/'probe.raw').read_bytes(); stride=blocks*32*4
    if len(dumps)!=len(cases)*3 or len(raw)!=len(cases)*stride: raise AssertionError('Incomplete tail probe')
    rows=[]
    for i,(value,silent,heat) in enumerate(cases):
        active,low,high=dumps[i*3:i*3+3]
        zero=raw[(i+1)*stride-32*4:(i+1)*stride]==bytes(32*4)
        rows.append(dict(dcout=value,silent=silent,heat=heat,active=active,
            final_block_zero=zero,passed=active==0 and zero and (low,high)==(0x123456,0x654321)))
    if inputs!={str(path):digest(path) for path in paths}: raise AssertionError('Inputs changed')
    report=dict(input_sha256=inputs,cases=rows,passed=all(row['passed'] for row in rows),
        output_sha256={str(path):digest(path) for path in (script,out/'probe.log',out/'probe.raw')},hardware_validated=False)
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(cases=len(cases),passed=report['passed'])))
    if not report['passed']: raise AssertionError('Rounded feedback failed to release')


if __name__=='__main__': main()
