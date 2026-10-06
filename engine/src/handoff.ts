// Arm DSP1 DMA4 before releasing DSP2. Same instructions, reordered in place.
export const HANDOFF_AT = 0x282;
export const HANDOFF_BASE = [
  0x44f000, 0xffffb8,
  0x56f000, 0xffffbd, 0x014283, 0x567000, 0xffffbd,
  0x08f49c, 0x0e52c4,
  0x08f49e, 0x600, 0x08f49f, 0xffffb8, 0x08f49d, 0x1ff,
  0x08f49c, 0x8e52c4,
];
export const HANDOFF_ORDERED = [
  ...HANDOFF_BASE.slice(0, 2),
  ...HANDOFF_BASE.slice(7), // configure and arm first
  ...HANDOFF_BASE.slice(2, 7), // release last
];
