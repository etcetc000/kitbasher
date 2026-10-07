"""Pitch metadata: packs/pitch.py (the twin of engine/src/pitch.ts) and the example manifests.

Also holds PHYKS to its tuning: the loop delay (ring length + interpolated tap + the DAMP
averager) solved for its true resonance, every raw at three DAMP settings, within 0.1 cent.
"""
import cmath
import json
import math
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packs'))
import pitch as P  # noqa: E402
from model_manifest import validate  # noqa: E402

Q = dict(knob=0, law='quarter', steps=2, base_note=24)


class Mapping(unittest.TestCase):
    def test_quarter_law_and_names(self):
        self.assertEqual([P.raw_to_note(r, Q) for r in (0, 72, 127)], [24, 60, 87.5])
        self.assertEqual(P.note_to_raw(60, Q), (72, False, 60))
        self.assertEqual(P.note_to_raw(88, Q), (127, True, 87.5))
        self.assertEqual(P.note_to_raw(23, Q), (0, True, 24))
        self.assertEqual((P.note_name(60), P.note_name(24), P.note_name(60.5)), ('C3', 'C0', 'C3+'))
        for n in range(24, 88):
            self.assertEqual(P.raw_to_note(P.note_to_raw(n, Q)[0], Q), n)

    def test_relative_and_by_mode(self):
        rel = dict(knob=0, law='relative', steps=2, center=64)
        self.assertEqual(P.raw_to_note(66, rel), 1)
        self.assertEqual(P.note_to_raw(-1, rel), (62, False, -1))
        bm = dict(Q, mode_knob=2, by_mode=[dict(zone=0, base_note=-5, range=[10, 127]), dict(zone=1, law='none')])
        self.assertEqual(P.note_to_raw(0, bm, 0), (10, False, 0))
        self.assertEqual(P.note_to_raw(-3, bm, 0), (10, True, 0))
        self.assertIsNone(P.raw_to_note(5, bm, 1))


class Manifests(unittest.TestCase):
    def test_every_example_manifest_validates_with_its_pitch(self):
        seen = 0
        for f in sorted((ROOT / 'examples').glob('*/*/model.json')):
            m = json.loads(f.read_text(encoding='utf-8'))
            if 'pitch' not in m['panel']:
                continue
            validate(m)
            seen += 1
        self.assertGreaterEqual(seen, 13)

    def test_a_pitch_that_contradicts_the_panel_is_refused(self):
        m = json.loads((ROOT / 'examples/analog/rc/model.json').read_text(encoding='utf-8'))
        del m['panel']['pitch']['by_mode']
        del m['panel']['pitch']['mode_knob']
        with self.assertRaisesRegex(ValueError, 'relabels the pitch knob TONE'):
            validate(m)


def phyks_f0(L, a, d, sr=44100.0):
    """Resonance of z^-L ((1-a) + a z^-1) ((1-d) + d z^-1): total phase 2 pi."""
    def phase(w):
        return (w * L - cmath.phase((1 - a) + a * cmath.exp(-1j * w))
                - cmath.phase((1 - d) + d * cmath.exp(-1j * w)))
    w = 2 * math.pi / (L + a + d)
    for _ in range(30):
        g = phase(w) - 2 * math.pi
        w -= g / ((phase(w + 1e-7) - phase(w)) / 1e-7)
    return w * sr / (2 * math.pi)


class Phyks(unittest.TestCase):
    def test_fractional_delay_tunes_every_raw_within_a_tenth_of_a_cent(self):
        text = (ROOT / 'examples/physical/ks/tables.asm').read_text(encoding='utf-8')
        block = re.search(r'^period:\n((?:    \.dc .*\n)+)', text, re.M).group(1)
        period = [int(v[1:], 16) for v in re.findall(r'\$[0-9a-f]+', block)]
        worst = 0.0
        for damp in (0, 96, 127):
            for raw in range(128):
                # exactly the DSP's split (ci/ksstr_check.py StringReference.block)
                exact = (period[raw] << 12) - (damp << 16)
                L, a = exact >> 24, ((exact >> 1) & 0x7fffff) / 2 ** 23
                f = phyks_f0(L, a, (damp << 15) / 2 ** 23)
                worst = max(worst, abs(1200 * math.log2(f / P.midi_hz(P.raw_to_note(raw, Q)))))
        self.assertLess(worst, 0.1)


if __name__ == '__main__':
    unittest.main()
