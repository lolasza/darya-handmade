#!/usr/bin/env python3
"""Explicitly switch indexing after approval; changes all three crawler controls."""
import argparse
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['preview', 'approved'])
args = parser.parse_args()
robots = 'noindex, follow' if args.mode == 'preview' else 'index, follow'
site_path = root / 'versionigor/assets/data/site.json'
site = json.loads(site_path.read_text())
site['noindex'] = args.mode == 'preview'
site_path.write_text(json.dumps(site, ensure_ascii=False, indent=2) + '\n')
html_path = root / 'versionigor/index.html'
html_path.write_text(re.sub(r'(<meta name="robots" content=")[^"]*(")', lambda m: m[1] + robots + m[2], html_path.read_text()))
config_path = root / 'vercel.json'
config = json.loads(config_path.read_text())
for group in config['headers']:
    if group['source'] == '/versionigor(.*)':
        for header in group['headers']:
            if header['key'] == 'X-Robots-Tag':
                header['value'] = robots
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
print('Gallery crawler policy: ' + robots)
