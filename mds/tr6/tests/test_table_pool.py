"""Protect exact array boundaries and the unchanged default source format."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from table_pool import emit_tables


class TablePoolTests(unittest.TestCase):
    def test_default_keeps_separate_arrays_and_legacy_format(self):
        self.assertEqual(emit_tables({'a':[1,2],'b':[1,2]}),
                         ['a:','    .dc $000001,$000002','b:','    .dc $000001,$000002'])

    def test_only_complete_identical_arrays_share_storage(self):
        self.assertEqual(emit_tables({'a':[1,2,3],'prefix':[1,2],'c':[1,2,3]},True),
                         ['a:','c:','    .dc $000001,$000002,$000003',
                          'prefix:','    .dc $000001,$000002'])

    def test_equality_uses_emitted_24_bit_words(self):
        self.assertEqual(emit_tables({'signed':[-1,0],'unsigned':[0xffffff,0]},True),
                         ['signed:','unsigned:','    .dc $ffffff,$000000'])


if __name__=='__main__': unittest.main()
