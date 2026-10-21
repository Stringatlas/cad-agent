"""Bounded real LAZ fixtures; no large files or converter dependency."""
import importlib.util
import json
from pathlib import Path
import sys
import struct
import tempfile
import unittest
from unittest.mock import patch

import laspy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
spec = importlib.util.spec_from_file_location('dales_preprocess', ROOT/'scripts/dales2-preprocess.py')
producer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(producer)
validator_spec = importlib.util.spec_from_file_location('dales_validate', ROOT/'scripts/dales2-validate.py')
validator = importlib.util.module_from_spec(validator_spec)
validator_spec.loader.exec_module(validator)


class DalesPreprocessingTests(unittest.TestCase):
    def fixture(self, raw, rgb=False, labels=None):
        h=laspy.LasHeader(point_format=7,version='1.4');h.scales=[0.01]*3;h.offsets=[0]*3
        for n in ['instance','legacy_semantic','legacy_instance']:
            h.add_extra_dim(laspy.ExtraBytesParams(name=n,type=np.int16))
        a=laspy.LasData(h)
        a.X=np.arange(37,dtype=np.int32)*3;a.Y=np.arange(37,dtype=np.int32)*2;a.Z=np.arange(37,dtype=np.int32)
        a.classification=np.arange(37,dtype=np.uint8)%15 if labels is None else labels
        a.instance=np.arange(37,dtype=np.int16)+200
        a.legacy_semantic=np.arange(37,dtype=np.int16)%9
        a.legacy_instance=np.arange(37,dtype=np.int16)
        a.intensity=np.arange(37,dtype=np.uint16)*100
        a.gps_time=np.arange(37,dtype=np.float64)+123.5
        if rgb:
            a.red=np.arange(37,dtype=np.uint16)*700;a.green=np.arange(37,dtype=np.uint16)*500;a.blue=np.arange(37,dtype=np.uint16)*300
        path=raw/'tile.laz';a.write(path)
        return a,{'file':path.name,'source_file_id':29,'points':37,'bytes':path.stat().st_size,'sha256':producer.digest(path),'nonblack_rgb_points':36 if rgb else 0}

    def test_exact_grid_native_classes_and_original_rows(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);a,s=self.fixture(raw);target=raw/'out.las';before=producer.digest(raw/'tile.laz')
            counts=producer.convert_tile(raw,target,s,chunk=7);b=laspy.read(target)
            for name in ['X','Y','Z','classification','instance','legacy_semantic','legacy_instance','intensity','gps_time']:
                np.testing.assert_array_equal(a[name],b[name])
            np.testing.assert_array_equal(b.source_row,np.arange(37));self.assertTrue(np.all(b.point_source_id==29))
            np.testing.assert_array_equal(np.column_stack([b.red,b.green,b.blue]),producer.PALETTE[a.classification])
            self.assertEqual(sum(counts.values()),37);self.assertEqual(b.classification[0],0)
            self.assertEqual(producer.digest(raw/'tile.laz'),before)

    def test_real_rgb_is_preserved(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);a,s=self.fixture(raw,True);producer.convert_tile(raw,raw/'out.las',s,11);b=laspy.read(raw/'out.las')
            for name in ['red','green','blue']:np.testing.assert_array_equal(a[name],b[name])

    def test_unknown_native_class_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);_,s=self.fixture(raw,labels=np.full(37,15,dtype=np.uint8))
            with self.assertRaisesRegex(ValueError,'Unknown DALES-2'):producer.convert_tile(raw,raw/'out.las',s)

    def test_hash_mismatch_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);_,s=self.fixture(raw);s['sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'integrity'):producer.convert_tile(raw,raw/'out.las',s)
            self.assertFalse((raw/'out.las').exists())

    def test_chunks_are_bounded(self):
        for chunk in [0,-1,1000001,True]:
            with self.assertRaisesRegex(ValueError,'Chunk'):producer.convert_tile(Path('/unused'),Path('/unused'),{},chunk)

    def test_failure_does_not_publish_runtime_descriptor(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);_,s=self.fixture(raw);converter=raw/'converter';converter.write_text('fixture')
            recipe={'sources':[s],'converter':{'reference_executable_sha256':producer.digest(converter)}}
            with patch.object(producer,'load_recipe',return_value=recipe),patch.object(producer.subprocess,'run',side_effect=RuntimeError('converter failed')):
                with self.assertRaisesRegex(RuntimeError,'converter failed'):producer.run(raw,raw/'prepared',converter,'tile',7)
            self.assertFalse((raw/'prepared/cloud.json').exists())
            self.assertFalse((raw/'prepared/manifest.json').exists())

    def prepared_fixture(self, raw):
        _,s=self.fixture(raw);out=raw/'prepared';out.mkdir();(out/'octree').mkdir()
        producer.convert_tile(raw,out/'tile.las',s,7);a=laspy.read(out/'tile.las')
        fields=[('position','<i4',(3,)),('classification','u1'),('rgb','<u2',(3,)),('point source id','<u2'),('source_row','<u4'),('instance','<i2'),('legacy_semantic','<i2'),('legacy_instance','<i2'),('intensity','<u2'),('gps-time','<f8'),('return number','u1'),('number of returns','u1')]
        dtype=np.dtype(fields);b=np.zeros(37,dtype=dtype)
        b['position']=np.column_stack([a.X,a.Y,a.Z]);b['rgb']=np.column_stack([a.red,a.green,a.blue]);b['point source id']=29
        for n in ['classification','source_row','instance','legacy_semantic','legacy_instance','intensity']:b[n]=a[n]
        for n,las_name in [('gps-time','gps_time'),('return number','return_number'),('number of returns','number_of_returns')]:b[n]=a[las_name]
        b.tofile(out/'octree/octree.bin')
        (out/'octree/hierarchy.bin').write_bytes(struct.pack('<BBIQQ',1,0,37,0,b.nbytes))
        attrs=[]
        names={'i4':'int32','u1':'uint8','u2':'uint16','u4':'uint32','i2':'int16','f8':'double'}
        for name in dtype.names:
            d=dtype.fields[name][0];n=3 if d.shape else 1;base=d.base
            attrs.append({'name':name,'type':names[base.kind+str(base.itemsize)],'numElements':n,'elementSize':base.itemsize,'size':d.itemsize})
        (out/'octree/metadata.json').write_text(json.dumps({'version':'2.0','encoding':'UNCOMPRESSED','points':37,'attributes':attrs,'scale':[.01]*3,'offset':[0]*3,'hierarchy':{'firstChunkSize':22}}))
        manifest={'source':s,'palette_rgb16':producer.PALETTE.tolist(),'assets':{n:{'bytes':(out/n).stat().st_size,'sha256':producer.digest(out/n)} for n in ['tile.las','octree/metadata.json','octree/hierarchy.bin','octree/octree.bin']}}
        (out/'manifest.json').write_text(json.dumps(manifest))
        return out,dtype

    def test_full_validator_tiny_fixture(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);out,_=self.prepared_fixture(raw);validator.validate(raw,out,chunk=7)
            self.assertEqual(json.loads((out/'validation.json').read_text())['points'],37)

    def test_validator_rejects_duplicate_identity_even_with_updated_hash(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);out,dtype=self.prepared_fixture(raw);p=out/'octree/octree.bin'
            b=np.fromfile(p,dtype=dtype);b['source_row'][0]=1;b.tofile(p)
            manifest=json.loads((out/'manifest.json').read_text());manifest['assets']['octree/octree.bin']['sha256']=producer.digest(p)
            (out/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'Duplicate source rows'):validator.validate(raw,out,chunk=7)
            self.assertFalse((out/'validation.json').exists())

    def test_validator_rejects_unknown_payload_bytes(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);out,_=self.prepared_fixture(raw);p=out/'octree/octree.bin'
            with p.open('ab') as stream:stream.write(b'extra')
            manifest=json.loads((out/'manifest.json').read_text());manifest['assets']['octree/octree.bin']={'bytes':p.stat().st_size,'sha256':producer.digest(p)}
            (out/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'Trailing unaddressed'):validator.validate(raw,out,chunk=7)

    def rehash_assets(self, out):
        manifest=json.loads((out/'manifest.json').read_text())
        for name in manifest['assets']:
            p=out/name
            manifest['assets'][name]={'bytes':p.stat().st_size,'sha256':producer.digest(p)}
        (out/'manifest.json').write_text(json.dumps(manifest))

    def test_validator_rejects_zeroed_coordinates_and_inflated_scale_with_updated_hashes(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);out,dtype=self.prepared_fixture(raw);p=out/'octree/octree.bin'
            b=np.fromfile(p,dtype=dtype);b['position']=0;b.tofile(p)
            p=out/'octree/metadata.json';metadata=json.loads(p.read_text());metadata['scale']=[2]*3
            p.write_text(json.dumps(metadata));self.rehash_assets(out)
            with self.assertRaisesRegex(ValueError,'Bad coordinate scale'):validator.validate(raw,out,chunk=7)
            self.assertFalse((out/'validation.json').exists())

    def test_validator_rejects_coordinate_error_above_centimeter_with_updated_hashes(self):
        for axis in range(3):
            with self.subTest(axis=axis), tempfile.TemporaryDirectory() as t:
                raw=Path(t);out,dtype=self.prepared_fixture(raw);p=out/'octree/octree.bin'
                b=np.fromfile(p,dtype=dtype);b['position'][0,axis]+=2;b.tofile(p)
                self.rehash_assets(out)
                with self.assertRaisesRegex(ValueError,'Coordinate mismatch'):validator.validate(raw,out,chunk=7)
                self.assertFalse((out/'validation.json').exists())

    def test_validator_accepts_centimeter_error_on_finer_converter_grid(self):
        with tempfile.TemporaryDirectory() as t:
            raw=Path(t);out,dtype=self.prepared_fixture(raw);p=out/'octree/octree.bin'
            b=np.fromfile(p,dtype=dtype);b['position']*=2;b['position'][0]+=2;b.tofile(p)
            p=out/'octree/metadata.json';metadata=json.loads(p.read_text());metadata['scale']=[.005]*3
            p.write_text(json.dumps(metadata));self.rehash_assets(out)
            validator.validate(raw,out,chunk=7)
            np.testing.assert_allclose(json.loads((out/'validation.json').read_text())['max_coordinate_error_m'],[.01]*3)

    def test_validator_rejects_invalid_converter_grid_with_updated_hashes(self):
        for scale,offset in [([.02,.01,.01],[0]*3),([0,.01,.01],[0]*3),([-1,.01,.01],[0]*3),([float('nan')]*3,[0]*3),([float('inf')]*3,[0]*3),([.01]*3,[float('inf')]*3)]:
            with self.subTest(scale=scale,offset=offset), tempfile.TemporaryDirectory() as t:
                raw=Path(t);out,_=self.prepared_fixture(raw)
                p=out/'octree/metadata.json';metadata=json.loads(p.read_text());metadata.update(scale=scale,offset=offset)
                p.write_text(json.dumps(metadata));self.rehash_assets(out)
                with self.assertRaisesRegex(ValueError,'Bad coordinate scale'):validator.validate(raw,out,chunk=7)
                self.assertFalse((out/'validation.json').exists())

    def test_tracked_inventory_and_taxonomy(self):
        r=producer.load_recipe(producer.RECIPE)
        self.assertEqual(len(r['sources']),29);self.assertEqual(sum(s['points'] for s in r['sources']),357621323)
        self.assertEqual(r['semantic_classes']['0'],'Ground');self.assertEqual(r['semantic_classes']['9'],'Utility pole')
        self.assertEqual(r['semantic_classes']['14'],'Annex');self.assertEqual(r['semantic_attribute'],'classification')
        self.assertEqual([s['source_file_id'] for s in r['sources']],list(range(1,30)))
        self.assertEqual([s['file'] for s in r['sources']],sorted(s['file'] for s in r['sources']))
        self.assertEqual(sum(s['nonblack_rgb_points']>0 for s in r['sources']),1)


if __name__=='__main__':unittest.main()
