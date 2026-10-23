# Task088 — Distance-based LOD and persistent point budgets

Status: implemented and verified; independent fresh-session review pending.

Request: nearer chunks remain sparse while focus-first allocation exhausts the
three-million-point cap. Choose per-chunk LOD from camera distance/projected size,
retain coarse coverage across the visible scene, refine nearer chunks first, and
make the point cap generous, editable and persistent in localStorage.

Acceptance:

- Orbit focus cannot starve nearer visible chunks. Visible top-level chunks get
  coarse coverage before deeper refinement; projected chunk size/distance chooses
  refinement independently of the cap. The cap only limits admission.
- Both shared-planner viewers and capture demands preserve ancestry, deterministic
  ordering, frustum culling, hysteresis and explicit budget-limited coverage.
- Add a validated custom point budget in existing Display controls, persisted
  per viewer. Default 3 million (user-selected), allowed custom range 65,536–50 million. Invalid/unavailable storage never breaks loading.
- Prepared GPU buffers allocate progressively, capped by the selected point limit;
  changing budget preserves camera, colors, selection and elevation layer.
- Toronto permits/persists the same custom range and uses its existing lazy batches.
  A point cap bounds native resident display points, not literal total process RAM;
  source payloads, capture cache and CPU/GPU copies also consume memory.
- Deterministic tests cover distance allocation/coverage, caps, persistence and
  buffer growth/shrink/provenance. Verify actual desktop/mobile UI, persistence,
  close/overview loading, errors and agent capture regressions. Preserve prior work.


Implementation:

- `viewer/adaptive-plan.ts`: coarse root/visible top-level octants precede
  refinement; finer nodes rank by projected diameter then camera distance.
  Near-radius and projected-size rules determine eligible depth; the cap only
  admits/truncates that target. Focus remains validated metadata, never priority.
- `viewer/display-budget.ts`: validated per-viewer storage keys, 3M default,
  65,536–50M custom values, corrupted/blocked-storage fallback. Prepared clouds
  retain Light/Balanced/Fine shortcuts plus editable Custom; Toronto uses a number
  input in existing Detail settings. Storage failure keeps session settings usable.
- `viewer/native-cloud-render.ts`: starts at 131,072 slots (or the smaller cap),
  grows with admissions, releases old GPU attributes before replacement, preserves
  exact source spans and shrinks capacity after eviction. Custom caps do not
  allocate their full capacity immediately. Toronto retains lazy packed batches
  and accepts the higher custom range. Batch granularity and source/capture
  buffers mean this is a display-point cap, not a byte-exact RAM cap.
- `prepared-cloud-viewer.ts`: changes budgets in place with correct grow/admit and
  evict/shrink ordering. Svelte initialization reads storage before scene loading;
  budget updates do not remount the viewer or clear selection/layers.

Verification (2026-10-22; Node 22.23.3, pnpm 10.34.6):

- `pnpm verify > /tmp/distance-lod-verify.log 2>&1` — exit 0; typecheck passes
  (zero Svelte diagnostics), all 1,029 tests pass, web build/server typecheck pass.
  Existing Vite bundle-size advisory remains. The later visual input-color fix
  was rebuilt and browser-verified; it does not affect planner/runtime tests.
- `node --import tsx --test tests/viewer/distance-lod-budget.test.ts
  tests/viewer/adaptive-display-client.test.ts tests/viewer/prepared-lod.test.ts
  tests/viewer/adaptive-render.test.ts tests/viewer/capture-detail.test.ts >
  /tmp/distance-lod-focused.log 2>&1` — 50/50 pass. Tests deliberately replace the
  superseded focus-priority expectations with coverage/near-detail checks, retain
  budget/ancestor/frustum/serialization/rollback/provenance checks, and add exact
  persistence, malformed-storage and progressive growth/shrink tests.
- `node --import tsx scripts/browser-distance-lod-smoke.mjs
  http://127.0.0.1:9223 > /tmp/distance-lod-browser.log 2>&1` — passes against
  built viewer/actual STPLS3D Real-world RA, STPLS3D Scene 1 and Toronto artifacts.
  Local provider supplies only a catalog; no inference. Artifact report/PNGs:
  `/tmp/distance-lod-browser/`. Verified 3M default, 4.5M custom admission without
  camera/color/canvas reset, closer native demand and RGB close view at 3M,
  retained selected semantic source identity/type, exact saved 1,234,567-point
  cap across reload, invalid input retaining prior active/saved cap, DTM/camera
  retention, visible loading failure/Retry, mobile custom input/no overflow,
  Toronto exceeding the former 3M ceiling and per-viewer persistence on remount.
  Desktop, selected, close/default, invalid, error, surface and mobile PNGs saved;
  desktop selected/custom, close/default and mobile PNGs visually inspected.
- `node --import tsx scripts/browser-capture-lod-smoke.mjs
  http://127.0.0.1:9223 /tmp/distance-lod-capture-browser >
  /tmp/distance-lod-capture-browser.log 2>&1` — all four groups pass: held
  off-screen demand/navigation/cache/colors, failures, Toronto top-down and
  background-disabled capture/cache/restoration. No live inference.
- `node --check scripts/browser-adaptive-display-smoke.mjs` and
  `git diff --check` — pass. Older smoke custom-budget assertions were updated;
  its entire historical UI workflow was not run/re-certified.
- GitNexus bound to `cad-agent` in this checkout; index at base HEAD
  `f2ac48bdf267121e42bf789964fa04bbd6fc74b6`. Planner/settings impact was
  CRITICAL and warned before editing; render helpers LOW, unresolved Svelte
  entrypoint callers confirmed in source. `detect_changes(scope: all)` reports
  critical aggregate risk over combined pre-existing terrain/UI/capture work and
  this task: 192 changed symbols, 113 affected flows, 38 tracked changed files;
  no partial/truncated flags. `/tmp/distance-lod-graph-analysis.json`.

Completion: implementation/verification complete; preserve all pre-existing
terrain/UI/capture work. No commit or independent review performed. Next action:
fresh-session review against this task and actual diff, particularly changed
planner semantics, memory accounting, buffer replacement/disposal and persistent
budget lifecycle. Custom settings apply to display; source queries remain exact
and independent of display LOD.
