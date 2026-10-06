"""Contract negative controls, without ROMs, emulators or table data."""
import copy
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'packs'))
from model_manifest import validate
from model_panel import dynamic_plans
import base64


class Contracts(unittest.TestCase):
    def setUp(self): self.m=json.loads((ROOT/'examples/contracts/replacement.json').read_text())
    def test_replacement_is_representable(self): validate(self.m)
    def test_unknown_field(self):
        self.m['address']=0x116600
        with self.assertRaises(Exception): validate(self.m)
    def test_target_required(self):
        del self.m['injection']['target']
        with self.assertRaises(Exception): validate(self.m)
    def test_eight_knobs(self):
        self.m['panel']['knobs'].pop()
        with self.assertRaises(Exception): validate(self.m)
    def test_raw_range(self):
        self.m['panel']['knobs'][0]['default']=128
        with self.assertRaises(Exception): validate(self.m)
    def test_zone_gap_overlap_and_reverse(self):
        for zones in ([[0,63],[65,127]],[[0,64],[64,127]],[[127,0]]):
            self.m['panel']['modes']=[dict(knob=2,zones=[dict(min=a,max=b,labels={'3':'TONE'}) for a,b in zones])]
            with self.assertRaises(ValueError): validate(self.m)
    def test_combo_zones_and_cleanup(self):
        self.m['panel']['modes']=[dict(knob=2,zones=[dict(min=a,max=b,labels={'3':s}) for a,b,s in [(0,63,'A'),(64,127,'B')]])]
        self.m['memory'].append(dict(kind='pi',space='XY',words=1536,alignment=512,lifetime='track-assignment',
            init='chunked-muted',release='clean-before-stock-pi',dirty_span=dict(offset=1024,words=512)))
        validate(self.m)
        self.m['memory'][1]['dirty_span']['words']=513
        with self.assertRaises(ValueError): validate(self.m)
    def test_caption_ownership(self):
        mode=dict(knob=2,zones=[dict(min=0,max=127,labels={'3':'TONE'})])
        other=copy.deepcopy(mode); other['knob']=4
        self.m['panel']['modes']=[mode,other]
        with self.assertRaises(ValueError): validate(self.m)

    def test_dynamic_labels_independent_selectors_and_defaults(self):
        self.m['panel']['knobs'][3]['label']='BASE'
        self.m['panel']['modes']=[dict(knob=2,zones=[
            dict(min=64,max=127,labels={'2':'B'}),
            dict(min=0,max=63,labels={'2':'A','3':'TONE'})]),
            dict(knob=4,zones=[dict(min=0,max=127,labels={'4':'TYPE'})])]
        validate(self.m)
        a,b=dynamic_plans(self.m['panel'])
        self.assertEqual(a['mask'],[2,3])
        self.assertEqual(a['stop_of'],[0]*64+[1]*64)
        self.assertEqual(a['formula'],[0,1,6])
        self.assertEqual(base64.b64decode(a['blocks']),b'A   TONEB   BASE')
        self.assertEqual(b['mask'],[4])
        self.assertEqual(base64.b64decode(b['blocks']),b'TYPE')

    def test_irregular_mode_mapping_uses_lookup(self):
        self.m['panel']['modes']=[dict(knob=2,zones=[
            dict(min=0,max=3,labels={'3':'A'}),dict(min=4,max=99,labels={'3':'B'}),
            dict(min=100,max=127,labels={'3':'C'})])]
        validate(self.m)
        p=dynamic_plans(self.m['panel'])[0]
        self.assertIsNone(p['formula'])
        self.assertEqual(p['stop_of'],[0]*4+[1]*96+[2]*28)
    def test_dsp1_requires_separate_budget(self):
        self.m['components']['dsp1_drive']=dict(law='example',entry='example:law',abi='md-track-drive/1')
        with self.assertRaises(Exception): validate(self.m)
        self.m['budget']['dsp1_cps']=10
        validate(self.m)
    def test_isa(self):
        self.m['components']['coldfire']=dict(entry='example:code',abi='example/1',isa='ISA_B')
        with self.assertRaises(Exception): validate(self.m)

    def test_sample_installation_descriptor(self):
        sample = dict(kind='uw-sample', tag='DATA', version=1, minimum_words=8,
                      required=True, without='silent',
                      install=dict(transport='sds-handshake', file='example-data.syx'))
        self.m['samples'] = [sample]
        validate(self.m)
        for filename in ('../data.syx', 'https://example.org/data.syx', 'data.wav'):
            sample['install']['file'] = filename
            with self.assertRaises(Exception): validate(self.m)


if __name__=='__main__': unittest.main()
