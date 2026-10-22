# Task085 — regional terrain tools

Authorized: proceed with region summaries, slope layer, coordinate-bound terrain
images, profiles and connected-region filtering. Prefer established libraries.

Acceptance:
- [ ] GDAL Horn slope artifacts bound to the existing elevation revision; no edge/NoData interpolation; all29 prepared scenes generated and checked.
- [ ] Bounded region statistics, profile sampling and four-connected region filters using Rasterio, NumPy, Shapely and SciPy; thresholds selected by caller; explicit coverage and units.
- [ ] Coordinate-bound raster images delivered to the model as images, without invented browser/source-point provenance.
- [ ] Conditional agent registration, strict schemas/runtime validation, skill instructions, client event handling and actual provider-loop tests.
- [ ] Viewer slope mode with labeled degrees, errors/retry and desktop/mobile browser checks.
- [ ] Checks, documentation and temporary handoff; independent review pending.

Original source only. NoData is never flat or clear space. Slope is a raster-scale
observation, not foundation flatness or suitability. Regions are connected cells
matching explicit filters, not ranked recommendations or geometry edits.
