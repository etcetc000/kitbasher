"""NFX4P (examples/effects/ladder): the bundled pack, its tables, the source rules and the
integer reference model.

The sample-exact comparison of the DSP code with the reference model needs an instruction
host (ci/ladder_check.py, npm run test:ladder); these checks need none.
"""
import base64
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ci'))
from ladder_check import BLOCK, FULL, LadderReference, cases, knob_index, lim, raw_words, rnd, step32
SOURCE = ROOT / 'examples/effects/ladder'
Q = 1 << 23


def words(encoded):
    data = base64.b64decode(encoded)
    return [int.from_bytes(data[i:i+3], 'little') for i in range(0, len(data), 3)]


class Ladder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = json.loads((ROOT / 'catalog/effects-ladder.json').read_text(encoding='utf-8'))
        cls.model = cls.pack['models'][0]
        cls.manifest = json.loads((SOURCE / 'model.json').read_text(encoding='utf-8'))
        cls.tables = {t['name']: words(t['words']) for t in cls.model['tables']}
        # Loaded by path: PHYKS's tests import a different make_tables module.
        spec = importlib.util.spec_from_file_location('ladder_make_tables', SOURCE / 'make_tables.py')
        cls.make = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.make)

    def test_catalog_pack_is_built_from_the_source_manifest(self):
        m = self.model
        self.assertEqual([x['key'] for x in self.pack['models']], ['NFX/4P'])
        self.assertEqual(m['contract'], self.manifest)
        self.assertEqual(m['name'], 'NFX4P')
        self.assertEqual(m['labels'], ['FREQ', 'RESO', 'MODE', 'ENVA', 'ATK', 'DEC', 'GAIN', 'VCA'])
        self.assertEqual(m['defaults'], [k['default'] for k in self.manifest['panel']['knobs']])
        self.assertEqual([x['kind'] for x in self.manifest['memory']], ['voice'])
        self.assertFalse(m['workspace'])

    def test_tables_match_their_formulas(self):
        self.assertEqual(self.make.content(), (SOURCE / 'tables.asm').read_text(encoding='utf-8'))
        self.assertEqual(self.tables, self.make.tables())

    def test_control_words(self):
        ctl = self.tables['ctl']
        knob = lambda i: ctl[128 * i:128 * i + 128]
        freq, reso, mode, enva, atk, dec, gain, vca = map(knob, range(8))
        self.assertEqual(freq, sorted(freq))
        self.assertEqual((reso[0], reso[127]), (0, 5 * Q // 8))
        self.assertTrue(all(not w & Q for w in mode[:64]) and all(w & Q for w in mode[64:]))
        self.assertEqual(enva[64], 0)
        self.assertTrue(all(w & Q for w in enva[:64]) and not any(w & Q for w in enva[64:]))
        self.assertEqual((atk[0], dec[0]), (Q - 1, Q - 1))       # 0: instant
        self.assertEqual(gain[0], 0)
        self.assertEqual((vca[127], set(vca[64:127])), (0, {1}))
        self.assertEqual(vca[:64], sorted(vca[:64]))
        self.assertTrue(all(w >= 2 for w in vca[:64]))
        self.assertEqual(vca[63], 44100)                          # a half note at 120 BPM: 1 s
        tanh = self.tables['tanh']
        self.assertEqual((len(tanh), tanh[0]), (1025, 0))
        self.assertTrue(tanh == sorted(tanh) and tanh[-1] < Q)

    def test_code_is_self_contained(self):
        code = self.model['code']
        self.assertLessEqual({r[1] for r in code['relocs']}, {'@org', 'md_output', 'md_track', *self.tables})
        self.assertEqual(self.model['needs'], [])
        self.assertEqual(self.model['uses_shared'], [])

    def test_source_rules(self):
        body = [line.split(';')[0] for line in (SOURCE / 'dsp2.asm').read_text(encoding='utf-8').splitlines()]
        text = '\n'.join(body)
        self.assertNotRegex(text, r'(?im)^\s*rep\b')
        # Raw knobs at Y:+1..+8 are read only.
        self.assertNotRegex(text, r'(?i),y:\((r6|r4)\+\$[1-8]\)')
        # No absolute internal X/Y addresses: scratch lives in registers and the voice block.
        self.assertNotRegex(text, r'(?i)[xy]:\$[0-9a-f]+\b')
        # Two spaces between a move's parallel moves; one silently drops the second.
        self.assertFalse([l for l in body if re.match(r'^\s*move\s+\S+ \S+\s*$', l)])
        # Do loops end on distinct addresses.
        ends = re.findall(r'(?im)^\s*do\s+\S+,(\w+)', text)
        self.assertEqual(len(ends), len(set(ends)))


class LadderReferenceModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        model = json.loads((ROOT / 'catalog/effects-ladder.json').read_text(encoding='utf-8'))['models'][0]
        cls.tables = {t['name']: words(t['words']) for t in model['tables']}

    def test_arithmetic(self):
        # Convergent rounding: ties go to the even A1.
        self.assertEqual([rnd(v) >> 24 for v in ((2 << 24) + (1 << 23), (3 << 24) + (1 << 23), (3 << 24) + (1 << 23) + 1)],
                         [2, 4, 4])
        self.assertEqual((lim(1 << 47), lim(-(1 << 47) - 1), lim(5 << 24)), (FULL, -Q, 5))
        self.assertEqual((step32(63), step32(-63), step32(-31)), (1, -1, 0))

    def test_knob_rounding(self):
        self.assertEqual([knob_index(v) for v in (0, 0x7fff, 0x8000, 64 << 16, (126 << 16) + 0x8000, 127 << 16, 0x7fffff)],
                         [0, 0, 1, 64, 127, 127, 127])

    def test_silence_stays_silent_and_the_first_track_is_mute(self):
        ref = LadderReference(self.tables)
        knobs = raw_words([64, 127, 0, 64, 0, 64, 127, 127])
        self.assertEqual(ref.render(knobs, 1, [0] * BLOCK), [0] * BLOCK)
        self.assertEqual(ref.render(knobs, 0, [FULL] * BLOCK), [0] * BLOCK)

    def test_full_scale_input_saturates_without_wrapping(self):
        ref = LadderReference(self.tables)
        knobs = raw_words([127, 127, 0, 64, 0, 64, 127, 127])
        out = [v for _ in range(40) for v in ref.render(knobs, 1, [FULL] * BLOCK)]
        self.assertTrue(all(-Q <= v <= FULL for v in out))
        self.assertGreater(max(out), Q // 2)

    def test_gate_vca_closes(self):
        ref = LadderReference(self.tables)
        knobs = raw_words([100, 0, 0, 64, 0, 64, 100, 0])
        ref.trigger(knobs)
        noise = [((i * 7919) % 4001 - 2000) << 10 for i in range(BLOCK)]
        out = [ref.render(knobs, 1, noise) for _ in range(40)]   # 689 samples at VCA 0, then a 1 ms ramp
        self.assertTrue(any(out[1]))
        self.assertFalse(any(out[-1]))

    def test_cases_cover_the_extremes(self):
        names = {c['name'] for c in cases()}
        self.assertLessEqual({'reso-127', 'cutoff-0', 'cutoff-127', 'silence', 'full-scale', 'first-track',
                              'knob-motion', 'vca-gate-0', 'vca-gate-63', 'vca-126'}, names)


if __name__ == '__main__':
    unittest.main()
