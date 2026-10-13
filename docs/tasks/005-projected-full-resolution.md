# 005 — Uncapped full-resolution projected-window display

Status: Resolved / complete — independent bounded feedback/stream-interaction review completed; one resource-failure gesture bypass fixed and tested. User confirmed browser correctness/adequate selection performance; automated Chrome checks remain unavailable. Parent/fresh-session spot-check of the review-owned correction remains pending.

## User decision / scope
The user requested: “remove the hard cap and allow a shift click-drag select window to get full resolution for that volume projection”. This **supersedes task004's arbitrary total crop point/source-work limits**, not the independent ordinary display/harness sample limits. No data regeneration, global installs, deployment, commits, index regeneration or CAD/model work. Preserve unrelated untracked baseline.

## Acceptance criteria
- [x] User-reported browser correctness confirmation (not automated browser evidence): implemented Shift-left-drag shows a screen rectangle, suppresses orbit, and automatically streams every stored point in its actual camera frustum/prism × dataset extent. Freeze camera planes at release; no arbitrary AABB substitute. Tiny Shift-click can retain existing point-based box placement.
- [x] Existing numeric AABB workflow also loads full resolution without total point/source-work/deadline caps; ordinary display/harness LOD unchanged.
- [x] Backpressured bounded source reads/stream batches/GPU chunks; all hierarchy levels/proxies/ancestors/descendants, conservative pruning and exact inclusive point membership. Retain format/input/security safeguards.
- [x] Progressive counts explicitly partial until completion; cancellation, clearing, stale-generation protection and scene disposal. Resource/transport failures honest; no silent sampling. Document GPU exhaustion and noninstantaneous cancellation.
- [x] Fixtures cover perspective/orthographic/oblique projection, boundaries, hierarchy corruption, >old caps, backpressure/cancellation, client framing, GPU disposal and harness independence.
- [x] `pnpm verify`, bounded actual-data checks with explicit CLIENT cancellation, prior sample regression; browser script extended for actual Shift-drag/progress/cancel. Attempt existing Chrome; blocked is not passed.
- [x] Inspect owned changes including untracked baseline; docs/evidence/temp handoff. Independent bounded feedback/stream-interaction review completed below; earlier task reviews remain separate.

## Bounded feedback follow-up (before implementation)

User report: “I verfied correctnes in browser. performance for selections is good enough. add feedback. then resolve”. This is **user verification** of existing correctness/performance, not agent automated browser evidence or screenshots. No further optimization, caps, downsampling or full streaming rewrite is requested. Resolve implementation findings and prepare independent review, not self-approve the task.

Additional acceptance criteria:
- [x] Compact explicit selection mode and local-meter volume bounds; projected bounds labelled as dataset extent, not actual frustum bounds.
- [x] Loaded count and scanned/source-read progress while streaming; unknown selected total clearly stated, no invented percentage/ETA. Avoid per-batch live-region status chatter.
- [x] Distinguish loading, completed (including empty), cancelled/incomplete and failed/incomplete; Cancel only while loading, Clear for retained detail, retry the same selection after cancel/error.
- [x] Retain large uncapped-selection resource warning and independent display/harness controls; no server/geometry changes.
- [x] Status/progress/control tests and `pnpm verify`; record automated browser availability honestly; inspect bounded incremental diff, temp handoff, fresh independent review pending.

### Feedback follow-up evidence / resolved implementation findings

Owned follow-up files: `apps/web/src/Toronto.svelte`, new `crop-feedback.ts`, new `tests/crop-feedback.test.ts`, `scripts/browser-toronto-smoke.mjs`, README and task/preview docs. No server, dataset, preprocessing, harness algorithm or geometry edits. The baseline is untracked, so incremental no-index source/script patches were inspected rather than relying on empty `git diff`.

Resolved during implementation: completion is now set only after the validated transport finishes (not on receipt of `end`, which could still be followed by malformed framing); Cancel cannot relabel a completed/idle result as incomplete; GPU/viewer failure explicitly reports error rather than user cancellation and blocks retries until scene reload. Stable live-region status changes only at phase boundaries; visible progress updates still show actual work, including empty matched batches. Retry preserves frozen projected volume or current unchanged numeric box, replacing old partial detail rather than accumulating duplicates.

