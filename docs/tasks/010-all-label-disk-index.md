# Task 010 — Bounded all-label closest-point index

## Scope and design
User explicitly authorized replacing task009's abundant-category full-source interactive fallback. Preserve all task009 edits, exact scalar labels, binary64 distances, numeric source-key ties, revision/provenance binding, cancellation and independently verified complete outcomes. No relabeling of visually ambiguous Pole annotations, model/CAD/crop-cap changes, graph rebuild or commit.

Use one disposable disk index per immutable prepared source identity, shared by all nine labels. One full preparation pass validates hierarchy coverage and every source record, emits physical-order 4096-point pages preserving Potree locality, actual per-label AABB/counts and SHA256 integrity, plus shared externally partitioned source-row→physical-row lookup. Explicit memory budgets bound spool buffers, lookup construction, metadata and query pages; no full category/lookup array. Atomic awaited publication only after source/revision validation. Startup loads bounded metadata, not the whole cloud. Resource/integrity failures never silently select exhaustive interactive scans.

Production best-first Euclidean page search and independent verifier with its own ordering, lower bound, decoding and reduction cover all page intervals. Excluded/pruned/visited coverage accounting and strict `lower > winner.distanceSquared` pruning preserve ties. Whole-dataset category counts come from complete index coverage; AABB counts use contained-page counts plus exact partial-page filtering. Original selected/winning prepared records remain direct witnesses. Retain the independent exhaustive source oracle for offline audits and fixture parity.

## Acceptance criteria
- [x] All nine labels and both input kinds complete via disk-backed indexed HTTP path, including categories previously above memory limits; no histogram-driven/full-source interactive fallback.
- [x] Exact oracle parity for nearest/empty/AABB/ties/boundary binary64 arithmetic; shared index/lookup across labels and loaded/warm paths.
- [x] Independent verifier covers every page with count/bounds/integrity proof, separately recomputes winner, and reports bounded cache I/O distinct from original source I/O. Client validates the new evidence without relaxing legacy evidence validation.
- [x] Cancellation/wait/retry/resource/stale/source/cache corruption/unknown-provenance fail safely; immutable published pages checked with bounded reads and active stat checks.
- [x] Actual Ground and Building completed/warm HTTP latency and Pole regression measured, also all nine labels; cold preparation and persisted-startup reported separately. Target warm p95 <2 seconds on this machine; disclose misses, no weakened checks.
- [x] Baseline typecheck/tests/build, targeted new tests, existing-Chrome browser category regression pass; exact commands/artifact paths recorded. Inspect diff; fresh-session review pending.

## Delegation
- Storage child: new `semantic-disk-index.ts` and storage tests only; complete preparation, bounded storage/integrity/provenance API.
- Query/verifier child: `pole-index.ts`, query/index tests and standalone disk-verifier module; exact search + independent proof-aware verification, no contracts/client edits.
- Parent: contracts/client evidence integration, task/architecture docs, actual-data HTTP and existing-browser benchmark/verification, full baseline and diff inspection. No user server3001 changes; owned3002/4175 only, existing Chrome9222 only.

## Impact limitation
GitNexus query/impact attempted; LadybugDB cannot replay shadow pages read-only, impact UNKNOWN. Source-confirmed consumers: pole-transport HTTP, fixture tests, offline/performance scripts; client evidence validators and shared semantic contracts require coordinated version update. No graph claims or low-risk inference. Existing task009 working tree preserved; no commit planned.

## Status
Implemented and verified; ready for **fresh-session review**, not reviewed or committed. Existing task009 working-tree changes preserved. No category RAM-cap increase, full-source interactive fallback, relabeling, model/CAD/crop-cap changes or historical task008 artifact overwrite.

## Verification and measured results

- `pnpm exec tsx --test tests/semantic-disk-storage.test.ts tests/pole-index.test.ts tests/pole-ui.test.ts` — PASS45/45 (7storage/25query/13UI); `/tmp/task010-completion-scoped.log`. Exhaustive oracle parity across all labels, both input kinds, exact binary64/ties/AABB/empty/multi-page domains; shared loaded/warm caches, independently broader verifier traversal, bounded corruption/resource/cancellation/wait/retry/source/provenance failures and strict current/legacy client evidence checks. Fixture HTTP covers all nine coordinate queries; actual HTTP/UI covers all nine point-reference queries.
- `pnpm verify > /tmp/task010-completion-verify.log 2>&1` — PASS exit0,92/92 tests; workspace typechecks/Svelte0errors0warnings, web build/server typecheck. Vite651.72kB chunk warning remains. Latest workspace LSP: no errors, one unused `PoleSelection` hint in `tests/pole-ui.test.ts:16`. Both modified browser scripts pass `node --check`; dedicated Pole-performance script was not separately runtime rerun.
- `pnpm exec tsx scripts/check-closest-label-disk.ts --prepare /tmp/spatial-task010-actual` — PASS genuinely cold shared preparation29.692s, one4,307,611,550-byte payload pass,3,457,085,327-byte cache,254,197,760-byte peakRSS. Cold receipt excludes persisted reuse. Do not delete active cache to reproduce cold.
- `pnpm exec tsx scripts/check-closest-label-disk.ts --http /tmp/spatial-task010-actual` — PASS production HTTP/client91 completed queries: persisted first184.389ms; ten ungated warm point-reference queries/two source selections per label. Nearest-rank warm p95 Ground909.407ms/Building158.999ms/Pole42.161ms, all nine<2s;302,006,272-byte peakRSS. Exact prior Pole winner preserved. Cold/persisted/warm are distinct; coordinate-found correctness checked in fixtures, not actual latency samples.
- `DEBUG=pw:api node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task010-browser-current > /tmp/task010-browser-current.log 2>&1` — PASS exit0,10/10 checks against actual data/current built UI/existing Chrome, no console/page errors. All nine native category queries complete, current shared-disk coverage copy and full evidence verified. Ground/Building screenshots visually inspected. Native instrumented Ground764ms/Building229ms/Pole432ms gestures are not HTTP percentiles. Window/detail/provenance/Shift/cancel/supersession/LOD/orbit/clear/reload/narrow/Toronto/demo/disposal/remount checks pass; held unchanged responses only for deterministic lifecycle checks, excluded from latency.

Receipts copied to ignored `artifacts/closest-label-performance/{prepare.json,http.json,summary.md,verify.log,browser-current.log,browser/}`; summary includes every category's median/p95 and evidence paths. Earlier passing browser evidence remains `/tmp/spatial-task010-browser-final/`. A post-copy rerun timed out180s without artifacts in `/tmp/spatial-task010-browser-complete/` (cause undetermined). Cleaned only its owned3002/4175 process groups and exact stale owned tab; corrected coverage-text assertion from result list to sibling-containing aside without weakening numeric checks. Latest diagnostic rerun passed and cleaned its own tab/processes; neither owned port listening afterwards. Existing server3001, user tabs and Chrome lifecycle untouched.

## Completion limitations / next action

Actual diff sanity inspected and `git diff --check` PASS. GitNexus impact/detect_changes retried, still LadybugDB read-only shadow replay failure: graph risk **UNKNOWN**, not clean. Confirmed final browser-script callers against source; no rebuild or commit. Trusted immutable-cache/source assumption and no automatic disk eviction remain explicit in query docs. Actual workload measurements do not establish universal latency; declared memory budgets are not RSS caps. Fresh-session review of task010 against the actual task009+task010 diff is the next bounded action.
