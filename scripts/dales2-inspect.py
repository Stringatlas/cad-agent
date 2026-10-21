#!/usr/bin/env python3
"""Recheck all 29 raw headers, hashes, full class histograms and RGB availability."""
import argparse
import json
from pathlib import Path
import laspy
import numpy as np
from dataset_recipe import load_recipe, verify_sources

RECIPE = Path(__file__).resolve().parents[1]/'config/dataset-recipes/dales2.json'


def inspect(raw, chunk=250000):
    if not 1 <= chunk <= 1000000:
        raise ValueError('Chunk must be 1..1000000')
    recipe=load_recipe(RECIPE)
    verify_sources(raw,recipe)
    checked=[]
    for source in recipe['sources']:
        histogram=np.zeros(256,dtype=np.int64);rgb=0
        with laspy.open(raw/source['file']) as reader:
            h=reader.header
            observed={'point_format':h.point_format.id,'dimensions':[{'name':d.name,'dtype':str(d.dtype)} for d in h.point_format.dimensions],
                      'scales':h.scales.tolist(),'offsets':h.offsets.tolist(),'bounds':[h.mins.tolist(),h.maxs.tolist()],
                      # laspy removes the compression VLR after decoding; recipe stores semantic/header VLRs.
                      'vlrs':[dict(user_id=v.user_id,record_id=v.record_id,description=v.description) for v in h.vlrs if v.user_id!='laszip encoded'],
                      'creation_date':str(h.creation_date),'generating_software':h.generating_software,'points':h.point_count}
            for key,value in observed.items():
                if value!=source[key]:raise ValueError(source['file']+': header mismatch '+key)
            for a in reader.chunk_iterator(chunk):
                histogram+=np.bincount(a.classification,minlength=256)
                if 'red' in a.point_format.dimension_names:rgb+=int(np.count_nonzero(a.red|a.green|a.blue))
        counts={str(i):int(n) for i,n in enumerate(histogram) if n}
        if counts!=source['classification_counts'] or rgb!=source['nonblack_rgb_points']:
            raise ValueError(source['file']+': payload inventory mismatch')
        checked.append({'file':source['file'],'points':source['points'],'sha256':source['sha256'],'classification_counts':counts,'nonblack_rgb_points':rgb,'header':observed})
    return {'status':'pass','revision':recipe['revision'],'files':len(checked),'points':sum(s['points'] for s in checked),'sources':checked}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw',type=Path,default=Path('data/raw/DALES-2/train'))
    parser.add_argument('--chunk',type=int,default=250000)
    args=parser.parse_args();print(json.dumps(inspect(args.raw,args.chunk),indent=2))
