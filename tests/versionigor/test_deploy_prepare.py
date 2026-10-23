"""Verify that deployment preparation preserves the live page and no credentials."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy_prepare', Path(__file__).resolve().parents[2] / 'scripts/prepare-gallery-deploy.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class Response(io.BytesIO):
    status = 200

    class headers:
        @staticmethod
        def get_content_type():
            return 'text/html'


class DeploymentPreparationTests(unittest.TestCase):
    def test_live_homepage_is_exact_and_old_git_page_is_untouched(self):
        homepage = b'<html><title>DARYA</title><img src="/assets/photo.png"></html>'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'repository'
            output = Path(folder) / 'deploy'
            root.mkdir()
            output.mkdir()
            for name in ['assets', 'versionigor', 'api']:
                (root / name).mkdir()
            (root / 'assets/photo.png').write_bytes(b'original photo')
            (root / 'index.html').write_bytes(b'old Git catalogue with all products')
            (root / '.env').write_text('TEST_SECRET=must-never-be-copied')
            (root / 'vercel.json').write_text('{}')
            with patch.object(prepare, 'ROOT', root), patch.object(prepare.subprocess, 'run') as readiness, patch.object(prepare.urllib.request, 'urlopen', return_value=Response(homepage)), patch.object(prepare.tempfile, 'mkdtemp', return_value=str(output)), contextlib.redirect_stdout(io.StringIO()):
                prepare.main()
            readiness.assert_called_once()
            self.assertEqual((output / 'index.html').read_bytes(), homepage)
            self.assertEqual((root / 'index.html').read_bytes(), b'old Git catalogue with all products')
            self.assertFalse((output / '.env').exists())
            evidence = json.loads(output.with_suffix('.json').read_text())
            self.assertEqual(evidence['homepageSha256'], hashlib.sha256(homepage).hexdigest())

    def test_detects_missing_live_dependency(self):
        dependencies = prepare.Dependencies()
        dependencies.feed('<img src="/assets/a.png"><script src="/new-app.js"></script><a href="/contact">Contact</a><img src="data:image/png;base64,AA"><link rel="stylesheet" href="https://external.example/a.css">')
        self.assertEqual(dependencies.paths, {'/assets/a.png', '/new-app.js'})


if __name__ == '__main__':
    unittest.main()
