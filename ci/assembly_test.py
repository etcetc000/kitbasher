"""Assembly importer regressions: source-only inputs and relocation behavior."""
import sys
from pathlib import Path
import unittest
import tempfile
import json
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packs'))
import assembly as A
from assembly_export import relocate
import assembly_export as exporter

class Assembly(unittest.TestCase):
    def test_owned_scratch_exports_symbolically_and_refuses_false_ownership(self):
        m=json.loads((ROOT/'examples/contracts/replacement.json').read_text())
        m.update(injection=dict(mode='add'),samples=[],
            components=dict(dsp2=dict(source='dsp2.asm',abi='md-voice/1')),
            memory=[dict(kind='voice',space='XY',words=64,alignment=64,lifetime='track-assignment',init='model',release='successor-init'),
                    dict(kind='private',space='X',words=153,alignment=128,lifetime='track-assignment',init='model',release='successor-init')])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'dsp2.asm').write_text('init: move y:>md_track,a\nasl #11,a,a\nadd #>ws,a\nmove a,r0\nclr a\nrep #153\nmove a,x:(r0)+\nrts\ntrigger: rts\nrender: rts\n')
            (root/'model.json').write_text(json.dumps(m))
            p=exporter.export(root,root/'out');model=p['models'][0]
            self.assertTrue(model['workspace']);self.assertEqual(model['workspace_kind'],'private')
            self.assertEqual(model['code']['symbols']['ws_slice'],2048)
            self.assertTrue(any(r[1]=='ws' for r in model['code']['relocs']))
            for field,value in [('words',2049),('alignment',4096),('init','chunked'),('release','plain-audio')]:
                old=m['memory'][1][field];m['memory'][1][field]=value
                (root/'model.json').write_text(json.dumps(m))
                with self.assertRaisesRegex(ValueError,'private scratch'):exporter.export(root,root/'bad')
                m['memory'][1][field]=old

    def test_current_voice_service_is_symbolic_and_relocatable(self):
        m=json.loads((ROOT/'examples/contracts/replacement.json').read_text())
        m.update(injection=dict(mode='add'), samples=[],
                 components=dict(dsp2=dict(source='dsp2.asm',abi='md-voice/1')),
                 memory=[dict(kind='voice',space='XY',words=64,alignment=64,
                              lifetime='track-assignment',init='model',release='successor-init')])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'model.json').write_text(json.dumps(m))
            (root/'dsp2.asm').write_text('init: rts\ntrigger: rts\nrender: move y:>md_voice,r6\nrts\n')
            p=exporter.export(root,root/'out')
            c=p['models'][0]['code']
            self.assertEqual(c['symbols']['md_voice'],0x141)
            self.assertEqual([r for r in c['relocs'] if r[1]=='md_voice'],[(3,'md_voice',1)])

    def test_muted_pi_contract_exports_and_rejects_unsupported_release(self):
        m=json.loads((ROOT/'examples/contracts/replacement.json').read_text())
        m.update(injection=dict(mode='add'),samples=[],
            components=dict(dsp2=dict(source='dsp2.asm',abi='md-voice/1')),
            memory=[dict(kind='voice',space='XY',words=64,alignment=64,lifetime='track-assignment',init='model',release='successor-init'),
                    dict(kind='pi',space='XY',words=1536,alignment=512,lifetime='track-assignment',init='chunked-muted',release='plain-audio')])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'dsp2.asm').write_text('init: rts\ntrigger: rts\nrender: rts\n')
            (root/'model.json').write_text(json.dumps(m))
            p=exporter.export(root,root/'out')
            self.assertEqual(p['models'][0]['workspace_kind'],'pi')
            m['memory'][1]['release']='successor-init'
            (root/'model.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'P-I contract'):
                exporter.export(root,root/'invalid')

    def test_bundled_ksstr_pack_matches_a_fresh_export(self):
        bundled=json.loads((ROOT/'catalog/physical-ks.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as tmp:
            fresh=exporter.export(ROOT/'examples/physical/ks',Path(tmp)/'out')
        fresh.pop('source')
        self.assertEqual(json.loads(json.dumps(fresh)),bundled)

    def test_bundled_ladder_pack_matches_a_fresh_export(self):
        bundled=json.loads((ROOT/'catalog/effects-ladder.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as tmp:
            fresh=exporter.export(ROOT/'examples/effects/ladder',Path(tmp)/'out')
        fresh.pop('source')
        self.assertEqual(json.loads(json.dumps(fresh)),bundled)

    def test_compact_x_slots_and_explicit_long_forms(self):
        w,_=A.assemble('move x0,x:(r6+$28)\nmove x:(r6+$28),a\nmove a0,y:(r6+$19)\nmove x0,x:(r6+>$28)\nmove y:(r0+>$22),r2',0x110000)
        self.assertEqual(w,[0x02a684,0x02a69e,0x0266e8,0x0a7684,0x28,0x0b70d2,0x22])

    def test_simultaneous_register_memory_moves_and_alu(self):
        w,_=A.assemble('move x:(r0)+,x0  a,y0\nmove b,x0  y:(r2),y1\nmove a,x0  a,y:(r2)+\nmac x0,y0,a  x:(r0)+,x0  a,y0',0x110000)
        self.assertEqual(w,[0x109800,0x19e200,0x125a00,0x1098d2])
        with self.assertRaises(ValueError): A.assemble('move x:(r0+n1),x0  a,y0',0x110000)

    def test_conditional_transfers(self):
        w,_=A.assemble('tlt b,a\nteq a,b\ntgt y1,a',0x110000)
        self.assertEqual(w,[0x029000,0x02a008,0x027070])

    def test_relative_branches_relocate_and_check_signed_bounds(self):
        text='init: bra <render\ntrigger: nop\nrender: bne <init\nrts'
        c=relocate(text,0x110000,{},('init','trigger','render'))
        self.assertEqual(c['words'],exporter.E.b64words([0x050c02,0,0x0527de,12]))
        self.assertEqual(c['relocs'],[])
        for delta in (-256,255):
            w,_=A.assemble(f'bra <${0x110000+delta:x}',0x110000)
            bits=delta&0x1ff
            self.assertEqual(w,[0x050c00|(bits&31)|((bits&0x1e0)<<1)])
        for delta in (-257,256):
            with self.assertRaisesRegex(ValueError,'short branch outside'):
                A.assemble(f'bra <${0x110000+delta:x}',0x110000)

    def test_symbolic_displacements_signed_terms_and_mnemonic_collision(self):
        w,_=A.assemble('neg b\nmove #>-left+right,x0\nmove y:(r0+>right-left-1),y0\nmove #>-$1,x1',0x110000,
                       {'neg':0x180000,'left':0x160000,'right':0x180000})
        self.assertEqual(w,[0x20003e,0x44f400,0x20000,0x0b70c6,0x1ffff,0x45f400,0xffffff])

    def test_dynamic_label_directory_exports_without_changing_instructions(self):
        m=json.loads((ROOT/'examples/contracts/replacement.json').read_text())
        m.update(injection=dict(mode='add'), samples=[],
                 components=dict(dsp2=dict(source='dsp2.asm',abi='md-voice/1')),
                 memory=[dict(kind='voice',space='XY',words=64,alignment=64,
                              lifetime='track-assignment',init='model',release='successor-init')])
        m['panel']['modes']=[dict(knob=1,zones=[dict(min=0,max=127,labels={'2':'TEST'})])]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'model.json').write_text(json.dumps(m))
            (root/'dsp2.asm').write_text('init: rts\ntrigger: rts\nrender: rts\n')
            p=exporter.export(root,root/'out')
            self.assertEqual(p['models'][0]['code']['words'],exporter.E.b64words([12,12,12]))
            self.assertEqual(p['models'][0]['dyn_labels'][0]['mask'],[2])
            self.assertEqual(p['models'][0]['dyn_labels'][0]['stop_of'],[0]*128)

    def test_voice_slots_and_parallel_multiply(self):
        w,_=A.assemble('move y:(r6+$2),x0\nmpy y1,x0,a  (r4)+n4\nrts',0x110000)
        self.assertEqual(w,[0x020eb4,0x204cc0,0xc])
    def test_labels_data_and_independent_relocations(self):
        c=relocate('init: move #>table,r0\ntrigger: jmp render\nrender: do #32,end\nnop\nend: rts',0x110000,{'table':0x120000},('init','trigger','render'))
        self.assertEqual(set(r[1] for r in c['relocs']),{'table','@org'})
    def test_undefined_and_duplicate_labels(self):
        for text in ('init: jmp missing','init: nop\ninit: rts'):
            with self.assertRaises((ValueError,KeyError)): A.assemble(text,0x110000)
    def test_nonlinear_relocation_rejected(self):
        with self.assertRaises(ValueError): relocate('init: .dc table\ntrigger: rts\nrender: .dc table&255',0x110000,{'table':0x120000},('init','trigger','render'))

if __name__=='__main__': unittest.main()
