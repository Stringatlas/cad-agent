# 031 — Verified nearest-label selection and approved point moves

Status: Implemented and fixture-verified. Independent bounded safety/browser review found no blocking defect; whole-checkout fresh-session review remains pending. No commit.

## Authorization and scope
User approved query → select → preview → human Approve → Undo, using a reversible override layer rather than rewriting prepared data. Initial operation is translation of up to 32 selected Toronto source records. Preserve existing dirty tasks025–030 and unrelated operator changes. This is not synthetic-project mapping, CAD, relabel/delete, edited-index search, disk persistence or a model mutation tool.

## Acceptance criteria
- [x] Live model exposes read-only `scene.nearest_label`, resolving a named attached reference through the existing indexed query and independent verifier. Strict arguments, revision checks and cancellation remain enforced.
- [x] Both model results and deterministic nearest-label UI support explicit selection into numbered scene references, preserving original request, witness and verification lineage. No automatic selection or edits from model text.
- [x] Separate server-owned volatile Toronto authority binds dataset/artifact, session, revision, meters and local frame; independently rereads original records before proposing or publishing. Prepared source files are untouched.
- [x] Retained exact proposals show before/after coordinates and distinct uncommitted preview; human approval submits only the held proposal ID and authority preconditions. Atomic multi-point commit and strict latest-first Undo advance revisions and reject stale/replayed/unknown approvals.
- [x] Actual overview/detail GPU point positions move by stable source keys; unloaded overridden records have real point geometry. Repeated translations use effective positions, Undo restores source geometry, and render caches never own authority.
- [x] UI invalidates stale selection/source/request generations and blocks writes after ambiguous failures until explicit Refresh. Original versus effective coordinates and volatile lifetime are labeled.
- [x] Searches and model references remain explicitly original-prepared-dataset geometry, never claimed as edited nearest results. Screenshots are explicitly unavailable while overrides or move previews exist, preventing false source-grounded imagery.
- [x] Typechecks, all tests, build, isolated built-browser workflow, diff inspection and temporary handoff recorded. Operator servers/auth/config/persistence were not modified.

## Implementation/API
- Contracts: `packages/contracts/src/point-overrides.ts`.
- Volatile authority/routes: `apps/server/src/point-overrides.ts`, `point-override-routes.ts`, wired in `index.ts`.
- `GET /datasets/toronto3d/overrides`; POST `/propose`, `/approve`, `/undo`. Replies are `{ok:true,result}` or `{ok:false,error}`. Local access/body/admission/resource bounds apply.
- Propose: `{sessionId,revision,artifactRevision,points:[{key,position}],translation}` where position is current effective binary64 position. Approval: `{sessionId,revision,proposalId}`. Undo: `{sessionId,revision,transactionId}`.
- UI: `PointEdits.svelte`, `point-override-client.ts`, workspace/chat/scene wiring. Renderer: `point-override-render.ts`, `toronto-viewer.ts`.
- Full verified query evidence remains on the local attached reference; strict model reference transport retains original fields, not arbitrary extra evidence. Server model tools return their own verified original-source result.

## Verification and artifacts
- `pnpm verify > /tmp/task031-verify.log 2>&1`: workspace/test typechecks PASS, Svelte 0 errors/0 warnings; test launcher BLOCKED by sandbox `tsx` IPC listen EPERM. Not reported as a passing aggregate.
- Equivalent tests: `node --import tsx --test tests/*.test.ts > /tmp/task031-tests-final.log 2>&1`: PASS **641/641**, no skipped tests.
- `pnpm build > /tmp/task031-build-final.log 2>&1`: PASS web bundle + server typecheck. Existing Vite >500kB chunk advisory remains.
- Independent review reran 34/34 task031 tests, 641/641 full suite and build; logs `/tmp/task031-review-tests.log`, `/tmp/task031-review-all-tests.log`, `/tmp/task031-review-build.log`.
- `node --import tsx scripts/browser-point-edits-smoke.mjs http://127.0.0.1:9222 /tmp/task031-browser-review`: PASS against existing Chrome. Isolated ephemeral backend/prepared two-record fixture/project; built assets intercepted at allowed local web origin. Existing occupied servers remained untouched. Real indexed query, model-tool execution via synthetic provider transport, explicit result selection, preview/no commit, approval, repeated move, stale rejection, Refresh and both Undo operations passed. GPU upload assertions prove loaded point attributes moved and restored; original payload bytes unchanged.
- Browser artifacts: `/tmp/task031-browser-review/report.json`, `loaded-record-gpu-upload.json`, `model-tool-evidence.json`, four numbered screenshots and AX snapshots. One expected HTTP409 console message from deliberate stale approval; no unexpected runtime errors. Parent inspected approved-render screenshot. Earlier exploratory failure artifacts may remain; final report is authoritative.
- Browser daemon setup failed; direct existing Chrome CDP verification succeeded. No Chrome launch or operator credential usage.
- LSP requested after edits; cached parent TS server still incorrectly reports missing `TorontoDraftPoint.evidence` in `point-override-client.ts` despite that field being present. Authoritative full CLI TypeScript and Svelte checks pass. Do not claim clean parent cached-LSP certification.
- Pre-edit impacts recorded by implementers: model/provider/route callers and processes checked; new/Svelte symbols often UNKNOWN, confirmed against source references rather than treated unused. Index refresh rebuilt local graph but failed registry lock EPERM (`/tmp/task031-index.log`). Whole-dirty graph change analysis reports CRITICAL scope spanning prior tasks, with stale/untracked/response coverage limitations; no clean graph certification. CLI rerun `/tmp/task031-graph-changes.json` and `.err`; no commit.
- `git diff --check`: PASS. Independent review/handoff: `/tmp/task031-review-handoff.md`.

## Limits and next action
Server restart discards overrides/proposals/history. Artifact replacement fails closed until restart. Initial display/authority race can conservatively require visible Refresh. Display-only detail membership and indexed queries use original geometry. Browser evidence is a two-record prepared fixture, not production-scale rendering/performance or live-model inference. No persistence/export or arbitrary model-proposed translation operation is added. Local single-user access restrictions are not public-hosting authorization.

Next: fresh-session review of task031 against this task and actual changes, preserving the unrelated dirty checkout; production-data/live-provider checks remain separate. Completion handoff: `/tmp/task031-completion-handoff.md`.
