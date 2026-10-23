#!/usr/bin/env python3
"""Prepare an untracked deployment directory while retaining the LIVE homepage.

Does not upload, deploy, alter the checkout, or copy credentials. Run only after
the Blob import passes check-gallery-media.cjs. Current Git index.html deliberately
retains the earlier 21-item catalogue; it must not overwrite a newer live page.
"""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://www.daryahandmade.shop'


class Dependencies(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get('src') if tag in {'script', 'img', 'video', 'audio', 'source', 'iframe'} else attrs.get('href') if tag == 'link' else None
        if value and not value.startswith(('data:', '#')):
            url = urllib.parse.urlsplit(urllib.parse.urljoin(ORIGIN + '/', value))
            if url.netloc == urllib.parse.urlsplit(ORIGIN).netloc:
                self.paths.add(urllib.parse.unquote(url.path))


def main():
    subprocess.run(['node', str(ROOT / 'scripts/check-gallery-media.cjs')], check=True)
    with urllib.request.urlopen(ORIGIN + '/', timeout=30) as response:
        if response.status != 200 or response.headers.get_content_type() != 'text/html':
            raise ValueError('The live homepage is unavailable')
        homepage = response.read(16 * 1024 * 1024 + 1)
    if len(homepage) > 16 * 1024 * 1024 or b'</html>' not in homepage.lower() or b'DARYA' not in homepage.upper():
        raise ValueError('Unexpected live homepage; refusing to prepare a replacement')
    output = Path(tempfile.mkdtemp(prefix='darya-gallery-deploy-', dir='/tmp'))
    for name in ['assets', 'versionigor', 'api']:
        source = ROOT / name
        if any(path.is_symlink() for path in source.rglob('*')):
            raise ValueError('Symlink in application assets; review before copying')
        shutil.copytree(source, output / name, ignore=shutil.ignore_patterns('__pycache__', '.gitkeep'))
    shutil.copy2(ROOT / 'vercel.json', output / 'vercel.json')
    (output / 'index.html').write_bytes(homepage)
    dependencies = Dependencies()
    dependencies.feed(homepage.decode('utf-8'))
    for pathname in dependencies.paths:
        target = (output / pathname.lstrip('/')).resolve()
        if not target.is_relative_to(output) or not target.is_file():
            raise ValueError('A live homepage dependency is not in the checkout: ' + pathname)
    evidence = {'origin': ORIGIN, 'homepageSha256': hashlib.sha256(homepage).hexdigest(), 'directory': str(output)}
    # Evidence stays outside the deployment directory.
    output.with_suffix('.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
