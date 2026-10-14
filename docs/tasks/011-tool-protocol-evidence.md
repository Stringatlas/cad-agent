# 011 — Versioned read-only tools and replayable evidence

Status: Independently reviewed / ready as trusted-local inspection substrate — implementation, corrective rereview and final isolated runtime/dependency review pass; full graph completion unresolved. Remaining six items queued only.

## Ownership

- Implementation: isolated tool-protocol/evidence agent; bounded corrective agent resolved two independent-review findings.
- Documentation and acceptance coordination: parent agent.
- Independent verification/review: separate fresh-context review and corrective rereview agents, completed below. Final isolated runtime/dependency review also completed below; full graph gate remains unresolved, so this is not graph-certified whole-task completion.

## Goal

A deterministic caller can invoke existing dataset metadata, bounded harness observation and independently verified nearest-label capabilities through an allowlisted versioned protocol, save redacted durable evidence, and replay against the same trusted immutable prepared artifacts/configuration/code identity. No model required.

## Scope and owned paths

- New shared contracts module `packages/contracts/src/tool-protocol.ts`, new agent modules `packages/agent-harness/src/tool-protocol.ts` and `run-evidence.ts` (or equivalently bounded new files). Additive exports in their existing `index.ts` files only; do not edit existing function/class/method bodies.
- New concrete Node composition/evidence adapter under `apps/server/src/` wrapping `PotreeDataset.info/observe` and `queryIndexedClosestPole` (all nine labels despite historical name). No new HTTP route or UI.
- New `tests/tool-protocol.test.ts`, `tests/run-evidence.test.ts`, `docs/tool-protocol.md`; parent owns this task, roadmap, TODO and task index.
- Reuse contracts, explicit frame/units, existing observer/query/verifier results. No direct server/kernel/renderer/Pi imports in agent-harness; Node filesystem/crypto stays in the concrete adapter.
- Exclude model/provider integration, image observations, benchmark runner, geometry mutation, project authority/persistence, CAD, nearest/index algorithm rewrites and actual-data regeneration. No commits requested.

## Acceptance criteria

- [x] Schema-versioned canonical request/result envelopes allow only metadata, bounded harness observation and nearest-label tools. Strict unknown-field/tool/type/finite-number validation; detached canonical arguments; run/request IDs, artifact revision, units/frame and explicit search/observation coverage. Project geometry revision is not a dataset revision.
- [x] Invalid/stale bindings fail closed before adapter work; results preserve verified-found/none, verification-rejected, incomplete and error distinctions. Metadata/observations are observations, never verified CAD or exhaustive coverage. Validate returned binding/evidence and do not promote candidates/untrusted status to verified success.
- [x] Configured call/concurrency/deadline and bounded evidence-export budgets, caller cancellation and late completion prevent publication of false success; propagate AbortSignal, cleanup listeners/timers/admission. No implicit AABB/label/sampling changes to satisfy budgets. Adapter resource outcomes stay incomplete.
- [x] Redacted durable JSON evidence stores canonical calls, outcomes or outcome hashes/references, schema/tool/code/config/artifact identity, timing and available read metrics. Separate nondeterministic timing/cache/read-work metrics from canonical semantic outcomes. Bounded observations/cloud arrays not dumped by default; no credentials, arbitrary paths, raw exceptions or unbounded adapter strings in default traces. Saved evidence must be loadable for replay.
- [x] Replay invokes tools again and compares canonical semantic outcomes, not elapsed time/cache counters. Fail explicitly on malformed evidence, absent/mismatched dataset artifact, schema/tool/config/code versions or outcome mismatch; never just trust saved verified status. Rejected/incomplete/error outcomes remain such even if replay matches them.
- [x] Concrete artifact adapter streams SHA-256 over the fixed prepared assets in bounded reads and binds their names/sizes/digests; does not mistake existing stat-derived revision for a full content hash. Missing/changed/symlinked artifacts and cancelled digest work fail explicitly. Explain trusted immutable-artifact precondition/TOCTOU limitations; no claim of production content-addressed admission. Digest preparation is explicit, not a hidden full-cloud pass per interactive query.
- [x] Deterministic tests cover all three tools, all labels/domain forwarding, independent query adapter fixture, invalid input/stale revision, forged/wrong evidence, rejection/error/resource, cancellation/deadline/late results, export redaction/bounds, persisted replay, timing/cache variation, missing/tampered artifacts and code/config/schema mismatch.
- [x] `pnpm verify` passes on Node22/pnpm10.34.6 without weakened checks; exact commands/results/artifacts recorded. Browser checks not applicable unless rendering/interaction changes are introduced (not authorized).
- [x] Actual tracked/untracked runtime/test diff independently inspected; final isolated runtime/dependency review completed. Graph impacts/change checks recovered, but untracked/PDG/stale-document coverage remains unresolved and is not a clean gate.

## Implementation progress

