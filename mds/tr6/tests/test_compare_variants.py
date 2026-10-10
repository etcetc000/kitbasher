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
        row=dict(case=name,knobs=knobs or [64],samples=2,numeric_pass=True,
                 host_cycle_table_max_call=100)
        (root/'comparison.json').write_text(json.dumps([row]))
        (root/f'{name}.reference.raw').write_bytes(reference)
        (root/f'{name}.raw').write_bytes(struct.pack('<ii',123,-456))
        (root/f'{name}.wav').touch()

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
            self.fixture(c,'default',knobs=[63])
            with self.assertRaisesRegex(ValueError,'knobs differs'): compare(b,c)


if __name__=='__main__': unittest.main()
