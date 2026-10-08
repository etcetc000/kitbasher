"""NZEPL (examples/noise-plethora): the bundled pack against a fresh run of authoring.py.

Generating the source runs the generator's own assertions: every table the DSP code shares,
shortens or replaces with arithmetic (mode_index, the SFM/TFM base column, the fb_*_fm shift
columns, fib_ratios' first column, reso_coef's single period, the sh_slew[0] immediates) must be
exactly what the longer form held. Code needs the native assembler (assembly_test, npm run
test:assembly); this covers the panel and every table word without it.
"""
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'examples/noise-plethora'


def words(encoded):
    data = base64.b64decode(encoded)
    return [int.from_bytes(data[i:i+3], 'little') for i in range(0, len(data), 3)]


def asm_tables(text):
    """name -> words, in file order, from tables.asm (`name:` then `.dc $xxxxxx,...` lines)."""
    tables, current = [], None
    for line in text.splitlines():
        line = line.split(';')[0].rstrip()
        if not line:
            continue
        label = re.fullmatch(r'(\w+):', line)
        if label:
            current = (label[1], [])
            tables.append(current)
            continue
        data = re.fullmatch(r'\s+\.dc\s+(.*)', line)
        assert data and current, line
        current[1].extend(int(x.strip().lstrip('$'), 16) for x in data[1].split(','))
    return tables


class NoisePlethora(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = json.loads((ROOT / 'catalog/np.json').read_text(encoding='utf-8'))
        cls.model = cls.pack['models'][0]
        spec = importlib.util.spec_from_file_location('np_authoring', SOURCE / 'authoring.py')
        authoring = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(authoring)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / 'np'
        with contextlib.redirect_stdout(io.StringIO()):
            authoring.generate(cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_catalog_panel_is_the_generated_manifest(self):
        manifest = json.loads((self.out / 'model.json').read_text(encoding='utf-8'))
        self.assertEqual([m['key'] for m in self.pack['models']], ['NZE/PL'])
        self.assertEqual(self.model['contract'], manifest)

    def test_catalog_tables_are_the_generated_tables(self):
        generated = asm_tables((self.out / 'tables.asm').read_text(encoding='utf-8'))
        bundled = [(t['name'], words(t['words'])) for t in self.model['tables']]
        self.assertEqual([n for n, _ in bundled], [n for n, _ in generated])
        for (name, got), (_, want) in zip(bundled, generated):
            self.assertEqual(got, [w & 0xffffff for w in want], name)

    def test_tables_only_the_code_reads_are_packed(self):
        # The live-table filter ignores comments: a table named only in a comment stays out.
        code = '\n'.join(line.split(';')[0] for line in (self.out / 'dsp2.asm').read_text(encoding='utf-8').splitlines())
        for t in self.model['tables']:
            self.assertRegex(code, r'\b' + t['name'] + r'\b')
        for gone in ('pitch', 'mode_index', 'radio_width', 'flange_rate', 'fmp_rates_sineFMcluster'):
            self.assertNotIn(gone, [t['name'] for t in self.model['tables']])

    def test_walking_filomena_clamps_its_filt_period_index(self):
        # WALK's walkers drift past BND, and BND reaches 2,000: the walk step clamps the index
        # at filt_period's last entry. No other walk gets near the end.
        source = (self.out / 'dsp2.asm').read_text(encoding='utf-8')
        size = {t['name']: len(words(t['words'])) for t in self.model['tables']}
        clamp = f'    move #>{size["filt_period"] - 1},x0\n    cmp x0,a\n    tgt x0,a\n    add #>filt_period,a\n'
        self.assertEqual(source.count(clamp), 1)
        walk = source[source.index('\nwalk_ready:'):source.index('\nwalk_walk_end:')]
        self.assertIn(clamp, walk)

    def test_shortened_tables(self):
        size = {t['name']: len(words(t['words'])) for t in self.model['tables']}
        self.assertEqual(size['reso_coef'], 1024)          # one period of the triangle fold
        self.assertEqual(size['fib_ratios'], 128 * 15)     # ratio 1 (2^16) is not stored
        self.assertEqual(size['fb_atari_fm'], 128 * 3)     # the negative input's shift is always 0
        self.assertEqual(size['fb_cmr_fm'], 128 * 3)


if __name__ == '__main__':
    unittest.main()
