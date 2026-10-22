#!/usr/bin/env python3
"""Full-resolution prepared point records -> classified DTM / observed DSM GeoTIFFs."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin, rowcol
from dataset_recipe import digest

ROOT = Path(__file__).resolve().parents[1]
GROUND = [0, 15, 18, 19]
MAX_CELLS = 4_000_000


def binding(root):
    descriptor = json.loads((root / 'cloud.json').read_text())
    return json.loads(subprocess.check_output(['node', '--import', 'tsx', str(ROOT / 'scripts/elevation-source-info.ts'), str(root), descriptor['id']], cwd=ROOT, text=True))


def aggregate(root, info, resolution, ground_labels, minimum_support, chunk=250000):
    """Use NumPy reductions and Rasterio's coordinate indexing, retaining every source record."""
    metadata = json.loads((root / 'octree/metadata.json').read_text())
    types = {'int8': 'i1', 'uint8': 'u1', 'int16': '<i2', 'uint16': '<u2', 'int32': '<i4', 'uint32': '<u4', 'float': '<f4', 'double': '<f8', 'int64': '<i8', 'uint64': '<u8'}
    fields = [(a['name'], types[a['type']], (a['numElements'],)) if a['numElements'] > 1 else (a['name'], types[a['type']]) for a in metadata['attributes']]
    dtype = np.dtype(fields)
    if metadata['encoding'] != 'UNCOMPRESSED' or metadata['points'] != info['totalPoints'] or (root / 'octree/octree.bin').stat().st_size != dtype.itemsize * info['totalPoints']:
        raise ValueError('Incomplete or unsupported source payload')
    minimum, maximum = info['bounds']['min'], info['bounds']['max']
    left, top = math.floor(minimum[0] / resolution) * resolution, math.ceil(maximum[1] / resolution) * resolution
    width, height = math.floor((maximum[0] - left) / resolution) + 1, math.floor((top - minimum[1]) / resolution) + 1
    if width * height > MAX_CELLS:
        raise ValueError('Raster exceeds cell budget; use a coarser --resolution')
    transform = from_origin(left, top, resolution, resolution)
    n = width * height
    total = np.zeros(n, dtype=np.uint32)
    ground = np.zeros(n, dtype=np.uint32)
    sums = np.zeros(n, dtype=np.float64)
    low, high, surface = np.full(n, np.inf), np.full(n, -np.inf), np.full(n, -np.inf)
    source = np.memmap(root / 'octree/octree.bin', mode='r', dtype=dtype)
    semantic = info['descriptor']['semantics']['attribute']
    for start in range(0, len(source), chunk):
        records = source[start:start + chunk]
        xyz = records['position'].astype(np.float64) * metadata['scale'] + metadata['offset']
        if not np.isfinite(xyz).all():
            raise ValueError('Nonfinite source positions')
        rows, columns = rowcol(transform, xyz[:, 0], xyz[:, 1])
        rows, columns = np.asarray(rows, dtype=np.int64), np.asarray(columns, dtype=np.int64)
        if np.any(rows < 0) or np.any(rows >= height) or np.any(columns < 0) or np.any(columns >= width):
            raise ValueError('Source outside enrolled grid bounds')
        cell = rows * width + columns
        np.add.at(total, cell, 1)
        np.maximum.at(surface, cell, xyz[:, 2])
        mask = np.isin(records[semantic], ground_labels)
        indices, z = cell[mask], xyz[mask, 2]
        np.add.at(ground, indices, 1); np.add.at(sums, indices, z)
        np.minimum.at(low, indices, z); np.maximum.at(high, indices, z)
    del source
    if int(total.sum(dtype=np.uint64)) != info['totalPoints'] or np.any(ground > total):
        raise ValueError('Source reduction coverage mismatch')
    dtm = np.full(n, np.nan)
    np.divide(sums, ground, out=dtm, where=ground >= minimum_support)
    surface[total == 0] = np.nan
    low[ground == 0], high[ground == 0] = np.nan, np.nan
    shape = (height, width)
    return transform, [a.reshape(shape) for a in [dtm, surface, ground, total, low, high]]


