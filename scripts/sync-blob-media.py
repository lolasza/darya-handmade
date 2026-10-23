#!/usr/bin/env python3
"""Mirror media from the user-selected Vercel Blob store. Never writes to Blob."""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "versionigor/assets/data"
MEDIA_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".ico", ".mp4", ".mov", ".webm", ".mp3", ".wav", ".ogg", ".m4a", ".pdf"}
FONT_TYPES = {".ttf", ".otf", ".woff", ".woff2"}


def load_blob_token():
    """Prefer the protected environment binding, then the local ignored file.

    Read only the required key. Never execute/source a dotenv file, expand shell
    expressions, or log a value. Local values stay out of the manifest and Git.
    """
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if token:
        return token
    dotenv = ROOT / ".env.local"
    if not dotenv.is_file():
        return None
    for line in dotenv.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.removeprefix("export ").partition("=")
        if not separator or key.strip() != "BLOB_READ_WRITE_TOKEN":
            continue
        value = value.strip()
        if value.startswith(("'", '"')):
            match = re.fullmatch(r'''(["'])(.*?)\1(?:\s+#.*)?''', value)
            if not match:
                raise ValueError("Malformed BLOB_READ_WRITE_TOKEN entry in .env.local")
            value = match[2]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        if any(character.isspace() for character in value) or "\x00" in value:
            raise ValueError("Invalid whitespace in the Blob token entry; value was not displayed")
        token = value or None
    return token


def safe_path(pathname):
    path = PurePosixPath(urllib.parse.unquote(pathname))
    if path.is_absolute() or not path.parts or any(p in {".", ".."} for p in path.parts) or "\\" in pathname:
        raise ValueError("Unsafe Blob pathname")
    return Path(*[re.sub(r"[^\w.\-]", "-", p, flags=re.UNICODE) for p in path.parts])


def public_blob_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or url.username or url.password or url.port or not re.fullmatch(r"[a-z0-9-]+\.public\.blob\.vercel-storage\.com", url.hostname or ""):
        raise ValueError("Expected a public Vercel Blob URL; private stores need a separate supported download route")
    if url.query or url.fragment:
        raise ValueError("Signed or query-bearing URLs must not be written into a public manifest")
    return value


def list_blobs(token):
    cursor = None
    while True:
        params = {"limit": "1000"}
        if cursor:
            params["cursor"] = cursor
        req = urllib.request.Request("https://blob.vercel-storage.com/?" + urllib.parse.urlencode(params), headers={"Authorization": "Bearer " + token, "x-api-version": "12"})
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.load(response)
        yield from result.get("blobs", [])
        if not result.get("hasMore"):
            break
        next_cursor = result.get("cursor")
        if not next_cursor or next_cursor == cursor:
            raise ValueError("Blob pagination did not advance")
        cursor = next_cursor


def sync(items):
    files = []
    seen = set()
    for item in items:
        original = item["pathname"]
        relative = safe_path(original)
        suffix = relative.suffix.lower()
        if suffix not in MEDIA_TYPES | FONT_TYPES:
            continue  # Do not mirror arbitrary config/credential files from storage.
        url = public_blob_url(item["url"])
        folder = "fonts" if suffix in FONT_TYPES else "media"
        target = ROOT / "versionigor/assets" / folder / relative
        allowed_root = (ROOT / "versionigor/assets" / folder).resolve()
        if not target.resolve().is_relative_to(allowed_root) or target.is_symlink():
            raise ValueError("Media target escapes its asset directory")
        if target in seen:
            raise ValueError("Blob path normalization collision")
        seen.add(target)
        with urllib.request.urlopen(url, timeout=45) as response:
            payload = response.read(64 * 1024 * 1024 + 1)
            mime = response.headers.get_content_type()
        if len(payload) > 64 * 1024 * 1024:
            raise ValueError("Media object exceeds the 64 MiB import limit")
        if not payload:
            raise ValueError("Empty media object")
        digest = hashlib.sha256(payload).hexdigest()
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            target = target.with_name(target.stem + "-" + digest[:10] + target.suffix)
        if not target.resolve().is_relative_to(allowed_root) or target.is_symlink():
            raise ValueError("Media target escapes its asset directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError("Existing media hash conflict; refusing to overwrite")
        if not target.exists():
            target.write_bytes(payload)
        files.append({"pathname": original, "path": "/" + target.relative_to(ROOT).as_posix(), "sourceUrl": url, "sha256": digest, "bytes": len(payload), "mime": mime or mimetypes.guess_type(str(target))[0], "kind": folder})
    if not files:
        raise ValueError("No supported media found; refusing to replace the current manifest")
    by_name = {f["pathname"]: f["path"] for f in files}
    for f in files:
        name = PurePosixPath(f["pathname"]).name
        if sum(PurePosixPath(x["pathname"]).name.lower() == name.lower() for x in files) == 1:
            by_name[name.lower()] = f["path"]
    source = json.loads((DATA / "source-catalog.json").read_text())
    by_hash = {f["sha256"]: f["path"] for f in files}
    products = {}
    missing = []
    for product in source["products"]:
        images = [by_hash[h] for h in product["imageHashes"] if h in by_hash]
        if images:
            products[product["id"]] = images
        if len(images) != len(product["imageHashes"]):
            missing.append(product["id"])
    output = {"storeName": "darya-media", "status": "imported", "byName": by_name, "products": products, "files": sorted(files, key=lambda f: f["pathname"]), "unmatchedProducts": missing}
    (DATA / "media.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(files)} media/font files; {len(products)} products matched by exact image SHA-256.")
    if missing:
        print("Needs visual mapping (not guessed): " + ", ".join(missing))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, help="Existing public Blob listing JSON instead of a live list request")
    args = parser.parse_args()
    if args.manifest:
        value = json.loads(args.manifest.read_text())
        items = value.get("blobs", value.get("files", [])) if isinstance(value, dict) else value
    else:
        token = load_blob_token()
        if not token:
            raise ValueError("BLOB_READ_WRITE_TOKEN is missing: fill the protected environment setting or the ignored .env.local file in the project root")
        items = list(list_blobs(token))
    sync(items)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not log request headers, process environment or credential contents.
        print("Media import failed: " + str(error), file=sys.stderr)
        sys.exit(1)
