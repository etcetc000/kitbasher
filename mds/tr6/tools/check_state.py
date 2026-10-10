"""Check interleaved tracks and machine reassignment against isolated renders.

Bit-exact native-vs-native checks complement the independent C++ audio tests.
No firmware or MIDI is used. Generated artifacts stay in the ignored build tree.
"""
import argparse
import importlib
import json
import math
from pathlib import Path
import struct

from mds_build import ROOT, assemble_package, mds_format
from render_bd import run

MACHINES={'bd':dict(base=0x110023,knobs=[51,102,75,0,0]),
          'sd':dict(base=0x120031,knobs=[102,64,95,64]),
          'lt':dict(base=0x130023,knobs=[102,64]),
          'ht':dict(base=0x140001,knobs=[102,64])}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',required=True); p.add_argument('--host',required=True)
    p.add_argument('--compiler',default='clang++')
    p.add_argument('--out',type=Path,default=ROOT/'build/state-check')
    args=p.parse_args(); out=args.out.resolve(); out.mkdir(parents=True,exist_ok=True)
    entries={}; loads=[]
    from generate_toms import build_reference, generate as generate_tom
    tom_reference=build_reference(out,args.compiler)
    for name,settings in MACHINES.items():
        if name in ('lt','ht'):
            source=generate_tom(name,json.loads(run([tom_reference,'--tables',name]).stdout))
        else:
            source=importlib.import_module('generate_'+name).generate()
        package,_=assemble_package(source,
            json.loads((ROOT/f'machines/{name}/{name}.json').read_text()),args.assembler,{'mds_sine':(1,1)})
        parsed=mds_format().parse_package(package); base=settings['base']
        code=[int.from_bytes(parsed['program'][i:i+3],'big') for i in range(0,len(parsed['program']),3)]
        for i in parsed['relocations']: code[i]+=base
        for imp in parsed['imports']: code[imp.patch_word]+=0x148000
        (out/(name+'.bin')).write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
        loads.append(f'load P {base:x} {name}.bin')
        entries[name]={key:base+parsed[value] for key,value in
                       (('init','init_word'),('trigger','mutate_word'),('render','execute_word'))}
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    loads+=['load X 148000 sine.bin']

    def setup(name,voice,dirty=True,knobs=None):
        lines=[f'voice {voice:x}']
        if dirty:
            for space in ('X','Y'): lines += [f'set {space} {voice+i:x} 5a5a5a' for i in range(64)]
        for i,value in enumerate(knobs or MACHINES[name]['knobs']):
            lines.append(f'set Y {voice+1+i:x} {value if name=="bd" and i==4 else value*128:x}')
        return lines+['scrub 1f',f'call {entries[name]["init"]:x}']

    def block(name,voice,index):
        lines=[f'voice {voice:x}']
        if index%137==0: lines+=['scrub 1f',f'call {entries[name]["trigger"]:x}']
        return lines+['scrub 1f',f'call {entries[name]["render"]:x}','out']

    def render(tag,lines):
        (out/(tag+'.script')).write_text('\n'.join(loads+lines)+'\n')
        result=run([Path(args.host).resolve(),tag+'.script',tag+'.raw'],cwd=out)
        (out/(tag+'.log')).write_text(result.stdout+'\n'+result.stderr)
        raw=(out/(tag+'.raw')).read_bytes()
        return list(struct.unpack('<'+'i'*(len(raw)//4),raw))

    count=512
    tracks=[('bd',0x800,None),('sd',0x840,None),('sd',0x880,[127,0,127,127]),
            ('lt',0x8c0,None),('ht',0x900,None),('ht',0x940,[127,0])]
    isolated=[]
    for i,(name,voice,knobs) in enumerate(tracks):
        lines=setup(name,voice,knobs=knobs)
        for n in range(count): lines+=block(name,voice,n)
        isolated.append(render(f'isolated_{i}',lines))
    lines=[]
    for name,voice,knobs in tracks: lines+=setup(name,voice,knobs=knobs)
    for n in range(count):
        for name,voice,_ in tracks: lines+=block(name,voice,n)
    mixed=render('interleaved',lines)
    for n in range(count):
        for i in range(len(tracks)):
            start=(n*len(tracks)+i)*32
            if mixed[start:start+32]!=isolated[i][n*32:(n+1)*32]:
                raise AssertionError(f'interleaved track {i}, block {n}')

    reassignments=(('bd','sd'),('sd','bd'),('lt','ht'),('ht','lt'),
                   ('bd','lt'),('lt','bd'),('sd','ht'),('ht','sd'))
    default_track={'bd':0,'sd':1,'lt':3,'ht':4}
    for before,after in reassignments:
        lines=setup(before,0x800)
        for n in range(173): lines+=block(before,0x800,n)
        lines+=setup(after,0x800,dirty=False)
        for n in range(count): lines+=block(after,0x800,n)
        actual=render(before+'_to_'+after,lines)[173*32:]
        baseline=isolated[default_track[after]]
        if actual!=baseline: raise AssertionError(f'{before} -> {after} reassignment')
    for name,knobs in (('sd',(127,0,127,127)),('lt',(127,0)),('ht',(0,127))):
        lines=setup(name,0x800)
        for n in range(137):
            if n==30:
                lines += [f'set Y {0x801+i:x} {value*128:x}' for i,value in enumerate(knobs)]
            lines+=block(name,0x800,n)
        if render(name+'_controls_during_tail',lines)!=isolated[default_track[name]][:137*32]:
            raise AssertionError(f'{name} controls changed a tail before retrigger')
    result=dict(status='pass',comparison='bit-exact',interleaved_tracks=len(tracks),
                blocks_per_track=count,reassignment=[before+' -> '+after for before,after in reassignments],
                controls_captured_at_trigger=['sd','lt','ht'],hardware_validated=False)
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))


if __name__=='__main__': main()
