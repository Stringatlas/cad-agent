#!/usr/bin/env python3
"""Independently compare every Potree record with its original STPLS3D TXT row."""
import argparse
from collections import deque
from itertools import islice
import json
from pathlib import Path
import struct
import tempfile

import numpy as np
from dataset_recipe import digest

MAX_ERROR_M = 0.001501  # 0.5 mm LAS rounding + up to 1 mm converter quantization.
REFERENCE = np.dtype([('xyz', '<f8', (3,)), ('rgb', 'u1', (3,)),
                      ('semantic_id', 'u1'), ('instance_id', '<i4')])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(raw, out, chunk=250000):
    require(type(chunk) is int and 1 <= chunk <= 1000000, 'Invalid chunk bound')
    manifest = json.loads((out / 'manifest.json').read_text())
    source = manifest['source']
    realworld = manifest.get('source_format') == 'stpls3d-realworld-ply-v1'
    original = raw / source['file']
    require(original.stat().st_size == source['bytes'] and digest(original) == source['sha256'], 'Source hash/size mismatch')
    for name, asset in manifest['assets'].items():
        require((out / name).stat().st_size == asset['bytes'] and digest(out / name) == asset['sha256'], 'Asset hash/size mismatch: ' + name)
    metadata = json.loads((out / 'octree/metadata.json').read_text())
    require(metadata['version'] == '2.0' and metadata['encoding'] == 'UNCOMPRESSED' and metadata['points'] == source['points'], 'Format/count mismatch')
    types = {'int8': 'i1', 'uint8': 'u1', 'int16': '<i2', 'uint16': '<u2',
             'int32': '<i4', 'uint32': '<u4', 'float': '<f4', 'double': '<f8',
             'int64': '<i8', 'uint64': '<u8'}
    fields = []
    for attr in metadata['attributes']:
        dt = np.dtype(types[attr['type']])
        n = attr['numElements']
        require(n > 0 and dt.itemsize == attr['elementSize'] and dt.itemsize * n == attr['size'], 'Attribute layout mismatch')
        fields.append((attr['name'], dt, (n,)) if n != 1 else (attr['name'], dt))
    dtype = np.dtype(fields)
    expected_attributes = [('position', np.dtype(('<i4', 3))), ('rgb', np.dtype(('<u2', 3))),
                           ('point source id', np.dtype('<u2')), ('source_row', np.dtype('<u4')),
                           ('semantic_id', np.dtype('u1'))]
    if not realworld:
        expected_attributes.append(('instance_id', np.dtype('<i4')))
    for name, expected in expected_attributes:
        require(name in dtype.names and dtype[name] == expected, 'Missing or mistyped attribute: ' + name)
    scale, offset = np.asarray(metadata['scale']), np.asarray(metadata['offset'])
    require(scale.shape == (3,) and offset.shape == (3,) and np.all(np.isfinite(scale)) and
            np.all(np.isfinite(offset)) and np.all(scale > 0) and np.all(scale <= 0.001), 'Invalid coordinate transform')
    bounds_min = np.asarray(metadata['boundingBox']['min'])
    bounds_max = np.asarray(metadata['boundingBox']['max'])
    payload, hierarchy = out / 'octree/octree.bin', out / 'octree/hierarchy.bin'
    payload_bytes, hierarchy_bytes = payload.stat().st_size, hierarchy.stat().st_size
    chunks, ranges, visited = [], [], set()
    nodes, total = 0, 0
    max_error = np.zeros(3)
    with tempfile.TemporaryDirectory(prefix='stpls3d-audit-') as tmp:
        reference = np.memmap(Path(tmp) / 'reference', mode='w+', dtype=REFERENCE, shape=(source['points'],))
        seen = np.memmap(Path(tmp) / 'seen', mode='w+', dtype='u1', shape=(source['points'],))
        seen[:] = 0
        # Decode source independently of the producer and temporary LAS.
        start = 0
        if realworld:
            with original.open('rb') as stream:
                header = []
                for _ in range(100):
                    line = stream.readline(4096).decode('ascii').strip()
                    header.append(line)
                    if line == 'end_header':
                        break
                require(header[0:2] == ['ply', 'format binary_little_endian 1.0'] and header[-1] == 'end_header', 'Invalid PLY header')
                require([line for line in header if line.startswith('element ')] == [f"element vertex {source['points']}"], 'PLY vertex count mismatch')
                require([line for line in header if line.startswith('property ')] ==
                        ['property float32 ' + axis for axis in 'xyz'] +
                        ['property uint8 ' + name for name in ['red', 'green', 'blue', 'class']], 'Unsupported PLY properties')
                ply_offset = stream.tell()
            source_dtype = np.dtype([(axis, '<f4') for axis in 'xyz'] + [(name, 'u1') for name in ['red', 'green', 'blue', 'class']])
            require(original.stat().st_size == ply_offset + source['points'] * source_dtype.itemsize, 'PLY payload size mismatch')
            vertices = np.memmap(original, mode='r', dtype=source_dtype, offset=ply_offset, shape=(source['points'],))
            for start in range(0, len(vertices), chunk):
                src = vertices[start:start + chunk]
                ref = reference[start:start + len(src)]
                ref['xyz'] = np.column_stack([src[axis] for axis in 'xyz'])
                require(np.all(np.isfinite(ref['xyz'])), 'Nonfinite PLY positions')
                ref['rgb'] = np.column_stack([src[name] for name in ['red', 'green', 'blue']])
                ref['semantic_id'] = src['class']
            del vertices
        else:
            with original.open('rb') as stream:
                while lines := list(islice(stream, chunk)):
                    rows = np.loadtxt(lines, delimiter=',', comments=None, ndmin=2)
                    require(rows.shape == (len(lines), 8) and np.all(np.isfinite(rows)), 'Invalid original rows')
                    require(start + len(rows) <= len(reference), 'Original count overflow')
                    require(np.all(rows[:, 3:] == np.rint(rows[:, 3:])), 'Nonintegral original attributes')
                    require(np.all((rows[:, 3:6] >= 0) & (rows[:, 3:6] <= 255)) and
                            np.all((rows[:, 6] >= 0) & (rows[:, 6] <= 255)) and
                            np.all((rows[:, 7] >= -2147483648) & (rows[:, 7] <= 2147483647)), 'Original attribute overflow')
                    ref = reference[start:start + len(rows)]
                    ref['xyz'], ref['rgb'] = rows[:, :3], rows[:, 3:6]
                    ref['semantic_id'], ref['instance_id'] = rows[:, 6], rows[:, 7]
                    start += len(rows)
            require(start == len(reference), 'Original count mismatch')
        pending = deque([(0, metadata['hierarchy']['firstChunkSize'], None)])
        with hierarchy.open('rb') as h, payload.open('rb') as p:
            while pending:
                off, size, proxy = pending.popleft()
                require(off not in visited and size > 0 and size % 22 == 0 and off + size <= hierarchy_bytes, 'Invalid hierarchy chunk')
                visited.add(off)
                chunks.append((off, size))
                h.seek(off)
                queue = deque([0])
                for i in range(size // 22):
                    require(bool(queue), 'Excess hierarchy entries')
                    depth = queue.popleft()
                    typ, mask, count, at, length = struct.unpack('<BBIQQ', h.read(22))
                    require(typ in (0, 1, 2), 'Unknown hierarchy type')
                    if i == 0 and proxy is not None:
                        require((mask, count) == proxy, 'Proxy root disagreement')
                    if typ == 2:
                        pending.append((at, length, (mask, count)))
                        continue
                    require((typ != 1 or mask == 0) and (typ != 0 or mask != 0), 'Invalid node mask')
                    require(length == count * dtype.itemsize and at + length <= payload_bytes, 'Invalid payload range')
                    if length:
                        ranges.append((at, length))
                    nodes += 1
                    p.seek(at)
                    for pos in range(0, count, chunk):
                        n = min(chunk, count - pos)
                        data = p.read(n * dtype.itemsize)
                        require(len(data) == n * dtype.itemsize, 'Truncated point records')
                        points = np.frombuffer(data, dtype=dtype)
                        rows = points['source_row']
                        require(np.all(rows < len(reference)) and np.all(points['point source id'] == source['source_file_id']), 'Invalid provenance')
                        require(len(np.unique(rows)) == len(rows) and not np.any(seen[rows]), 'Duplicate original rows')
                        seen[rows] = 1
                        ref = reference[rows]
                        require(np.array_equal(points['rgb'], ref['rgb'].astype(np.uint16) * 257), 'RGB mismatch')
                        for name in (['semantic_id'] if realworld else ['semantic_id', 'instance_id']):
                            require(np.array_equal(points[name], ref[name]), name + ' mismatch')
                        xyz = points['position'] * scale + offset
                        error = np.abs(xyz - ref['xyz'])
                        require(np.all(error <= MAX_ERROR_M), f'Coordinate error exceeds 1.501 mm: {error.max(axis=0).tolist()}')
                        require(np.all(xyz >= bounds_min - 0.002) and np.all(xyz <= bounds_max + 0.002), 'Point outside metadata bounds')
                        max_error = np.maximum(max_error, error.max(axis=0))
                        total += len(points)
                    for bit in range(8):
                        if mask & (1 << bit):
                            queue.append(depth + 1)
                require(not queue, 'Missing hierarchy children')
        require(total == len(reference) and np.all(seen == 1), 'Incomplete original-row coverage')
        del reference, seen
    for spans, expected_length in [(chunks, hierarchy_bytes), (ranges, payload_bytes)]:
        cursor = 0
        for at, size in sorted(spans):
            require(at == cursor, 'Overlapping or unaddressed bytes')
            cursor += size
        require(cursor == expected_length, 'Trailing unaddressed bytes')
    require(digest(original) == source['sha256'], 'Source changed during audit')
    report = {'status': 'pass', 'points': total, 'nodes': nodes, 'hierarchy_chunks': len(chunks),
              'max_coordinate_error_m': max_error.tolist(), 'source_sha256': source['sha256'],
              'checks': 'Every original row exactly once; every XYZ, RGB and semantic_id' + ('' if realworld else ' and signed instance_id') + '; full hierarchy and payload coverage; source and asset hashes'}
    (out / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('data/raw/STPLS3D'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    validate(args.raw, args.out)
