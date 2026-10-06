import json
from pathlib import Path
import tempfile
import unittest
from local_catalog import load_catalog
from uw_asset_test import asset


class LocalCatalog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.packs = self.root / 'packs'; self.packs.mkdir()
        self.samples = self.root / 'samples'; self.samples.mkdir()
        source = {'commit': 'example-source'}
        self.write('core.json', {'format': 'md-pack/1', 'family': 'CORE', 'source': source})
        self.write('example.json', {'format': 'md-pack/1', 'family': 'EX', 'source': source, 'models': [
            {'module': 'example', 'needs': [{'name': 'TEST', 'install': {'file': 'test.syx'}}]}]})
        (self.packs / 'notes.json').write_text('{"not": "a pack"}')
        (self.samples / 'test.syx').write_bytes(asset())

    def write(self, name, pack):
        (self.packs / name).write_text(json.dumps(pack))

    def test_every_pack_and_declared_sample_is_served(self):
        index, catalog, routes = load_catalog(self.packs, self.samples)
        self.assertEqual(index['packs'], ['core.json', 'example.json'])
        self.assertEqual(catalog['assets'][0]['module'], 'example')
        self.assertEqual(catalog['assets'][0]['firmware_commit'], 'example-source')
        self.assertEqual(routes['/uw-data/test.syx'], asset())

    def test_samples_are_optional(self):
        _, catalog, routes = load_catalog(self.packs)
        self.assertEqual(catalog['assets'], [])
        (self.samples / 'test.syx').unlink()
        _, catalog, _ = load_catalog(self.packs, self.samples)
        self.assertEqual(catalog['assets'], [])

    def test_bad_samples_and_paths_are_refused(self):
        (self.samples / 'test.syx').write_bytes(b'bad')
        with self.assertRaises(ValueError): load_catalog(self.packs, self.samples)
        self.write('example.json', {'format': 'md-pack/1', 'family': 'EX', 'models': [
            {'module': 'example', 'needs': [{'name': 'TEST', 'install': {'file': '../test.syx'}}]}]})
        with self.assertRaisesRegex(ValueError, 'basenames'): load_catalog(self.packs, self.samples)

    def test_empty_directory_and_two_cores_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'no md-pack'): load_catalog(self.samples)
        self.write('core2.json', {'format': 'md-pack/1', 'family': 'CORE'})
        with self.assertRaisesRegex(ValueError, 'core'): load_catalog(self.packs)
