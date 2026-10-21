#!/usr/bin/env python3
"""Verify source identity without numpy, laspy, a converter, or generated data."""
import argparse
import hashlib
import json
from pathlib import Path
import re

DEFAULT_RECIPE = Path(__file__).resolve().parents[1] / 'config/dataset-recipes/toronto3d.json'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def load_recipe(path=DEFAULT_RECIPE):
    recipe = json.loads(Path(path).read_text())
    if recipe.get('schema') != 'spatial-dataset-recipe-v1':
        raise ValueError('Unsupported dataset recipe schema')
    sources, sidecars = recipe.get('sources', []), recipe.get('sidecars', [])
    if not sources:
        raise ValueError('Recipe must have sources')
    names, ids = set(), set()
    for entry in [*sources, *sidecars]:
        name = entry.get('file', '')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name) or name in names:
            raise ValueError(f'Unsafe or duplicate recipe filename: {name}')
        names.add(name)
        if not re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')):
            raise ValueError(f'Invalid source SHA256: {name}')
        if 'bytes' in entry and (type(entry['bytes']) is not int or entry['bytes'] <= 0):
            raise ValueError(f'Invalid source size: {name}')
    for entry in sources:
        fid = entry.get('source_file_id')
        if type(fid) is not int or not 1 <= fid <= 65535 or fid in ids:
            raise ValueError('Source IDs must be unique positive uint16 values')
        ids.add(fid)
        if type(entry.get('points')) is not int or not 0 < entry['points'] <= 2**32:
            raise ValueError('Invalid source point count')
    return recipe


def verify_sources(raw, recipe):
    """Fail closed before preprocessing output is created; originals stay read-only."""
    checked = []
    for entry in [*recipe['sources'], *recipe.get('sidecars', [])]:
        path = Path(raw) / entry['file']
        if not path.is_file():
            raise ValueError(f'Missing source: {entry["file"]}')
        if 'bytes' in entry and path.stat().st_size != entry['bytes']:
            raise ValueError(f'Source size mismatch: {entry["file"]}')
        if digest(path) != entry['sha256']:
            raise ValueError(f'Source SHA256 mismatch: {entry["file"]}')
        checked.append(entry['file'])
    return checked


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, default=DEFAULT_RECIPE)
    parser.add_argument('--raw', type=Path, default=Path('data/raw/toronto3d'))
    args = parser.parse_args()
    print(json.dumps({'recipe': str(args.recipe), 'verified': verify_sources(args.raw, load_recipe(args.recipe))}, indent=2))
