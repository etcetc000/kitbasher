// Pre-commit guard (.githooks/pre-commit, installed by `npm run install-hooks`). Firmware is never
// committed: Kitbasher works on the firmware each user supplies, and Elektron's OS images are not
// ours to redistribute. The guard refuses a staged file that
//   - has a firmware or SysEx extension (.syx, .bin, .rom, .hex, .mid);
//   - starts with a SysEx message (0xF0), whatever its name;
//   - is a binary of 512 KiB or more, the size of a flash or ROM dump.
//
//   node ci/pre_commit.mjs [paths...]   with no paths it checks what `git diff --cached` stages

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const explicit = process.argv.slice(2);
const paths = explicit.length ? explicit
  : execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);

const content = (p) => {
  if (explicit.length) return existsSync(p) ? readFileSync(p) : null;
  try { return execFileSync('git', ['show', `:${p}`], { maxBuffer: 1 << 28, windowsHide: true }); } catch { return null; }
};
const binary = (bytes) => bytes.subarray(0, 8000).includes(0);

const bad = [];
for (const p of paths) {
  if (/^catalog\/uw\/[^/]+\.syx$/i.test(p)) continue; // UW sample data the site serves, not firmware
  if (/\.(syx|bin|rom|hex|mid)$/i.test(p)) { bad.push(`${p}: firmware or SysEx file`); continue; }
  const bytes = content(p);
  if (!bytes) continue;
  if (bytes[0] === 0xf0) bad.push(`${p}: starts with a SysEx message`);
  else if (bytes.length >= 512 * 1024 && binary(bytes)) bad.push(`${p}: a large binary, like a flash or ROM dump`);
}
if (bad.length) {
  console.error(`pre-commit: firmware is never committed. Refusing:\n  ${bad.join('\n  ')}\n` +
                'Unstage these with git restore --staged <file>.');
  process.exit(1);
}
