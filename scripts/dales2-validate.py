#!/usr/bin/env python3
"""Independent every-point LAZ/LAS/Potree audit; bounded decode, mmap identity coverage."""
import argparse
from collections import deque
import json
from pathlib import Path
import struct
import tempfile
import laspy
import numpy as np
from dataset_recipe import digest


MAX_COORDINATE_ERROR_M = 0.01
COORDINATE_EPSILON_M = 1e-9


def require(ok, message):
    if not ok:
        raise ValueError(message)


def validate(raw, out, chunk=250000):
    require(1 <= chunk <= 1000000, 'Invalid chunk bound')
    manifest = json.loads((out/'manifest.json').read_text())
    src = manifest['source']
    require(digest(raw/src['file']) == src['sha256'], 'Raw source hash mismatch')
    for name, info in manifest['assets'].items():
        require((out/name).stat().st_size == info['bytes'] and digest(out/name) == info['sha256'], 'Asset hash mismatch: '+name)
    las_path = out/(Path(src['file']).stem+'.las')
    # Compare original LAZ and sequential normalized LAS independently from producer.
    with laspy.open(raw/src['file']) as original, laspy.open(las_path) as converted:
        require(original.header.point_count == converted.header.point_count == src['points'], 'LAS point count mismatch')
        source_scale = np.asarray(original.header.scales)
        require(np.all(np.isfinite(source_scale)) and np.all(source_scale > 0) and np.all(source_scale <= MAX_COORDINATE_ERROR_M), 'Invalid source coordinate grid')
        require(np.array_equal(original.header.scales, converted.header.scales) and np.array_equal(original.header.offsets, converted.header.offsets), 'Grid mismatch')
        start = 0
        for a in original.chunk_iterator(chunk):
            b = converted.read_points(len(a))
            for name in ['X','Y','Z','classification','instance','legacy_semantic','legacy_instance','intensity','gps_time','return_number','number_of_returns']:
                require(np.array_equal(a[name],b[name]), 'LAZ/LAS attribute mismatch: '+name)
            require(np.array_equal(b.source_row,np.arange(start,start+len(b))) and np.all(b.point_source_id==src['source_file_id']), 'LAS provenance mismatch')
            labels=np.asarray(a.classification)
            palette=np.asarray(manifest['palette_rgb16'],dtype=np.uint16)
            expected = np.column_stack([a.red,a.green,a.blue]) if src['nonblack_rgb_points'] else palette[labels]
            require(np.array_equal(np.column_stack([b.red,b.green,b.blue]),expected), 'LAS RGB mismatch')
            start+=len(a)
        require(start==src['points'], 'Truncated source')
    metadata=json.loads((out/'octree/metadata.json').read_text())
    require(metadata['version']=='2.0' and metadata['encoding']=='UNCOMPRESSED' and metadata['points']==src['points'], 'Potree format/count mismatch')
    types={'int8':'i1','uint8':'u1','int16':'<i2','uint16':'<u2','int32':'<i4','uint32':'<u4','float':'<f4','double':'<f8','int64':'<i8','uint64':'<u8'}
    fields=[]
    for a in metadata['attributes']:
        dt=np.dtype(types[a['type']]); n=a['numElements']
        require(dt.itemsize*n==a['size'] and dt.itemsize==a['elementSize'], 'Invalid attribute layout')
        fields.append((a['name'],dt,(n,)) if n!=1 else (a['name'],dt))
    dtype=np.dtype(fields)
    for n in ['position','classification','rgb','point source id','source_row','instance','legacy_semantic','legacy_instance','intensity','gps-time','return number','number of returns']:
        require(n in dtype.names, 'Missing required attribute '+n)
    payload=out/'octree/octree.bin'; hierarchy=out/'octree/hierarchy.bin'
    scale=np.asarray(metadata['scale']); offset=np.asarray(metadata['offset'])
    require(scale.shape==(3,) and offset.shape==(3,) and np.all(np.isfinite(scale)) and np.all(scale>0) and np.all(scale<=source_scale) and np.all(scale<=MAX_COORDINATE_ERROR_M) and np.all(np.isfinite(offset)), 'Bad coordinate scale/offset')
    pending=deque([(0,metadata['hierarchy']['firstChunkSize'],None)])
    chunks=[]; ranges=[]; nodes=0; total=0; visited=set(); max_error=np.zeros(3)
    with laspy.mmap(las_path) as reference, tempfile.TemporaryDirectory(prefix='dales2-audit-') as scratch, hierarchy.open('rb') as h, payload.open('rb') as p:
        seen=np.memmap(Path(scratch)/'seen',mode='w+',dtype='u1',shape=(src['points'],));seen[:]=0
        while pending:
            off,size,proxy=pending.popleft()
            require(off not in visited and size>0 and size%22==0 and off+size<=hierarchy.stat().st_size,'Invalid hierarchy chunk')
            visited.add(off);chunks.append((off,size));h.seek(off);queue=deque([0])
            for i in range(size//22):
                require(bool(queue),'Excess hierarchy entries');depth=queue.popleft()
                typ,mask,count,at,length=struct.unpack('<BBIQQ',h.read(22))
                require(typ in (0,1,2),'Unknown hierarchy type')
                if i==0 and proxy is not None:require((mask,count)==proxy,'Proxy root disagreement')
                if typ==2:
                    pending.append((at,length,(mask,count)));continue
                require((typ!=1 or mask==0) and (typ!=0 or mask!=0),'Invalid leaf/internal mask')
                require(length==count*dtype.itemsize and at+length<=payload.stat().st_size,'Invalid payload span')
                if length:ranges.append((at,length))
                nodes+=1;p.seek(at)
                for start in range(0,count,chunk):
                    b=np.frombuffer(p.read(min(chunk,count-start)*dtype.itemsize),dtype=dtype)
                    rows=b['source_row'];require(np.all(rows<src['points']) and np.all(b['point source id']==src['source_file_id']),'Bad source identity')
                    require(len(np.unique(rows))==len(rows) and not np.any(seen[rows]),'Duplicate source rows');seen[rows]=1
                    r=reference.points[rows]
                    for name in ['classification','instance','legacy_semantic','legacy_instance','intensity']:
                        require(np.array_equal(b[name],r[name]),'Potree attribute mismatch '+name)
                    for name, las_name in [('gps-time','gps_time'),('return number','return_number'),('number of returns','number_of_returns')]:
                        require(np.array_equal(b[name],r[las_name]),'Potree attribute mismatch '+name)
                    require(np.array_equal(b['rgb'],np.column_stack([r.red,r.green,r.blue])),'Potree RGB mismatch')
                    xyz=b['position']*scale+offset
                    expected=np.column_stack([r.x,r.y,r.z])
                    # Accuracy is a release promise, not a tolerance supplied by the output being audited.
                    error=np.abs(xyz-expected);require(np.all(error<=MAX_COORDINATE_ERROR_M+COORDINATE_EPSILON_M),'Coordinate mismatch')
                    if len(b):max_error=np.maximum(max_error,error.max(axis=0))
                    total+=len(b)
                for bit in range(8):
                    if mask&(1<<bit):queue.append(depth+1)
            require(not queue,'Missing hierarchy children')
        require(total==src['points'] and np.all(seen==1),'Incomplete provenance coverage')
    for spans,length in [(chunks,hierarchy.stat().st_size),(ranges,payload.stat().st_size)]:
        cursor=0
        for at,size in sorted(spans):require(at==cursor,'Overlapping/unaddressed bytes');cursor+=size
        require(cursor==length,'Trailing unaddressed bytes')
    report={'status':'pass','points':total,'nodes':nodes,'hierarchy_chunks':len(chunks),'max_coordinate_error_m':max_error.tolist(),'source_sha256':src['sha256'],'checks':'Every original row exactly once; original LAZ to normalized LAS attributes; every Potree coordinate, RGB, classification, instance/legacy labels; full hierarchy and payload addressing; asset hashes'}
    (out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw',type=Path,default=Path('data/raw/DALES-2/train'))
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--chunk',type=int,default=250000)
    args=parser.parse_args();validate(args.raw,args.out,args.chunk)
