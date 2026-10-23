"""Independent numeric expectations for library terrain operations, including holes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
import rasterio
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


producer, worker = load('terrain_producer', 'prepare-terrain.py'), load('terrain_worker', 'terrain-worker.py')


def fixture(root, hole=False):
    base = root / 'elevation'; base.mkdir()
    z = np.tile(np.arange(9, dtype=np.float64), (7, 1))
    if hole: z[:, 4] = np.nan
    for name, values in [('dtm', z), ('dsm', z + 2)]:
        with rasterio.open(base / (name + '.tif'), 'w', driver='GTiff', width=9, height=7, count=1, dtype='float64', nodata=np.nan, transform=from_origin(0, 7, 1, 1)) as dst: dst.write(values, 1)
    manifest = dict(source=dict(revision='a' * 64, descriptor=dict(id='plane-fixture')), grid=dict(resolution=1), assets={})
    for name in ['dtm.tif', 'dsm.tif']: manifest['assets'][name] = dict(sha256=hashlib.sha256((base / name).read_bytes()).hexdigest())
    (base / 'manifest.json').write_text(json.dumps(manifest)); producer.prepare(root)
    return base


class TerrainTests(unittest.TestCase):
    def test_gdal_slope_plane_and_regions(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = fixture(Path(tmp)); polygon = [[0, 0], [9, 0], [9, 7], [0, 7]]
            with rasterio.open(base / 'terrain/slope.tif') as src:
                slope = src.read(1, masked=True)
                self.assertEqual(slope.count(), 35); np.testing.assert_allclose(slope.compressed(), 45, atol=1e-5)
            summary = worker.run(base, 'query_terrain_region', dict(polygon=polygon))
            self.assertEqual(summary['statistics']['dtm']['mean'], 4)
            self.assertEqual(summary['statistics']['ndsm']['mean'], 2)
            self.assertEqual(summary['coverage']['dtm']['validFraction'], 1)
            self.assertEqual(summary['coverage']['slope']['validCells'], 35)
            args = dict(polygon=polygon, maxSlopeDegrees=46, minArea=1, maxHeightAboveGround=None, maxRegions=16)
            result = worker.run(base, 'filter_terrain_regions', args)
            self.assertEqual(result['matchingRegions'], 1); self.assertEqual(result['regions'][0]['area'], 35)
            self.assertEqual(worker.run(base, 'filter_terrain_regions', {**args, 'maxSlopeDegrees': 44})['matchingRegions'], 0)
            self.assertEqual(worker.run(base, 'filter_terrain_regions', {**args, 'maxHeightAboveGround': 1})['matchingRegions'], 0)
            image = worker.run(base, 'terrain_image', dict(polygon=polygon, layer='slope', maxSize=128))
            self.assertTrue(image['image']['dataUrl'].startswith('data:image/png;base64,'))
            self.assertEqual(image['mapping']['origin'], [0, 7]); self.assertEqual(image['mapping']['pixelSize'], [1, -1])
            profile = worker.run(base, 'terrain_profile', dict(start=[.5, 3.5], end=[8.5, 3.5], samples=9))
            self.assertEqual(profile['samples'][1]['gradeFromPreviousPercent'], 100)
            self.assertEqual(profile['samples'][4]['dtm'], 4)
            dense = worker.run(base, 'terrain_profile', dict(start=[.1, 3.5], end=[.2, 3.5], samples=3))
            self.assertTrue(all(point['gradeFromPreviousPercent'] is None for point in dense['samples']))

    def test_holes_break_components_and_grade_and_outside_counts_as_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = fixture(Path(tmp), True); polygon = [[-1, -1], [10, -1], [10, 8], [-1, 8]]
            args = dict(polygon=polygon, maxSlopeDegrees=46, minArea=1, maxHeightAboveGround=None, maxRegions=1)
            result = worker.run(base, 'filter_terrain_regions', args)
            self.assertEqual(result['matchingRegions'], 2); self.assertFalse(result['complete'])
            self.assertEqual(result['regions'][0]['area'], 10)
            self.assertEqual(result['selectedCells'], 99)
            self.assertEqual(result['coverage']['dtm']['validCells'], 56)
            profile = worker.run(base, 'terrain_profile', dict(start=[.5, 3.5], end=[8.5, 3.5], samples=9))
            self.assertIsNone(profile['samples'][4]['dtm']); self.assertIsNone(profile['samples'][5]['gradeFromPreviousPercent'])
            with self.assertRaises(ValueError): worker.run(base, 'query_terrain_region', dict(polygon=[[0, 0], [9, 7], [0, 7], [9, 0]]))
            with self.assertRaises(ValueError): worker.run(base, 'query_terrain_region', dict(polygon=[[0, 0], [2000, 0], [2000, 2000], [0, 2000]]))
            self.assertFalse((base / 'unexpected').exists())


if __name__ == '__main__': unittest.main()
