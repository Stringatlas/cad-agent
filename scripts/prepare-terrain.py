"""Generate revision-bound Horn slope using GDAL, preserving unsupported cells."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import numpy as np
import rasterio
from dataset_recipe import digest

spec = importlib.util.spec_from_file_location('gdal_dem', Path(__file__).with_name('gdal-dem.py'))
gdal_dem = importlib.util.module_from_spec(spec); spec.loader.exec_module(gdal_dem)


def prepare(root):
    elevation = root / 'elevation'
    raw = (elevation / 'manifest.json').read_bytes()
    model = json.loads(raw)
    for name, asset in model['assets'].items():
        if digest(elevation / name) != asset['sha256']: raise ValueError('Stale base raster')
    output = elevation / 'terrain'
    if output.exists(): raise ValueError(f'Output exists: {output}')
    with tempfile.TemporaryDirectory(prefix='.terrain-', dir=elevation) as temporary:
        staging = Path(temporary) / 'publish'; staging.mkdir()
        path = staging / 'slope.tif'
        gdal_dem.slope(elevation / 'dtm.tif', path)
        with rasterio.open(path) as src, rasterio.open(elevation / 'dtm.tif') as base:
            values = src.read(1, masked=True).filled(np.nan)
            dtm = base.read(1)
            assert src.transform == base.transform and src.shape == base.shape and src.crs is None
            # Independent validity check: all nine DTM cells required, including center.
            valid = np.zeros(dtm.shape, dtype=bool)
            valid[1:-1, 1:-1] = np.logical_and.reduce([np.isfinite(dtm[r:r + dtm.shape[0] - 2, c:c + dtm.shape[1] - 2]) for r in range(3) for c in range(3)])
            assert np.array_equal(np.isfinite(values), valid)
            assert np.all((values[valid] >= 0) & (values[valid] <= 90))
        finite = values[np.isfinite(values)]
        manifest = dict(version=1, elevationRevision=hashlib.sha256(raw).hexdigest(), sourceRevision=model['source']['revision'],
                        method=dict(algorithm='GDAL-Horn', unit='degree', neighborhood=3, scale=model['grid']['resolution'], horizontalVerticalRatio=1, edges='nodata', interpolation='none'),
                        slope=dict(validCells=int(finite.size), min=float(finite.min()) if finite.size else None, max=float(finite.max()) if finite.size else None),
                        asset=dict(bytes=path.stat().st_size, sha256=digest(path)), gdal=rasterio.__gdal_version__)
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        if (elevation / 'manifest.json').read_bytes() != raw: raise ValueError('Base model changed')
        staging.rename(output)
    print(json.dumps({'cloud': model['source']['descriptor']['id'], 'status': 'pass', 'slope': manifest['slope']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('clouds', nargs='+', type=Path)
    for root in parser.parse_args().clouds: prepare(root)
