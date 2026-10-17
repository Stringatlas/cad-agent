# Street testing and derived preprocessing

[Task038](tasks/038-street-testing-preprocessing.md) adds a focused Toronto testing view. Start with `pnpm dev`: the camera focuses a deterministic source-sample-anchored **40×40×28m** street box and automatically streams every original point in it. Overview remains sampled outside the box. This is not full-resolution rendering of the entire 78M-point street. Orbit does not reload detail. **Street chunk** returns to the default; **Frame dataset** navigates the whole cloud; cancel/clear/retry and manual box/projected-window tools remain available.

The **eye icon** fetches overlays for the current box. Class-colored wireframes are instance bounds; amber meshes are approximate fits; green flat tiles are supported observed ground cells. Task039 adds a compact text-labeled class/representation legend, with quality/methodology under Details rather than a permanent paragraph. Refresh after changing the box. Hiding disposes these render caches. They are original-source observations, not edited effective coordinates, approved CAD bodies or valid-solid claims. Visible overlays block source-grounded screenshots; toggles invalidate captures. Missing/stale/malformed artifacts are explicitly unavailable, never silently generated or invented.

## Prepare (Node 22)

First create [semantic instances](semantic-instance-clustering.md). Then:

```sh
node --import tsx scripts/prepare-scene-preprocessing.ts \
  data/processed/toronto3d/prepared /tmp/toronto-instances-new \
  data/processed/toronto3d/preprocessing
pnpm dev
```

Output directory must not exist. Successful publication atomically renames a complete sibling staging directory; failure/cancellation publishes no partial artifact. SIGINT/SIGTERM cancel the CLI. Hard process kill may leave an unpublished staging directory. The generated `data/` path is ignored by Git. For another location set **`SPATIAL_PREPROCESSING_PATH` to the manifest file**, not its directory, when starting the backend. No request accepts filesystem paths. The current checkout has a generated default artifact installed for local testing; it is not a repository-distributed asset.

## Derived artifact

`apps/server/src/scene-preprocessing.ts` owns the versioned `ScenePreprocessing` TypeScript schema, not contracts/UI/CAD authority. The output `manifest.json` binds source revision, index/source hashes, original instance manifest/membership hashes, Toronto local frame/origin and meters. Preparation independently hashes the original payload, streams three checksummed disk-page passes and validates original membership/source keys, checksums and counts. Memory is O(instances + occupied ground cells), not O(78M points).

- **Ground:** labels 1 Ground and 2 Road_markings only; 2m sparse grid with origin `[0,0]`, exact observed minimum Z, point count and maximum Z per cell. At least three points support an elevation/visible tile. `groundElevation(ground,x,y)` returns the observed minimum or `undefined`; no hole interpolation/extrapolation. The lower envelope is sensitive to low outliers and is not a smoothed terrain certification. Lookup currently scans the bounded cell array; a query cache can be added if needed.
- **Poles:** vertical cylinder using mean XY, RMS radial distance and observed height. Partial/asymmetric scans can bias center/radius.
- **Cars:** PCA XY orientation, projected extents and observed height produce an oriented box. Optional Building components use rectangular PCA footprint-height extrusions, not arbitrary footprint reconstruction. Fences retain bounds, not fabricated primitive fits.
- **Quality:** distance to the finite primitive **surface**, RMSE in meters, fraction within default `.2m` tolerance, evaluated count and `coverage × exp(-RMSE/tolerance)` heuristic score. Sparse/degenerate fits are explicit, not rendered as fitted meshes. Scores are not confidence calibration, segmentation quality or CAD validity. No model tool or authoritative proposal is added.
- **Budgets:** defaults/hard ceilings: 100k instances, 250k ground cells, 64MiB input manifest, 128MiB output, 512MiB memberships, ten minutes including cold index preparation. Abort/deadline/source changes reject. The existing canonical index preparation has its own bounds as well. Limits are not a hard RSS guarantee.

## Read-only summary

`GET /datasets/toronto3d/preprocessing[?bounds=<encoded JSON CropBox>]` reads one fixed operator-configured file; validates complete version/source revision/frame/coordinates and fields used; intersects instances/tiles with the box. Caps: 2000 instances, 10000 supported tiles, 1MiB JSON, explicit `truncated`. No query means whole-artifact bounded summary. Existing loopback Host/Origin, method/range and two-operation admission checks apply. Cancellation closes reads. Up to 64MiB file parsing/validation is synchronous after bounded reads, so refresh can briefly block the local event loop. The endpoint checks hash shapes and binding, **not** a fresh full source/index hash audit; preparation owns that audit.

## Full-dataset spatial library

`SpatialPageIndex.create(snapshot,disk)` in `apps/server/src/spatial-page-index.ts` builds a median-split **page KD-tree/BVH** whose leaves cover every physical disk page. It does not allocate 78M point nodes or replace production verified label tools. Reuse the tree with the caller-owned snapshot.

- `nearest(position,{label?,signal?,maxPages?,maxMilliseconds?})`: exact original-point Euclidean nearest, deterministic physical/source-key ties, bound provenance and checked-page/time stats.
- `radius(position,radiusMeters,{maxResults?,...})`: exact total count, capped deterministic subset (not closest-k), explicit truncation. Default 1000/max10000 retained points.
- `clearance(position,options)`: point-to-original-source-point nearest distance only; **not** solid/terrain clearance verification.

Source/index identity checks, checked page reads and budgets fail closed; no partial nearest success or silent downsampling. Default query time budget30s. Independent brute-force fixture tests verify answers; this is not independent production geometry verification. Physical page bounds overlap broadly, so actual nearest reads793–3197 of19122 pages (~0.7–2.2s measured). A point-level spatial reordering/index and user latency target remain follow-up performance work. No HTTP/model or edited-point API is connected to this library yet.

Exact checks/evidence and remaining review gate: [task038](tasks/038-street-testing-preprocessing.md).
