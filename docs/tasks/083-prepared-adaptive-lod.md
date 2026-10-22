# Task083 — Adaptive LOD for prepared point clouds

Implement camera-driven progressive native Potree node display for every prepared
STPLS3D scene, synthetic and real-world. Share Toronto's existing planner; retain
explicit source identity and native RGB/semantic/instance values.

Acceptance:
- [x] Zoom/pan/orbit/resize select visible native nodes by projected size/focus, with bounded resident points and requests.
- [x] Complete validated proxy hierarchy and revision-bound binary nodes; stale/aborted work never enters another scene.
- [x] Preserve CPU source precision for picks and visual evidence, all color modes, fit/selection, and read-only agent authority.
- [x] Existing quality control sets LOD budget; visible errors have retry; routine metrics stay in Details.
- [x] Test planning/loading/eviction/disposal and server limits; verify actual dense scenes in desktop/mobile browser.
- [ ] Fresh-session review pending.

## Implementation

The existing Toronto screen-space planner/settings validation now lives in
`apps/web/src/viewer/adaptive-plan.ts`; Toronto imports it and keeps its existing
loading/approval behavior. Prepared clouds use a shared generic serial loader
and a packed bounded native render buffer. Exact Float64 CPU payloads resolve
picks and visual provenance independently of Float32 GPU positions. RGB is
converted from sRGB to linear colors; native uint16 semantic IDs and signed
int32 instances are retained. No source frames merge and no edit authority is
added. Visual coverage explicitly describes the current bounded display.

The prepared reader follows the existing bounded `readDisplayHierarchy` proxy
walker and caches validated catalogs per reader/revision. Native routes use
fixed registered IDs and octree names, explicit revision preconditions, local
origin/Host guards, cancellation/deadlines and at most 65,536 points per binary
response. The binary codec validates identities/lengths before allocating arrays.
Original-source agent queries and the initial bounded overview keep their
existing contracts. `adaptiveDisplay: true` is additive; `fullResolution: false`
continues to exclude an unbounded whole-cloud display.

The Display control now selects Light (500,000), Balanced (1,500,000), or Fine
(3,000,000) resident-point budgets. Camera motion prioritizes visible nodes by
projected size and inspection focus, evicts obsolete nodes and continues one
physical request lane. Failures latch until Retry detail; the overview remains
visible when detail fails before admission. Disposal aborts loading and releases
CPU/GPU caches. Switching away from an unsupported Instance mode falls back to
RGB for real-world clouds. Routine load counts remain inside Display.

## Verification evidence

- `node --import tsx /tmp/check-lod-real.mts` — actual complete catalogs and depth-4-or-deeper payloads load for synthetic Scene 1 and all four real-world scenes; `/tmp/lod-real.log`. Catalog totals equal 2,869,873 / 38,914,634 / 6,825,065 / 94,694,849 / 9,977,764 points.
- `node --import tsx --test tests/viewer/prepared-lod.test.ts` — 4/4 pass: lossless binary identity/scalars, corruption rejection, packed eviction/provenance, request-lane/late-response admission, error latch/retry/disposal; `/tmp/lod-new-tests.log`.
- `node --import tsx --test tests/datasets/prepared-lod.test.ts` — 2/2 pass: proxy chunks, signed instances/native semantic 65535, stale mutation/abort and bounded fixed HTTP endpoints; `/tmp/lod-server-tests.log`.
- `node --import tsx --test tests/viewer/prepared-lod.test.ts tests/viewer/adaptive-display-client.test.ts tests/viewer/adaptive-render.test.ts` — 37/37 pass, including unchanged Toronto planner/load/render regressions; `/tmp/lod-client-tests.log`.
- `pnpm typecheck` — pass, Svelte 0 errors/warnings; `/tmp/lod-typecheck.log`.
- `pnpm build` — pass, existing bundle-size warning; `/tmp/lod-build.log`.
- `node --import tsx scripts/browser-cloud-workspace-smoke.mjs http://127.0.0.1:9222 /tmp/lod-baseline-browser` — pass, 5 check groups: all color modes and real-world absence of instances, fake-provider captures, independent original-source query/reference selection, scene switching, mobile/errors/retry/Toronto switching. Visual pixel grounding waits for a settled camera display; refinement correctly invalidates stale pixel observations. `/tmp/lod-baseline-browser/report.json`, 20 screenshots. No live inference claim.

