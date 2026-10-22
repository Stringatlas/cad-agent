#!/usr/bin/env python3
"""Prepare independent STPLS3D CSV scenes for the project's Potree 2 reader."""
import argparse
from collections import Counter
from itertools import islice
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import laspy
import numpy as np
from dataset_recipe import digest, load_recipe, verify_sources

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / 'config/dataset-recipes/stpls3d.json'
CONVERTER = ROOT / 'data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter'
CLASSES = dict(enumerate(['Ground', 'Building', 'Low vegetation', 'Medium vegetation',
                        'High vegetation', 'Vehicle', 'Truck', 'Aircraft', 'Military vehicle',
                        'Bike', 'Motorcycle', 'Light pole', 'Street sign', 'Clutter', 'Fence', 'Road']))
CLASSES.update({17: 'Windows', 18: 'Dirt', 19: 'Grass'})
SCALE = 0.001


def read_rows(path, chunk=250000):
    if type(chunk) is not int or not 1 <= chunk <= 1000000:
        raise ValueError('Chunk must be 1..1000000')
    with path.open('rb') as stream:
        while lines := list(islice(stream, chunk)):
            rows = np.loadtxt(lines, delimiter=',', comments=None, dtype=np.float64, ndmin=2)
            if rows.shape != (len(lines), 8) or not np.all(np.isfinite(rows)):
                raise ValueError('Expected eight finite columns on every source line')
            if np.any(rows[:, 3:] != np.rint(rows[:, 3:])):
                raise ValueError('RGB and label IDs must be integral')
            if np.any(rows[:, 3:6] < 0) or np.any(rows[:, 3:6] > 255):
                raise ValueError('RGB must be 0..255')
            if not np.all(np.isin(rows[:, 6], list(CLASSES))):
                raise ValueError('Unknown STPLS3D semantic ID')
            instances = rows[:, 7]
            if np.any((instances < 0) & (instances != -100)) or np.any(instances > 2147483647):
                raise ValueError('Expected nonnegative int32 instance IDs or -100')
            if np.any(np.abs(np.rint(rows[:, :3] / SCALE)) > 2147483647):
                raise ValueError('Source coordinates exceed the millimeter int32 grid')
            yield rows


def inspect_sources(raw, recipe_path, converter, chunk):
    """Explicit enrollment only; normal conversion never rewrites reference hashes."""
    files = sorted(raw.glob('*_points_GTv3.txt'), key=lambda p: int(p.name.split('_')[0]))
    if not files:
        raise ValueError('No STPLS3D GTv3 files found')
    sources = []
    for path in files:
        before = digest(path)
        points = 0
        minimum, maximum = np.full(3, np.inf), np.full(3, -np.inf)
        counts = Counter()
        instance_min, instance_max = 2147483647, -2147483648
        for rows in read_rows(path, chunk):
            points += len(rows)
            minimum = np.minimum(minimum, rows[:, :3].min(axis=0))
            maximum = np.maximum(maximum, rows[:, :3].max(axis=0))
            ids, n = np.unique(rows[:, 6].astype(int), return_counts=True)
            counts.update(dict(zip(ids.tolist(), n.tolist())))
            instance_min = min(instance_min, int(rows[:, 7].min()))
            instance_max = max(instance_max, int(rows[:, 7].max()))
        if not 0 < points <= 2**32 or digest(path) != before:
            raise ValueError('Empty, oversized or changing source')
        sources.append({'file': path.name, 'source_file_id': int(path.name.split('_')[0]),
                        'bytes': path.stat().st_size, 'sha256': before, 'points': points,
                        'bounds': {'min': minimum.tolist(), 'max': maximum.tolist()},
                        'semantic_counts': {str(k): v for k, v in sorted(counts.items())},
                        'instance_range': [instance_min, instance_max]})
        print(f'Inspected {path.name}: {points:,} points', flush=True)
    recipe = {'schema': 'spatial-dataset-recipe-v1', 'id': 'stpls3d',
              'adapter': 'stpls3d-gtv3-csv-v1', 'upstream': 'https://github.com/meidachen/STPLS3D',
              'acquisition': 'Official STPLS3D instance-segmentation download; place the 25 GTv3 TXT scenes in data/raw/STPLS3D. Existing local files enrolled; no download performed.',
              'terms': 'Consult the official download terms and cite Chen et al., STPLS3D, BMVC 2022. No standalone dataset license file supplied with these local TXT files; no redistribution permission inferred.',
              'checksum_provenance': 'SHA256 of local originals, not publisher signatures.',
              'columns': ['x', 'y', 'z', 'red', 'green', 'blue', 'semantic_id', 'instance_id'],
              'coordinates': {'units': 'm', 'handedness': 'right', 'upAxis': 'Z', 'localOrigin': [0, 0, 0]},
              'crs': 'Unspecified local scene coordinates; no reprojection or inter-scene transform inferred.',
              'semantic_classes': CLASSES, 'instance_ignore_id': -100,
              'coordinate_grid_m': SCALE, 'max_coordinate_error_m': 0.001501,
              'converter': {'reference_executable_sha256': digest(converter),
                            'build_instructions': 'scripts/toronto3d/README.md'},
              'sources': sources}
    # Never overwrite an enrolled recipe by accident.
    with recipe_path.open('x') as stream:
        stream.write(json.dumps(recipe, indent=2) + '\n')
    load_recipe(recipe_path)


