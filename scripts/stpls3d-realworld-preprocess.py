#!/usr/bin/env python3
"""Prepare vertex-only STPLS3D real-world PLY scenes; retain every original row."""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import laspy
import numpy as np
from dataset_recipe import digest, load_recipe, verify_sources

ROOT = Path(__file__).resolve().parents[1]
CONVERTER = ROOT / 'data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter'
RECIPE = ROOT / 'config/dataset-recipes/stpls3d-realworld.json'
PROPERTIES = ['property float32 ' + axis for axis in 'xyz'] + ['property uint8 ' + name for name in ['red', 'green', 'blue', 'class']]
DTYPE = np.dtype([(axis, '<f4') for axis in 'xyz'] + [(name, 'u1') for name in ['red', 'green', 'blue', 'class']])
CLASSES = dict(enumerate(['Ground', 'Building', 'Low vegetation', 'Medium vegetation', 'High vegetation', 'Vehicle', 'Truck', 'Aircraft', 'Military vehicle', 'Bike', 'Motorcycle', 'Light pole', 'Street sign', 'Clutter', 'Fence', 'Road']))
CLASSES.update({17: 'Windows', 18: 'Dirt', 19: 'Grass'})
COORDINATES = {'units': 'm', 'handedness': 'right', 'upAxis': 'Z', 'localOrigin': [0, 0, 0]}


def read_ply(path):
    with path.open('rb') as stream:
        lines = []
        for _ in range(100):
            line = stream.readline(4096).decode('ascii').strip()
            lines.append(line)
            if line == 'end_header':
                break
        offset = stream.tell()
    elements = [line.split() for line in lines if line.startswith('element ')]
    if lines[:2] != ['ply', 'format binary_little_endian 1.0'] or lines[-1] != 'end_header' or [line for line in lines if line.startswith('property ')] != PROPERTIES or len(elements) != 1 or elements[0][1] != 'vertex':
        raise ValueError('Unsupported STPLS3D real-world PLY schema')
    count = int(elements[0][2])
    if not 0 < count <= 2**32 or path.stat().st_size != offset + count * DTYPE.itemsize:
        raise ValueError('PLY size/count mismatch')
    return np.memmap(path, mode='r', dtype=DTYPE, offset=offset, shape=(count,))


def checked_chunks(vertices, chunk=250000):
    for start in range(0, len(vertices), chunk):
        src = vertices[start:start + chunk]
        xyz = np.column_stack([src[axis] for axis in 'xyz']).astype(np.float64)
        if not np.all(np.isfinite(xyz)) or np.any(np.abs(np.rint(xyz / 0.001)) > 2147483647):
            raise ValueError('Nonfinite or out-of-grid source positions')
        if not np.all(np.isin(src['class'], list(CLASSES))):
            raise ValueError('Unknown native STPLS3D semantic ID')
        yield start, src, xyz


def enroll(raw, recipe_path, converter):
    sources = []
    for fid, path in enumerate(sorted(raw.glob('*.ply')), 1):
        before = digest(path)
        vertices = read_ply(path)
        low, high, counts = np.full(3, np.inf), np.full(3, -np.inf), Counter()
        for _, src, xyz in checked_chunks(vertices):
            low, high = np.minimum(low, xyz.min(axis=0)), np.maximum(high, xyz.max(axis=0))
            ids, n = np.unique(src['class'], return_counts=True)
            counts.update(dict(zip(ids.tolist(), n.tolist())))
        if digest(path) != before:
            raise ValueError('Source changed during enrollment')
        sources.append({'file': path.name, 'source_file_id': fid, 'scene': path.stem.removesuffix('_points').lower(),
                        'points': len(vertices), 'bytes': path.stat().st_size, 'sha256': before,
                        'bounds': {'min': low.tolist(), 'max': high.tolist()},
                        'semantic_counts': {str(k): v for k, v in sorted(counts.items())}})
        print(f'Inspected {path.name}: {len(vertices):,} points', flush=True)
        del vertices
    if not sources:
        raise ValueError('No PLY sources found')
    recipe = {'schema': 'spatial-dataset-recipe-v1', 'id': 'stpls3d-realworld', 'adapter': 'stpls3d-realworld-ply-v1',
              'upstream': 'https://github.com/meidachen/STPLS3D#25-semantic-annotations',
              'checksum_provenance': 'SHA256 of local originals; not publisher signatures',
              'coordinates': COORDINATES, 'crs': 'Unspecified source local meters; no inter-scene transform inferred',
              'semantic_classes': CLASSES, 'instances': 'Not present in original PLY; none synthesized',
              'coordinate_grid_m': 0.001, 'max_coordinate_error_m': 0.001501,
              'converter': {'reference_executable_sha256': digest(converter)}, 'sources': sources}
    with recipe_path.open('x') as stream:
        stream.write(json.dumps(recipe, indent=2) + '\n')
    load_recipe(recipe_path)


