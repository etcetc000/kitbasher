// Build the static site into web/dist: the page, the bundled engine, and the data it fetches
// (the base profiles from bases/ and every model pack in catalog/). Deploy web/dist to any static
// host. With an empty catalog/ the page still works: visitors load pack files into it themselves.

import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/dist');
const CATALOG = join(ROOT, 'catalog');

// ---- the packs to bundle: every JSON file in catalog/, each of which must be an md-pack/1 pack
const bundled = [];
const problems = [];
if (existsSync(CATALOG)) {
  for (const f of readdirSync(CATALOG).filter((f) => f.endsWith('.json')).sort()) {
    const text = readFileSync(join(CATALOG, f));
    let pack = null;
    try { pack = JSON.parse(text.toString('utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
    if (pack?.format !== 'md-pack/1') { problems.push(`${f}: not an md-pack/1 model pack`); continue; }
    bundled.push({ f, text, pack });
  }
}
if (bundled.filter((b) => b.pack.family === 'CORE').length > 1) problems.push('more than one core pack');
if (problems.length) {
  console.error(`web/build.mjs: catalog/ has files that cannot be bundled:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const bundle = await build({
  entryPoints: [join(ROOT, 'web/src/app.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  outfile: join(OUT, 'app.js'),
  write: false,
  // the emscripten module's node branch imports these; the browser never takes it
  external: ['module', 'fs', 'path', 'url', 'node:*'],
  logLevel: 'warning',
  plugins: [{
    // engine/src/ucl.ts names the wasm module by its path from engine/dist/src (what Node runs)
    name: 'ucl',
    setup(b) { b.onResolve({ filter: /ucl\.mjs$/ }, () => ({ path: join(ROOT, 'engine/wasm/ucl.mjs') })); },
  }],
});
// Every control of every bundled model has its own help text: the page never falls back to
// "Control documentation is not yet available".
{
  const help = await build({
    entryPoints: [join(ROOT, 'web/src/parameters.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'warning',
  });
  const { parameterHelp } = await import('data:text/javascript;base64,' + Buffer.from(help.outputFiles[0].contents).toString('base64'));
  const undocumented = bundled.flatMap(({ text }) => (JSON.parse(text.toString('utf8')).models ?? []).flatMap((m) =>
    parameterHelp(m).filter((h) => /not yet available/.test(h.description)).map((h) => `${m.name.trim()} ${h.label}`)));
  if (undocumented.length) {
    console.error(`web/build.mjs: controls without help in web/src/parameters.ts: ${undocumented.join(', ')}`);
    process.exit(1);
  }
}
// Preserve the last usable preview when an edit fails to compile.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'data/bases'), { recursive: true });
mkdirSync(join(OUT, 'data/packs'), { recursive: true });
for (const file of bundle.outputFiles) writeFileSync(file.path, file.contents);
const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
const appStyles = readFileSync(join(ROOT, 'web/styles.css'), 'utf8');
writeFileSync(join(OUT, 'index.html'), html.replace('<!-- app-styles -->', `<style>${appStyles}</style>`));
cpSync(join(ROOT, 'web/uw-samples.html'), join(OUT, 'uw-samples.html'));
cpSync(join(ROOT, 'COPYING'), join(OUT, 'COPYING.txt'));
// Sample metadata, and the sample files in catalog/uw/, served next to the page as uw-data/.
cpSync(join(ROOT, 'web/uw-assets.json'), join(OUT, 'data/uw-assets.json'));
if (existsSync(join(CATALOG, 'uw'))) cpSync(join(CATALOG, 'uw'), join(OUT, 'uw-data'), { recursive: true });
const bases = readdirSync(join(ROOT, 'bases')).filter((f) => f.endsWith('.json'));
for (const f of bases) cpSync(join(ROOT, 'bases', f), join(OUT, 'data/bases', f));
for (const { f, text } of bundled) writeFileSync(join(OUT, 'data/packs', f), text);
const commits = [...new Set(bundled.map((b) => b.pack.source?.commit).filter(Boolean))];
writeFileSync(join(OUT, 'data/index.json'), JSON.stringify({ bases, packs: bundled.map((b) => b.f), source: { commit: commits.length === 1 ? commits[0] : '' } }));
console.log(`web/dist: ${bases.length} base files, ${bundled.length} model packs from catalog/`);
