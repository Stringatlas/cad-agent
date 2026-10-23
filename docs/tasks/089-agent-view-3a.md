# Task089 Phase 3a — implementation assignment

Status: accepted — implemented, verified and independently reviewed.
Assigned to delegated `scene_agency_phase1` agent. The owner assessed and authorized
[the view design](089-agent-view-design.md); no additional design approval gate is
needed. [Task089](089-agentic-scene-exploration.md) remains the long-running checklist.
The owner accepted Phase 2 and authorized runtime work. Phase 3a is now accepted;
the next implementation slice is [polygon-prism framing](089-agent-view-3b.md).

Acceptance evidence: `/tmp/agent-scene-agency-agent-view-3a-review.md` is READY after
two independently reproduced lifecycle fixes. Final exact-source typecheck/build,
prepared/Toronto browser checks and 1,090/1,090 serial tests passed. Root compared all
24 reviewed source fingerprints against the current files with zero mismatches.
Graph/PDG was stale during review; root is refreshing generated graph before 3b.
Source-backed acceptance does not claim a complete PDG certificate or default parallel
pnpm verify success. Exact logs, findings and limitations remain in the review artifact.

## Bounded acceptance

Implement the design's complete 3a slice: original-point and inline box framing,
top/oblique views, then relative orbit/dolly by latest successful agent observation ID
within the same turn. Preserve legacy current/top-down/explicit camera capture,
Phase 2 immutable grounding and independent source verification, human approval,
source/revision/nonce gates, capture-owned LOD and user-state restoration. No polygons,
entity/CAD/mark IDs, cross-turn view handles, layer switching or geometry publication.

- Closed framework-free SceneSourceBinding and box-only SceneRegion canonicalizers,
  exact source/frame/revision/origin checks and detached inputs.
- Model target requests resolved independently server-side; normalized numeric browser
  payload cannot carry unresolved model assertions as verified geometry.
- Pure deterministic Three camera helper fits all eight corners with 1.1 padding for
  portrait/landscape; minimum visual envelope and near/far/range behavior disclosed.
- Relative view changes use the issued pivot/lens, closed angle/distance limits, explicit
  crop/behind behavior and no fallback to the user's current camera.
- Latest-only <=16 KiB/five-minute/current-turn base; invalidated on replacement even
  if capture fails, authority/source change, cancel/dispose/account/chat/turn teardown.
  Image/grounding/base readiness remain distinct.
- Typed bounded agentView receipt, exact advertised adapter targets/colors/current
  layer, structured safe unavailable reasons, schema/runtime/skill/prompt parity.
- Focused contracts/camera/source/runtime/nonce/lifecycle/restoration tests plus real
  built fixture browser including relative view and Phase 2 source grounding; full
  appropriate checks and independent fresh-session review before acceptance.

## Source and ownership

Implementation owner may add `packages/contracts/src/spatial-region.ts` (binding and
box only), `agent-view.ts`, exports and model-chat capture/browser unions. Root confirmed
these files are not in progress elsewhere; Phase 4 will reuse this seam after handoff.
Owner also covers capture camera helper/visual-capture, runtime source lookup/base,
browser broker/recovery, provider capture schema/dispatch/capabilities, visual adapter
wiring and capture fixtures/tests. Coordinate exact shared prompt/registry hunks with
root. Preserve pre-existing terrain/UI/LOD work, accepted Phase 1, root Phase 2 fixes
and prepared marks; never rewrite the combined dirty diff or commit it.

Pre-implementation seam findings (historical; superseded by implemented checkpoint below):

- `model-chat.ts:canonicalModelCaptureRequest` validates only legacy views;
  `canonicalModelBrowserAction` currently uses that same validator for browser capture.
  New browser payload therefore needs its own validator.
- `model-agent-runtime.ts` currently checks/revalidates capture images and independently
  verifies pixel original records; factor/reuse original lookup without selection/rebind.
- `model-browser-broker.ts` supports only generic unavailable without reason;
  `model-chat-client.ts` catches all capture exceptions into that generic result.
  Add only closed known recovery codes; never echo arbitrary exception text.
- `visual-capture.ts` constructs the cloned camera immediately before capture detail
  preparation and copies immutable grounding before borrowed restoration. Camera math
  belongs there, not in live controls or a parallel renderer.
- `registeredSceneTools` already adjusts source taxonomy/reference schemas per adapter;
  capture schema/capability adjustment can follow that pattern.
