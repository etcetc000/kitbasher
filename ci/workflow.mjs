// Development entry point behind the npm scripts:
//
//   doctor      check Node, dependencies, Python and optional local paths
//   typecheck   strict TypeScript for engine/ and web/
//   unit        typecheck, then the Node and Python unit suites (npm test)
//   build       typecheck, then bundle the site into web/dist
//   check       typecheck, unit suites and build: the full gate CI runs
//   assembly    instruction-encoding tests; needs the native assembler
//   community-check  export examples/community, examples/analog, examples/physical and examples/effects and check
//               each pack holds exactly its model; needs the native assembler
//   ksstr       run PHYKS from catalog/ on the DSP instruction host against its integer model;
//               needs dspHost
//   ladder      run NFX4P from catalog/ on the DSP instruction host against its integer model;
//               needs dspHost
//   dev         build and serve the site on 127.0.0.1 with live reload: dev [PACK_DIR] [PORT]
//
// Child processes run with windowsHide so no console windows flash open on Windows.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, required, root, environment } from './local_config.mjs';

const command = process.argv[2] ?? 'check';
const c = config();
const env = environment(c);
const node = process.execPath;
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const started = performance.now();

function run(exe, args, options = {}) {
  console.log(`\n> ${exe === node ? 'node' : exe} ${args.join(' ')}`);
  const result = spawnSync(exe, args, { cwd: root, env, windowsHide: true, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${args.join(' ')}`);
}
const js = (...args) => run(node, args);

function python() {
  // Windows has no reliable `python` on PATH (the Store stub can block), so it must be named.
  const exe = c.python ?? (process.platform === 'win32' ? null : 'python3');
  if (!exe) throw new Error('Set python in .local/config.json or PYTHON to the Python executable; see CONTRIBUTING.md');
  return exe;
}

/** Every engine test is listed exactly once in ci/test_suites.json. */
function inventory() {
  const suites = JSON.parse(readFileSync(join(root, 'ci/test_suites.json')));
  const listed = Object.values(suites).flat().map(n => n + '.test.ts').sort();
  const actual = readdirSync(join(root, 'engine/test')).filter(n => n.endsWith('.test.ts')).sort();
  if (JSON.stringify(listed) !== JSON.stringify(actual)) throw new Error('Classify every engine test exactly once in ci/test_suites.json');
  return suites;
}

/** Every Python test is listed exactly once in ci/python_suites.json. */
function pythonInventory() {
  const suites = JSON.parse(readFileSync(join(root, 'ci/python_suites.json')));
  const listed = Object.values(suites).flat().map(n => n + '.py').sort();
  const actual = readdirSync(join(root, 'ci')).filter(n => n.endsWith('_test.py')).sort();
  if (JSON.stringify(listed) !== JSON.stringify(actual)) throw new Error('Classify every Python test exactly once in ci/python_suites.json');
  return suites;
}

function pythonTests(suite) {
  run(python(), ['-m', 'compileall', '-q', 'ci', 'packs']);
  run(python(), ['-m', 'unittest', ...pythonInventory()[suite]], { cwd: join(root, 'ci') });
}

function typecheck() {
  js(tsc, '-p', 'engine');
  js(tsc, '-p', 'web');
}

function unit() {
  const suites = inventory();
  const tooling = readdirSync(join(root, 'ci')).filter(n => n.endsWith('.test.mjs')).map(n => 'ci/' + n);
  js('--test', '--test-concurrency=4', ...tooling, ...suites.unit.map(n => `engine/dist/test/${n}.test.js`));
  pythonTests('unit');
}

function build() { js('web/build.mjs'); }

function dev(args) {
  const port = args.find(a => /^\d+$/.test(a)) ?? '8767';
  // The configured pack directory is used only when it exists; otherwise the bundled catalog/.
  const packs = args.find(a => !/^\d+$/.test(a)) ?? (c.packDir && existsSync(c.packDir) ? c.packDir : null);
  typecheck(); build();
  const serve = ['ci/serve_local.py', '--port', port, '--reload', '--node', node];
  if (packs) serve.push('--pack-dir', resolve(packs));
  if (c.uwAssets) serve.push('--uw-dir', c.uwAssets);
  run(python(), serve);
}

try {
  switch (command) {
    case 'doctor': {
      console.log(`Checkout: ${root}\nNode: ${process.version}`);
      if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or newer is required');
      if (!existsSync(tsc)) throw new Error('Dependencies missing: run npm ci');
      inventory();
      pythonInventory();
      run(python(), ['-c', "import sys; sys.path.insert(0, 'build/manifest-deps'); import jsonschema; print('Python:', sys.version.split()[0]); print('jsonschema: available')"]);
      for (const k of ['packDir', 'uwAssets', 'assembler', 'dspHost', 'firmwareDir'])
        console.log(`${k}: ${c[k] ? (existsSync(c[k]) ? c[k] : `${c[k]} (not found; optional)`) : 'not configured (optional)'}`);
      console.log('Ready for npm run check.');
      break;
    }
    case 'typecheck': typecheck(); break;
    case 'unit': typecheck(); unit(); break;
    case 'build': typecheck(); build(); break;
    case 'check': typecheck(); unit(); build(); break;
    case 'community-check': {
      required(c, ['assembler']);
      const out = join(root, 'build', `community-check-${Date.now()}`);
      run(python(), ['-B', 'ci/community_packages_check.py', '--assembler', c.assembler, '--out', out]);
      break;
    }
    case 'ksstr': {
      required(c, ['dspHost']);
      const out = join(root, 'build', `ksstr-check-${Date.now()}`);
      run(python(), ['-B', 'ci/ksstr_check.py', '--pack', 'catalog/physical-ks.json', '--host', c.dspHost, '--out', out]);
      break;
    }
    case 'ladder': {
      required(c, ['dspHost']);
      const out = join(root, 'build', `ladder-check-${Date.now()}`);
      run(python(), ['-B', 'ci/ladder_check.py', '--pack', 'catalog/effects-ladder.json', '--host', c.dspHost, '--out', out]);
      break;
    }
    case 'assembly':
      required(c, ['assembler']);
      pythonTests('assembly');
      break;
    case 'dev': dev(process.argv.slice(3)); break;
    default: throw new Error('Use doctor, typecheck, unit, build, check, assembly, community-check, ksstr, ladder or dev');
  }
  console.log(`\n${command}: PASS (${((performance.now() - started) / 1000).toFixed(1)} s)`);
} catch (e) { console.error(`\n${command}: FAIL: ${e.message}`); process.exitCode = 1; }
