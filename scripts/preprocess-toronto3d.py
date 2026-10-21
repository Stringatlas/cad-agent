#!/usr/bin/env python3
"""Toronto3D packed PLY -> local LAS + bounded preview + Potree 2 LOD.

Install scripts/toronto3d-requirements.txt in a local venv. Originals are read-only.
Output must not exist; failed runs remain visibly incomplete (no manifest.json).
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import laspy
import numpy as np

from dataset_recipe import DEFAULT_RECIPE, load_recipe, verify_sources

ORIGIN = np.array([627285.0, 4841948.0, 0.0])
SCALARS = ['scalar_Intensity', 'scalar_GPSTime', 'scalar_ScanAngleRank', 'scalar_Label']
PROPERTIES = [('double', a) for a in 'xyz'] + [('uchar', a) for a in ['red', 'green', 'blue']] + [('float', a) for a in SCALARS]
DTYPE = np.dtype([(a, '<f8') for a in 'xyz'] + [(a, 'u1') for a in ['red', 'green', 'blue']] + [(a, '<f4') for a in SCALARS])
CLASSES = ['Unclassified', 'Ground', 'Road_markings', 'Natural', 'Building', 'Utility_line', 'Pole', 'Car', 'Fence']


def ply(path):
    """Reject anything other than the inspected packed vertex-only schema."""
    with path.open('rb') as f:
        lines = []
        while True:
            line = f.readline(4096)
            if not line or len(lines) > 100:
                raise ValueError(f'Invalid PLY header: {path}')
            lines.append(line.decode('ascii').strip())
            if lines[-1] == 'end_header':
                offset = f.tell()
                break
    elements = [s.split() for s in lines if s.startswith('element ')]
    props = [tuple(s.split()[1:]) for s in lines if s.startswith('property ')]
    if lines[0] != 'ply' or 'format binary_little_endian 1.0' not in lines or props != PROPERTIES or len(elements) != 1 or elements[0][1] != 'vertex':
        raise ValueError(f'Unsupported PLY schema: {path}')
    count = int(elements[0][2])
    if count <= 0 or count > 2**32 or path.stat().st_size != offset + count * DTYPE.itemsize:
        raise ValueError(f'PLY size/count mismatch: {path}')
    return np.memmap(path, dtype=DTYPE, mode='r', offset=offset, shape=(count,))


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def convert(path, target, file_id, chunk, preview_limit):
    points = ply(path)
    n = len(points)
    header = laspy.LasHeader(point_format=3, version='1.2')
    header.scales = [0.001] * 3
    header.offsets = [0.0] * 3
    header.add_extra_dims([laspy.ExtraBytesParams(name=a, type=np.float32) for a in SCALARS] + [laspy.ExtraBytesParams(name='source_row', type=np.uint32)])
    low, high = np.full(3, np.inf), np.full(3, -np.inf)
    histogram = np.zeros(9, dtype=np.int64)
    nonfinite = {a: 0 for a in SCALARS}
    with laspy.open(target, mode='w', header=header) as writer:
        for start in range(0, n, chunk):
            src = points[start:start + chunk]
            xyz = np.column_stack([src[a] for a in 'xyz'])
            if not np.isfinite(xyz).all():
                raise ValueError(f'Nonfinite source positions: {path}')
            for a in SCALARS:
                nonfinite[a] += int(np.count_nonzero(~np.isfinite(src[a])))
            labels = src['scalar_Label']
            if np.any(labels != np.floor(labels)) or np.any((labels < 0) | (labels > 8)):
                raise ValueError(f'Unknown semantic labels: {path}')
            low = np.minimum(low, xyz.min(axis=0))
            high = np.maximum(high, xyz.max(axis=0))
            histogram += np.bincount(labels.astype(np.int64), minlength=9)
            record = laspy.ScaleAwarePointRecord.zeros(len(src), header=header)
            local = xyz - ORIGIN
            for axis, a in enumerate('xyz'):
                setattr(record, a, local[:, axis])
            for a in ['red', 'green', 'blue']:
                setattr(record, a, src[a].astype(np.uint16) * 257)
            for a in SCALARS:
                record[a] = src[a]
            record.point_source_id[:] = file_id
            record.source_row = np.arange(start, start + len(src), dtype=np.uint32)
            writer.write_points(record)
    rows = np.linspace(0, n - 1, min(n, preview_limit), dtype=np.uint32)
    preview = np.empty(len(rows), dtype=[(a, '<f8') for a in 'xyz'] + [(a, 'u1') for a in ['red', 'green', 'blue']] + [(a, '<f4') for a in SCALARS] + [('source_file', '<u2'), ('source_row', '<u4')])
    for axis, a in enumerate('xyz'):
        preview[a] = points[a][rows] - ORIGIN[axis]
    for a in ['red', 'green', 'blue'] + SCALARS:
        preview[a] = points[a][rows]
    preview['source_file'], preview['source_row'] = file_id, rows
    return {'file': path.name, 'source_file_id': file_id, 'points': n, 'bytes': path.stat().st_size, 'sha256': sha256(path), 'world_bounds': [low.tolist(), high.tolist()], 'label_counts': histogram.tolist(), 'nonfinite_scalar_counts': nonfinite}, preview


def run(raw, out, converter, chunk=500000, preview_limit=25000):
    recipe = load_recipe()
    if recipe['adapter'] != 'toronto3d-packed-ply-v1' or recipe['local_origin_world'] != ORIGIN.tolist():
        raise ValueError('Recipe requires a different preprocessing adapter or origin')
    verify_sources(raw, recipe)
    inputs = [raw / source['file'] for source in recipe['sources']]
    converter = converter.resolve(strict=True)
    out.mkdir(parents=True, exist_ok=False)
    (out / 'las').mkdir()
    sources, previews = [], []
    for source, path in zip(recipe['sources'], inputs):
        print(f'Converting {path.name}', flush=True)
        info, preview = convert(path, out / 'las' / f'{path.stem}.las', source['source_file_id'], chunk, preview_limit)
        if info['points'] != source['points'] or info['sha256'] != source['sha256']:
            raise ValueError(f'Source identity changed during conversion: {path.name}')
        sources.append(info)
        previews.append(preview)
    np.save(out / 'preview.npy', np.concatenate(previews), allow_pickle=False)
    for sidecar in recipe['sidecars']:
        name = sidecar['file']
        shutil.copyfile(raw / name, out / name)
    command = [str(converter), *[str((out / 'las' / f'{p.stem}.las').resolve()) for p in inputs], '-o', str((out / 'octree').resolve()), '-m', 'poisson', '--encoding', 'UNCOMPRESSED']
    with (out / 'converter.log').open('w') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
    metadata = json.loads((out / 'octree/metadata.json').read_text())
    if metadata['points'] != sum(s['points'] for s in sources):
        raise ValueError('Potree point count mismatch')
    manifest = {'format': 'Toronto3D preprocessing v1', 'units': 'm', 'frame': 'right-handed Z-up', 'local_origin_world': ORIGIN.tolist(), 'world_from_local': 'world = local + local_origin_world', 'crs': 'Source UTM coordinates, no reprojection; CRS not independently verified', 'las_quantization_m': 0.001, 'potree_scale_m': metadata['scale'], 'semantic_classes': dict(enumerate(CLASSES)), 'semantic_attribute': 'scalar_Label', 'rgb_encoding': 'LAS/Potree uint16 = original uint8 * 257', 'provenance': 'point source id (1..4) + source_row (zero-based original PLY vertex index)', 'preview': {'path': 'preview.npy', 'points': sum(map(len, previews)), 'sampling': 'deterministic evenly spaced source rows per file; not spatially uniform', 'positions': 'local float64'}, 'sources': sources, 'license': 'Toronto3D CC BY-NC 4.0; https://github.com/WeikaiTan/Toronto-3D', 'converter': {'executable_sha256': sha256(converter), 'command': command}, 'dependencies': {'numpy': np.__version__, 'laspy': laspy.__version__}}
    manifest['recipe'] = {'id': recipe['id'], 'sha256': sha256(DEFAULT_RECIPE)}
    manifest['converter']['upstream_commit'] = recipe['converter']['commit']
    manifest['converter']['required_patches'] = recipe['converter']['patches']
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Completed: {out}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('data/raw/toronto3d'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--converter', type=Path, required=True)
    args = parser.parse_args()
    run(args.raw, args.out, args.converter)
