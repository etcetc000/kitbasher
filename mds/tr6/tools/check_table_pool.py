"""Verify every literal table in an assembled compact package against its baseline.

Checks all control entries, not just coefficients reached by audio fixtures.
Audio/state equivalence is checked separately with compare_variants.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

from mds_build import mds_format


def check(baseline, candidate, kind):
    old_source = (baseline / (kind + '.asm')).read_text()
    tables = {
        name: [int(word, 16) for word in re.findall(r'\$([0-9a-fA-F]{6})', body)]
        for name, body in re.findall(r'^(\w+):\n((?:[ \t]+\.dc[^\n]*\n)+)', old_source, re.M)
    }
    if not tables or any(not words for words in tables.values()):
        raise ValueError('Expected nonempty baseline literal tables')
    images = []
    labels = []
    hashes = {}
    for directory in (baseline, candidate):
        for name in (kind + '.asm', kind + '.mds', 'assembly.json'):
            path = directory / name
            hashes[str(path.resolve())] = hashlib.sha256(path.read_bytes()).hexdigest()
        images.append(mds_format().parse_package((directory / (kind + '.mds')).read_bytes()))
        labels.append(json.loads((directory / 'assembly.json').read_text())['labels'])
    for key in ('init_word', 'mutate_word', 'execute_word'):
        if images[0][key] != images[1][key]:
            raise AssertionError(f'Code entry moved: {key}')
    groups = {}
    for name, words in tables.items():
        expected = b''.join(word.to_bytes(3, 'big') for word in words)
        for image, symbols in zip(images, labels):
            offset = symbols[name]
            if image['program'][offset * 3:offset * 3 + len(expected)] != expected:
                raise AssertionError(f'Assembled table changed: {name}')
            if any(offset <= i < offset + len(words) for i in image['relocations']):
                raise AssertionError(f'Unexpected relocation in literal table: {name}')
            if any(offset <= i.patch_word < offset + len(words) for i in image['imports']):
                raise AssertionError(f'Unexpected import in literal table: {name}')
        groups.setdefault(tuple(words), []).append(name)
    expected_saving = sum((len(names) - 1) * len(words) for words, names in groups.items())
    actual_saving = (len(images[0]['program']) - len(images[1]['program'])) // 3
    if actual_saving != expected_saving:
        raise AssertionError('Program-size change differs from exact table savings')
    for names in groups.values():
        if len({labels[1][name] for name in names}) != 1:
            raise AssertionError(f'Identical tables were not pooled: {names}')
    cycles_equal = []
    for case in json.loads((candidate / 'comparison.json').read_text()):
        name = case['case']
        counts = [re.findall(r'instructions \d+ cycles (\d+)',
                            (directory / (name + '.host.log')).read_text())
                  for directory in (baseline, candidate)]
        if not counts[0] or counts[0] != counts[1]:
            raise AssertionError(f'Raw call cycle sequence changed: {name}')
        cycles_equal.append(name)
    return dict(machine=kind,table_count=len(tables),table_entries=sum(map(len,tables.values())),
                aliases=[names for names in groups.values() if len(names)>1],
                saved_program_words=actual_saving,raw_cycle_sequences_equal=cycles_equal,
                input_sha256=hashes,hardware_validated=False)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('kind', choices=('lt','ht','ch','oh','cy'))
    p.add_argument('baseline', type=Path)
    p.add_argument('candidate', type=Path)
    a = p.parse_args()
    result = check(a.baseline.resolve(), a.candidate.resolve(), a.kind)
    (a.candidate / 'table-pool-check.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    main()
