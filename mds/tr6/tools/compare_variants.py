"""Compare complete native render directories and generate a local A/B page.

Uses matching comparison.json cases, raw Q23 output and 24-bit WAVs. The page
references local WAV files; it does not upload audio or claim listening equality.
"""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path
import struct


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(baseline,candidate,extras=()):
    before={}
    for directory in (baseline,*extras):
        for r in json.loads((directory/'comparison.json').read_text()):
            if r['case'] in before: raise ValueError(f'Duplicate baseline case: {r["case"]}')
            before[r['case']]=(r,directory)
    after={r['case']:r for r in json.loads((candidate/'comparison.json').read_text())}
    rows=[]
    for name,c in after.items():
        if name not in before: raise ValueError(f'No baseline for {name}')
        b,directory=before[name]
        for key in ('knobs','samples'):
            if b[key]!=c[key]: raise ValueError(f'{name}: {key} differs')
        gain=c.get('output_gain',1)
        if gain!=b.get('output_gain',1): raise ValueError('Output gains differ')
        # Match the actual desktop stream, not just the knob labels. This also
        # catches changed seeds, retrigger schedules, source versions or delays.
        if (directory/f'{name}.reference.raw').read_bytes()!=(candidate/f'{name}.reference.raw').read_bytes():
            raise ValueError(f'{name}: desktop reference streams differ')
        bp=directory/f'{name}.raw'; cp=candidate/f'{name}.raw'
        for path in (directory/f'{name}.wav',candidate/f'{name}.wav'):
            if not path.is_file(): raise ValueError(f'Missing audition WAV: {path}')
        bd=bp.read_bytes(); cd=cp.read_bytes()
        if len(bd)!=len(cd) or len(bd)!=c['samples']*4: raise ValueError('Incomplete render')
        x=struct.unpack('<'+'i'*c['samples'],bd); y=struct.unpack('<'+'i'*c['samples'],cd)
        errors=[(v-u)/(8388608*gain) for u,v in zip(x,y)]
        mse=sum(e*e for e in errors)/len(errors)
        energy=sum((u/(8388608*gain))**2 for u in x)/len(x)
        rows.append(dict(case=name,baseline_directory=str(directory),samples=c['samples'],knobs=c['knobs'],output_gain=gain,
                         pretrim_peak_delta=max(abs(e) for e in errors),pretrim_rms_delta=math.sqrt(mse),
                         delta_snr_db=10*math.log10(energy/max(mse,1e-30)),
                         baseline_sha256=digest(bp),candidate_sha256=digest(cp),
                         candidate_vs_source_pass=c['numeric_pass'],
                         baseline_raw_max_call=b['host_cycle_table_max_call'],candidate_raw_max_call=c['host_cycle_table_max_call']))
    return rows


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline',type=Path); p.add_argument('candidate',type=Path)
    p.add_argument('--baseline-extra',type=Path,action='append',default=[],help='Additional disjoint baseline cases, e.g. block-boundary renders')
    a=p.parse_args(); baseline=a.baseline.resolve(); candidate=a.candidate.resolve()
    rows=compare(baseline,candidate,[path.resolve() for path in a.baseline_extra])
    if not rows: raise ValueError('No candidate cases')
    result=dict(baseline=str(baseline),candidate=str(candidate),rows=rows,
                listening_reviewed=False,cold_cache_measured=False)
    (candidate/'baseline-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    import os
    def link(path):
        return html.escape(os.path.relpath(path,candidate).replace('\\','/'),quote=True)
    page=['<!doctype html><meta charset="utf-8"><title>TR6 baseline / candidate</title>',
          '<style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px}section{border-top:1px solid #bbb;padding:16px 0}audio{display:block;width:100%;margin:8px 0}small{color:#555}</style>',
          '<h1>TR6 baseline / candidate</h1>',
          '<p>Both renders use the same controls, trigger schedule and output gain. Listening review is still required. These local files are not uploaded.</p>']
    for r in rows:
        name=r['case']; page += [f'<section><h2>{html.escape(name)}</h2>',
            f'<small>Knobs: {r["knobs"]}; peak difference before output trim: {r["pretrim_peak_delta"]:.8f}</small>',
            f'<p>Full-path native baseline</p><audio controls preload="none" src="{link(Path(r["baseline_directory"])/(name+".wav"))}"></audio>',
            f'<p>Candidate</p><audio controls preload="none" src="{link(candidate/(name+".wav"))}"></audio></section>']
    (candidate/'compare.html').write_text('\n'.join(page)+'\n',encoding='utf-8')
    print(json.dumps(dict(cases=len(rows),worst_pretrim_peak_delta=max(r['pretrim_peak_delta'] for r in rows),
                         report=str(candidate/'baseline-comparison.json'),audition=str(candidate/'compare.html'))))


if __name__=='__main__': main()
