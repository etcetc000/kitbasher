#!/usr/bin/env node
// Kitbasher command line: patch a Machinedrum OS with machines from model packs.
//
//   node engine/dist/src/cli.js --in <base .syx | 8 MiB .bin> --out <file> (--uw | --no-uw) [options]
//
//   --uw | --no-uw       required, exactly one: whether the Machinedrum has the UW option. Nothing is
//                        built without it, and a restored layout's answer does not stand in for it
//   --bases <dir>        base profiles (default: bases/)
//   --catalog <dir>      use only this complete catalog; no other pack directory is read
//   --packs <dir>        add a pack directory (repeatable). Also read when they exist: catalog/
//                        and the local pack directory (MD_PACKS, default ~/Documents/kitbasher-packs)
//   --allow-id-move      a machine whose preferred ID is taken takes the next free one (default:
//                        an error, since saved kits find machines by ID); every move is reported
//   --families DF,MM     only these families (default: every pack)
//   --exclude MOD,..     leave out the machines with these module names
//   --trim-db <dB>       E12 trim threshold, dB re the sample's peak (default -30)
//   --trim-min <s>       only samples at least this long are trimmed (default 0.5)
//   --trim-cap <s>       and cut to at most this long (default 0.55; 0 = no cap)
//   --report <file>      write the build report as JSON
//   --gate-report <file> write the compact report the emulator gates read
//   --no-dyn-labels      static knob labels even where the base supports dynamic ones
//   --no-dsp1            no DSP1 drive even where the base supports it
//   --ctr-control-all    narrow the one gate that keeps FUNC + knob (control all) from reaching a
//                        machine on 124..127 (engine/src/ctr_controlall.ts); included by --clean-recovery
//   --desc-flash <m>     auto (default) | all | none | NAME,NAME: descriptors in OS-area flash
//   --dyn-flash NAME,..  those machines' label blocks in flash
//   --dsp1-id-space <n>  DSP1 transport ID table size (default 0xc0)
//   --dsp1-watchdog <n>  debug option, off by default and not in the browser UI: raise DSP1's DMA0
//                        overrun watchdog from 3 consecutive missed frames to <n> (3..63), so a machine
//                        that costs too much glitches through up to n-1 late blocks instead of halting
//                        DSP1 until the unit is power-cycled. It does not make the workload fit: a
//                        sustained overrun still halts, n blocks later. Rewrites one immediate in the
//                        DSP1 upload (engine/src/watchdog.ts)
//   --no-stub-trim       keep the base's DSP2 silence stub. By default its pad is cut from 50 passes to 1
//                        (one DSP2 word, about 460 cycles back per idle track per block; engine/src/stub_trim.ts)
//   --clean-recovery     ordered recovery, output pacing, emergency voice retirement, CPU! indicator
//                        and the control-all fix. Overload can cut sounding voices; later triggers
//                        start cleanly
//   --dsp1-recover       DSP1's DMA0 overrun watchdog mutes and recovers instead of halting: from the
//                        first missed frame it zeroes both halves of DSP1's output double buffer
//                        (X:$400..$57f), so the codec gets silence instead of the saturated output
//                        repeated accumulation produces, and it raises DSP1's host flags HF3 (muted
//                        now) and HF2 (has happened) for the ColdFire. It never halts and touches no
//                        DMA register. One word of the base changes: the DMA0 vector's target
//                        (engine/src/recover.ts). Off by default
//   --no-dsp1-recover    turn it off: the base's own halting watchdog, unchanged
//   --cpu-indicator      with --dsp1-recover: while overruns continue, the transport icons are
//                        replaced by an inverted "CPU!" box (a corner block on other screens),
//                        held ~0.5 s after the last one; polled on Timer 1 and drawn through the
//                        OS's own LCD flush (engine/src/indicator.ts). Off by default
//   --no-cpu-indicator   turn it off
//   --host-reorder       put a reordered copy of the OS's DSP2 two-word host-command sender in the RAM
//                        image and point every reference to the stock one at it: the CVR write (HC |
//                        HV=$09) moves after the command's second word, so DSP2's HV=$09 handler at
//                        P:$e8..$f3 no longer spins on HSR RXDF waiting for the ColdFire. No DSP2 word
//                        changes and the DSP1 half of the sender is untouched (engine/src/coldfire.ts)
//   --no-host-reorder    turn it off: the stock sender, unchanged
//   --cache-align        put every machine whose executed code can outgrow the 8-sector instruction
//                        cache on one of its measured 128-word cache offsets (engine/src/align.ts).
//                        On by default; --no-align gives plain first-fit placement, which the parity
//                        tests compare against
//   --no-align           turn it off
//   --no-uw              the Machinedrum has no UW option: no machine on IDs 128 and up (a restored ID
//                        there moves to the lowest free ID below 128, reported); models that play a UW
//                        sample are left out, and named. Recorded in the embedded layout
//   --uw                 the Machinedrum has the UW option. Recorded in the embedded layout
//   --restore <file>     keep the machine IDs of a previous session: a project file (.kitbasher.json), a
//                        layout file, or a .syx/.bin Kitbasher built (its layout table, or else its
//                        descriptor table matched to the catalog). Same as --map for a layout file
//   --family-menus       menu categories by pack family in pack order (the layout the parity tests
//                        use) instead of the sound categories (KIK, SNR, HAT, ...)
//   --map <file>         the user's layout (md-layout/1: IDs and menu categories); the build honours
//                        it and embeds it in the OS, so a patched OS can be re-patched with it
//   --write-map <file>   write the layout this build has (the map merged with every placement)
//   --read-map <file>    print the layout a patched OS carries (with --in only) and write it to --out
//   --prepare-163        with --in <stock 1.63> --out <file>: make the prepared 1.63 base (once, offline;
//                        engine/src/prepare.ts), and print its recipe
//   --discover <file>    what discovery finds in a base, feature by feature (no build; --report writes it as JSON)
//
// The output has the input's shape: a .syx for a .syx, a flash image for a flash image.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotPatchable, resolveBase, supportLine } from './bases.js';
import { build, uwFromFlags } from './build.js';
import { readFirmware } from './container.js';
import { loadBases, loadPacks, LOCAL_PACKS } from './node.js';
import { findLayout, fingerprint, parseLayout } from './layout.js';
import { needsUwSamples } from './packs.js';
import { select } from './selection.js';
import { recoverSession } from './restore.js';
import { decodeProject } from './project.js';
import { containerOf, encodeSyx } from './syx.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SWITCHES = new Set(['no-dyn-labels', 'no-dsp1', 'no-align', 'family-menus', 'cache-align', 'host-reorder', 'no-host-reorder',
                          'clean-recovery', 'dsp1-recover', 'no-dsp1-recover', 'cpu-indicator', 'no-cpu-indicator',
                          'allow-id-move', 'prepare-163', 'ctr-control-all', 'no-stub-trim', 'no-uw', 'uw']);
