# Task089 — Composable agentic scene exploration

Status: In progress — Phase 1, single-pixel Phase 2, Phase 3a/3b and Phase 4a accepted; Phase 4b1a evidence issuance/lookup delegated and underway.

## Ownership and operating procedure

- Coordinating owner: primary development agent; preserve this checklist across sessions.
- Implementation owner: delegated agent `scene_agency_phase1`, next Phase 4b1a;
  root owns coordination, the Phase 2 review fixes and prepared-cloud hypotheses.
- Reviews: separate fresh-session Phase 1, Phase 2 and Phase 4a reviews are recorded
  below. Assign a new independent review for each subsequent implemented slice.
- Update checkbox states only with evidence. Implementation, verification and independent
  review are separate milestones. Do not call the whole task complete while required
  capabilities or review remain outstanding.
- Work in bounded slices, using this order/dependencies. Begin the next slice when its
  prerequisites are satisfied; ask only for material product ambiguity or required
  authorization. Record one concrete next action before each handoff.

## Goal

The product model chooses observations, forms spatial hypotheses, calls further tools,
revises its understanding and answers or proposes geometry using traceable evidence.
Provide small reusable scene operations, not fixed task-specific search/ranking chains.
An observation may inform a hypothesis; it cannot grant geometry authority or approval.

## Scope and invariants

- Extend the existing provider/tool/browser loop and adapter boundaries. Pi remains
  development tooling. The scene projects authoritative state; render caches do not.
- Keep dataset/source IDs, local-meter frames/origins, revisions and evidence scope
  explicit across tools. Original source, derived clusters, authored objects, accepted
  edits and pending ghosts are distinct.
- Default agent inspection uses its own view. Preserve the person's camera, colors,
  selection, layer and detail settings. Moving their visible camera is a separate
  deliberate interaction when requested, not a side effect of observation.
- Geometry proposals remain ghosts until individually accepted by a human. Do not add
  model-callable approval/publication/Undo or weaken stale-state checks.
- Bound requests, cache/observation retention, bytes, CPU/GPU use and runtime. Distinguish
  ready, budget-limited, incomplete, unsupported, ambiguous, stale and unavailable.
- Reuse available loaders, spatial indexes, instance attributes, terrain services,
  contract validators and proposal authorities; prefer established libraries for new
  scientific operations. Do not build a parallel renderer or generic agent framework.
- No paid/live inference, public deployment, unrelated refactors or commits are included
  in the initial assignment. Live evaluation requires separate explicit authorization.
- User preference from task088: keep the default display cap at **3 million points**;
  custom per-viewer caps through 50 million persist in localStorage.

## Current foundation — source verified, not a new implementation claim

- `apps/server/src/agent/provider-model.ts`: repeated model/tool/result/image rounds,
  runtime skills, capability-gated registration, bounded histories and approval waits.
- `apps/server/src/agent/model-agent-runtime.ts`: nonce-bound browser operations,
  original-reference verification, authority rebind and cancellation.
- Source-point queries, elevations/terrain measurements and explicit-camera captures
  exist; inspect current schemas rather than infer capability from this roadmap.
- `scene-exploration.ts` supplies conversation-owned Toronto hypotheses. Authored
  `list_objects/get_object` do not enumerate all source instances or CAD entities.
- Tasks087/088 implement independent capture LOD and distance-based display refinement.
  Borrowed off-screen imagery deliberately loses live pixel grounding after restoration.
- Existing synthetic-provider tests establish transport and guards, not actual-model
  exploration quality or broad production-scale certification.

## Long-running checklist

### Phase 0 — Preserve and bind the workspace

- [x] Record source-grounded gaps, existing capabilities and dependencies in this task.
- [x] Create redacted OS-temp handoff linking existing task087/task088 evidence.
- [x] Implementer reads AGENTS.md, architecture/product vision and relevant skills;
  records HEAD, dirty baseline and exact assignment before editing.
