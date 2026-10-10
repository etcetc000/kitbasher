// The X.20 recipe (bases/x20.json, format md-recipe/1): a fixed patch for one exact OS file.
//
// X.20 is not a 1.63-lineage container the engine can discover: its loader streams a compressed
// payload through the DSPs and gets the ColdFire OS back, so the OS image exists only in RAM at boot.
// The recipe therefore names its OS file by SHA-256 and lists, for every place the build changes,
// the address and the bytes X.20 B has there (the anchor). The build (engine/src/x20.ts) accepts only
// the file whose hash the recipe names, so the anchors are checked offline, against a decoded X.20 B
// (engine/test/x20_recipe.test.ts, KB_X20_OS). Addresses, anchors and hashes only: the recipe holds no
// firmware bytes, and the build reads none it does not need from the user's own file (the loader's
// stage image and the E12B sample bank).

import { num } from './bytes.js';
import type { PiSlices } from './pi_clean.js';
import type { AuditSpec } from './x20_audit.js';

export const RECIPE_FORMAT = 'md-recipe/1';

type Hex = string;

/**
 * A value the build writes: a long or word expression, literal bytes, a jump or call to a routine of ours,
 * `moveq #n,d0`, n `nop`s, or a sequence of these.
 */
export type SiteValue = { u32: string } | { u16: string } | { hex: string } | { jmp: string } | { jsr: string } | { moveq: string }
  | { nop: number } | { parts: SiteValue[] };

export interface RecipeSite { group: string; at: Hex; old: string; new: SiteValue; what?: string }

export interface X20RecipeFile {
  format: string;
  id: string;
  name: string;
  about?: string;
  identify: { syx_sha256: string; container_bytes: number; stage_sha256: string };
  qualification: { level: 'hardware-proven' | 'emulator-gated'; by: string; unproven?: string };
  loader: {
    stage2: Hex; header: Hex; stage2_bytes: Hex; copy_longs_at: Hex; copy_longs: Hex; s2md: Hex;
    slot0_flash: Hex; payload_flash: Hex; handoff: { at: Hex; old: string; enter: Hex };
    dsp2_first_command: { at: Hex; old: string; what?: string };
  };
  ram: {
    os_image: [Hex, Hex]; boot_code: [Hex, Hex]; window: [Hex, Hex];
    menu: Hex; records: Hex; record_cap: number; stack_bottom: Hex;
    list: Hex; list_room: number; upload_buffer: [Hex, Hex];
    stock_list: { at: Hex; entries: number; entry_bytes: number };
    handler_table: { at: Hex; classes: number };
    menu_fields: { usr_list: Hex; usr_count: Hex; index_entries: Hex };
  };
  hooks: { VALID: Hex; FAM: Hex; CLS: Hex; GUARD: Hex; COPYLIST_READS: Hex; ERGUARD: { resume: Hex; context: Hex } };
  host: { dsp2: Hex; upload_vector: Hex };
  flash_alias: Hex;
  e12: { table: Hex; count: number; bank_end: Hex; pairs: [number, number][] };
  dsp2: {
    free: [Hex, Hex][];
    dispatch: { init: Hex; trigger: Hex; render: Hex; entries: number };
    dispatch_relocated: { init: Hex; trigger: Hex; render: Hex; entries: number };
    workspace: { base: Hex; slice: Hex };
    pi: { ids: number[]; inits: Hex[]; ws: Hex; slice: Hex; track: Hex };
    usr_bank_end: Hex;
    runtime: { abi: string; evidence: string };
    boot_loader: { about?: string; receiver: Hex; wiper: Hex; save: Hex; save_end: Hex; rdy: Hex };
  };
  ids: { usable: number[]; not_usable: Record<string, string>; forbidden?: [number, number][] };
  families: Record<string, number>;
  /** X.20 menu family by pack family ('*': the rest), and by model key prefix (wins over the pack's) */
  pack_menu?: Record<string, string>;
  key_menu?: Record<string, string>;
  /** the offline relocation audit's scope and allowlist (engine/src/x20_audit.ts) */
  audit?: AuditSpec & { about?: string };
  sites: RecipeSite[];
}

type Table = { init: number; trigger: number; render: number; entries: number };

