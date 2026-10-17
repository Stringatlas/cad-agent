# 038 — Focused street testing and derived preprocessing

Status: Implemented bounded slice; fresh-session review pending. No commit.

## User request and acceptance criteria

First streamline testing: zoom to a particular street chunk, default to full resolution there, add an eye icon toggling preprocessing solids/overlays. Then continue required preprocessing: labeled Pole/Car/Fence instances (Building optional), ground elevation, quality-reported primitive fits and scalable nearest/radius/clearance indexing. Preserve CAD-first approval, original memberships/provenance, meters/frame/revision and truthful uncertainty.

- [x] Deterministic source-anchored 40×40×28m camera/crop on first mounted artifact; exact progressive detail automatically loaded once, not after each orbit.
- [x] Eye toggle for actual derived bounds, approximate fits and supported observed ground; hidden/loading/ready/empty/unavailable/failure and truncation states; cleanup/cancellation and screenshot invalidation.
- [x] Additive offline full-source sparse ground + instance fit artifact; exact original source bounds and memberships, quality/residual/coverage, complete-only publication, bounded work/cancellation/source checks.
- [x] Additive page KD-tree/BVH library covering all original points with exact nearest/radius/point-distance clearance, deterministic ties, explicit result/resource bounds and brute-force fixture comparison.
- [x] Actual-data preparation, browser behavior/visual inspection, full tests/typecheck/build and source diff inspection.
- [ ] Fresh-session review of actual tracked **and untracked** changes, including prior task037. Implementation/checks are not review approval.

## Scope / implementation

Frontend first, then offline preprocessing, then real summary integration. Separate agents owned frontend, offline ground/fits, page-tree library and real summary integration; parent integrated documentation, corrective inspection, deadline fix and final baseline/browser checks. Existing task037 dirty work preserved.

- `apps/web/src/street-chunk.ts`, `Toronto.svelte`: pick one source-sample-anchored street AABB, focus camera and reuse exact crop streaming. Outside the box, the overview is still sampled. Existing full-resolution cancel/clear/retry/manual box/window tools remain; orbit does not retrigger loading.
- `apps/web/src/preprocessing-overlays.ts`, `toronto-viewer.ts`: disposable purple AABBs, amber fitted primitives and green supported flat observed tiles. Eye refresh uses current box; change box then explicitly Refresh. No authority mutation; visible derived overlays block source-grounded screenshots.
- `apps/server/src/scene-preprocessing.ts`, `scripts/prepare-scene-preprocessing.ts`: three checked semantic-index passes, full original-payload SHA256 and exact streamed membership/source/checksum/count validation. Sparse 2m Ground/Road_markings observed minima with support; vertical pole cylinders, PCA XY car boxes, optional rectangular building extrusions; fences bounds-only. Actual finite-surface RMSE/coverage and explicitly heuristic quality. Bounds/fit/ground remain original-source observations, not effective edited positions or CAD bodies. Atomic complete-only publication with input/output/cell/time limits.
- `apps/server/src/preprocessing-summary.ts`, `dataset-routes.ts`: fixed operator manifest file; optional bounded box query; validate source/frame/coordinates and fields; cap2000 instances/10000 supported tiles/1MiB JSON with explicit truncation. Missing/stale/malformed artifacts unavailable. No expensive preparation or client filesystem paths in HTTP.
- `apps/server/src/spatial-page-index.ts`: complete physical-page median-split KD-tree/BVH, then exact binary64 point checks in candidate pages. Nearest, radius count/capped deterministic subset and point-clearance API; caller-owned snapshot, source identities, abort/page/time budgets. Library-only; existing independently verified production label tools unchanged.

[Operator guide, contracts and commands](../street-testing-preprocessing.md). Default generated artifact installed without overwriting existing data at `data/processed/toronto3d/preprocessing/manifest.json` (ignored by Git). Alternate `SPATIAL_PREPROCESSING_PATH` is a **manifest file** path.

## Actual source evidence

