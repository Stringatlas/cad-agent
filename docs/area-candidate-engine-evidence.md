# Task065 — Area candidate point engine evidence

## Algorithm and contract

`apps/server/src/placement/area-candidate-search.ts` exports `searchAreaCandidates(snapshot, area, settings, authorities, signal)` and `validateAreaCandidateSettings(value)`. It does not create or retain CAD/point proposals. The authority caller must reject effective source edits and compare both live authorities after the await before publishing.

One request-local pass visits **each relevant physical original-source semantic page at most once**. Exact validated per-label page XY bounds can exclude only pages with neither AOI observations nor Pole observations. Every pole-bearing page globally is included, even outside the AOI. Every record in each visited page is examined; there is no witness/sample cap or per-candidate page query. The semantic cache preserves original records and provenance; `getSemanticDiskIndex` can prepare it if missing. No terrain preprocessing, equipment box or CAD proposal is required.

The AOI-aligned grid holds full observed ground counts/min/max and a non-ground occupancy bit. Ground/Road_markings are support; any other class at **any** elevation is a conservative obstacle. A candidate disk checks every intersecting closed support-cell square. Every cell requires at least three ground observations, and any obstacle cell rejects it. Ground relief is full min/max, not a fitted/capped sample; candidate Z is maximum observed support height. Boundary slivers and missing support are rejected, not interpolated.

Pole observations reduce to occupied XY quantization cells. A balanced spatial tree finds nearest occupied-cell center; reported `poleDistanceMeters` is **a conservative lower bound**, `max(0, nearestCenterDistance - halfCellDiagonal)`, not an exact physical pole distance. True observed-point distance lies between this value and this value plus one cell diagonal. No original pole observations gives null. Min-distance filtering uses the conservative lower bound. Numerical ranking and deterministic ties select up to model-requested `maxCandidates` points (1–20; legacy omission defaults to 5), separated by at least max(requested spacing, clearance diameter).

Resolution is `max(0.5, min(2, spacing/2), clearanceRadius/16)` meters. The effective lattice stride rounds spacing upward to whole cells. The result carries cell size and explicit limitations, including up-to-one-cell-diagonal clearance overreach and pole uncertainty. This is observed-only location screening, not continuous support, physical clearance, safety, equipment-fit or foundation certification.

Budgets fail closed with `incomplete, []`: 120 seconds including index preparation; 100,000 visited pages; 250,000 AOI cells; 250,000 occupied pole cells. Cancellation, cache/source mutations, read failures and budget exhaustion retain no partial shortlist. Original artifact and semantic cache are rechecked after ranking. Settings ranges: spacing 0.5–100m, radius 0–25m, relief 0–10m, minimum pole distance 0–1000m; exact ranking enum; unknown/missing settings rejected.

## Measured runs

Node `v22.23.3`. No paid inference or browser interaction. Measurements are local wall-clock timings, not a latency guarantee.

Command:

```sh
AREA_BENCH_X=250 AREA_BENCH_Y=400 pnpm exec tsx scripts/check-area-candidates.ts > /tmp/task065-area-candidates-populated-benchmark.jsonl
```

The script now defaults to these populated Toronto coordinates. Full original output: `/tmp/task065-area-candidates-populated-benchmark.jsonl`.

Settings for both: spacing 2m, clearance radius 1m, max relief 0.2m, minimum pole lower-bound distance 1m, flat-ground ranking. Grid 1m, 2,500 lattice positions evaluated. Full-cell support makes some boundary locations deliberately unavailable.

| Measurement | Synthetic 100×100m | Actual Toronto 100×100m |
|---|---:|---:|
| Total original-source points | 120,000 | 78,320,210 |
| Total physical pages | 30 | 19,122 |
| Relevant physical pages read once | 30 | 11,725 |
| Original records examined | 120,000 | 48,022,098 |
| Original observations inside AOI | 120,000 | 34,072,026 |
| Engine elapsed milliseconds | 42.46637500000003 | 5254.452041 |
| Separate fixture/index preparation milliseconds | 144.954458 | 83.075916 |
| Result | complete, 5 candidates | complete, 5 candidates |

Synthetic fixture includes all 120,000 support records (three Ground/Road_markings observations per 0.5m cell). No terrain file exists. Actual Toronto AOI XY corners `(250,400),(350,400),(350,500),(250,500)` uses the entire vertical domain; its reference-plane Z=0 is not used as terrain. The existing semantic index was **loaded**, not cold rebuilt; cold real-data preparation is unmeasured. Engine duration includes its own index load/check and final source checks, separate from script's diagnostic preload. Page exclusions are conservative original-source metadata proof, not a capped subset of the selected area.

Actual bindings:

- Artifact revision: `beff0c86c640bdfac9c0961265bd2642adbf310e673af1108307ec17ee141993`
- Index hash: `4bc35f16c03400c6cf6449f036da56fd2295e14ed050e9b86a54ec1773f7471d`
- Source hash: `68800142dee822cd6b4ec0c6894f9a2f8fd6ce5af513d075f7ac6a2029121383`

Actual shortlist (meters, local Z-up):

| Rank | XYZ | Ground records | Observed relief | Pole-distance lower bound |
|---|---|---:|---:|---:|
| 1 | 300.5, 406.5, 134.557 | 16,044 | 0.060 | 14.158961966131958 |
| 2 | 298.5, 412.5, 134.529 | 19,450 | 0.062 | 8.726874350870055 |
| 3 | 288.5, 466.5, 134.244 | 4,525 | 0.062 | 6.0010971513128215 |
| 4 | 296.5, 418.5, 134.508 | 24,927 | 0.062 | 5.292893218813452 |
| 5 | 282.5, 462.5, 134.327 | 27,424 | 0.067 | 10.10954704520542 |

All returned candidates have zero observed non-ground obstacle cells in their conservative clearance neighborhoods. At grid 1m, each pole lower bound has at most `sqrt(2)`m additive uncertainty relative to nearest original observed pole point.

A preliminary real run on XY `[100,200]×[100,200]` completed in 1019.528833ms, 1,778 pages / 7,279,186 records examined, **zero AOI observations and zero candidates**. This was a real empty region, not evidence of ground support. Output: `/tmp/task065-area-candidates-benchmark.jsonl`.

## Focused verification

- `pnpm exec tsx --test tests/placement/area-candidate-search.test.ts`: **8/8 passed**. Covers 100×100m exhaustive counts and no page rereads, IDs/ranks/diversity, insufficient/missing support, full relief, unknown/high obstacles, rotated rectangle, conservative global pole bounds/rankings, disk clearance, pre/mid-pass cancellation, grid budget, source mutation, strict settings/frame validation.
- `git diff --check`: passed for the current shared workspace at the checkpoint.
- LSP diagnostics run after source/test/script edits. Initial child-checkpoint missing contract exports were resolved by parent integration. Final workspace typecheck/build pass; see task065 for current checks rather than the superseded intermediate compiler state.
- GitNexus concept query inspected original-source page/index flow. Impact on new engine/helper was `UNKNOWN` (not indexed); source search confirmed only new engine/tests/script references, with no existing server edits by this child. Index is two commits behind. No commit was attempted.

Parent protocol/model/UI integration, desktop/mobile browser checks, workspace typecheck/build, full tests and focused independent corrective review are now recorded in [task065](tasks/065-large-area-candidate-points.md). Cold real-data index timing and whole-checkout fresh-session review remain pending. Engine benchmark alone is not end-to-end certification.
