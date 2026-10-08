"""Export a model source directory as an md-pack/1 model pack.

Input: model.json, dsp2.asm, optional tables.asm and dsp1-drive.asm. Output: <out>/model.json.
The assembler executable is built separately from packs/asm56.cpp (packs/build_assembler.py).

    python packs/assembly_export.py examples/scaffold --out ~/Documents/kitbasher-packs/scaffold [--assembler PATH]
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import re
import base64
import assembly as A
import pack_format as E
from model_manifest import validate
from model_panel import dynamic_plans

PI_BASE=0x135600  # reference only; the linker supplies the discovered track-slice region

def relocate(text, org, symbols, entry_names, assembler=None):
    ref,labels=A.assemble(text,org,symbols,exe=assembler)
    relocs=[]; refs={'@org':org,**symbols}
    for sym in refs:
        to=refs|{sym:refs[sym]+E.SHIFT}
        moved,_=A.assemble(text,to['@org'],{s:v for s,v in to.items() if s!='@org'},exe=assembler)
        if len(moved)!=len(ref): raise ValueError('placement changes instruction sizes: '+sym)
        for i,(a,b) in enumerate(zip(ref,moved)):
            delta=(b-a+0x800000)%0x1000000-0x800000
            if delta:
                if delta%E.SHIFT or not 0<abs(delta//E.SHIFT)<=4: raise ValueError('nonlinear relocation '+sym)
                relocs.append((i,sym,delta//E.SHIFT))
    rng=random.Random(8432)
    for _ in range(8):
        placed={s:v+rng.randrange(0x100,0x2000) for s,v in refs.items()}
        fresh,_=A.assemble(text,placed['@org'],{s:v for s,v in placed.items() if s!='@org'},exe=assembler)
        if E.link(ref,relocs,refs,placed)!=fresh: raise ValueError('fresh-assembly relocation mismatch')
    entry={n:labels[n]-org for n in entry_names}
    if any(not 0<=v<len(ref) for v in entry.values()): raise ValueError('entry outside code')
    return dict(words=E.b64words(ref),org=org,entry=entry,relocs=sorted(relocs),symbols=symbols)

def export(directory, destination, assembler=None):
    directory=Path(directory).resolve(); destination=Path(destination).resolve()
    m=validate(json.loads((directory/'model.json').read_text()))
    if m['injection']!={'mode':'add'}: raise ValueError('assembly add-ons use automatic IDs; replacements are not implemented')
    if m['samples'] or set(m['components'])-{'dsp2','dsp1_drive'}:
        raise ValueError('sample and ColdFire components are not implemented by this exporter')
    c=m['components']['dsp2']
    if set(c)-{'source','tables','abi'} or c['abi']!='md-voice/1' or 'source' not in c:
        raise ValueError('assembly source and md-voice/1 are required')
    v=[x for x in m['memory'] if x['kind']=='voice']; pi=[x for x in m['memory'] if x['kind']=='pi']
    private=[x for x in m['memory'] if x['kind']=='private']
    expected=dict(kind='voice',space='XY',words=64,alignment=64,lifetime='track-assignment',init='model',release='successor-init')
    if v!=[expected] or len(m['memory'])!=1+len(pi)+len(private) or (pi and private): raise ValueError('unsupported voice/workspace allocation')
    if pi and (pi[0]['init'] not in ('chunked','chunked-muted') or
               pi[0]!=dict(kind='pi',space='XY',words=1536,alignment=512,lifetime='track-assignment',init=pi[0]['init'],release='plain-audio')):
        raise ValueError('prototype P-I contract needs 1536-word chunk-cleared plain audio')
    if private:
        p=private[0]
        if (p['space'] not in ('X','Y','XY') or not 1<=p['words']<=2048 or p['alignment']>2048 or
            p!=dict(kind='private',space=p['space'],words=p['words'],alignment=p['alignment'],
                    lifetime='track-assignment',init='model',release='successor-init')):
            raise ValueError('private scratch needs at most 2048 words, model init and successor-init release')
    files={c['source']:A.read_source(directory,c['source'])}
    tables={}
    if c.get('tables'):
        files[c['tables']]=A.read_source(directory,c['tables']); tables=A.tables(files[c['tables']])
    syms={n:E.REF_TAB+i*E.TAB_STRIDE for i,n in enumerate(tables)}
    for n,v in {'md_sine':0x148000,'md_output':0x140,'md_voice':0x141,'md_track':0x142}.items():
        if n in syms: raise ValueError('table shadows ABI symbol '+n)
        if re.search(r'\b'+n+r'\b',files[c['source']]): syms[n]=v
    if pi:
        if 'pi_ws' in syms: raise ValueError('table shadows pi_ws service')
        syms['pi_ws']=PI_BASE
    if private:
        for n,v in {'ws':0x12d000,'ws_slice':2048}.items():
            if n in syms:raise ValueError('table shadows scratch service '+n)
            syms[n]=v
    code=relocate(files[c['source']],E.REF_ORG,syms,('init','trigger','render'),assembler)
    laws=[]; law=None
    if 'dsp1_drive' in m['components']:
        d=m['components']['dsp1_drive']; law=d['law']
        if set(d)!={'source','law','abi'}: raise ValueError('drive must be assembly source')
        files[d['source']]=A.read_source(directory,d['source'])
        dc=relocate(files[d['source']],0x1000,{},('drive',),assembler)
        laws=[dict(name=law,rank=100,emit=100,requires=[],words=dc['words'],org=dc['org'],entry=dc['entry']['drive'],relocs=dc['relocs'],records=[])]
    source_hash=hashlib.sha256(json.dumps(m,sort_keys=True).encode()+b''.join(n.encode()+s.encode() for n,s in sorted(files.items()))).hexdigest()
    panel=m['panel']
    pack=dict(format=E.FORMAT,family=panel['category'],order=1,
        source=dict(kind='assembly-directory',sha256=source_hash),shared=[],dsp1_laws=laws,models=[dict(
            key=m['key'],**({'aliases':m['aliases']} if m.get('aliases') else {}),module=m['key'],name=panel['name'],seq=0,id=0,contract=m,
            labels=[k['label'] for k in panel['knobs']],defaults=[k['default'] for k in panel['knobs']],
            workspace=bool(private),workspace_kind='private' if private else 'pi' if pi else None,wants_shared=[],uses_shared=[],dsp1_drive=law,
            dyn_labels=dynamic_plans(panel),**({'pitch':panel['pitch']} if 'pitch' in panel else {}),needs=[],tables=[dict(name=n,words=E.b64words(w)) for n,w in tables.items()],code=code)])
    destination.mkdir(parents=True,exist_ok=True); digest=E.write_pack(destination/'model.json',pack)
    result=dict(key=m['key'],source_sha256=source_hash,pack_sha256=digest,code_words=len(base64.b64decode(code['words']))//3,
                table_words=sum(map(len,tables.values())),relocations=len(code['relocs']),placements=8,drive=law)
    print(json.dumps(result),flush=True)
    return pack

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__); ap.add_argument('directory',type=Path); ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--assembler',type=Path,help='explicit instruction encoder executable')
    a=ap.parse_args(); export(a.directory,a.out,a.assembler)
