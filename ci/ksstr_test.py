"""PHYKS (examples/physical/ks): host-independent checks of the bundled pack and its reference model.

The sample-exact comparison with the DSP code needs an instruction host (ci/ksstr_check.py,
npm run test:ksstr); this covers what does not.
"""
import base64
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ci'))
from ksstr_check import SLICE, StringReference, words

SOURCE = ROOT / 'examples/physical/ks'


class Ksstr(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = json.loads((ROOT / 'catalog/physical-ks.json').read_text(encoding='utf-8'))
        cls.model = cls.pack['models'][0]
        cls.manifest = json.loads((SOURCE / 'model.json').read_text(encoding='utf-8'))
        cls.tables = {t['name']: words(t['words']) for t in cls.model['tables']}

    def test_catalog_pack_is_built_from_the_source_manifest(self):
        m = self.model
        self.assertEqual([x['key'] for x in self.pack['models']], ['PHY/KS'])
        self.assertEqual(m['contract'], self.manifest)
        self.assertEqual((m['name'], m['aliases']), ('PHYKS', ['EX/KARPLUS']))
        self.assertEqual(m['labels'], ['PTCH', 'DEC', 'DAMP', 'LEVL', 'HAMR', 'PICK', 'BEND', 'BDEC'])
        self.assertEqual(m['defaults'], [k['default'] for k in self.manifest['panel']['knobs']])

    def test_pi_slice_contract(self):
        pi = [x for x in self.manifest['memory'] if x['kind'] == 'pi']
        self.assertEqual(pi, [dict(kind='pi', space='XY', words=1536, alignment=512, lifetime='track-assignment',
                                   init='chunked-muted', release='plain-audio')])
        self.assertEqual(self.model['workspace_kind'], 'pi')
        self.assertFalse(self.model['workspace'])

    def test_code_is_self_contained_and_small(self):
        code = self.model['code']
        allowed = {'@org', 'md_output', 'md_track', 'pi_ws', *self.tables}
        self.assertLessEqual({r[1] for r in code['relocs']}, allowed)
        self.assertEqual(self.model['needs'], [])
        self.assertEqual(self.model['uses_shared'], [])
        # 252 words: at most three 128-word instruction-cache sectors at any placement.
        self.assertLessEqual(len(base64.b64decode(code['words'])) // 3, 257)

    def test_slice_clear_is_chunked_with_interruptible_loops(self):
        text = (SOURCE / 'dsp2.asm').read_text(encoding='utf-8')
        body = '\n'.join(line.split(';')[0] for line in text.splitlines())
        self.assertNotRegex(body, r'(?im)^\s*rep\b')
        # 512 words a block, three blocks for the 1536-word slice.
        self.assertRegex(body, r'do #\$200,clear_end')
        self.assertRegex(body, r'cmp #>\$600,a')

    def test_reference_mutes_while_clearing_and_respects_level(self):
        defaults = self.model['defaults']
        ref = StringReference(self.tables)
        self.assertEqual(ref.block(defaults), [0] * 32)  # untriggered: clears, silent
        ref = StringReference(self.tables)
        ref.trigger()
        self.assertEqual([ref.block(defaults) for _ in range(3)], [[0] * 32] * 3)
        self.assertEqual(ref.ring, [0] * SLICE)
        self.assertTrue(any(ref.block(defaults)))
        ref.trigger()  # a retrigger restarts the clear
        self.assertEqual([ref.block(defaults) for _ in range(3)], [[0] * 32] * 3)
        muted = defaults.copy(); muted[3] = 0
        ref = StringReference(self.tables)
        ref.trigger()
        self.assertFalse(any(v for _ in range(40) for v in ref.block(muted)))

    def test_tables_match_their_formulas(self):
        sys.path.insert(0, str(SOURCE))
        try:
            import make_tables
        finally:
            sys.path.remove(str(SOURCE))
        generated = make_tables.generate()
        self.assertEqual(generated, (SOURCE / 'tables.asm').read_text(encoding='utf-8'))
        for name, values in self.tables.items():
            block = re.search(rf'^{name}:\n((?:    \.dc .*\n)+)', generated, re.M).group(1)
            self.assertEqual(values, [int(v[1:], 16) for v in re.findall(r'\$[0-9a-f]+', block)])


if __name__ == '__main__':
    unittest.main()
