# Task040 — Camera-driven point-cloud detail

**Follow-up:** [task041](041-opt-in-adaptive-rendering.md) makes this system optional and restores the old sampled-overview/street-crop default. This task's default-mode/browser evidence below describes the original task040 implementation, not the subsequent opt-in correction.

## Request and scope
Replace the fixed startup street crop with camera-driven native Potree chunks: full native resolution near the camera, progressively coarser distant coverage. Make quality parameters easy to tune and verify in the existing browser. Render caches remain disposable; manual uncapped full-resolution selection, harness sampling, exact source picking, revisions and Toronto local-meter Z-up coordinates stay independent.

## Acceptance
- Camera/frustum/distance and projected chunk size choose additive native octree nodes, following hierarchy proxies. Near nodes refine to leaves subject to an explicit resident point budget; limited coverage is never called complete.
- Bounded network concurrency, response sizes, resident points and hierarchy work; obsolete request cancellation/generation gates, hysteresis/throttle and geometry eviction/disposal. No automatic retry loop.
- Compact collapsed Display quality controls: near-detail radius (m), distant detail threshold (px), point budget, explicit retry on failure. No permanent technical dashboard.
- Exact binary64 source coordinates and IDs resolve displayed native points; overrides and screenshot invalidation cover new chunks. No geometry authority or semantic-query change.
- No automatic full-resolution startup crop; street framing still works. Explicit manual crop stays independent.
- Deterministic backend/client tests plus current typecheck/build/full tests; actual-cloud browser checks for startup, navigation, quality changes, budget/eviction, stable idle and error/retry, source picking and capture invalidation. Desktop/mobile visual evidence and console diagnostics.

## Plan / delegation
1. Backend agent owns additive hierarchy/node API in server Potree/routes/new adaptive module + tests. Inspect graph impact before changes; strict local-only transport and revision checks.
2. Scheduler agent owns new browser adaptive planner/channel + tests: additive ancestry, near/far priority, bounded requests/residency and late-result suppression.
3. Parent owns viewer/UI integration, task documentation and actual Chrome checks. Validate the backend/client interface against actual artifact (native root bounds may differ from dataset occupied bounds).
4. Inspect combined diff/checks; record evidence and remaining limitations. Fresh-session review remains pending; no commit requested.

## Risk
GitNexus marks shared `PotreeDataset` CRITICAL upstream. Backend is additive and keeps old sampling/crop semantics; regression checks required. Viewer/Svelte callers are UNKNOWN/unresolved in the one-commit-stale index; text search confirms Toronto and ClosestPole use the viewer. Adaptive mode is explicitly enabled only by Toronto, preserving legacy fixture/inspection viewer behavior.

## Implementation / completed criteria
- Added `apps/server/src/adaptive-display.ts` plus additive `PotreeDataset.displayHierarchy/displayNode` and strict local-only routes. Catalog follows proxies, validates all original point counts and caches by revision/physical identity; node decoding preserves exact source coordinates/IDs/labels. Existing crop/sample logic unchanged.
- Added `apps/web/src/adaptive-display.ts`: frustum/projected-size/near-distance planning with additive ancestry, hard resident point budget, one physical request lane, cancellation/generation suppression, 150ms throttle, boundary hysteresis, obsolete cache eviction and explicit error retry. No extra payload cache.
- Viewer owns native GPU/cache disposal, source-point overrides, exact source labels/picks and capture coverage/invalidation. Native pick-cache bound65,536 is separate from unchanged crop-batch bound8,192; no shared-helper limit widening. Root validation correctly permits the cubic native root to enclose narrower occupied bounds.
- Toronto starts native streaming after bootstrap sampling, avoiding three concurrent startup dataset operations. Street framing no longer requests an automatic crop. Manual box/window full-resolution selection and independent harness sampling are unchanged.
- Collapsed Display quality exposes near radius0–200m (default30), distant detail160/80/40/20px (default80), and resident budget500k/1M/2M/4M (default2M). Budget/error states stay honest and concise; failure has a primary Retry button. No permanent stats overlay.

## Verification / evidence
Environment: Node22.23.3, pnpm10.34.6; existing Chrome CDP `http://127.0.0.1:9222`. No provider calls, credentials, index preparation, own browser launch or operator process interruption.