- [x] Bind GitNexus to this checkout; verify source, run upstream impact before edits,
  warn on HIGH/CRITICAL, resolve UNKNOWN using source/text evidence.

### Phase 1 — Repair cloud conversation continuity (start here)

Known defect to reproduce: `ProviderModel.turn` compares a cloud continuation binding
containing mode, cloud ID, source revision, frame and origin, but persists only mode
at successful completion. A valid next cloud turn is rejected as stale-conversation.

- [x] Reproduce with a focused regression: two successful turns against the same bound
  cloud must retain prior tool evidence and reach the provider on the second turn.
- [x] Derive/persist/compare the same canonical complete binding, including after any
  allowed reference-selection/authority rebind. Do not relax stale validation.
- [x] Reject changed dataset, revision, frame, origin, model/account or expired history.
  Preserve Toronto/pole continuation and failed-turn nonpublication behavior.
- [x] Verify a cloud capture then follow-up turn through the actual browser bridge
  using a local fixture provider. Reuse the reproduction noted in task087 rather
  than hiding continuation failures with New chat.
- [x] Run appropriate focused checks, typecheck/build and relevant baseline checks;
  record exact commands, artifacts and actual diff scope.
- [x] Independent fresh-session review and fixes; phase accepted only afterward.

### Phase 2 — Stable capture-scoped grounding (depends on Phase 1)

- [x] Design the smallest bounded immutable observation/picking record: camera,
  projection/crop mapping, visibility/occlusion, source binding and sufficient
  source-ID/depth data. Record memory/expiry policy before implementing retention.
  Design and implemented policies recorded in [Phase 2 artifact](089-capture-grounding-design.md);
  independent implementation review is READY and the single-pixel slice is accepted.
- [x] Resolve pixels from the captured frame after the user's buffers/view are restored;
  retain historical capture identity without claiming current geometry authority.
- [x] Independently verify returned original keys/coordinates/frame/revision server-side.
  Edited/ghost/raster imagery must never fabricate original point provenance.
- [x] Explicitly handle no-hit, multiple points, occlusion, clipping, unsupported
  layers, stale source, expired observations and resource exhaustion.
- [ ] Extend to a bounded image-region query only when its geometry/coverage semantics
  are defined; do not infer depth or free space from empty pixels.
  Deliberately deferred follow-up: this slice implements the single-pixel primitive only.
- [x] Test off-screen/top-down views, resize/crop mapping, concurrent navigation,
  replacement/cancel/dispose, scene/revision changes, eviction and bounded memory.
- [x] Built-browser round-trip and independent fresh-session review.

### Phase 3 — Composable agent view framing (depends on Phase 2)

Assessed [view design](089-agent-view-design.md); [Phase 3a](089-agent-view-3a.md)
is independently accepted for original points/boxes and current-turn relative views.
Delegated [Phase 3b polygon-prism framing](089-agent-view-3b.md) is independently accepted.
Cross-turn resume remains a Phase 7 follow-up; no whole-Phase-3 completion claimed.

- [x] Extend/reuse capture interfaces to frame a verified reference or spatial region
  and request top/oblique/relative orbit/zoom views. Final schemas/tool names are
  design decisions for the slice, not irrevocably prescribed by this checklist.
- [x] Return an explicit view/observation reference that subsequent view operations can
  consume; do not force the model to reconstruct arbitrary world camera coordinates.
  Accepted 3a scope: latest successful current-turn view, bounded to five minutes.
- [x] Expose only capability-supported layers/color modes, with truthful loaded target
  and coverage; await admitted target plus rendered frame, not global queue emptiness.
- [x] Preserve user viewport/settings; cancel stale/superseded jobs and reuse cache.
- [x] Add polygon-prism validation and explicitly enclosing-box framing/receipts in 3b.
- [x] Test deterministic framing, degenerate/large bounds, source binding, boundaries,
  zoom limits, user navigation, browser restoration and independent review.

### Phase 4 — Shared spatial vocabulary and exploration state

Begin after Phase 1; coordinate observation/reference contracts with Phases 2–3.

