"""Report aggregate prototype resources against published MDS v1 field widths.

No device query is made. Fitting a 16-bit field is not proof of device capacity.
"""
import argparse
import json
from pathlib import Path

from mds_build import ROOT,mds_format


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build-root',type=Path,default=ROOT/'build')
    p.add_argument('--out',type=Path,default=ROOT/'build/family-resources.json')
    a=p.parse_args(); fmt=mds_format(); rows=[]
    for name in ('bd','sd','lt','ht','ch','oh','cy','cp'):
        path=a.build_root/f'{name}-comparison/{name}.mds'
        data=path.read_bytes(); image=fmt.parse_package(data)
        rows.append(dict(machine=name,program_words=len(image['program'])//3,
                         package_bytes=len(data),declared_cycles=image['max_track_cycles']))
    groups={}
    for name,voices in (('tr6',rows[:-1]),('tr6_with_cp',rows)):
        words=sum(r['program_words'] for r in voices); size=sum(r['package_bytes'] for r in voices)
        groups[name]=dict(slots=len(voices),program_words=words,package_bytes=size,
                          within_16_slots=len(voices)<=16,
                          within_u16_shared_program_field=words<=65535,
                          within_u16_library_byte_field=size<=65535)
    result=dict(machines=rows,groups=groups,actual_device_capacity_queried=False,
                all_packages_draft=all(r['declared_cycles']==0 for r in rows),installation_qualified=False,
                limits='Published MDS v1 capability fields use two unpacked bytes for each shared capacity. Actual capacity may be lower.')
    a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__': main()
