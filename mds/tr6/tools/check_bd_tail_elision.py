"""Verify tail audio, live state, RNG draw count, and subsequent BD retriggers.

Only lastbody/z1 may differ, and only after both envelopes reach zero. These
oscillator coordinates cannot affect output again before TRIG resets them.
The ordinary bit-exact comparator retains its stricter all-state contract.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import re
import shutil

from compare_variants import compare, final_dumps
from generate_bd import STATE
from render_bd import run


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def state_differences(old, new):
    if len(old)!=64 or len(new)!=64:
        raise AssertionError('Expected complete local X state')
    dead=all(words[STATE.index(name)]==0 for words in (old,new) for name in ('amp','clickenv'))
    allowed={STATE.index(name) for name in ('lastbody','z1')} if dead else set()
    differences=[i for i,(a,b) in enumerate(zip(old,new)) if a!=b]
    if set(differences)-allowed:
        raise AssertionError(f'Live state differs at {differences}; dead coordinates allowed={sorted(allowed)}')
    return differences


def compare_render(baseline, candidate):
    rows=compare(baseline,candidate)
    if not rows: raise AssertionError('Empty render comparison')
    for row in rows:
        if not row['native_audio_bitexact']: raise AssertionError(f'{row["case"]}: audio differs')
        old=final_dumps(baseline,row['case']); new=final_dumps(candidate,row['case'])
        if old.keys()!=new.keys(): raise AssertionError('Dump requests differ')
        exceptions=[]
        for key,values in old.items():
            if key==('X',0x800,64):
                exceptions=state_differences(values,new[key])
            elif values!=new[key]: raise AssertionError(f'{row["case"]}: other state/guards differ: {key}')
        row['dead_oscillator_differences']=[STATE[i] for i in exceptions]
        row['live_state_bitexact']=True
    return rows


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('baseline','candidate','host','out'): p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args(); out=a.out.resolve()
    if out.exists(): p.error('Use a fresh output directory')
    sources=[a.baseline.resolve(),a.candidate.resolve()]
    models=[json.loads((source/'comparison.json').read_text())[0] for source in sources]
    if (models[0]['reference_model']!=models[1]['reference_model'] or
        models[0]['reference_model'].get('mix_filter')!='shared-body-lowpass' or
        models[0].get('tail_elision',False) or not models[1].get('tail_elision')):
        raise ValueError('Requires matching BD models, with only candidate tail elision enabled')
    paths=[a.host.resolve(),Path(__file__).resolve(),Path(__file__).with_name('generate_bd.py'),
           Path(__file__).with_name('render_bd.py'),Path(__file__).with_name('compare_variants.py')]
    for source in sources:
        paths.extend(source/name for name in ('assembly.json','code.bin','sine.bin','comparison.json'))
        for row in json.loads((source/'comparison.json').read_text()):
            paths.extend(source/(row['case']+suffix) for suffix in ('.raw','.reference.raw','.script','.host.log'))
    inputs={str(path):digest(path) for path in paths}
    rows=compare_render(*sources)
    out.mkdir(parents=True)
    seeds=(0,1,0x7fffff,0x800000,0xffffff,0x606606)
    cases=[dict(silent=silent,seed=seed,heat=heat,mode=mode)
           for silent,seed,heat,mode in itertools.product(range(32),seeds,(0,127),('release',))]
    cases += [dict(silent=0,seed=seed,heat=heat,mode=mode)
              for seed,heat,mode in itertools.product(seeds,(0,127),('inactive','sustained-tail'))]
    outputs=[]; snapshots=5; blocks=4
    for source_index,source in enumerate(sources):
        target=out/str(source_index); target.mkdir()
        for name in ('code.bin','sine.bin'):
            shutil.copyfile(source/name,target/name)
            if digest(target/name)!=inputs[str(source/name)]: raise AssertionError('Image copy differs')
        labels=json.loads((source/'assembly.json').read_text())['labels']; base=0x110023
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800']
        dumps=['dump X 800 40','dump Y 800 40','dump Y ff 1','dump Y 120 1']
        for case in cases:
            lines+=['set Y ff 123456','set Y 120 654321']
            for space in ('X','Y'): lines.extend(f'set {space} {0x800+i:x} 5a5a5a' for i in range(64))
            lines.extend(f'set Y {0x801+i:x} {v*128:x}' for i,v in enumerate((51,102,75,case['heat'],0)))
            lines += [f'call {base+labels["init"]:x}',f'call {base+labels["trigger"]:x}']
            states=dict(amp=0,clickenv=0,impenv=0,bodylp=0,dcin=0,dcout=0,dcerr=0,
                        silent=case['silent'],rnglo=case['seed'],rnghi=0xa5,
                        active=int(case['mode']!='inactive'))
            if case['mode']=='sustained-tail': states['dcout']=0x100000
            lines.extend(f'set X {0x800+STATE.index(name):x} {v&0xffffff:x}' for name,v in states.items())
            for _ in range(2): lines+=['scrub 1f',f'call {base+labels["render"]:x}','out',*dumps]
            lines += [f'call {base+labels["trigger"]:x}',*dumps]
            for _ in range(2): lines+=['scrub 1f',f'call {base+labels["render"]:x}','out',*dumps]
        script=target/'probe.script'; script.write_text('\n'.join(lines)+'\n')
        result=run([a.host.resolve(),script.name,'probe.raw'],cwd=target,timeout=600)
        (target/'probe.log').write_text(result.stdout+result.stderr)
        words=[tuple(int(v,16) for v in row.split()) for row in re.findall(r'^dump (.+)$',result.stdout,re.M)]
        raw=(target/'probe.raw').read_bytes()
        if len(words)!=len(cases)*snapshots*4 or len(raw)!=len(cases)*blocks*32*4:
            raise AssertionError('Incomplete tail probe')
        if any(len(v)!=(64 if i%4<2 else 1) for i,v in enumerate(words)):
            raise AssertionError('Truncated dump')
        outputs.append((raw,words))
    if outputs[0][0]!=outputs[1][0]: raise AssertionError('Tail/retrigger audio differs')
    dead_differences=0
    for i,case in enumerate(cases):
        expected=case['seed']
        for block in range(2):
            draws=(32-case['silent'] if block==0 else 0) if case['mode']=='release' else (32 if case['mode']=='sustained-tail' else 0)
            for _ in range(draws): expected=(1664525*expected+1013904223)&0xffffff
            for _,words in outputs:
                state=words[(i*snapshots+block)*4]
                if state[STATE.index('rnglo')]!=expected: raise AssertionError(f'RNG draw count differs: {case}, block {block}')
                if state[0]!=int(case['mode']=='sustained-tail'): raise AssertionError('Unexpected tail lifetime')
        for snapshot in range(snapshots):
            offset=(i*snapshots+snapshot)*4
            old=outputs[0][1][offset:offset+4]; new=outputs[1][1][offset:offset+4]
            differences=state_differences(old[0],new[0])
            dead_differences+=bool(differences)
            if snapshot>=2 and differences: raise AssertionError('Retrigger failed to reset oscillator state')
            if old[1:]!=new[1:] or old[2:]!=[(0x123456,),(0x654321,)]:
                raise AssertionError('Parameters or output guards differ')
    if inputs!={str(path):digest(path) for path in paths}: raise AssertionError('Inputs changed')
    report=dict(input_sha256=inputs,render_cases=rows,fixtures=len(cases),blocks_per_fixture=blocks,
        state_snapshots_per_fixture=snapshots,native_audio_bitexact=True,live_state_bitexact=True,
        rng_draw_counts_verified=True,retrigger_all_state_bitexact=True,dead_state_snapshots=dead_differences,
        output_sha256={str(path):digest(path) for path in out.glob('*/*')},hardware_validated=False)
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('input_sha256','output_sha256','render_cases')}))


if __name__=='__main__': main()
