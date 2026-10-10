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

from mds_build import ROOT, assemble_package, mds_format
from generate_bd import generate, STATE


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
    ap.add_argument('--case',choices=['default','minimum','maximum','retrigger','pretrigger'])
    ap.add_argument('--tanh-bits',type=int,choices=range(8,14),default=13,help='13 preserves the full-path baseline; lower values test compact tables')
    ap.add_argument('--out',type=Path)
    args=ap.parse_args(); out=(args.out or ROOT/('build/bd-comparison' if args.tanh_bits==13 else f'build/bd-lut{args.tanh_bits}')).resolve(); out.mkdir(parents=True,exist_ok=True)
    source=generate(args.tanh_bits); (out/'bd.asm').write_text(source)
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
    report=[]
    for name,knobs,repeat,delay,blocks in cases:
        if args.case and name!=args.case: continue
        prefix=out/name
        reference=run([exe,*knobs,blocks*32,repeat,delay,str(prefix)+'.reference.raw'])
        lines=['load P 110023 code.bin','load X 148000 sine.bin','voice 800',
               'set Y ff 123456','set Y 120 654321']
        for space in ('X','Y'):
            lines += [f'set {space} {0x800+i:x} 5a5a5a' for i in range(64)]
        for i,value in enumerate(knobs): lines.append(f'set Y {0x801+i:x} {value if i==4 else value*128:x}')
        lines += [f'call {base+image["init_word"]:x}','cycles']
        for block in range(blocks):
            if block*32==delay or (repeat and block*32>delay and (block*32-delay)%repeat==0):
                lines += [f'call {base+image["mutate_word"]:x}','cycles']
            # Poison every output sample to detect partial buffer writes.
            lines += [f'set Y {0x100+i:x} 5a5a5a' for i in range(32)]
            lines += ['scrub 1f',f'call {base+image["execute_word"]:x}','cycles','out']
        lines += ['dump Y 800 40','dump X 800 40','dump Y ff 1','dump Y 120 1']
        script=out/(name+'.script'); script.write_text('\n'.join(lines)+'\n')
        result=run([Path(args.host).resolve(),script.name,name+'.raw'],cwd=out)
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
        if dumps[0]!=expected_y or dumps[2:]!=[[0x123456],[0x654321]]:
            raise AssertionError(f'{name}: parameter or output guard modified')
        if dumps[1][len(STATE):]!=[0x5a5a5a]*(64-len(STATE)):
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
        tolerance=0.005 if name=='maximum' else 0.0002
        metrics=dict(case=name,knobs=knobs,samples=len(actual),rms_error=math.sqrt(mse),tanh_bits=args.tanh_bits,program_words=build['program_words'],
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
        if not metrics['numeric_pass']:
            raise AssertionError(f'{name}: peak error exceeds {tolerance}')


if __name__=='__main__': main()
