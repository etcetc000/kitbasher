"""Serve the built site (web/dist) on 127.0.0.1 for development. Never sends MIDI.

--pack-dir  serve every md-pack/1 file in this directory as the catalog, in place of the
            packs bundled from catalog/
--uw-dir    directory of user-wave sample SysEx files. Samples listed in web/uw-assets.json,
            or declared by the --pack-dir packs, are checked and offered as downloads.
--reload    rebuild the site when a source file changes and refresh open pages
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'packs'))
from uw_asset import inspect


def bundled_assets(catalog, uw_dir):
    """Samples from the bundled catalog that exist in uw_dir and match their recorded hash."""
    routes = {}
    for entry in catalog['assets']:
        name = entry['file']
        if Path(name).name != name or '/' in name or '\\' in name:
            raise ValueError('asset filename must be a basename')
        path = (uw_dir / name).resolve()
        if not path.is_relative_to(uw_dir.resolve()):
            raise ValueError('asset must remain in the sample directory')
        if not path.is_file():
            print(f'{name}: not in {uw_dir}; its download is unavailable', flush=True)
            continue
        raw = path.read_bytes()
        receipt = inspect(raw)
        for field in ('sha256', 'bytes', 'name', 'displayed_slot'):
            if receipt[field] != entry[field]:
                raise ValueError(f'{name}: {field} does not match web/uw-assets.json')
        routes['/uw-data/' + name] = raw
    return routes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8767)
    ap.add_argument('--uw-dir', type=Path)
    ap.add_argument('--site', type=Path, default=ROOT / 'web' / 'dist')
    ap.add_argument('--pack-dir', type=Path)
    ap.add_argument('--reload', action='store_true', help='rebuild on source edits and refresh open pages')
    ap.add_argument('--node', default='node', help='Node executable for the rebuilds')
    args = ap.parse_args()
    dist = args.site.resolve()
    live = None
    if args.reload:
        if dist != (ROOT / 'web' / 'dist').resolve():
            ap.error('--reload rebuilds web/dist; it cannot be combined with --site')
        from live_reload import LiveReload
        live = LiveReload(ROOT, dist, args.node)
    if args.uw_dir is None and (ROOT / 'catalog' / 'uw').is_dir():
        args.uw_dir = ROOT / 'catalog' / 'uw'
    catalog = json.loads((dist / 'data' / 'uw-assets.json').read_text(encoding='utf-8'))
    routes = {}
    if args.pack_dir:
        from local_catalog import load_catalog
        index, catalog, routes = load_catalog(args.pack_dir, args.uw_dir)
        bundled_index = json.loads((dist / 'data' / 'index.json').read_text(encoding='utf-8'))
        routes['/data/index.json'] = json.dumps({**bundled_index, **index}).encode()
        routes['/data/uw-assets.json'] = json.dumps(catalog).encode()
        print(f'Packs: {len(index["packs"])} from {args.pack_dir}', flush=True)
    elif args.uw_dir:
        routes = bundled_assets(catalog, args.uw_dir)

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if live and path in ('/__dev/reload', '/', '/index.html'):
                raw = (json.dumps(live.state) if path == '/__dev/reload'
                       else live.inject((dist / 'index.html').read_text(encoding='utf-8'))).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json' if path == '/__dev/reload' else 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            if path in routes:
                raw = routes[path]
                self.send_response(200)
                self.send_header('Content-Type', 'application/json' if path.endswith('.json') else 'application/octet-stream')
                self.send_header('Content-Length', str(len(raw)))
                if path.startswith('/uw-data/'):
                    self.send_header('Content-Disposition', f'attachment; filename="{path.rsplit("/", 1)[-1]}"')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(raw)
                return
            if path.startswith('/uw-data/'):
                self.send_error(404)
                return
            super().do_GET()

        def end_headers(self):
            if live:
                self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            super().end_headers()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(dist)))
    samples = sum(r.startswith('/uw-data/') for r in routes)
    print(f'Kitbasher: http://127.0.0.1:{server.server_port} ({samples} sample download(s))', flush=True)
    if live:
        live.thread.start()
        print('Live reload on: style edits keep the current selection, other edits reload the page.', flush=True)
    try:
        server.serve_forever()
    finally:
        if live:
            live.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
