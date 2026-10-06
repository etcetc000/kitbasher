// Assembly tables are immutable by contract. Legacy tables may contain scratch,
// so sharing must be explicitly enabled by the caller for each allocation.
export function tablePool(allocate: (words: number, name: string) => number) {
  const placed = new Map<string, number>();
  return (content: string, words: number, name: string, immutable: boolean): { address: number; fresh: boolean } => {
    const prior = immutable ? placed.get(content) : undefined;
    if (prior !== undefined) return { address: prior, fresh: false };
    const address = allocate(words, name);
    if (immutable && address >= 0) placed.set(content, address);
    return { address, fresh: true };
  };
}
