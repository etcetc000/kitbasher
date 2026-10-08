"""Control-flow targets in model assembly, without the native instruction encoder.

Branch, jump, call and DO-loop targets must be labels. A target written as an offset from a
label (`jsr code_origin+1054`, `do #<$20,>code_origin+548`) silently goes stale as soon as code
is inserted above it: the 2.0.0 pitch change added nine words to VADSY and six to VADPC, and
the stale targets made VADSY stop DSP2 on its first trigger and VADPC drop samples.

The second check reads the bundled packs: every relocated DO-loop end must lie after its DO and
inside the code block, and every relocated jump or call must land inside the code block.
"""
import base64
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CC = 'cc hs cs lo ec eq es ge gt lc le ls lt mi ne nr pl nn'.split()
FLOW = ({'do', 'dor', 'jmp', 'jsr', 'bra', 'bsr', 'jclr', 'jset', 'jsclr', 'jsset',
         'brclr', 'brset', 'bsclr', 'bsset'}
        | {p + c for p in ('j', 'b', 'js', 'bs') for c in CC})
OFFSET_TARGET = re.compile(r'^[A-Za-z_]\w*\s*[-+]\s*(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|\d+)$')


def offset_target(line):
    """The target of a flow instruction written as label +/- number, else None."""
    s = line.split(';', 1)[0].strip()
    m = re.match(r'^\w+:\s*(.*)$', s)
    if m:
        s = m[1]
    op, _, operands = s.partition(' ')
    if op.lower() not in FLOW or not operands.strip():
        return None
    target = operands.split(',')[-1].strip().lstrip('<>#').strip()
    return target if OFFSET_TARGET.match(target) else None


def words(b64):
    raw = base64.b64decode(b64)
    return [int.from_bytes(raw[i:i + 3], 'little') for i in range(0, len(raw), 3)]


def flow_errors(name, block):
    """Relocated DO ends and jump/call targets of one code block that fall outside it."""
    w, org, errors = words(block['words']), block['org'], []
    for index, symbol, *_ in block.get('relocs', []):
        if symbol != '@org' or index == 0:
            continue
        op, target = w[index - 1], w[index] - org
        if op >> 16 == 0x06:   # DO / DOR with an absolute loop end: the end is the last body word
            if not index + 1 <= target < len(w):
                errors.append(f'{name}: DO at +{index - 1:#x} ends at +{target:#x}, outside its body')
        elif op in (0x0af080, 0x0bf080) or op & 0xfffff0 in (0x0af0a0, 0x0bf0a0):
            if not 0 <= target < len(w):
                errors.append(f'{name}: jump at +{index - 1:#x} to +{target:#x}, outside the code')
    return errors


class AssemblyTargets(unittest.TestCase):
    def test_offset_targets_are_recognised(self):
        for line in ('    jsr code_origin+1054', '    do #<$37,>code_origin+7', 'x: jne code_origin+858',
                     '    jmp code_origin + $2fe', '    brset #3,x:(r0),start-2', '    dor #4,loop+0x10'):
            self.assertIsNotNone(offset_target(line), line)
        for line in ('    do #32,done', '    jsr local_41e', '    jmp $00026f', '    bsr <local_b8',
                     '    bclr #3,x:(r6+$3)', '    move #>code_origin+4,r0', '    add #>e0_stb+1,a',
                     '; jsr code_origin+4', '    rts'):
            self.assertIsNone(offset_target(line), line)

    def test_model_sources_branch_only_to_labels(self):
        found = []
        sources = sorted(ROOT.glob('examples/**/*.asm'))
        self.assertTrue(sources)
        for path in sources:
            for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if offset_target(line):
                    found.append(f'{path.relative_to(ROOT).as_posix()}:{n}: {line.strip()}')
        self.assertEqual(found, [], 'use a label as the target, not an offset from one')

    def test_bundled_loops_and_jumps_stay_inside_their_code(self):
        errors, checked = [], 0
        for path in sorted(ROOT.glob('catalog/**/*.json')):
            pack = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(pack, dict):
                continue
            blocks = [(m['key'], m['code']) for m in pack.get('models', []) if 'code' in m]
            blocks += [('DSP1 ' + law['name'], law) for law in pack.get('dsp1_laws', []) if 'words' in law]
            for name, block in blocks:
                checked += 1
                errors += flow_errors(f'{path.name} {name}', block)
        self.assertGreater(checked, 0)
        self.assertEqual(errors, [])

    def test_a_loop_end_above_its_do_is_caught(self):
        # VADSY 2.0.0 as first released: DO #$17 at +0x474 with its end at +0x46e, above the loop
        org = 0x110000
        w = [0] * 0x480
        w[0x474], w[0x475] = 0x061780, org + 0x46e
        block = dict(org=org, words=base64.b64encode(b''.join(v.to_bytes(3, 'little') for v in w)).decode(),
                     relocs=[[0x475, '@org', 1]])
        self.assertEqual(len(flow_errors('VADSY', block)), 1)
        w[0x475] = org + 0x477
        block['words'] = base64.b64encode(b''.join(v.to_bytes(3, 'little') for v in w)).decode()
        self.assertEqual(flow_errors('VADSY', block), [])


if __name__ == '__main__':
    unittest.main()
