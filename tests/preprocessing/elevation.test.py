"""Standard GeoTIFF generation against independently specified elevations and support."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('elevation', ROOT / 'scripts/prepare-elevation.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)


def fixture(root):
    (root / 'octree').mkdir(parents=True)
    points = [(100, 100, 10000, 0), (200, 100, 11000, 0), (300, 100, 12000, 0), (100, 100, 20000, 1),
              (1100, 100, 25000, 1), (2100, 100, 5000, 0), (2200, 100, 7000, 0),
              (100, 1100, 1000, 0), (200, 1100, 1000, 0), (300, 1100, 1000, 0), (100, 1100, 6000, 2)]
    descriptor = {'version': 1, 'format': 'potree2-uncompressed', 'id': 'elevation-fixture', 'frameId': 'elevation-local', 'coordinates': {'units': 'm', 'handedness': 'right', 'upAxis': 'Z', 'localOrigin': [0, 0, 0]}, 'sources': [{'id': 42, 'name': 'fixture.ply', 'points': len(points)}], 'semantics': {'attribute': 'semantic_id', 'type': 'uint8', 'classes': {'0': 'Ground', '1': 'Building', '2': 'Vegetation', '15': 'Road', '18': 'Dirt', '19': 'Grass'}}}
    attributes = [{'name': 'position', 'type': 'int32', 'size': 12, 'numElements': 3, 'min': [.1, .1, 1], 'max': [2.2, 1.1, 25]}]
    attributes += [{'name': name, 'type': kind, 'size': size, 'numElements': n} for name, kind, size, n in [('rgb', 'uint16', 6, 3), ('point source id', 'uint16', 2, 1), ('source_row', 'uint32', 4, 1), ('semantic_id', 'uint8', 1, 1)]]
    metadata = {'version': '2.0', 'encoding': 'UNCOMPRESSED', 'points': len(points), 'scale': [.001] * 3, 'offset': [0] * 3, 'hierarchy': {'firstChunkSize': 22}, 'boundingBox': {'min': [0, 0, 0], 'max': [26, 26, 26]}, 'attributes': attributes}
    payload = b''.join(struct.pack('<iiiHHHHIB', x, y, z, 65535, 0, 0, 42, row, label) for row, (x, y, z, label) in enumerate(points))
    (root / 'cloud.json').write_text(json.dumps(descriptor))
    (root / 'octree/metadata.json').write_text(json.dumps(metadata))
    (root / 'octree/hierarchy.bin').write_bytes(struct.pack('<BBIQQ', 1, 0, len(points), 0, len(payload)))
    (root / 'octree/octree.bin').write_bytes(payload)


class ElevationTests(unittest.TestCase):
    def test_ground_surface_counts_nodata_and_standard_geotiff(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            original = producer.digest(root / 'octree/octree.bin')
            model = producer.prepare(root)
            self.assertEqual(model['coverage'], {'sourcePoints': 11, 'groundPoints': 8})
            with rasterio.open(root / 'elevation/dtm.tif') as dtm, rasterio.open(root / 'elevation/dsm.tif') as dsm, rasterio.open(root / 'elevation/support.tif') as counts:
                self.assertIsNone(dtm.crs)
                self.assertEqual(dtm.transform.c, 0)
                self.assertEqual(dtm.transform.f, 2)
                self.assertEqual(dtm.transform.e, -1)
                self.assertTrue(dtm.profile['tiled'])
                self.assertEqual(dtm.read(1)[1, 0], 11)
                self.assertEqual(dsm.read(1)[1, 0], 20)
                self.assertTrue(np.isnan(dtm.read(1)[1, 1]))
                self.assertEqual(dsm.read(1)[1, 1], 25)
                self.assertTrue(np.isnan(dtm.read(1)[1, 2]))
                self.assertEqual(dsm.read(1)[1, 2], 7)
                self.assertTrue(np.isnan(dtm.read(1)[0, 1]))
                self.assertTrue(np.isnan(dsm.read(1)[0, 1]))
                self.assertEqual(counts.read(1)[1, 0], 3)
                self.assertEqual(counts.read(2)[1, 0], 4)
            self.assertEqual(producer.digest(root / 'octree/octree.bin'), original)
            with self.assertRaises(FileExistsError):
                producer.prepare(root)

    def test_invalid_settings_and_unmapped_ground_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            with self.assertRaises(ValueError):
                producer.prepare(root, resolution=0)
            with self.assertRaises(ValueError):
                producer.prepare(root, ground_labels=[16])
            self.assertFalse((root / 'elevation').exists())


if __name__ == '__main__':
    unittest.main()
