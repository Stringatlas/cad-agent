# Task007 — Closest pole tab

Status: implemented and verified at the HTTP/test boundary; browser inspection blocked; fresh-session UI review pending.

## Scope and acceptance

Implement the authorized in-app Closest pole tab from `/tmp/spatial-cad-closest-pole-ui-handoff.md`, reusing task006's complete-dataset search and independent verifier. No model, CAD, pruning, data regeneration or unrelated refactoring.

- Cmd/Ctrl-left-click on an overview point automatically queries its original binary64 observation provenance and revision. Click versus drag/cancel/empty is explicit; Shift takes precedence. Existing Toronto Shift box/window and uncapped progressive full-resolution behavior remain intact.
- A fixed read-only HTTP endpoint validates the existing request contract, shares loopback security and two-operation admission, bounds streamed frames, coalesces progress with socket backpressure and releases resources on disconnect/failure. No arbitrary query deadline or filesystem input.
- Independent query generation/controller owns selection, real phase/count/byte progress and validated terminal outcomes. Supersession, Cancel, Clear, revision change and disposal suppress stale publication. Only verified-found/verified-none are complete.
- Show selected and winner markers/provenance/positions/distance in local meters, including winners omitted by samples; explicit Frame result; independent GPU error reporting. Display/harness LOD do not define the answer.
- Meaningful transport/lifecycle/picking/route tests, pnpm verify and built-browser interaction inspection; record exact evidence and blockers. Inspect owned tracked/untracked diff; save redacted OS-temp handoff; UI review remains pending.

## Backend seam inspection

Reviewed the source of task006 contracts, executor, artifact snapshot, production scan, independent verifier and composition before integration. Composition holds one snapshot, validates revision/identity before/after both scans, invokes the separate linear decoder/reducer and closes in finally. Point-reference resolution exhausts records in both paths; no sample/crop fallback. Existing semantic tests cover forged evidence, cancellation, corruption, mutation and resource failures. No concrete blocker found for this transport seam; this bounded inspection does not complete task006's full review.

GitNexus bound to cad-agent at this checkout (indexed 2026-10-11, commit/staleness unknown). Concept query and upstream impacts for createDatasetRoutes/createTorontoViewer/queryClosestPole/App.svelte fail with LadybugDB read-only shadow-page recovery. Risk UNKNOWN; callers/processes unresolved. Source fallback confirms route called by createDemoServer, viewer by Toronto.svelte, query by tests/headless evidence script. No graph all-clear, rebuild or commit.

## Evidence / next action

Implemented the third navigation scene, original-observation pick caches, click-versus-drag/cancel handling with captured cache generation, optional Cmd/Ctrl query callback, local-meter markers/line and explicit framing. Shift takes precedence; the old Toronto tab keeps its existing Shift box/window behavior. Cmd/Ctrl gestures suppress OrbitControls and context menus, and pointerup/cancel/lost capture restores controls. Overview replacements/disposal invalidate pick hints. Full-resolution crop buffers carry no provenance and are not query-pick targets.

The query channel captures a selection/request, separate generation and AbortController. New picks, Cancel, Clear, disposal and discovered dataset revision changes suppress obsolete progress/results even when a loader ignores abort. Server results remain independent of camera/display/harness LOD. GPU failures are reported separately and cannot erase or certify server verification. Repeated progress does not reallocate unchanged markers; replacement/disposal releases their GPU buffers.

Fixed GET `/datasets/toronto3d/closest-pole?request=<URL-encoded JSON>` accepts the existing canonical request contract inside the same loopback/Origin/Range/4096-character URL protections and shared two-operation admission. One operation slot remains held through snapshot cleanup and streamed terminal output. No paths, queue, total scan/time cap or sample-nearest fallback. Server frames are at most64KiB; one latest progress value is coalesced while a socket awaits drain. Actual phases/counts/bytes are reported, without percent/ETA. The client bounds pending frames, rejects stale/request/evidence/distance/progress mismatches and requires a validated terminal plus EOF and request digest before completion. Unexpected stream failures destroy the HTTP body rather than leave it hanging.

## Verification evidence

Environment: Node22.23.3, pnpm10.34.6. Commands run from the repository root. Socket/tsx IPC checks required approved execution outside the sandbox after an initial EPERM; the acceptance checks were retained.

