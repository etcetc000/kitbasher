"""Exercise below/above-cutoff envelopes in an assembled BD render image."""
import argparse
import hashlib
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
    out.mkdir(parents=True)
    paths=[source/'assembly.json',source/'code.bin',source/'sine.bin',a.host.resolve(),Path(__file__).resolve()]
    digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    inputs={str(path):digest(path) for path in paths}
    for name in ('code.bin','sine.bin'): shutil.copyfile(source/name,out/name)
    for name in ('code.bin','sine.bin'):
        copied=out/name
        if digest(copied)!=inputs[str(source/name)]: raise AssertionError('Copied image differs')
        paths.append(copied); inputs[str(copied)]=digest(copied)
    labels=json.loads((source/'assembly.json').read_text())['labels']; base=0x110023
    rows=[]
    for name,levels in [('below',(3,7,7)),('above',(32,64,64))]:
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800']
        for i,value in enumerate((51,102,75,0,0)):
            lines.append(f'set Y {0x801+i:x} {value*128:x}')
        lines += [f'call {base+labels["init"]:x}',f'call {base+labels["trigger"]:x}']
        for state,value in zip(('amp','clickenv','impenv'),levels):
            lines.append(f'set X {0x800+STATE.index(state):x} {value:x}')
        lines += ['scrub 1f',f'call {base+labels["render"]:x}']
        for state in ('amp','clickenv','impenv'):
            lines.append(f'dump X {0x800+STATE.index(state):x} 1')
        script=out/(name+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([a.host.resolve(),script.name,name+'.raw'],cwd=out)
        log=out/(name+'.log'); log.write_text(result.stdout+result.stderr)
        values=[int(s,16) for s in re.findall(r'^dump ([0-9a-fA-F]+)$',result.stdout,re.M)]
        passed=len(values)==3 and (values==[0,0,0] if name=='below' else all(0<v<=initial for v,initial in zip(values,levels)))
        rows.append(dict(case=name,initial=list(levels),after_32_samples=values,passed=passed,
                         output_sha256={str(path):digest(path) for path in (script,log)}))
    if inputs!={str(path):digest(path) for path in paths}: raise AssertionError('Probe inputs changed')
    report=dict(input_sha256=inputs,cases=rows,passed=all(row['passed'] for row in rows),hardware_validated=False)
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report,indent=2))
    if not report['passed']: raise AssertionError('Envelope cutoff behavior failed')


if __name__=='__main__': main()
