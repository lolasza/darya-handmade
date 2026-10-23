"""Safety tests for the read-only Blob mirror; no network requests."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('blob_sync', Path(__file__).resolve().parents[2] / 'scripts/sync-blob-media.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class BlobSyncTests(unittest.TestCase):
    def test_paths_reject_escape(self):
        for name in ['../secret.png', '/image.png', 'folder/%2e%2e/image.png', 'folder\\image.png']:
            with self.assertRaises(ValueError):
                sync.safe_path(name)

    def test_only_public_blob_urls(self):
        self.assertEqual(sync.public_blob_url('https://store.public.blob.vercel-storage.com/portrait.png'), 'https://store.public.blob.vercel-storage.com/portrait.png')
        for url in ['http://store.public.blob.vercel-storage.com/a.png', 'https://evil.example/a.png', 'https://store.public.blob.vercel-storage.com/a.png?token=secret', 'https://store.private.blob.vercel-storage.com/a.png']:
            with self.assertRaises(ValueError):
                sync.public_blob_url(url)

    def test_symlink_cannot_escape_asset_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / 'versionigor/assets/media'
            assets.mkdir(parents=True)
            outside = root / 'outside'
            outside.mkdir()
            (assets / 'escape').symlink_to(outside, target_is_directory=True)
            with patch.object(sync, 'ROOT', root), patch.object(sync.urllib.request, 'urlopen') as download:
                with self.assertRaises(ValueError):
                    sync.sync([{'pathname': 'escape/a.png', 'url': 'https://store.public.blob.vercel-storage.com/a.png'}])
                download.assert_not_called()

    def test_empty_listing_does_not_replace_manifest(self):
        with self.assertRaises(ValueError):
            sync.sync([])


if __name__ == '__main__':
    unittest.main()
