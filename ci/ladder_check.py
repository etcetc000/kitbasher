"""Run NFX4P (examples/effects/ladder) on a DSP instruction host and compare every sample with
an independent integer model of its envelope, ladder and VCA.

    python ci/ladder_check.py --pack catalog/effects-ladder.json --host /path/to/dsphost --out NEW_DIR

--pack is a pack holding the model (the bundled catalog pack or a fresh export). --host is the
same dsp56kEmu-based instruction host as ci/ksstr_check.py (load, set, voice, call, cycles, out,
dump), not a full Machinedrum emulator or hardware. The cases cover RESO 127, both cutoff
extremes, both output poles, the envelope up and down with both time extremes, every VCA zone,
GAIN 0 and 127, silence, full-scale and square input, the first track (silent), knob motion with
fractional raw words, a seeded random stress test and two interleaved tracks. Each case starts
from a poisoned voice block: the X words hold the knob values the case sets, so stale controls
cannot pass unnoticed. Every output sample, the filter and envelope state and the other voice
blocks are compared. Results, the script and the host output are written to --out, which must
not exist yet. `npm run test:ladder` runs it with the configured host.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import random
import re
import struct
import subprocess
import time

Q = 1 << 23
FULL = Q - 1
CANARY = 0x5a5a5a
VOICES = 0x800
OUTPUT = 0x100            # the host's output bank (R7); the model reads the other bank
INPUT = OUTPUT ^ 0x20
BLOCK = 32
# State words the model owns (Y:+n): poles, stage, level, dt, level fraction, VCA gain, gate count.
STATE = (0x09, 0x0a, 0x0b, 0x0c, 0x11, 0x12, 0x13, 0x16, 0x17, 0x18)
VCA_STEP32 = 6086976
DT_MIN, DT_MAX = 4194, 4613734
OUT_GAIN = 5033165


def words(encoded):
    data = base64.b64decode(encoded)
    return [int.from_bytes(data[i:i+3], 'little') for i in range(0, len(data), 3)]


def s24(v):
    v &= 0xffffff
    return v - (1 << 24) if v & Q else v


def s56(v):
    v &= (1 << 56) - 1
    return v - (1 << 56) if v >> 55 else v


def hi(acc):
    """A1: bits 47..24, no limiting."""
    return s24(acc >> 24)


def lim(acc):
    """An accumulator read as a 24-bit word through the limiter."""
    if acc >= 1 << 47:
        return FULL
    if acc < -(1 << 47):
        return -Q
    return acc >> 24


def rnd(acc):
    """Convergent rounding of an accumulator to A1 (A0 cleared)."""
    out = (acc + (1 << 23)) & ~((1 << 24) - 1)
    if acc & 0xffffff == 1 << 23:
        out &= ~(1 << 24)
    return s56(out)


def step32(d):
    """d / 32 rounded toward zero."""
    return d >> 5 if d >= 0 else -((-d) >> 5)


def pow32(acc):
    """k (1.0 = 2^47) -> 1 - (1 - k)^32 by five e <- 2e - e^2 steps, truncated to 24 bits."""
    for _ in range(5):
        x = lim(acc)
        acc = s56(2*acc) - 2*x*x
    return lim(acc)


def knob_index(raw):
    """min(127, round(raw / 2^16)) as the DSP computes it (the fraction counts in the compare)."""
    acc = (s24(raw) + 0x8000) << 8
    return 127 if acc > 127 << 24 else acc >> 24


class LadderReference:
    """NFX4P's arithmetic written out: no instruction decoding, no registers or entry offsets."""
    def __init__(self, tables):
        self.ctl_table = tables['ctl']
        self.tanh = tables['tanh']
        self.init()

    def init(self):
        self.p = [0, 0, 0, 0]
        self.stage = self.level = self.frac = self.dt = self.gain = self.gate = 0

    def controls(self, raw):
        return [s24(self.ctl_table[128*i + knob_index(r)]) for i, r in enumerate(raw)]

    def trigger(self, raw):
        c = self.controls(raw)
        self.stage, self.level, self.frac = 1, 0, 0
        self.gate = c[7]

    def envelope(self, c):
        """One 32-sample envelope step; returns (dt0 per sample, ddt, c2 or None, dc2)."""
        base, fb8, depth = c[0], c[1], c[3]
        if self.stage in (1, 2) and 2097 <= base <= 0x480000:
            level = self.level
            if self.stage == 1:
                atk = c[4]
                acc = atk << 24 if atk >= 0 else (atk & 0x7fffff) << 16
                e = pow32(acc)
                acc = (level << 24) + self.frac + 2*e*(FULL-level) + 2*e*FULL
                if acc >= FULL << 24:
                    acc, self.stage = FULL << 24, 2
            else:
                e = pow32(c[5] << 24)
                acc = (level << 24) + self.frac - 2*e*level
                if acc <= 128 << 24:
                    acc, self.stage = 0, 0
            self.level, self.frac = hi(acc), acc & 0xffffff
            if depth:
                acc = s56(2*(2*depth*self.level + (base << 24)))
                dt1 = hi(min(max(acc, DT_MIN << 24), DT_MAX << 24))
                dt0 = self.dt
                ddt = step32(dt1 - dt0)
                self.dt = s24(dt0 + 32*ddt)
                c2_end = hi(2*fb8*self.dt + (fb8 << 23))
                c2_0 = hi(2*fb8*dt0 + (fb8 << 23))
                return dt0, s24(ddt), c2_0, step32(c2_end - c2_0)
        self.dt = hi(min(base << 25, DT_MAX << 24))
        return self.dt, 0, None, 0

    def shaper(self, x1, c2, p3):
        """tanh(in - error fb p3), interpolated from the table; returns the saturated drive T."""
        acc = (x1 << 24) - 2*c2*p3
        negative = acc < 0
        y1 = lim(abs(s56(2*acc)))
        i, frac = y1 >> 13, (y1 & 0x1fff) << 10
        t = hi((self.tanh[i] << 24) + 2*frac*self.tanh[i+1] - 2*frac*self.tanh[i])
        return -t if negative else t

    def render(self, raw, track, samples):
        c = self.controls(raw)
        if not track:
            return [0]*BLOCK
        dt, ddt, c2, dc2 = self.envelope(c)
        env = c2 is not None
        if not env:
            c2 = hi(2*c[1]*dt + (c[1] << 23))
        gain, second = c[6], c[2] < 0
        p0, p1, p2, p3 = self.p
        out = []
        for s in samples:
            if env:
                dt, c2 = s24(dt+ddt), s24(c2+dc2)
            x1 = hi(2*gain*s24(s))
            for _ in range(2):
                t = self.shaper(x1, c2, p3)
                a0 = rnd((p0 << 24) + 2*dt*t - 2*dt*p0)
                p0 = lim(a0)
                a1 = rnd((p1 << 24) + 2*dt*p0 - 2*dt*p1)
                p1 = lim(a1)
                a2 = rnd((p2 << 24) + 2*dt*p1 - 2*dt*p2)
                p2 = lim(a2)
                a3 = rnd((p3 << 24) + 2*dt*p2 - 2*dt*p3)
                p3 = lim(a3)
            half = lim((p1 << 24) >> 1) if second else lim(a3 >> 1)
            out.append(lim(s56((2*OUT_GAIN*half) << 3)))
        self.p = [p0, p1, p2, p3]
        return self.vca(c[7], out)

    def vca(self, mode, out):
        if not mode:
            return out
        if mode == 1:
            target = self.level
        else:
            target = FULL if self.gate > 16 else 0
            self.gate = max(0, self.gate - 32)
        g = self.gain
        dg = step32(min(max(target - g, -VCA_STEP32), VCA_STEP32))
        end = s24(g + 32*dg)
        self.gain = target if abs(target - end) < 32 else end
        if not dg and g == FULL:
            return out
        return [lim(2*y*lim((g + (n+1)*dg) << 24)) for n, y in enumerate(out)]

    def state(self):
        p = [v & 0xffffff for v in self.p]
        return p + [v & 0xffffff for v in (self.stage, self.level, self.dt, self.frac, self.gain, self.gate)]


