"""Regression checks for the native interpolation validator."""
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_bd_stride import check_interpolation


class InterpolationContract(unittest.TestCase):
    def test_signed_extremes_and_history(self):
        # Negative odd sums round down; the second midpoint crosses polarity.
        samples=(-4194304,-8388608,-1,8388607,4194303,0,0,0)
        self.assertEqual(check_interpolation(struct.pack('<8i',*samples)),4)

    def test_incorrect_midpoint_is_rejected(self):
        with self.assertRaises(AssertionError): check_interpolation(struct.pack('<4i',2,4,5,8))

    def test_history_reset_between_pairs_is_rejected(self):
        with self.assertRaises(AssertionError): check_interpolation(struct.pack('<4i',2,4,4,8))

    def test_partial_or_missing_pairs_are_rejected(self):
        for raw in (b'',b'\0',bytes(4),bytes(12)):
            with self.subTest(length=len(raw)),self.assertRaises(AssertionError): check_interpolation(raw)


if __name__=='__main__': unittest.main()
