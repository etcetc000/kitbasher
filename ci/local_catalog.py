"""Load a local pack directory for the development server, in memory.

Every md-pack/1 JSON file in the directory becomes the page's catalog. Sample files that a
pack's models declare (needs[].install.file) are looked up in the sample directory, checked
with packs/uw_asset.py and offered as downloads bound to that model and pack source.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packs'))
from uw_asset import inspect


def basename(value):
    if not isinstance(value, str) or not value or Path(value).name != value or '/' in value or '\\' in value:
        raise ValueError('pack and sample filenames must be basenames')
    return value


def load_catalog(pack_dir, uw_dir=None):
    """Return (index fields, md-uw-downloads/1 catalog, {route: bytes})."""
    pack_dir = Path(pack_dir).resolve()
    if not pack_dir.is_dir():
        raise ValueError(f'not a directory: {pack_dir}')
    routes, packs, names = {}, [], []
    for path in sorted(pack_dir.glob('*.json')):
        raw = path.read_bytes()
        try:
            pack = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(pack, dict) or pack.get('format') != 'md-pack/1':
            continue
        names.append(path.name)
        packs.append(pack)
        routes['/data/packs/' + path.name] = raw
    if not packs:
        raise ValueError(f'no md-pack/1 files in {pack_dir}')
    if sum(p.get('family') == 'CORE' for p in packs) > 1:
        raise ValueError('a catalog holds at most one core pack')
    assets = []
    if uw_dir is not None:
        uw_dir = Path(uw_dir).resolve()
        for pack in packs:
            source = (pack.get('source') or {}).get('commit', '')
            for model in pack.get('models', []):
                for need in model.get('needs', []):
                    install = need.get('install')
                    if not install:
                        continue
                    name = basename(install['file'])
                    path = (uw_dir / name).resolve()
                    if not path.is_relative_to(uw_dir):
                        raise ValueError('sample path escapes the sample directory')
                    if not path.is_file():
                        continue
                    raw = path.read_bytes()
                    measured = inspect(raw)
                    if measured['name'] != need['name']:
                        raise ValueError(f'{name}: sample name {measured["name"]} differs from the model need {need["name"]}')
                    assets.append({'file': name, 'name': measured['name'], 'module': model['module'],
                                   'firmware_commit': source, 'sha256': measured['sha256'],
                                   'bytes': measured['bytes'], 'displayed_slot': measured['displayed_slot']})
                    routes['/uw-data/' + name] = raw
    return {'packs': names}, {'format': 'md-uw-downloads/1', 'assets': assets}, routes
