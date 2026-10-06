"""Validate portable source contracts without importing model implementations."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'build/manifest-deps'))
from jsonschema import Draft202012Validator

def validate(m):
    schema = json.loads((ROOT / 'docs/model-manifest.schema.json').read_text())
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(m)
    owned = set()
    mode_knobs = set()
    for mode in m['panel']['modes']:
        if mode['knob'] in mode_knobs:
            raise ValueError('duplicate mode knob')
        mode_knobs.add(mode['knob'])
        coverage, targets = [], set()
        for zone in mode['zones']:
            if zone['max'] < zone['min']:
                raise ValueError('inverted MODE zone')
            coverage.extend(range(zone['min'], zone['max'] + 1))
            targets.update(zone['labels'])
        if sorted(coverage) != list(range(128)):
            raise ValueError('MODE zones must cover 0..127 exactly once')
        if owned & targets:
            raise ValueError('two mode knobs cannot write the same caption')
        owned.update(targets)
    kinds = set()
    for mem in m['memory']:
        if mem['kind'] in kinds:
            raise ValueError('duplicate memory kind')
        kinds.add(mem['kind'])
        a = mem['alignment']
        if a & (a - 1):
            raise ValueError('memory alignment must be a power of two')
        clean = mem['release'] == 'clean-before-stock-pi'
        if clean != ('dirty_span' in mem) or (clean and mem['kind'] != 'pi'):
            raise ValueError('PI cleanup requires a PI dirty_span, and only that policy accepts one')
        span = mem.get('dirty_span')
        if span and span['offset'] + span['words'] > mem['words']:
            raise ValueError('cleanup extends outside owned words')
    return m
