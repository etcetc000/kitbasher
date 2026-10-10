"""Compare full LT/HT ports with pinned Simple606 audio and random/state behavior."""
import argparse
import json
import math
from pathlib import Path
import re
import struct
import hashlib
import shutil
import sys

from mds_build import ROOT, assemble_package, mds_format
from generate_toms import generate, build_reference, state_layout, OUTPUT_GAIN
from render_bd import run, write_wave

CASES = [('default',[102,64],0,0), ('minimum',[0,0],0,0), ('maximum',[127,127],0,0),
         ('low_pitch',[127,0],0,0), ('short_high_pitch',[0,127],0,0),
         ('retrigger',[102,64],137*32,0), ('pretrigger',[102,64],0,10*32),
         ('retrigger_idle',[0,64],137*32,0)]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('kind',choices=['lt','ht']); p.add_argument('--assembler',required=True)
    p.add_argument('--host',required=True); p.add_argument('--compiler',default='clang++')
    choice=p.add_mutually_exclusive_group()
    choice.add_argument('--case',choices=[c[0] for c in CASES])
    choice.add_argument('--sweep-decay',action='store_true')
    p.add_argument('--out',type=Path)
    p.add_argument('--deduplicate-tables',action='store_true',help='Share identical literal tables without changing their values')
    a=p.parse_args(); kind=a.kind
    out=(a.out or ROOT/('build/'+kind+('-dedup' if a.deduplicate_tables else '-comparison'))).resolve(); out.mkdir(parents=True,exist_ok=True)
    exe=build_reference(out,a.compiler); controls=json.loads(run([exe,'--tables',kind]).stdout)
    (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
    source=generate(kind,controls,a.deduplicate_tables); (out/(kind+'.asm')).write_text(source)
    package,build=assemble_package(source,json.loads((ROOT/f'machines/{kind}/{kind}.json').read_text()),a.assembler,{'mds_sine':(1,1)})
    (out/(kind+'.mds')).write_bytes(package); (out/'assembly.json').write_text(json.dumps(build,indent=2)+'\n')
    image=mds_format().parse_package(package); base=0x110023
    code=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
    for i in image['relocations']: code[i]+=base
    for i in image['imports']: code[i.patch_word]+=0x148000
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    def hashes(paths): return {str(path.resolve()):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    source_root=ROOT/'.audit-sources/Simple606/Source'
    input_paths=[Path(a.host).resolve(),Path(a.assembler).resolve(),Path(shutil.which(a.compiler) or a.compiler).resolve(),exe,
                 Path(__file__).resolve(),ROOT/'tools/generate_toms.py',ROOT/'tools/table_pool.py',ROOT/'tools/mds_build.py',ROOT/'tools/render_bd.py',
                 ROOT/'tests/tom_reference.cpp',source_root/'Toms.hpp',source_root/'SynthDrumCommon.hpp',
                 out/'controls.json',out/(kind+'.asm'),out/(kind+'.mds'),out/'assembly.json',out/'code.bin',out/'sine.bin']
    captured_hashes=hashes(input_paths)
    provenance=dict(command=sys.argv,configuration={k:str(v) if isinstance(v,Path) else v for k,v in vars(a).items()},
                    captured_before_render=True,inputs_sha256=captured_hashes,cases=[],complete=False)
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    layout=state_layout(kind); report=[]
    cases=CASES+([(f'decay_{d:03d}',[d,64],0,0) for d in range(128)] if a.sweep_decay else [])
    for name,knobs,repeat,delay in cases:
        if a.case and name!=a.case: continue
        sweep=name.startswith('decay_'); artifact=name
        blocks=1024 if sweep else 2048; samples=blocks*32
        reference=run([exe,kind,*knobs,samples,repeat,delay,out/(artifact+'.reference.raw')])
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800',
               'set Y ff 123456','set Y 120 654321','set X 7ff 123456','set X 840 654321',
               'set Y 7ff 123456','set Y 840 654321']
        for space in ('X','Y'): lines += [f'set {space} {0x800+i:x} 5a5a5a' for i in range(64)]
        for i,v in enumerate(knobs): lines.append(f'set Y {0x801+i:x} {v*128:x}')
        lines+=['scrub 1f',f'call {base+image["init_word"]:x}','cycles']
        for block in range(blocks):
            if block*32==delay or (repeat and block*32>delay and (block*32-delay)%repeat==0):
                lines+=['scrub 1f',f'call {base+image["mutate_word"]:x}','cycles']
            lines += [f'set Y {0x100+i:x} 5a5a5a' for i in range(32)]
            lines+=['scrub 1f',f'call {base+image["execute_word"]:x}','cycles','out']
        lines+=['dump X 800 40','dump Y 800 40','dump Y ff 1','dump Y 120 1',
                'dump X 7ff 1','dump X 840 1','dump Y 7ff 1','dump Y 840 1']
        script=out/(artifact+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([Path(a.host).resolve(),script.name,artifact+'.raw'],cwd=out)
        (out/(artifact+'.host.log')).write_text(result.stdout+'\n'+result.stderr)
        native_i=struct.unpack('<'+'i'*samples,(out/(artifact+'.raw')).read_bytes())
        actual=[x/8388608 for x in native_i]
        want=struct.unpack('<'+'f'*samples,(out/(artifact+'.reference.raw')).read_bytes())
        error=[x/OUTPUT_GAIN-y for x,y in zip(actual,want)]
        mse=sum(e*e for e in error)/samples; energy=sum(v*v for v in want)/samples
        dumps=[[int(w,16) for w in row.split()] for row in re.findall(r'^dump (.+)$',result.stdout,re.M)]
        native={n:dumps[0 if s=='X' else 1][i] for n,(s,i) in layout.items()}
        ref={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',reference.stdout)}
        reserved=True
        for si,s in enumerate(('X','Y')):
            used={i for space,i in layout.values() if space==s}
            for i in range(64):
                if i in used: continue
                expected=knobs[i-1]*128 if s=='Y' and i in (1,2) else 0x5a5a5a
                reserved=reserved and dumps[si][i]==expected
        checks=dict(reserved_words=reserved,guards=dumps[2:]==[[0x123456],[0x654321]]*3,
                    active=native['active']==ref['active'],frame=native['frame']==ref['frame'],
                    duration=native['duration']==controls['decay'][knobs[0]]['duration'],
                    buffer_written=0x5a5a5a not in native_i,
                    pretrigger=not delay or not any(native_i[:delay]),
                    idle=bool(ref['active']) or not any(native_i[-32:]))
        for n in ('low','high','tail'): checks[n+'_rng']=(native[n+'hi']<<24|native[n+'lo'])==ref[n+'_rng']
        peak_error=max(abs(e) for e in error); tolerance=.0005
        cycles=[int(x) for x in re.findall(r'instructions \d+ cycles (\d+)',result.stdout)]
        metrics=dict(machine=kind,case=name,knobs=knobs,samples=samples,peak_error=peak_error,
                     rms_error=math.sqrt(mse),snr_db=10*math.log10(energy/max(mse,1e-30)),
                     native_peak=max(abs(x) for x in actual),reference_peak=max(abs(x) for x in want),
                     output_gain=OUTPUT_GAIN,peak_error_limit=tolerance,numeric_pass=peak_error<tolerance,
                     checks=checks,source_state=ref,native_state={n:native[n] for n in ('active','frame','duration')},
                     program_words=build['program_words'],state_words=len(layout),deduplicate_tables=a.deduplicate_tables,
                     host_cycle_table_max_call=max(cycles),cold_cache_measured=False)
        report.append(metrics); (out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
        write_wave(out/(artifact+'.wav'),actual)
        write_wave(out/(artifact+'.reference.wav'),[v*OUTPUT_GAIN for v in want])
        print(json.dumps(metrics),flush=True)
        if not metrics['numeric_pass'] or not all(checks.values()): raise AssertionError(f'{kind}/{name} comparison failed')
        if hashes(input_paths)!=captured_hashes: raise AssertionError('Render input/tool changed during the run')
        provenance['cases'].append(dict(name=name,knobs=knobs,samples=samples,repeat_samples=repeat,delay_samples=delay,
            output_sha256=hashes([script,out/(artifact+'.raw'),out/(artifact+'.reference.raw'),out/(artifact+'.host.log')]),checks_pass=True))
        (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    provenance['complete']=True
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')


if __name__=='__main__': main()