/** The recipe with its numbers parsed. */
export interface X20Recipe {
  file: X20RecipeFile;
  id: string;
  name: string;
  loader: { stage2: number; header: number; stage2Bytes: number; copyLongsAt: number; copyLongs: number; s2md: number;
            slot0Flash: number; payloadFlash: number; handoff: { at: number; old: string; enter: number };
            dsp2First: { at: number; old: string } };
  ram: { osImage: [number, number]; bootCode: [number, number]; window: [number, number]; menu: number; records: number;
         recordCap: number; stackBottom: number; list: number; listRoom: number; uploadBuffer: [number, number];
         stockList: { at: number; entries: number; entryBytes: number }; handlerTable: { at: number; classes: number };
         menuFields: { usrList: number; usrCount: number; indexEntries: number } };
  hooks: { VALID: number; FAM: number; CLS: number; GUARD: number; COPYLIST_READS: number; erguard: { resume: number; context: number } };
  host: { dsp2: number; uploadVector: number };
  flashAlias: number;
  e12: { table: number; count: number; bankEnd: number; pairs: [number, number][] };
  dsp2: { free: [number, number][]; dispatch: Table; relocated: Table; workspace: { base: number; slice: number };
          pi: PiSlices; usrBankEnd: number; boot: { receiver: number; wiper: number; save: number; saveEnd: number; rdy: number } };
  usable: number[];
  families: Record<string, number>;
  sites: { group: string; at: number; old: Uint8Array; value: SiteValue; what: string }[];
}

const bytesOf = (hex: string): Uint8Array => {
  if (!/^([0-9a-f]{2})+$/.test(hex)) throw new Error(`recipe: "${hex}" is not hex bytes`);
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
};
const table = (t: X20RecipeFile['dsp2']['dispatch']): Table =>
  ({ init: num(t.init), trigger: num(t.trigger), render: num(t.render), entries: t.entries });

export function parseRecipe(f: X20RecipeFile): X20Recipe {
  if (f.format !== RECIPE_FORMAT) throw new Error(`recipe ${f.id}: format ${f.format}, expected ${RECIPE_FORMAT}`);
  const L = f.loader, R = f.ram, D = f.dsp2;
  const r: X20Recipe = {
    file: f, id: f.id, name: f.name,
    loader: { stage2: num(L.stage2), header: num(L.header), stage2Bytes: num(L.stage2_bytes), copyLongsAt: num(L.copy_longs_at),
      copyLongs: num(L.copy_longs), s2md: num(L.s2md), slot0Flash: num(L.slot0_flash), payloadFlash: num(L.payload_flash),
      handoff: { at: num(L.handoff.at), old: L.handoff.old, enter: num(L.handoff.enter) },
      dsp2First: { at: num(L.dsp2_first_command.at), old: L.dsp2_first_command.old } },
    ram: { osImage: [num(R.os_image[0]), num(R.os_image[1])], bootCode: [num(R.boot_code[0]), num(R.boot_code[1])],
      window: [num(R.window[0]), num(R.window[1])], menu: num(R.menu), records: num(R.records), recordCap: R.record_cap,
      stackBottom: num(R.stack_bottom), list: num(R.list), listRoom: R.list_room,
      uploadBuffer: [num(R.upload_buffer[0]), num(R.upload_buffer[1])],
      stockList: { at: num(R.stock_list.at), entries: R.stock_list.entries, entryBytes: R.stock_list.entry_bytes },
      handlerTable: { at: num(R.handler_table.at), classes: R.handler_table.classes },
      menuFields: { usrList: num(R.menu_fields.usr_list), usrCount: num(R.menu_fields.usr_count), indexEntries: num(R.menu_fields.index_entries) } },
    hooks: { VALID: num(f.hooks.VALID), FAM: num(f.hooks.FAM), CLS: num(f.hooks.CLS), GUARD: num(f.hooks.GUARD), COPYLIST_READS: num(f.hooks.COPYLIST_READS),
      erguard: { resume: num(f.hooks.ERGUARD.resume), context: num(f.hooks.ERGUARD.context) } },
    host: { dsp2: num(f.host.dsp2), uploadVector: num(f.host.upload_vector) },
    flashAlias: num(f.flash_alias),
    e12: { table: num(f.e12.table), count: f.e12.count, bankEnd: num(f.e12.bank_end), pairs: f.e12.pairs },
    dsp2: { free: D.free.map(([a, b]) => [num(a), num(b)] as [number, number]), dispatch: table(D.dispatch), relocated: table(D.dispatch_relocated),
      workspace: { base: num(D.workspace.base), slice: num(D.workspace.slice) },
      pi: { ids: D.pi.ids, inits: D.pi.inits.map(num), ws: num(D.pi.ws), slice: num(D.pi.slice), track: num(D.pi.track) },
      usrBankEnd: num(D.usr_bank_end),
      boot: { receiver: num(D.boot_loader.receiver), wiper: num(D.boot_loader.wiper), save: num(D.boot_loader.save),
        saveEnd: num(D.boot_loader.save_end), rdy: num(D.boot_loader.rdy) } },
    usable: [...f.ids.usable].sort((a, b) => a - b),
    families: f.families,
    sites: f.sites.map((s) => ({ group: s.group, at: num(s.at), old: bytesOf(s.old), value: s.new, what: s.what ?? s.group })),
  };
  checkRecipe(r);
  return r;
}

