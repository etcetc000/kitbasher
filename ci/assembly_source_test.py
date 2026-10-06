"""Assembly source boundaries that do not need the native instruction encoder."""
import sys
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packs'))
import assembly as A


class AssemblySource(unittest.TestCase):
    def test_no_python_expressions(self):
        with self.assertRaises(ValueError):
            A.expression('__import__("os")', {})

    def test_path_escape(self):
        with self.assertRaises(ValueError):
            A.read_source(ROOT, '../outside.asm')