def prepare(raw, out, source, recipe, recipe_path, converter):
    verify_sources(raw, {'sources': [source]})
    if out.exists():
        raise FileExistsError(f'Refusing to overwrite {out}')
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.' + out.name + '-', dir=out.parent) as tmp:
        tmp = Path(tmp)
        staging = tmp / 'cloud'
        staging.mkdir()
        header = laspy.LasHeader(point_format=2, version='1.2')
        header.scales, header.offsets = [0.001] * 3, [0.0] * 3
        header.add_extra_dims([laspy.ExtraBytesParams(name='source_row', type=np.uint32), laspy.ExtraBytesParams(name='semantic_id', type=np.uint8)])
        vertices = read_ply(raw / source['file'])
        if len(vertices) != source['points']:
            raise ValueError('Source count differs from enrolled recipe')
        with laspy.open(tmp / 'source.las', mode='w', header=header) as writer:
            for start, src, xyz in checked_chunks(vertices):
                dst = laspy.ScaleAwarePointRecord.zeros(len(src), header=header)
                for axis, name in enumerate('XYZ'):
                    dst[name] = np.rint(xyz[:, axis] / 0.001).astype(np.int32)
                for name in ['red', 'green', 'blue']:
                    dst[name] = src[name].astype(np.uint16) * 257
                dst.semantic_id = src['class']
                dst.source_row = np.arange(start, start + len(src), dtype=np.uint32)
                dst.point_source_id[:] = source['source_file_id']
                writer.write_points(dst)
        del vertices
        command = [str(converter), str(tmp / 'source.las'), '-o', str(staging / 'octree'), '-m', 'poisson', '--encoding', 'UNCOMPRESSED']
        with (staging / 'converter.log').open('w') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        cloud_id = 'stpls3d-realworld-' + source['scene']
        cloud = {'version': 1, 'format': 'potree2-uncompressed', 'id': cloud_id, 'frameId': cloud_id + '-local', 'coordinates': recipe['coordinates'],
                 'sources': [{'id': source['source_file_id'], 'name': source['file'], 'points': source['points']}],
                 'semantics': {'attribute': 'semantic_id', 'type': 'uint8', 'classes': recipe['semantic_classes']}}
        manifest = {'format': 'STPLS3D real-world prepared scene v1', 'source_format': recipe['adapter'], 'source': source,
                    'recipe_sha256': digest(recipe_path), 'coordinates': cloud['coordinates'],
                    'coordinate_grid_m': 0.001, 'max_coordinate_error_m': 0.001501,
                    'provenance': 'point source id = recipe ID; source_row = original zero-based PLY vertex index',
                    'instances': 'Absent in original; none synthesized', 'converter': {'command': command, 'sha256': digest(converter)},
                    'dependencies': {'numpy': np.__version__, 'laspy': laspy.__version__},
                    'assets': {name: {'bytes': (staging / name).stat().st_size, 'sha256': digest(staging / name)} for name in ['octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']}}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        subprocess.run([sys.executable, str(Path(__file__).with_name('stpls3d-validate.py')), '--raw', str(raw), '--out', str(staging)], check=True)
        (staging / 'cloud.json').write_text(json.dumps(cloud, indent=2) + '\n')
        staging.rename(out)
    print(f'Completed {source["scene"]}: {source["points"]:,} points', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=ROOT / 'data/raw/stpls3d_realworld')
    parser.add_argument('--out', type=Path, default=ROOT / 'data/processed/stpls3d_realworld')
    parser.add_argument('--recipe', type=Path, default=RECIPE)
    parser.add_argument('--converter', type=Path, default=CONVERTER)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--scene', help='Only the named scene (occc, ra, usc, wmsc)')
    args = parser.parse_args()
    if args.inspect:
        enroll(args.raw, args.recipe, args.converter)
        return
    recipe = load_recipe(args.recipe)
    if recipe['adapter'] != 'stpls3d-realworld-ply-v1' or digest(args.converter) != recipe['converter']['reference_executable_sha256']:
        raise ValueError('Adapter or converter identity mismatch')
    sources = [s for s in recipe['sources'] if args.scene is None or args.scene == s['scene']]
    if not sources:
        raise ValueError('Unknown scene')
    for source in sources:
        prepare(args.raw.resolve(), args.out.resolve() / source['scene'], source, recipe, args.recipe, args.converter.resolve())
    if args.scene is None:
        (args.out / 'index.json').write_text(json.dumps({'dataset': 'STPLS3D real-world', 'points': sum(s['points'] for s in sources),
            'scenes': [{'id': 'stpls3d-realworld-' + s['scene'], 'path': s['scene'], 'points': s['points']} for s in sources]}, indent=2) + '\n')


if __name__ == '__main__':
    main()