| Exact command / evidence | Result | Artifact |
| --- | --- | --- |
| `pnpm exec tsx --test tests/crop-feedback.test.ts tests/crop.test.ts tests/crop-concurrency.test.ts` | PASS 15/15; mode/bounds, unknown total/source progress, empty/terminal/cancel/error/clear controls, end-then-framing-error; existing stream/cancellation/GPU regressions | `artifacts/selection-feedback/focused-tests.log` |
| `pnpm verify` | PASS; Svelte 0 errors/0 warnings; 32/32 tests; web build/server typecheck. Existing >500KiB bundle warning remains (621.99kB JS). | `artifacts/selection-feedback/verify.log` |
| `node --check scripts/browser-toronto-smoke.mjs` | PASS syntax only; new selection/progress/phase-aware controls and frozen-selection retry assertions are implemented but NOT run in Chrome | `artifacts/selection-feedback/browser-syntax.log` |
| `curl --max-time 2 -sS http://127.0.0.1:9222/json/version`; daemon socket probe | BLOCKED exit7 connection refused; socket absent; no callable browser setup tool in child. No fresh automated UI checks/screenshots. User's prior browser confirmation remains valid; do not require repeating established correctness/performance. | `artifacts/selection-feedback/cdp-probe.log` |
| GitNexus impact for UI/`loadSelection`/`createCropChannel`/browser script, concept query and `detect_changes(scope:all)` | UNAVAILABLE same LadybugDB read-only recovery failure; risk UNKNOWN, not low. Manual source confirms local handlers ← Toronto UI ← App scene switcher and test selectors ← browser script. Script referenced by README/docs only; no index rebuild or commit. | Tool results and current source |
| Incremental `git diff --no-index` / `git diff --no-index --check` whitespace inspection | Source and browser-script changes reviewed; new helpers/tests and docs read directly. No whitespace diagnostics; no-index exit1 records file differences (not a clean tracked-git diff). | `artifacts/selection-feedback/Toronto.incremental.patch`, `browser.incremental.patch`, `change-inspection.txt` |

The implementation checkpoint above preceded independent review. Independent bounded review is now recorded below; automated verification of the new feedback UI remains blocked by browser infrastructure.

### Independent isolated review / resolution

A separate child reviewer inspected AGENTS/task/preview/coordinate/architecture guidance, actual Toronto UI, crop feedback/client/render/viewer, full-resolution traversal, feedback/stream/concurrency fixtures, and `artifacts/selection-feedback/{Toronto,browser}.incremental.patch` (not the meaningless empty tracked diff). Scope: feedback and interactions with the existing uncapped stream, stale generations, retry/cancel/clear/validated completion/error controls, honest counts/bounds, harness independence and resource warning. This is not an independent completion review of tasks001–004, a whole-dataset audit, or a fresh browser/GPU certification.

**Finding resolved:** GPU failure disabled reload/retry buttons but Shift-drag still invoked `selectWindow`, allowing a new HTTP stream and clearing the retained failure feedback. Added shared viewer-availability feedback policy and guards before selection mutation/clearing/loading; ordinary transport failures remain retryable, Clear remains available for retained detail. Added policy regression covering every phase and resource-vs-transport failure. No caps/downsampling, stream protocol/server, harness, geometry or dataset changes. The reviewer-owned correction still needs a parent/fresh-session spot-check; it is not self-approved fresh-session review.

**Verdict:** no remaining blockers in the reviewed feedback/stream-interaction scope. Task005 resolved with the user's explicit browser correctness and adequate-performance confirmation recorded as **user verification**, not automated browser passing. New feedback native UI and real GPU-failure gesture behavior were not exercised in Chrome.

