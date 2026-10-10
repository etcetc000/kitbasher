"""Compare attested native seed ensembles with the existing external WMD scorer."""
import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np

from compare_variants import digest, trigger_schedule
from score_variants import render_metadata


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reference',type=Path,nargs='+',required=True)
    p.add_argument('--split',type=Path,nargs='+',required=True)
    p.add_argument('--candidate',type=Path,nargs='+',required=True)
    p.add_argument('--case',required=True)
    p.add_argument('--scorer',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if a.out.exists(): p.error('Use a fresh output directory')
    if len(a.reference)<2 or len(a.reference)!=len(a.split) or len(a.reference)!=len(a.candidate):
        p.error('Use equal groups of at least two seeds')
    scorer_hash=digest(a.scorer); adapter_hash=digest(Path(__file__))
    spec=importlib.util.spec_from_file_location('external_wmd_stats',a.scorer.resolve())
    metric=importlib.util.module_from_spec(spec); spec.loader.exec_module(metric)
    audio={}; artifacts={}; models={}; seeds={}; effective_seeds={}; fixture=None
    for group,paths in (('reference',a.reference),('split',a.split),('candidate',a.candidate)):
        audio[group]=[]; artifacts[group]=[]; seeds[group]=[]; effective_seeds[group]=[]
        for path in paths:
            path=path.resolve(); rows=json.loads((path/'comparison.json').read_text())
            selected=[row for row in rows if row['case']==a.case]
            if len(selected)!=1: raise ValueError('Case must have unique comparison coverage')
            row=selected[0]
            if not row['numeric_pass'] or not all(row['checks'].values()): raise ValueError('Unqualified numerical render')
            provenance=render_metadata(path,a.case)
            if provenance is None: raise ValueError('Execution-time provenance is required')
            model=dict(row['reference_model']); seed=model.pop('seed',None)
            if seed is None: raise ValueError('Ensembles require explicit seeds')
            seeds[group].append(seed or 0x606606)
            # The BD LCG has fixed oscillator phase and ignores seed bits 24..31.
            # Metal models also seed their phase RNG, so those high bits matter.
            effective=seed or 0x606606
            if row['machine']=='bd' and model.get('noise')=='lcg24': effective &= 0xffffff
            effective_seeds[group].append(effective)
            if group in models and models[group]!=model: raise ValueError('Mixed models within an ensemble')
            models[group]=model
            properties=(row['machine'],row['knobs'],row['samples'],row['output_gain'],trigger_schedule(path,a.case))
            if fixture is None: fixture=properties
            elif fixture!=properties: raise ValueError('Unmatched controls, gain, duration or triggers')
            raw=path/(a.case+'.raw'); values=np.fromfile(raw,dtype='<i4').astype(np.float64)/8388608
            if len(values)!=row['samples'] or len(values)<max(metric.SIZES): raise ValueError('Incomplete or too-short audio')
            if not np.isfinite(values).all() or np.max(values)>=1 or np.min(values)<-1: raise ValueError('Invalid Q23 audio')
            audio[group].append(values)
            artifacts[group].append(dict(directory=str(path),raw_sha256=digest(raw),comparison_sha256=digest(path/'comparison.json'),
                                         seed=seed,execution_provenance=provenance))
        if len(set(effective_seeds[group]))!=len(effective_seeds[group]): raise ValueError('Repeated effective seeds within group')
    if models['reference']!=models['split']: raise ValueError('Reference split must use the same model')
    if set(effective_seeds['reference']) & set(effective_seeds['split']): raise ValueError('Reference seed groups must be disjoint')
    if set(seeds['reference'])!=set(seeds['candidate']): raise ValueError('Candidate must use the reference seeds')
    ref=metric.ensemble(audio['reference'],44100)
    floor=metric.distance(ref,metric.ensemble(audio['split'],44100))
    loss=metric.distance(ref,metric.ensemble(audio['candidate'],44100))
    if digest(a.scorer)!=scorer_hash or digest(Path(__file__))!=adapter_hash:
        raise ValueError('Scoring tool changed during execution')
    report=dict(scope='Native DSP seed ensembles; not an audibility threshold or exhaustive seed qualification',
                scorer_sha256=scorer_hash,adapter_sha256=adapter_hash,sample_rate=44100,
                raw_encoding='signed little-endian int32 Q23, actual output gain retained',normalization=False,alignment=False,
                case=a.case,machine=fixture[0],knobs=fixture[1],samples=fixture[2],seeds=seeds,effective_seeds=effective_seeds,models=models,
                reference_split_loss=floor,candidate_loss=loss,loss_over_split=loss/floor if floor else None,
                level_delta_db=metric.level_db(audio['candidate'])-metric.level_db(audio['reference']),
                body_envelope_error_db=metric.envelope_error(metric.envelope_db(audio['reference'],44100),metric.envelope_db(audio['candidate'],44100)),
                artifacts=artifacts)
    a.out.mkdir(parents=True)
    (a.out/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('artifacts','models','seeds')},indent=2))


if __name__=='__main__': main()
