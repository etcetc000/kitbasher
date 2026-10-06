"""Small assembly-source front end over dsp56300's instruction encoder.

Labels, .equ, .dc and integer expressions; no executable model code is imported.
The short voice-slot and parallel-move forms follow the dsp56300 assembler.
"""
import ast
from functools import lru_cache
import os
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
CANON={('x0','x0'),('y0','y0'),('x1','x0'),('y1','y0'),('x0','y1'),('y0','x0'),('x1','y0'),('y1','x1')}
CC={'cc':0,'ge':1,'ne':2,'pl':3,'nn':4,'ec':5,'lc':6,'gt':7,
    'cs':8,'lt':9,'eq':10,'mi':11,'nr':12,'es':13,'ls':14,'le':15}
BRANCH={'bra':0x050c00,'bsr':0x050800,**{'b'+cc:0x050400|(v<<12) for cc,v in CC.items()}}
DATA_REG={'x0':4,'x1':5,'y0':6,'y1':7,'a0':8,'b0':9,'a2':10,'b2':11,'a1':12,'b1':13,'a':14,'b':15}
MOVE_REG={**DATA_REG,**{f'{bank}{i}':base+i for bank,base in [('r',16),('n',24),('m',32)] for i in range(8)}}

def expression(text, symbols):
    text=re.sub(r'\$([0-9a-fA-F]+)',r'0x\1',text.strip())
    def visit(n):
        if isinstance(n,ast.Constant) and type(n.value) is int: return n.value
        if isinstance(n,ast.Name): return symbols[n.id]
        if isinstance(n,ast.UnaryOp):
            v=visit(n.operand)
            if isinstance(n.op,ast.USub): return -v
            if isinstance(n.op,ast.UAdd): return v
        if isinstance(n,ast.BinOp):
            a,b=visit(n.left),visit(n.right)
            if isinstance(n.op,ast.Add): return a+b
            if isinstance(n.op,ast.Sub): return a-b
            if isinstance(n.op,ast.Mult): return a*b
            if isinstance(n.op,ast.LShift): return a<<b
            if isinstance(n.op,ast.RShift): return a>>b
            if isinstance(n.op,ast.BitAnd): return a&b
            if isinstance(n.op,ast.BitOr): return a|b
        raise ValueError('unsupported integer expression: '+text)
    return visit(ast.parse(text,mode='eval').body)

def read_source(root, filename):
    root=Path(root).resolve(); path=(root/filename).resolve()
    if not path.is_relative_to(root) or path.suffix!='.asm': raise ValueError('assembly must be inside model directory')
    return path.read_text(encoding='utf-8')

def canon(ins):
    m=re.match(r'^(mpy|mac|mpyr|macr)\s+(-?)(x0|x1|y0|y1),(x0|x1|y0|y1),(a|b)(.*)$',ins,re.I)
    if m:
        op,neg,s1,s2,d,rest=m.groups()
        if (s1,s2) not in CANON and (s2,s1) in CANON: s1,s2=s2,s1
        ins=f'{op} {neg}{s1},{s2},{d}{rest}'
    return ins

