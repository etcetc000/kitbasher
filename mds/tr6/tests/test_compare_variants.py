"""Reject misleading A/B comparisons with changed source streams or controls."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from compare_variants import compare


class ComparisonTests(unittest.TestCase):
    def fixture(self,root,name,reference=b'same',knobs=None):
        root.mkdir(exist_ok=True)
        row=dict(case=name,knobs=knobs or [64],samples=32,numeric_pass=True,
                 host_cycle_table_max_call=100)
        (root/'comparison.json').write_text(json.dumps([row]))
        (root/f'{name}.reference.raw').write_bytes(reference)
        (root/f'{name}.raw').write_bytes(struct.pack('<32i',*([123,-456]*16)))
        (root/f'{name}.wav').touch()
        (root/'assembly.json').write_text(json.dumps({'labels':{'trigger':1}}))
        (root/f'{name}.script').write_text('load P 110023 code.bin\ncall 110024\nout\n')

    def test_extra_baseline_and_duplicate_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            b,e,c=[Path(tmp)/n for n in ('base','extra','candidate')]
            self.fixture(b,'default'); self.fixture(e,'boundary'); self.fixture(c,'boundary')
            self.assertEqual(compare(b,c,[e])[0]['pretrim_peak_delta'],0)
            with self.assertRaisesRegex(ValueError,'Duplicate baseline'):
                compare(b,c,[b])

    def test_changed_reference_and_controls_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            b,c=Path(tmp)/'base',Path(tmp)/'candidate'
            self.fixture(b,'default'); self.fixture(c,'default',reference=b'changed seed')
            with self.assertRaisesRegex(ValueError,'reference streams differ'): compare(b,c)
            self.assertFalse(compare(b,c,allow_model_change=True)[0]['desktop_reference_equal'])
            (c/'default.script').write_text('load P 110023 code.bin\nout\ncall 110024\n')
            with self.assertRaisesRegex(ValueError,'trigger schedule'): compare(b,c,allow_model_change=True)
            self.fixture(c,'default',knobs=[63])
            with self.assertRaisesRegex(ValueError,'knobs differs'): compare(b,c)

    def test_silent_baseline_can_reach_perceptual_scorer(self):
        with tempfile.TemporaryDirectory() as tmp:
            b,c=Path(tmp)/'base',Path(tmp)/'candidate'
            self.fixture(b,'default'); self.fixture(c,'default')
            (b/'default.raw').write_bytes(bytes(32*4))
            row=compare(b,c)[0]
            self.assertIsNone(row['delta_snr_db'])
            self.assertGreater(row['pretrim_peak_delta'],0)

    def test_exact_audio_does_not_hide_changed_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            b,c=Path(tmp)/'base',Path(tmp)/'candidate'
            for directory in (b,c):
                self.fixture(directory,'default')
                with (directory/'default.script').open('a') as stream: stream.write('dump X 800 2\n')
                (directory/'default.host.log').write_text('dump 000001 000002\n')
            self.assertTrue(compare(b,c,require_bitexact=True)[0]['persistent_state_equal'])
            (c/'default.host.log').write_text('dump 000001 000003\n')
            with self.assertRaisesRegex(ValueError,'persistent state'): compare(b,c,require_bitexact=True)
            (c/'default.host.log').write_text('dump 000001\n')
            with self.assertRaisesRegex(ValueError,'Truncated'): compare(b,c,require_bitexact=True)


if __name__=='__main__': unittest.main()