- Complete source: **78,320,210 points**, source-bound task037 artifact `/tmp/spatial-task037-actual-v1/`.
- Prepared output `/tmp/spatial-task038-preprocessing-v1/manifest.json`: **1,377 instances**, **5,907,180 memberships**, **719 fitted**, **494 insufficient**, **164 bounds-only fences**. Ground uses **43,442,805** Ground/Road_markings points → **13,394 cells**, **12,746 supported**. About1.95MB JSON,32.97s preparation, final RSS~178MB (not peak). Repeated independent preparation produced identical artifact hash. Logs `/tmp/spatial-task038-preprocessing-run.json`, `/tmp/spatial-task038-preprocessing-recheck-run.json`.
- Page tree: **19,122 pages**, pure tree build79.54ms. Actual original-point nearest675–2184ms reading793–3197 pages; radius1m760–1840ms reading1134–2793 pages. `/tmp/spatial-page-index-benchmark.jsonl`. Broad physical-page overlap limits pruning; no universal interactive latency guarantee or point-level tree claim.
- Actual browser default box `[220.039,553.499,131.408]`–`[260.039,593.499,159.408]`: **3,217,790 exact detail points**, one crop request; orbit moves without reloading. Eye summary **12 bounds,9 approximate fits,368 ground tiles**,37737bytes. Mean heuristic quality~.115: this is visible low-quality estimation evidence, not accepted fitting quality.

## Verification

Final parent checks after integration/deadline correction:

- `pnpm verify > /tmp/spatial-task038-verify.log 2>&1`: **BLOCKED** at tsx CLI IPC socket (`listen EPERM /tmp/agents/tsx-501/...pipe`), after recursive typecheck + test TypeScript check passed. Do not call composite verify passing. Child process environments had passing checks, but final parent result is authoritative.
- `node --import tsx --test tests/*.test.ts > /tmp/spatial-task038-tests.log 2>&1`: **723/723 passed**, no skipped/cancelled/failures.
- `pnpm build > /tmp/spatial-task038-build.log 2>&1`: pass; existing Vite large-chunk warning.
- `node --import tsx scripts/browser-street-testing-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task038-browser > /tmp/spatial-task038-browser.log 2>&1`: pass against existing Chrome, built viewer, actual prepared source and **default artifact path**. Own tab/ephemeral backend, isolated authority, no operator credentials/provider calls. Actual overlays and hide tested; empty/unavailable/HTTP503 states use explicitly labeled response fixtures. Expected fixture503 console resource error; no page errors. Screenshots visually inspected: `/tmp/spatial-task038-browser/{street.png,actual-preprocessing.png}`; report/AX/summary JSON alongside.
- Targeted added-file diagnostics clean; final workspace cached LSP still reports20 unrelated stale client/test errors plus one deprecated hint in four untouched files. Fresh CLI TypeScript/Svelte checks pass; no clean cached-workspace diagnostic claim.
- `git diff --check`: pass. Parent inspected tracked code diffs and added implementations; no commits/staging, earlier user work retained.

Corrective read-only inspection found preprocessing maxMilliseconds initially did not cancel cold index preparation. Fixed by combining caller abort with `AbortSignal.timeout` passed through the whole operation. Final tests cover failure/budgets; a dedicated cold-cache timing regression test remains useful. No separate post-fix production rederivation was required: derivation/settings unchanged, final tests/browser pass.

Graph: index one commit stale. Pre-edit `createDatasetRoutes` upstream **LOW** (server factory/performance flows); frontend methods UNKNOWN with source callers verified; added modules absent from graph, UNKNOWN confirmed by source imports/tests. Prior task037's CRITICAL shared index was left untouched. Final `detect_changes(scope:all)` reports aggregate **HIGH** (dataset/viewer shared paths),20 tracked symbols/9 processes, but omits untracked implementations. This is **not clean graph certification**. Review/refresh graph including added files before any commit.

## Remaining limits / next action

Ground minima are low-outlier-sensitive and discontinuous; unsupported/missing cells return no elevation. Approximate fits assume vertical poles and rectangular XY car/building footprints, bias under partial scans and provisional merged/fragmented components; no robust physical-object quality threshold is claimed. The source-membership audit is not segmentation-quality verification. The library index is page-based, not point-level, and its clearance is to original points, not CAD surfaces. No model tool/effective-position index/approval-gated fit proposal is added. Existing older browser suites assuming50k total startup points may need deliberate adaptation to the new auto-detail behavior; they were not rerun or claimed passing.

Next: fresh-session bounded review, then operator assessment of visible fit/ground/segmentation quality and latency before broader model/CAD integration. Handoff `/tmp/spatial-task038-handoff.md`.
