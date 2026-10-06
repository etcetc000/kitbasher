import type { PackModel } from '../../engine/src/packs.js';

// Original 3 x 5 pixel glyphs, drawn on the hardware's 128 x 64 grid.
// This is a UI reconstruction, not a framebuffer from a running firmware.
const glyphs: Record<string, string> = {
 A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',
 E:'111100110100111',F:'111100110100100',G:'011100101101011',H:'101101111101101',
 I:'111010010010111',J:'001001001101010',K:'101101110101101',L:'100100100100111',
 M:'101111111101101',N:'110101101101101',O:'010101101101010',P:'110101110100100',
 Q:'010101101111011',R:'110101110101101',S:'011100010001110',T:'111010010010010',
 U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',
 Y:'101101010010010',Z:'111001010100111',
 '0':'111101101101111','1':'010110010010111','2':'110001010100111',
 '3':'110001010001110','4':'101101111001001','5':'111100110001110',
 '6':'011100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001110',
 '-':'000000111000000','.':'000000000000010',':':'000010000010000','/':'001001010100100',' ':'000000000000000',
 '+':'000010111010000','!':'010010010000010','#':'101111101111101','$':'011110011110010',
 '%':'101001010100101','&':'010101010101011','(':'001010010010001',')':'100010010010100',
 '*':'000101010101000',';':'000010000010100','=':'000111000111000','?':'110001010000010',
 '[':'011010010010011',']':'110010010010110','_':'000000000000111',
};

/** The screen's colours, shared by every preview canvas and its CSS backdrop. */
export const LCD_PAPER = '#f27a3e', LCD_INK = '#2e0d06';

/** The MD shows a five-character machine name as XXX-XX. */
const mdName = (n: string): string => (n.includes('-') ? n : `${n.slice(0, 3)}-${n.slice(3, 5)}`).trim();

/**
 * Menu illustration in the style of the MD's EDIT KIT screen, using the actual category order and
 * model names. Not an emulator frame: layout and glyphs are an approximation.
 */
export function drawMenuLcd(canvas: HTMLCanvasElement, categories: { name: string; machines: string[] }[], selected: string | number, selectedMachine = 0): void {
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const ink = LCD_INK, paper = LCD_PAPER;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 128, 64);
  const text = (s: string, x: number, y: number) => {
    [...s.toUpperCase()].forEach((ch, i) => {
      const bits = glyphs[ch] ?? glyphs['?'];
      for (let j = 0; j < 15; j++) if (bits[j] === '1') ctx.fillRect(x + i * 4 + j % 3, y + Math.floor(j / 3), 1, 1);
    });
  };
  const dither = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if ((xx + yy) % 2 === 0) ctx.fillRect(xx, yy, 1, 1);
  };
  const box = (x: number, y: number, w: number, h: number) => {
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  };
  /** A label sitting in a gap of a box's top edge; inverted labels get a solid block. */
  const header = (label: string, x: number, y: number, inverted: boolean) => {
    const w = label.length * 4 + 3;
    ctx.fillStyle = inverted ? ink : paper;
    ctx.fillRect(x, y - 3, w, 7);
    ctx.fillStyle = inverted ? paper : ink;
    text(label, x + 2, y - 2);
    ctx.fillStyle = ink;
  };
  /** One list row: inverted when chosen. */
  const row = (label: string, x: number, y: number, w: number, active: boolean) => {
    if (active) { ctx.fillStyle = ink; ctx.fillRect(x, y - 1, w, 7); }
    ctx.fillStyle = active ? paper : ink;
    text(label, x + 2, y);
    ctx.fillStyle = ink;
  };

  ctx.fillStyle = ink;
  // Frame: a dithered band inside a single rule, with the title tab on top.
  box(0, 0, 128, 64);
  dither(1, 1, 126, 2); dither(1, 61, 126, 2); dither(1, 3, 2, 58); dither(125, 3, 2, 58);
  box(3, 3, 122, 58);
  dither(4, 4, 120, 6);
  ctx.fillStyle = paper; ctx.fillRect(43, 3, 42, 8); ctx.fillStyle = ink;
  ctx.fillRect(44, 4, 40, 7);
  ctx.fillStyle = paper; text('EDIT KIT', 48, 5); ctx.fillStyle = ink;
  ctx.fillRect(3, 10, 122, 1);

  const at = typeof selected === 'number' ? selected : categories.findIndex(c => c.name === selected);
  const machines = categories[at]?.machines ?? [];
  const current = machines[selectedMachine];
  text(`POS:01-BD (${current ? mdName(current) : '------'}) ---`, 6, 13);

  const top = 23, h = 37, rows = 4;
  // Category column.
  box(6, top, 30, h);
  header('TYPE', 8, top, true);
  const cStart = Math.max(0, Math.min(at - 1, categories.length - rows));
  categories.slice(cStart, cStart + rows).forEach((c, i) => row(c.name.slice(0, 4), 8, top + 5 + i * 8, 26, i + cStart === at));
  // Machine column.
  box(39, top, 45, h);
  header('MACHINE', 41, top, false);
  const mStart = Math.max(0, Math.min(selectedMachine - 1, machines.length - rows));
  machines.slice(mStart, mStart + rows).forEach((n, i) => row(mdName(n), 41, top + 5 + i * 8, 41, i + mStart === selectedMachine));
  if (!machines.length) text('EMPTY', 50, top + 15);
  if (mStart + rows < machines.length) { ctx.fillRect(80, top + h - 4, 1, 1); ctx.fillRect(79, top + h - 5, 3, 1); }
  // Relate column, as on the hardware page.
  box(87, top, 36, h);
  header('RELATE', 89, top, false);
  text('MUTE POS', 89, top + 5); text('-', 104, top + 13);
  text('TRIG POS', 89, top + 21); text('-', 104, top + 29);
}

