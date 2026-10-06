"""Compile validated author MODE zones to the existing dynamic-label pack ABI."""
import base64


def dynamic_plans(panel):
    plans = []
    for mode in panel['modes']:
        zones = sorted(mode['zones'], key=lambda z: z['min'])
        mask = sorted({int(k) for z in zones for k in z['labels']})
        stop_of = [stop for stop, z in enumerate(zones) for _ in range(z['min'], z['max'] + 1)]
        blocks = b''.join(z['labels'].get(str(k), panel['knobs'][k]['label']).ljust(4).encode('ascii')
                          for z in zones for k in mask)
        formula = next(([a, n, b] for n in range(1, 256) for a in range(8) for b in range(16)
                        if all(((r >> a) * n) >> b == stop_of[r] for r in range(128))), None)
        plans.append(dict(knob=mode['knob'], mask=mask, stop_of=stop_of, formula=formula,
                          stops=len(zones), blocks=base64.b64encode(blocks).decode()))
    return plans
