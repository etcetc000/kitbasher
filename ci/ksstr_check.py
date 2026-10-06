"""Run PHYKS (examples/physical/ks) on a DSP instruction host and compare every sample with
an independent integer model of its delay loop.

    python ci/ksstr_check.py --pack catalog/physical-ks.json --host /path/to/dsphost --out NEW_DIR

--pack is a pack holding the model (the bundled catalog pack or a fresh export). --host is a
dsp56kEmu-based instruction host that reads a script (load, set, voice, call, cycles, out, dump)
and writes each `out` block as 32 little-endian int32 samples. This is not a full Machinedrum
emulator or hardware. The 47 cases cover both extremes of every control, a muted level,
pretrigger silence, retriggers during the slice clear, control motion, poisoned neighbouring
P-I slices and interleaved tracks 0 and 15. Results, the script and a WAV of the control cases
are written to --out, which must not exist yet. `npm run test:ksstr` runs it with the
configured host.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import time
import wave

Q = 1 << 23
RATE = 44100
SLICE = 1536
CANARY = 0x5a5a5a


def words(encoded):
    data = base64.b64decode(encoded)
    return [int.from_bytes(data[i:i+3], 'little') for i in range(0, len(data), 3)]


def signed(value):
    return (value & 0x7fffff) - (value & 0x800000)


def sat(value):
    return max(-Q, min(Q-1, value))


class StringReference:
    """Mathematical delay loop; no instruction decoding or DSP entry offsets."""
    def __init__(self, tables):
        self.tables = tables
        self.ring = [signed(CANARY)] * SLICE
        self.active = False
        self.cursor = self.index = self.previous = self.left = 0
        self.envelope = self.impulse = self.exciter = 0
        self.seed = 0x123457
        self.pending = False

    def trigger(self):
        self.active = self.pending = True
        self.cursor = self.index = self.previous = self.exciter = 0
        self.envelope = Q-1

    def block(self, k):
        if self.cursor < SLICE:
            self.ring[self.cursor:self.cursor+512] = [0]*512
            self.cursor += 512
            return [0]*32
        if not self.active:
            return [0]*32
        period = self.tables['period'][k[0]]
        bend = (self.envelope * (k[6] << 15)) >> 23
        period -= (period * bend) >> 23
        self.envelope = (self.envelope * self.tables['bend_decay'][k[7]]) >> 23
        feedback = self.tables['feedback'][k[1]]
        hammer = self.tables['hammer'][k[4]]
        pick = self.tables['pick'][k[5]]
        if self.pending:
            self.left = period
            self.impulse = Q//2
            self.pending = False
        if self.index >= period:
            self.index = 0
        result = []
        for _ in range(32):
            old = self.ring[self.index]
            damped = sat(old + (((k[2] << 15) * sat(self.previous-old)) >> 23))
            self.previous = old
            loop = (damped * feedback) >> 23
            source = 0
            if self.left:
                self.left -= 1
                self.seed = (self.seed*0x19660d+0x3c6ef3) & 0xffffff
                noise = signed(self.seed) >> 3
                source = sat(noise + ((hammer*sat(self.impulse-noise)) >> 23))
                self.impulse = 0
            self.exciter = sat(self.exciter + ((pick*sat(source-self.exciter)) >> 23))
            self.ring[self.index] = sat(loop+self.exciter)
            result.append((self.ring[self.index]*(k[3] << 16)) >> 23)
            self.index = (self.index+1) % period
        return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pack', type=Path, required=True)
    ap.add_argument('--host', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    pack = json.loads(args.pack.read_text())
    model = pack['models'][0]
    code = model['code']
    placed = {'@org':0x110000, 'pi_ws':0x135600, 'md_track':0x142, 'md_output':0x140}
    tables = {t['name']:words(t['words']) for t in model['tables']}
    loads = []
    def load(name, address, data):
        path = args.out/(name+'.bin')
        path.write_bytes(b''.join((v & 0xffffff).to_bytes(3, 'big') for v in data))
        loads.append(f'load P {address:x} {path.resolve()}')
    address = 0x120000
    for name, table in tables.items():
        placed[name] = address
        load(name, address, table)
        address += len(table)
    instructions = words(code['words'])
    original = code['symbols'] | {'@org':code['org']}
    for offset, symbol, scale in code['relocs']:
        instructions[offset] = (instructions[offset]+scale*(placed[symbol]-original[symbol])) & 0xffffff
    load('code', placed['@org'], instructions)
    entry = {name:placed['@org']+offset for name, offset in code['entry'].items()}
    poison = args.out/'poison.bin'
    poison.write_bytes(CANARY.to_bytes(3,'big')*SLICE*16)
    defaults = list(model['defaults'])
    blocks = 160
    cases = []
    def case(name, knobs, triggers=(0,), motion=None):
        cases.append(dict(name=name, knobs=knobs, triggers=triggers, motion=motion or {}))
    case('default', defaults)
    case('minimum', [0,0,0,127,0,0,0,0])
    case('maximum', [127]*8)
    case('muted', [64,127,64,0,64,64,64,64])
    for control in range(8):
        for raw in (0,127):
            settings = defaults.copy()
            if control == 7:
                settings[6] = 110  # A decay parameter needs its envelope enabled.
            settings[control] = raw
            case(f'control-{control}-{raw}', settings)
    case('before-trigger', defaults, triggers=(10,))
    case('retrigger-during-clear', defaults, triggers=(0,1,2,7,20,21,60))
    case('control-motion', defaults, triggers=(0,41,100), motion={
        10:[0,127,127,127,0,0,127,127],
        20:[127,127,0,127,127,127,127,0],
        40:[64,60,50,100,60,40,30,50],
        80:[0,127,0,127,0,127,0,127],
        90:[127,127,0,127,0,127,127,127],
        110:[80,80,127,100,90,100,110,90],
    })
    lines = loads+['set Y 140 100']
    expected = []
    cycle_kinds = []
    groups = []
    def call(kind):
        lines.extend([f'call {entry[kind]:x}', 'cycles'])
        cycle_kinds.append(kind)
    def set_knobs(voice, knobs):
        lines.extend(f'set Y {voice+i+1:x} {value << 16:x}' for i,value in enumerate(knobs))
    for track in (0,15):
        voice = 0x800+track*64
        for spec in cases:
            lines.extend([f'load P 135600 {poison.resolve()}', f'voice {voice:x}', f'set Y 142 {track:x}'])
            call('init')
            settings = spec['knobs']
            set_knobs(voice, settings)
            ref = StringReference(tables)
            first = len(expected)
            for block in range(blocks):
                if block in spec['motion']:
                    settings = spec['motion'][block]
                    set_knobs(voice, settings)
                if block in spec['triggers']:
                    call('trigger')
                    ref.trigger()
                call('render')
                lines.append('out')
                expected.extend(ref.block(settings))
            lines.append('dump P 135600 6000')
            groups.append(dict(name=spec['name'], tracks=[track], start=first, count=blocks*32))
    # Interleave endpoint tracks: shared tables but independent state and slices.
    lines.append(f'load P 135600 {poison.resolve()}')
    refs = {}
    settings = {0:defaults, 15:[25,110,45,100,80,70,100,90]}
    for track in (0,15):
        voice = 0x800+track*64
        lines.extend([f'voice {voice:x}', f'set Y 142 {track:x}'])
        call('init')
        set_knobs(voice, settings[track])
        call('trigger')
        refs[track] = StringReference(tables)
        refs[track].trigger()
    first = len(expected)
    for block in range(blocks):
        for track in (0,15):
            lines.extend([f'voice {0x800+track*64:x}', f'set Y 142 {track:x}'])
            call('render')
            lines.append('out')
            expected.extend(refs[track].block(settings[track]))
    lines.append('dump P 135600 6000')
    groups.append(dict(name='interleaved', tracks=[0,15], start=first, count=blocks*64))
    script = args.out/'check.script'
    script.write_text('\n'.join(lines)+'\n')
    raw = args.out/'audio.raw'
    result = subprocess.run([str(args.host), str(script.resolve()), str(raw.resolve())], capture_output=True, text=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    (args.out/'host.log').write_text(result.stdout+'\n'+result.stderr)
    if result.returncode:
        raise RuntimeError(result.stdout[-1000:]+result.stderr[-1000:])
    audio = list(struct.unpack('<'+'i'*(raw.stat().st_size//4), raw.read_bytes()))
    counts = [int(v) for v in re.findall(r'instructions\s+\d+\s+cycles\s+(\d+)', result.stdout)]
    dumps = re.findall(r'^dump (.*)$', result.stdout, re.M)
    assert len(audio) == len(expected)
    assert len(counts) == len(cycle_kinds) and len(dumps) == len(groups)
    failures = []
    for group, dump in zip(groups, dumps):
        start = group['start']; end = start+group['count']
        actual = audio[start:end]; want = expected[start:end]
        if actual != want:
            i = next(i for i,(a,b) in enumerate(zip(actual,want)) if a!=b)
            failures.append(dict(case=group['name'],tracks=group['tracks'],index=i,actual=actual[i],expected=want[i]))
        memory = [int(v,16) for v in dump.split()]
        assert len(memory) == SLICE*16
        for track in set(range(16))-set(group['tracks']):
            assert all(v==CANARY for v in memory[track*SLICE:(track+1)*SLICE]), 'slice escape'
        if group['name'] == 'before-trigger':
            assert not any(actual[:13*32]), 'pretrigger/clear audio leak'
        if group['name'] == 'muted':
            assert not any(actual), 'LEVL zero is not silent'
    sensitivity = []
    for control in range(8):
        a,b = [next(g for g in groups if g['tracks']==[0] and g['name']==f'control-{control}-{raw}') for raw in (0,127)]
        different = audio[a['start']:a['start']+a['count']] != audio[b['start']:b['start']+b['count']]
        sensitivity.append(different)
        if not different:
            failures.append(dict(control=control,error='inaudible parameter'))
    peaks = {kind:max(v for k,v in zip(cycle_kinds,counts) if k==kind) for kind in ('init','trigger','render')}
    budgets = model['contract']['budget']
    if peaks['init']>budgets['init_cycles'] or peaks['trigger']>budgets['trigger_cycles'] or peaks['render']/32>budgets['render_cps']:
        failures.append(dict(error='declared budget exceeded',cycles=peaks))
    with wave.open(str(args.out/'ksstr-controls.wav'),'wb') as wav:
        wav.setparams((1,2,RATE,0,'NONE','not compressed'))
        wav.writeframes(b''.join(struct.pack('<h',max(-32768,min(32767,v>>8))) for v in audio[:len(cases)*blocks*32]))
    report = dict(status='FAIL' if failures else 'PASS',cases=len(groups),samples=len(audio),tracks=[0,15],
                  parameter_sensitivity=sensitivity,render_cps=peaks['render']/32,init_cycles=peaks['init'],trigger_cycles=peaks['trigger'],
                  failures=failures,seconds=time.perf_counter()-started,
                  host_sha256=hashlib.sha256(args.host.read_bytes()).hexdigest(),pack_sha256=hashlib.sha256(args.pack.read_bytes()).hexdigest())
    (args.out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    if failures:
        raise SystemExit(1)


if __name__=='__main__':
    main()