First bounded slice: [prepared-cloud hypotheses](089-cloud-marks.md), accepted after
independent review and final built browser checks. This does not complete
shared regions, evidence handles or resume semantics below.

Next design: [conversation evidence and regions](089-exploration-evidence-design.md).
Implement typed evidence issuance/lookup first (4b1a), then optional hypothesis links
(4b1b), then retained regions and a capture consumer (4b2). The design has been assessed; bounded 4b1a implementation is delegated. Runtime
verification and independent implementation review remain pending.

- [ ] Define minimal compatible references, regions, observations/evidence and hypotheses
  so outputs can feed later tools without invented IDs or lossy coordinate copying.
- [ ] Support reusable checked boxes/polygons/referenced bounds with explicit frames,
  units and revisions; preserve per-adapter availability rather than invent mappings.
- [x] Extend lightweight hypotheses/marks to supported prepared clouds as well as
  Toronto, retaining stable IDs, revision conflicts, rationale and uncertainty.
- [ ] Link findings to observation/measurement evidence and unresolved questions;
  record investigated regions without implying unseen/occluded areas are understood.
- [ ] Bound lifetime/storage and define restart/resume/stale-source behavior. Keep
  disposable investigation state separate from authored geometry and committed CAD.
- [ ] Revision/invalidation/replay/conflict tests, scene feedback with restrained UI,
  browser evidence and independent review.

### Phase 5 — Generic entity/instance inspection

Depends on Phase 4 reference/region contracts; implement adapters incrementally.

- [ ] Query source instances/entities in a region with type filters and pagination;
  inspect returned IDs, bounds, counts, attributes and source memberships.
- [ ] Use native instance identity where available; derived clusters carry algorithm,
  settings, source binding and hypothesis status. Never imply every scene has instances.
- [ ] Keep source instances, authored datums and CAD entities distinguishable while
  providing compatible inspection/reference interfaces where practical.
- [ ] Advertise exact supported capabilities; return explicit unavailable otherwise.
- [ ] Verify pagination, large scenes, membership identity, stale sources, incomplete
  coverage, source/edited distinctions, runtime integration and independent review.

### Phase 6 — Generic geometry measurements

Depends on Phase 4 regions/references; reuse Phase 5 entities where available.

- [ ] Choose a bounded first set driven by general tasks: region statistics/bounds,
  distances/heights/extents, plane/normal or primitive fits, and surface boundaries.
  Split into separate child slices rather than shipping one large toolbox at once.
- [ ] Reuse scientific libraries and existing source/terrain services; document exact
  versus estimated outputs, support/sample size, residuals and uncertainty.
- [ ] Measurements accept compatible region/reference outputs and return reusable
  evidence. The agent owns hypotheses, comparisons and threshold choices.
- [ ] No automatic best-location ranking, suitability certification, clearance claims
  from missing observations, or geometry edits disguised as measurements.
- [ ] Independent numerical oracles, malformed/degenerate/sparse cases, performance
  bounds, actual-source checks, runtime integration and fresh-session review.

### Phase 7 — Resilient long explorations

Address local recovery needs earlier when encountered; broad completion follows
Phases 1–6. Retain existing cancellation/authority/output gates throughout.

- [ ] Return structured recoverable results for safe read failures, invalid bounds,
  insufficient support and transient loading so the model can revise its next call.
  Identity/authorization violations remain fail-closed; never auto-retry mutations.
- [ ] Compact context using bounded evidence handles and explicit summaries; preserve
  traceable raw evidence and uncertainty rather than retaining every large image/array.
- [ ] Define checkpoints/resume, cancellation and budget-exhaustion receipts. On resume,
  revalidate source/authority and distinguish completed observations from pending work.
- [ ] Update runtime skills to explain composable tools and limits without mandating
  a fixed tool sequence. Keep effective prompt and reference/parity tests aligned.
- [ ] Test failed-tool recovery, stale checkpoints, interrupted approval, repeated
  observations, context limits and long multi-round fixture runs; independent review.

