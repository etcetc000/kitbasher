// DSP upload streams: 24-bit little-endian words holding records [tag, address, count, data...]
// (tag 0 = P, 1 = X, 2 = Y), optionally preceded by (3|4, x) pairs, ended by an entry record
// whose tag is 3.

export interface Record {
  index: number;       // index of the tag word
  tag: number;
  addr: number;
  count: number;
}

export function records(words: number[]): { recs: Record[]; entryAt: number } {
  let i = 0;
  for (const tag of [3, 4]) if (words[i] === tag) i += 2;
  const recs: Record[] = [];
  for (;;) {
    if (i + 1 >= words.length) throw new Error('DSP upload has no entry record');
    const tag = words[i];
    const addr = words[i + 1];
    if (tag === 3) return { recs, entryAt: i };
    const count = words[i + 2];
    recs.push({ index: i, tag, addr, count });
    i += 3 + count;
  }
}
