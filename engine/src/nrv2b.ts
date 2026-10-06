// NRV2B decoder: the format of every Machinedrum OS container slot (the boot block's routine at
// flash 0x1c4). Returns the unpacked bytes and how many packed bytes the stream used, because
// slots and X.13's add-on carry a dead tail.

const END_CODE = 0x1000002;

export function nrv2bDecode(data: Uint8Array): { out: Uint8Array; used: number } {
  let cursor = 0;
  let control = 0;
  let previous = 1;
  let out = new Uint8Array(1 << 20);
  let n = 0;

  const byte = (): number => {
    if (cursor >= data.length) throw new Error('truncated NRV2B stream');
    return data[cursor++];
  };
  const bit = (): number => {
    if (control & 127) control *= 2;
    else control = byte() * 2 + 1;
    control &= 511;
    return (control >> 8) & 1;
  };
  const variable = (): number => {
    let value = 1;
    for (;;) {
      value = value * 2 + bit();
      if (value > END_CODE) throw new Error('oversized NRV2B variable code');
      if (bit()) return value;
    }
  };
  const grow = (need: number): void => {
    if (need <= out.length) return;
    let cap = out.length;
    while (cap < need) cap *= 2;
    const o = new Uint8Array(cap);
    o.set(out.subarray(0, n));
    out = o;
  };

  for (;;) {
    if (bit()) {
      grow(n + 1);
      out[n++] = byte();
      continue;
    }
    const code = variable();
    let distance: number;
    if (code === 2) {
      distance = previous;
    } else {
      const encoded = ((code - 3) * 256 + byte()) >>> 0;
      if (encoded === 0xffffffff) break;
      distance = previous = encoded + 1;
    }
    let length = bit() * 2 + bit();
    if (!length) length = variable() + 2;
    length += (distance > 0xd00 ? 1 : 0) + 1;
    if (distance > n) throw new Error('invalid NRV2B backreference');
    grow(n + length);
    for (let i = 0; i < length; i++, n++) out[n] = out[n - distance];
  }
  return { out: out.slice(0, n), used: cursor };
}
