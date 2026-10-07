"""NFX4P (examples/effects/ladder): the bundled pack, its tables and the source rules.

The bit-exact comparison with the original NFX-4P runs on a DSP kernel harness outside
this repository (see examples/effects/ladder/README.md#checks); these checks need no
DSP host.
"""
import base64
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
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


if __name__ == '__main__':
    unittest.main()