export function drawLcd(canvas: HTMLCanvasElement, model: PackModel): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = 128; canvas.height = 64;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 128, 64);
  const ink = LCD_INK;
  ctx.fillStyle = ink;
  const pixel = (x: number, y: number) => ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  const text = (s: string, x: number, y: number, scale = 1) => {
    [...s.toUpperCase()].forEach((ch, i) => {
      const bits = glyphs[ch] || glyphs[' '];
      for (let j = 0; j < 15; j++) if (bits[j] === '1') ctx.fillRect(x + i * 4 * scale + j % 3 * scale, y + Math.floor(j / 3) * scale, scale, scale);
    });
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1-x0), Math.abs(y1-y0));
    for (let i=0;i<=n;i++) pixel(x0+(x1-x0)*i/(n||1), y0+(y1-y0)*i/(n||1));
  };
    // Tempo / transport, level, kit, pattern and track occupy the left 48 pixels.
    text('120',1,3,2);pixel(24,12);text('0',26,8);
    for(let i=0;i<4;i++){ctx.fillRect(2+i*7,16,5,3);ctx.clearRect(3+i*7,17,3,1);}
    ctx.fillRect(24,23,4,4);line(31,0,31,30);text('LEV',34,2);
    for(let i=0;i<7;i++){pixel(34,10+i*3);pixel(45,10+i*3);}
    ctx.fillRect(38,15,5,14);
    ctx.fillRect(0,32,47,15);ctx.fillStyle=LCD_PAPER;text('KIT:01',11,34);text('PREVIEW',9,41);ctx.fillStyle=ink;
    line(2,49,5,52);line(5,52,2,55);text('A01',9,49);
    ctx.fillRect(0,57,47,7);ctx.fillStyle=LCD_PAPER;text(`01:${model.name.trim()}`,2,58);ctx.fillStyle=ink;
    line(47,0,47,63);
    for(let x=49;x<128;x+=2){pixel(x,10);pixel(x,32);pixel(x,42);}
    for(let x=68;x<128;x+=20)for(let y=0;y<64;y+=2)pixel(x,y);
    model.labels.forEach((label,i)=>{
      const col=i%4,row=Math.floor(i/4), cx=58+col*20, cy=20+row*32;
      if(!label) return;
      text(label.slice(0,4),cx-label.slice(0,4).length*2,3+row*32);
      // A one-pixel bitmap outline, not a thick distance-field ring. Leave clear
      // pixels between the dial, its pointer, labels and neighbouring cells.
      const dial = ['...#####...', '..#.....#..', '.#.......#.', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '.#.......#.', '..#.....#..', '...#####...'];
      dial.forEach((row, y) => [...row].forEach((bit, x) => { if (bit === '#') pixel(cx+x-5,cy+y-5); }));
      const angle=(-225+model.defaults[i]/127*270)*Math.PI/180;
      line(cx,cy,Math.round(cx+Math.cos(angle)*3),Math.round(cy+Math.sin(angle)*3));
    });
  canvas.setAttribute('aria-label', `${model.name.trim()} synthesis screen preview.`);
}
