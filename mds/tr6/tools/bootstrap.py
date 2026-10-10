"""Fetch exact public reference revisions; never update an existing dirty checkout."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'MDS': ('https://github.com/jmamma/MDS.git', 'c446179d6d73a82b117ee20eb2216af78734a795'),
    'Simple606': ('https://github.com/Fadedlimes/Simple606.git', '6aacda7a14a8c097d32836039fd356eb0976ba8e'),
}


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                          **kwargs)


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    evidence = {}
    for name, (url, revision) in PINS.items():
        destination = ROOT / '.audit-sources' / name
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            run(['git', 'clone', '--no-checkout', '--filter=blob:none', url, str(destination)])
            run(['git', '-C', str(destination), 'checkout', '--detach', revision])
        actual = run(['git', '-C', str(destination), 'rev-parse', 'HEAD']).stdout.strip()
        dirty = run(['git', '-C', str(destination), 'status', '--porcelain', '--untracked-files=no']).stdout
        remote = run(['git', '-C', str(destination), 'remote', 'get-url', 'origin']).stdout.strip()
        if actual != revision or dirty or remote != url:
            raise RuntimeError(f'{destination}: expected clean {url} at {revision}; left unchanged')
        evidence[name] = dict(url=url, revision=actual)
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
