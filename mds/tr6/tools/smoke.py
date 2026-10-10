"""Render a relocated MDS fixture on the DSP instruction host; compare integers.

Checks dirty state initialization, the supplied output buffer, register scrubbing,
and relocated program/import operands. Cycle-table counts are NOT cold-cache cost.
"""
import argparse
import json
import math
import os
from pathlib import Path
import struct
import subprocess

from mds_build import ROOT, assemble_package, mds_format


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--assembler', required=True)
    p.add_argument('--host', required=True)
    p.add_argument('--out', type=Path, default=ROOT / 'build/smoke')
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    package, build = assemble_package((ROOT/'tests/sine.asm').read_text(),
        json.loads((ROOT/'tests/sine.json').read_text()), args.assembler,
        imports={'mds_sine': (1, 1)}, x_words=1, y_words=3)
    (args.out/'sine.mds').write_bytes(package)
    image = mds_format().parse_package(package)
    code = [int.from_bytes(image['program'][i:i+3], 'big') for i in range(0, len(image['program']), 3)]
    base, table = 0x110023, 0x148000
    for i in image['relocations']:
        code[i] += base
    for item in image['imports']:
        code[item.patch_word] += table
    (args.out/'code.bin').write_bytes(b''.join(w.to_bytes(3,'big') for w in code))
    sine = [round(math.sin(i*2*math.pi/32768)*0x7fffff) for i in range(32768)]
    (args.out/'sine.bin').write_bytes(b''.join((w & 0xffffff).to_bytes(3,'big') for w in sine))
    # Paths are relative to the host cwd: its script parser splits on whitespace.
    lines = ['load P 110023 code.bin', 'load X 148000 sine.bin', 'voice 800',
             'set X 800 5a5a5a', 'set Y 800 5a5a5a', 'set Y 801 18000', 'set Y 802 400000',
             f"call {base+image['init_word']:x}", f"call {base+image['mutate_word']:x}"]
    for _ in range(8):
        lines += ['scrub 1f', f"call {base+image['execute_word']:x}", 'cycles', 'out']
    lines += ['dump Y 800 3']
    (args.out/'render.script').write_text('\n'.join(lines)+'\n')
    run = subprocess.run([str(Path(args.host).resolve()), 'render.script', 'out.raw'],
        cwd=args.out, capture_output=True, text=True, timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    (args.out/'host.log').write_text(run.stdout+'\n'+run.stderr)
    run.check_returncode()
    actual = list(struct.unpack('<256i',(args.out/'out.raw').read_bytes()))
    expected = [sine[((i*0x18000)&0xffffff)>>9]//2 for i in range(256)]
    if actual != expected:
        i = next(i for i, (a,b) in enumerate(zip(actual,expected)) if a!=b)
        raise AssertionError(f'sample {i}: {actual[i]} != {expected[i]}')
    if 'dump 5a5a5a 18000 400000' not in run.stdout:
        raise AssertionError('Reserved/parameter words modified')
    report = dict(status='pass', samples=len(actual), comparison='bit-exact',
                  program_words=build['program_words'], hardware_validated=False,
                  cold_cache_measured=False, installable=False)
    (args.out/'result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':
    main()
