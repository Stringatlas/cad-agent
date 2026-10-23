# Task085 — regional terrain tools

Authorized: proceed with region summaries, slope layer, coordinate-bound terrain
images, profiles and connected-region filtering. Prefer established libraries.

Acceptance:
- [x] GDAL Horn slope artifacts bound to the existing elevation revision; no edge/NoData interpolation; all 29 prepared scenes generated and checked.
- [x] Bounded region statistics, profile sampling and four-connected region filters using Rasterio, NumPy, Shapely and SciPy; thresholds selected by caller; explicit coverage and units.
- [x] Coordinate-bound raster images delivered to the model as images, without invented browser/source-point provenance.
- [x] Conditional agent registration, strict schemas/runtime validation, skill instructions, client event handling and actual provider-loop tests.
- [x] Viewer slope mode with labeled degrees, errors/retry and desktop/mobile browser checks.
- [x] Checks, documentation and temporary handoff; independent review pending.

Original source only. NoData is never flat or clear space. Slope is a raster-scale
observation, not foundation flatness or suitability. Regions are connected cells
matching explicit filters, not ranked recommendations or geometry edits.

## Result

Implemented 2026-10-22. [Terrain analysis](../terrain-analysis.md) documents
libraries, setup, tool contracts, examples, analytical scope and remaining limits.
The toolbar's **Slope · Ground** uses degrees on supported ground. The existing
`elevation-models` skill now documents four additional composable tools:
`query_terrain_region`, `terrain_profile`, `filter_terrain_regions`, `terrain_image`.
Models receive actual terrain PNG image inputs with bounded coordinate mapping;
no browser pixel-grounding authority is created. Query IDs bind revisions,
operation and canonical arguments; component IDs are local observations.

All 29 scenes have `elevation/terrain/slope.tif` and a source/elevation-bound
manifest. GDAL handles the derivative calculation; Rasterio handles masks/windows,
Shapely topology, NumPy statistics, SciPy component labeling and Pillow images.
Pinned Python dependencies are an explicit optional runtime requirement. Missing
terrain dependencies leave ordinary source-point and DTM/DSM tools operational.

## Verification

Node 22.23.3 / pnpm 10.34.6. No live provider inference or paid model calls.

- `data/processed/toronto3d/tooling/venv/bin/python -m pip install --only-binary=:all: scipy pillow shapely`: installed SciPy 1.18.1, Pillow 13.0.0, Shapely 2.2.0 in the existing local venv (`/tmp/terrain-python-install.log`); versions pinned in `scripts/elevation-requirements.txt`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/prepare-terrain.py data/processed/stpls3d_realworld/ra`: pass (`/tmp/terrain-ra-build.log`).
- Same generator for `data/processed/stpls3d/{1..25}` and real-world `occc`, `usc`, `wmsc`: remaining 28 pass (`/tmp/terrain-all-build.log`). Every slope mask checked independently against all nine supporting DTM cells, with geometry/value bounds checked.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/terrain.test.py`: 2/2 pass (`/tmp/terrain-python-tests.log`); independently specified 45° plane, means, known component areas, NoData separation, profile grades/repeated cells, mapping, malformed/oversized polygons.
- `node --import tsx scripts/check-terrain.ts`: 29/29 pass (`/tmp/terrain-reader-all.log`, `/tmp/terrain-compatibility.json`). Actual full raster statistics, caller-threshold regions, profiles, PNG images and previews; full layer counts and slope ranges compared to manifests.
- `node --import tsx --test tests/datasets/terrain.test.ts tests/agent/terrain-tools.test.ts tests/agent/agent-tools-inspection.test.ts tests/agent/product-agent-skills.test.ts`: initial 21/21 pass (`/tmp/terrain-new-tests.log`). Subsequent geometry/cancellation cases are included in the full suite.
- `pnpm test`: **1016/1016 pass**, no skips/failures (`/tmp/terrain-full-tests.log`).
- `node --import tsx --test tests/agent/terrain-tools.test.ts tests/agent/product-agent-skills.test.ts tests/agent/agent-tools-inspection.test.ts`: 19/19 pass after final image-safety prompt clarification (`/tmp/terrain-prompt-tests.log`).
- `node --import tsx --test tests/datasets/terrain.test.ts tests/agent/terrain-tools.test.ts tests/agent/product-agent-skills.test.ts`: pass after the final explicit-string layer validation fix (`/tmp/terrain-final-tests.log`).
- `pnpm typecheck`: pass, Svelte 0 errors/warnings (`/tmp/terrain-typecheck.log`).
- `pnpm build`: pass, existing large-chunk warning (`/tmp/terrain-build.log`).
- `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck scripts/check-terrain.ts`: pass (`/tmp/terrain-script-types.log`).
- `node --import tsx scripts/browser-terrain-smoke.mjs http://127.0.0.1:9222 /tmp/terrain-browser`: pass, three groups; actual RA/WMSC rasters, all four agent tools, model PNG input, slope capture, desktop/mobile controls, picking, retry and scene reset. Seven screenshots plus `/tmp/terrain-browser/agent-terrain-image.png` and `report.json`; representative images visually inspected. No browser console errors.
- `node --import tsx scripts/browser-cloud-workspace-smoke.mjs http://127.0.0.1:9222 /tmp/terrain-cloud-regression`: pass, five groups (`/tmp/terrain-cloud-browser.log`).
- `git diff --check`: pass. Terrain diff and additions inspected; concurrent Task086 workspace UI edits preserved. No LSP interface or installed spatial-rendering/pi-browser-harness skill was available; actual CLI diagnostics and repository Playwright/CDP scripts supplied verification.

Initial browser fixed-coordinate picking landed in deliberate slope NoData holes;
the check now clicks an actually rendered supported pixel and still requires
successful source-cell inspection. Initial typecheck caught an unknown tool name
passed to a string array; corrected with an explicit type guard. Initial catalog
test required the fake full-capability adapter to include the new operation;
added it without weakening the no-ghost-registration assertion.
Final diff inspection also tightened layer validation to reject arrays instead
of allowing string coercion; the regression is covered in the final focused run.

## Review and handoff

GitNexus pre-edit checks flagged the shared registry/capability/instruction paths
CRITICAL and the cloud binding HIGH; warnings were reported and actual dispatch,
prompt parity and web event tests cover those paths. Viewer/client UNKNOWN caller
walks were confirmed against Svelte call sites before changes.

Final index: 13,249 nodes, 39,105 edges, 700 flows
(`/tmp/terrain-graph-index.log`). Whole-worktree analysis included 13 additions via
an isolated temporary Git index: 38 changed files, 230 symbols, 53 affected flows,
**CRITICAL aggregate risk** (`/tmp/terrain-graph-changes.log`). This includes the
concurrent Task086 UI work and is not an independent review certificate. CLI
detail lists are display-capped; aggregate counts are reported without claiming
every symbol was displayed. The user's real index and object database were not
modified by the analysis. Re-run against the latest worktree before any commit.

Source and evidence are ready for **fresh-session review**, which remains pending.
Handoff: `/tmp/task085-terrain-analysis-handoff.md`. No commit or staging performed
by this session. HEAD advanced externally to `f2ac48b` during work and includes
the initial Task085 generator/worker/contracts; review those files as well as the
remaining uncommitted terrain diff. Separate Task086 changes are outside this
task's ownership. Follow-up terrain work includes evaluated filtering, adaptive
raster tiles, Toronto integration and shared scene-region visualization.
