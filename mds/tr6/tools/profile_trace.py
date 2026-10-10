"""Replay an existing TR6 render with ordered traces and explicit cost-model limits.

Uses external lab tools; neither firmware nor private model code is required.
Instruction-cache misses are modeled, not measured on X.20 hardware.
"""
import argparse
from bisect import bisect_right
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re

from render_bd import run

LINE = re.compile(r'^([0-9a-f]{6}):\s*(.*?)\s*;\s*(?:\(bits:[^)]*\)\s*)?((?:[0-9a-f]{6}\b\s*)+)')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cold_fetch_misses(trace, sizes):
    """Eight LRU sectors of 128 words; misses fill individual instruction words."""
    tags, valid, misses = [], {}, 0
    for pc, _ in trace:
        for address in range(pc, pc + sizes[pc]):
            tag = address // 128
            if tag in tags:
                tags.remove(tag)
            else:
                if len(tags) == 8:
                    del valid[tags.pop(0)]
                valid[tag] = set()
            tags.append(tag)
            if address not in valid[tag]:
                misses += 1
                valid[tag].add(address)
    return misses


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('script', type=Path, help='Existing single-machine TR6 render script')
    p.add_argument('--host', required=True)
    p.add_argument('--trace-host', required=True)
    p.add_argument('--disassembler', required=True)
    p.add_argument('--interlocks', type=Path, required=True, help='External lab interlock.py')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--render-block',type=int,action='append',default=[],help='Also trace this zero-based render block (repeatable)')
    a = p.parse_args()
    # A stale modulo mode invalidates both state and timing comparisons.
    import os
    if 'MDHOST_STALE_M' in os.environ:
        raise ValueError('Unset MDHOST_STALE_M before profiling')
    script = a.script.resolve(); out = a.out.resolve(); out.mkdir(parents=True, exist_ok=True)
    build_path = script.parent / 'assembly.json'
    build = json.loads(build_path.read_text())
    source_lines = script.read_text().splitlines()
    lines, programs = [], []
    inputs = {str(script): digest(script), str(build_path): digest(build_path)}
    for line in source_lines:
        if line.startswith('load '):
            _, space, address, filename = line.split(maxsplit=3)
            path = (script.parent / filename).resolve()
            if any(c.isspace() for c in str(path)):
                raise ValueError('The DSP host load protocol requires paths without whitespace')
            inputs[str(path)] = digest(path)
            line = f'load {space} {address} {path}'
            if space == 'P':
                start=int(address,16); size=path.stat().st_size
                if size%3: raise ValueError('Program image is not packed 24-bit words')
                end=start+size//3
                if start<0x302 and end>0x300:
                    raise ValueError('Program overlaps the instruction-host call stub')
                if any(start<b+n and end>b for _,b,n in programs):
                    raise ValueError('Overlapping program images are not supported')
                programs.append((path,start,size//3))
        lines.append(line)
    if not programs:
        raise ValueError('No program image loaded')
    program,base,words=programs[0]
    if words!=build['program_words']:
        raise ValueError('The first P load must be the complete machine program')
    calls = [int(s.split()[1], 16) for s in lines if s.startswith('call ')]
    render = base + build['labels']['render']
    renders = [i for i, pc in enumerate(calls) if pc == render]
    if not renders:
        raise ValueError('No render calls')
    ordinary_script = out / 'ordinary.script'
    ordinary_script.write_text('\n'.join(lines) + '\n')
    normal = run([Path(a.host).resolve(), ordinary_script, 'ordinary.raw'], cwd=out,timeout=600)
    (out / 'ordinary.log').write_text(normal.stdout + normal.stderr)
    cycles = [int(x) for x in re.findall(r'instructions \d+ cycles (\d+)', normal.stdout)]
    if len(cycles) != len(calls):
        raise ValueError('Every call must have exactly one cycles record')
    # Sample lifecycle boundaries and the observed raw-cycle extremes. This is
    # deliberately not described as an exhaustive cold-cache worst-case search.
    selected = set(renders[:3] + renders[-1:])
    if any(index<0 or index>=len(renders) for index in a.render_block):
        raise ValueError('Requested render block is outside the replay')
    selected.update(renders[index] for index in a.render_block)
    selected.update((max(renders, key=lambda i: cycles[i]), min(renders, key=lambda i: cycles[i])))
    first_renders=set(); pending=False
    for i,pc in enumerate(calls):
        if pc==base+build['labels']['trigger']: pending=True
        elif pc==render:
            if pending: first_renders.add(i)
            pending=False
    later=[i for i in renders if i not in first_renders]
    if later: selected.add(max(later,key=lambda i: cycles[i]))
    for target in (base + build['labels']['init'], base + build['labels']['trigger']):
        matches = [i for i, pc in enumerate(calls) if pc == target]
        selected.update(matches[:2])
    # External-memory fixtures set INIT's R1 track number in a separate P stub.
    # Trace that actual entry too, including its setup and jump into INIT.
    selected.update(i for i,pc in enumerate(calls)
                    if any(start<=pc<start+size for _,start,size in programs[1:]))
    traced, index = [], 0
    for line in lines:
        if line.startswith('call '):
            if index in selected:
                traced += ['trace on', line, f'trace call-{index}.trace']
            else:
                traced.append(line)
            index += 1
        else:
            traced.append(line)
    trace_script = out / 'ordered.script'
    trace_script.write_text('\n'.join(traced) + '\n')
    traced_run = run([Path(a.trace_host).resolve(), trace_script, 'ordered.raw'], cwd=out,timeout=600)
    (out / 'ordered.log').write_text(traced_run.stdout + traced_run.stderr)
    if (out / 'ordinary.raw').read_bytes() != (out / 'ordered.raw').read_bytes():
        raise AssertionError('Ordered tracer differs from ordinary host audio')
    trace_cycles = [int(x) for x in re.findall(r'instructions \d+ cycles (\d+)', traced_run.stdout)]
    if cycles != trace_cycles:
        raise AssertionError('Ordered tracer differs from ordinary host call cycles')
    if re.findall(r'^dump .+$', normal.stdout, re.M) != re.findall(r'^dump .+$', traced_run.stdout, re.M):
        raise AssertionError('Ordered tracer differs from ordinary host final state/guards')
    items = []
    for segment,(path,start,_) in enumerate(programs):
        listing=out/f'code-{segment}.asm'
        run([Path(a.disassembler).resolve(), '-in', path, '-pc', f'{start:x}', '-nops', '-out', listing])
        for line in listing.read_text().splitlines():
            m = LINE.match(line)
            if m:
                items.append((int(m[1], 16), len(m[3].split()), m[2]))
    # The instruction host adds its own two-word JSR at internal P:$300.
    items.append((0x300, 2, 'jsr >$0'))
    sizes = {pc: n for pc, n, _ in items}
    spec = importlib.util.spec_from_file_location('external_interlocks', a.interlocks.resolve())
    interlocks = importlib.util.module_from_spec(spec); spec.loader.exec_module(interlocks)
    labels = sorted([(base + pc, label) for label, pc in build['labels'].items()]
                    +[(start,'fixture_'+path.stem) for path,start,_ in programs[1:]]
                    +[(0x300,'host_stub')])
    addresses = [pc for pc, _ in labels]
    rows = []
    for index in sorted(selected):
        trace = [(int(pc, 16), int(c)) for pc, c in
                 (line.split() for line in (out / f'call-{index}.trace').read_text().splitlines())]
        missing = sorted({pc for pc, _ in trace} - sizes.keys())
        if not trace or missing:
            raise AssertionError(f'Empty trace or undecoded executed PCs: {missing}')
        totals, sites, _ = interlocks.analyse(items, trace)
        totals['degdo'], _ = interlocks.degenerate_dos(items, trace, {})
        fetches = cold_fetch_misses(trace, sizes)
        groups = Counter()
        for j, (pc, before) in enumerate(trace):
            # Host call count includes the final RTS; trace timestamps do not
            # themselves give its duration. Recover it from the complete call.
            after = trace[j+1][1] if j+1 < len(trace) else trace[0][1] + cycles[index]
            if after < before:
                raise AssertionError('Nonmonotonic instruction timestamps')
            k = bisect_right(addresses, pc) - 1
            groups[labels[k][1] if k >= 0 else 'host_stub'] += after - before
        rows.append(dict(call_index=index, entry=f'{calls[index]:06x}',
                         phase='render' if index in renders else 'init' if calls[index] == base + build['labels']['init'] else 'trigger' if calls[index] == base + build['labels']['trigger'] else 'fixture_entry',
                         render_block=renders.index(index) if index in renders else None,
                         first_render_after_trigger=index in first_renders,
                         host_cycles=cycles[index], instructions=len(trace),
                         modeled_interlocks=totals, cold_instruction_word_misses=fetches,
                         additive_sensitivity={str(ws): cycles[index] + sum(totals.values()) + ws*fetches for ws in (1, 2, 3)},
                         raw_cycles_by_nearest_label=dict(groups.most_common(12)),
                         interlock_sites=[dict(pc=f'{key[0]:06x}', kinds=key[1], count=v[0], cycles=v[1], previous=v[2], instruction=v[3])
                                          for key, v in sorted(sites.items(), key=lambda kv: kv[1][1], reverse=True)[:12]]))
    report = dict(input_sha256=inputs,
                  tool_sha256={str(Path(x).resolve()): digest(x) for x in (a.host, a.trace_host, a.disassembler, a.interlocks, __file__)},
                  base=f'{base:06x}', source_program_words=build['program_words'],
                  program_segments=[dict(path=str(path),base=f'{start:06x}',words=size) for path,start,size in programs],
                  ordinary_vs_tracer_audio_bitexact=True, ordinary_vs_tracer_cycles_equal=True,
                  ordinary_vs_tracer_final_dumps_equal=True,
                  cold_cache_measured=False, rows=rows,
                  requested_render_blocks=a.render_block,
                  limitations=['Sampled calls, not exhaustive control/placement worst case.',
                               'Each selected call starts with an empty modeled instruction cache.',
                               'Wait-state values 1/2/3 are sensitivity inputs, not X.20 calibration.',
                               'Interlock and fetch penalties are added; overlap is unvalidated.',
                               'No data-memory waits, host dispatch, DMA freezes, or hardware measurement.',
                               'Includes the instruction host JSR stub; trigger and render are separate calls.'])
    (out / 'profile.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(output=str(out / 'profile.json'), calls=[{k: row[k] for k in ('phase','render_block','host_cycles','modeled_interlocks','cold_instruction_word_misses','additive_sensitivity')} for row in rows]), indent=2))


if __name__ == '__main__':
    main()