Initial browser checks caught stale readiness metrics between camera plans and
viewer lifetimes; pending state and scene identity are now updated synchronously
and cleared on disposal. Assertions were retained and waits bind to the current
scene/budget. The mobile quality popover is explicitly closed before subsequent
controls are used.
- `node --import tsx scripts/browser-prepared-lod-smoke.mjs http://127.0.0.1:9222 /tmp/prepared-lod-browser` — pass, 5 check groups: actual native depth increases on zoom, >100k display within budget, native semantic picks/recolor/Fit, delayed departed-scene cancellation, detail 503/retry, all four real scenes, mobile resize/Light budget and synthetic Instance → real RGB fallback. `/tmp/prepared-lod-browser/report.json`; compact metrics `/tmp/lod-browser-summary.json`. Inspected desktop RA close RGB, selected semantic and mobile USC semantic screenshots. Isolated Chrome and both test servers closed afterward.

## Graph and review

Repository/worktree: `cad-agent`, `/Users/kevin/Coding/spatial-cad-harness`, base
`1f3b550d00e1145568fd67fc79d34f427e262987`. Pre-edit planner CRITICAL,
settings/view validators HIGH and registry HIGH: warnings reported and existing
Toronto caller regressions retained. Prepared reader MEDIUM (interface-bound
callers make this a lower bound), route LOW. Prepared viewer and Svelte `load`
were UNKNOWN/unresolved by the graph; direct source/call-site inspection
confirmed the `PointCloud.svelte` constructor and local mount/change handlers.
No symbols were renamed.

`node .gitnexus/run.cjs analyze --index-only` — refreshed to 12,709 nodes,
37,611 edges, 698 flows; `/tmp/lod-graph-index.log`.
`python3 /tmp/lod-graph-check.py` — disposable Git index/object directory includes
37 untracked additions without staging user changes. All existing worktree
changes: 65 files, 723 symbols, 245 flows, critical aggregate risk;
`/tmp/lod-graph-changes.log`. This includes previous Tasks080–082; CLI displayed
lists remain capped and this is not a clean whole-diff review certificate.
`git diff --check` passes. No commit or staging; unrelated changes preserved.

Fresh-session review remains pending. Handoff: `/tmp/task083-adaptive-lod-handoff.md`.

Parallel-suite limitation: the unchanged global-cache cancellation assertion at
`tests/spatial/semantic-disk-storage.test.ts:182` intermittently observes another
builder's `.building-*` directory appear/disappear. Earlier full run passed
1007/1007 (`/tmp/lod-all-tests.log` was subsequently reused); later final parallel
runs reached 1006/1007, including one after browsers stopped. Thus browser load
alone is not established as the cause. The isolated file rerun passes 14/14 in
`/tmp/lod-cancellation-rerun.log`. Test assertions are unchanged; the full suite
is also run with serialized test files to avoid shared-cache contention.
- Final `pnpm exec tsx --test --test-concurrency=1 'tests/**/*.test.ts'` — **1007/1007 pass**, no skipped tests or weakened assertions, 67.1 seconds; `/tmp/lod-tests-serial.log`. Default parallel `pnpm test` remains subject to the shared-cache test race above (1006/1007 in its latest run); this remains a verification limitation for fresh review, not a claimed clean parallel baseline.

Implementation acceptance criteria are complete. Remaining work: fresh-session
review of the actual diff and separate investigation/isolation of the existing
parallel shared-cache test race. Task083 does not include the previously
discussed Cmd-click/AOI shared-interaction refactor.