### Phase 8 — Evaluate adaptive scene understanding

Build deterministic fixtures alongside earlier phases; live evaluation is separately gated.

- [ ] Define tasks where later evidence must change earlier hypotheses: identify a
  rooftop feature, distinguish nearby instances, investigate a candidate region,
  compare terrain or measure geometry across views. Use held-out scenes/variants.
- [ ] Score correct source grounding, measurements, evidence traceability, uncertainty,
  useful next observations, recovery, stopping and task success—not fixed tool order.
- [ ] Fixture-provider browser/runtime tests verify transport, guards and feedback.
- [ ] Define actual-model protocol, model/settings, cost/runtime limits and success
  rubric; obtain explicit authorization before any paid/live inference.
- [ ] Run authorized evaluations, retain redacted traces/artifacts, report failures and
  regressions, and distinguish integration success from model competence.
- [ ] Independent review of results and remaining limits before broad capability claims.

## Per-slice completion gate

- [ ] Task/slice scope, acceptance and affected paths recorded before implementation.
- [ ] Shared contracts/runtime validation, adapter/capability binding, exact registry
  schema/dispatch and browser/replay delivery all agree for newly exposed tools.
- [ ] Source/frame/revision/evidence/approval invariants and lifecycle bounds verified.
- [ ] Appropriate tests/checks run; desktop/mobile/idle/selected/pending/error browser
  states inspected when relevant. Unrun/blocked checks remain explicitly unverified.
- [ ] Actual diff inspected; concurrent changes preserved; graph change analysis
  recorded before any separately authorized commit (partial/truncated is unresolved).
- [ ] Independent review tracked separately from implementation/verification.
- [ ] Checklist, evidence, remaining failures and single next action updated; redacted
  handoff under OS temp references artifacts and suggested skills.

## Verification evidence and progress log

| Slice | Implementation | Verification | Independent review | Evidence / next action |
| --- | --- | --- | --- | --- |
| Roadmap/handoff | Recorded | Source assessment only | Pending | This file; begin Phase 1 |
| Phase 1: cloud continuation | Implemented; canonical complete binding on admission and successful persistence | 167 focused / 1,034 baseline tests; typecheck/build; built fixture browser passed | Accepted: READY, no actionable defects | Independent review `/tmp/agent-scene-agency-phase1-review.md`; 121 reviewer-run tests passed |
| Phase 4a: prepared-cloud hypotheses | Implemented; strict source binding, reuse existing marks and scene feedback | 118 focused tests; final typecheck/build; 1,066 combined baseline tests; final desktop/mobile fixture passed | Accepted: READY, 12 independent tests; metadata finding fixed | [Slice evidence](089-cloud-marks.md); shared regions/evidence/resume remain |
| Phase 2: single-pixel capture grounding | Implemented; immutable bounded snapshot and independent original-record verification | Post-fix 45 focused, 1,069 full serial tests; typecheck/build; sparse/real-source browsers passed | Accepted: READY; 123 independent tests, two findings fixed | Post-review evidence below; image-region query remains deferred |
| Phase 3a: composable views | Implemented; original-point/box framing and current-turn relative views | Final typecheck/build, 1,090 serial tests; independent prepared/Toronto browsers pass | Accepted: READY; two lifecycle findings fixed/reverified | [Assignment](089-agent-view-3a.md); `/tmp/agent-scene-agency-agent-view-3a-review.md` |
| Phase 3b: polygon prisms | Assigned; source/graph preparation | Not yet run | Pending | [Assignment](089-agent-view-3b.md) |
| Remaining Phase 4b–8 | Planned | Not run | Pending | Follow dependency order above |

Prior baseline, not task089 certification: task088 recorded 1,029 tests plus built
browser checks. Existing evidence/limits live in tasks069, 085, 087 and 088.
Append exact new commands, results and artifact paths here as slices progress.

### Phase 1 evidence — 2026-10-22

