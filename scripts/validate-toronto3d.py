#!/usr/bin/env python3
"""Independent full-data Toronto3D audit (numpy + laspy; originals are read-only).

Point buffers are capped by --chunk. Original/preview arrays are read-only mmap;
provenance coverage uses a temporary disk-backed byte per original point. Small
hierarchy queues/intervals scale with node count, not with point count. A report
is emitted only after every check passes. No preprocessing module is imported.
"""
import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import struct
import tempfile

import laspy
import numpy as np

SCALARS = ('scalar_Intensity', 'scalar_GPSTime', 'scalar_ScanAngleRank', 'scalar_Label')
SOURCE_DTYPE = np.dtype([(a, '<f8') for a in 'xyz'] +
                        [(a, 'u1') for a in ('red', 'green', 'blue')] +
                        [(a, '<f4') for a in SCALARS])
ENTRY = struct.Struct('<BBIQQ')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def source_array(path):
    expected = [('double', a) for a in 'xyz'] + [
        ('uchar', a) for a in ('red', 'green', 'blue')] + [('float', a) for a in SCALARS]
    with path.open('rb') as stream:
        lines = []
        for _ in range(100):
            line = stream.readline(4096)
            require(bool(line) and line.endswith(b'\n'), f'{path}: malformed header')
            lines.append(line.decode('ascii').strip())
            if lines[-1] == 'end_header':
                break
        else:
            raise ValueError(f'{path}: header too long')
        offset = stream.tell()
    elements = [line.split()[1:] for line in lines if line.startswith('element ')]
    properties = [tuple(line.split()[1:]) for line in lines if line.startswith('property ')]
    require(lines[0] == 'ply' and 'format binary_little_endian 1.0' in lines and
            properties == expected and len(elements) == 1 and elements[0][0] == 'vertex',
            f'{path}: unexpected source schema')
    count = int(elements[0][1])
    require(count > 0 and path.stat().st_size == offset + count * SOURCE_DTYPE.itemsize,
            f'{path}: source size mismatch')
    return np.memmap(path, mode='r', offset=offset, dtype=SOURCE_DTYPE, shape=(count,))


def potree_dtype(metadata):
    types = {'int8': 'i1', 'uint8': 'u1', 'int16': '<i2', 'uint16': '<u2',
             'int32': '<i4', 'uint32': '<u4', 'int64': '<i8', 'uint64': '<u8',
             'float': '<f4', 'double': '<f8'}
    fields = []
    for attr in metadata['attributes']:
        require(attr['type'] in types, f"Unsupported attribute type: {attr['type']}")
        base = np.dtype(types[attr['type']])
        n = attr['numElements']
        require(n > 0 and base.itemsize == attr['elementSize'] and
                base.itemsize * n == attr['size'], f"Invalid attribute layout: {attr['name']}")
        fields.append((attr['name'], base, (n,)) if n != 1 else (attr['name'], base))
    dtype = np.dtype(fields)
    expected = {'position': ('i', 4, (3,)), 'rgb': ('u', 2, (3,)),
                'point source id': ('u', 2, ()), 'source_row': ('u', 4, ())}
    expected.update({name: ('f', 4, ()) for name in SCALARS})
    for name, (kind, size, shape) in expected.items():
        require(name in dtype.names, f'Missing Potree attribute: {name}')
        field = dtype.fields[name][0]
        require(field.base.kind == kind and field.base.itemsize == size and field.shape == shape,
                f'Unexpected Potree attribute schema: {name}')
    return dtype


def covered(intervals, total, label):
    cursor = 0
    for offset, size in sorted(intervals):
        require(offset == cursor, f'{label}: overlapping or unaddressed bytes at {cursor}/{offset}')
        cursor += size
    require(cursor == total, f'{label}: trailing unaddressed bytes')


