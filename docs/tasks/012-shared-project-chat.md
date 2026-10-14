# 012 — Read-only shared-project chat shell

Status: Implemented and independently reviewed — scoped acceptance passes; full graph certification and cached parent-LSP discrepancy remain unresolved.

## Ownership

- Implementation: focused delegated integration/finishing agents.
- Documentation and acceptance coordination: parent agent.
- Review: separate fresh-context reviewer, `/tmp/spatial-task012-fresh-review/review.md`.

## Goal

Make the intended left-scene/right-chat workspace usable through a deterministic caller and the real task011 inspection dispatcher, with a shared server-owned read-only demo snapshot. This proves integration, not a model or editing loop.

## Scope

Included: server snapshot bootstrap; bounded read-only transport/session binding; documented deterministic inspection commands; request/result/evidence display; client cancellation/generation/revision suppression; tests and browser acceptance.
Excluded: provider/auth/model calls, visual capture tools, save/load/persistence, mutations, approval/undo, CAD/kernel dependencies. No geometry edits claimed.
References: [TODO acceptance](../TODO.md#next-reasonable-step--shared-project-chat-shell), [architecture](../architecture.md), [tool protocol](../tool-protocol.md), [command/API guide](../shared-project-chat.md).

## Acceptance criteria

- [x] Integrated demo loads `/project` (no independent browser seed/fallback); viewer and chat show the same authoritative IDs, geometry revision, units and explicit project frame/origin. Picking and camera remain disposable view state.
- [x] Exact commands `metadata` and `observe B D` use the real allowlisted task011 runtime. Canonical request/result/evidence references display; unsupported text is explicit, never a fake model answer. Toronto bindings retain their own artifact revision/origin/frame and are not mapped into demo geometry.
- [x] Pending, completed, rejected, incomplete, error and cancelled states remain distinct. Cancellation/disposal/reload and stale session/project revision/generation suppress late publication. No result changes scene geometry.
- [x] Transport bounds/validates input, fixes trusted operator configuration, propagates cancellation, exposes no paths/arbitrary tools and explicitly handles server/dataset unavailable.
- [x] Existing demo picking/orbit, exact all-nine-label closest queries and uncapped detail behavior remain intact.
- [x] Deterministic integration tests cover actual dispatcher flow, unsupported input, failure, cancellation, malformed frame/LOD and stale publication; `pnpm verify` passes without weakened checks.
- [x] Actual existing-Chrome checks cover left/right layout, shared binding, real request/result flow, unsupported/error/cancel/reload behavior and demo/all-label/detail regressions.
- [x] Actual diff inspected and separate fresh-context review completed; unresolved graph coverage reported honestly, not certified clean.

## Implementation progress

Task011 isolated runtime/dependency review found no new issues; it is ready as a trusted-local inspection substrate, not project authority (`/tmp/spatial-task011-final-review.qKfHsw/review.md`). Existing dirty task011/docs changes preserved; no staging/commit/branch changes requested or made.

Added contracts/chat envelopes, fixed local server `/chat/inspect` composition, bounded browser bootstrap/response validation and generation-gated controller. `App.svelte` loads one server snapshot and mounts the left viewer/right chat; reload disposes old work. Selection stays browser-only. Metadata and bounded observations retain Toronto origin/artifact evidence separately from the demo frame. No nearest command was added to chat; the existing exact-label tab remains unchanged algorithmically.

Added repeatable shared-chat smoke. Existing browser scripts now bootstrap the required server/proxies and scope entity-sidebar selectors. The label test desktop viewport adds380px for chat to preserve its original1440px scene/provenance fixture; assertions were not removed or weakened. Initial fixture-layout failure remains recorded in implementation artifacts.

## Verification evidence

Environment: Node v22.23.3, pnpm10.34.6. Existing Vite >500KiB bundle warning remains informational.

| Exact command/check | Result | Diagnostics/artifacts |
| --- | --- | --- |
| `pnpm exec tsx --test tests/shared-chat.test.ts` |8/8, independently repeated | `/tmp/spatial-task012-implementation/chat-tests-final.log`; `/tmp/spatial-task012-fresh-review/shared-chat-tests.log` |
| `pnpm verify` |123/123, typecheck/svelte-check/build pass; independently repeated | Implementation `verify-final.log`; fresh review `verify.log` |
| `node scripts/browser-shared-chat-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-implementation/browser-final` |10 real-dispatcher browser checks pass | `browser-final/report.json`, screenshots, metadata/observe JSON and owned process logs |
| `node scripts/browser-shared-chat-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-fresh-review/browser` |10 checks independently pass; screenshots visually inspected | Review `browser/report.json`, screenshots, canonical replies |
| `pnpm verify:browser http://127.0.0.1:9222` |Demo picking/orbit/zoom/resize/selection passes | `/tmp/spatial-task012-implementation/demo-browser.log`; ignored `artifacts/browser/report.json` and screenshots |
| `node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-implementation/label-regression-final` |10 actual-data checks, all nine exact labels and uncapped window detail/provenance/cancel/disposal pass | `label-regression-final/report.json`, NDJSON, screenshots |
| `node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-fresh-review/labels` |10 checks independently pass | Review `labels/report.json`, NDJSON and screenshots |
| `pnpm exec tsx /tmp/spatial-task012-fresh-review/http-boundaries.ts` |Admission/body probes pass: third reader429, disconnect release, encoded body413, streamed oversized body400 | Review `http-boundaries.log` and temp-only probe |
| LSP in implementation/fresh review; parent `lsp_diagnostics('*')` |Isolated agents clean. Parent cached workspace reports105 errors+1 hint in8 files, predominantly missing on-disk exports and historical Potree pattern; inconsistent with current CLI passes. No source workaround applied | Parent diagnostic note `/tmp/spatial-task012-completion/lsp-note.md`; CLI results above |
| GitNexus impact/context/detect in implementation/review |Recovered access; HIGH shared chat-helper fan-out acknowledged/reviewed; UNKNOWN controller/new entrypoints source-confirmed. Stale/untracked/Svelte/PDG gaps prevent clean all-diff certification | Review `review.md`, `graph-detect.log`, `graph-explain.log`; implementation graph artifacts |
| `git diff --check`; browser script syntax checks |Pass | Implementation `diff-check.log`, tracked patch |
| Parent `pnpm typecheck` after documentation reconciliation |exit0; recursive workspace/tests and Svelte checks pass | `/tmp/spatial-task012-completion/typecheck.log` |
| `python3 /tmp/spatial-task012-doc-review/check-docs.py`; whitespace/new-file checks |8 docs,76 local links,12 anchors, balanced fences/valid tables;20 evidence paths exist; no whitespace diagnostics | `/tmp/spatial-task012-doc-review/markdown-checks.json`, `whitespace.log`, `evidence-paths.json`; final correction rerun `/tmp/spatial-task012-completion/docs-checks.json` |

Browser uses existing Chrome, no launch. Cancellation/reload checks deliberately gate real completed HTTP replies with a noncooperative fetch wrapper; these are lifecycle checks, not latency claims. Intentional owned-backend shutdown causes two expected resource500 messages, no page exceptions; label checks report no console/runtime messages. Owned test processes/tabs cleaned up; user's :3001 server untouched.

## Review

Separate fresh-context review read the actual task012 tracked/untracked delta, dependencies and browser evidence; independently reran checks and HTTP probes. **No actionable defect found; READY for the bounded trusted-local read-only slice.** `/tmp/spatial-task012-fresh-review/review.md` and redacted `handoff.md`. This does not approve earlier pending tasks or certify graph/PDG completeness. Final documentation review (`/tmp/spatial-task012-doc-review/review.md`) found one LOW stale future-tense/index-outage wording issue in TODO/roadmap; parent corrected it and reran the saved checks. Historical outage evidence remains labelled historical; full graph coverage is still not certified.

## Remaining failures / next action

No runtime/browser implementation blocker found. Graph stale/untracked/Svelte/PDG coverage and long-lived parent LSP cache remain tooling limitations, not silently clean gates. Before any graph-certified commit, reconcile them in a scoped maintenance task; do not stage user changes simply to satisfy graph detection. No commit requested.

Next product checkpoint requires a separately bounded assignment: full item5 authority/persistence or deterministic item6 approved box-edit path only after its dependencies. Provider/model/image/CAD backlog remains unassigned. Completion handoff: `/tmp/spatial-task012-completion/handoff.md`.
