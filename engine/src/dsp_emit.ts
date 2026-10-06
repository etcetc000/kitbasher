// A minimal DSP56300 code emitter for the engine's own small routines: fixed opcodes, labels
// resolved to absolute addresses by finish(), and data words placed after the code.
export class Emit {
  words: number[] = []; labels: Record<string, number> = {}; fix: [number, string][] = [];
  regs: Record<string, number> = { x0: 4, a0: 8, b0: 9, a2: 10, b2: 11, a1: 12, b1: 13, a: 14, b: 15, r0: 16, m0: 32 };
  saved = ['a2', 'a1', 'a0', 'b2', 'b1', 'b0', 'x0', 'r0', 'm0'];
  constructor(public at: number) {}
  put(...w: number[]) { this.words.push(...w); }
  label(n: string) { this.labels[n] = this.at + this.words.length; }
  ref(n: string) { this.fix.push([this.words.length, n]); this.put(0); }
  read(r: string, n: string) { this.put(0x07f080 | this.regs[r]); this.ref(n); }
  write(r: string, n: string) { this.put(0x077080 | this.regs[r]); this.ref(n); }
  jump(n: string, cc?: number) { this.put(cc === undefined ? 0x0af080 : 0x0af0a0 | cc); this.ref(n); }
  cmp(n: number) { this.put(0x0140c5, n); }
  set(n: string, v: number) { this.put(0x56f400, v); this.write('a1', n); }
  inc(n: string, mask?: number) { this.read('a', n); this.put(0x014180); if(mask !== undefined)this.put(0x0140c6, mask); this.write('a1', n); }
  copy(src: string, dst: string) { this.read('a', src); this.write('a1', dst); }
  save(prefix: string) { this.saved.forEach(r => this.write(r, prefix + r)); }
  restore(prefix: string) { this.saved.forEach(r => this.read(r, prefix + r)); }
  flag(n: number) { this.read('a', 'flags'); this.put(0x0140c2, n); this.write('a1', 'flags'); }
  finish(data: string[]) {
    const codeWords=this.words.length;
    for(const n of data){this.label(n);this.put(0);}
    for(const [i,n] of this.fix){if(this.labels[n]===undefined)throw new Error(n);this.words[i]=this.labels[n];}
    return {at:this.at,words:this.words,labels:this.labels,codeWords,stub:this.labels.stub,vector:[0x0bf080,this.at]};
  }
}