@lru_cache(maxsize=100000)
def special(ins):
    # The DSP decodes both accumulator aliases; retain the compact JJJ=0 encoding
    # used by the source ports rather than the core encoder's JJJ=1 alias.
    aliases={'cmp b,a':0x200005,'cmp a,b':0x20000d,'tfr a,b':0x200009,'tfr b,a':0x200001}
    if ins in aliases: return [aliases[ins]]
    for pattern,load in [(r'^move ([xy]):\(r([0-7])\+>\$([0-9a-f]+)\),(\w+)$',True),
                         (r'^move (\w+),([xy]):\(r([0-7])\+>\$([0-9a-f]+)\)$',False)]:
        m=re.match(pattern,ins)
        if m:
            space,rn,off,reg=m.groups() if load else (*m.groups()[1:],m[1])
            if reg not in MOVE_REG: raise ValueError('unsupported long displacement register: '+reg)
            return [(0x0a7080 if space=='x' else 0x0b7080)|(int(rn)<<8)|(0x40 if load else 0)|MOVE_REG[reg],int(off,16)]
    # X-memory/register and register/Y-memory simultaneous moves. The upstream
    # encoder otherwise accepts these while silently dropping the second move.
    parts=re.split(r'\s{2,}',ins[5:]) if ins.startswith('move ') else []
    if len(parts)==2 and sum(':' in p for p in parts)==1:
        mem,reg=(parts[0],parts[1]) if 'x:' in parts[0] else (parts[1],parts[0])
        pair=re.fullmatch(r'([ab]),([xy][01])',reg)
        if pair:
            items=mem.split(','); load=':' in items[0]
            ea,dst=items if load else items[::-1]
            m=re.fullmatch(r'([xy]):\(r([0-7])(?:\+n([0-7]))?\)(?:(\+|-)(?:n([0-7]))?)?',ea)
            if m:
                space,rn,idx,post,step=m.groups(); rn=int(rn)
                if (idx is not None and int(idx)!=rn) or (step is not None and int(step)!=rn) or (idx and post):
                    raise ValueError('mismatched parallel address registers')
                mode=5 if idx else (1 if step else 3) if post=='+' else (0 if step else 2) if post=='-' else 4
                regs={'x0':0,'x1':1,'a':2,'b':3} if space=='x' else {'y0':0,'y1':1,'a':2,'b':3}
                if dst in regs and pair[2][0]!=space:
                    d=int(pair[1]=='b'); other=int(pair[2][1])
                    high=(regs[dst]<<18)|(d<<17)|(other<<16) if space=='x' else (d<<19)|(other<<18)|(regs[dst]<<16)|0x4000
                    return [0x100000|high|(int(load)<<15)|(mode<<11)|(rn<<8)]
        raise ValueError('unsupported simultaneous memory/register move: '+ins)
    lo={r:0x90|v for r,v in DATA_REG.items()}
    lw={r:0x80|v for r,v in DATA_REG.items()}
    for pattern,regs in [(r'^move ([xy]):\(r([0-7])\+\$([0-9a-f]+)\),(\w+)$',lo),
                         (r'^move (\w+),([xy]):\(r([0-7])\+\$([0-9a-f]+)\)$',lw)]:
        m=re.match(pattern,ins)
        if m:
            space,rn,off,reg=m.groups() if regs is lo else (*m.groups()[1:],m[1])
            n=int(off,16)
            if n<64 and reg in regs:
                return [0x020000|((n>>1)<<11)|(int(rn)<<8)|regs[reg]|(0x20 if space=='y' else 0)|(0x40 if n&1 else 0)]
    m=re.fullmatch(r't(\w+) (a|b|x0|x1|y0|y1),(a|b)',ins)
    if m and m[1] in CC and m[2]!=m[3]:
        reg={'a':0,'b':0,'x0':4,'y0':5,'x1':6,'y1':7}[m[2]]
        return [0x020000|(CC[m[1]]<<12)|(reg<<4)|(8 if m[3]=='b' else 0)]
    cc={'jmp':None,'jsr':None,'jcc':0,'jge':1,'jne':2,'jpl':3,'jnn':4,'jec':5,'jlc':6,'jgt':7,
        'jcs':8,'jlt':9,'jeq':10,'jmi':11,'jnr':12,'jes':13,'jls':14,'jle':15}
    m=re.match(r'^(j\w+)\s+>?\$([0-9a-f]+)$',ins)
    if m and m[1] in cc:
        op=m[1]; return [0x0af080 if op=='jmp' else 0x0bf080 if op=='jsr' else 0x0af0a0|cc[op],int(m[2],16)]
    return None

