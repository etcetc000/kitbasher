"""Keep the dead-state exception from concealing audible/retrigger changes."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from check_bd_tail_elision import state_differences
from generate_bd import STATE


class TailStateContract(unittest.TestCase):
    def test_only_dead_coordinates_can_differ(self):
        old=[0]*64; new=old.copy()
        for name in ('lastbody','z1'): new[STATE.index(name)]=0xffffff
        self.assertEqual(set(state_differences(old,new)),{STATE.index('lastbody'),STATE.index('z1')})
        for name in ('rnglo','rnghi','z2','dcout','active','silent'):
            bad=new.copy(); bad[STATE.index(name)]=1
            with self.subTest(name=name),self.assertRaises(AssertionError): state_differences(old,bad)

    def test_either_nonzero_envelope_disallows_coordinate_drift(self):
        for name in ('amp','clickenv'):
            for side in ('old','new','both'):
                old=[0]*64; new=old.copy(); new[STATE.index('lastbody')]=1
                if side in ('old','both'): old[STATE.index(name)]=1
                if side in ('new','both'): new[STATE.index(name)]=1
                with self.subTest(name=name,side=side),self.assertRaises(AssertionError): state_differences(old,new)

    def test_incomplete_state_is_rejected(self):
        for count in (0,39,43,63,65):
            with self.subTest(count=count),self.assertRaises(AssertionError): state_differences([0]*count,[0]*count)


if __name__=='__main__': unittest.main()
