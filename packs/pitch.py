"""Pitch metadata for model packs: the Python twin of engine/src/pitch.ts.

The shared law for absolute-pitch models is quarter: raw = 2 (MIDI - 24), so raw 0 = MIDI 24
(32.70 Hz) and raw 127 = MIDI 87.5. MIDI 60 is named C3 (the Machinedrum's MIDI machine).
"""
import math

LAWS = ('quarter', 'chromatic', 'continuous', 'relative', 'none')
CAPTIONS = ('PTCH', 'NOTE', 'OSC1')
NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')


def midi_hz(note):
    return 440.0 * 2.0 ** ((note - 69.0) / 12.0)


def hz_midi(hz):
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def note_name(note):
    n = math.floor(note + 1e-9)
    return f'{NAMES[n % 12]}{n // 12 - 2}{"+" if note - n > 0.25 else ""}'


def resolve(p, zone=None):
    out = {k: v for k, v in p.items() if k != 'by_mode'}
    for row in p.get('by_mode', []) if zone is not None else []:
        if row['zone'] == zone:
            out.update({k: v for k, v in row.items() if k != 'zone'})
    return out


def raw_to_note(raw, pitch, zone=None):
    p = resolve(pitch, zone)
    lo, hi = p.get('range', [0, 127])
    r = min(max(raw, lo), hi)
    if p['law'] in ('quarter', 'chromatic'):
        return p['base_note'] + r / p['steps']
    if p['law'] == 'relative':
        return (r - p['center']) / p['steps']
    if p['law'] == 'continuous' and 'cents_per_step' in p and 'base_note' in p:
        return p['base_note'] + r * p['cents_per_step'] / 100.0
    return None


def note_to_raw(note, pitch, zone=None):
    """(raw, clamped, note actually played)."""
    p = resolve(pitch, zone)
    lo, hi = p.get('range', [0, 127])
    if p['law'] in ('quarter', 'chromatic'):
        x = (note - p['base_note']) * p['steps']
    elif p['law'] == 'relative':
        x = p['center'] + note * p['steps']
    elif p['law'] == 'continuous' and 'cents_per_step' in p and 'base_note' in p:
        x = (note - p['base_note']) * 100.0 / p['cents_per_step']
    else:
        raise ValueError(f'pitch law {p["law"]} has no note mapping')
    r = math.floor(x + 0.5)
    raw = min(max(r, lo), hi)
    return raw, raw != r, raw_to_note(raw, pitch, zone)


def check_pitch(p, panel):
    """Semantic checks the JSON schema cannot express (engine/src/pitch.ts checkPitch)."""
    pitched = ('quarter', 'chromatic', 'relative')
    knob = p['knob']
    if knob is None and p['law'] != 'none':
        raise ValueError('pitch: only law none may name no knob')

    def row(r):
        law = r.get('law', p['law'])
        steps = r.get('steps', p.get('steps'))
        if law == 'quarter' and steps != 2 or law == 'chromatic' and steps != 1:
            raise ValueError(f'pitch: {law} with steps {steps}')
        if law in ('quarter', 'chromatic') and 'base_note' not in r and 'base_note' not in p:
            raise ValueError(f'pitch: {law} needs base_note')
        if law == 'relative' and 'center' not in r and 'center' not in p:
            raise ValueError('pitch: relative needs center')
        rg = r.get('range')
        if rg is not None and not rg[0] < rg[1]:
            raise ValueError('pitch: inverted range')
    row(p)
    if knob is not None and p['law'] in pitched and panel['knobs'][knob]['label'] not in CAPTIONS:
        raise ValueError(f'pitch: knob {knob} is not a pitch caption')
    if 'by_mode' in p or 'mode_knob' in p:
        mode = next((m for m in panel['modes'] if m['knob'] == p.get('mode_knob')), None)
        if mode is None or 'by_mode' not in p:
            raise ValueError('pitch: by_mode needs mode_knob naming a MODE selector')
        zones = sorted(mode['zones'], key=lambda z: z['min'])
        seen = set()
        for r in p['by_mode']:
            if r['zone'] >= len(zones) or r['zone'] in seen:
                raise ValueError('pitch: by_mode zone')
            seen.add(r['zone'])
            row(r)
        for i, z in enumerate(zones):
            cap = z['labels'].get(str(knob))
            if knob is not None and cap is not None and cap not in CAPTIONS and resolve(p, i)['law'] in pitched:
                raise ValueError(f'pitch: zone {i} relabels the pitch knob {cap} but keeps a note law')
    elif knob is not None and p['law'] in pitched:
        for mode in panel['modes']:
            for i, z in enumerate(sorted(mode['zones'], key=lambda z: z['min'])):
                cap = z['labels'].get(str(knob))
                if cap is not None and cap not in CAPTIONS:
                    raise ValueError(f'pitch: zone {i} relabels the pitch knob {cap} without a by_mode row')
