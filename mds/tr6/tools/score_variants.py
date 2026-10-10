"""Validate TR6 render pairs, then invoke the existing optimization-lab scorer.

No scoring algorithm is copied here. Retained renders are hashed at scoring
time. Execution-time provenance is verified and forwarded when available;
missing historical tool identities are not retrospectively reconstructed.
"""
import argparse
import json
from pathlib import Path
import shutil
import sys

from compare_variants import compare,digest
from render_bd import run


def provenance(directory,name):
    paths={directory/'comparison.json',directory/'assembly.json',
           directory/f'{name}.script',directory/f'{name}.host.log',directory/f'{name}.raw',
           directory/f'{name}.reference.raw'}
    for pattern in ('*.asm','*.mds','*.bin','controls.json','provenance.json'):
        paths.update(directory.glob(pattern))
    return {str(path):digest(path) for path in sorted(paths) if path.is_file()}


def render_metadata(directory,name):
    path=directory/'provenance.json'
    if not path.is_file(): return None
    document=json.loads(path.read_text())
    if not document.get('complete') or not document.get('captured_before_render'):
        raise ValueError('Incomplete execution-time render provenance')
    cases=[row for row in document['cases'] if row['name']==name]
    if len(cases)!=1: raise ValueError('Render provenance does not uniquely cover case')
    case=cases[0]
    if str((directory/f'{name}.raw').resolve()) not in case['output_sha256']:
        raise ValueError('Native audio absent from execution-time provenance')
    for filename,expected in case['output_sha256'].items():
        if digest(Path(filename))!=expected: raise ValueError('Recorded render output changed before scoring')
    for filename,expected in document['inputs_sha256'].items():
        # Local assembly/images/coefficients must still describe these renders.
        # External source/tool hashes are historical identities, not a demand
        # that the current external checkout has never changed since rendering.
        if Path(filename).is_relative_to(directory) and digest(Path(filename))!=expected:
            raise ValueError('Recorded local render input changed before scoring')
    return dict(path=str(path),sha256=digest(path),inputs_sha256=document['inputs_sha256'],case=case)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline',type=Path); p.add_argument('candidate',type=Path)
    p.add_argument('--baseline-extra',type=Path,action='append',default=[])
    p.add_argument('--allow-model-change',action='store_true')
    p.add_argument('--lab',type=Path,required=True,help='External optimization-lab with score_audio.py and perceptual.py')
    p.add_argument('--out',type=Path,required=True,help='New run directory; never overwrite prior scores')
    a=p.parse_args(); baseline=a.baseline.resolve(); candidate=a.candidate.resolve()
    extras=[path.resolve() for path in a.baseline_extra]; lab=a.lab.resolve(); out=a.out.resolve()
    if out.exists(): p.error('Use a new output directory')
    for name in ('score_audio.py','perceptual.py'):
        if not (lab/name).is_file(): p.error(f'Missing external lab tool: {name}')
    rows=compare(baseline,candidate,extras,a.allow_model_change)
    before=[r['case'] for directory in (baseline,*extras) for r in json.loads((directory/'comparison.json').read_text())]
    after=json.loads((candidate/'comparison.json').read_text())
    if not rows or len(rows)!=len(after) or set(before)!={r['case'] for r in rows}:
        raise ValueError('Scoring requires complete, unique case coverage on both sides')
    # Only native Q23 streams enter the scorer. The .reference.raw siblings
    # are float32 desktop data and must never match the scorer's *.raw glob.
    refs=out/'inputs/reference'; news=out/'inputs/candidate'
    refs.mkdir(parents=True); news.mkdir(parents=True)
    cases=[]; hashes={}
    for row in rows:
        name=row['case']
        if Path(name).name!=name or '/' in name or '\\' in name:
            raise ValueError('Case names must be plain file stems')
        directory=Path(row['baseline_directory'])
        for source,dest,expected in ((directory/f'{name}.raw',refs/f'{name}.raw',row['baseline_sha256']),
                                     (candidate/f'{name}.raw',news/f'{name}.raw',row['candidate_sha256'])):
            shutil.copyfile(source,dest)
            if digest(dest)!=expected: raise ValueError('Render changed while staging scoring inputs')
        hashes.update(provenance(directory,name)); hashes.update(provenance(candidate,name))
        cases.append(dict(name=name,baseline_execution_provenance=render_metadata(directory,name),
                          candidate_execution_provenance=render_metadata(candidate,name),
                          **{k:v for k,v in row.items() if k!='case'}))
    report=dict(scope='Retained native full-path baseline versus native candidate',
                provenance_captured_at='scoring time; original render tool identity is not independently reconstructed',
                original_render_tool_attestation=False,input_sha256=hashes,
                execution_time_provenance=dict(baseline=all(r['baseline_execution_provenance'] is not None for r in cases),
                                               candidate=all(r['candidate_execution_provenance'] is not None for r in cases)),
                adapter_sha256=digest(Path(__file__)),model_change_allowed=a.allow_model_change,
                sample_rate=44100,raw_encoding='signed little-endian int32 Q23 mono',
                timing='Raw host call maxima in cases; not calibrated cold-cache cost',cases=cases)
    report_path=out/'render-report.json'; report_path.write_text(json.dumps(report,indent=2)+'\n')
    result=run([sys.executable,'-B',lab/'score_audio.py',refs,news,'--sample-rate',44100,
                '--render-report',report_path,'--out',out/'scores'],timeout=600)
    (out/'score.log').write_text(result.stdout+result.stderr)
    scores=json.loads((out/'scores/scores.json').read_text())
    for row in scores['cases']:
        expected=next(case for case in cases if case['name']==Path(row['case']).stem)
        if row['reference_sha256']!=expected['baseline_sha256'] or row['candidate_sha256']!=expected['candidate_sha256']:
            raise AssertionError('Scorer inputs differ from verified native pairs')
    print(json.dumps(dict(run=str(out),metric=scores['metric'],**scores['summary']),indent=2))


if __name__=='__main__': main()
