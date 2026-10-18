# Task045 — Historical scene screenshots and uninterrupted camera navigation

Status: implemented; automated verification passes. Browser acceptance blocked; fresh-session review pending. No commit created.

## Scope
Screenshots are capture-time browser observations, not authoritative current geometry. Allow mixed Toronto CAD solids/ghosts, derived overlays and edited points, and synthetic ghosts. Retain captures through camera/scene changes without cancelling chat. Keep current source/tool permissions, authoritative revisions, exact proposal binding and human approval independent. Do not build a historical geometry snapshot framework or add persistent warnings.

## Acceptance criteria
- Capture/attach/send mixed scenes, with truthful capture-time metadata; never describe edited rendered pixels as original source coordinates.
- Old images remain attachable/sendable after navigation and meaningful scene changes; switching scene modes may clear attachments.
- Camera motion, LOD changes and unavailable historical pixel grounding do not interrupt streaming or reset continuation.
- Pixel grounding stays conservative: only resolve against a matching live capture; otherwise report unavailable without cancelling the answer.
- Current authoritative changes still invalidate tool/proposal bindings; human approval and stale-publication rejection remain unchanged.
- Structural, hash/MIME/dimension validation and image/request size limits still reject malformed/oversized input.
- Focused/full serial tests, typecheck/build and scoped diff inspection recorded; browser blocked if approved harness unavailable.

## Pre-edit analysis
GitNexus index is one commit behind. Upstream impacts: createVisualCapture LOW (Toronto/synthetic viewer; CreateViewer flows), streamModelTurn LOW (controller send), validateModelVisual and bindModelScene LOW (chat route handle flows), ProviderModel MEDIUM (14 upstream items, server/routes/broker/validators and createDemoServer flow). ModelChatController, createViewer, createTorontoViewer and ModelChat.svelte UNKNOWN; source confirms Svelte construction/imports in ModelChat/Demo/Toronto/Chat. No HIGH/CRITICAL symbol result; stale/Svelte/dynamic graph gaps are not an all-clear. Existing unrelated dirty tasks040–044 and operator settings must be preserved.

## Implementation / completed criteria
- Toronto capture admits accepted CAD solids, pending CAD ghosts, point overrides/previews and derived layers; synthetic capture admits box ghosts. Existing coverage metadata now describes capture-time imagery/layer presence truthfully. Original-record pixel provenance is conservatively withheld while point edits/previews are present.
- Synchronous render/PNG extraction freezes pixels/camera/coverage before asynchronous hashing. Navigation during hashing preserves the image; replacement/disposal races still reject. A changed view expires only the disposable live pixel-grounding cache.
- Chat/crop no longer poll image currency or invalidate bytes on camera/resize/LOD/overlay/context changes. A primitive derived scene-mode value clears attachments only on actual mode switches (not each new scene-object identity). Preparation cancellation/lifecycle guards remain.
- Image transport no longer blocks historical attachments before/during streaming. Missing live grounding returns unavailable without intersecting current geometry with old camera metadata or interrupting provider continuation. Nonces/identities, byte/hash/MIME/dimension/crop/request validation remain strict.
- Server admits historical capture bindings independently of current tools, including older synthetic sessions/revisions/origins and Toronto artifact revisions. Current scene references, point/CAD authority sessions/revisions, retained exact proposals and human approval checks are unchanged. Provider instructions explicitly separate past imagery from current geometry and permissions.
- Local observation JSON export remains available when live pixel grounding expires. No historical geometry retention framework, new panel or persistent warning was added. Image turns remain one-shot fresh conversations under existing policy.
- Regression tests cover opaque solids/translucent ghosts in the capture helper, mixed-scene viewer wiring, historical attachment send after view and scene rebinding, navigation during streaming/pixel requests, unavailable grounding continuation, current-authority changes still rejecting stale bindings, malformed/oversized PNG/JPEG and explicit abort/cancel. Source-wiring assertions complement deterministic behavior tests; they do not prove browser rendering.
- Existing task040–044 implementation/UI work and `.pi/settings.json` were preserved. Actual scoped diff inspected; no authority/kernel/publication implementation changed.

