"""Synthetic transport fixtures: no ROM, model data, or MIDI access."""
from functools import reduce
from operator import xor
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packs'))
from uw_asset import inspect


def asset(packets=1):
    def v21(n):
        return bytes((n >> (7 * i)) & 127 for i in range(3))
    name = bytes.fromhex('f0 00 20 3c 02 00 73 2e') + b'TEST\xf7'
    header = bytes([0xf0, 0x7e, 0, 1, 46, 0, 16]) + v21(22668) + v21(40 * packets)
    header += v21(0) + v21(0) + bytes([127, 247])
    data = []
    for i in range(packets):
        body = bytes([126, 0, 2, i % 128]) + bytes(120)
        data.append(bytes([240]) + body + bytes([reduce(xor, body), 247]))
    return name + header + b''.join(data)


class UwAsset(unittest.TestCase):
    def test_slot_mapping_hash_and_packet_wrap(self):
        r = inspect(asset(129))
        self.assertEqual((r['sds_sample'], r['displayed_slot'], r['packets']), (46, 47, 129))
        self.assertEqual(r['uw_words'], 2580)
        self.assertFalse(r['data_abi_verified'])
        self.assertFalse(r['hardware_loaded'])
        self.assertEqual(len(r['sha256']), 64)

    def test_truncation_checksum_wrong_slot_and_order(self):
        raw = asset(2)
        for bad in (raw[:-1], raw[:-127], raw + raw[-127:], b'x' + raw):
            with self.assertRaises(ValueError):
                inspect(bad)
        for offset in (7, 13 + 4, 34 + 4, 34 + 8):
            bad = bytearray(raw)
            bad[offset] ^= 1
            with self.assertRaises(ValueError):
                inspect(bytes(bad))

    def test_non_seven_bit_and_unexpected_messages(self):
        for bad in (b'', asset() + b'\xf0\x7e\xf7', asset().replace(b'TEST', b'TE\x80T')):
            with self.assertRaises(ValueError):
                inspect(bad)


if __name__ == '__main__':
    unittest.main()
