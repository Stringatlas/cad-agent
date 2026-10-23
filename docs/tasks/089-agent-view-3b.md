# Task089 Phase 3b — polygon-prism view framing

Status: accepted after independent fresh-session review and owner verification, 2026-10-23.
Parent: [Task089](089-agentic-scene-exploration.md).
Design and semantics: [agent view design](089-agent-view-design.md).
Phase 3a is accepted after source-backed independent review, exact-source checks
and prepared/Toronto browser evidence. Phase 3b acceptance is recorded in the parent checklist.

## Bounded outcome

Extend the existing shared SceneRegion value and capture frame target to a declared
XY polygon with an explicit finite Z range. Frame its enclosing box through the
existing camera/LOD/capture path; retain the actual polygon in a bounded receipt and
declare enclosing-box fitting. This is an investigation region, not source occupancy,
polygon masking, clearance, authored geometry or approval authority.

## Acceptance

- [x] Closed polygon-prism shape with 3–64 distinct finite local-meter vertices,
  implicit closing edge, explicit Z min/max and the existing complete source binding.
  Reject duplicate/repeated closing vertices, holes, zero area, self-crossings and
  touching nonadjacent edges. Either winding is valid. No silent topology repair.
- [x] Use a robust bounded topology implementation; inspect available libraries
  first. Any small pure-JavaScript dependency must respect framework-free contracts
  and use official current documentation. Independent numerical/topology oracles
  and adversarial cases must substantiate correctness.
- [x] Exact binding/revision checks and detached inputs; derive only the enclosing
  box for camera fitting while preserving original polygon/Z in issued receipt.
  Keep the current-turn/latest-only/expiry/replacement policies and byte limits.
- [x] Model schema, browser normalized payload, receipt validation, capabilities,
  runtime instructions/reference parity and replay agree. No advertisement before
  adapter support; legacy point/box/current/top/relative behavior remains intact.
- [x] Reuse capture-owned LOD, frozen camera and synchronous restoration. No second
  renderer, loader, persistent region registry, geometry mutation or layer switching.
- [x] Test both windings, concave polygons, vertical/flat bounds, near-collinear and
  near-touching inputs, very small/large coordinate ranges, 64/65 vertices, stale
  source/nonce/lifecycle, forged receipts and framed corners in portrait/landscape.
- [x] Built fixture-browser polygon -> relative view sequence on prepared/Toronto,
  truthful receipt/coverage, user state preservation, mobile and failure recovery.
- [x] Appropriate focused checks, typecheck/build and same-assertion full baseline;
  fresh independent review and owner acceptance completed as recorded in the parent.

## Ownership and guards

Implementation: delegated scene_agency_phase1; coordinating owner maintains parent
acceptance. Preserve all accepted Phase 1/2/3a/4a and unrelated dirty terrain/UI/LOD
work. No reset/stash/discard/commit, deployment or paid/live inference.

Root completed the exclusive generated GitNexus index/PDG refresh before edits
(`/tmp/task089-3b-start-index.log`); fresh graph-first impacts preceded changed functions. Shared
capture/region canonicalizers and registry carry broad impact; HIGH/CRITICAL must be
reported and UNKNOWN confirmed in source. Refresh is generated-only, not permission
to rewrite project instructions or claim complete graph coverage.

No cross-turn view handles, entity/CAD/mark targets or generic region storage in this
slice. Later Phase 4 should reuse the resulting shared region vocabulary.

## Evidence / next action

Independent review and owner acceptance completed; final evidence is recorded in the
parent checklist. Historical implementation handoff:
`/tmp/agent-scene-agency-phase3b-review-handoff.md`. Do not skip review or claim
Task089 complete.

## Implementation evidence — 2026-10-22

Contracts now accept a closed `polygon-prism` region, exact finite distinct XY ring
and explicit finite Z min/max; box behavior is preserved. No topology dependency was
present in declared packages/lockfile. The bounded helper decodes each finite binary64
as an exact integer on the 2^-1074 lattice; no tolerance, snapping, floating determinant,
or BigInt JSON serialization. With coordinates <=1e7 there are128 integer coordinates,
<=1,100-bit coordinate differences, <=2,200-bit products and <=2,206-bit area sum;
64 vertices imply <=2,016 edge pairs. Raw coordinate payload is <18KiB plus bounded
BigInt/runtime object overhead; no per-source-point operation/allocation. Typical
64-vertex worst-loop measurement20 validations: ~100ms aggregate (~5ms each) here.
This is bounded validation, not an unbounded polygon engine. Both windings and
forward collinear vertices are accepted; adjacent backtracking/overlap, nonadjacent
touches/crossings and exact zero area are rejected without topology repair.

`tests/fixtures/polygon-oracle.py` independently uses Fraction.from_float with rational
line-parameter intersection and triangle-fan area (different from production orientation
predicates). It agrees on412 seeded/adversarial cases including subnormals, near-touch,
near-collinearity, large-offset cancellation, concavity, both windings and repeated rings.