- Prepared context supplies `dataset` bounds/frame/origin; Toronto supplies
  `spatialFrame` plus scene bounds and independent original readSourcePoint.

## Pre-edit graph assessment — 2026-10-22

GitNexus bound explicitly to `cad-agent`; source verified alongside graph. No index
refresh requested during initial preparation. That graph reflected the Phase 2
review refresh; this section retains the pre-edit record, not current source status.

| Target | Upstream result / warning |
| --- | --- |
| `canonicalModelCaptureRequest` | **CRITICAL**, 3 direct / 6 total, 11 affected flow summaries; provider turn, visual capture and browser-action admission are directly touched. Preserve compatibility and rejection tests. |
| `registeredSceneTools` | **CRITICAL**, direct provider turn and 11 flow summaries; test exact effective schema/capabilities and unbound inspection parity. |
| `canonicalModelBrowserAction` | LOW, 1 direct / 3 total; impacts event/browser boundary. |
| `createModelAgentRuntime` | LOW, model-chat route caller; proxy callbacks and source/read lifecycles source-checked. |
| `createVisualCapture` | LOW, two viewer constructors and their capture flows. |
| `requestModelTurn` | UNKNOWN/not found: actual client entrypoint name must be resolved and impacted before editing it. Never treat this as unused. |

CRITICAL warnings remain operative even where graph indirect edges conflate generic
method names; they are not waived by LOW shared-axis fields. Before each source
function edit, refresh impact for its actual symbol and verify dynamic callers. Record
further warnings/evidence with implementation, then inspect actual scoped diff.

## Next action

Finish independent fresh-session review and any missing acceptance scenarios for
implemented 3a, then let the coordinating owner accept the bounded slice. Do not skip
to polygons/3b or cross-turn retention. Source handoff:
`/tmp/agent-scene-agency-phase3a-review-handoff.md`. No live inference, deployment
or commit. Root owns roadmap status/acceptance and broader Phase 4 work.

## Implementation and verification checkpoint — 2026-10-22

- Closed binding/box contracts, model/normalized-browser requests, typed view receipt,
  safe closed capture reasons, exact per-adapter schema/capabilities and visual prompt
  parity implemented. Original-point framing reuses independent prepared/Toronto reads.
- Pure helper fits eight corners at 1.1 padding and preserves original Float64 pivot;
  relative calls consume latest current-turn server/browser-issued ID and pivot/lens.
  Browser ID lifetime is independent of optional Phase 2 pixel snapshot availability.
  Replacement, source/authority changes, abort/dispose/context loss clear ownership;
  historical attachments/older turns never create a base. Pixel owner is revoked on
  capture replacement even if normalization fails before browser dispatch.
- `node --import tsx --test tests/chat/model-visual-client.test.ts
  tests/agent/agent-view-runtime.test.ts tests/viewer/agent-camera.test.ts
  tests/viewer/visual-capture-snapshot.test.ts
  > /tmp/task089-3a-final-focused.log 2>&1`: **42 passed**. Includes closed sanitized
  recovery, source-bound reference/box normalization, failed replacement, TTL, accepted
  Toronto override preserving original target, portrait/landscape/degenerate fitting
  and local browser view ownership without requiring grounding.
- Broader initial focused run: `/tmp/task089-3a-focused.log`; earlier 45-test schema/
  prompt/legacy suite passed before final local-ID and guard additions. The final full
  suite below includes those changes and preserves unchanged assertions.
- `node --import tsx --test --test-concurrency=1 tests/**/*.test.ts
  > /tmp/task089-3a-baseline.log 2>&1`: **1,088 passed**, zero skipped/failed. Uses the
  documented same-assertion serial isolation for the existing global staging-dir race.
  Initial run caught a legacy manual color error wording regression; retained at
  `/tmp/task089-3a-baseline-color-compat-failure.log` (1,085 passed / 1 failed), corrected
  by preserving old manual errors while tool snapshots use structured unsupported.
  Unchanged targeted recheck `/tmp/task089-3a-color-recheck.log` passed.
- `pnpm typecheck > /tmp/task089-3a-typecheck.log 2>&1` and `pnpm build
  > /tmp/task089-3a-build.log 2>&1`: final exact-source checkpoint reruns both passed (zero TypeScript/Svelte errors;
  existing Vite large-chunk advisory only).