const REPEATABLE = new Set(['packs']);

function args(argv: string[]): { a: Record<string, string>; many: Record<string, string[]> } {
  const out: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const k = argv[i].slice(2);
    if (SWITCHES.has(k)) { out[k] = '1'; continue; }
    if (REPEATABLE.has(k)) (many[k] ??= []).push(argv[i + 1]);
    else out[k] = argv[i + 1];
    i++;
  }
  return { a: out, many };
}

async function main(): Promise<void> {
  const { a, many } = args(process.argv.slice(2));
  if (a['read-map']) {
    const got = findLayout(readFirmware(readFileSync(a['read-map'])));
    if (!got) { console.error(`${a['read-map']}: carries no layout table`); process.exit(1); }
    console.log(`layout table at 0x${got.at.toString(16)}: base ${got.layout.base}, ${got.layout.categories.length} categories, ` +
                `${Object.keys(got.layout.machines).length} machines, fingerprint ${await fingerprint(got.layout)}`);
    if (a.out) writeFileSync(a.out, JSON.stringify(got.layout, null, 1));
    return;
  }
  if (a['prepare-163']) {
    const { prepare163 } = await import('./prepare.js');
    const r = await prepare163(readFileSync(a.in));
    // a flash image in, a .syx wanted: the container it carries
    const out = r.kind === 'flash' && a.out.toLowerCase().endsWith('.syx') ? encodeSyx(containerOf(r.output)) : r.output;
    writeFileSync(a.out, out);
    for (const [k, v] of Object.entries(r.recipe)) console.log(`  ${k}: ${v}`);
    console.log(`wrote ${a.out} (${r.kind})`);
    return;
  }
  if (a.discover) {
    const fw = readFirmware(readFileSync(a.discover));
    const set = loadBases(a.bases ?? resolve(ROOT, 'bases'));
    let r;
    try { r = await resolveBase(fw, set); } catch (e) {
      const d = (e as NotPatchable).discovery;
      for (const f of d?.findings ?? []) console.log(`  ${f.ok ? 'found' : 'NOT FOUND'}  ${f.what}: ${f.detail}`);
      console.error(`not patchable: ${(e as Error).message}`);
      if (a.report && d) writeFileSync(a.report, JSON.stringify({ refused: (e as Error).message, findings: d.findings, values: d.values }, null, 1));
      process.exit(1);
    }
    console.log(`base: ${r.base.name} [${r.base.qualification.level}: ${r.base.qualification.by}]`);
    for (const f of r.discovery.findings) console.log(`  ${f.ok ? 'found' : 'NOT FOUND'}  ${f.what}: ${f.detail}`);
    for (const [k, v] of Object.entries(r.discovery.support)) console.log(`  ${supportLine(k, v)}`);
    for (const d of r.disagreements) console.log(`  CACHE DISAGREES (discovery wins): ${d}`);
    if (a.report) writeFileSync(a.report, JSON.stringify({ base: r.base.id, qualification: r.base.qualification, support: r.discovery.support,
      model_runtime:r.base.modelRuntime, findings: r.discovery.findings, values: r.discovery.values, disagreements: r.disagreements }, null, 1));
    return;
  }
  if (!a.in || !a.out) {
    console.error('usage: cli.js --in <base> --out <file> (--uw | --no-uw) [--families ..] [--exclude ..] [--trim-db ..] [--trim-min ..] [--trim-cap ..] [--report ..]');
    process.exit(2);
  }
  // the UW answer is required before anything is read (a restored layout's answer, below, only reported)
  const uw = uwFromFlags({ uw: !!a.uw, noUw: !!a['no-uw'] });
  const bases = loadBases(a.bases ?? resolve(ROOT, 'bases'));
  if (a.catalog && many.packs?.length) throw new Error('--catalog selects a complete set; do not combine it with --packs');
  const { packs, core, dirs } = loadPacks(a.catalog ? [resolve(a.catalog)] :
    [resolve(ROOT, 'catalog'), LOCAL_PACKS, ...(many.packs ?? []).map((d) => resolve(d))]);
  console.log(`packs: ${packs.length} from ${dirs.join(', ')}`);
  const input = readFileSync(a.in);
  const { base, disagreements } = await resolveBase(readFirmware(input), bases);
  console.log(`base: ${base.name} [${base.qualification.level}]`);
  for (const d of disagreements) console.log(`  CACHE DISAGREES (discovery wins): ${d}`);
  for (const [k, v] of Object.entries(base.support)) if (!v.ok) console.log(`  not supported on this base: ${supportLine(k, v)}`);
  const cap = a['trim-cap'] === undefined ? 0.55 : Number(a['trim-cap']);
  const all = select(packs, {}).fams.flatMap((f) => f.models);
  // the session whose IDs to keep
  let layout = a.map ? parseLayout(readFileSync(a.map, 'utf8')) : undefined;
  if (a.restore) {
    const bytes = readFileSync(a.restore);
    if (/\.(syx|bin)$/i.test(a.restore)) {
      const r = recoverSession(readFirmware(bytes), all, base.os.descriptorTable);
      if (!r) throw new Error(`${a.restore}: not an OS Kitbasher built (no layout table, no added machines found)`);
      layout = { ...r.layout, base: r.layout.base || base.id };
      console.log(`restored from ${a.restore} (${r.how === 'table' ? 'its layout table' : 'its descriptor table'}): ${Object.keys(layout.machines).length} machines` +
        (r.unknown.length ? `; not in this catalog: ${r.unknown.map((u) => `${u.name} on ${u.id}`).join(', ')}` : ''));
    } else {
      const text = bytes.toString('utf8');
      layout = JSON.parse(text).format === 'kitbasher-project/1' ? (await decodeProject(text)).layout ?? undefined : parseLayout(text);
    }
  }
  let allowIdMove = !!a['allow-id-move'];
  // a session made on another base: rebased onto this one; machines whose ID this base uses move
  if (layout && layout.base && layout.base !== base.id) {
    console.log(`the restored session was made for ${layout.base}: applied to ${base.name}; any machine whose ID it uses moves (listed below)`);
    layout = { ...layout, base: base.id };
    allowIdMove = true;
  }
  // the session's UW answer is reported, never used: the flag is the answer
  if (layout?.uw !== undefined) {
    console.log(`the restored session was made for a Machinedrum ${layout.uw ? 'with' : 'without'} UW; building for one ${uw ? 'with' : 'without'} UW (${uw ? '--uw' : '--no-uw'})` +
      (layout.uw !== uw ? ': the IDs follow your answer' : ''));
  }
  // without UW, models that play a UW sample cannot work: leave them out, and say so
  let exclude = a.exclude ? a.exclude.split(',') : undefined;
  if (uw === false) {
    const want = new Set(a.families ? a.families.split(',') : select(packs, {}).fams.map((f) => f.name));
    const out = select(packs, {}).fams.filter((f) => want.has(f.name)).flatMap((f) => f.models).filter(needsUwSamples)
      .filter((m) => !(exclude ?? []).includes(m.module));
    if (out.length) { console.log(`left out (they play UW samples, which a Machinedrum without UW does not have): ${out.map((m) => m.name.trim()).join(', ')}`); exclude = [...(exclude ?? []), ...out.map((m) => m.module)]; }
  }
  const { output, report, gateReport } = await build(input, base, packs, core, {
    allowIdMove,
    uw,
    ctrControlAll: !!a['ctr-control-all'] || !!a['clean-recovery'],
    layout,
    align: a['no-align'] ? false : a['cache-align'] ? true : undefined,
    menus: a['family-menus'] ? 'family' : undefined,
    families: a.families === 'none' ? [] : a.families ? a.families.split(',') : undefined,
    exclude,
    trim: { db: Number(a['trim-db'] ?? -30), minSeconds: Number(a['trim-min'] ?? 0.5), cap: cap || null },
    stubTrim: a['no-stub-trim'] ? false : undefined,
    dsp1Watchdog: a['dsp1-watchdog'] === undefined ? undefined : Number(a['dsp1-watchdog']),
    features: {
      cleanRecovery:!!a['clean-recovery'],
      dynLabels: a['no-dyn-labels'] ? false : undefined,
      dsp1Drive: a['no-dsp1'] ? false : undefined,
      hostReorder: a['no-host-reorder'] ? false : a['host-reorder'] ? true : undefined,
      descFlash: !a['desc-flash'] ? undefined : ['auto', 'all', 'none'].includes(a['desc-flash'])
        ? a['desc-flash'] as 'auto' | 'all' | 'none' : a['desc-flash'].split(','),
      dynFlash: a['dyn-flash'] ? a['dyn-flash'].split(',') : undefined,
      dsp1IdSpace: a['dsp1-id-space'] ? Number(a['dsp1-id-space']) : undefined,
      dsp1Recover: a['no-dsp1-recover'] ? false : a['dsp1-recover'] ? true : undefined,
      cpuIndicator: a['no-cpu-indicator'] ? false : a['cpu-indicator'] ? true : undefined,
    },
  });
  writeFileSync(a.out, output);
  if (a['write-map']) {
    writeFileSync(a['write-map'], JSON.stringify(report.layout, null, 1));
  }
  console.log(`layout (${report.layout_custom ? 'your map' : 'default'}): fingerprint ${await fingerprint(report.layout)}, table at ${report.flash.layout_table} (${report.flash.layout_bytes} bytes)`);
  if (a.report) writeFileSync(a.report, JSON.stringify(report, null, 1));
  if (a['gate-report']) writeFileSync(a['gate-report'], JSON.stringify(gateReport, null, 1));
  console.log(`cache alignment: ${report.dsp2.aligned ? `${report.dsp2.aligned} machines on a measured 128-word offset, ` +
    `${report.dsp2.align_padding} words of padding` : 'off'}`);
  console.log(`${report.machines.length} machines; DSP2 ${report.dsp2.free_words} words free; ` +
              `RAM image ${report.ext.bytes} of ${report.ext.limit} bytes (${report.ext.free} free); OS flash headroom ${report.flash.headroom} bytes`);
  for (const m of report.id_moves) console.log(`  ID MOVED: ${m.name.trim()} ${m.preferred} -> ${m.id} (${m.why}); saved kits will not find it`);
  for (const n of report.needs) console.log(`  needs data: ${n}`);
  if (report.stub_trim) console.log(`silence stub: ${report.stub_trim.note}`);
  if (report.pi_clean) console.log(`P-I clean stub: ${report.pi_clean.words} words at ${report.pi_clean.org} for ${report.pi_clean.machines.join(', ')} (slice words ${report.pi_clean.span[0]}+${report.pi_clean.span[1]}), entered by the stock P-I IDs ${report.pi_clean.ids.join(', ')}`);
  const f = report.features;
  console.log(`dynamic labels: ${f.dyn_labels ? `${f.dyn_labels.bytes} bytes, ${f.dyn_labels.page_sites} page sites` : 'off'}; ` +
              `DSP1 drive: ${f.dsp1_drive ? `${f.dsp1_drive.machines} machines` : 'off'}; ` +
              `host-command reorder: ${f.host_reorder ? `${f.host_reorder.bytes} bytes at ${f.host_reorder.entry}, ${f.host_reorder.sites.length} sites` : 'off'}; ` +
              `descriptors in flash: ${f.desc_flash.length ? f.desc_flash.join(', ') : 'none'}`);
  for (const n of [...report.notes, ...f.notes]) console.log(`  note: ${n}`);
  for (const g of report.gates) console.log(`  gate ${g.name}: ${g.ok ? 'pass' : 'FAIL'}  ${g.detail}`);
  console.log(`wrote ${a.out}`);
}

main().catch((e: Error) => {
  const p = (e as Error & { plan?: { problems: string[] } }).plan;
  console.error(p ? ['error: the selection cannot be built:', ...p.problems.map((x) => `  - ${x}`)].join('\n') : `error: ${e.message}`);
  process.exit(1);
});
