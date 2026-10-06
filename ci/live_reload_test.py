import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from live_reload import LiveReload, script_signature, source_snapshot


class LiveReloadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.site = self.root / 'web/dist'
        self.site.mkdir(parents=True)
        (self.site / 'index.html').write_text('<style>body{color:red}</style><body>Preview</body>')
        (self.site / 'app.js').write_text('const value=1;')

    def test_css_preserves_state_but_code_and_markup_reload(self):
        before = script_signature(self.site)
        (self.site / 'index.html').write_text('<style>body{color:blue}</style><body>Preview</body>')
        self.assertEqual(script_signature(self.site), before)
        (self.site / 'app.js').write_text('const value=2;')
        self.assertNotEqual(script_signature(self.site), before)
        (self.site / 'app.js').write_text('const value=1;')
        (self.site / 'index.html').write_text('<style>body{color:red}</style><body>Changed</body>')
        self.assertNotEqual(script_signature(self.site), before)

    def test_watcher_ignores_generated_files(self):
        before = source_snapshot(self.root)
        (self.site / 'app.js').write_text('generated change')
        self.assertEqual(source_snapshot(self.root), before)
        source = self.root / 'web/src'
        source.mkdir()
        (source / 'app.ts').write_text('source change')
        self.assertNotEqual(source_snapshot(self.root), before)

    def test_only_successful_rebuilds_notify_browsers(self):
        for code in (1, 0):
            with self.subTest(returncode=code):
                live = LiveReload(self.root, self.site, 'node')
                before = live.state.copy()

                def rebuild(*args, **kwargs):
                    live.stop.set()
                    return SimpleNamespace(returncode=code)

                with patch('live_reload.source_snapshot', side_effect=[{}, {'edit': 1}, {'edit': 1}]), \
                     patch('live_reload.subprocess.run', side_effect=rebuild):
                    live.watch()
                self.assertEqual(live.state == before, code != 0)
                self.assertIn('data-local-reload', live.inject('<body>Preview</body>'))


if __name__ == '__main__':
    unittest.main()
