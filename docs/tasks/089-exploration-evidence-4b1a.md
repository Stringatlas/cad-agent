# Task089 Phase4b1a — issued conversation evidence

Status: implementation and checks complete; fresh independent review/owner acceptance pending.
Design: [conversation regions/evidence](089-exploration-evidence-design.md).
Root accepted3b; this assignment is4b1a only. No mark evidenceIds, stored regions,
new UI, durable IDs, geometry authority, image rehydration or cross-turn view resume.

- [x] Closed framework-free receipt schemas and exact per-adapter query/capture/pixel
  projections, actual UTF8 record/envelope bounds,16-witness cap and scope limitations.
- [x] One conversation-owned checkpoint preserves existing marks and historical issued
  receipts, count/byte eviction and future pin primitives; no second marks authority.
- [x] Issue UUID only after canonical admitted request + actual checked result and atomic
  retention. Invalid pre-admission capture requests/bases get no fictional receipt.
  Capture accepted/ghost authority scope is complete or explicitly unknown, never omitted.
- [x] get_scene_evidence lookup, compact catalogue, bound-source capability/schema gates,
  effective skill/static prompt and event/client allowlists; unknown/expired IDs unavailable.
- [x] Successful-turn-only persistence/rollback with history; authority rebind resets marks
  while keeping same-original-source historical receipts; source/account/restart guards.
- [x] Focused contracts/store/actual provider/runtime continuity, rollback/finaldone failure,
  draft IDs, stale identity/adapter/caps/UTF8/pin exhaustion tests; typecheck/build/full
  unchanged serial suite. Built browser if integration behavior warrants it.
- [ ] Scoped OS-temp review handoff, fresh independent review and owner acceptance separate.

Preserve all user/accepted dirty work; no commits/live inference/deploy/discard. Initial
source/graph exploration finds SceneExploration/registry/event paths CRITICAL; several
indexed paths malformed, so source-confirmed callers retained as limitation. No index
refresh without coordination. Existing mode/source/nonce/human approval guards stand.

## Implementation checkpoint

- New framework-free `exploration-evidence.ts` contracts define explicit closed query,
  capture and pixel variants, metadata-only lookup, UTF8 record cap and retention states.
  No arbitrary JSON payload. Instance IDs remain int32; source keys/Float64 coordinates
  are preserved. Shared original SceneRegion/reference/camera contracts are reused.
- New server projector keeps native prepared count/checkedPoints and Toronto
  totalCount/label-count/selection/independentVerification fields distinct. Witnesses
  cap at16 with separate returned/retained/truncation metadata. Unsupported variants
  leave successful operation output intact and issue no ID.
- Capture uses runtime-only actual canonical admission/effective browser request,
  not raw failed model args. Rejected topology/span/unknown bases issue no receipt.
  Image/camera/crop/coverage/agentView metadata and separate scope hashes are retained;
  bytes/URLs are omitted. Accepted/ghost server scope includes session/revision/artifact
  and pending proposal IDs for all bound authorities, or an explicit unknown reason.
  Prepared capture never consults unrelated Toronto edit authorities. Pixel receipts
  require matching observation/source binding and existing independent runtime original
  record verification; browser visibility remains separate.
- SceneExploration now owns one frozen aggregate checkpoint containing compatible
  marks and receipts. Conversation writes only this checkpoint (legacy marks is read
  compatibility only). New UUID after validation/byte-envelope admission;128 records,
  16KiB per record and256KiB aggregate; bounded oldest-unlinked eviction. Future pin
  primitive has no model-facing links in1a. Exhaustion issues no ID and never evicts
  pinned evidence or fails an already successful measurement.
- get_scene_evidence is source-bound and skill/event/client gated; recent16 catalogue
  <=4KiB. Unknown/different-conversation/evicted/expired IDs return unavailable. Lookup
  does not rehydrate images, snapshots or view bases. Historical same-source receipts
  survive approval mark reset unchanged; source/account/history guards stay in force.
  Existing marks IDs/ranks/revisions/observationId and renderer path remain compatible.
- No stored regions, mark evidenceIds, new UI, geometry edits/publication, cross-turn
  camera handles, database, RunEvidenceStore coupling or LOD-setting changes.

## Source/graph risk record

