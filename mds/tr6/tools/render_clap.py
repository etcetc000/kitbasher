"""Compare the complete CP draft with Simple606, including external-track guards."""
import argparse
import json
import math
from pathlib import Path
import re
import struct

from mds_build import ROOT, assemble_package, mds_format, assembly
from generate_clap import generate, build_reference, STATE, EXTERNAL_WORDS, OUTPUT_GAIN
from render_bd import run, write_wave


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',required=True)
    p.add_argument('--host',required=True); p.add_argument('--compiler',default='clang++')
    p.add_argument('--case',choices=['default','minimum','maximum','low_pitch','short_high_pitch','below_unity','noise_left_center','dry','air','retrigger','pretrigger','retrigger_idle'])
    p.add_argument('--blocks',type=int,help='Diagnostic override; may end before the voice goes idle')
    p.add_argument('--track',type=int,default=3,choices=range(16))
    p.add_argument('--out',type=Path)
    a=p.parse_args(); kind='cp'
    out=(a.out or ROOT/f'build/{kind}-comparison').resolve(); out.mkdir(parents=True,exist_ok=True)
    exe=build_reference(out,a.compiler); controls=json.loads(run([exe,'--tables']).stdout)
    (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
    source=generate(controls); (out/(kind+'.asm')).write_text(source)
    package,build=assemble_package(source,json.loads((ROOT/f'machines/{kind}/{kind}.json').read_text()),a.assembler,
                                   {'mds_sine':(1,1),'mds_track':(2,6)})
    (out/(kind+'.mds')).write_bytes(package); (out/'assembly.json').write_text(json.dumps(build,indent=2)+'\n')
    image=mds_format().parse_package(package); base=0x110023; extbase=0x160000; ext=extbase+a.track*1536
    code=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
    for i in image['relocations']: code[i]+=base
    for i in image['imports']: code[i.patch_word]+={1:0x148000,6:extbase}[i.symbol]
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    # The existing instruction host has no register-set command. This test-only
    # trampoline supplies INIT's R1 track number without changing the machine.
    stub,_=assembly.assemble(f'move #>{a.track},r1\njmp >${base+image["init_word"]:x}\n',0x1000,exe=a.assembler)
    (out/'init-stub.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in stub))
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    cases=[('default',[102,64,64],0,0),('minimum',[0,0,0],0,0),('maximum',[127,127,127],0,0),
           ('low_pitch',[127,0,127],0,0),('short_high_pitch',[0,127,64],0,0),
           ('below_unity',[127,63,127],0,0),('noise_left_center',[102,64,63],0,0),
           ('dry',[102,64,0],0,0),('air',[102,64,127],0,0),
           ('retrigger',[102,64,64],137*32,0),('pretrigger',[102,64,64],0,10*32),
           ('retrigger_idle',[0,0,127],500*32,0)]
    report=[]
    for name,knobs,repeat,delay in cases:
        if a.case and name!=a.case: continue
        blocks=a.blocks or (1024 if repeat else math.ceil((controls['duration']+delay)/32)+32)
        samples=blocks*32
        reference=run([exe,*knobs,samples,repeat,delay,out/(name+'.reference.raw')])
        lines=['load P 110023 code.bin','load P 1000 init-stub.bin','load X 148000 sine.bin','voice 800',
               'set Y ff 123456','set Y 120 654321','set X 7ff 123456','set X 840 654321',
               'set Y 7ff 123456','set Y 840 654321']
        for space in ('X','Y'): lines += [f'set {space} {0x800+i:x} 5a5a5a' for i in range(64)]
        # Poison every track's external region, then verify all unowned words.
        lines += [f'set X {extbase+i:x} 5a5a5a' for i in range(16*1536)]
        lines += [f'set X {extbase-1:x} 123456',f'set X {extbase+16*1536:x} 654321']
        for i,v in enumerate(knobs): lines.append(f'set Y {0x801+i:x} {v*128:x}')
        lines+=['scrub 1f','call 1000','cycles']
        for block in range(blocks):
            if block*32==delay or (repeat and block*32>delay and (block*32-delay)%repeat==0):
                lines+=['scrub 1f',f'call {base+image["mutate_word"]:x}','cycles']
            lines += [f'set Y {0x100+i:x} 5a5a5a' for i in range(32)]
            lines+=['scrub 1f',f'call {base+image["execute_word"]:x}','cycles','out']
        lines+=['dump X 800 40','dump Y 800 40','dump Y ff 1','dump Y 120 1',
                'dump X 7ff 1','dump X 840 1','dump Y 7ff 1','dump Y 840 1',f'dump X {extbase:x} 6000',
                f'dump X {extbase-1:x} 1',f'dump X {extbase+16*1536:x} 1']
        script=out/(name+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([Path(a.host).resolve(),script.name,name+'.raw'],cwd=out,timeout=600)
        (out/(name+'.host.log')).write_text(result.stdout+'\n'+result.stderr)
        native_i=struct.unpack('<'+'i'*samples,(out/(name+'.raw')).read_bytes())
        actual=[v/8388608 for v in native_i]
        want=struct.unpack('<'+'f'*samples,(out/(name+'.reference.raw')).read_bytes())
        error=[x/OUTPUT_GAIN-y for x,y in zip(actual,want)]
        mse=sum(e*e for e in error)/samples; energy=sum(v*v for v in want)/samples
        dumps=[[int(w,16) for w in row.split()] for row in re.findall(r'^dump (.+)$',result.stdout,re.M)]
        native={n:(dumps[0][i] if i<64 else dumps[1][i-64+9]) for i,n in enumerate(STATE)}
        ref={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',reference.stdout)}
        expected_y=[0x5a5a5a]*64; expected_y[1:4]=[v*128 for v in knobs]
        other_ext=dumps[8][:a.track*1536]+dumps[8][a.track*1536+EXTERNAL_WORDS:]
        checks=dict(parameters=dumps[1][:9]==expected_y[:9],unused_local=dumps[1][9+len(STATE)-64:]==[0x5a5a5a]*(119-len(STATE)),
                    guards=dumps[2:8]==[[0x123456],[0x654321]]*3,external_base=native['ext']==ext,
                    external_guards=all(v==0x5a5a5a for v in other_ext),
                    external_outer_guards=dumps[9:]==[[0x123456],[0x654321]],
                    active=native['active']==ref['active'],frame=native['frame']==ref['frame'],duration=native['duration']==ref['duration'],
                    buffer_written=0x5a5a5a not in native_i,pretrigger=not delay or not any(native_i[:delay]),
                    idle=bool(ref['active']) or not any(native_i[-32:]),tanh_range=native['tanh_clamps']==0)
        checks['noise_rng']=(native['noisehi']<<24|native['noiselo'])==ref['noise_rng']
        for n in ('core_frame','generated'): checks[n]=native[n]==ref[n]
        checks['history_position']=native['histpos']==ref['history_position']
        coefficients=controls['pitch'][knobs[1]]['coefficients']
        signed=lambda w: w-(1<<24) if w&0x800000 else w
        coefficient_error=max(abs(signed(dumps[8][a.track*1536+i*192+j])/8388608-v)
                              for i,row in enumerate(coefficients) for j,v in enumerate(row))
        checks['coefficients']=coefficient_error<.00001
        peak_error=max(abs(e) for e in error); tolerance=.003
        cycles=[int(x) for x in re.findall(r'instructions \d+ cycles (\d+)',result.stdout)]
        entries=[int(line.split()[1],16) for line in lines if line.startswith('call ')]
        if len(entries)!=len(cycles): raise AssertionError('Missing call cycle count')
        timing={n:[] for n in ('init','trigger','first_render','later_render')}; first=False
        for entry,cost in zip(entries,cycles):
            if entry==0x1000: timing['init'].append(cost)
            elif entry==base+image['mutate_word']: timing['trigger'].append(cost); first=True
            elif entry==base+image['execute_word']:
                timing['first_render' if first else 'later_render'].append(cost); first=False
            else: raise AssertionError('Unexpected call in render fixture')
        metrics=dict(machine=kind,case=name,knobs=knobs,track=a.track,samples=samples,peak_error=peak_error,
                     rms_error=math.sqrt(mse),snr_db=10*math.log10(energy/max(mse,1e-30)),
                     native_peak=max(abs(x) for x in actual),reference_peak=max(abs(x) for x in want),
                     output_gain=OUTPUT_GAIN,peak_error_limit=tolerance,numeric_pass=peak_error<tolerance,
                     checks=checks,source_state=ref,native_state={n:native[n] for n in ('active','frame','duration','tanh_clamps')},
                     program_words=build['program_words'],local_words=len(STATE),external_words=EXTERNAL_WORDS,coefficient_error=coefficient_error,
                     host_cycle_table_max_call=max(cycles),
                     raw_max_by_call={n:max(v) for n,v in timing.items() if v},cold_cache_measured=False)
        report.append(metrics); (out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
        write_wave(out/(name+'.wav'),actual); write_wave(out/(name+'.reference.wav'),[v*OUTPUT_GAIN for v in want])
        print(json.dumps(metrics),flush=True)
        if not metrics['numeric_pass'] or not all(checks.values()): raise AssertionError(f'{kind}/{name} comparison failed')


if __name__=='__main__': main()
