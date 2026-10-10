"""Compare BD activity specializations at envelope and tail boundaries."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import re
import shutil

from generate_bd import STATE
from render_bd import run


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline',type=Path,required=True)
    p.add_argument('--candidate',type=Path,required=True)
    p.add_argument('--host',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); out=a.out.resolve()
    if out.exists(): p.error('Use a fresh output directory')
    out.mkdir(parents=True)
    sources=[a.baseline.resolve(),a.candidate.resolve()]
    paths=[a.host.resolve(),Path(__file__).resolve()]
    for source in sources:
        paths.extend(source/name for name in ('assembly.json','code.bin','sine.bin','comparison.json'))
    inputs={str(path):digest(path) for path in paths}
    models=[json.loads((source/'comparison.json').read_text())[0]['reference_model'] for source in sources]
    if models[0]!=models[1] or models[0].get('mix_filter')!='shared-body-lowpass':
        raise ValueError('Probe requires matching shared-filter BD models')
    # Zero, sub-step, exact-step and above-step envelopes; source, immediate
    # and nearly frozen endpoints; both signs around the output-tail cutoff.
    cases=list(itertools.product((0,1,31,32,33,64),(0,1,31,32,33,64),
        (0,30,31),(-512,0,512),(0,127),(None,0,0x7fffff)))
    outputs=[]
    for index,source in enumerate(sources):
        target=out/str(index); target.mkdir()
        for name in ('code.bin','sine.bin'):
            shutil.copyfile(source/name,target/name)
            if digest(target/name)!=inputs[str(source/name)]: raise AssertionError('Copied image differs')
        labels=json.loads((source/'assembly.json').read_text())['labels']; base=0x110023
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800']
        for amp,click,silent,tail,heat,coefficient in cases:
            lines+=['set Y ff 123456','set Y 120 654321']
            lines.extend(f'set X {0x800+i:x} 5a5a5a' for i in range(64))
            lines.extend(f'set Y {0x801+i:x} {value*128:x}' for i,value in enumerate((51,102,75,heat,0)))
            lines += [f'call {base+labels["init"]:x}',f'call {base+labels["trigger"]:x}']
            states=dict(amp=amp,clickenv=click,silent=silent,bodylp=tail,dcin=tail,dcout=tail)
            if coefficient is not None: states.update(ampcoef=coefficient,clickcoef=coefficient)
            lines.extend(f'set X {0x800+STATE.index(name):x} {value&0xffffff:x}' for name,value in states.items())
            for _ in range(3):
                lines+=['scrub 1f',f'call {base+labels["render"]:x}','out',
                        'dump X 800 40','dump Y 800 40','dump Y ff 1','dump Y 120 1']
        script=target/'probe.script'; script.write_text('\n'.join(lines)+'\n')
        result=run([a.host.resolve(),script.name,'probe.raw'],cwd=target,timeout=600)
        log=target/'probe.log'; log.write_text(result.stdout+result.stderr)
        dumps=re.findall(r'^dump (.+)$',result.stdout,re.M)
        raw=(target/'probe.raw').read_bytes()
        if len(dumps)!=len(cases)*3*4 or len(raw)!=len(cases)*3*32*4:
            raise AssertionError('Incomplete boundary render')
        outputs.append((raw,dumps))
    audio_equal=outputs[0][0]==outputs[1][0]
    state_equal=outputs[0][1]==outputs[1][1]
    if inputs!={str(path):digest(path) for path in paths}: raise AssertionError('Inputs changed')
    report=dict(input_sha256=inputs,fixtures=len(cases),blocks_per_fixture=3,
        native_audio_bitexact=audio_equal,all_block_states_bitexact=state_equal,
        output_sha256={str(path):digest(path) for path in out.glob('*/*')},hardware_validated=False)
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('sha256')}))
    if not audio_equal or not state_equal: raise AssertionError('Activity specialization differs')


if __name__=='__main__': main()
