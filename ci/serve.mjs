// Serve web/dist on 127.0.0.1 without sample downloads: node ci/serve.mjs [port] (after npm run build)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'web/dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json' };
const port = Number(process.argv[2] ?? 8123);
createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!p.startsWith(DIST) || !existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(p));
}).listen(port, '127.0.0.1', () => console.log(`serving web/dist at http://127.0.0.1:${port}/`));