def hierarchy_nodes(path, metadata, stride, octree_size, stats):
    """Yield real nodes by recursively following proxy chunks, each chunk BFS."""
    length = path.stat().st_size
    pending = deque([('r', 0, metadata['hierarchy']['firstChunkSize'], None)])
    chunks, payloads, visited = [], [], set()
    stats.update(nodes=0, internal_nodes=0, leaf_nodes=0, proxy_nodes=0, max_depth=0)
    with path.open('rb') as stream:
        while pending:
            root, offset, size, proxy = pending.popleft()
            require(size > 0 and size % ENTRY.size == 0 and offset >= 0 and
                    offset + size <= length, f'{root}: hierarchy chunk out of bounds')
            require(offset not in visited, f'{root}: cyclic/shared hierarchy chunk')
            visited.add(offset)
            chunks.append((offset, size))
            names = deque([root])
            stream.seek(offset)
            # Read entries individually, not an unbounded chunk allocation.
            for index in range(size // ENTRY.size):
                require(bool(names), f'{root}: excess hierarchy entries')
                name = names.popleft()
                typ, mask, count, target, byte_size = ENTRY.unpack(stream.read(ENTRY.size))
                require(typ in (0, 1, 2), f'{name}: unknown node type')
                if index == 0 and proxy is not None:
                    require((mask, count) == proxy, f'{name}: proxy/root disagreement')
                if typ == 2:
                    stats['proxy_nodes'] += 1
                    pending.append((name, target, byte_size, (mask, count)))
                    continue
                require(typ != 1 or mask == 0, f'{name}: leaf with children')
                require(typ != 0 or mask != 0, f'{name}: internal node without children')
                require(byte_size == count * stride and target + byte_size <= octree_size,
                        f'{name}: invalid point payload range/count')
                if byte_size:
                    payloads.append((target, byte_size))
                stats['nodes'] += 1
                stats['internal_nodes' if mask else 'leaf_nodes'] += 1
                stats['max_depth'] = max(stats['max_depth'], len(name) - 1)
                for child in range(8):
                    if mask & (1 << child):
                        names.append(name + str(child))
                yield name, count, target
            require(not names, f'{root}: missing child hierarchy entries')
    covered(chunks, length, 'hierarchy.bin')
    covered(payloads, octree_size, 'octree.bin')
    require(stats['internal_nodes'] > 0 and stats['max_depth'] > 0,
            'No addressable multilevel LOD hierarchy')


def compare(src, rgb, scalar_values, xyz, origin, tolerance, label, maxima):
    expected_rgb = np.column_stack([src[a] for a in ('red', 'green', 'blue')]).astype(np.uint16) * 257
    require(np.array_equal(rgb, expected_rgb), f'{label}: RGB mismatch')
    for a in SCALARS:
        # Compare float32 bits, including signed zero (not just numeric equality).
        require(np.array_equal(np.asarray(scalar_values[a]).view(np.uint32),
                               np.asarray(src[a]).view(np.uint32)), f'{label}: {a} mismatch')
    original = np.column_stack([src[a] for a in 'xyz'])
    require(np.isfinite(xyz).all() and np.isfinite(original).all(), f'{label}: nonfinite coordinates')
    local_error = np.abs(xyz - (original - origin))
    world_error = np.abs((xyz + origin) - original)
    error = np.maximum(local_error, world_error)
    # Floating arithmetic at large UTM values introduces a sub-nanometer term.
    epsilon = 8 * np.finfo(np.float64).eps * np.maximum(np.abs(original), 1)
    require(np.all(error <= tolerance + epsilon), f'{label}: coordinate tolerance exceeded; max {error.max(axis=0)}')
    maxima[:] = np.maximum(maxima, error.max(axis=0))


def run(raw, prepared, chunk, scratch):
    require(chunk > 0, '--chunk must be positive')
    manifest = json.loads((prepared / 'manifest.json').read_text())
    metadata = json.loads((prepared / 'octree/metadata.json').read_text())
    require(metadata['version'] == '2.0' and metadata['encoding'] == 'UNCOMPRESSED',
            'Only Potree 2 UNCOMPRESSED is supported')
    require(manifest['units'] == 'm' and manifest['frame'] == 'right-handed Z-up', 'Unexpected units/frame')
    origin = np.asarray(manifest['local_origin_world'], dtype=np.float64)
    scale = np.asarray(metadata['scale'], dtype=np.float64)
    offset = np.asarray(metadata['offset'], dtype=np.float64)
    require(origin.shape == scale.shape == offset.shape == (3,) and
            np.isfinite(origin).all() and np.isfinite(offset).all() and
            np.isfinite(scale).all() and (scale > 0).all(), 'Invalid coordinate metadata')
    require(np.array_equal(scale, manifest['potree_scale_m']), 'Manifest/Potree scale mismatch')
    class_lines = (raw / 'Mavericks_classes_9.txt').read_text().splitlines()
    expected_classes = {line.split()[1]: line.split()[0] for line in class_lines if line.strip()}
    require(manifest['semantic_attribute'] == 'scalar_Label' and
            manifest['semantic_classes'] == expected_classes, 'Semantic mapping mismatch')
    bounds = np.asarray([metadata['boundingBox']['min'], metadata['boundingBox']['max']], dtype=np.float64)
    require(bounds.shape == (2, 3) and np.isfinite(bounds).all() and
            (bounds[1] > bounds[0]).all(), 'Invalid Potree bounds')
    require(np.allclose(bounds[1] - bounds[0], bounds[1, 0] - bounds[0, 0], atol=1e-8, rtol=0),
            'Potree root bounds must be cubic')
    las_scale = float(manifest['las_quantization_m'])
    require(np.isfinite(las_scale) and las_scale > 0, 'Invalid LAS quantization')
    tolerance = scale + las_scale / 2
    sources, infos = {}, {}
    require(len(manifest['sources']) == 4, 'Expected four manifest sources')
    for info in manifest['sources']:
        fid = info['source_file_id']
        require(fid in range(1, 5) and fid not in sources and info['file'] == f'L{fid:03}.ply', 'Invalid source identity')
        path = raw / info['file']
        print(f'Checking original {path.name}', flush=True)
        require(path.stat().st_size == info['bytes'] and digest(path) == info['sha256'], f'{path}: SHA/size mismatch')
        src = source_array(path)
        require(len(src) == info['points'], f'{path}: count mismatch')
        sources[fid], infos[fid] = src, info
        low, high, histogram = np.full(3, np.inf), np.full(3, -np.inf), np.zeros(9, dtype=np.int64)
        nonfinite = {a: 0 for a in SCALARS}
        for start in range(0, len(src), chunk):
            block = src[start:start + chunk]
            xyz = np.column_stack([block[a] for a in 'xyz'])
            require(np.isfinite(xyz).all(), 'Nonfinite original positions')
            for a in SCALARS:
                nonfinite[a] += int(np.count_nonzero(~np.isfinite(block[a])))
            labels = block['scalar_Label']
            require(((labels >= 0) & (labels <= 8) & (labels == np.floor(labels))).all(), 'Invalid original labels')
            low, high = np.minimum(low, xyz.min(axis=0)), np.maximum(high, xyz.max(axis=0))
            histogram += np.bincount(labels.astype(np.int64), minlength=9)
        require(np.array_equal([low, high], info['world_bounds']) and
                np.array_equal(histogram, info['label_counts']) and
                nonfinite == info['nonfinite_scalar_counts'], f'{path}: manifest bounds/labels/nonfinite mismatch')
    total = sum(len(src) for src in sources.values())
    require(total == metadata['points'], 'Metadata total mismatch')
    preview_path = Path(manifest['preview']['path'])
    require(preview_path == Path('preview.npy'), 'Unexpected preview path')
    preview = np.load(prepared / preview_path, mmap_mode='r', allow_pickle=False)
    preview_dtype = np.dtype(SOURCE_DTYPE.descr + [('source_file', '<u2'), ('source_row', '<u4')])
    require(preview.ndim == 1 and preview.dtype == preview_dtype and
            len(preview) == manifest['preview']['points'], 'Preview schema/count mismatch')
    preview_max = np.zeros(3)
    for fid, src in sources.items():
        indices = np.flatnonzero(preview['source_file'] == fid)
        require(len(indices) > 0, f'Missing preview source {fid}')
        rows = preview['source_row'][indices]
        require(np.array_equal(rows, np.linspace(0, len(src) - 1, len(rows), dtype=np.uint32)), 'Preview sampling mismatch')
        for start in range(0, len(indices), chunk):
            block = preview[indices[start:start + chunk]]
            original = src[block['source_row']]
            rgb = np.column_stack([block[a] for a in ('red', 'green', 'blue')]).astype(np.uint16) * 257
            compare(original, rgb, block, np.column_stack([block[a] for a in 'xyz']), origin,
                    np.zeros(3), 'preview', preview_max)
    require(np.isin(preview['source_file'], list(sources)).all(), 'Unknown preview source')
    las_max = np.zeros(3)
    for fid, src in sources.items():
        print(f'Checking LAS source {fid}', flush=True)
        with laspy.open(prepared / 'las' / f'L{fid:03}.las') as reader:
            require(reader.header.point_count == len(src) and
                    np.array_equal(reader.header.scales, [las_scale] * 3) and
                    np.array_equal(reader.header.offsets, [0, 0, 0]), 'LAS count/scale/offset mismatch')
            start = 0
            for block in reader.chunk_iterator(chunk):
                end = start + len(block)
                require((block.point_source_id == fid).all() and
                        np.array_equal(block['source_row'], np.arange(start, end, dtype=np.uint32)), 'LAS provenance mismatch')
                compare(src[start:end], np.column_stack([block.red, block.green, block.blue]),
                        block, np.column_stack([block.x, block.y, block.z]), origin,
                        np.full(3, las_scale / 2), f'LAS {fid}:{start}', las_max)
                start = end
            require(start == len(src), 'LAS dropped rows')
    dtype = potree_dtype(metadata)
    octree_path = prepared / 'octree/octree.bin'
    stats, potree_max = {}, np.zeros(3)
    per_source = {fid: 0 for fid in sources}
    with tempfile.TemporaryDirectory(prefix='toronto3d-validation-', dir=scratch) as temporary:
        seen = {fid: np.memmap(Path(temporary) / f'{fid}.seen', mode='w+', dtype='u1', shape=(len(src),))
                for fid, src in sources.items()}
        checked = 0
        with octree_path.open('rb') as stream:
            for name, count, byte_offset in hierarchy_nodes(prepared / 'octree/hierarchy.bin', metadata,
                                                           dtype.itemsize, octree_path.stat().st_size, stats):
                node_low, node_high = bounds[0].copy(), bounds[1].copy()
                for digit in name[1:]:
                    middle = (node_low + node_high) / 2
                    upper = np.array([int(digit) & 4, int(digit) & 2, int(digit) & 1], dtype=bool)
                    node_low = np.where(upper, middle, node_low)
                    node_high = np.where(upper, node_high, middle)
                stream.seek(byte_offset)
                for start in range(0, count, chunk):
                    n = min(chunk, count - start)
                    block = np.frombuffer(stream.read(n * dtype.itemsize), dtype=dtype)
                    require(len(block) == n, f'{name}: truncated payload')
                    local_positions = block['position'].astype(np.float64) * scale + offset
                    require(((local_positions >= node_low - tolerance) &
                             (local_positions <= node_high + tolerance)).all(),
                            f'{name}: points outside node spatial bounds')
                    ids = block['point source id']
                    require(np.isin(ids, list(sources)).all(), f'{name}: invalid source id')
                    for fid, src in sources.items():
                        selected = block[ids == fid]
                        if not len(selected):
                            continue
                        rows = selected['source_row']
                        require((rows < len(src)).all(), f'{name}: source row out of range')
                        require(len(np.unique(rows)) == len(rows) and not seen[fid][rows].any(), f'{name}: duplicate source row')
                        seen[fid][rows] = 1
                        xyz = selected['position'].astype(np.float64) * scale + offset
                        compare(src[rows], selected['rgb'], selected, xyz, origin, tolerance,
                                f'Potree {name}/source {fid}', potree_max)
                        per_source[fid] += len(rows)
                    checked += n
        require(checked == total, 'Hierarchy point count mismatch')
        for fid, bitmap in seen.items():
            require(per_source[fid] == len(sources[fid]), f'Source {fid}: dropped points')
            for start in range(0, len(bitmap), chunk):
                require((bitmap[start:start + chunk] == 1).all(), f'Source {fid}: unvisited rows')
            bitmap.flush()
            bitmap._mmap.close()
    for name in ('Colors.xml', 'Mavericks_classes_9.txt'):
        require(digest(raw / name) == digest(prepared / name), f'{name}: copied sidecar mismatch')
    return {'status': 'PASS', 'points': total, 'per_source_points': per_source,
            'preview_points': len(preview), 'hierarchy': stats, 'record_bytes': dtype.itemsize,
            'coordinate_tolerance_m': tolerance.tolist(),
            'max_coordinate_error_m': {'preview': preview_max.tolist(), 'las': las_max.tolist(),
                                       'potree': potree_max.tolist()},
            'checks': ['original SHA256/count/bounds/labels', 'LAS every record', 'preview every record',
                       'semantic class mapping', 'cubic root and every node spatial containment',
                       'hierarchy BFS/proxies and complete nonoverlapping payload coverage',
                       'Potree every record RGB/scalar bits/coordinates/provenance',
                       'one-to-one source row coverage', 'sidecar SHA256']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('data/raw/toronto3d'))
    parser.add_argument('--prepared', type=Path, default=Path('data/processed/toronto3d/prepared'))
    parser.add_argument('--chunk', type=int, default=250000)
    parser.add_argument('--scratch', type=Path, help='Directory for temporary disk-backed seen bitmaps')
    parser.add_argument('--report', type=Path, help='Optional JSON report, written only on success')
    args = parser.parse_args()
    report = run(args.raw, args.prepared, args.chunk, args.scratch)
    text = json.dumps(report, indent=2) + '\n'
    if args.report:
        args.report.write_text(text)
    print(text, end='')
