// DEV's kit editor draws the new category using the previous category's cached
// length. Refresh that cache before drawing, using the base's own list counter.
import { be32, concat, hex, u32 } from './bytes.js';
import type { Base } from './bases.js';

export interface MenuRefreshSite {
  hook: number; patch: number; original: Uint8Array; count: number;
}

export function menuRefreshSite(base: Base, main: Uint8Array): MenuRefreshSite | null {
  // Qualified separately from the older DEV and stock menu implementations.
  if (base.id !== 'dev-26a01') return null;
  const images = [{ram:base.os.cfBase,bytes:main}, ...base.segments];
  const find = (pattern: Uint8Array) => images.flatMap(image => {
    const found: {at:number; bytes:Uint8Array; offset:number}[] = [];
    for (let i=0;i+pattern.length<=image.bytes.length;i+=2) {
      // Avoid allocating a callback for every candidate address on each trim preview.
      if (image.bytes[i]!==pattern[0]) continue;
      let k=1;
      while(k<pattern.length && image.bytes[i+k]===pattern[k]) k++;
      if(k===pattern.length) found.push({at:image.ram+i,bytes:image.bytes,offset:i});
    }
    return found;
  });
  const draw = find(hex('28390028b9c02a390028c2d82c390028b7302039002818dae58841f9007001aa2e300800'));
  const counter = find(concat([hex('20390028b72ce7882040d1fc'),be32(base.os.familyTable+4),
    hex('20504280600252804a9866fa23c00028c2d84e75')]));
  if (draw.length!==1 || counter.length!==1) throw new Error('DEV menu refresh requires one verified drawer and list counter');
  const hook=draw[0].at, patch=hook&~3, offset=draw[0].offset-(hook-patch);
  if (offset<0) throw new Error('DEV menu refresh hook lacks surrounding instruction bytes');
  return {hook,patch,original:draw[0].bytes.slice(offset,offset+8),count:counter[0].at};
}

export function menuRefreshCode(site: MenuRefreshSite): Uint8Array {
  // Preserve d0/a0 across the counter; d4 and CCR end exactly as the displaced
  // move.l scroll,d4. Save CCR as well: the counter's addq changes X, which the
  // displaced move preserves. The counter updates only the cached list count.
  return concat([hex('2f002f0842c02f004eb9'),be32(site.count),hex('201f44c0205f201f28390028b9c04e75')]);
}

export function menuRefreshPatches(site: MenuRefreshSite, entry: number): [number,number][] {
  const bytes=site.original.slice();
  bytes.set(concat([hex('4eb9'),be32(entry)]),site.hook-site.patch);
  return [[site.patch,u32(bytes,0)],[site.patch+4,u32(bytes,4)]];
}
