"""Compare both BD tanh schedules at table boundaries, including accumulator lows."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

from generate_bd import generate
from mds_build import ROOT, assemble_package, mds_format
from render_bd import run


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def signed(word):
    return (word & 0x7fffff) - (word & 0x800000)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',type=Path,required=True)
    p.add_argument('--host',type=Path,required=True)
    p.add_argument('--tanh-bits',type=int,choices=range(8,14),nargs='+',default=list(range(8,14)))
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); out=a.out.resolve()
    if out.exists(): p.error('Use a fresh output directory')
    out.mkdir(parents=True)
    inputs=[a.assembler.resolve(),a.host.resolve(),Path(__file__).resolve(),
            ROOT/'tools/generate_bd.py',ROOT/'tools/mds_build.py',ROOT/'tools/render_bd.py',
            ROOT/'machines/bd/bd.json']
    hashes={str(path):digest(path) for path in inputs}
    report=dict(input_sha256=hashes,cases=[],complete=False,hardware_validated=False,
                scope='Boundary/midpoint neighborhoods, three input A0 values, two schedules and two unaligned placements; not all 48-bit inputs')
    report_path=out/'result.json'
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    for bits in a.tanh_bits:
        shift=24-bits; step=1<<shift
        highs=sorted({(i-(1<<(bits-1)))*step+d for i in range((1<<bits)+1)
                      for d in (-1,0,1,step//2,step-1)
                      if -(1<<23)<=(i-(1<<(bits-1)))*step+d<(1<<23)})
        vectors=[(hi,lo) for hi in highs for lo in (0,0x800000,0xffffff)]
        vectors += [vectors[-1]]*((-len(vectors))%16)
        previous={}
        for sequential in (False,True):
            source=generate(tanh_bits=bits,sequential_tanh=sequential)
            start=(f'    move a1,b\n    asr #{shift},a,a\n    add #>tanh_table+' if sequential else
                   f'    move a1,b\n    and #>${step-1:x},b\n    asl #{23-shift},b,b\n')
            begin=source.index(start); end=source.index('    add x0,a\n',begin)+len('    add x0,a\n')
            kernel=source[begin:end]; table=source[source.index('tanh_table:\n'):]
            values=[signed(int(word,16)) for word in re.findall(r'\$([0-9a-f]{6})',table)]
            assert len(values)==(1<<bits)+1
            expected=[]
            for hi,lo in vectors:
                index=(hi>>shift)+(1<<(bits-1)); fraction=(hi&(step-1))<<(23-shift)
                accumulator=(values[index]<<24)+2*(values[index+1]-values[index])*fraction
                expected += [signed((accumulator>>24)&0xffffff),signed(accumulator&0xffffff)]
            # Probe-only wrapper: 16 inputs produce 32 output words (A1,A0 pairs).
            probe=('init:\n    rts\ntrigger:\n    rts\nrender:\n'
                   '    move #>$2000,r1\n    do #16,probe_end\n'
                   '    move x:(r1)+,a\n    move x:(r1)+,a0\n'+kernel+
                   '    move a1,y:(r7)+\n    move a0,y:(r7)+\nprobe_end:\n    rts\n'+table)
            manifest=json.loads((ROOT/'machines/bd/bd.json').read_text())
            package,assembly=assemble_package(probe,manifest,a.assembler.resolve())
            image=mds_format().parse_package(package)
            for base in (0x110023,0x140001):
                target=out/f'bits{bits}-{"sequential" if sequential else "original"}-{base:x}'; target.mkdir()
                (target/'probe.asm').write_text(probe); (target/'probe.mds').write_bytes(package)
                words=[int.from_bytes(image['program'][i:i+3],'big') for i in range(0,len(image['program']),3)]
                for index in image['relocations']: words[index]+=base
                (target/'code.bin').write_bytes(b''.join(word.to_bytes(3,'big') for word in words))
                lines=[f'load P {base:x} code.bin','voice 800','set Y ff 123456','set Y 120 654321']
                for offset in range(0,len(vectors),16):
                    for i,(hi,lo) in enumerate(vectors[offset:offset+16]):
                        lines += [f'set X {0x2000+2*i:x} {hi&0xffffff:x}',f'set X {0x2001+2*i:x} {lo:x}']
                    lines += ['scrub 1f',f'call {base+image["execute_word"]:x}','out']
                lines += ['dump Y ff 1','dump Y 120 1']
                script=target/'probe.script'; script.write_text('\n'.join(lines)+'\n')
                result=run([a.host.resolve(),script.name,'probe.raw'],cwd=target,timeout=600)
                (target/'host.log').write_text(result.stdout+result.stderr)
                raw=(target/'probe.raw').read_bytes()
                actual=list(struct.unpack('<'+'i'*(len(raw)//4),raw))
                if actual!=expected: raise AssertionError(f'Table {bits}, sequential={sequential}: accumulator mismatch')
                if re.findall(r'^dump (.+)$',result.stdout,re.M)!=['123456','654321']:
                    raise AssertionError('Probe output guard modified')
                if not sequential: previous[base]=raw
                elif previous[base]!=raw: raise AssertionError('Schedules differ')
                paths=[target/name for name in ('probe.asm','probe.mds','code.bin','probe.script','probe.raw','host.log')]
                report['cases'].append(dict(tanh_bits=bits,sequential=sequential,base=hex(base),
                                            vectors=len(vectors),accumulator_words_checked=len(expected),
                                            program_words=assembly['program_words'],passed=True,
                                            artifacts_sha256={str(path):digest(path) for path in paths}))
                report_path.write_text(json.dumps(report,indent=2)+'\n')
        print(f'{bits} bits: {len(vectors)} inputs, both accumulator words exact at both placements',flush=True)
    if hashes!={str(path):digest(path) for path in inputs}: raise AssertionError('Probe inputs changed')
    report['complete']=True
    report_path.write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__': main()
