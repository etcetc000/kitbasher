"""Probe metal model changes with the existing WMD multi-seed mel scorer.

This is a C++ model experiment, not multi-seed qualification of native DSP code.
Paired native mel-proxy reports remain required. No acceptance cutoff is inferred.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np

from compare_variants import digest
from generate_metal import build_reference
from mds_build import ROOT
from render_bd import run


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--scorer',type=Path,required=True,help='Existing external tools/wmd_stats.py')
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--seeds',type=int,default=8,help='Seeds per ensemble; the original uses two disjoint groups')
    p.add_argument('--compiler',default='clang++')
    p.add_argument('--lcg-noise',action='store_true',help='Compare original/p3 xorshift with p3 LCG; also split the p3 baseline')
    a=p.parse_args(); out=a.out.resolve(); scorer=a.scorer.resolve()
    if out.exists() or a.seeds<2: p.error('Use a new output directory and at least two seeds')
    spec=importlib.util.spec_from_file_location('external_wmd_stats',scorer)
    metric=importlib.util.module_from_spec(spec); spec.loader.exec_module(metric)
    exe=build_reference(out,a.compiler)
    source=ROOT/'.audit-sources/Simple606/Source'
    inputs={str(path):digest(path) for path in (scorer,exe,Path(__file__),ROOT/'tests/metal_reference.cpp',
            source/'HiHats.hpp',source/'SynthDrumCommon.hpp',out/'cymbal_spec.hpp')}
    report=dict(scope='C++ model ensembles only; not native DSP seed coverage or listening acceptance',
                scorer='External wmd_stats ensemble mel distance; no new scoring algorithm',
                input_sha256=inputs,sample_rate=44100,common_output_gain=.5,
                raw_encoding='little-endian float32 C++ output before common gain',seeds_per_group=a.seeds,
                normalization=False,alignment=False,acceptance_threshold=None,cases=[])
    variants_to_render=[('original',47,False,False),('p3-static',3,True,False),
                        ('p3-lcg',3,True,True) if a.lcg_noise else ('p6-static',6,True,False)]
    for kind in ('ch','oh','cy'):
        controls=json.loads(run([exe,'--tables',kind]).stdout)
        for name,knobs in (('default',[102 if kind=='cy' else 89,64]),('maximum',[127,127])):
            samples=((controls['decay'][knobs[0]]['duration']+31)//32+32)*32
            if samples<max(metric.SIZES): raise ValueError('Ensemble scorer requires full FFT windows')
            seeds=[({'ch':0x606606,'oh':0x606607,'cy':0x606608}[kind]+i*0x9e3779b9)&0xffffffff for i in range(2*a.seeds)]
            audio={}; artifacts=[]
            for variant,count,no_wobble,lcg in variants_to_render:
                audio[variant]=[]
                split=variant=='original' or (a.lcg_noise and variant=='p3-static')
                for seed in seeds if split else seeds[:a.seeds]:
                    path=out/f'{kind}-{name}-{variant}-{seed:08x}.f32'
                    result=run([exe,kind,*knobs,samples,0,0,path,count,int(no_wobble),seed,*([1] if lcg else [])])
                    values=np.fromfile(path,dtype='<f4').astype(np.float64)*.5
                    if len(values)!=samples or not np.isfinite(values).all(): raise AssertionError('Incomplete/nonfinite model render')
                    audio[variant].append(values)
                    artifacts.append(dict(variant=variant,seed=seed,path=str(path),sha256=digest(path),state=result.stdout.strip()))
            first=audio['original'][:a.seeds]; second=audio['original'][a.seeds:]
            base=metric.ensemble(first,44100); other=metric.ensemble(second,44100)
            floor=metric.distance(base,other); base_env=metric.envelope_db(first,44100)
            variants={}
            for variant,_,_,_ in variants_to_render[1:]:
                values=audio[variant][:a.seeds]; loss=metric.distance(base,metric.ensemble(values,44100))
                variants[variant]=dict(loss=loss,loss_over_original_split=loss/floor if floor else None,
                    level_delta_db=metric.level_db(values)-metric.level_db(first),
                    body_envelope_error_db=metric.envelope_error(base_env,metric.envelope_db(values,44100)))
            row=dict(machine=kind,case=name,knobs=knobs,samples=samples,seeds=seeds,
                     original_split_loss=floor,variants=variants,artifacts=artifacts)
            if a.lcg_noise:
                p3=audio['p3-static'][:a.seeds]; lcg=audio['p3-lcg']
                p3_base=metric.ensemble(p3,44100)
                row['noise_change']=dict(
                    p3_split_loss=metric.distance(p3_base,metric.ensemble(audio['p3-static'][a.seeds:],44100)),
                    p3_to_lcg_loss=metric.distance(p3_base,metric.ensemble(lcg,44100)),
                    level_delta_db=metric.level_db(lcg)-metric.level_db(p3),
                    body_envelope_error_db=metric.envelope_error(metric.envelope_db(p3,44100),metric.envelope_db(lcg,44100)))
            report['cases'].append(row)
            (out/'report.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
            print(json.dumps({k:v for k,v in row.items() if k!='artifacts'}),flush=True)


if __name__=='__main__': main()