`sceneRegionBounds` derives camera bounds only. Model/runtime/browser schemas carry
the declared ring unchanged; receipt targetKind is `declared-polygon-prism` and
fitMethod is exactly `enclosing-box`, including relative receipts whose fitGuaranteed
is false. Receipt validation rejects mismatched shape/kind/method/bounds; server
compares expected region against the validated browser image receipt. Existing exact
binding/revision, nonce, immutable pixel snapshot, latest-only current-turn, expiry,
replacement/abort/context-loss and camera restoration seams remain in force. Invalid
topology returns safe `invalid-region`, consuming previous view ownership; identity
violations remain hard failures. Provider skill/reference parity describes limits and
explicitly disclaims polygon masking/occupancy.

Pre-edit graph warnings: canonicalSceneRegion, canonicalAgentViewReceipt,
captureRequestSchema, canonicalModelCaptureRequest and registry/instruction paths
**CRITICAL**; canonicalBrowserCaptureRequest and sceneCaptureCapabilities **HIGH**.
Direct callers span model/browser admission, runtime capture, viewer camera and chat
receipt delivery. createModelAgentRuntime and constructAgentCamera LOW direct routes
and capture caller. Source inspected alongside graph; no index refresh raced root.

Checks (exact command output retained):

- `node --import tsx --test tests/agent/polygon-region.test.ts
  tests/agent/agent-view-runtime.test.ts tests/viewer/agent-camera.test.ts
  tests/agent/agent-tools-inspection.test.ts`:25 passed before final polygon-runtime
  scenario, `/tmp/task089-3b-focused.log`.
- Final polygon/runtime file pair:12 passed, `/tmp/task089-3b-polygon-runtime.log`.
  Initial failing exploratory runs retained in `/tmp/task089-3b-topology-tests.log`
  (safe invalid-region not yet mapped) and early overwritten polygon-runtime log;
  no claim that overwritten initial runtime failure artifact remains available.
- `pnpm typecheck`: final pass `/tmp/task089-3b-typecheck-final.log` (initial test-only
  VisualJson property access diagnostics retained `/tmp/task089-3b-typecheck.log`,
  corrected using canonicalAgentViewReceipt). `pnpm build`: pass
  `/tmp/task089-3b-build.log`, existing Vite chunk-size advisory only.
- `node --import tsx scripts/browser-agent-polygon-prepared-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-3b-prepared-browser`: pass report/errors[],
  `/tmp/task089-3b-prepared-browser/report.json`, log matching directory prefix `.log`.
- Same command with `browser-agent-polygon-toronto-smoke.mjs` and
  `/tmp/task089-3b-toronto-browser`: pass actual Toronto original key1,row0 source
  verification, portrait view and mobile. Both browser fixtures exercise concave
  polygon -> relative after human navigation/resize -> polygon -> verified pixel ->
  invalid topology -> prior ID unavailable. Camera and target restored exactly after
  user orbit damping settles. Native sparse prepared fixture forces borrowed detail.
  Owned contexts/servers closed; screenshots inspected, no page errors/horizontal
  overflow. Fixtures only; no actual-model competency or visibility verification claim.
- `node --import tsx --test --test-concurrency=1 tests/**/*.test.ts`: **1,095/1,095 passed**, zero failures/skips,
  `/tmp/task089-3b-baseline.log`; session59050 exited0,83,687ms. Existing global staging-dir
  race isolation retains unchanged assertions and local HTTP servers are authorized.
- `git diff --check`: pass. No commit/deployment/live inference or geometry mutation.

## Review repair candidate — 2026-10-23

Independent identity-ordering repro retained at
`/tmp/task089-3b-review-identity-probe.log`: foreign region plus bad topology was
recoverable before source comparison. Shared provider/runtime identity guard now
checks binding and original reference identity before safe shape/span/color validation.
Eight-case ProviderModel/runtime matrix checks all region identity axes, original ref
cloudId/revision combined with invalid span/unsupported color, hard stale errors, no
browser dispatch and revoked previous view/pixel ownership. Typed topology errors alone
map to invalid-region; closed canonical syntax remains hard. Generic prepared cloud ID
`toronto3d` no longer selects a Toronto adapter: explicit scene-derived referenceKind
drives schema and validation, with prepared lookup/schema regression.

Final candidate focused26 pass `/tmp/task089-3b-review-final-focused.log`; full unchanged
serial **1105/1105 passed**, zero failed/skipped82,931ms,
`/tmp/task089-3b-accepted-candidate-baseline.log`,72070 exited0. Final typecheck/build
matching `accepted-candidate-` logs exited0. Earlier repair1103 fullsuite is intermediate
only. Reviewer owns final rebuilt browser/index/verdict; owner acceptance remains pending.
Scoped handoff fingerprints updated `/tmp/agent-scene-agency-phase3b-review-handoff.md`.
No implementer jobs live, no4b runtime work; separate design is available.