/** What must hold for any recipe the build can use; a recipe that breaks one is a recipe error. */
export function checkRecipe(r: X20Recipe): void {
  const bad = (m: string): never => { throw new Error(`recipe ${r.id}: ${m}`); };
  const [lo, hi] = r.ram.osImage;
  const seen = new Map<number, number>();
  for (const s of r.sites) {
    if (s.at < lo || s.at + s.old.length > hi) bad(`site 0x${s.at.toString(16)} is outside the OS image`);
    for (let k = 0; k < s.old.length; k++) {
      if (seen.has(s.at + k)) bad(`sites 0x${seen.get(s.at + k)!.toString(16)} and 0x${s.at.toString(16)} overlap`);
      seen.set(s.at + k, s.at);
    }
  }
  if (r.ram.records + r.ram.recordCap * 24 > r.ram.stackBottom) bad('the record table runs into the stack region');
  if (r.ram.menu + r.ram.menuFields.usrCount - r.ram.menuFields.indexEntries + r.ram.recordCap + 4 > r.ram.records) bad('the menu struct runs into the records');
  if (r.ram.recordCap > 0xff) bad('the menu frame keeps one byte per record below 0x100');
  if (r.ram.bootCode[0] !== r.loader.stage2 + r.loader.stage2Bytes) bad('the boot code must follow the loader');
  if (r.ram.window[0] < r.ram.bootCode[1] || r.ram.window[1] > r.ram.menu) bad('the window must lie between the boot code and the menu struct');
  for (const id of r.usable) if (!Number.isInteger(id) || id < 0 || id >= r.dsp2.relocated.entries) bad(`ID ${id} is outside the dispatch tables`);
  for (const id of r.dsp2.pi.ids) if (r.usable.includes(id)) bad(`P-I ID ${id} is listed as usable`);
  // X.20's user-machine IDs: a built-in machine on one of them freezes the OS when it is assigned
  for (const id of r.usable) if (!idAllowedOnX20(id)) bad(`ID ${id} is one X.20 reserves (96..123 MIDI/control machines: silent; 192 and up user machines: freezes the OS)`);
  for (const [lo, hi] of r.file.ids.forbidden ?? []) for (const id of r.usable) if (id >= lo && id <= hi) bad(`ID ${id} is in the recipe's forbidden range ${lo}..${hi}`);
  const B = r.dsp2.boot;
  if (B.saveEnd <= B.wiper) bad('the save area of the boot loader must follow its wiper');
  for (const [a, b] of r.dsp2.free) if (a < B.saveEnd && B.wiper < b) bad(`free region 0x${a.toString(16)}..0x${b.toString(16)} overlaps the boot loader (wiper and save area)`);
}

/**
 * Machine IDs X.20 B can never give an added machine: 96..123 are MIDI/control (no-audio) machines to
 * about 40 inline range tests in the OS (a model there plays nothing), and 192 and up belong to the user
 * machines (a built-in machine on 192 or 193 freezes the OS when assigned).
 */
export const idAllowedOnX20 = (id: number): boolean => id >= 0 && id <= 191 && !(id >= 96 && id <= 123);

/** The recipe whose OS file has this SHA-256, if any. */
export function recipeFor(recipes: X20RecipeFile[], sha256: string): X20RecipeFile | null {
  return recipes.find((f) => f.identify.syx_sha256 === sha256) ?? null;
}
