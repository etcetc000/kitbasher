"""Portable pack encoding and relocation helpers; no model implementations."""
import base64
import hashlib
import json

FORMAT = 'md-pack/1'
REF_ORG = 0x110000
REF_TAB = 0x120000
TAB_STRIDE = 0x4000
SHIFT = 0x123

def b64words(words):
    return base64.b64encode(b''.join((w & 0xffffff).to_bytes(3, 'little') for w in words)).decode()

def link(ref, relocs, base_of, placed_of):
    out = list(ref)
    for i, sym, k in relocs:
        out[i] = (out[i] + k * (placed_of[sym] - base_of[sym])) & 0xffffff
    return out

def write_pack(path, obj):
    """Write the pack and return the sha256 of the written file."""
    raw = json.dumps(obj, indent=1).encode()
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()
