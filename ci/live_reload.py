"""Development-only rebuild watcher and browser reload client."""
import hashlib
import json
import os
import re
import subprocess
import threading
import time


def source_snapshot(root):
    files = {root / name for name in (
        'web/index.html', 'web/styles.css', 'web/uw-samples.html', 'web/build.mjs',
        'web/uw-assets.json')}
    for folder, pattern in (('web/src', '*.ts'), ('engine/src', '*.ts'),
                            ('bases', '*.json'), ('catalog', '*.json')):
        files.update((root / folder).rglob(pattern))
    result = {}
    for path in files:
        try:
            stat = path.stat()
            result[str(path)] = (stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            pass
    return result


def script_signature(site):
    """CSS-only changes can refresh styles without losing loaded firmware."""
    html = (site / 'index.html').read_text(encoding='utf-8')
    digest = hashlib.sha256(re.sub(r'<style>.*?</style>', '', html, flags=re.S).encode())
    for path in [site / 'app.js', *sorted((site / 'data').rglob('*'))]:
        if path.is_file():
            digest.update(str(path.relative_to(site)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


class LiveReload:
    def __init__(self, root, site, node):
        self.root, self.site, self.node = root, site, node
        self.state = {'version': time.time_ns(), 'script': script_signature(site)}
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.watch, daemon=True)

    def watch(self):
        previous = source_snapshot(self.root)
        while not self.stop.wait(0.5):
            current = source_snapshot(self.root)
            if current == previous:
                continue
            if self.stop.wait(0.2):
                return
            previous = source_snapshot(self.root)
            print('Source changed; rebuilding preview...', flush=True)
            try:
                result = subprocess.run(
                    [self.node, 'web/build.mjs'], cwd=self.root, timeout=120,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                if result.returncode == 0:
                    self.state = {'version': time.time_ns(), 'script': script_signature(self.site)}
                    print('Preview updated.', flush=True)
                else:
                    print('Build failed; browser stays on the last successful build.', flush=True)
            except (OSError, subprocess.TimeoutExpired) as error:
                print(f'Preview rebuild failed: {error}', flush=True)

    def inject(self, html):
        client = '''<script data-local-reload>
(() => {
  let state = STATE;
  async function poll() {
    try {
      const next = await (await fetch('/__dev/reload', {cache:'no-store'})).json();
      if (next.version !== state.version) {
        if (next.script !== state.script) { location.reload(); return; }
        const html = await (await fetch('/', {cache:'no-store'})).text();
        const style = new DOMParser().parseFromString(html, 'text/html').querySelector('style');
        if (style) document.querySelector('style').textContent = style.textContent;
        state = next;
      }
    } catch (_) { /* The server may be restarting. */ }
    setTimeout(poll, 1000);
  }
  setTimeout(poll, 1000);
})();
</script>'''.replace('STATE', json.dumps(self.state))
        return html.replace('</body>', client + '</body>')
