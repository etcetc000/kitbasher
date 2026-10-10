"""Compare complete TR6-SD assembly with pinned Simple606; no hardware claims."""
import argparse
import json
import itertools
import math
import os
from pathlib import Path
import re
import struct

from mds_build import ROOT, assemble_package, mds_format
from generate_sd import generate, STATE, OUTPUT_GAIN
from render_bd import run, write_wave

CASES=[('default',[102,64,95,64],0,0),('minimum',[0,0,0,0],0,0),
       ('maximum',[127,127,127,127],0,0),('zero_snappy',[127,64,0,64],0,0),
       ('low_color',[127,64,127,0],0,0),('retrigger',[102,64,95,64],137*32,0),
       ('pretrigger',[102,64,95,64],0,10*32)]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',required=True); p.add_argument('--host',required=True)
    p.add_argument('--compiler',default='clang++')
    selection=p.add_mutually_exclusive_group()
    selection.add_argument('--case',choices=[c[0] for c in CASES])
    selection.add_argument('--sweep-decay',action='store_true',help='Also check every integer decay setting')
    selection.add_argument('--corners',action='store_true',help='Also check all combinations of knob extremes')
    p.add_argument('--out',type=Path,default=ROOT/'build/sd-comparison')
    args=p.parse_args(); out=args.out.resolve(); out.mkdir(parents=True,exist_ok=True)
    source=generate(); (out/'sd.asm').write_text(source)
    package,build=assemble_package(source,json.loads((ROOT/'machines/sd/sd.json').read_text()),
                                   args.assembler,{'mds_sine':(1,1)})
    (out/'sd.mds').write_bytes(package); (out/'assembly.json').write_text(json.dumps(build,indent=2)+'\n')
    image=mds_format().parse_package(package); base=0x110023
    code=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
    for i in image['relocations']: code[i]+=base
    for i in image['imports']: code[i.patch_word]+=0x148000
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    exe=out/('reference.exe' if os.name=='nt' else 'reference')
    run([args.compiler,'-std=c++14','-O2','-I',ROOT/'.audit-sources/Simple606/Source',
         ROOT/'tests/sd_reference.cpp','-o',exe])
    report=[]
    cases=CASES+([(f'decay_{d:03d}',[d,64,95,64],0,0) for d in range(128)] if args.sweep_decay else [])
    if args.corners:
        cases += [(f'corner_{i:02d}',list(knobs),0,0) for i,knobs in enumerate(itertools.product((0,127),repeat=4))]
    for name,knobs,repeat,delay in cases:
        if args.case and name!=args.case: continue
        sweep=name.startswith(('decay_','corner_')); artifact='sweep' if sweep else name
        blocks=512 if sweep else 1024; samples=blocks*32
        reference=run([exe,*knobs,samples,repeat,delay,out/(artifact+'.reference.raw')])
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800',
               'set Y ff 123456','set Y 120 654321']
        for space in ('X','Y'): lines += [f'set {space} {0x800+i:x} 5a5a5a' for i in range(64)]
        for i,value in enumerate(knobs): lines.append(f'set Y {0x801+i:x} {value*128:x}')
        lines += ['scrub 1f',f'call {base+image["init_word"]:x}','cycles']
        for block in range(blocks):
            if block*32==delay or (repeat and block*32>delay and (block*32-delay)%repeat==0):
                lines += ['scrub 1f',f'call {base+image["mutate_word"]:x}','cycles']
            lines += [f'set Y {0x100+i:x} 5a5a5a' for i in range(32)]
            lines += ['scrub 1f',f'call {base+image["execute_word"]:x}','cycles','out']
        lines += ['dump Y 800 40','dump X 800 40','dump Y ff 1','dump Y 120 1']
        script=out/(artifact+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([Path(args.host).resolve(),script.name,artifact+'.raw'],cwd=out)
        (out/(artifact+'.host.log')).write_text(result.stdout+'\n'+result.stderr)
        actual_i=list(struct.unpack('<'+'i'*samples,(out/(artifact+'.raw')).read_bytes()))
        actual=[v/8388608 for v in actual_i]
        want=struct.unpack('<'+'f'*samples,(out/(artifact+'.reference.raw')).read_bytes())
        error=[a/OUTPUT_GAIN-b for a,b in zip(actual,want)]
        mse=sum(e*e for e in error)/samples; energy=sum(v*v for v in want)/samples
        cycles=[int(x) for x in re.findall(r'instructions \d+ cycles (\d+)',result.stdout)]
        dumps=[[int(w,16) for w in row.split()] for row in re.findall(r'^dump (.+)$',result.stdout,re.M)]
        expected_y=[0x5a5a5a]*64; expected_y[1:5]=[v*128 for v in knobs]
        refstate={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',reference.stdout)}
        native={name:dumps[1][i] for i,name in enumerate(STATE)}
        checks=dict(parameters=dumps[0]==expected_y,output_guards=dumps[2:]==[[0x123456],[0x654321]],
                    unused_state=dumps[1][len(STATE):]==[0x5a5a5a]*(64-len(STATE)),
                    active=native['active']==refstate['active'],frame=native['frame']==refstate['frame'],
                    duration=native['duration']==refstate['duration'],
                    rng=(native['rnghi']<<24|native['rnglo'])==refstate['rng'],
                    buffer_written=0x5a5a5a not in actual_i,
                    pretrigger=not delay or not any(actual_i[:delay]),
                    idle=bool(refstate['active']) or not any(actual_i[-32:]))
        metrics=dict(case=name,knobs=knobs,samples=samples,rms_error=math.sqrt(mse),
                     peak_error=max(abs(e) for e in error),snr_db=10*math.log10(energy/max(mse,1e-30)),
                     peak=max(abs(v) for v in actual),source_peak=max(abs(v) for v in want),
                     reference_output_peak=max(abs(v) for v in want)*OUTPUT_GAIN,
                     output_gain=OUTPUT_GAIN,error_domain='before output trim',
                     host_cycle_table_max_call=max(cycles),cold_cache_measured=False,
                     source_state=refstate,native_state={k:native[k] for k in ('active','frame','duration','rnglo','rnghi')},
                     state_checks=checks)
        report.append(metrics)
        if not sweep or not all(checks.values()) or metrics['peak_error']>0.0003:
            print(json.dumps(metrics),flush=True)
            write_wave(out/(artifact+'.wav'),actual)
            write_wave(out/(artifact+'.reference.wav'),[v*OUTPUT_GAIN for v in want])
        (out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
        if not all(checks.values()): raise AssertionError(f'{name}: state checks failed')
        # Initial numerical target; do not widen it to conceal unexplained errors.
        if metrics['peak_error']>0.0003: raise AssertionError(f'{name}: peak error exceeds 0.0003')
    print(json.dumps(dict(status='pass',cases=len(report),
                         worst_peak_error=max(row['peak_error'] for row in report))),flush=True)


if __name__=='__main__': main()
