"""Scoring must reject audio that no longer matches its render-time hashes."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from score_variants import render_metadata
from compare_variants import digest


class ProvenanceTests(unittest.TestCase):
    def test_retained_render_is_distinct_from_execution_time_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(render_metadata(Path(tmp),'default'))

    def test_changed_audio_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); audio=root/'default.raw'; audio.write_bytes(b'original')
            document=dict(complete=True,captured_before_render=True,inputs_sha256={},
                          cases=[dict(name='default',output_sha256={str(audio.resolve()):digest(audio)})])
            (root/'provenance.json').write_text(json.dumps(document))
            self.assertIsNotNone(render_metadata(root,'default'))
            audio.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'output changed'): render_metadata(root,'default')
