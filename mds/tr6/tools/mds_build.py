"""Assemble origin-zero MDS code with Kitbasher's encoder and verify relocation.

This writes DRAFT packages only. A cycle declaration must not be fabricated to
make an unfinished port installable.
"""
import argparse
import importlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(REPO / 'packs'))
import assembly


def mds_format():
    source = ROOT / '.audit-sources/MDS/tools'
    if not source.is_dir():
        raise RuntimeError('Run tools/bootstrap.py first')
    sys.path.insert(0, str(source))
    return importlib.import_module('lib.mds_format')


def assemble_package(source, manifest, assembler, imports=None, x_words=64, y_words=64):
    imports = imports or {}
    symbols = {name: 0 for name in imports}
    code, labels = assembly.assemble(source, 0, symbols, exe=assembler)
    relocated, _ = assembly.assemble(source, 0x100000, symbols, exe=assembler)
    if len(code) != len(relocated):
        raise ValueError('Program placement changes instruction sizes')
    relocation = []
    for i, (before, after) in enumerate(zip(code, relocated)):
        if before != after:
            if after - before != 0x100000:
                raise ValueError(f'Non-MDS relocation at word {i}')
            relocation.append(i)
    records = []
    for name, (kind, symbol) in imports.items():
        placed, _ = assembly.assemble(source, 0, symbols | {name: 0x8000}, exe=assembler)
        if len(placed) != len(code):
            raise ValueError('Import placement changes instruction sizes')
        for i, (before, after) in enumerate(zip(code, placed)):
            if before != after:
                if after - before != 0x8000:
                    raise ValueError(f'Non-MDS import patch at word {i}')
                records.append(dict(patch_word=i, kind=kind, symbol=symbol))
    # Different, unaligned placements catch encoded-address truncation and any
    # overlap between local-label and resource patches.
    for base, resource in ((0x110023, 0x148000), (0x140001, 0x150000)):
        fresh, _ = assembly.assemble(source, base, {name: resource for name in imports}, exe=assembler)
        linked = list(code)
        for i in relocation:
            linked[i] += base
        for record in records:
            linked[record['patch_word']] += resource
        if linked != fresh:
            raise ValueError('Relocation disagrees with independent reassembly')
    fmt = mds_format()
    link = dict(init_word=labels['init'], mutate_word=labels['trigger'],
                execute_word=labels['render'], x_workset_words=x_words,
                y_workset_words=y_words, relocations=relocation,
                imports=sorted(records, key=lambda row: row['patch_word']))
    program = b''.join(word.to_bytes(3, 'big') for word in code)
    package = fmt.build_package(fmt.package_parts(program, manifest | {'max_track_cycles': 0}, link))
    parsed = fmt.parse_package(package)
    # Exercise the actual upstream export gate without writing any SysEx.
    try:
        importlib.import_module('mds_to_syx').convert(package)
    except ValueError as error:
        if str(error) != 'draft package: no installable cycle budget':
            raise
    else:
        raise AssertionError('An unqualified draft became installable')
    return package, dict(program_words=len(code), labels=labels, relocations=relocation,
                         imports=records, max_track_cycles=parsed['max_track_cycles'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--assembler', default=os.environ.get('MD_ASSEMBLER'), required=not os.environ.get('MD_ASSEMBLER'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--track-memory', action='store_true',
                        help='Resolve mds_track as MDS track external memory (symbol 6)')
    parser.add_argument('--scratch-x', action='store_true',
                        help='Resolve mds_scratch_x as MDS shared X scratch (symbol 7)')
    args = parser.parse_args()
    document = json.loads(args.manifest.read_text())
    imports = {'mds_sine': (1, 1)}
    if args.track_memory:
        imports['mds_track'] = (2, 6)
    if args.scratch_x:
        imports['mds_scratch_x'] = (3, 7)
    package, report = assemble_package(args.source.read_text(), document, args.assembler, imports=imports)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / (args.source.stem + '.mds')).write_bytes(package)
    (args.out / 'assembly.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report | {'labels': '<see assembly.json>'}))


if __name__ == '__main__':
    main()
