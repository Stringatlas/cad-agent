# Task084 — DTM/DSM first vertical slice

User: begin a DTM/DSM system, with both viewer layers and agent elevation queries;
use established libraries wherever possible.

Scope: every registered prepared STPLS3D cloud, synthetic and real-world. Use
Rasterio/GDAL for standard tiled GeoTIFF artifacts, transforms and overviews;
NumPy for bounded source aggregation; GeoTIFF.js for server-side raster windows.
Toronto's existing ground interpolation remains separate and unchanged.

Acceptance:
- [x] Full-source generation of 1 m classified-ground DTM and upper-surface DSM; explicit source/frame/revision, ground-label mapping and support counts.
- [x] Standard GeoTIFFs, reproducible pinned dependencies, source/artifact hashes and independent verification. NoData remains explicit; no implicit hole filling or invented CRS.
- [x] Read-only revision-bound metadata/grid/point APIs with resource and lifecycle bounds.
- [x] Viewer Points/DTM/DSM modes and a labeled elevation key, cell inspection and recoverable failure on desktop/mobile.
- [x] Scene-selective query_elevation tool and runtime skill; strict validation, actual provider dispatch and no editing authority.
- [x] Tests, actual-data/browser checks, docs and redacted handoff. Fresh-session review remains pending.

Methods: DTM is mean Z of explicitly classified ground (STPLS3D labels
0 Ground, 15 Road, 18 Dirt, 19 Grass), minimum 3 points/cell. DSM is maximum Z of
all source records, minimum 1 point/cell. Normalized height is DSM minus DTM only
where both exist. These are observed raster summaries, not inferred ground
under buildings, robust outlier filtering or clearance/suitability evidence.

## Implementation and verification

Implemented 2026-10-22. [Elevation guide](../elevation-models.md) records the
library stack, commands, interfaces and limits. All 29 models are under their
prepared cloud's `elevation/` directory. Independent source audit and actual
GeoTIFF.js compatibility checks cover **229,739,515 points**.

Checks run with Node 22.23.3 and pnpm 10.34.6:

- `pnpm install --frozen-lockfile`: pass (`/tmp/dtm-install-check.log`).
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/elevation.test.py`: 2/2 pass (`/tmp/dtm-python-tests.log`).
- `scripts/prepare-elevation.py` via that Python, every registered prepared cloud directory: 29/29 pass, every-cell Rasterio readback (`/tmp/dtm-ra-build.log`, `/tmp/dtm-all-build.log`).
- `scripts/validate-elevation.py` via that Python, every registered prepared cloud directory: 29/29 independent full-source audits pass (`/tmp/dtm-audit.log`, per-model `validation.json`).
- `node --import tsx scripts/check-elevation.ts`: 29/29 pass (`/tmp/dtm-reader-all.log`, `/tmp/elevation-compatibility.json`).
- `node --import tsx --test tests/datasets/elevation.test.ts tests/agent/elevation-tools.test.ts tests/agent/agent-tools-inspection.test.ts tests/agent/product-agent-skills.test.ts`: 23/23 pass (`/tmp/dtm-targeted.log`).
- `pnpm typecheck`: pass, Svelte 0 errors/warnings (`/tmp/dtm-typecheck.log`).
- `pnpm test`: **1012/1012 pass**, no skips (`/tmp/dtm-full-tests.log`).
- `pnpm build`: pass; existing large web-chunk warning remains (`/tmp/dtm-build.log`).
- `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck scripts/elevation-source-info.ts scripts/check-elevation.ts`: pass (`/tmp/dtm-script-types.log`).
- `node --import tsx scripts/browser-elevation-smoke.mjs http://127.0.0.1:9222 /tmp/elevation-browser`: pass, three groups, seven screenshots/report. Actual rasters and mocked provider transport, no live inference.
- `node --import tsx scripts/browser-cloud-workspace-smoke.mjs http://127.0.0.1:9222 /tmp/dtm-cloud-regression`: pass, five groups (`/tmp/dtm-cloud-browser.log`).
- `git diff --check`: pass. Bounded implementation diff inspected; prior Tasks080–083 retained.

Initial sandbox test/browser launches could not open local sockets; reruns with
local execution permitted passed. The elevation browser test initially found a
missing client tool-event allowlist entry; corrected and covered by dispatch
tests. A standalone script typecheck initially used NodeNext resolution; rerun
with the project's Bundler configuration passed. No checks were weakened.

GitNexus index refreshed: 12,953 nodes, 38,307 edges, 687 flows
(`/tmp/dtm-graph-index.log`). Whole-worktree change analysis includes prior work:
96 files, 971 symbols, 246 affected flows, **CRITICAL aggregate risk**
(`/tmp/dtm-graph-changes.log`). CLI list display is capped; this is not a complete
independent review. All new files were included through an isolated temporary
Git index; user staging/object storage was untouched. Pre-edit registration risk
was CRITICAL and cloud binding HIGH; source verification and actual end-to-end
tests addressed those paths. Fresh-session review remains pending.

Handoff: `/tmp/task084-dtm-dsm-handoff.md`. Next review should assess this task's
actual changes separately from Tasks080–083, especially source binding, NoData,
resource bounds and the client/server tool-event path. No commits made.
