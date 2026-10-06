"""Export every model in examples/community, examples/analog and examples/physical with the native assembler.

Each directory listed in examples/<collection>/catalog.json is exported (the exporter checks
eight relocation placements per code block), and the resulting pack must hold exactly the listed
model. The packs and a result.json with each pack's sha256 are written below --out.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packs'))
from assembly_export import export

COLLECTIONS = ('community', 'analog', 'physical')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--assembler', type=Path, required=True)
    parser.add_argument('--collection', choices=COLLECTIONS, help='check one collection; default is all of them')
    args = parser.parse_args()
    results = []
    catalogs = [(name, json.loads((ROOT / 'examples' / name / 'catalog.json').read_text(encoding='utf-8')))
                for name in ([args.collection] if args.collection else COLLECTIONS)]
    for collection, model in [(name, model) for name, catalog in catalogs for model in catalog['models']]:
        name = model['directory']
        if Path(name).name != name or name in ('.', '..'):
            raise ValueError('invalid model directory')
        destination = args.out / collection / name
        pack = export(ROOT / 'examples' / collection / name, destination, args.assembler)
        if [m['key'] for m in pack['models']] != [model['key']]:
            raise ValueError(f'{collection}/{name}: unexpected model identity')
        digest = hashlib.sha256((destination / 'model.json').read_bytes()).hexdigest()
        results.append({'key': model['key'], 'pack': str(destination / 'model.json'), 'sha256': digest, 'status': 'PASS'})
    report = {'status': 'PASS', 'models': results,
              'coverage': 'Native assembly export with eight relocation placements per code block.',
              'limits': 'Does not check hardware timing or the sound of a particular kit.'}
    (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