def write_tiff(path, arrays, transform, info, descriptions, nodata):
    array = np.stack(arrays)
    profile = dict(driver='GTiff', width=array.shape[2], height=array.shape[1], count=len(arrays), dtype=array.dtype,
                   transform=transform, crs=None, nodata=nodata, tiled=True, blockxsize=256, blockysize=256, compress='deflate', predictor=3 if array.dtype.kind == 'f' else 2)
    with rasterio.open(path, 'w', **profile) as dst:
        dst.write(array)
        dst.descriptions = tuple(descriptions)
        dst.update_tags(cloud_id=info['descriptor']['id'], source_revision=info['revision'], frame_id=info['descriptor']['frameId'], units='m', evidence='original-prepared-source-records')
        levels = [scale for scale in [2, 4, 8, 16] if min(array.shape[1:]) // scale >= 1]
        if levels:
            dst.build_overviews(levels, Resampling.nearest)
            dst.update_tags(ns='rio_overview', resampling='nearest')


def prepare(root, resolution=1.0, ground_labels=GROUND, minimum_support=3):
    root = root.resolve()
    if not math.isfinite(resolution) or not .25 <= resolution <= 10 or not 1 <= minimum_support <= 10000 or not ground_labels or len(set(ground_labels)) != len(ground_labels):
        raise ValueError('Invalid raster settings')
    before = binding(root)
    classes = before['descriptor'].get('semantics', {}).get('classes', {})
    if any(str(label) not in classes for label in ground_labels):
        raise ValueError('Ground labels must be explicitly present in the native taxonomy')
    output = root / 'elevation'
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    transform, arrays = aggregate(root, before, resolution, ground_labels, minimum_support)
    dtm, dsm, ground, total, low, high = arrays
    source_hash = digest(root / 'octree/octree.bin')
    with tempfile.TemporaryDirectory(prefix='.elevation-', dir=root) as scratch:
        staging = Path(scratch) / 'elevation'; staging.mkdir()
        write_tiff(staging / 'dtm.tif', [dtm], transform, before, ['classified-ground-mean'], np.nan)
        write_tiff(staging / 'dsm.tif', [dsm], transform, before, ['observed-surface-maximum'], np.nan)
        write_tiff(staging / 'support.tif', [ground, total], transform, before, ['ground-point-count', 'all-point-count'], None)
        write_tiff(staging / 'ground-range.tif', [low, high], transform, before, ['ground-minimum', 'ground-maximum'], np.nan)
        # Independently reopen through GDAL and compare all base cells and totals.
        for name, expected in [('dtm.tif', [dtm]), ('dsm.tif', [dsm]), ('support.tif', [ground, total]), ('ground-range.tif', [low, high])]:
            with rasterio.open(staging / name) as src:
                if src.transform != transform or src.crs is not None or not np.array_equal(src.read(), np.stack(expected), equal_nan=True):
                    raise ValueError('GeoTIFF roundtrip validation failed')
        if binding(root)['revision'] != before['revision']:
            raise ValueError('Source changed during elevation preparation')
        ndsm = dsm - dtm
        summary = lambda a: {'min': float(np.nanmin(a)), 'max': float(np.nanmax(a)), 'validCells': int(np.isfinite(a).sum())} if np.isfinite(a).any() else {'min': None, 'max': None, 'validCells': 0}
        model = dict(version=1, kind='classified-dtm-observed-dsm-v1', source=before,
                     grid=dict(width=dtm.shape[1], height=dtm.shape[0], origin=[transform.c, transform.f], resolution=resolution, rowDirection='south', pixelInterpretation='area'),
                     settings=dict(groundLabels=ground_labels, minimumGroundSupport=minimum_support, dtmMethod='classified-ground-mean', dsmMethod='all-point-maximum', interpolation='none', nodata='NaN'),
                     coverage=dict(sourcePoints=int(total.sum(dtype=np.uint64)), groundPoints=int(ground.sum(dtype=np.uint64))),
                     layers={'dtm': summary(dtm), 'dsm': summary(dsm), 'ndsm': summary(ndsm)},
                     sourcePayloadSha256=source_hash,
                     assets={name: {'bytes': (staging / name).stat().st_size, 'sha256': digest(staging / name)} for name in ['dtm.tif', 'dsm.tif', 'support.tif', 'ground-range.tif']},
                     libraries=dict(numpy=np.__version__, rasterio=rasterio.__version__, gdal=rasterio.__gdal_version__))
        encoded = json.dumps(model, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        model['revision'] = hashlib.sha256(encoded).hexdigest()
        (staging / 'manifest.json').write_text(json.dumps(model, indent=2, allow_nan=False) + '\n')
        staging.rename(output)
    print(json.dumps({'id': before['descriptor']['id'], 'points': before['totalPoints'], 'grid': model['grid'], 'layers': model['layers'], 'status': 'pass'}), flush=True)
    return model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('clouds', nargs='+', type=Path, help='Prepared cloud directories (each containing cloud.json)')
    parser.add_argument('--resolution', type=float, default=1.0)
    parser.add_argument('--ground-labels', default=','.join(map(str, GROUND)))
    parser.add_argument('--minimum-support', type=int, default=3)
    args = parser.parse_args()
    for root in args.clouds:
        prepare(root, args.resolution, list(map(int, args.ground_labels.split(','))), args.minimum_support)


if __name__ == '__main__':
    main()