- Assignment/baseline: Phase 1 only, HEAD `f2ac48bdf267121e42bf789964fa04bbd6fc74b6`;
  pre-existing dirty scope saved in `/tmp/task089-dirty-before.txt` and provider diff
  in `/tmp/task089-provider-before.diff`. Terrain/UI/capture/LOD changes preserved.
- GitNexus `query` and upstream `impact` on `ProviderModel.turn` in `cad-agent`:
  LOW, direct model-chat route caller / one affected process summary; lower-bound
  receiver typing omitted 15 sites, so actual route and test calls checked in source.
  Browser smoke `send` impact was UNKNOWN/not indexed; local calls source-verified.
- Reproduction before fix: `pnpm exec tsx --test --test-name-pattern='same-cloud continuation'
  tests/agent/provider-model.test.ts > /tmp/task089-repro.log 2>&1` failed with
  `stale-conversation` on the valid second cloud turn. Initial sandbox run hit the
  tsx IPC EPERM restriction; reran outside sandbox to obtain the actual regression.
- Fix scope: `apps/server/src/agent/provider-model.ts` adds shared canonical
  `conversationBinding(scene)`, used for admission and successful completion using
  the final rebound scene. Existing stale gates and post-publication persistence remain.
  `tests/agent/provider-model.test.ts` adds five cases: retained tool replay, canonical
  identity/reference independence, source/model/account/TTL rejection, failed turn and
  rejected completion nonpublication, and unchanged pole/Toronto continuation.
- `pnpm exec tsx --test tests/agent/provider-model.test.ts tests/datasets/cloud-runtime.test.ts
  tests/agent/model-agent-runtime.test.ts tests/agent/model-visual.test.ts
  tests/agent/model-scene-exploration.test.ts tests/agent/model-toronto-proposals.test.ts
  > /tmp/task089-focused.log 2>&1`: **167 passed**.
- `pnpm typecheck > /tmp/task089-typecheck.log 2>&1`: passed (including Svelte, server
  and tests). Initial new-test literal typing error corrected before this passing run.
- `pnpm test > /tmp/task089-baseline.log 2>&1`: **1,034 passed**, zero failed/skipped.
- `pnpm build > /tmp/task089-build.log 2>&1`: passed; existing Vite large-chunk advisory.
- `node --import tsx scripts/browser-capture-lod-smoke.mjs http://127.0.0.1:9223
  /tmp/task089-browser > /tmp/task089-browser.log 2>&1`: passed with a local fixture
  provider, real prepared/Toronto data and a separate temporary browser context.
  Script no longer clicks New chat for follow-ups; asserts prior cloud capture tool
  evidence reaches the provider. Native loading, cache, unavailable capture, Toronto
  follow-ups, restoration, mobile width and zero page errors also pass.
  Report: `/tmp/task089-browser/report.json`; desktop/mobile screenshots visually
  inspected at `cloud-restored.png` and `mobile-restored.png` in that directory.
- `git diff --check`: passed. Actual Phase 1 hunks inspected separately from existing
  terrain provider hunks. No commit or live/paid inference. LSP tools unavailable;
  CLI TypeScript/Svelte diagnostics above passed. Requested pi-browser-harness skill
  absent from installed paths; used existing fixture Playwright harness and inspected
  installed browser-policy instructions. Independent fresh-session review is pending.

### Phase 2a design evidence — 2026-10-22

- [Captured-frame grounding design](089-capture-grounding-design.md) records source
  seams, typed-array bulk copy plan, conservative center-candidate visibility semantics,
  independent prepared/Toronto source lookup, crop/replay/nonce invariants, lifecycle,
  initial 192 MiB admission / five-minute latest-only retention, and 3M/50M accounting.
- Design only: no runtime edits or runtime verification claimed. Four sequential
  implementation slices and their acceptance matrix are in the artifact. Independent
  design review and implementation assignment remain pending with the coordinating owner.

### Phase 2 implementation evidence — 2026-10-22

