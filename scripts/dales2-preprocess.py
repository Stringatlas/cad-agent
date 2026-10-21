#!/usr/bin/env python3
"""Stream one DALES-2 tile to a provenance-preserving prepared cloud; never merge local frames."""
import argparse
import json
from pathlib import Path
import subprocess

import laspy
import numpy as np
from dataset_recipe import digest, load_recipe

RECIPE = Path(__file__).resolve().parents[1] / 'config/dataset-recipes/dales2.json'
# Display colors, not sensor RGB or a semantic remapping.
PALETTE = np.array([[150,135,110], [95,160,85], [225,85,75], [245,195,65],
                    [165,125,95], [45,120,65], [220,110,65], [190,85,130],
                    [185,120,55], [165,110,205], [225,195,115], [115,150,205],
                    [170,185,205], [120,145,180], [145,165,190]], dtype=np.uint16) * 257
EXTRAS = [('source_row', np.uint32), ('instance', np.int16),
          ('legacy_semantic', np.int16), ('legacy_instance', np.int16)]


def convert_tile(raw, target, source, chunk=250000):
    """Bounded LAZ decode; preserve exact centimeter grid and original row identity."""
    if type(chunk) is not int or not 1 <= chunk <= 1000000:
        raise ValueError('Chunk must be 1..1000000')
    path = raw / source['file']
    if path.stat().st_size != source['bytes'] or digest(path) != source['sha256']:
        raise ValueError('Source integrity mismatch')
    header = laspy.LasHeader(point_format=3, version='1.2')
    header.scales = [0.01] * 3
    header.offsets = [0.0] * 3
    header.add_extra_dims([laspy.ExtraBytesParams(name=n, type=t) for n, t in EXTRAS])
    counts = np.zeros(15, dtype=np.int64)
    start = 0
    with laspy.open(path) as reader:
        h = reader.header
        if h.point_count != source['points'] or h.scales.tolist() != [0.01]*3 or h.offsets.tolist() != [0.0]*3:
            raise ValueError('Unexpected DALES local-grid schema')
        with laspy.open(target, mode='w', header=header) as writer:
            for src in reader.chunk_iterator(chunk):
                labels = np.asarray(src.classification)
                if np.any(labels > 14):
                    raise ValueError('Unknown DALES-2 classification')
                dst = laspy.ScaleAwarePointRecord.zeros(len(src), header=header)
                for name in ['X', 'Y', 'Z', 'intensity', 'gps_time', 'return_number', 'number_of_returns']:
                    dst[name] = src[name]
                dst.classification = labels
                dst.point_source_id[:] = source['source_file_id']
                dst.source_row = np.arange(start, start + len(src), dtype=np.uint32)
                for name, _ in EXTRAS[1:]:
                    dst[name] = src[name]
                # Per-tile policy: preserve real RGB; synthesize only for entirely black/absent RGB.
                for axis, name in enumerate(['red', 'green', 'blue']):
                    dst[name] = src[name] if source['nonblack_rgb_points'] else PALETTE[labels, axis]
                counts += np.bincount(labels, minlength=15)
                writer.write_points(dst)
                start += len(src)
    if start != source['points'] or digest(path) != source['sha256']:
        raise ValueError('Source changed during conversion')
    return {str(i): int(v) for i, v in enumerate(counts) if v}


def run(raw, out, converter, tile='5080_54435', chunk=250000):
    recipe = load_recipe(RECIPE)
    matches = [s for s in recipe['sources'] if s['file'] == tile + '.laz']
    if len(matches) != 1:
        raise ValueError('Tile must be a registered DALES-2 source stem')
    source = matches[0]
    converter = converter.resolve(strict=True)
    if digest(converter) != recipe['converter']['reference_executable_sha256']:
        raise ValueError('Converter binary mismatch; independently qualify another build before use')
    # Source verified before output creation; failures never publish cloud.json.
    if digest(raw / source['file']) != source['sha256']:
        raise ValueError('Source integrity mismatch')
    out.mkdir(parents=True, exist_ok=False)
    las = out / (tile + '.las')
    counts = convert_tile(raw, las, source, chunk)
    command = [str(converter), str(las.resolve()), '-o', str((out / 'octree').resolve()), '-m', 'poisson', '--encoding', 'UNCOMPRESSED']
    with (out / 'converter.log').open('w') as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
    metadata = json.loads((out / 'octree/metadata.json').read_text())
    if metadata['points'] != source['points'] or metadata['encoding'] != 'UNCOMPRESSED':
        raise ValueError('Converter count/encoding mismatch')
    cloud = {'version': 1, 'format': 'potree2-uncompressed', 'id': 'dales2-' + tile.replace('_', '-'),
             'frameId': 'dales2-' + tile.replace('_', '-') + '-local',
             'coordinates': {'units': 'm', 'handedness': 'right', 'upAxis': 'Z', 'localOrigin': [0, 0, 0]},
             'sources': [{'id': source['source_file_id'], 'name': source['file'], 'points': source['points']}],
             'semantics': {'attribute': 'classification', 'type': 'uint8', 'classes': recipe['semantic_classes']}}
    manifest = {'format': 'DALES-2 prepared tile v1', 'recipe_sha256': digest(RECIPE), 'source': source,
                'classification_counts': counts, 'coordinates': cloud['coordinates'],
                'crs': 'Unknown; source is independently normalized per tile, no georeferencing VLR. No inter-tile transform inferred from filename.',
                'provenance': 'point source id = recipe ID; source_row = zero-based original LAZ record index',
                'rgb': 'Preserved source RGB16' if source['nonblack_rgb_points'] else 'Synthetic DALES-2 class display palette; original RGB absent or entirely zero, not photometric imagery',
                'palette_rgb16': PALETTE.tolist(), 'retained_attributes': ['XYZ', 'classification', 'intensity', 'gps_time', 'return_number', 'number_of_returns'] + [n for n, _ in EXTRAS],
                'not_retained': 'LAS scan/flight flags, scan angle, user_data, original point_source_id; preserved in raw LAZ',
                'converter': {'command': command, 'sha256': digest(converter)},
                'dependencies': {'numpy': np.__version__, 'laspy': laspy.__version__, 'lazrs': '0.8.2'},
                'assets': {n: {'bytes': (out/n).stat().st_size, 'sha256': digest(out/n)} for n in [las.name, 'octree/metadata.json', 'octree/hierarchy.bin', 'octree/octree.bin']}}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    # Full offline validation must succeed before the runtime descriptor is published.
    subprocess.run([__import__('sys').executable, str(Path(__file__).with_name('dales2-validate.py')), '--raw', str(raw), '--out', str(out)], check=True)
    (out / 'cloud.json').write_text(json.dumps(cloud, indent=2) + '\n')
    print(f'Completed {out}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('data/raw/DALES-2/train'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--converter', type=Path, required=True)
    parser.add_argument('--tile', default='5080_54435')
    parser.add_argument('--chunk', type=int, default=250000)
    args = parser.parse_args()
    run(args.raw, args.out, args.converter, args.tile, args.chunk)
