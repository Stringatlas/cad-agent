"""STPLS3D parser, real LAS/Potree round trip, and independent corruption checks."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('producer', ROOT / 'scripts/stpls3d-preprocess.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)
spec = importlib.util.spec_from_file_location('auditor', ROOT / 'scripts/stpls3d-validate.py')
auditor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auditor)


class Stpls3dTests(unittest.TestCase):
    def test_parser_rejects_invalid_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.txt'
            for row in ['0,0,0,1,2,3,0', 'nan,0,0,1,2,3,0,-100',
                        '0,0,0,256,2,3,0,-100', '0,0,0,1.5,2,3,0,-100',
                        '0,0,0,1,2,3,16,-100', '0,0,0,1,2,3,0,-1',
                        '0,0,0,1,2,3,0,2147483648', '0,0,0,1,2,3,0,-100\n\n']:
                with self.subTest(row=row):
                    path.write_text(row + '\n')
                    with self.assertRaises(ValueError):
                        list(producer.read_rows(path))

    def test_chunk_and_signed_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.txt'
            path.write_bytes(b'-1,2,3,0,255,128,0,-100\r\n4,5,6,255,0,1,19,2147483647\r\n')
            blocks = list(producer.read_rows(path, 1))
            self.assertEqual(len(blocks), 2)
            self.assertEqual(blocks[0][0, 7], -100)
            self.assertEqual(blocks[1][0, 7], 2147483647)
            with self.assertRaises(ValueError):
                list(producer.read_rows(path, 0))

    @unittest.skipUnless(producer.CONVERTER.exists(), 'Qualified local PotreeConverter required')
    def test_real_roundtrip_and_corruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root / 'raw'
            raw.mkdir()
            rows = np.array([[x * 0.123456, y * -0.321234, z * 0.234567,
                              x * 10, y * 20, z * 30, (x + y + z) % 15,
                              -100 if x == 0 else 2147483647 if x == 1 else x]
                             for x in range(6) for y in range(6) for z in range(6)])
            np.savetxt(raw / '1_points_GTv3.txt', rows, delimiter=',', fmt='%.6f')
            recipe_path = root / 'recipe.json'
            producer.inspect_sources(raw, recipe_path, producer.CONVERTER, 31)
            recipe = producer.load_recipe(recipe_path)
            out = root / 'prepared' / '1'
            producer.prepare_scene(raw, out, recipe['sources'][0], recipe, recipe_path, producer.CONVERTER, 37)
            report = auditor.validate(raw, out, 29)
            self.assertEqual(report['points'], len(rows))
            self.assertTrue((out / 'cloud.json').exists())
            self.assertFalse(list(out.glob('*.las')))
            with self.assertRaises(FileExistsError):
                producer.prepare_scene(raw, out, recipe['sources'][0], recipe, recipe_path, producer.CONVERTER, 37)
            metadata = json.loads((out / 'octree/metadata.json').read_text())
            instance_offset = 0
            for attribute in metadata['attributes']:
                if attribute['name'] == 'instance_id':
                    break
                instance_offset += attribute['size']
            payload = out / 'octree/octree.bin'
            with payload.open('r+b') as stream:
                stream.seek(instance_offset)
                stream.write((123456).to_bytes(4, 'little', signed=True))
            manifest_path = out / 'manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['assets']['octree/octree.bin']['sha256'] = producer.digest(payload)
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'instance_id mismatch'):
                auditor.validate(raw, out, 29)


if __name__ == '__main__':
    unittest.main()