- Implemented all four bounded pixel-grounding slices in the linked design. Exact
  ownership/scoped hunks: `/tmp/agent-scene-agency-phase2-review-handoff.md`; root owns
  prepared marks and its shared callback/gate hunks. Legacy manual capture remains live
  signature based. Immutable tool snapshots are latest-only, five-minute, 192 MiB
  admission including scratch; unsupported imagery remains captureable/unavailable.
- GitNexus impact before edits: `createVisualCapture` LOW (two viewer callers), render
  bulk exports/runtime/route LOW; `createProvenancePickCache` HIGH (three direct cache
  constructors / nine total), explicitly warned. Provider turn wider CRITICAL warning
  from coordinating owner respected; latest MCP walk was LOW lower-bound with unresolved
  dynamic receivers. Viewer/Svelte symbols UNKNOWN/not indexed, source callers checked.
- `pnpm exec tsx --test tests/viewer/capture-grounding.test.ts
  tests/viewer/visual-capture-snapshot.test.ts tests/viewer/visual-observation.test.ts
  tests/viewer/model-capture-camera.test.ts tests/viewer/model-capture-render-colors.test.ts
  tests/viewer/prepared-lod.test.ts tests/viewer/adaptive-render.test.ts
  tests/datasets/cloud-runtime.test.ts tests/agent/model-visual.test.ts
  tests/agent/model-agent-runtime.test.ts tests/agent/provider-model.test.ts
  tests/agent/product-agent-skills.test.ts tests/agent/agent-tools-inspection.test.ts
  tests/agent/model-request-inspection.test.ts tests/chat/model-visual-client.test.ts
  > /tmp/task089-phase2-focused.log 2>&1`: **256 passed**. Later conservative material/
  render-hook/indexed-geometry guards are covered by the final baseline below.
- `pnpm typecheck > /tmp/task089-phase2-typecheck.log 2>&1`: passed, including Svelte,
  server and tests. Initial new code/test typing issues corrected before final pass.
- `pnpm build > /tmp/task089-phase2-build.log 2>&1`: passed, with existing Vite chunk
  advisory. Includes the coordinating owner's final marks layout updates.
- `pnpm test > /tmp/task089-phase2-baseline.log 2>&1`: **1,066 passed**, no skipped or
  failed checks on final isolated run. A prior concurrent build/typecheck run had one
  unrelated semantic-disk-storage staging cancellation assertion (expected temporary
  `.building-*` directory disappeared); preserved at
  `/tmp/task089-phase2-baseline-staging-failure.log` (**1,065 passed / 1 failed**).
  `pnpm exec tsx --test tests/spatial/semantic-disk-storage.test.ts
  > /tmp/task089-phase2-storage-recheck.log 2>&1`: **14 passed** before baseline rerun.
  No unrelated checks/source were changed.
- `node --import tsx scripts/browser-capture-grounding-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-grounding-browser
  > /tmp/task089-grounding-browser.log 2>&1`: passed. Fixture-only provider + actual
  native decoding/loader/render/browser bridge; sparse deep branch admits more nodes
  for capture than the user's restored target, then human orbit/resize before pixel
  resolution. Original key/Float64 position/frame/origin independently match source.
  Visibility explicitly remains browser-observed. Report/screenshots:
  `/tmp/task089-grounding-browser/report.json`, `restored-grounded.png`, `mobile.png`.
  An initial fixture oracle used unquantized coordinates; corrected fixture generation
  to its native millimeter encoding, then final assertions pass without tolerance.
- `node --import tsx scripts/browser-capture-lod-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-phase2-realdata-browser
  > /tmp/task089-phase2-realdata-browser.log 2>&1`: passed. Real prepared/Toronto native
  targets, delayed loading, cache reuse, failed capture, same-conversation follow-up,
  disabled background detail, navigation/restoration and mobile fit; zero page errors.
  Report `/tmp/task089-phase2-realdata-browser/report.json`; desktop/mobile screenshots
  visually inspected in both browser artifact directories. Contexts/servers closed.