- `pnpm typecheck`: PASS, including Svelte zero errors/warnings. `/tmp/task040-typecheck.log` (parent) and child final typecheck; per-file LSP clean for changed TS/JS. Svelte has no LSP configured, so `svelte-check` is authority.
- `node --import tsx --test tests/adaptive-display-client.test.ts tests/adaptive-display.test.ts tests/pole-ui.test.ts`:26/26 pass before final two native-label cases; `/tmp/task040-target-tests.log`. Final child native-label/scene-hierarchy tests12/12 pass; full `pnpm test`746/746 pass in child (`/tmp/task040-native-label-tests.log`). Final parent `node --import tsx --test tests/*.test.ts`746/746 PASS (`/tmp/task040-tests-final.log`).
- `pnpm build`: PASS after final native-label changes; `/tmp/task040-build.log`.
- Parent `pnpm verify`: BLOCKED at `tsx` CLI IPC `listen EPERM` under `/tmp/agents/tsx-501`, after successful typecheck; `/tmp/task040-verify.log`. This is not reported as passing. Equivalent direct Node tests and separately run build pass. An initial full run while browser work ran concurrently had one unrelated semantic-disk staging-cleanup timing failure (`/tmp/task040-tests.log`); isolated full rerun passes without changing that test.
- `node --import tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task040-browser`: PASS after final build,11 groups. `/tmp/task040-browser/report.json`, `/tmp/task040-browser-run.log`. Actual cloud catalog30,168 nodes totals78,320,210 source points. Startup1,999,999 points/421 resident nodes, zero crop requests; orbit/zoom change plans; stable idle produces no repeated requests. Shrinking to500k releases GPU geometry367→70, retaining499,926 points. Near/far tuning, framed view and mobile finish with pending0; no budget overshoot. Independent0.5m crop completes without replacing native chunks. Exact selected key/position/label independently match native source payloads without semantic-index preparation. Captures record adaptive nodes/settings/counts and invalidate on quality/chunk changes. Injected one-node503 latches across camera movement and explicit Retry restores actual data; only expected503 console message, no page errors. Mobile390px has no horizontal overflow and quality input is hit-tested.
- Visually inspected desktop idle/quality/selection/error and mobile scene/quality screenshots. Artifacts: `/tmp/task040-browser/{desktop-idle,desktop-quality,desktop-selected,desktop-error,mobile-idle,mobile-scene,mobile-quality}.png`, corresponding `.ax.txt`. Dense nearby street, coarser whole-dataset view, readable controls/compact failure recovery confirmed. Damping-tail precision is tolerated only in browser settling checks at1µm (planner movement grid10cm); screenshot provenance rules unchanged.
- `git diff --check`: PASS. Inspected tracked and new-file diffs. Unrelated `.pi/settings.json` changes preserved; no commits.
- GitNexus `detect_changes(scope:all)` retried but MCP response truncates mid-JSON (`/tmp/task040-graph-changes.txt`); CLI fallback `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 10000` completes (`/tmp/task040-graph-changes-cli.log`) reporting critical shared-adapter impact,86 indexed changed symbols/40 processes, but displayed process list is capped. Index is one commit stale, misses new untracked files and misattributes unchanged shifted methods. Graph certification remains unresolved, not clean; manual source/diff verification and regressions supplement it. No commit gate bypass.

## Remaining limits / next action
- Near full resolution is budget-limited, not guaranteed complete in dense views. Continuous significant movement may defer refinement until settling. Manual uncapped detail remains outside adaptive residency limits. Algorithmic caps are not measured process-memory ceilings.
- Legacy scripts expecting removed fixed depth controls/automatic startup crop are historical; current replacement checks are in the new adaptive browser script. No whole-cloud semantic-query or artifact-integrity certification is claimed.
- Implementation complete; **fresh-session review pending** against this task, actual diff and evidence. Suggested review focus: cancellation/resource lifecycle, ancestry/budget selection, provenance/labels/overrides/capture, strict native routes and new untracked coverage. Redacted completion handoff: `/tmp/task040-camera-lod-handoff.md`.