class Signal:
    """Seeded input blocks for the bank NFX4P reads."""
    def __init__(self, kind, seed=1):
        self.kind, self.n, self.seed = kind, 0, seed

    def block(self):
        out = []
        for _ in range(BLOCK):
            n = self.n
            if self.kind == 'zero':
                v = 0
            elif self.kind == 'impulse':
                v = FULL if n % 1500 == 0 else 0
            elif self.kind == 'full':
                v = FULL
            elif self.kind == 'negative':
                v = -Q
            elif self.kind == 'square':
                v = FULL if (n // 50) % 2 else -Q
            elif self.kind == 'saw':
                v = ((n * 97) % 2048 - 1024) << 13
            else:
                self.seed = (self.seed*0x19660d + 0x3c6ef3) & 0xffffff
                v = s24(self.seed) >> (1 if self.kind == 'loud' else 2)
            out.append(s24(v))
            self.n += 1
        return out


def cases():
    d = [64, 0, 0, 64, 0, 64, 64, 127]
    out = []

    def case(name, knobs, signal='noise', triggers=(), motion=None, blocks=96, track=1):
        out.append(dict(name=name, knobs=knobs, signal=signal, triggers=set(triggers), motion=motion or {},
                        blocks=blocks, track=track))

    def k(**changes):
        names = ('freq', 'reso', 'mode', 'enva', 'atk', 'dec', 'gain', 'vca')
        v = d.copy()
        for key, value in changes.items():
            v[names.index(key)] = value
        return v

    case('default', d)
    case('first-track', k(reso=100), track=0, blocks=8)
    case('reso-127', k(reso=127), signal='impulse')
    case('reso-127-2nd-pole', k(reso=127, mode=127), signal='impulse')
    case('reso-127-cutoff-0', k(freq=0, reso=127))
    case('reso-127-cutoff-127', k(freq=127, reso=127))
    case('cutoff-0', k(freq=0))
    case('cutoff-127', k(freq=127, gain=127))
    case('mode-63', k(mode=63, reso=90))
    case('mode-64', k(mode=64, reso=90))
    case('gain-0', k(gain=0, reso=127))
    case('gain-127', k(gain=127, reso=127), signal='loud')
    case('silence', k(reso=127, gain=127), signal='zero')
    case('full-scale', k(reso=127, gain=127), signal='full')
    case('full-scale-negative', k(reso=127, gain=127, freq=127), signal='negative')
    case('full-scale-square', k(reso=127, gain=127, mode=127), signal='square')
    case('full-scale-square-cutoff-0', k(reso=127, gain=127, freq=0), signal='square')
    case('env-up', k(freq=20, reso=100, enva=127, atk=30, dec=50), signal='saw', triggers=(1, 40, 41, 80))
    case('env-down', k(freq=127, reso=60, enva=0, atk=10, dec=40), signal='saw', triggers=(0, 50))
    case('env-instant', k(enva=110, atk=0, dec=0), triggers=(2, 3, 30))
    case('env-slow', k(freq=10, enva=127, atk=127, dec=127, reso=127), triggers=(0,), blocks=160)
    case('env-fast-decay', k(enva=90, atk=1, dec=1, mode=100), triggers=(0, 20))
    case('vca-envelope', k(vca=100, enva=100, atk=20, dec=60), triggers=(0, 30, 31, 60))
    case('vca-64', k(vca=64, atk=0, dec=30), triggers=(5, 70))
    case('vca-126', k(vca=126, atk=60, dec=20), triggers=(0,))
    case('vca-gate-0', k(vca=0), triggers=(0, 10, 11, 50))
    case('vca-gate-63', k(vca=63, reso=127), signal='loud', triggers=(0, 90), blocks=120)
    case('vca-before-trigger', k(vca=80), triggers=(40,))
    motion = {
        8: [64, 127, 0, 64, 0, 64, 64, 127],
        9: [(64 << 16) + 0x7fff, 127 << 16, 0, 64 << 16, 0, 64 << 16, 64 << 16, 127 << 16],     # rounds down: same k
        10: [(64 << 16) + 0x8000, 127 << 16, 0, 64 << 16, 0, 64 << 16, 64 << 16, 127 << 16],    # rounds up
        11: [(127 << 16) + 0xffff, 127 << 16, 0, 64 << 16, 0, 64 << 16, 64 << 16, 127 << 16],   # clamps to 127
        20: [30, 100, 127, 120, 10, 30, 90, 100],
        30: [30, 100, 127, 120, 10, 30, 90, 99],     # only the last knob moves
        31: [30, 100, 127, 120, 10, 30, 90, 0],
        50: [127, 127, 127, 0, 127, 127, 127, 63],
        51: [0, 0, 0, 0, 0, 0, 0, 0],
        52: [127]*8,
        60: [(v << 16) | 0x1234 for v in (50, 80, 20, 70, 40, 40, 70, 90)],
        61: [(v << 16) | 0x1235 for v in (50, 80, 20, 70, 40, 40, 70, 90)],
    }
    case('knob-motion', [64, 0, 0, 64, 0, 64, 64, 127], triggers=(0, 21, 32, 53, 62), motion=motion, blocks=100)
    rng = random.Random(4096)
    motion, triggers = {}, set()
    for block in range(400):
        if rng.random() < .15:
            motion[block] = [rng.randrange(128) << 16 | rng.choice((0, 0, rng.randrange(1 << 16))) for _ in range(8)]
        if rng.random() < .08:
            triggers.add(block)
    case('random', d, signal='loud', triggers=triggers, motion=motion, blocks=400)
    return out


def raw_words(knobs):
    return [v if v > 127 else v << 16 for v in knobs]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pack', type=Path, required=True)
    ap.add_argument('--host', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    model = json.loads(args.pack.read_text())['models'][0]
    code = model['code']
    tables = {t['name']: words(t['words']) for t in model['tables']}
    placed = {'@org': 0x110000, 'md_output': 0x140, 'md_track': 0x142}
    loads = []

    def load(space, name, address, data):
        path = args.out/(name+'.bin')
        path.write_bytes(b''.join((v & 0xffffff).to_bytes(3, 'big') for v in data))
        loads.append(f'load {space} {address:x} {path.resolve()}')
    address = 0x120000
    for name, table in tables.items():   # external memory: one word for P, X and Y
        placed[name] = address
        load('P', name, address, table)
        address += len(table)
    instructions = words(code['words'])
    original = code['symbols'] | {'@org': code['org']}
    for offset, symbol, scale in code['relocs']:
        instructions[offset] = (instructions[offset]+scale*(placed[symbol]-original[symbol])) & 0xffffff
    load('P', 'code', placed['@org'], instructions)
    entry = {name: placed['@org']+offset for name, offset in code['entry'].items()}
    poison = [CANARY]*(64*16)
    load('X', 'poison-x', VOICES, poison)
    load('Y', 'poison-y', VOICES, poison)
    lines = loads + [f'set Y 140 {OUTPUT:x}']
    expected, kinds, groups = [], [], []

    def call(kind):
        lines.extend([f'call {entry[kind]:x}', 'cycles'])
        kinds.append(kind)

    def set_knobs(voice, raw):
        lines.extend(f'set Y {voice+i+1:x} {v & 0xffffff:x}' for i, v in enumerate(raw))

    def set_input(samples):
        lines.extend(f'set Y {INPUT+i:x} {v & 0xffffff:x}' for i, v in enumerate(samples))

    def start(track, raw):
        voice = VOICES + 64*track
        # Dirty memory: stale words everywhere, and X:+1..+8 equal to the knobs about to be set.
        lines.extend(f'set {s} {voice+i:x} {(CANARY + 0x10101*i) & 0xffffff:x}' for s in 'XY' for i in range(64))
        lines.extend(f'set X {voice+i+1:x} {v & 0xffffff:x}' for i, v in enumerate(raw))
        lines.extend([f'voice {voice:x}', f'set Y 142 {track:x}'])
        call('init')
        set_knobs(voice, raw)

    for spec in cases():
        lines.append(f'load X {VOICES:x} {(args.out/"poison-x.bin").resolve()}')
        lines.append(f'load Y {VOICES:x} {(args.out/"poison-y.bin").resolve()}')
        track = spec['track']
        voice = VOICES + 64*track
        raw = raw_words(spec['knobs'])
        start(track, raw)
        ref = LadderReference(tables)
        signal = Signal(spec['signal'])
        first = len(expected)
        for block in range(spec['blocks']):
            if block in spec['motion']:
                raw = raw_words(spec['motion'][block])
                set_knobs(voice, raw)
            if block in spec['triggers']:
                call('trigger')
                ref.trigger(raw)
            samples = signal.block()
            set_input(samples)
            call('render')
            lines.append('out')
            expected.extend(ref.render(raw, track, samples))
        lines.extend([f'dump Y {VOICES:x} {64*16:x}', f'dump X {VOICES:x} {64*16:x}'])
        groups.append(dict(name=spec['name'], tracks=[track], start=first, count=spec['blocks']*BLOCK,
                           state={track: ref.state()}, knobs={track: raw}))
    # Two tracks interleaved: shared tables, independent state.
    lines.append(f'load X {VOICES:x} {(args.out/"poison-x.bin").resolve()}')
    lines.append(f'load Y {VOICES:x} {(args.out/"poison-y.bin").resolve()}')
    settings = {1: raw_words([40, 110, 0, 100, 20, 50, 80, 100]), 15: raw_words([90, 127, 127, 20, 5, 90, 127, 30])}
    refs, signals = {}, {}
    for track in settings:
        start(track, settings[track])
        call('trigger')
        refs[track] = LadderReference(tables)
        refs[track].trigger(settings[track])
        signals[track] = Signal('noise', seed=track)
    first = len(expected)
    for block in range(120):
        for track in settings:
            samples = signals[track].block()
            set_input(samples)
            lines.extend([f'voice {VOICES+64*track:x}', f'set Y 142 {track:x}'])
            if block == 60 and track == 15:
                call('trigger')
                refs[track].trigger(settings[track])
            call('render')
            lines.append('out')
            expected.extend(refs[track].render(settings[track], track, samples))
    lines.extend([f'dump Y {VOICES:x} {64*16:x}', f'dump X {VOICES:x} {64*16:x}'])
    groups.append(dict(name='interleaved', tracks=list(settings), start=first, count=120*2*BLOCK,
                       state={t: r.state() for t, r in refs.items()}, knobs=settings))

    script = args.out/'check.script'
    script.write_text('\n'.join(lines)+'\n')
    raw_out = args.out/'audio.raw'
    result = subprocess.run([str(args.host), str(script.resolve()), str(raw_out.resolve())], capture_output=True, text=True,
                            timeout=600, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    (args.out/'host.log').write_text(result.stdout+'\n'+result.stderr)
    if result.returncode:
        raise RuntimeError(result.stdout[-1000:]+result.stderr[-1000:])
    audio = list(struct.unpack('<'+'i'*(raw_out.stat().st_size//4), raw_out.read_bytes()))
    counts = [int(v) for v in re.findall(r'instructions\s+\d+\s+cycles\s+(\d+)', result.stdout)]
    dumps = re.findall(r'^dump (.*)$', result.stdout, re.M)
    assert len(audio) == len(expected), (len(audio), len(expected))
    assert len(counts) == len(kinds) and len(dumps) == 2*len(groups)
    failures = []
    for group, dump, xdump in zip(groups, dumps[::2], dumps[1::2]):
        start_, end = group['start'], group['start']+group['count']
        actual, want = audio[start_:end], expected[start_:end]
        if actual != want:
            i = next(i for i, (a, b) in enumerate(zip(actual, want)) if a != b)
            failures.append(dict(case=group['name'], index=i, actual=actual[i], expected=want[i],
                                 mismatches=sum(a != b for a, b in zip(actual, want))))
        memory = [int(v, 16) for v in dump.split()]
        xmemory = [int(v, 16) for v in xdump.split()]
        for track in range(16):
            block = memory[64*track:64*track+64]
            if track in group['state']:
                state = [block[n] for n in STATE]
                if state != group['state'][track]:
                    failures.append(dict(case=group['name'], track=track, error='state', actual=state,
                                         expected=group['state'][track]))
            elif block != [CANARY]*64 or xmemory[64*track:64*track+64] != [CANARY]*64:
                failures.append(dict(case=group['name'], track=track, error='voice block escape'))
        if group['name'] == 'first-track' and any(actual):
            failures.append(dict(case=group['name'], error='the first track is not silent'))
    peaks = {kind: max(v for k, v in zip(kinds, counts) if k == kind) for kind in ('init', 'trigger', 'render')}
    budget = model['contract']['budget']
    if peaks['init'] > budget['init_cycles'] or peaks['trigger'] > budget['trigger_cycles'] or peaks['render']/32 > budget['render_cps']:
        failures.append(dict(error='declared budget exceeded', cycles=peaks))
    report = dict(status='FAIL' if failures else 'PASS', cases=len(groups), samples=len(audio),
                  render_cycles=peaks['render'], render_cps=peaks['render']/32, init_cycles=peaks['init'],
                  trigger_cycles=peaks['trigger'], failures=failures, seconds=round(time.perf_counter()-started, 1),
                  audio_sha256=hashlib.sha256(raw_out.read_bytes()).hexdigest(),
                  host_sha256=hashlib.sha256(args.host.read_bytes()).hexdigest(),
                  pack_sha256=hashlib.sha256(args.pack.read_bytes()).hexdigest())
    (args.out/'result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
