# Task089 Phase 4a — prepared-cloud hypotheses

Status: accepted — implemented, verified and independently reviewed.
Parent: [Task089](089-agentic-scene-exploration.md). Phase 1 is independently accepted.

## Bounded outcome

Reuse the existing get/set_scene_marks operations for prepared clouds. The model can
retain, revise and reorder up to 20 disposable hypotheses across successful turns,
with stable server IDs, explicit rationale/uncertainty and optimistic revision checks.
Prepared marks bind to the exact cloud ID, original revision, meter frame and origin;
they cannot carry Toronto edit authorities. Show numbered scene annotations with a
compact accessible hypotheses disclosure, and let an explicit click focus a mark.
These remain conversation-owned hypotheses, separate from source points or geometry.

No new geometry authority, source IDs, storage service, automatic ranking or permanent
idle panel. Evidence handles, regions, restart persistence/resume and generic entity
inspection remain later Phase 4/5 work, not satisfied by this slice.

## Acceptance

- [x] Preserve the exact legacy Toronto binding and optional point/CAD/object guards;
  add a strict prepared binding, rejecting cross-mode/extra authority fields.
- [x] Server derives marks binding from its checked prepared descriptor. Provider
  advertises and executes marks only with that bound capability, across successful
  continuation; failed turns do not publish changed marks.
- [x] Stable IDs, ordering/revision conflicts, unknown IDs, clearing and source/frame/
  origin/revision changes behave truthfully, without geometry or reference selection.
- [x] Web validates the entire binding before rendering and clears on reset, failed
  turns, source replacement/disposal. Same-source color/detail changes preserve marks.
- [x] Numbered source-coordinate markers reuse existing rendering; accessible names,
  rationale and uncertainty are contextual. Explicit user click may focus the view.
- [x] Focused contract/runtime/lifecycle checks, typecheck/build, fixture browser on
  desktop/mobile and fresh independent review recorded before accepting this slice.

## Impact / ownership

Root owns this slice. Phase 2 agent owns capture/snapshot runtime and both viewer
capture integrations; coordinate the small prepared-viewer marks integration rather
than overwrite its work. Shared provider edits are limited to marks capability/init;
the other agent owns visual dispatch. No prompt changes are anticipated because
candidate-assessment already documents marks generically in all supported modes.

GitNexus bound to cad-agent, index refreshed during Phase 1 review. Before edits:
canonicalSceneMarkSnapshot LOW (SceneExploration constructor/replace); prepared binder
CRITICAL (bindModelScene, runtime rebind/approval/select and route processes);
ProviderModel.turn CRITICAL (14 direct callers, 50 reached, 16 unresolved receiver
sites omitted). These broad risks are not waived. Existing authority guards and
baseline regressions must remain intact. sceneMarksMatchScene and Svelte load are
UNKNOWN/unindexed: verified direct Toronto component/test calls and prepared component
mount/change/retry callsites in source. UI-only additions have no geometry authority.

## Evidence / next action

Initial source inspection found Toronto-only contracts/binding/delivery. The slice
now reuses SceneExploration and its existing bounded replacement/rollback semantics,
extends strict source binding and forwards actual tool events into the prepared
viewer. The existing numbered annotation renderer accepts marks without scan metrics.
No source point, authored datum or geometry authority is created by a mark.

- `pnpm exec tsx --test tests/scene/cloud-scene-marks.test.ts
  tests/scene/scene-marks.test.ts tests/datasets/cloud-runtime.test.ts
  tests/agent/model-scene-exploration.test.ts tests/agent/model-exploration-lifecycle.test.ts
  tests/chat/model-chat-client.test.ts > /tmp/task089-cloud-marks-focused.log 2>&1`:
  **118 passed**. New cloud cleanup regression exposed a remaining Toronto-only
  stream allowlist/delivery gate; both were fixed before this passing run.
- `pnpm typecheck > /tmp/task089-cloud-marks-typecheck.log 2>&1`: passed;
  `pnpm build > /tmp/task089-cloud-marks-build.log 2>&1`: passed. These predate the
  last small mount/toggle layout callback and tool-requirement metadata correction;
  final combined build/checks are being coordinated with the Phase 2 agent.
- `node --import tsx scripts/browser-cloud-marks-smoke.mjs http://127.0.0.1:9223
  /tmp/task089-cloud-marks-browser > /tmp/task089-cloud-marks-browser.log 2>&1`:
  **passed**, real prepared source and local fixture inference, errors empty.
  Create/revise/explicit focus, no automatic camera move, failure cleanup and retained
  rollback, New chat, mobile and source replacement passed. Initial harness attempted
  mobile scene interaction behind the chat drawer; rerun used the actual Toggle chat
  control before scene interaction. No forced clicks or product acceptance weakening.
  Desktop idle/inspecting/marked/selected/failure and mobile selected/source-replaced
  screenshots visually inspected. Contextual disclosure is absent while idle.
- Independent fresh review: **READY**, 12 reviewer-run tests pass. Review artifact
  `/tmp/agent-scene-agency-cloud-marks-review.md`; found and verified correction to
  tool metadata that still stated Toronto-only. Latest mount/toggle redraw callbacks
  reviewed in source, but their final built-browser rerun remains pending.
- `git diff --check`: passed; root inspected scoped source diffs, preserving existing
  terrain/LOD and concurrent Phase 2 capture changes. No commit/live inference. LSP
  tools and requested spatial/browser skills unavailable; CLI checks and existing
  Playwright fixture patterns used, not claimed as actual-model evaluation.

Final acceptance evidence:

- Final combined `pnpm typecheck` and `pnpm build` passed, including the last layout
  callbacks and metadata correction: `/tmp/task089-phase2-typecheck.log` and
  `/tmp/task089-phase2-build.log` (run by the Phase 2 implementation agent).
- Latest built `node --import tsx scripts/browser-cloud-marks-smoke.mjs
  http://127.0.0.1:9223 /tmp/task089-cloud-marks-final-browser
  > /tmp/task089-cloud-marks-final-browser.log 2>&1`: **passed**, errors empty.
  Final desktop/mobile selected screenshots visually inspected; labels avoid the
  contextual disclosure after mount/toggle/focus. Owned context/servers closed.
- Final combined baseline: **1,066 passed**, `/tmp/task089-phase2-baseline.log`.
  A preceding concurrent run had one staging-directory cancellation assertion failure
  in semantic-disk-storage; it passed on rerun. Retained failure:
  `/tmp/task089-phase2-baseline-staging-failure.log`; standalone 14-test recheck:
  `/tmp/task089-phase2-storage-recheck.log`. No unrelated assertion/source was changed.
- Fresh review READY and final rebuilt browser evidence together support acceptance
  of this bounded slice. Root inspected actual scoped diffs and `git diff --check`
  passed. This does not accept unrelated dirty changes or imply model competence.

Next: implement shared source-bound region/reference/evidence contracts in coordination
with Phase 3 view framing, preserving this prepared-cloud hypothesis behavior.
