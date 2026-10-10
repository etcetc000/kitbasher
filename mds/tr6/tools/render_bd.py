"""Compare assembled TR6-BD against the original C++ source; no hardware claims."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import wave
import hashlib
import shutil
import sys

from mds_build import ROOT, assemble_package, mds_format
from generate_bd import generate, state_layout


def run(command, cwd=None, timeout=120):
    result=subprocess.run([str(x) for x in command],cwd=cwd,text=True,capture_output=True,timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    result.check_returncode()
    return result


def write_wave(path,values):
    with wave.open(str(path),'wb') as w:
        w.setnchannels(1); w.setsampwidth(3); w.setframerate(44100)
        w.writeframes(b''.join((max(-8388608,min(8388607,round(v*8388608)))&0xffffff).to_bytes(3,'little') for v in values))


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--assembler',required=True); ap.add_argument('--host',required=True)
    ap.add_argument('--compiler',default='clang++')
    ap.add_argument('--case',choices=['default','minimum','maximum','retrigger','pretrigger','retrigger_idle','heat_modulation'])
    ap.add_argument('--knobs',type=int,nargs=5,metavar=('TRAN','DEC','TUNE','HEAT','XL'),help='One custom fixture; first four values 0..127, XL 0 or 1')
    ap.add_argument('--tanh-bits',type=int,choices=range(8,14),default=13,help='13 preserves the full-path baseline; lower values test compact tables')
    ap.add_argument('--resident-state',action='store_true',help='Keep hot state in R/N registers during each render call')
    ap.add_argument('--lcg-noise',action='store_true',help='Approximation: use a 24-bit LCG for the click noise')
    ap.add_argument('--seed',type=lambda value:int(value,0),help='Explicit uint32 noise seed; zero selects the default seed')
    ap.add_argument('--blocks',type=int,help='Diagnostic render length; may stop before the voice becomes idle')
    ap.add_argument('--control-rate',type=int,choices=(1,16,32),default=1,help='Approximation: interpolate envelope/pitch endpoints; requires resident state')
    ap.add_argument('--simple-impulse',action='store_true',help='Approximation: replace the impulse high-pass biquad with one pole')
    ap.add_argument('--omit-impulse',action='store_true',help='Approximation: omit the impulse layer and its native filter/envelope work')
    ap.add_argument('--sequential-tanh',action='store_true',help='Exact: schedule adjacent saturation-table reads with one pointer')
    ap.add_argument('--quadratic-saturation',action='store_true',help='Approximation: arithmetic soft clip; requires omitted impulse, excludes sequential tanh')
    ap.add_argument('--recursive-body',action='store_true',help='Approximation: magic-circle body oscillator; requires omitted impulse and control rate 32')
    ap.add_argument('--lean-mix',action='store_true',help='Approximation: share one body/click low-pass; requires recursive body and LCG')
    ap.add_argument('--out',type=Path)
    args=ap.parse_args()
    if args.seed is not None and not 0<=args.seed<=0xffffffff: ap.error('--seed must fit uint32')
    if args.blocks is not None and args.blocks<1: ap.error('--blocks must be positive')
    if args.control_rate!=1 and not args.resident_state: ap.error('--control-rate requires --resident-state')
    if args.simple_impulse and args.omit_impulse: ap.error('Choose --simple-impulse or --omit-impulse, not both')
    if args.quadratic_saturation and (not args.omit_impulse or args.sequential_tanh): ap.error('Quadratic saturation requires omitted impulse and excludes sequential tanh')
    if args.recursive_body and (not args.omit_impulse or args.control_rate!=32): ap.error('Recursive body requires omitted impulse and control rate 32')
    if args.lean_mix and not (args.recursive_body and args.lcg_noise): ap.error('Lean mix requires recursive body and LCG')
    if args.knobs is not None:
        if args.case is not None: ap.error('--knobs and --case are mutually exclusive')
        if any(not 0<=v<=127 for v in args.knobs[:4]) or args.knobs[4] not in (0,1): ap.error('Invalid custom knob values')
    suffix='bd-comparison' if args.tanh_bits==13 else f'bd-lut{args.tanh_bits}'
    if args.resident_state: suffix+='-resident'
    if args.lcg_noise: suffix+='-lcg'
    if args.seed is not None: suffix+=f'-seed{args.seed:08x}'
    if args.blocks is not None: suffix+=f'-blocks{args.blocks}'
    if args.control_rate!=1: suffix+=f'-control{args.control_rate}'
    if args.simple_impulse: suffix+='-simple-impulse'
    if args.omit_impulse: suffix+='-omit-impulse'
    if args.sequential_tanh: suffix+='-sequential-tanh'
    if args.quadratic_saturation: suffix+='-quadratic-saturation'
    if args.recursive_body: suffix+='-recursive-body'
    if args.lean_mix: suffix+='-lean-mix'
    if args.knobs is not None: suffix+='-k'+'-'.join(str(v) for v in args.knobs)
    out=(args.out or ROOT/'build'/suffix).resolve(); out.mkdir(parents=True,exist_ok=True)
    source=generate(args.tanh_bits,args.resident_state,args.lcg_noise,args.seed,args.control_rate,args.simple_impulse,args.omit_impulse,args.sequential_tanh,args.quadratic_saturation,args.recursive_body,args.lean_mix); (out/'bd.asm').write_text(source)
    states=state_layout(args.control_rate)
    manifest=json.loads((ROOT/'machines/bd/bd.json').read_text())
    package,build=assemble_package(source,manifest,args.assembler,{'mds_sine':(1,1)})
    (out/'bd.mds').write_bytes(package); (out/'assembly.json').write_text(json.dumps(build,indent=2)+'\n')
    image=mds_format().parse_package(package)
    code=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
    base=0x110023
    for i in image['relocations']: code[i]+=base
    for item in image['imports']: code[item.patch_word]+=0x148000
    (out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    exe=out/('reference.exe' if os.name=='nt' else 'reference')
    run([args.compiler,'-std=c++14','-O2','-I',ROOT/'.audit-sources/Simple606/Source',
         ROOT/'tests/bd_reference.cpp','-o',exe])
    cases=[('default',[51,102,75,0,0],0,0,4096),
           ('minimum',[0,0,0,0,0],0,0,4096),
           ('maximum',[127,127,127,127,1],0,0,16384),
           ('retrigger',[51,102,75,0,0],137*32,0,4096),
           ('pretrigger',[51,102,75,0,0],0,10*32,4096)]
    if args.case=='retrigger_idle': cases=[('retrigger_idle',[51,102,75,0,0],4096*32,0,8192)]
    if args.case=='heat_modulation': cases=[('heat_modulation',[51,102,75,0,0],0,0,4096)]
    if args.knobs is not None: cases=[('custom',args.knobs,0,0,16384 if args.knobs[4] else 4096)]
    def hashes(paths): return {str(path.resolve()):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    source_root=ROOT/'.audit-sources/Simple606/Source'
    input_paths=[Path(args.host).resolve(),Path(args.assembler).resolve(),Path(shutil.which(args.compiler) or args.compiler).resolve(),exe,
                 Path(__file__).resolve(),ROOT/'tools/generate_bd.py',ROOT/'tools/mds_build.py',ROOT/'tests/bd_reference.cpp',
                 source_root/'BassDrum.hpp',source_root/'SynthDrumCommon.hpp',out/'bd.asm',out/'bd.mds',out/'assembly.json',out/'code.bin',out/'sine.bin']
    captured_hashes=hashes(input_paths)
    provenance=dict(command=sys.argv,configuration={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()},
                    captured_before_render=True,inputs_sha256=captured_hashes,cases=[],complete=False)
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    report=[]; numeric_failures=[]
    for name,knobs,repeat,delay,blocks in cases:
        if args.case and name!=args.case: continue
        if args.blocks is not None: blocks=args.blocks
        prefix=out/name
        model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606] if args.lcg_noise or args.seed is not None else []
        if name=='heat_modulation': model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,1]
        if args.control_rate!=1: model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),args.control_rate]
        if args.simple_impulse: model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),args.control_rate,1]
        if args.omit_impulse: model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),args.control_rate,0,1]
        if args.quadratic_saturation: model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),args.control_rate,0,1,1]
        if args.recursive_body: model_args=[int(args.lcg_noise),args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),args.control_rate,0,1,int(args.quadratic_saturation),1]
        if args.lean_mix: model_args=[1,args.seed if args.seed is not None else 0x606606,int(name=='heat_modulation'),32,0,1,int(args.quadratic_saturation),1,1]
        reference=run([exe,*knobs,blocks*32,repeat,delay,str(prefix)+'.reference.raw',*model_args])
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800',
               'set Y ff 123456','set Y 120 654321']
        for space in ('X','Y'):
            lines += [f'set {space} {0x800+i:x} 5a5a5a' for i in range(64)]
        for i,value in enumerate(knobs): lines.append(f'set Y {0x801+i:x} {value if i==4 else value*128:x}')
        lines += [f'call {base+image["init_word"]:x}','cycles']
        for block in range(blocks):
            if name=='heat_modulation': lines.append(f'set Y 804 {(block//3*37)%128*128:x}')
            if block*32==delay or (repeat and block*32>delay and (block*32-delay)%repeat==0):
                lines += [f'call {base+image["mutate_word"]:x}','cycles']
            # Poison every output sample to detect partial buffer writes.
            lines += [f'set Y {0x100+i:x} 5a5a5a' for i in range(32)]
            lines += ['scrub 1f',f'call {base+image["execute_word"]:x}','cycles','out']
        lines += ['dump Y 800 40','dump X 800 40','dump Y ff 1','dump Y 120 1']
        script=out/(name+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([Path(args.host).resolve(),script.name,name+'.raw'],cwd=out,timeout=600)
        (out/(name+'.host.log')).write_text(result.stdout+'\n'+result.stderr)
        actual_i=list(struct.unpack('<'+'i'*(blocks*32),(out/(name+'.raw')).read_bytes()))
        actual=[v/8388608 for v in actual_i]
        want=list(struct.unpack('<'+'f'*(blocks*32),(out/(name+'.reference.raw')).read_bytes()))
        error=[a-b for a,b in zip(actual,want)]
        mse=sum(e*e for e in error)/len(error); energy=sum(v*v for v in want)/len(want)
        cycles=[int(x) for x in re.findall(r'instructions \d+ cycles (\d+)',result.stdout)]
        dumps=[[int(w,16) for w in row.split()] for row in re.findall(r'^dump (.+)$',result.stdout,re.M)]
        expected_y=[0x5a5a5a]*64
        expected_y[1:6]=[v if i==4 else v*128 for i,v in enumerate(knobs)]
        if name=='heat_modulation': expected_y[4]=((blocks-1)//3*37)%128*128
        if dumps[0]!=expected_y or dumps[2:]!=[[0x123456],[0x654321]]:
            raise AssertionError(f'{name}: parameter or output guard modified')
        if dumps[1][len(states):]!=[0x5a5a5a]*(64-len(states)):
            raise AssertionError(f'{name}: state exceeds declared layout')
        expected_active=int(re.search(r'active_at_end=(\d)',reference.stdout)[1])
        if dumps[1][0]!=expected_active:
            raise AssertionError(f'{name}: source/native activity differs at end')
        if delay and any(actual_i[:delay]):
            raise AssertionError(f'{name}: output before trigger')
        if not expected_active and any(actual_i[-32:]):
            raise AssertionError(f'{name}: idle block not zero')
        if 0x5a5a5a in actual_i:
            raise AssertionError(f'{name}: output buffer not fully written')
        # Fixed acceptance bounds for this prototype. The XL case accumulates
        # source float32 oscillator phase error; see audit/BD-PORT.md.
        tolerance=0.005 if knobs[4] else 0.0002
        model=dict(synthesis='original') if not args.lcg_noise else dict(synthesis='original',noise='lcg24')
        if args.seed is not None: model['seed']=args.seed
        if name=='heat_modulation': model['heat_pattern']='three-block-step37'
        if args.control_rate!=1: model['control_rate']=args.control_rate
        if args.simple_impulse: model['impulse_filter']='one-pole-highpass'
        if args.omit_impulse: model['impulse_layer']='omitted'
        if args.quadratic_saturation: model['saturation']='clipped-quadratic'
        if args.recursive_body: model['oscillator']='magic-circle-block-pitch'
        if args.lean_mix: model.update(noise_filter='bypassed',mix_filter='shared-body-lowpass')
        checks=dict(parameters=True,output_guards=True,unused_state=True,activity=True,pretrigger=True,idle=True,buffer_written=True)
        metrics=dict(machine='bd',case=name,knobs=knobs,samples=len(actual),rms_error=math.sqrt(mse),tanh_bits=args.tanh_bits,program_words=build['program_words'],
                     resident_state=args.resident_state,reference_model=model,full_source_comparison=not args.lcg_noise and args.control_rate==1 and not args.simple_impulse and not args.omit_impulse,output_gain=1,checks=checks,
                     local_words=len(states),control_rate=args.control_rate,sequential_tanh=args.sequential_tanh,
                     peak_error=max(abs(e) for e in error),snr_db=10*math.log10(energy/max(mse,1e-30)),
                     peak=max(abs(x) for x in actual),reference_peak=max(abs(x) for x in want),
                     host_cycle_table_max_call=max(cycles),cold_cache_measured=False,
                     source_status=reference.stdout.strip(),native_active_at_end=dumps[1][0],
                     output_poison_survived=False,peak_error_limit=tolerance,
                     numeric_pass=max(abs(e) for e in error)<tolerance)
        report.append(metrics)
        write_wave(out/(name+'.wav'),actual); write_wave(out/(name+'.reference.wav'),want)
        print(json.dumps(metrics),flush=True)
        (out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
        if not metrics['numeric_pass']: numeric_failures.append(name)
        provenance['cases'].append(dict(name=name,knobs=knobs,samples=len(actual),repeat_samples=repeat,delay_samples=delay,
                                      output_sha256=hashes([script,out/(name+'.raw'),out/(name+'.reference.raw'),out/(name+'.host.log')]),
                                      checks_pass=metrics['numeric_pass'],numeric_pass=metrics['numeric_pass']))
        (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    if hashes(input_paths)!=captured_hashes: raise AssertionError('Render inputs changed during execution')
    provenance['complete']=True
    provenance['numeric_failures']=numeric_failures
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    if numeric_failures: raise AssertionError('Peak error exceeds unchanged bounds: '+', '.join(numeric_failures))


if __name__=='__main__': main()