- Synthetic 3M timing/resource sample: `/tmp/task089-grounding-performance.json` shows
  148,778,240 admitted bytes, 177.5 ms copy, 137.8 ms no-hit scan on this machine/run.
  Array admission tests reject 50M before allocating, independently of display cap.
- `git diff --check`: passed. Actual scoped hunks inspected, unrelated dirty changes
  preserved. No live inference/deployment/commit. LSP unavailable; CLI diagnostics
  passed. Fresh review running; source remains unaccepted until its verdict/fixes.

### Phase 2 post-review evidence — 2026-10-22

- Fresh scoped review READY: `/tmp/agent-scene-agency-capture-grounding-review.md`.
  Reviewer independently ran 53 focused + 70 integration tests, all passing. Two
  empirical findings were fixed by root and independently rechecked: opacity-zero
  opaque depth writers were wrongly omitted, and raster-only imagery could claim
  ready zero-point grounding. Original probes:
  `/tmp/task089-phase2-review-probes.log`. Final helper rejects those unsupported
  draws/no-source layers while preserving truthful no-hit for clipped supported points.
- New regressions cover the depth-writing blocker, raster-only helper and usable
  raster capture with unavailable grounding. Initial regression log:
  `/tmp/task089-grounding-review-repro.log` (the first new integration mock also
  needed its renderer getContext stub corrected). An initial overbroad zero-point
  rejection broke clipped-point no-hit; changed to require a declared source layer.
  The failures were fixed, not removed or weakened.
- `node --import tsx --test tests/viewer/capture-grounding.test.ts
  tests/viewer/visual-capture-snapshot.test.ts tests/agent/model-visual.test.ts
  tests/scene/cloud-scene-marks.test.ts > /tmp/task089-grounding-review-fixes-final.log
  2>&1`: **45 passed**. Earlier sandbox attempt could not bind fixture loopback
  sockets; approved execution produced this passing result.
- Post-fix `pnpm verify` ran typecheck successfully but the parallel full test suite
  got **1,068/1,069**, solely the recurring storage staging-directory comparison:
  `/tmp/task089-grounding-fixes-verify-final.log`. Source inspection confirms that
  test compares the process-shared cacheRoot .building list while other test files
  can create/remove entries. No storage source/test assertion was changed.
- Same full suite with file concurrency isolated:
  `pnpm exec tsx --test --test-concurrency=1 "tests/**/*.test.ts"
  > /tmp/task089-grounding-fixes-tests-serial.log 2>&1`: **1,069 passed**, 80.4 s.
  This preserves every assertion; it does not claim the default parallel pnpm verify
  passed. Separate final `pnpm build > /tmp/task089-grounding-fixes-build.log 2>&1`
  passed, retaining only the existing large-chunk advisory.
- Final built sparse grounding browser passed:
  `/tmp/task089-grounding-fixes-browser/report.json`; command
  `node --import tsx scripts/browser-capture-grounding-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-grounding-fixes-browser`.
- Final built real-source prepared/Toronto capture browser passed:
  `/tmp/task089-grounding-fixes-realdata-browser/report.json`; command
  `node --import tsx scripts/browser-capture-lod-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-grounding-fixes-realdata-browser`.
  Added actual DTM-layer capture asserts image remains usable, zero displayed points,
  grounding unavailable. Its screenshot visually inspected. Both owned contexts and
  temporary servers closed; page errors empty. No paid/live inference.
- `git diff --check` passed. Root accepted only the reviewed single-pixel slice;
  image-region queries remain explicitly deferred. Phase 3a is assigned separately.

### Phase 3a acceptance — 2026-10-22

- READY independent scoped review:
  `/tmp/agent-scene-agency-agent-view-3a-review.md`. Two empirical lifecycle defects
  were repaired/reverified: safe invalid replacement preserved old server view/pixel
  ownership; context loss during hashing could recreate browser ownership late.
  The review links before/after probes, final source and all limitations.