| Independent command / evidence | Result | Artifact |
| --- | --- | --- |
| `pnpm exec tsx --test tests/crop-feedback.test.ts tests/crop.test.ts tests/crop-concurrency.test.ts` | PASS 16/16 after guard fix (initial independent baseline also passed 15/15) | `artifacts/selection-feedback/review/focused-tests.log` |
| `pnpm verify` | PASS; Svelte 0 errors/0 warnings, 33/33 tests, build/server typecheck; existing >500KiB JS warning remains (622.06kB). Initial independent baseline passed 32/32. | `artifacts/selection-feedback/review/verify.log` |
| `node --check scripts/browser-toronto-smoke.mjs` | PASS syntax only | `artifacts/selection-feedback/review/browser-syntax.log` |
| `curl --max-time 2 -sS http://127.0.0.1:9222/json/version`; daemon socket probe | BLOCKED exit7/CDP connection refused; daemon socket absent; no callable setup tool. No automated browser assertions/screenshots run by reviewer. | `artifacts/selection-feedback/review/cdp-probe.log` |
| GitNexus concept query; upstream impacts for `loadSelection`, `selectWindow`, `cropFeedback`; `detect_changes(scope:all)` | UNAVAILABLE LadybugDB read-only shadow-page recovery; risk UNKNOWN, graph callers/processes unresolved. Manual source confirms helper ← Toronto + focused tests, selection callbacks ← local viewer; load callers are Toronto reload/retry/box/window handlers. No regeneration/commit. | Tool results; current source |
| Review-owned incremental no-index patches and `git diff --no-index --check` | Inspected all three bounded source/test patches; no whitespace diagnostics | `artifacts/selection-feedback/review/{Toronto,feedback,feedback-test}.incremental.patch`, `whitespace.log` |

Remaining limitation: automated feedback/browser coverage is unavailable; existing user's browser confirmation is accepted without asking for repetition. Next bounded action: parent/fresh-session spot-check of the review-owned guard diff. Review handoff: `/tmp/spatial-cad-selection-feedback-review-handoff.md`.

## Checkpoint
Graph concept query/upstream impact attempts are unavailable (LadybugDB read-only shadow-page recovery); risk UNKNOWN, callers/processes unresolved, not low. Manual source confirmation: `readFullResolutionCrop` ← `PotreeDataset.crop` ← fixed crop route; `createCropChannel`/render helpers ← Toronto.svelte/viewer; `createTorontoViewer` ← Toronto.svelte. Fixtures/actual-data/browser scripts are additional callers. Harness `observe` still uses `sample(lod,'harness')`; no product-agent boundary changes.

Implementation: fixed GET crop endpoint now bounded NDJSON start/batch/end stream; selection optionally has six normalized inward local-meter planes. Per-request input length, 64KiB hierarchy chunks, depth24, safe offsets/types/ranges, proxy/root agreement/cycle/overlap checks remain. Point payload reads segmented ≤4MiB and events ≤8192 decoded points; no total work/points/time budget. One pair of ranges per visited node/chunk is retained for corruption detection, not point arrays. Browser retains progressive independent typed GPU chunks, never a giant JSON/combined point array.

## Verification / evidence

Node22.23.3 / pnpm10.34.6; existing dependencies only. Independent bounded feedback/stream-interaction review: separate child reviewer, recorded above. This does not approve tasks001–004.

| Exact command | Result | Artifact |
| --- | --- | --- |
| `pnpm verify` | PASS: all typechecks; Svelte0 errors/0 warnings; 28/28 tests; web build/server typecheck. Existing >500KiB bundle warning retained (619.83kB JS). | `artifacts/projected-full-resolution/verify.log` |
| `pnpm exec tsx --test tests/crop.test.ts tests/crop-concurrency.test.ts` | PASS: 11/11 focused tests including HTTP disconnect/backpressure/generator return/slot recovery | `artifacts/projected-full-resolution/fixtures.log` |
| `pnpm exec tsx scripts/check-toronto-crop.ts` | PASS: three complete small boxes, repeat/nested/projected exact equality, actual nested proxies through depth9; large AABB/projected queries CLIENT-cancelled beyond old100k point cap; HTTP stream/adapter hash equality; harness identical | `artifacts/projected-full-resolution/actual-crops.log`, `actual-crops.json` |
| `pnpm exec tsx scripts/check-toronto-preview.ts` | PASS: existing independent sampled display/harness actual-data regression | `artifacts/projected-full-resolution/preview-regression.log`; existing `artifacts/toronto-preview/actual-samples.json` |
| `node --check scripts/browser-toronto-smoke.mjs` | PASS syntax only, NOT browser behavior | `artifacts/projected-full-resolution/browser-syntax.log` |
| `node scripts/browser-toronto-smoke.mjs` | BLOCKED/nonzero: `ECONNREFUSED 127.0.0.1:9222`; zero completed browser assertions/screenshots | `artifacts/projected-full-resolution/browser.log`, `browser/report.json` |
| `pnpm verify:browser` | BLOCKED/nonzero: same CDP refusal | `artifacts/projected-full-resolution/demo-browser.log`, `artifacts/browser/report.json` |
| `curl --max-time 2 -sS http://127.0.0.1:9222/json/version` | BLOCKED/exit7: connection refused; `/tmp/pi-browser-daemon.sock` absent; no callable browser_setup tool in child | `artifacts/projected-full-resolution/cdp-probe.log` |
| GitNexus upstream impacts (`readFullResolutionCrop`, `createTorontoViewer`, `createDatasetRoutes`, `crop`, `createCropChannel`, `replaceCropGeometry`, `fetchCrop`), concept query and `detect_changes(scope:all)` | UNAVAILABLE: LadybugDB shadow-page read-only recovery failure. Risk UNKNOWN, graph callers/processes unresolved, not low. Manual source confirmation above; no regeneration/commit attempted. | Tool results; current source and owned diff |
| Owned-file `git diff --no-index --check` and incremental no-index comparison against saved task004 owned patch | PASS whitespace; source/read/diff inspected, including untracked files. Ordinary `git diff` empty is not meaningful here. | `artifacts/projected-full-resolution/change-inspection.txt`, `owned-files.patch`, `incremental-task004.patch` |

