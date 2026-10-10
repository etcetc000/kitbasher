"""Emit literal 24-bit tables, optionally sharing complete identical arrays."""


def emit_tables(tables, deduplicate=False):
    groups=[]; seen={}
    for name,values in tables.items():
        words=tuple(value&0xffffff for value in values)
        if deduplicate and words in seen:
            groups[seen[words]][0].append(name)
        else:
            seen[words]=len(groups)
            groups.append(([name],words))
    lines=[]
    for names,words in groups:
        lines.extend(name+':' for name in names)
        for i in range(0,len(words),8):
            lines.append('    .dc '+','.join(f'${word:06x}' for word in words[i:i+8]))
    return lines