- Exact-source `pnpm typecheck` and `pnpm build` passed:
  `/tmp/task089-3a-review-final-typecheck.log`,
  `/tmp/task089-3a-review-final-build.log`. Same-assertion full serial suite
  **1,090/1,090 passed**: `/tmp/task089-3a-review-final-baseline-local.log`.
  Default parallel pnpm verify is not claimed; documented staging-directory race
  remains outside this slice. Initial sandbox loopback failures are retained.
- Independent final built prepared and real Toronto reference -> relative -> box ->
  verified source pixel sequences passed, closing the Toronto new-view gap:
  `/tmp/task089-prepared-agent-view-review-final/report.json` and
  `/tmp/task089-toronto-agent-view-review-final/report.json`. User camera/target
  restoration, portrait/mobile and safe recovery checked; no page errors/live inference.
- Root read the review and compared all **24** files in
  `/tmp/task089-review-source-sha256.json` against current source: zero mismatches.
  `git diff --check` passed. No source edits accompanied acceptance.
- Review explicitly used source/probes while 3a PDG was stale. Before 3b, root ran
  `node .gitnexus/run.cjs analyze --pdg --index-only
  > /tmp/task089-3b-start-index.log 2>&1`: exit 0, 18.7 s, 50,266 nodes,
  127,062 edges, 705 flows. Fresh context resolves canonicalSceneRegion and current
  createModelAgentRuntime (lines 28–239). This repairs freshness, not analyzer coverage
  gaps or a claim of complete graph-backed certification. No commit.

### Phase 3b acceptance — 2026-10-23

- READY independent scoped review: `/tmp/agent-scene-agency-agent-view-3b-review.md`.
  Repaired combined invalid-topology/foreign-binding error ordering, kept malformed
  protocol syntax hard, and replaced dataset-name adapter inference with an explicit
  source-derived reference kind. Provider/runtime probes verify no extra browser
  dispatch and previous pixel/view ownership revocation.
- Exact final source: `pnpm typecheck` and `pnpm build` passed; unchanged full serial
  suite passed **1,105/1,105**, zero failures/skips:
  `/tmp/task089-3b-accepted-candidate-{typecheck,build,baseline}.log`.
  Default parallel baseline staging-directory race is not claimed fixed.
- Independent focused tests **36/36**; additional topology oracle **3,204** cases,
  zero mismatches. Prepared cloud named `toronto3d` successfully resolves an original
  cloud key and captures through actual runtime with the correct cloud schema.
- Final independent browser reports passed with errors[]:
  `/tmp/task089-3b-independent-final-prepared-browser/report.json` and
  `/tmp/task089-3b-independent-final-toronto-browser/report.json`.
  Polygon -> relative after human navigation/resize -> verified pixel -> invalid
  polygon recovery preserves user state. Desktop/mobile screenshots inspected.
- Root read the review/final checks, inspected reports/screenshots, and verified all
  **12** files in `/tmp/task089-3b-independent-final-fingerprints.txt`: zero mismatches.
  Accepted only bounded polygon framing; no source edits accompanied acceptance.
- Final generated PDG refresh succeeded, but an empty helper Function ID and omitted
  source-visible call leave dependency/taint coverage incomplete. Review documents
  graph limits; source/probes/tests/browser evidence support acceptance. Whole dirty
  detect-changes is not clean scoped coverage certification. No commit.

## Remaining failures / next action

Next action: implement and verify delegated 4b1a typed evidence issuance/lookup, then
assign a fresh independent implementation review. Preserve stale-conversation rejection,
successful-turn-only checkpoint publication and exact source identity. Continuation
handoff: `/tmp/agent-scene-agency-phase4b-start-handoff.md`.
Reuse source-bound box/polygon values in later region/evidence/measurement tools.
The conditional image-region query and remaining shared regions/evidence/resume/entity/
measurement/evaluation work remain. No Phase 3–8 completion or live-provider competence
is claimed. Preserve broad CRITICAL provider impacts and unrelated dirty work.