### Actual prepared-data checks

Complete 5m boxes retained exact counts11 /1427 /10914 and source bytes402721 /3118489 /11637164; corresponding nested2m counts6 /279 /1420. Oblique projected windows intersected with those small test extents exactly equal filtering each complete box (8 /396 /3787 points). Larger production-style full-dataset volumes were **not completed or sampled**: the integration client deliberately aborted whole-dataset AABB after132314 matched/scanned points (7279206 source bytes), and a camera-window query after155967 scanned/111079 matched points (8580121 bytes). These client thresholds are test safety policy, NOT server limits. Fixture streaming separately completed300003 points and >64MiB source with ≤4MiB individual reads, so both old total limits are regression-tested. This is not an exhaustive78M-point audit or proof of whole-cloud GPU capacity.

### Browser coverage / limitation

Extended script exercises tiny Shift-click/AABB10914-point detail; >100k AABB progressive display then client cancellation; actual Shift-held mouse down/move/up with overlay screenshot assertion, unchanged camera during gesture, automatic projected partial state, independent harness hash, Cancel/Clear, ordinary orbit/zoom/resize and scene switching. Current CDP attempts fail before opening a page: browser/native events, visual framing/overlay, GPU error reporting and real scene-disposal behavior remain unverified. No Chrome launch/install/profile changes were attempted.

### Resource and review notes

Large selections may exhaust browser/GPU memory or run for a long time; chunking is not a total-memory guarantee. GPU context loss, render exceptions and WebGL error codes (including OUT_OF_MEMORY) are surfaced, with loading cancelled and incomplete detail labelled; reload the scene after GPU failure. Cancellation stops future work, not an already-running OS read/browser frame/GPU command. Format depth24/chunk64KiB, per-read4MiB, safe input/range/security checks remain; total hierarchy records/chunks/work/time limits are removed. Hash algorithm intentionally changed from monolithic task004 to deterministic streaming batch encodings.

Owned scope: shared crop types/exports; server crop/potree/routes; Toronto UI/viewer/crop client/render/projection helper; two crop tests; two crop/browser scripts; README, architecture/preview/task docs. No other source/data/preprocessing/toolchain files were edited. Saved task004 patch is a historical comparison baseline, not a claim that the entire untracked workspace was agent-created.

## Next action / handoff

Task005 is resolved in the bounded independently reviewed feedback/stream-interaction scope. Parent/fresh session to spot-check the review-owned resource-failure guard correction; tasks001–004 retain their own pending reviews. User has already confirmed browser correctness and adequate performance; do not require repeating that confirmation. If existing Chrome becomes available, new feedback assertions/visual inspection remain useful, but automated-browser blockage must stay distinguished from user verification. Redacted review handoff: `/tmp/spatial-cad-selection-feedback-review-handoff.md`; implementation handoffs remain `/tmp/spatial-cad-selection-feedback-handoff.md` and `/tmp/spatial-cad-projected-full-resolution-handoff.md`.