Implemented [approved roadmap item1](../plans/2026-10-13-harness-must-haves.md#1-versioned-tool-protocol-and-replayable-run-evidence--first-slice); interface/usage and limitations: [tool protocol](../tool-protocol.md). Three read-only tools, detached strict envelopes, deadline/call/concurrency bounds, redacted semantic outcome hashes, executing replay, streamed full-content identities and constrained durable storage are available. Existing source function bodies/algorithms, UI, HTTP routes and full-resolution detail remain unchanged.

Independent review found two MEDIUM evidence-boundary defects despite passing baseline: contradictory whole-domain category counts and changing accessor arrays. Correction requires whole-domain matching/category equality separately in both proofs, and validates/hashes/publishes one bounded inert descriptor-copied snapshot. Five discriminating pre-corrective regression failures were recorded; corrected tests and separate real-fixture rereview pass. No remaining finding in the bounded runtime/test scope.

Limits remain explicit: trusted immutable prepared files and hash-to-read TOCTOU, operator-supplied code identity, unsigned traces validating only supplied/admitted calls (not authenticated original-run completeness), sequential replay rather than scheduling/abort-timing recreation, and noncooperative work holding admission until settlement. No model/provider/mutation/kernel scope added; no commits made.

## Verification evidence

| Exact command/check | Result | Diagnostics/artifacts |
| --- | --- | --- |
| `node --version`; `pnpm --version` | v22.23.3; 10.34.6 | Environment confirmed during assignment. |
| GitNexus `query` (dataset observation closest label tool execution verification), `impact(executeNearestPole, upstream)`, `impact(PointObservationSource, upstream)` | Blocked / UNKNOWN; LadybugDB cannot replay shadow pages read-only. Callers/processes unresolved. | Source confirmed with reads and `rg`; no routine index rebuild and no existing function edits authorized. |
| Initial implementation `pnpm exec tsx --test tests/tool-protocol.test.ts tests/run-evidence.test.ts`; `pnpm verify` | 17/17 targeted; 109/109 baseline, typecheck/build pass (before corrective review) | `/tmp/spatial-tool-evidence.T1iWzK/checks.md`, `targeted-final.log`, `verify-final.log` |
| Independent initial review: same targeted/full commands plus `pnpm exec tsx /tmp/spatial-task011-review.yvgi1S/probes.ts` | Baseline passed; two MEDIUM flaws reproduced. Changes required. | `/tmp/spatial-task011-review.yvgi1S/review.md`, `probes.log`, `owned.diff` |
| Correction: `pnpm exec tsx --test /tmp/spatial-task011-correction.M7ivDT/pre-fix-regressions.test.ts` against preserved pre-corrective modules | 5 discriminating failures (10/15 passed), proving new tests expose original flaws | `/tmp/spatial-task011-correction.M7ivDT/verification.md`, `pre-fix-isolated.log` |
| Correction final targeted command; `pnpm verify` | 23/23 targeted; 115/115 baseline, typecheck/build pass | `/tmp/spatial-task011-correction.M7ivDT/targeted.log`, `verify.log`, `corrective.diff` |
| Independent corrective rereview: targeted command; `pnpm verify`; `pnpm exec tsx /tmp/spatial-task011-rereview.b9aGCr/probes.ts` | 23/23; 115/115, typecheck/build pass; both exploits rejected without getter invocation; AABB subsets, zero-label absence, frozen arrays and persisted executing replay pass | `/tmp/spatial-task011-rereview.b9aGCr/review.md`, `targeted.log`, `verify.log`, `probes.log`, `owned.diff` |
| LSP after corrections in isolated agents; parent cached workspace LSP after doc integration | Agents reported clean. Parent's long-lived LSP still reports stale missing-export/potree errors inconsistent with on-disk exports and successful CLI typechecks; refreshing individual dependency files did not clear them. No source workaround applied. | Rereview `diagnostics.md`; `/tmp/spatial-task011-parent/lsp-note.md` |
| Parent final `pnpm typecheck` | exit0 after final documentation changes; recursive workspace + tests typechecks pass | `/tmp/spatial-task011-parent/typecheck.log` |
| `git diff --check`; new-file no-index whitespace checks; import-boundary search | No whitespace diagnostics or prohibited imports; actual complete source/test diff independently inspected | Rereview `whitespace.log`, `import-boundaries.log`, `owned.diff`; no-index exits1 denote new-file differences |
| Final GitNexus `detect_changes(scope:all)` + impact/context attempts in each agent | Still blocked by LadybugDB read-only shadow replay. UNKNOWN, not a clean graph check | Rereview `graph-checks.md`, `graph-detect.log` |
| Final isolated runtime/dependency review: `pnpm exec tsx --test tests/tool-protocol.test.ts tests/run-evidence.test.ts`; `pnpm verify`; corrective probes |23/23;115/115, typecheck/build pass; no new actionable findings; ready as chat substrate | `/tmp/spatial-task011-final-review.qKfHsw/review.md`, `targeted.log`, `verify.log`, `probes.log` |
| Final review GitNexus context/impact/detect (exact commands in review) | Access recovered; HIGH/CRITICAL shared-helper risks inspected, UNKNOWN constructor callers source-confirmed. Detect omits untracked files; stale coordination docs and absent PDG prevent full graph certification | Review directory `graph-impact-manifest.json`, `graph-detect.log`, `index-source-identity.txt`, `graph-pdg-availability.log` |
| Browser | Not applicable to additive headless slice; later HTTP/UI integration has separate task012 evidence | No task011 browser pass claimed. |

## Review / remaining failures / next action

Separate initial review and fresh-context corrective rereview completed, artifacts above. Rereview verdict: **conditionally ready**, no new findings in bounded additive/corrective runtime/test scope. Existing Vite >500kB bundle warning remains; browser checks not applicable/not run. Documentation approval does not clear prior tasks' pending reviews.

**Final isolated review:** `/tmp/spatial-task011-final-review.qKfHsw/review.md` found no new runtime/contracts/test/dependency defects and independently repeated checks. Graph access recovered; earlier shadow-page failures above are historical, not a current outage. Full untracked/PDG graph completeness remains unresolved, not low risk. Cached parent LSP discrepancy persists despite clean CLI and isolated agent checks; do not alter source merely to quiet stale tooling.

**Next bounded action:** task012 subsequently integrates this substrate and records its own review/browser evidence. Before any future graph-certified commit, reconcile index freshness/untracked/PDG coverage under a scoped tooling task. No commit requested. Items2–7 stay queued, not automatically assigned. Historical parent artifacts remain at `/tmp/spatial-task011-parent/handoff.md`.
