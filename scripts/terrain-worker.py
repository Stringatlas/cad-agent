"""Bounded read-only terrain operations. Invoked only by the trusted server adapter."""
import base64
import hashlib
import io
import json
from pathlib import Path
import sys
import numpy as np
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.windows import Window
from rasterio.enums import Resampling
from scipy import ndimage
from shapely.geometry import Polygon, shape, mapping
from PIL import Image, ImageDraw

MAX_CELLS = 1_000_000


def stat(values, mask):
    selected = values[mask & np.isfinite(values)]
    return dict(validCells=int(selected.size), min=float(selected.min()) if selected.size else None,
                max=float(selected.max()) if selected.size else None, mean=float(selected.mean()) if selected.size else None,
                p50=float(np.percentile(selected, 50)) if selected.size else None, p95=float(np.percentile(selected, 95)) if selected.size else None)


def run(root, operation, args):
    with rasterio.open(root / 'dtm.tif') as base:
        resolution, transform = base.res[0], base.transform
        if operation == 'terrain_profile':
            start, end = np.asarray(args['start']), np.asarray(args['end'])
            if start.shape != (2,) or end.shape != (2,) or not 2 <= args['samples'] <= 256: raise ValueError('Invalid profile')
            xy = np.linspace(start, end, args['samples']); length = float(np.linalg.norm(end - start))
            layers = {}
            for name in ['dtm', 'dsm', 'slope']:
                path = root / ('terrain/slope.tif' if name == 'slope' else name + '.tif')
                with rasterio.open(path) as src:
                    layers[name] = [None if np.ma.is_masked(v[0]) or not np.isfinite(v[0]) else float(v[0]) for v in src.sample(xy, masked=True)]
            rows, columns = rasterio.transform.rowcol(transform, xy[:, 0], xy[:, 1])
            centers = np.column_stack(rasterio.transform.xy(transform, rows, columns))
            samples = []
            for i, point in enumerate(xy):
                z = layers['dtm'][i]; previous = layers['dtm'][i - 1] if i else None
                separation = float(np.linalg.norm(centers[i] - centers[i - 1])) if i else 0
                samples.append(dict(x=float(point[0]), y=float(point[1]), cellCenter=centers[i].tolist(), distance=length * i / (len(xy) - 1), dtm=z, dsm=layers['dsm'][i], slopeDegrees=layers['slope'][i],
                                    gradeFromPreviousPercent=None if previous is None or z is None or separation == 0 else (z - previous) / separation * 100))
            return dict(length=length, samples=samples, distanceUnits='m', gradeUnits='percent', sampling='evenly spaced XY; original cells; no interpolation; grade uses cell-center separation and is null for repeated cells or missing ground', validGroundSamples=sum(v is not None for v in layers['dtm']), totalSamples=len(xy))
        if operation == 'grid':
            maximum = args['maxSize']; ratio = min(1, maximum / max(base.width, base.height))
            width, height = max(1, int(base.width * ratio)), max(1, int(base.height * ratio))
            dtm = base.read(1, out_shape=(height, width), resampling=Resampling.nearest)
            with rasterio.open(root / 'terrain/slope.tif') as src: slope = src.read(1, masked=True, out_shape=(height, width), resampling=Resampling.nearest).filled(np.nan)
            dtm[~np.isfinite(slope)] = np.nan
            return dict(width=width, height=height, values=[float(v) if np.isfinite(v) else None for v in dtm.ravel()], colors=[float(v) if np.isfinite(v) else None for v in slope.ravel()])
        polygon = Polygon(args['polygon'])
        if not polygon.is_valid or polygon.is_empty or polygon.area <= 0: raise ValueError('Invalid polygon topology')
        left, bottom, right, top = polygon.bounds
        c0, r0 = int(np.floor((left - transform.c) / resolution)), int(np.floor((transform.f - top) / resolution))
        c1, r1 = int(np.ceil((right - transform.c) / resolution)), int(np.ceil((transform.f - bottom) / resolution))
        width, height = c1 - c0, r1 - r0
        if width < 1 or height < 1 or width * height > MAX_CELLS: raise ValueError('Terrain region exceeds one million cell budget')
        window = Window(c0, r0, width, height); affine = rasterio.windows.transform(window, transform)
        mask = geometry_mask([mapping(polygon)], (height, width), affine, invert=True)
        layers = {}
        for name in ['dtm', 'dsm', 'slope']:
            with rasterio.open(root / ('terrain/slope.tif' if name == 'slope' else name + '.tif')) as src:
                layers[name] = src.read(1, window=window, boundless=True, masked=True).filled(np.nan)
        layers['ndsm'] = layers['dsm'] - layers['dtm']
        total = int(mask.sum()); cell_area = resolution ** 2
        coverage = {name: dict(validCells=int((mask & np.isfinite(values)).sum()), validFraction=float((mask & np.isfinite(values)).sum() / total) if total else None,
                               noDataFraction=float((mask & ~np.isfinite(values)).sum() / total) if total else None) for name, values in layers.items()}
        common = dict(requestedArea=float(polygon.area), selectedCells=total, sampledArea=total * cell_area, areaUnits='m2', layerUnits=dict(dtm='m', dsm='m', ndsm='m', slope='degrees'), cellRule='cell-center within polygon; outside raster counts as NoData', coverage=coverage)
        if operation == 'query_terrain_region':
            return dict(**common, statistics={name: stat(values, mask) for name, values in layers.items()}, slopeUnits='degrees')
        if operation == 'filter_terrain_regions':
            keep = mask & np.isfinite(layers['slope']) & (layers['slope'] <= args['maxSlopeDegrees'])
            if args['maxHeightAboveGround'] is not None: keep &= np.isfinite(layers['ndsm']) & (layers['ndsm'] <= args['maxHeightAboveGround'])
            labels, count = ndimage.label(keep)  # four-connected; NoData cannot join components
            counts = np.bincount(labels.ravel(), minlength=count + 1)
            eligible = np.flatnonzero(counts * cell_area >= args['minArea']); eligible = eligible[eligible != 0]
            regions = []; slices = ndimage.find_objects(labels)
            for label in eligible[:args['maxRegions']]:
                rows, columns = slices[label - 1]; region = labels[rows, columns] == label
                local = affine @ rasterio.Affine.translation(columns.start, rows.start)
                geometry = next(shapes(region.astype(np.uint8), mask=region, transform=local))[0]
                boundary = shape(geometry).simplify(resolution / 4, preserve_topology=True)
                # Full cell membership remains authoritative; simplified outline is display only.
                coords = mapping(boundary); coordinate_count = sum(len(ring) for ring in coords['coordinates'])
                center = shape(geometry).representative_point()
                regions.append(dict(id=f'component-{int(label)}', cells=int(counts[label]), area=float(counts[label] * cell_area), bounds=list(shape(geometry).bounds),
                                    interiorPoint=[center.x, center.y], boundary=coords if coordinate_count <= 256 else None,
                                    boundaryScope='simplified display outline; omitted above 256 vertices', slope=stat(layers['slope'][rows, columns], region)))
            return dict(**common, filters=args, connectivity=4, matchingRegions=int(len(eligible)), returnedRegions=len(regions), complete=len(regions) == len(eligible), order='raster scan; not suitability ranking', idScope='Component IDs are local to this query; not entity or original source IDs', regions=regions)
        if operation != 'terrain_image': raise ValueError('Unknown terrain operation')
        values = layers[args['layer']]; valid = mask & np.isfinite(values); stats = stat(values, mask)
        low, high = stats['min'], stats['max']
        ratio = min(1, args['maxSize'] / max(width, height)); outw, outh = max(1, int(width * ratio)), max(1, int(height * ratio))
        # Pillow performs nearest resize; never interpolate NoData or numeric measurements.
        small = np.asarray(Image.fromarray(values.astype(np.float32)).resize((outw, outh), Image.Resampling.NEAREST))
        supported = np.asarray(Image.fromarray(valid).resize((outw, outh), Image.Resampling.NEAREST))
        t = np.clip((np.nan_to_num(small, nan=low or 0) - (low or 0)) / max(1e-12, (high or 0) - (low or 0)), 0, 1)
        pixels = np.stack([t * 255, (1 - abs(2 * t - 1)) * 210, (1 - t) * 255], axis=-1).astype(np.uint8)
        pixels[~supported] = [28, 28, 32]
        image = Image.new('RGB', (max(256, outw), outh + 48), (28, 28, 32)); image.paste(Image.fromarray(pixels), (0, 0))
        unit = 'degrees' if args['layer'] == 'slope' else 'm'
        ImageDraw.Draw(image).text((4, outh + 4), f'{args["layer"].upper()} {low:.2f} to {high:.2f} {unit}' if low is not None else f'{args["layer"].upper()} NoData', fill='white')
        ImageDraw.Draw(image).text((4, outh + 22), 'North/up +Y | dark = NoData/outside polygon', fill='white')
        encoded = io.BytesIO(); image.save(encoded, format='PNG'); data = encoded.getvalue()
        return dict(**common, layer=args['layer'], statistics=stats, palette='blue (minimum), green (middle), red (maximum); dark gray NoData/outside polygon', image=dict(mimeType='image/png', dataUrl='data:image/png;base64,' + base64.b64encode(data).decode(), byteLength=len(data), sha256=hashlib.sha256(data).hexdigest()),
                    mapping=dict(pixelOrigin='top-left', rasterWidth=outw, rasterHeight=outh, imageWidth=image.width, imageHeight=image.height, origin=[affine.c, affine.f], pixelSize=[width * resolution / outw, -height * resolution / outh], legendRows=48, scope='Raster only; no original source-point keys; pixel centers map to local XY'))


if __name__ == '__main__':
    request = json.loads(sys.stdin.buffer.read(65537))
    grid = request['grid']; root = Path(request['root'])
    for relative in ['dtm.tif', 'dsm.tif', 'terrain/slope.tif']:
        with rasterio.open(root / relative) as src:
            if src.width != grid['width'] or src.height != grid['height'] or src.transform != rasterio.Affine(grid['resolution'], 0, grid['origin'][0], 0, -grid['resolution'], grid['origin'][1]) or src.count != 1 or src.crs is not None:
                raise ValueError('Raster geometry mismatch')
    print(json.dumps(run(Path(request['root']), request['operation'], request['args']), allow_nan=False, separators=(',', ':')))
