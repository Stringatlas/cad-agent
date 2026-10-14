# Task013 — Real CAD sandbox and basic tool endpoints

Status: Implemented and independently fresh-source reviewed; completion checks pass with graph/LSP limitations below. User authorized CAD engine implementation; no commit requested.

## Scope and decisions

Implement an actual OpenCascade-backed solid engine through a kernel-independent geometry adapter and bounded local HTTP endpoints. Selected pinned `replicad-opencascadejs@1.1.0` direct OpenCascade bindings after actual kernel execution/validation/export; no Replicad JS wrapper was needed. The sandbox is ephemeral per server instance, explicitly separate from `ProjectState`; neither `/project` nor read-only chat becomes an edit API. No viewer changes, model calls, approval bypass, arbitrary file access or persistence.

Coordinates remain local meters, right-handed Z-up. CAD results carry sandbox body IDs/revisions and the source demo session, geometry revision and `demo-local-v1` (`PROJECT_FRAME_ID`) frame binding. This binding is provenance, not project publication or verification of an approved edit. STEP must carry explicit units (and round-trip dimensions must be tested).

## HTTP contract

- `GET /cad/capabilities`: supported operations, limits and source binding.
- `POST /cad/execute`: JSON `{sessionId, projectRevision, frameId, operation}`. Strict keys; mismatched session/revision/frame rejected before kernel execution.
- Operation discriminant `kind`: `box` (`center`, `dimensions`); `cylinder` (`center`, `radius`, `height`, Z-axis, center means midpoint); `boolean` (`operator`: `union|subtract|intersect`, `left`, `right`); `inspect` (`body`); `tessellate` (`body`, fixed safe tessellation initially); `export-step` (`body`); `delete` (`body`). References `{bodyId, bodyRevision}`.
- Success JSON `{ok:true,result}`; failure JSON `{ok:false,error:{code,message}}`. Result shapes documented after implementation; creation/boolean publish only validated nonempty single solids. Existing input bodies remain immutable. Delete is sandbox resource release only.
- Non-supported methods/media/unknown operations/keys, malformed numbers and unsafe resource requests fail explicitly. GET does not initialize the kernel.

## Acceptance criteria

1. Actual kernel box/cylinder/boolean operations, BRep validity, positive volume, topology and measured bounds; never mesh/analytic fallback presented as solid verification.
2. Immutable body handles with explicit references and source binding; unknown/stale/deleted references rejected. Failed operations cannot publish a body or modify inputs/project.
3. Plain arrays for vertices/normals/triangle indices and plain STEP output; no kernel/viewer types cross adapter boundary. Test tessellation bounds and STEP round-trip dimensions/units.
4. Bounded request bodies, stored bodies, coordinates/dimensions/boolean complexity/output; isolated kernel worker, one in-flight operation with timeout termination/reset semantics, cleanup on server close. Kernel failure leaves non-CAD HTTP usable.
5. HTTP tests cover successful workflow, malformed/stale/cross-session requests, method/media rejection, empty/failed boolean, resource limits, deletion and unchanged `/project`.
6. `pnpm verify`, direct live HTTP workflow, frozen install check; inspect actual diff preserving task011/task012; independent fresh-context review. Browser check not required unless rendering/UI changes are introduced.

## Delegation

Kernel/API implementation is delegated to a focused child (contracts, geometry, server implementation and operation-specific unit tests). Parent owns task/API docs, independent HTTP acceptance tests, full verification, live HTTP evidence and orchestration. Independent fresh-context reviewer follows implementation.

## Risk gate

GitNexus repository `cad-agent` at `/Users/kevin/Coding/spatial-cad-harness`, index HEAD33723f1 (2026-10-14T03:45Z), dirty task011/task012 files retained. `createDemoServer` upstream impact MEDIUM: six direct callers (HTTP/data audit scripts and entrypoint), seven total, one affected measureHttp flow. Preserve signature/default behavior and regress baseline HTTP. `GeometryAdapter` impact LOW (agent-harness plus docs), left unchanged; add separate CAD interface. Index may omit newly untracked source; source/test confirmation required. No graph certification claimed.

