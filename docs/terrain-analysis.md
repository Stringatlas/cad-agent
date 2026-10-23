# Terrain analysis for the product agent

[Task085](tasks/085-terrain-agent-analysis.md) extends the STPLS3D
[elevation models](elevation-models.md) with numerical regional queries and
coordinate-bound images. All operations are read-only observations of the
original raster cells. Toronto has no adapter for these tools yet.

## Library boundaries and setup

GDAL's public `GDALDEMProcessing` API computes Horn slope from the DTM, in
degrees with horizontal/vertical meter ratio 1. The small ctypes binding loads
the GDAL library already bundled with Rasterio; it implements no slope algorithm
and does not install a second GDAL. No edge computation is enabled: a complete
3×3 ground neighborhood is required. The 1 m cell spacing and 3×3 neighborhood
are returned explicitly. See [GDAL's method and NoData documentation](https://gdal.org/en/stable/programs/gdaldem.html).

Live analysis uses Rasterio windows/masks, Shapely topology validation, NumPy
statistics, SciPy connected-component labeling and Pillow image encoding. The
server launches a fixed trusted worker with JSON on stdin, never a shell command
or a client-supplied executable/path. No data is sent to another service.

Install binary scientific wheels in a project tooling virtual environment:

```sh
python3 -m venv data/processed/toronto3d/tooling/venv
data/processed/toronto3d/tooling/venv/bin/python -m pip install --only-binary=:all: -r scripts/elevation-requirements.txt
```

Reuse an existing tooling environment rather than recreating it. Pinned versions:
NumPy 2.4.4, Rasterio 1.5.2 (GDAL 3.12.2 in the installed wheel), SciPy 1.18.1,
Shapely 2.2.0 and Pillow 13.0.0. The bundled-GDAL loader supports the macOS/Linux
wheel layouts. `SPATIAL_TERRAIN_PYTHON` can select another operator-owned Python
executable before starting the server. Dependency readiness is cached for the
server process; restart after installing or changing wheels. Missing runtime or
terrain artifacts removes the additional capability; ordinary point queries and
DTM/DSM access continue to work.

Generate once for each prepared directory; existing output is refused:

```sh
data/processed/toronto3d/tooling/venv/bin/python scripts/prepare-terrain.py data/processed/stpls3d_realworld/ra
node --import tsx scripts/check-terrain.ts
```

`elevation/terrain/slope.tif` and its manifest bind the source and exact elevation
manifest revision. Generation checks every slope validity mask against an
independent nine-neighbor DTM support mask and checks value bounds. Runtime checks
verify manifest binding, raster hashes/identities, geometry and source freshness.

## Agent interfaces

Tools are advertised only for a valid bound model and available worker runtime.
Load the `elevation-models` runtime skill first; loading it grants no capability.
Inputs use the bound local XY meter frame. Polygon vertices are simple arrays of
`[x,y]` with an implicit closing edge, no holes, 3–64 vertices. Self-crossing or
zero-area polygons fail explicitly. No source point IDs are created for cells.

| Tool | Inputs | Result |
| --- | --- | --- |
| `query_terrain_region` | `polygon` | DTM/DSM/height/slope count, min/max, mean, median and p95; per-layer coverage |
| `terrain_profile` | `start`, `end`, `samples` (2–256) | Evenly spaced requested XY, cell centers, elevations, slope, distance and observed grade |
| `filter_terrain_regions` | `polygon`, `maxSlopeDegrees`, `minArea`, `maxHeightAboveGround` (number or null), `maxRegions` (1–16) | Four-connected cells passing caller-selected filters; areas, bounds, interior points, slopes and bounded display outlines |
| `terrain_image` | `polygon`, `layer` (`dtm`, `dsm`, `ndsm`, `slope`), `maxSize` (128–512) | PNG delivered to the model plus coordinate mapping, statistics, palette and coverage |

For example, a filter can ask for slope at most 5°, area at least 30 m² and
`maxHeightAboveGround: null`. These are caller choices, not design standards.
Components are returned in raster-scan order. `matchingRegions`, `returnedRegions`
and `complete` disclose truncation. Simplified outlines are display observations;
each result has a deterministic revision/operation/argument-bound `queryId`.
Component IDs are local to that query, not project entities or source point IDs.
outlines above 256 vertices are omitted. Components can be cut by the requested
polygon, and split queries do not automatically merge components across borders.

Profiles use original cell values without interpolation. Grade uses elevation
difference divided by adjacent cell-center separation. Repeated cells and missing
ground return null grade; gaps are never bridged. Sampled profiles can miss
intervening terrain and are not continuous route assessments.

Regional masks include cell centers, with Rasterio boundary rules. Counts and
sampled areas describe raster cells, not exact continuous polygon intersection.
Outside-raster cells count as NoData. Empty masks return null coverage fractions
and statistics, rather than a false zero elevation or flatness result.

## Images and scene layers

Images supplement numerical evidence. They use nearest resampling, a blue-to-red
palette with its numeric range, and dark gray for NoData/outside the polygon.
`mapping` describes the raster rectangle's top-left pixel origin, local XY origin,
signed pixel size and dimensions; pixel centers map to XY. Legend rows and any
right-side padding are excluded from that rectangle. The model receives actual
`input_image` content; the tool event retains hash/size and mapping without base64.
This is a server-generated raster observation, not a browser screenshot or an
original-point lookup. It grants no `resolve_visual_pixel` capability. Images
participate in the existing bounded conversation image history.

The STPLS3D toolbar adds **Slope · Ground** beside Points, DTM and DSM. It colors
the supported ground mesh by slope, with a degree key. The display is at most
192×192 nearest samples; numerical tools use full-resolution cells. Switching
layers and querying terrain preserves the user's camera and point-color choice.
Captures identify slope and its terrain revision explicitly.

## Bounds and evidence limits

Each regional bounding box is limited to one million cells, including outside
coverage. Requests have at most 64 vertices, profiles 256 samples, filters 16 returned
regions and image rasters 512 pixels per axis. Two scientific workers may run at
once, each with an 8 s deadline and 2 MiB output cap; BLAS/OpenMP threads and GDAL
cache are bounded. These workload limits are not an operating-system memory cap.
The slope preview uses the existing read-only, local-only route protections and
source/model/terrain revisions. Worker failure is explicit and can be retried.

Slope requires ground support, so it has more NoData than DTM. Missing cells are
never flat or clear. Thresholds and connected components do not establish
suitability, clearance or foundation flatness. The base DTM has no evaluated
outlier filtering or inferred ground beneath buildings. nDSM is a same-cell
surface-minus-ground observation, not an individual object's height. Accepted
edits and pending geometry are excluded; geometry approval remains separate.

## Verification

Independent plane fixtures check 45° Horn slope and known means/areas; holes split
components and grades. Integration tests cover actual worker measurements, PNG
mapping, strict inputs, stale/changed/symlinked assets, HTTP revisions, conditional
tool advertisement, per-turn skill gating, web events and model image delivery.
The all-scene checker exercises full raster statistics, filters, profiles, images
and previews. Browser evidence uses actual RA/WMSC data and a fixture provider;
it does not certify live-model reasoning. Exact results are in Task085.
