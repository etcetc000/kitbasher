"""Inspect one generated MD UW SDS file offline. Never opens a MIDI port.

The receipt verifies the transport container, not the decoded DSP data ABI or hardware load.
Accepts the name + 16-bit SDS header + data layout emitted by the UW asset generators.
"""
import argparse
from functools import reduce
import hashlib
import json
from operator import xor
from pathlib import Path


def inspect(raw):
    messages = []
    pos = 0
    while pos < len(raw):
        if raw[pos] != 0xf0:
            raise ValueError('expected SysEx start')
        end = raw.find(b'\xf7', pos + 1)
        if end < 0:
            raise ValueError('truncated SysEx message')
        message = raw[pos:end + 1]
        if any(b >= 128 for b in message[1:-1]):
            raise ValueError('non-seven-bit SysEx payload')
        messages.append(message)
        pos = end + 1
    if len(messages) < 3:
        raise ValueError('expected name, SDS header and data')
    name, header, *packets = messages
    if len(name) != 13 or name[:7] != bytes.fromhex('f0 00 20 3c 02 00 73'):
        raise ValueError('expected MD sample name message')
    if any(not 32 <= b <= 126 for b in name[8:12]):
        raise ValueError('invalid sample name')
    if len(header) != 21 or header[1] != 0x7e or header[3] != 1 or header[6] != 16:
        raise ValueError('expected 16-bit SDS dump header')
    number = header[4] | header[5] << 7
    if not 0 <= number < 48 or name[7] != number:
        raise ValueError('name/header destination mismatch or slot outside 0..47')
    def v21(offset):
        return sum(header[offset + i] << (7 * i) for i in range(3))
    period, samples = v21(7), v21(10)
    if period == 0 or samples == 0 or samples % 2:
        raise ValueError('invalid UW sample length or period')
    if v21(13) or v21(16) or header[19] != 0x7f:
        raise ValueError('expected non-looping UW data')
    if len(packets) != (samples + 39) // 40:
        raise ValueError('packet count does not match declared sample length')
    for index, packet in enumerate(packets):
        if (len(packet) != 127 or packet[1:4] != bytes([0x7e, header[2], 2]) or
                packet[4] != index % 128):
            raise ValueError(f'invalid data packet/order at {index}')
        if reduce(xor, packet[1:-1]) != 0:
            raise ValueError(f'checksum mismatch at packet {index}')
        if any(b & 31 for b in packet[7:125:3]):
            raise ValueError(f'non-16-bit data at packet {index}')
    return dict(format='md-uw-asset/1', sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw),
                name=name[8:12].decode('ascii'), sds_sample=number, displayed_slot=number + 1,
                samples=samples, uw_words=samples // 2, period_ns=period,
                seconds=samples * period / 1e9, packets=len(packets),
                transport='sds-handshake', transport_valid=True,
                data_abi_verified=False, hardware_loaded=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('file', type=Path)
    args = ap.parse_args()
    try:
        result = inspect(args.file.read_bytes())
    except (ValueError, OSError) as exc:
        ap.exit(1, f'UW asset refused: {exc}\n')
    print(json.dumps(dict(file=args.file.name, **result), indent=2))


if __name__ == '__main__':
    main()
