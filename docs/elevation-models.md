# Observed elevation models

[Task084](tasks/084-dtm-dsm.md) adds read-only elevation models for all 29 prepared
STPLS3D synthetic and real-world scenes. Toronto's existing ground adapter remains
separate. These models support inspection and agent measurements, not automatic
CAD placement or clearance certification.

## Libraries and methods

Pinned NumPy 2.4.4 aggregates every physical prepared source record in bounded
chunks. [Rasterio 1.5.2](https://rasterio.readthedocs.io/en/stable/quickstart.html)
uses GDAL 3.12.2 for affine transforms, tiled DEFLATE GeoTIFFs, overviews and
readback. [GeoTIFF.js 3.0.5](https://github.com/geotiffjs/geotiff.js/) reads bounded
raster windows on the server. Three.js PlaneGeometry supplies preview tessellation.

The default grid has 1 m square cells:

| Layer | Observation | Required support |
| --- | --- | --- |
| DTM | Mean Z of native labels 0 Ground, 15 Road, 18 Dirt, 19 Grass | 3 classified ground points |
| DSM | Maximum Z of all source points | 1 source point |
| nDSM | DSM minus DTM | Both layers valid |

Cells lacking support are NoData. There is no hole filling, automatic ground
classification or outlier rejection. Ground beneath buildings is not inferred.
Ground count and min/max describe support and spread; they are not accuracy
estimates. DSM can include outliers. nDSM is a cell summary, not an individual
object's height; floating point subtraction can produce negligible negative values.

Coordinates retain each cloud's explicit local meter, Z-up frame and source
origin. No geodetic CRS or vertical datum is invented; GeoTIFF CRS is unset.

## Reproduction

Use Node 22 and the repository's pinned pnpm installation. Install Python wheels
from `scripts/elevation-requirements.txt` into a tooling virtual environment, then:

```sh
python scripts/prepare-elevation.py data/processed/stpls3d_realworld/ra
python scripts/validate-elevation.py data/processed/stpls3d_realworld/ra
node --import tsx scripts/check-elevation.ts
```

The Python commands accept multiple prepared cloud directories, each containing
`cloud.json`. Generation refuses existing `elevation/` output; preserve or relocate
that directory explicitly before regenerating. Resolution is configurable with
`--resolution` (0.25–10 m), subject to a four-million-cell budget. Ground labels
and minimum support are explicit options recorded in the manifest.

Each cloud gets `elevation/manifest.json`, `dtm.tif`, `dsm.tif`, `support.tif`
(ground/all-point counts), and `ground-range.tif` (ground min/max). Generation
verifies every base raster cell on readback before publishing a staged directory.
The independent auditor writes `validation.json`, checking every source record,
cell counts and means, witnessed DSM maxima, support masks, and hashes. The
runtime compatibility script checks every registered model with GeoTIFF.js.

## Runtime interfaces

Read-only prepared-cloud routes provide `elevation`, `elevation-grid`, and
`elevation-query`. Requests bind the source revision; grids and queries also bind
the model revision. Fixed operator registrations, asset paths, hashes, resource
limits, cancellation and source checks guard access. Missing or stale models do
not disable ordinary point-cloud inspection.

The product agent receives `query_elevation({x,y})` only when its bound scene has
a valid model. It must load the `elevation-models` runtime skill first. Results
include nullable ground/surface/height-above-ground values, support, cell center,
resolution, methods, frame and revisions. Outside-grid and NoData outcomes are
explicit. This tool grants no editing authority and creates no source point IDs.

The viewer offers Points, DTM and DSM. The elevation key identifies the active
layer and meter range. Clicking a surface queries the original 1 m raster cell.
The bounded preview uses nearest resampling to at most 192×192 samples; Three.js
joins only neighboring supported samples, leaving NoData holes open. This
disposable visual surface does not interpolate analytical query values. Returning
to Points restores the existing adaptive point-cloud LOD and color modes.

## Verification and remaining work

All 29 models were generated and independently audited against 229,739,515 source
points. Tests use small standard Rasterio-generated GeoTIFF fixtures, including
unsupported ground, empty cells, stale artifacts and strict tool dispatch.
Browser checks cover both layers, source-cell clicks, agent queries and capture,
layer retry, scene changes, negative elevations and mobile controls.

Future work includes a Toronto adapter, evaluated interpolation and ground
filtering, outlier handling, and tiled adaptive raster rendering. Implementation
does not complete the separate shared scene-interaction refactor. Fresh-session
review remains pending; exact commands and artifacts are recorded in Task084.