## Verification and artifacts
Environment: Node `v22.23.3`, pnpm `10.34.6`.

Final checks (run serially):
- `pnpm typecheck > /tmp/task045-typecheck-final.log 2>&1` — PASS; Svelte 0 errors / 0 warnings; all workspace TypeScript checks pass.
- `node --import tsx --test --test-concurrency=1 tests/*.test.ts > /tmp/task045-tests-serial-final.log 2>&1` — PASS **786/786**, 47.6s. Serial runner deliberately avoids the previously reported shared staging-directory race; `pnpm test`/`pnpm verify` were not run.
- `pnpm build > /tmp/task045-build-final.log 2>&1` — PASS web build/server typecheck. Existing Vite >500kB chunk warning remains.
- `git diff --check > /tmp/task045-diff-check.log 2>&1` — PASS.
- LSP diagnostics requested after every code edit; final `lsp_diagnostics({path:'*'})` reports no cached TypeScript diagnostics. Svelte LSP is not configured; current `svelte-check` above is the actual Svelte verification.
- Initial focused run: `node --import tsx --test --test-concurrency=1 tests/model-visual-client.test.ts tests/model-visual.test.ts tests/model-crop-transport.test.ts tests/visual-observation.test.ts tests/model-toronto-proposals.test.ts tests/model-chat-ui-context.test.ts tests/model-proposal-client.test.ts tests/orbit-stability.test.ts > /tmp/task045-focused.log 2>&1` — PASS89/89. Expanded focused run including `tests/historical-screenshot-wiring.test.ts` — PASS95/95 (`/tmp/task045-focused-final.log`); final full run includes subsequent crop lifecycle cleanup too.
- First full serial run:785/786 (`/tmp/task045-tests-serial.log`), new source assertion incorrectly included the explicit user Cancel button. Corrected to forbid automatic cancellation only while requiring explicit Cancel. Subsequent full reruns pass786/786. No runtime safety check was weakened for the test.
- `gitnexus_detect_changes({scope:'all',repo:'cad-agent'})` — aggregate CRITICAL, tool output abbreviated/truncated, not clean certification. Repeated via `node .gitnexus/run.cjs detect-changes --scope all --repo . > /tmp/task045-graph-changes-final.log 2>&1` — exit0, **41 tracked files /179 symbols /140 affected processes /CRITICAL** across the dirty checkout. Includes unrelated tasks and stale/Svelte/untracked gaps; no index rebuild or clean slice claim. Additional crop/helper/test impacts are UNKNOWN; source confirms ScreenshotCrop→compressScreenshot and ModelChat→ScreenshotCrop, plus direct Node test usage. No HIGH/CRITICAL pre-edit symbol result.
- Actual diff inspection artifacts: `/tmp/task045-runtime-review.diff`, `/tmp/task045-other-review.diff`, `/tmp/task045-crop-review.diff` (include pre-existing dirty hunks and intermediate snapshots; repository diff is final authority).

## Blocked / next action
Approved browser harness socket `/tmp/pi-browser-daemon.sock` absent; no browser setup/control tools are available to initialize it. Previous parent CDP attempt was refused403; no bypass attempted. Browser capture/attach/stream/navigation and desktop/mobile idle/selected/pending/error visual acceptance remain **unrun**, not passing. No live provider/account inference was run. Deterministic fixtures do not establish live compatibility or production Toronto rendering.

Next: fresh-session review against this task and actual diff, then approved browser acceptance when the harness is available. Verify Toronto accepted solid + pending ghost + point edit captures, crop/attach after navigation/approval, orbit while streaming, conservative unavailable pixel tools, source switch handling, explicit Cancel and unchanged per-change approval/revision rejection. Suggested skills: spatial-rendering, harness-evaluation, pi-browser-harness and handoff. Handoff: `/tmp/task045-historical-screenshots-handoff.md`.
