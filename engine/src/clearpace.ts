// Pace the stock per-block output clear, independently of the paced recovery clears.
// The DSP2 block has already been released while this loop clears 192 X words, and
// internal-bank contention can delay a DMA word even at maximum DMA priority. The
// emulator does not model that contention, so this option is only observable on hardware.
export const CLEAR_SITE = 0x2a5;
export const CLEAR_BASE = [0x06c080, 0x2a7, 0x445a00];
export const CLEAR_AT = 0x146700;
export const CLEAR_COUNT = 192;
export const CLEAR_WORDS = [0x06c080, CLEAR_AT + 3, 0x445a00, 0x000000, 0x00000c];
export const CLEAR_HOOK = [0x0bf080, CLEAR_AT, 0x000000];
// Same x0 value, R2 addressing/modifier, store count and post-increment as stock.
// DO restores LA/LC; JSR/RTS adds one balanced stack frame. No DMA/ESSI writes.
