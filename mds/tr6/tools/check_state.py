"""Check interleaved tracks and machine reassignment against isolated renders.

Bit-exact native-vs-native checks complement the independent C++ audio tests.
No firmware or MIDI is used. Generated artifacts stay in the ignored build tree.
"""
import argparse
import importlib
import json
import hashlib
import math
from pathlib import Path
import struct

from mds_build import ROOT, assemble_package, mds_format, assembly
from render_bd import run

MACHINES={'bd':dict(base=0x110023,knobs=[51,102,75,0,0]),
          'sd':dict(base=0x120031,knobs=[102,64,95,64]),
          'lt':dict(base=0x130023,knobs=[102,64]),
          'ht':dict(base=0x140001,knobs=[102,64]),
          'ch':dict(base=0x150023,knobs=[89,64]),
          'oh':dict(base=0x170031,knobs=[89,64]),
          'cy':dict(base=0x180041,knobs=[102,64]),
          'cp':dict(base=0x190041,knobs=[102,64,64])}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler',required=True); p.add_argument('--host',required=True)
    p.add_argument('--compiler',default='clang++')
    p.add_argument('--out',type=Path)
    p.add_argument('--bd-resident-state',action='store_true')
    p.add_argument('--bd-lcg-noise',action='store_true')
    p.add_argument('--bd-tanh-bits',type=int,choices=range(8,14),default=13)
    p.add_argument('--metal-partial-count',type=int,choices=(3,6,47),default=47)
    p.add_argument('--metal-no-wobble',action='store_true')
    p.add_argument('--metal-tanh-bits',type=int,choices=range(8,14),default=13)
    p.add_argument('--metal-lean-math',action='store_true')
    p.add_argument('--metal-resonators',action='store_true')
    p.add_argument('--metal-lcg-noise',action='store_true')
    p.add_argument('--metal-block-oscillators',action='store_true')
    p.add_argument('--metal-resident-state',action='store_true')
    p.add_argument('--metal-envelope-rate',type=int,choices=(1,4,8,16,32),default=1)
    p.add_argument('--metal-block-noise',action='store_true')
    p.add_argument('--metal-linear-saturation',action='store_true')
    p.add_argument('--metal-cubic-saturation',action='store_true')
    p.add_argument('--metal-fused-mix',action='store_true')
    p.add_argument('--metal-bounded-loops',action='store_true')
    p.add_argument('--deduplicate-tables',action='store_true')
    p.add_argument('--metal-rounded-dc',action='store_true')
    p.add_argument('--metal-bypass-noise-dc',action='store_true')
    p.add_argument('--metal-interpolated-gate',action='store_true')
    p.add_argument('--metal-render-stride',type=int,choices=(1,2),default=1)
    p.add_argument('--metal-register-mix',action='store_true')
    p.add_argument('--metal-resident-output',action='store_true')
    p.add_argument('--metal-bandpass-noise',action='store_true')
    p.add_argument('--metal-combined-mix',action='store_true')
    args=p.parse_args()
    if args.metal_envelope_rate>32//args.metal_render_stride:
        p.error('Envelope interval cannot exceed synthesis samples per block')
    if args.metal_combined_mix and not (args.metal_linear_saturation and args.metal_envelope_rate==32 and args.metal_resident_output and args.metal_interpolated_gate and args.metal_bypass_noise_dc):
        p.error('Combined mixing requires linear saturation, envelope rate 32, resident output, interpolated gate and bypassed noise DC')
    if args.metal_bandpass_noise and not args.metal_block_noise:
        p.error('Band-pass noise requires block noise')
    if args.metal_resident_output and not args.metal_register_mix:
        p.error('Resident output requires register mixing')
    if args.metal_register_mix and not (args.metal_fused_mix and args.metal_bounded_loops):
        p.error('Register mixing requires fused mixing and bounded loops')
    if args.metal_rounded_dc and not args.metal_lean_math:
        p.error('Rounded DC filters require lean math')
    if args.metal_bypass_noise_dc and not args.metal_lean_math:
        p.error('Bypassing the noise DC filter requires lean math')
    if args.metal_interpolated_gate and args.metal_envelope_rate==1:
        p.error('Interpolated gate requires control-rate envelopes')
    if args.metal_render_stride!=1 and not args.metal_bounded_loops:
        p.error('Reduced synthesis rate requires bounded loops')
    if args.metal_lean_math and (args.metal_partial_count!=3 or not args.metal_no_wobble):
        p.error('--metal-lean-math requires three partials and no wobble')
    if (args.metal_resonators or args.metal_lcg_noise) and not args.metal_lean_math:
        p.error('Resonators/LCG noise require lean math')
    if args.metal_block_oscillators and not args.metal_resonators:
        p.error('Block oscillators require resonators')
    if args.metal_resident_state and not args.metal_block_oscillators:
        p.error('Resident state requires block oscillators')
    if args.metal_envelope_rate!=1 and not args.metal_resident_state:
        p.error('Control-rate envelopes require resident state')
    if args.metal_block_noise and not args.metal_block_oscillators:
        p.error('Block noise requires block oscillators')
    if args.metal_linear_saturation and not args.metal_lean_math:
        p.error('Linear saturation requires lean math')
    if args.metal_cubic_saturation and (not args.metal_lean_math or args.metal_linear_saturation):
        p.error('Cubic saturation requires lean math and excludes linear saturation')
    if args.metal_fused_mix and (not args.metal_block_noise or not args.metal_resident_state):
        p.error('Fused mixing requires block noise and resident state')
    if args.metal_bounded_loops and (not args.metal_resident_state or args.metal_envelope_rate==1 or not (args.metal_linear_saturation or args.metal_cubic_saturation)):
        p.error('Bounded loops require resident state, control-rate envelopes and linear/cubic saturation')
    variant=args.metal_partial_count!=47 or args.metal_no_wobble or args.metal_tanh_bits!=13
    suffix=f'-p{args.metal_partial_count}'+('-static' if args.metal_no_wobble else '-wobble')+f'-lut{args.metal_tanh_bits}' if variant else ''
    if args.metal_lean_math: suffix+='-lean'
    if args.metal_resonators: suffix+='-resonators'
    if args.metal_lcg_noise: suffix+='-lcg'
    if args.metal_block_oscillators: suffix+='-blockosc'
    if args.metal_resident_state: suffix+='-resident'
    if args.metal_envelope_rate!=1: suffix+=f'-env{args.metal_envelope_rate}'
    if args.metal_block_noise: suffix+='-blocknoise'
    if args.metal_linear_saturation: suffix+='-linear'
    if args.metal_cubic_saturation: suffix+='-cubic'
    if args.metal_fused_mix: suffix+='-fused'
    if args.metal_bounded_loops: suffix+='-bounded'
    if args.deduplicate_tables: suffix+='-dedup'
    if args.metal_rounded_dc: suffix+='-rounded-dc'
    if args.metal_bypass_noise_dc: suffix+='-no-noise-dc'
    if args.metal_interpolated_gate: suffix+='-gate'
    if args.metal_register_mix: suffix+='-register-mix'
    if args.metal_resident_output: suffix+='-resident-output'
    if args.metal_bandpass_noise: suffix+='-bandpass'
    if args.metal_combined_mix: suffix+='-combined'
    if args.metal_render_stride!=1: suffix+=f'-stride{args.metal_render_stride}'
    if args.metal_bandpass_noise: suffix='-bandpass-'+hashlib.sha256(suffix.encode()).hexdigest()[:12]
    elif args.metal_resident_output: suffix='-resident-output-'+hashlib.sha256(suffix.encode()).hexdigest()[:12]
    if args.bd_resident_state: suffix+='-bd-resident'
    if args.bd_lcg_noise: suffix+='-bd-lcg'
    if args.bd_tanh_bits!=13: suffix+=f'-bd-lut{args.bd_tanh_bits}'
    out=(args.out or ROOT/('build/state-check'+suffix)).resolve(); out.mkdir(parents=True,exist_ok=True)
    entries={}; loads=[]
    from generate_toms import build_reference, generate as generate_tom
    tom_reference=build_reference(out,args.compiler)
    from generate_metal import build_reference as build_metal_reference, generate as generate_metal
    metal_reference=build_metal_reference(out/'metal-reference',args.compiler)
    from generate_clap import build_reference as build_clap_reference, generate as generate_clap
    clap_reference=build_clap_reference(out/'clap-reference',args.compiler)
    for name,settings in MACHINES.items():
        imports={'mds_sine':(1,1)}
        if name in ('lt','ht'):
            source=generate_tom(name,json.loads(run([tom_reference,'--tables',name]).stdout),args.deduplicate_tables)
        elif name in ('ch','oh','cy'):
            table_args=[args.metal_render_stride] if args.metal_render_stride!=1 else []
            controls=json.loads(run([metal_reference,'--tables',name,args.metal_partial_count,int(args.metal_no_wobble),*table_args]).stdout)
            if args.metal_bandpass_noise:
                from fit_noise_bandpass import fit_controls
                controls,fit_report=fit_controls(controls)
                (out/(name+'-bandpass-fit.json')).write_text(json.dumps(fit_report,indent=2)+'\n')
            source=generate_metal(name,controls,args.metal_tanh_bits,args.metal_no_wobble,args.metal_lean_math,args.metal_resonators,args.metal_lcg_noise,args.metal_block_oscillators,args.metal_resident_state,args.metal_envelope_rate,args.metal_block_noise,args.metal_linear_saturation,args.metal_cubic_saturation,args.metal_fused_mix,args.metal_bounded_loops,args.deduplicate_tables,args.metal_rounded_dc,args.metal_bypass_noise_dc,args.metal_interpolated_gate,args.metal_render_stride,register_mix=args.metal_register_mix,resident_output=args.metal_resident_output,bandpass_noise=args.metal_bandpass_noise,combined_mix=args.metal_combined_mix)
            imports['mds_track']=(2,6)
            if args.metal_block_oscillators: imports['mds_scratch_x']=(3,7)
            if args.metal_block_noise: imports['mds_scratch_y']=(4,8)
        elif name=='cp':
            source=generate_clap(json.loads(run([clap_reference,'--tables']).stdout))
            imports['mds_track']=(2,6)
        elif name=='bd':
            source=importlib.import_module('generate_bd').generate(args.bd_tanh_bits,resident_state=args.bd_resident_state,lcg_noise=args.bd_lcg_noise)
        else:
            source=importlib.import_module('generate_'+name).generate()
        package,_=assemble_package(source,
            json.loads((ROOT/f'machines/{name}/{name}.json').read_text()),args.assembler,imports)
        parsed=mds_format().parse_package(package); base=settings['base']
        code=[int.from_bytes(parsed['program'][i:i+3],'big') for i in range(0,len(parsed['program']),3)]
        for i in parsed['relocations']: code[i]+=base
        for imp in parsed['imports']: code[imp.patch_word]+={1:0x148000,6:0x160000,7:0x200,8:0x240}[imp.symbol]
        (out/(name+'.bin')).write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
        loads.append(f'load P {base:x} {name}.bin')
        entries[name]={key:base+parsed[value] for key,value in
                       (('init','init_word'),('trigger','mutate_word'),('render','execute_word'))}
    sine=[round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (out/'sine.bin').write_bytes(b''.join((w&0xffffff).to_bytes(3,'big') for w in sine))
    loads+=['load X 148000 sine.bin']
    # Test fixtures supply INIT's ABI R1 value, which the host cannot set directly.
    stubs=[]
    for name in MACHINES:
        for track in range(16):
            stubs += [f'stub_{name}_{track}:',f'    move #>{track},r1',f'    jmp >${entries[name]["init"]:x}']
    words,labels=assembly.assemble('\n'.join(stubs)+'\n',0x1000,exe=args.assembler)
    (out/'init-stubs.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in words))
    loads+=['load P 1000 init-stubs.bin']

    def setup(name,voice,dirty=True,knobs=None):
        lines=[f'voice {voice:x}']
        if dirty:
            for space in ('X','Y'): lines += [f'set {space} {voice+i:x} 5a5a5a' for i in range(64)]
        for i,value in enumerate(knobs or MACHINES[name]['knobs']):
            lines.append(f'set Y {voice+1+i:x} {value if name=="bd" and i==4 else value*128:x}')
        track=(voice-0x800)//64
        if not 0<=track<16 or voice!=0x800+track*64: raise ValueError('Invalid fixture track')
        return lines+['scrub 1f',f'call {labels[f"stub_{name}_{track}"]:x}']

    def block(name,voice,index):
        lines=[f'voice {voice:x}']
        if index%137==0: lines+=['scrub 1f',f'call {entries[name]["trigger"]:x}']
        if args.metal_block_oscillators:
            lines += [f'set X {0x200+i:x} {0x5a5a5a^(index&0xffff):x}' for i in range(32)]
        if args.metal_block_noise:
            lines += [f'set Y {0x240+i:x} {0xa5a5a5^(index&0xffff):x}' for i in range(32)]
        return lines+['scrub 1f',f'call {entries[name]["render"]:x}','out']

    def render(tag,lines):
        (out/(tag+'.script')).write_text('\n'.join(loads+lines)+'\n')
        result=run([Path(args.host).resolve(),tag+'.script',tag+'.raw'],cwd=out,timeout=600)
        (out/(tag+'.log')).write_text(result.stdout+'\n'+result.stderr)
        raw=(out/(tag+'.raw')).read_bytes()
        return list(struct.unpack('<'+'i'*(len(raw)//4),raw))

    count=512
    tracks=[('bd',0x800,None),('sd',0x840,None),('sd',0x880,[127,0,127,127]),
            ('lt',0x8c0,None),('ht',0x900,None),('ht',0x940,[127,0]),
            ('ch',0x980,None),('oh',0x9c0,None),('cy',0xa00,None),
            ('cp',0xa40,None),('cp',0xa80,[127,63,127])]
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
                   ('bd','lt'),('lt','bd'),('sd','ht'),('ht','sd'),
                   ('ch','oh'),('oh','ch'),('oh','cy'),('cy','oh'),
                   ('lt','ch'),('ch','lt'),('bd','cy'),('cy','bd'),
                   ('cp','bd'),('bd','cp'),('cp','cy'),('cy','cp'),('cp','sd'),('sd','cp'))
    default_track={'bd':0,'sd':1,'lt':3,'ht':4,'ch':6,'oh':7,'cy':8,'cp':9}
    for before,after in reassignments:
        lines=setup(before,0x800)
        for n in range(173): lines+=block(before,0x800,n)
        lines+=setup(after,0x800,dirty=False)
        for n in range(count): lines+=block(after,0x800,n)
        actual=render(before+'_to_'+after,lines)[173*32:]
        baseline=isolated[default_track[after]]
        if actual!=baseline: raise AssertionError(f'{before} -> {after} reassignment')
    for name,knobs in (('sd',(127,0,127,127)),('lt',(127,0)),('ht',(0,127)),
                       ('ch',(127,0)),('oh',(0,127)),('cy',(0,0)),('cp',(127,0,0))):
        lines=setup(name,0x800)
        for n in range(137):
            if n==30:
                lines += [f'set Y {0x801+i:x} {value*128:x}' for i,value in enumerate(knobs)]
            lines+=block(name,0x800,n)
        if render(name+'_controls_during_tail',lines)!=isolated[default_track[name]][:137*32]:
            raise AssertionError(f'{name} controls changed a tail before retrigger')
    result=dict(status='pass',comparison='bit-exact',interleaved_tracks=len(tracks),
                deduplicate_tables=args.deduplicate_tables,
                rounded_dc=args.metal_rounded_dc,
                bypass_noise_dc=args.metal_bypass_noise_dc,
                interpolated_gate=args.metal_interpolated_gate,
                render_stride=args.metal_render_stride,
                bd_resident_state=args.bd_resident_state,bd_lcg_noise=args.bd_lcg_noise,bd_tanh_bits=args.bd_tanh_bits,
                register_mix=args.metal_register_mix,
                resident_output=args.metal_resident_output,
                bandpass_noise=args.metal_bandpass_noise,
                combined_mix=args.metal_combined_mix,
                metal_model=dict(partial_count=args.metal_partial_count,wobble=not args.metal_no_wobble,tanh_bits=args.metal_tanh_bits,lean_math=args.metal_lean_math,resonators=args.metal_resonators,lcg_noise=args.metal_lcg_noise,block_oscillators=args.metal_block_oscillators,resident_state=args.metal_resident_state,envelope_rate=args.metal_envelope_rate,block_noise=args.metal_block_noise,saturation='linear' if args.metal_linear_saturation else 'cubic' if args.metal_cubic_saturation else 'tanh',fused_mix=args.metal_fused_mix,bounded_loops=args.metal_bounded_loops),
                blocks_per_track=count,reassignment=[before+' -> '+after for before,after in reassignments],
                controls_captured_at_trigger=['sd','lt','ht','ch','oh','cy','cp'],hardware_validated=False)
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))


if __name__=='__main__': main()
