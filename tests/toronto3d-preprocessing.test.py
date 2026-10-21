"""Standalone Python fixture checks; not part of the Node test glob."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch
import json

import laspy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
spec = importlib.util.spec_from_file_location('preprocess', Path(__file__).resolve().parents[1] / 'scripts/preprocess-toronto3d.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PreprocessingTests(unittest.TestCase):
    def fixture(self, root):
        p = root / 'fixture.ply'
        points = np.zeros(17, dtype=m.DTYPE)
        for i, a in enumerate('xyz'):
            points[a] = m.ORIGIN[i] + np.arange(17) * 0.1234567 - 0.9876543
        for a in ['red', 'green', 'blue']:
            points[a] = np.arange(17) * 13
        for a in m.SCALARS:
            points[a] = np.arange(17) % 9 if a == 'scalar_Label' else np.arange(17) - 3.25
        header = 'ply\nformat binary_little_endian 1.0\nelement vertex 17\n' + ''.join(f'property {typ} {name}\n' for typ, name in m.PROPERTIES) + 'end_header\n'
        p.write_bytes(header.encode() + points.tobytes())
        return p, points

    def test_chunked_attributes_and_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p, points = self.fixture(root)
            before = m.sha256(p)
            info, preview = m.convert(p, root / 'fixture.las', 4, 3, 5)
            las = laspy.read(root / 'fixture.las')
            self.assertEqual(m.sha256(p), before)
            self.assertEqual(info['points'], 17)
            self.assertEqual(sum(info['label_counts']), 17)
            np.testing.assert_array_equal(las.source_row, np.arange(17))
            np.testing.assert_array_equal(las.point_source_id, np.full(17, 4))
            for i, a in enumerate('xyz'):
                np.testing.assert_allclose(getattr(las, a), points[a] - m.ORIGIN[i], atol=0.00050001, rtol=0)
            for a in m.SCALARS:
                np.testing.assert_array_equal(las[a], points[a])
            for a in ['red', 'green', 'blue']:
                np.testing.assert_array_equal(getattr(las, a), points[a].astype(np.uint16) * 257)
            np.testing.assert_array_equal(preview['source_row'], [0, 4, 8, 12, 16])
            self.assertEqual(preview.dtype['x'], np.dtype('<f8'))

    def test_preserve_nonfinite_intensity_bits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p, _ = self.fixture(root)
            data = m.ply(p).copy()
            data['scalar_Intensity'][2] = np.nan
            data['scalar_Intensity'][3] = np.inf
            blob = p.read_bytes()
            p.write_bytes(blob[:-data.nbytes] + data.tobytes())
            info, _ = m.convert(p, root / 'nonfinite.las', 1, 3, 5)
            las = laspy.read(root / 'nonfinite.las')
            np.testing.assert_array_equal(las['scalar_Intensity'].view(np.uint32), data['scalar_Intensity'].view(np.uint32))
            self.assertEqual(info['nonfinite_scalar_counts']['scalar_Intensity'], 2)

    def test_reject_truncated_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            p, _ = self.fixture(Path(tmp))
            p.write_bytes(p.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                m.ply(p)

    def test_recipe_ids_and_completion_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p, _ = self.fixture(root)
            (root / 'Colors.xml').write_text('fixture colors')
            recipe = m.load_recipe()
            recipe['sources'] = [{'file': p.name, 'source_file_id': 4, 'points': 17,
                                  'bytes': p.stat().st_size, 'sha256': m.sha256(p)}]
            recipe['sidecars'] = [{'file': 'Colors.xml', 'sha256': m.sha256(root / 'Colors.xml')}]
            converter = root / 'converter'
            converter.write_text('fixture, subprocess mocked')
            out = root / 'prepared'

            def fake_converter(command, **kwargs):
                self.assertIn(str((out / 'las/fixture.las').resolve()), command)
                (out / 'octree').mkdir()
                (out / 'octree/metadata.json').write_text(json.dumps({'points': 17, 'scale': [0.001] * 3}))

            with patch.object(m, 'load_recipe', return_value=recipe), patch.object(m.subprocess, 'run', side_effect=fake_converter):
                m.run(root, out, converter, chunk=3, preview_limit=5)
            manifest = json.loads((out / 'manifest.json').read_text())
            self.assertEqual(manifest['sources'][0]['source_file_id'], 4)
            self.assertEqual(manifest['recipe']['sha256'], m.sha256(m.DEFAULT_RECIPE))
            np.testing.assert_array_equal(laspy.read(out / 'las/fixture.las').point_source_id, [4] * 17)
            with self.assertRaises(FileExistsError), patch.object(m, 'load_recipe', return_value=recipe):
                m.run(root, out, converter)
            p.write_bytes(b'changed')
            failed = root / 'failed'
            with self.assertRaises(ValueError), patch.object(m, 'load_recipe', return_value=recipe):
                m.run(root, failed, converter)
            self.assertFalse(failed.exists())

    def test_converter_failure_has_no_completion_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p, _ = self.fixture(root)
            recipe = m.load_recipe()
            recipe['sources'] = [{'file': p.name, 'source_file_id': 2, 'points': 17,
                                  'bytes': p.stat().st_size, 'sha256': m.sha256(p)}]
            recipe['sidecars'] = []
            converter = root / 'converter'
            converter.touch()
            out = root / 'failed'
            with patch.object(m, 'load_recipe', return_value=recipe), patch.object(m.subprocess, 'run', side_effect=RuntimeError('fixture converter failure')):
                with self.assertRaisesRegex(RuntimeError, 'fixture converter failure'):
                    m.run(root, out, converter, chunk=3, preview_limit=5)
            self.assertTrue(out.exists())
            self.assertFalse((out / 'manifest.json').exists())

    def test_reject_unknown_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p, _ = self.fixture(root)
            blob = bytearray(p.read_bytes())
            blob[-4:] = np.float32(9).tobytes()
            p.write_bytes(blob)
            with self.assertRaises(ValueError):
                m.convert(p, root / 'bad.las', 1, 3, 5)


if __name__ == '__main__':
    unittest.main()