| Exact command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm exec tsx --test tests/pole-ui.test.ts` | Initial focused5/5 PASS after fixture corrections; final suite includes a sixth backpressure/failure test | `artifacts/closest-pole-ui/focused-tests.log` |
| `pnpm verify` | Final PASS49/49, all typechecks and production build | `artifacts/closest-pole-ui/verify.log` |
| `pnpm exec tsx scripts/check-closest-pole-http.ts` | Actual prepared-data whole-dataset point-ref HTTP query PASS, validated through the production browser client/channel | `artifacts/closest-pole-ui/actual-http.{json,log}` |
| `node --check scripts/browser-closest-pole-smoke.mjs` | PASS syntax only | Script source; does not certify browser behavior |
| `node scripts/browser-closest-pole-smoke.mjs` | BLOCKED before page creation: CDP ECONNREFUSED127.0.0.1:9222 | `artifacts/closest-pole-ui/browser.log`, `browser/report.json` |
| `node scripts/browser-toronto-smoke.mjs` | BLOCKED before page creation: same CDP refusal | `artifacts/closest-pole-ui/browser-toronto.log` |
| `pnpm verify:browser` | BLOCKED before page creation: same CDP refusal | `artifacts/closest-pole-ui/browser-demo.log` |
| `curl -sS --max-time 3 http://127.0.0.1:9222/json/version` | Connection refused | `artifacts/closest-pole-ui/cdp-probe.log` |
| Native Computer Use fallback | Running Chrome discovered; selecting Chrome rejected: “Computer Use permissions are not granted” | `artifacts/closest-pole-ui/browser-infrastructure.json` |
| GitNexus concept/impacts/final `detect_changes(scope:all, repo:cad-agent)` | BLOCKED by database recovery error; UNKNOWN risk, unresolved callers/processes; retried without rebuilding | `artifacts/closest-pole-ui/graph-status.json` |
| `git diff --check`, owned tracked/untracked source/diff inspection | PASS; bounded scope; pre-existing work retained | `artifacts/closest-pole-ui/{before.patch,before-status.txt,owned-files.patch,change-inspection.log}` |

The actual HTTP query selected source4/row156656 at `[243.786,243.429,141.267]`. Winner source4/row486157 at `[261.605,263.00100000000003,139.178]`, distance26.550779009287126m, was absent from the2339-point root display sample. Search and independent verification each exhausted78,320,210 records; each also resolved the selected reference across78,320,210 records. Total physical payload reads17,230,446,200 bytes, maximum bounded read4,194,300 bytes. Elapsed78.59s. The256/depth0 harness observation remained identical before/after. This is HTTP/client evidence, not browser rendering or a repeat of the preprocessing/raw provenance audit.

Tests cover original binary64/source-key mapping and stale/disposed cache rejection; modifier/Shift precedence and click/drag/cancel predicates; ignored-abort supersession, cancel/clear/disposal/revision changes; response evidence/hash/distance/empty/zero-distance/framing validation; real route/verifier/sample omission/LOD independence; request/Host/Origin/Range/method/duplicate-key validation; shared admission/disconnect release; stalled drain, bounded frames and injected socket-failure termination. Existing crop/LOD/semantic tests passed unchanged. Actual browser pointer delivery, native macOS Ctrl context behavior, visual markers/framing, orbit/zoom, tab disposal and console remain unverified. The new browser script is ready to exercise Cmd and Ctrl modifiers, Shift precedence, return-to-start drag rejection, cancellation, actual verified result, markers/framing, LOD independence and tab switching once existing CDP Chrome is available; run existing Toronto/demo scripts too and visually inspect screenshots.

Initial implementation diagnostics corrected a Svelte rune collision (`state` renamed `queryState`), Node fetch overriding a test Host header (replaced by real node:http request), and an oversized synthetic root fixture using the capped sample reader (now explicitly constructs only the test pick observation). No production cap or acceptance check was weakened. Production bundle643.00kB retains the existing >500kB warning; no unrelated performance rewrite.

## Review and next action

Fresh-session UI review **pending**, against this task, actual source and `owned-files.patch` (incremental against captured starting workspace). Complete built-browser inspection when CDP/native permissions are available. Backend seam inspection above was bounded integration review, not completion of task006's full review. Earlier reviews remain separate; task005's accepted user browser confirmation remains intact.

Owned runtime changes: dataset-routes, App.svelte, toronto-viewer; new pole-transport, pole-client, pole-picking, ClosestPole.svelte. New UI tests, actual HTTP and browser scripts; additive test-tsconfig inclusion and architecture/task docs. Task006 backend/contracts/tests/script and all other pre-existing untracked work are preserved. No commits, installs, browser launch/profile changes, data/index regeneration, model/CAD/pruning changes. Redacted temp review handoff: `/tmp/spatial-cad-closest-pole-ui-implementation-handoff.md`.