Fresh upstream impacts were requested for SceneExploration, ProviderModel.turn,
registry, capability, event/client validators and runtime before their changes.
**CRITICAL** owner/registry/event/runtime summaries remain warnings. The graph query
returned malformed paths and repeated inflated258-node fallback results; counts are
not treated as complete trustworthy caller inventories. Source confirms direct
provider->SceneExploration, route->runtime/provider and contract->client admission
seams, plus dynamic proxy properties omitted by static calls. No competing reindex
was attempted. This limitation must remain in review; no commit/change-graph gate
was claimed or needed (no commits authorized).

## Check evidence (final checks pending below)

- Native adapters/store/contract tests and actual ProviderModel/runtime tests cover
  same-turn/follow-up lookup; named-toronto3d prepared adapter; cross-conversation,
  source/TTL guards; failed finaldone emit and postcheck rollback; draft IDs/history
  excluded on retry; approval reset retaining historical capture scope; caps/pins/
  UTF8; closed lookup; static/runtime prompt parity; unsupported partial results;
  old manual-image source mismatch and fractional instance IDs.
- Broad focused75 passed `/tmp/task089-4b1a-broad-focused.log` before final two guards;
  final evidence pair16 passed `/tmp/task089-4b1a-guard-tests.log` after those guards.
- Intermediate full unchanged serial1120/1120 passed
  `/tmp/task089-4b1a-baseline.log` (81,231ms), before final source guards. Final exact
  candidate serial87059 live `/tmp/task089-4b1a-candidate-baseline.log`; not yet claimed.
- Typecheck initially found test-only ES2023 findLast and commands[] inference; fixed
  using ES2022 reverse/find and explicit unknown[]. Diagnostics retained in
  `/tmp/task089-4b1a-focused-typecheck.log` and `/tmp/task089-4b1a-final-typecheck.log`.
  Final candidate typecheck9625 `/tmp/task089-4b1a-candidate-typecheck.log` pending poll.
- Build6536 passed `/tmp/task089-4b1a-build.log` before final guards; candidate build60879
  `/tmp/task089-4b1a-candidate-build.log` pending poll.
- Built native prepared fixture `node --import tsx
  scripts/browser-agent-evidence-smoke.mjs http://127.0.0.1:9223
  /tmp/task089-4b1a-browser`: passed/errors[] at
  `/tmp/task089-4b1a-browser/report.json`. Query->lookup->capture->server-verified pixel
  ->lookups->second-turn lookup without New chat; no image rehydration, user state
  restored exactly after navigation/resize. Desktop/mobile screenshots inspected.
  Final source guards do not alter its valid path; exact candidate rerun follows build.
- Earlier failed fixture tests retained: `/tmp/task089-4b1a-store-tests.log` (native
  elevation fixture layout assumption), `/tmp/task089-4b1a-store-tests-final.log`
  (actual Toronto binding lacks datasetId; corrected to coordinates.localOrigin).
  Native corrected run `/tmp/task089-4b1a-store-tests-native.log` passes. Initial
  inspector fixture lacked new bound capability; original full-schema assertions
  preserved and fixture supplied explicit source capabilities. Failure retained
  `/tmp/task089-4b1a-integration-initial.log`, subsequent broad run passes.
- `git diff --check` passes. No live/paid inference, commits or deployment.

Next: finish final candidate checks, save scoped temp handoff and fresh independent
review, then owner acceptance. Do not proceed to4b1b or mark parent Task089 complete.

## Final implementation verification

Final candidate unchanged serial suite **1121/1121 passed**, zero failed/skipped,
81,554ms: `/tmp/task089-4b1a-candidate-baseline.log`,87059 polled exit0. Candidate
UTF8/int32/pixel-image-source guards included. Final typecheck9625/build60879 exited0
at matching candidate logs. Final rebuilt browser77972 exited0:
`/tmp/task089-4b1a-candidate-browser/report.json`, errors[], same actual lookup and
follow-up/restoration/mobile sequence. Owned context/servers closed. No implementer
checks remain live. Source stable; `git diff --check` passed.

Scoped15-file fingerprints and review focus:
`/tmp/agent-scene-agency-phase4b1a-review-handoff.md`. Fresh independent implementation
review and coordinating owner acceptance remain pending; implementation is not review.
