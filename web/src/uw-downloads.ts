import type { Pack, PackModel } from '../../engine/src/packs.js';

interface Asset {
  file: string; name: string; module: string; firmware_commit?: string;
  sha256: string; bytes: number; displayed_slot: number;
}
let catalog: Promise<Asset[]> | null = null;
const verified = new Map<string, Promise<string>>();

function assets(): Promise<Asset[]> {
  return catalog ??= fetch('data/uw-assets.json').then(async response => {
    if (!response.ok) throw new Error('Sample download catalog is unavailable.');
    const data = await response.json();
    if (data.format !== 'md-uw-downloads/1' || !Array.isArray(data.assets)) throw new Error('Invalid wavetable download catalog.');
    return data.assets;
  });
}

function download(a: Asset): Promise<string> {
  const key = `${a.file}:${a.sha256}`;
  if (!verified.has(key)) verified.set(key, (async () => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.syx$/.test(a.file) || !/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error('Invalid wavetable asset metadata.');
    const response = await fetch(`uw-data/${encodeURIComponent(a.file)}`);
    if (!response.ok) throw new Error(`${a.file} is not available on this server. Load the matching file from the model release.`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== a.bytes || hash !== a.sha256) throw new Error(`${a.file} failed verification; download withheld.`);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  })().catch(error => { verified.delete(key); throw error; }));
  return verified.get(key)!;
}

/** Links the sample asset each selected model declares it needs. An asset that names a
 *  firmware_commit only matches a pack exported from that commit. */
export function uwDownloads(models: PackModel[], packs: Pack[]): HTMLElement {
  const host = document.createElement('div');
  host.id = 'uw-downloads';
  const seen = new Set<string>();
  const wanted: { model: PackModel; need: NonNullable<PackModel['needs']>[number] }[] = [];
  for (const model of models) for (const need of model.needs ?? []) {
    const identity = `${model.module}:${need.name}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    wanted.push({ model, need });
  }
  if (!wanted.length) return host;
  const pending = document.createElement('p');
  pending.textContent = 'Preparing sample downloads…';
  host.append(pending);
  void (async () => {
    // Several models can read the same sample file (WAVCH and WAVMR share the wave bank):
    // offer each file once and name every model that uses it.
    const byFile = new Map<string, { asset: Asset; users: string[] }>();
    const problems: string[] = [];
    try {
      const list = await assets();
      for (const { model, need } of wanted) {
        const file = need.install?.file;
        const source = packs.find(p => p.models.some(m => m.key === model.key))?.source?.commit;
        // A need without an install filename is matched by model module and sample name; the
        // asset's sha256 is verified before anything is offered.
        const a = list.find(a => (!file || a.file === file) && a.name === need.name && a.module === model.module
          && (!a.firmware_commit || !source || a.firmware_commit === source));
        if (!a) { problems.push(`No matching ${file ?? need.name} download is configured for ${model.name.trim()}. Use the matching model release.`); continue; }
        const key = `${a.file}:${a.sha256}`;
        const entry = byFile.get(key) ?? { asset: a, users: [] };
        entry.users.push(model.name.trim());
        byFile.set(key, entry);
      }
    } catch (error) {
      problems.push((error as Error).message);
    }
    const rows: HTMLElement[] = [];
    for (const { asset: a, users } of byFile.values()) {
      const row = document.createElement('p');
      rows.push(row);
      try {
        const link = document.createElement('a');
        link.className = 'uw-download';
        link.href = await download(a);
        link.download = a.file;
        link.textContent = `Download ${a.name} sample SysEx`;
        const note = document.createElement('span');
        note.className = 'fine';
        note.textContent = ` ${a.file} · UW slot ${a.displayed_slot} · used by ${users.join(' and ')}. Loading it replaces any sample in that slot.`;
        row.replaceChildren(link, document.createElement('br'), note);
      } catch (error) {
        row.textContent = (error as Error).message;
        row.setAttribute('role', 'status');
      }
    }
    for (const text of problems) {
      const row = document.createElement('p');
      row.textContent = text;
      row.setAttribute('role', 'status');
      rows.push(row);
    }
    pending.replaceWith(...rows);
  })();
  return host;
}
