"""Dependency-free recipe and source-integrity checks; run directly with Python."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from dataset_recipe import load_recipe, verify_sources


class DatasetRecipeTests(unittest.TestCase):
    def fixture(self, root):
        data = b'original source fixture'
        (root / 'fixture.ply').write_bytes(data)
        recipe = {'schema': 'spatial-dataset-recipe-v1', 'sources': [
            {'file': 'fixture.ply', 'source_file_id': 4, 'points': 1,
             'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}
        path = root / 'recipe.json'
        path.write_text(json.dumps(recipe))
        return path, recipe

    def test_default_release_identity(self):
        recipe = load_recipe()
        self.assertEqual([s['file'] for s in recipe['sources']], [f'L{i:03}.ply' for i in range(1, 5)])
        self.assertEqual([s['source_file_id'] for s in recipe['sources']], [1, 2, 3, 4])
        self.assertEqual(sum(s['points'] for s in recipe['sources']), 78320210)
        self.assertEqual(recipe['local_origin_world'], [627285, 4841948, 0])
        self.assertEqual(recipe['license']['spdx'], 'CC-BY-NC-4.0')

    def test_integrity_and_no_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path, _ = self.fixture(root)
            before = (root / 'fixture.ply').read_bytes()
            self.assertEqual(verify_sources(root, load_recipe(path)), ['fixture.ply'])
            self.assertEqual((root / 'fixture.ply').read_bytes(), before)
            (root / 'fixture.ply').write_bytes(b'X' + before[1:])
            with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                verify_sources(root, load_recipe(path))
            (root / 'fixture.ply').write_bytes(before[:-1])
            with self.assertRaisesRegex(ValueError, 'size mismatch'):
                verify_sources(root, load_recipe(path))
            (root / 'fixture.ply').unlink()
            with self.assertRaisesRegex(ValueError, 'Missing source'):
                verify_sources(root, load_recipe(path))

    def test_sidecar_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, recipe = self.fixture(root)
            (root / 'Colors.xml').write_bytes(b'colors')
            recipe['sidecars'] = [{'file': 'Colors.xml', 'sha256': hashlib.sha256(b'colors').hexdigest()}]
            self.assertEqual(verify_sources(root, recipe), ['fixture.ply', 'Colors.xml'])
            (root / 'Colors.xml').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
                verify_sources(root, recipe)

    def test_reject_unsafe_or_ambiguous_recipes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path, original = self.fixture(root)
            mutations = [
                lambda r: r.update(schema='unknown'),
                lambda r: r.update(sources=[]),
                lambda r: r['sources'][0].update(file='../outside.ply'),
                lambda r: r['sources'][0].update(file='/outside.ply'),
                lambda r: r['sources'][0].update(sha256='bad'),
                lambda r: r['sources'][0].update(source_file_id=0),
                lambda r: r['sources'][0].update(source_file_id=True),
                lambda r: r['sources'][0].update(points=0),
                lambda r: r['sources'][0].update(bytes=-1),
                lambda r: r['sources'].append(dict(r['sources'][0])),
                lambda r: r['sources'].append(dict(r['sources'][0], file='other.ply')),
            ]
            for mutation in mutations:
                with self.subTest(mutation=mutations.index(mutation)):
                    recipe = copy.deepcopy(original)
                    mutation(recipe)
                    path.write_text(json.dumps(recipe))
                    with self.assertRaises(ValueError):
                        load_recipe(path)


if __name__ == '__main__':
    unittest.main()
