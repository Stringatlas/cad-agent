"""Real-world PLY schema, actual converter round trip, and corruption rejection."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

producer = load('realworld', 'scripts/stpls3d-realworld-preprocess.py')
auditor = load('auditor', 'scripts/stpls3d-validate.py')

class RealworldTests(unittest.TestCase):
    def write_ply(self, path, points):
        header = '\n'.join(['ply', 'format binary_little_endian 1.0', f'element vertex {len(points)}', *producer.PROPERTIES, 'end_header', ''])
        path.write_bytes(header.encode('ascii') + points.tobytes())

    def test_schema_and_invalid_positions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'RA_points.ply'
            points = np.zeros(1, dtype=producer.DTYPE)
            points['x'] = np.nan
            self.write_ply(path, points)
            with self.assertRaisesRegex(ValueError, 'Nonfinite'):
                list(producer.checked_chunks(producer.read_ply(path)))
            points['x'], points['class'] = 0, 16
            self.write_ply(path, points)
            with self.assertRaisesRegex(ValueError, 'Unknown native'):
                list(producer.checked_chunks(producer.read_ply(path)))
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, 'size/count'):
                producer.read_ply(path)

    def test_real_roundtrip_and_corruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / 'raw'
            raw.mkdir()
            path, recipe_path, out = raw / 'RA_points.ply', Path(tmp) / 'recipe.json', Path(tmp) / 'out'
            points = np.zeros(4096, dtype=producer.DTYPE)
            rng = np.random.default_rng(123)
            for axis in 'xyz':
                points[axis] = rng.uniform(-200, 200, len(points))
            for name in ['red', 'green', 'blue']:
                points[name] = rng.integers(0, 256, len(points))
            points['class'] = rng.choice([0, 1, 2, 4, 5, 14, 19], len(points))
            self.write_ply(path, points)
            producer.enroll(raw, recipe_path, producer.CONVERTER)
            recipe = producer.load_recipe(recipe_path)
            producer.prepare(raw, out, recipe['sources'][0], recipe, recipe_path, producer.CONVERTER)
            self.assertEqual(json.loads((out / 'validation.json').read_text())['points'], len(points))
            self.assertNotIn('instances', json.loads((out / 'cloud.json').read_text()))
            metadata = json.loads((out / 'octree/metadata.json').read_text())
            offset = 0
            for attr in metadata['attributes']:
                if attr['name'] == 'semantic_id':
                    break
                offset += attr['size']
            payload = out / 'octree/octree.bin'
            with payload.open('r+b') as stream:
                stream.seek(offset)
                stream.write(b'\xff')
            manifest_path = out / 'manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['assets']['octree/octree.bin']['sha256'] = producer.digest(payload)
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'semantic_id mismatch'):
                auditor.validate(raw, out, chunk=127)
            with self.assertRaises(FileExistsError):
                producer.prepare(raw, out, recipe['sources'][0], recipe, recipe_path, producer.CONVERTER)

if __name__ == '__main__':
    unittest.main()