## Completed criteria and verification

All six acceptance criteria completed within the bounded sandbox scope. [API and exact limits](../cad-engine.md); new kernel/worker/HTTP source and `tests/cad-engine.test.ts`, `tests/cad-http.test.ts` are implementation artifacts. No task013 UI changes or browser check; no browser behavior is certified by this slice. Previous dirty task011/task012 source/docs preserved; no commit/staging.

Environment: Nodev22.23.3, pnpm10.34.6.

- `pnpm verify`: passed typechecks, **138/138 tests**, web build/server typecheck. `/tmp/spatial-task013-parent/verify.log`. Existing >500kB web bundle warning retained; Svelte0errors/0warnings.
- `pnpm install --frozen-lockfile`: passed. `/tmp/spatial-task013-parent/install.log`.
- Parent independent public workflow: `pnpm exec tsx --test tests/cad-http.test.ts`: **2/2 passed**. `/tmp/spatial-task013-parent/http-tests.log`. Actual real server/kernel, create/cylinder/subtract/inspect/mesh/STEP/delete, stale/cross-session/invalid transport/busy and unchanged project checks.
- Child actual-kernel/shared-chat checks **21/21**, live HTTP workflow and three lifecycle repetitions: `/tmp/spatial-task013-child/handoff.md` references exact commands/logs. Live workflow `pnpm exec tsx /tmp/task013-live-child.mts` passes box/cylinder/subtract/mesh/meterSTEP/inspect/delete and unchanged project; `/tmp/task013-live-child.log`.
- Independent fresh review: `/tmp/spatial-task013-review/review.md`, hashes and scripts/logs beside it. No actionable source defect. Independent focused **15/15**, baseline regression **17/17**, `pnpm typecheck`, actual unexpected worker failure/reset, mesh winding/volume, slow-body timeout, chunked size-limit recovery and unchanged project probes pass. Source READY; full checks and documentation completion independently owned by parent. Final narrow documentation review `/tmp/spatial-task013-review/docs-review.md` found four low-severity wording/table issues, corrected by parent; actual documented client example passed with unchanged `/project` (`docs-example.log` beside the review).
- Final `git diff --check` and task013 diff/source inspection passed. Source review did not equate sandbox validity with complete approved edit postconditions. Exact input bodies immutable; single-solid/nonempty/loose-topology checks and meter STEP reread gates executed.

## Remaining limitations / next action

- GitNexus pre-edit `createDemoServer` MEDIUM (review with tests resolves12direct/13total and measureHttp family); new CAD symbols UNKNOWN/not indexed, confirmed via source. Parent and reviewer `detect_changes(scope:'all')` omit untracked source despite returning tracked changes/zero affected processes. **Not clean graph certification**; no commit requested and no index refresh performed. Reviewer could not use installed unsupported explain/PDG command. Do not infer unaffected new CAD flows.
- Parent `lsp_diagnostics(tests/cad-http.test.ts)` reports4missing-export errors from the same stale cache seen in task012, including already-existing PROJECT_FRAME_ID; final workspace cache reports161errors+1other across15files. Diagnostics artifact `/tmp/spatial-task013-parent/lsp-cache.log`. Independent touched-source LSP and complete CLI typecheck pass. No source workaround or weakened check. Parent LSP is not clean/certified.
- Worker heap limit excludes WASM/native allocations; bounded workload/time/outputs are not an absolute native-memory quota/security audit. Loopback listener is required; Host/Origin checks are not peer authentication.
- Sandbox handles invalidated on dispatched cancellation, timeout/unexpected failure or restart; no persistence, import, transform, model registration, approval/undo, project commit or viewer integration.

Next bounded product step: explicitly scope authoritative sessions and exact-proposal approval/atomic publication before connecting sandbox CAD output to editable project/viewer/chat. Earlier task reviews remain separate. Completion handoff: `/tmp/spatial-task013-completion/handoff.md` (suggested skills and artifact references).