def encode_las(path, target, source, chunk):
    header = laspy.LasHeader(point_format=2, version='1.2')
    header.scales = [SCALE] * 3
    header.offsets = [0.0] * 3
    header.add_extra_dims([laspy.ExtraBytesParams(name='source_row', type=np.uint32),
                           laspy.ExtraBytesParams(name='semantic_id', type=np.uint8),
                           laspy.ExtraBytesParams(name='instance_id', type=np.int32)])
    start = 0
    with laspy.open(target, mode='w', header=header) as writer:
        for rows in read_rows(path, chunk):
            if start + len(rows) > source['points']:
                raise ValueError('Source grew during conversion')
            dst = laspy.ScaleAwarePointRecord.zeros(len(rows), header=header)
            for axis, name in enumerate(['X', 'Y', 'Z']):
                dst[name] = np.rint(rows[:, axis] / SCALE).astype(np.int32)
            for axis, name in enumerate(['red', 'green', 'blue']):
                dst[name] = rows[:, axis + 3].astype(np.uint16) * 257
            dst.semantic_id = rows[:, 6].astype(np.uint8)
            dst.instance_id = rows[:, 7].astype(np.int32)
            dst.point_source_id[:] = source['source_file_id']
            dst.source_row = np.arange(start, start + len(rows), dtype=np.uint32)
            writer.write_points(dst)
            start += len(rows)
    if start != source['points'] or digest(path) != source['sha256']:
        raise ValueError('Source changed during conversion')


def prepare_scene(raw, out, source, recipe, recipe_path, converter, chunk):
    verify_sources(raw, {'sources': [source]})
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        raise FileExistsError(f'Refusing to overwrite {out}')
    # Publish only a validated directory; failed scratch directories are removed.
    with tempfile.TemporaryDirectory(prefix='.' + out.name + '-', dir=out.parent) as tmp:
        staging = Path(tmp) / 'cloud'
        staging.mkdir()
        las = Path(tmp) / 'source.las'
        encode_las(raw / source['file'], las, source, chunk)
        command = [str(converter), str(las), '-o', str(staging / 'octree'), '-m', 'poisson',
                   '--encoding', 'UNCOMPRESSED']
        with (staging / 'converter.log').open('w') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        cloud_id = 'stpls3d-' + str(source['source_file_id'])
        cloud = {'version': 1, 'format': 'potree2-uncompressed', 'id': cloud_id,
                 'frameId': cloud_id + '-local', 'coordinates': recipe['coordinates'],
                 'sources': [{'id': source['source_file_id'], 'name': source['file'], 'points': source['points']}],
                 'semantics': {'attribute': 'semantic_id', 'type': 'uint8', 'classes': recipe['semantic_classes']},
                 'instances': {'attribute': 'instance_id', 'type': 'int32', 'unassigned': -100}}
        manifest = {'format': 'STPLS3D prepared scene v1', 'source': source,
                    'recipe_sha256': digest(recipe_path), 'coordinates': cloud['coordinates'],
                    'coordinate_grid_m': SCALE, 'max_coordinate_error_m': 0.001501,
                    'provenance': 'point source id = recipe ID; source_row = zero-based original TXT line; instance IDs are scoped to each scene; -100 is retained',
                    'rgb': 'Original RGB8 expanded exactly to RGB16 by multiplying by 257',
                    'converter': {'command': command, 'sha256': digest(converter)},
                    'dependencies': {'numpy': np.__version__, 'laspy': laspy.__version__},
                    'assets': {name: {'bytes': (staging / name).stat().st_size,
                                     'sha256': digest(staging / name)}
                               for name in ['octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']}}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        subprocess.run([sys.executable, str(Path(__file__).with_name('stpls3d-validate.py')),
                        '--raw', str(raw), '--out', str(staging)], check=True)
        (staging / 'cloud.json').write_text(json.dumps(cloud, indent=2) + '\n')
        staging.rename(out)
    print(f'Completed {out.name}: {source["points"]:,} points', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=ROOT / 'data/raw/STPLS3D')
    parser.add_argument('--out', type=Path, default=ROOT / 'data/processed/stpls3d')
    parser.add_argument('--recipe', type=Path, default=RECIPE)
    parser.add_argument('--converter', type=Path, default=CONVERTER)
    parser.add_argument('--chunk', type=int, default=250000)
    parser.add_argument('--scene', type=int, help='Only this numeric source ID; default all scenes')
    parser.add_argument('--inspect', action='store_true', help='Enroll source hashes into a NEW recipe; no conversion')
    args = parser.parse_args()
    converter = args.converter.resolve(strict=True)
    if args.inspect:
        inspect_sources(args.raw, args.recipe, converter, args.chunk)
        return
    recipe = load_recipe(args.recipe)
    if digest(converter) != recipe['converter']['reference_executable_sha256']:
        raise ValueError('Converter binary differs from the qualified reference')
    sources = [s for s in recipe['sources'] if args.scene is None or s['source_file_id'] == args.scene]
    if not sources:
        raise ValueError('Unknown scene ID')
    for source in sources:
        prepare_scene(args.raw.resolve(), args.out.resolve() / str(source['source_file_id']),
                      source, recipe, args.recipe, converter, args.chunk)
    if args.scene is None:
        (args.out / 'index.json').write_text(json.dumps({
            'dataset': 'STPLS3D', 'points': sum(s['points'] for s in sources),
            'scenes': [{'id': 'stpls3d-' + str(s['source_file_id']),
                        'path': str(s['source_file_id']), 'points': s['points']} for s in sources]
        }, indent=2) + '\n')


if __name__ == '__main__':
    main()