_cache={}
def encode(lines, exe=None):
    exe=str(Path(exe or os.environ.get('MD_ASSEMBLER') or ROOT/'build/assembly/asm56.exe').resolve())
    todo=list(dict.fromkeys(s for s in lines if (exe,s) not in _cache and special(s) is None))
    direct=[]; parallel=[]
    for s in todo:
        parts=re.split(r'\s{2,}',s)
        if len(parts)>1 and not parts[0].startswith('move '):
            parallel.append((s,parts[0],'move '+'  '.join(parts[1:])))
        else: direct.append(s)
    if parallel:
        sub=encode([v for _,a,b in parallel for v in (a,b)],exe)
        for i,(s,_,_) in enumerate(parallel):
            a,b=sub[2*i:2*i+2]
            if len(a)!=1 or a[0]&0xffff00!=0x200000 or len(b)!=1: raise ValueError('unsupported parallel move: '+s)
            _cache[exe,s]=[b[0]|(a[0]&255)]
    if direct:
        env=dict(os.environ,PATH='C:/msys64/mingw64/bin;'+os.environ['PATH']) if os.name=='nt' else None
        p=subprocess.run([exe],input='\n'.join(direct)+'\n',capture_output=True,text=True,env=env,check=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        rows=p.stdout.splitlines()
        if len(rows)!=len(direct): raise ValueError('encoder output population mismatch: '+p.stderr)
        for s,row in zip(direct,rows):
            if row.startswith('ERR'): raise ValueError(row)
            _cache[exe,s]=[int(v,16) for v in row.split()]
    return [special(s) or _cache[exe,s] for s in lines]

def assemble(text, org, symbols=None, exe=None):
    symbols=dict(symbols or {}); items=[]; names=set()
    for raw in text.splitlines():
        s=raw.split(';',1)[0].strip()
        if not s: continue
        if s.startswith('.equ '):
            k,v=s[5:].split(None,1)
            if k in symbols: raise ValueError('duplicate constant '+k)
            symbols[k]=expression(v,symbols); continue
        m=re.match(r'^(\w+):\s*(.*)$',s)
        if m:
            if m[1] in names or m[1] in symbols: raise ValueError('duplicate label '+m[1])
            names.add(m[1]); items.append(('label',m[1])); s=m[2]
        if s: items.append(('data' if s.startswith('.dc ') else 'ins',s[4:] if s.startswith('.dc ') else canon(s)))
    # Only expressions containing a declared symbol are replaced. Registers and addressing
    # syntax are left to the instruction encoder. Addition/subtraction needs no parentheses.
    # Both passes have the same declared names; only their address values change.
    declared='|'.join(re.escape(n) for n in sorted(set(symbols)|names,key=len,reverse=True)) or r'(?!)'
    symbol_pattern=re.compile(r'(?<![\w$])-?(?:'+declared+r')(?!\w)(?:[+-](?:\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|[0-9]+|[A-Za-z_]\w*))*')
    def subst(ins, syms):
        # Mnemonics are never symbols. Match declared names rather than consuming
        # register+displacement as one unknown token (e.g. r0+table-other).
        op,sep,operands=ins.partition(' ')
        def rep(m):
            return '$'+format(expression(m[0],syms)&0xffffff,'x')
        operands=symbol_pattern.sub(rep,operands)
        operands=re.sub(r'([#><+(,])-\$([0-9a-f]+)',lambda m:m[1]+'$'+format(-int(m[2],16)&0xffffff,'x'),operands)
        return op+sep+operands
    def branch(s):
        op,sep,operand=s.partition(' ')
        return (op,operand[1:]) if sep and op in BRANCH and operand.startswith('<') else None
    dummy={**symbols,**{n:0x110000 for n in names}}
    ins=['nop' if branch(s) else subst(s,dummy) for k,s in items if k=='ins']
    sizes=iter(map(len,encode(ins,exe))); pc=org; labels={}
    expected=[]
    for kind,s in items:
        if kind=='label': labels[s]=pc
        else:
            n=len(s.split(',')) if kind=='data' else next(sizes)
            expected.append(n); pc+=n
    syms={**symbols,**labels}
    enc=iter(encode(['nop' if branch(s) else subst(s,syms) for k,s in items if k=='ins'],exe)); words=[]; sizes=iter(expected)
    for kind,s in items:
        if kind=='label': continue
        w=[expression(v,syms)&0xffffff for v in s.split(',')] if kind=='data' else next(enc)
        short=branch(s) if kind=='ins' else None
        if short:
            op,target=short; delta=expression(target,syms)-(org+len(words))
            if not -256<=delta<=255: raise ValueError('short branch outside -256..255: '+s)
            bits=delta&0x1ff
            w=[BRANCH[op]|(bits&0x1f)|((bits&0x1e0)<<1)]
        if len(w)!=next(sizes): raise ValueError('instruction size changed after label resolution: '+s)
        words.extend(w)
    return words,labels

def tables(text):
    result={}; name=None
    for raw in text.splitlines():
        s=raw.split(';',1)[0].strip()
        if not s: continue
        if s.endswith(':'):
            name=s[:-1]
            if not re.fullmatch(r'[A-Za-z_]\w*',name) or name in result: raise ValueError('invalid table '+name)
            result[name]=[]
        elif s.startswith('.dc ') and name:
            result[name].extend(expression(v,{})&0xffffff for v in s[4:].split(','))
        else: raise ValueError('tables.asm expects labels and .dc words: '+s)
    if any(not w for w in result.values()): raise ValueError('empty table')
    return result
