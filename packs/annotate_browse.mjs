// Write copies of model packs that carry their own browsing data (PackModel.browse): the page's
// category and description for each model and help for each control. A pack with this data sorts
// and explains itself on any copy of the page, including one whose built-in catalog has never heard
// of its models; without it, an unknown model lands in "Other models" (menu OTH) with generic help.
//
//   npx tsc -p engine && node packs/annotate_browse.mjs <pack.json | dir>... --out <dir>
//
// The data comes from this checkout's catalog (engine/src/sound_catalog.ts, web/src/parameters.ts),
// so describe your models there first. Inputs are never modified.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--out');
if (at < 0 || !args[at + 1]) throw new Error('Use: annotate_browse.mjs <pack.json | dir>... --out <dir>');
const out = resolve(args[at + 1]);
const inputs = args.filter((_, i) => i !== at && i !== at + 1).flatMap((p) =>
  statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)) : [p]);
if (!inputs.length) throw new Error('no pack files given');
if (inputs.some((f) => resolve(dirname(f)) === out)) throw new Error('--out must differ from the input directory');

const catalogFile = join(root, 'engine/dist/src/sound_catalog.js');
if (!existsSync(catalogFile)) throw new Error('build the engine first (npx tsc -p engine)');
const { describe, isCategory, OTHER } = await import(pathToFileURL(catalogFile).href);
const bundled = await build({ entryPoints: [join(root, 'web/src/parameters.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'warning' });
const { parameterHelp } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].contents).toString('base64'));

mkdirSync(out, { recursive: true });
for (const file of inputs) {
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  if (pack.format !== 'md-pack/1' || !Array.isArray(pack.models)) { console.log(`${basename(file)}: not a model pack, copied as is`); writeFileSync(join(out, basename(file)), JSON.stringify(pack)); continue; }
  const notes = [];
  for (const m of pack.models) {
    const { category, description } = describe(m.name);
    const help = Object.fromEntries(parameterHelp({ ...m, browse: undefined })
      .filter((h) => !/not yet available/.test(h.description)).map((h) => [h.label, [h.name, h.description]]));
    const missing = m.labels.filter((l) => l && l !== '--' && !help[l]);
    m.browse = { ...(isCategory(category) ? { category, description } : {}), help };
    if (category === OTHER) notes.push(`${m.name.trim()}: no catalog entry`);
    if (missing.length) notes.push(`${m.name.trim()}: no help for ${missing.join(' ')}`);
  }
  writeFileSync(join(out, basename(file)), JSON.stringify(pack));
  console.log(`${basename(file)}: ${pack.models.length} models annotated${notes.length ? ` (${notes.join('; ')})` : ''}`);
}
