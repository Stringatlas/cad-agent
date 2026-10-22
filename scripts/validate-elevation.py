#!/usr/bin/env python3
"""Independent source-to-GeoTIFF audit: cell counts/means and witnessed maxima."""
import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import rowcol
from dataset_recipe import digest


def validate(root):
    output = root / 'elevation'
    manifest = json.loads((output / 'manifest.json').read_text())
    metadata = json.loads((root / 'octree/metadata.json').read_text())
    assert digest(root / 'octree/octree.bin') == manifest['sourcePayloadSha256'], 'Source hash mismatch'
    for name, asset in manifest['assets'].items():
        assert digest(output / name) == asset['sha256'], 'Raster hash mismatch'
    with rasterio.open(output / 'dtm.tif') as src:
        dtm, transform, shape = src.read(1), src.transform, src.shape
        assert src.crs is None
    with rasterio.open(output / 'dsm.tif') as src: dsm = src.read(1)
    with rasterio.open(output / 'support.tif') as src: support = src.read()
    with rasterio.open(output / 'ground-range.tif') as src: spread = src.read()
    n = dtm.size
    actual_count, ground_count = np.zeros(n, dtype=np.uint64), np.zeros(n, dtype=np.uint64)
    ground_sum, witnessed = np.zeros(n), np.zeros(n, dtype=bool)
    types = {'int8': 'i1', 'uint8': 'u1', 'int16': '<i2', 'uint16': '<u2', 'int32': '<i4', 'uint32': '<u4', 'float': '<f4', 'double': '<f8'}
    dtype = np.dtype([(a['name'], types[a['type']], (a['numElements'],)) if a['numElements'] > 1 else (a['name'], types[a['type']]) for a in metadata['attributes']])
    source = np.memmap(root / 'octree/octree.bin', mode='r', dtype=dtype)
    for start in range(0, len(source), 250000):
        p = source[start:start + 250000]
        xyz = p['position'] * np.asarray(metadata['scale']) + np.asarray(metadata['offset'])
        rows, cols = rowcol(transform, xyz[:, 0], xyz[:, 1])
        index = np.asarray(rows, dtype=int) * shape[1] + np.asarray(cols, dtype=int)
        actual_count += np.bincount(index, minlength=n).astype(np.uint64)
        assert np.all(xyz[:, 2] <= dsm.ravel()[index] + 1e-12), 'Surface is below a source observation'
        witnessed[index[xyz[:, 2] == dsm.ravel()[index]]] = True
        mask = np.isin(p[manifest['source']['descriptor']['semantics']['attribute']], manifest['settings']['groundLabels'])
        g, z = index[mask], xyz[mask, 2]
        ground_count += np.bincount(g, minlength=n).astype(np.uint64)
        ground_sum += np.bincount(g, weights=z, minlength=n)
        assert np.all(z >= spread[0].ravel()[g] - 1e-12) and np.all(z <= spread[1].ravel()[g] + 1e-12), 'Invalid ground spread'
    assert len(source) == metadata['points'] == manifest['coverage']['sourcePoints']
    assert np.array_equal(actual_count, support[1].ravel()) and np.array_equal(ground_count, support[0].ravel()), 'Cell counts mismatch'
    assert np.array_equal(actual_count > 0, np.isfinite(dsm.ravel())) and np.all(witnessed[actual_count > 0]), 'Missing or unwitnessed DSM cell'
    valid = ground_count >= manifest['settings']['minimumGroundSupport']
    assert np.array_equal(valid, np.isfinite(dtm.ravel())), 'DTM NoData/support mismatch'
    np.testing.assert_allclose(dtm.ravel()[valid], ground_sum[valid] / ground_count[valid], rtol=1e-12, atol=1e-9)
    report = {'status': 'pass', 'cloudId': manifest['source']['descriptor']['id'], 'sourcePoints': len(source), 'groundPoints': int(ground_count.sum()), 'dtmCells': int(valid.sum()), 'dsmCells': int(witnessed.sum()), 'checks': 'Every source record; per-cell counts and independently reduced ground means; DSM upper bound and exact source witness; explicit NoData; source/raster hashes'}
    (output / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('clouds', type=Path, nargs='+')
    for root in parser.parse_args().clouds:
        validate(root)