- `node --import tsx scripts/browser-agent-view-smoke.mjs http://127.0.0.1:9223
  /tmp/task089-agent-view-browser > /tmp/task089-3a-browser.log 2>&1`: passed. Sparse
  native prepared fixture forces off-screen detail then original reference frame ->
  relative orbit/dolly after human navigation/resize -> declared box frame -> Phase 2
  source-verified pixel -> invalid ID recovery, all in one turn. Mobile fit/page errors
  checked. Report `/tmp/task089-agent-view-browser/report.json`.
- `node --import tsx scripts/browser-capture-lod-smoke.mjs http://127.0.0.1:9223
  /tmp/task089-3a-realdata-browser > /tmp/task089-3a-realdata-browser.log 2>&1`: passed.
  Real prepared/Toronto legacy capture LOD/restoration/cache/continuation/mobile and DTM
  grounding exclusion. Report `/tmp/task089-3a-realdata-browser/report.json`.
- Both browser scripts used owned temporary contexts/servers and fixture providers,
  not live inference. The final browser runs preceded the last manual color-error
  compatibility branch and extra server post-image authority check; next reviewer
  should assess whether a rebuilt rerun is needed for exact final source parity.
- `git diff --check`: passed. All prior terrain/UI/LOD/marks/Phase 2 fixes preserved.
  No commits, deployment or paid/live inference. LSP unavailable; CLI diagnostics used.

## Remaining review/acceptance work

Independent runtime review is underway (`/root/agent_view_3a_review`). Additional targeted coverage should assess
real Toronto frame/relative through the browser (current native unit covers original
lookup after accepted override), full source/authority rebind and stale async receipt
scenarios, unsupported raster/color recovery, and numerical/lifetime receipt invariants.
Initial prepared browser covers resize during the same exploration and current-turn
latest view; exact final rebuild/rerun and screenshot inspection remain review gates.
Do not claim universal production-scale coverage, server visibility verification,
polygons, cross-turn handles or overall Task089 completion.

## Independent review repair checkpoint

Fresh review reproduced a safe-validation capture replacement retaining old runtime
view/pixel ownership before browser dispatch. Independent failure artifact:
`/tmp/task089-review-replacement.log`. Internal runtime invalidation now runs on the
provider safe canonical error path, without invalidating valid relative inputs early.
Actual ProviderModel/runtime/broker regression passes 7/7 in
`/tmp/task089-3a-review-fix-tests.log`; repaired build passes
`/tmp/task089-3a-review-fix-build.log`. Full serial suite and typecheck rerun pending
in `/tmp/task089-3a-review-fix-baseline.log` and
`/tmp/task089-3a-review-fix-typecheck.log`. Fresh reviewer owns actual Toronto
frame/relative browser gap. Independent verdict and root acceptance remain pending.

Second review reproduced context loss during awaited image digest recreating a view
base after restoration (`/tmp/task089-review-context-loss.log`). Handler now aborts
pending capture and advances serial before clearing retained ownership. Gated digest
regression plus provider lifecycle tests pass **13/13**:
`/tmp/task089-3a-review-lifecycle-tests.log`. Final repaired-source typecheck/build pass
`/tmp/task089-3a-review-final-typecheck.log` and
`/tmp/task089-3a-review-final-build.log`. Independent Toronto original-reference ->
relative after navigation/resize -> box -> exact source-pixel browser passed
`/tmp/task089-toronto-agent-view-review/report.json`; reviewer reruns final rebuilt web.
Post-review baseline initially ran without localserver authorization (990 pass/99
loopback listen EPERM; retained `/tmp/task089-3a-review-fix-baseline.log`). Correct
unchanged serial rerun pending `/tmp/task089-3a-review-final-baseline-local.log`.
Final prepared browser pending `/tmp/task089-agent-view-final-browser/report.json`.

Final implementer prepared built-browser rerun passed after both lifecycle repairs:
`/tmp/task089-agent-view-final-browser/report.json`, errors `[]`; owned context and
servers closed. This completes exact-source prepared parity; independent review
continues separately, including its rebuilt Toronto test and final graph analysis.

Final authorized same-assertion serial rerun **1,090/1,090 passed**, zero skipped or
failed, exit0 (81,860 ms):
`/tmp/task089-3a-review-final-baseline-local.log`. Final typecheck/build and prepared
browser also exit0; no implementer checks remain live. Independent reviewer reports
both final browsers passed and is finalizing verdict; root owns acceptance and graph
refresh disposition. No Phase3b work or overall Task089 completion claimed.
