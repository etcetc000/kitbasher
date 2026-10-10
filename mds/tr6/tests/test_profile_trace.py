"""Boundary checks for the documented instruction-word cache model."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from profile_trace import cold_fetch_misses


class CacheTests(unittest.TestCase):
    def test_two_word_instruction_crosses_sector_boundary(self):
        self.assertEqual(cold_fetch_misses([(127, 0), (128, 1)], {127: 2, 128: 1}), 2)

    def test_fills_words_not_whole_sectors(self):
        self.assertEqual(cold_fetch_misses([(0, 0), (1, 1), (0, 2)], {0: 1, 1: 1}), 2)

    def test_full_cache_stays_warm_until_sector_eviction(self):
        pcs = list(range(1024)) * 2
        self.assertEqual(cold_fetch_misses([(pc, i) for i, pc in enumerate(pcs)], {i: 1 for i in range(1024)}), 1024)

    def test_eviction_uses_last_access_not_insertion_order(self):
        pcs = [128 * i for i in range(8)] + [0, 1024, 0, 128]
        self.assertEqual(cold_fetch_misses([(pc, i) for i, pc in enumerate(pcs)], {pc: 1 for pc in pcs}), 10)


if __name__ == '__main__':
    unittest.main()
