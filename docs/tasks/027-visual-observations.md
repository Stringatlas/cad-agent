# Task027 — Fixed-view visual observations and spatial grounding

Status: implemented and independently corrective-reviewed (user authorized next harness must-have). Whole-checkout fresh-session review remains pending.

## Scope and acceptance
- Explicit capture in demo and Toronto scenes: PNG bytes and SHA256, drawing-buffer viewport, camera pose/projection, local meter frame/origin, source revision, view generation, actual displayed sampling/detail coverage.
- Renderer-owned disposable capture adapter; no renderer types in shared observation contracts. Capture consistency checked across asynchronous hashing. Camera, resize, scene/overlay, dataset/detail and lifecycle changes invalidate retained observations.
- Pixel references use image top-left drawing-buffer coordinates and observation ID. Resolution returns original point provenance, ambiguous or no-hit, and fails closed on stale/invalid references. Never promote GPU coordinate/index hints to stable identity.
- Conservative resolution over captured displayed layers only; sampled/partial display never claims whole-dataset coverage. Existing whole-dataset semantic queries remain independent.
- UI preview, metadata/export, explicit pixel resolution and clear stale feedback. This slice is local visual observation infrastructure: images are NOT sent to the existing text-only model transport; no live inference or provider/account changes.
- Deterministic fixtures cover projection/pixel validation, ambiguity/no-hit, original provenance and stale changes. Isolated browser fixtures check capture legibility, resolution and invalidation. Run baseline verification and independent incremental review.

## Exclusions
No autonomous navigation, segmentation, CAD expansion, service restart, live model call, account/config change, index rebuild or commit. Preserve pre-existing task025/026 changes and user AGENTS.md edits. Full-checkout fresh-session review remains separate.

## Delegation
Core agent: new shared visual contracts + disposable web capture helper + focused tests (no existing viewers/UI).
Toronto agent: Toronto viewer adapter and Toronto UI wiring only, using the helper API.
Parent: demo viewer/UI integration, task/docs, checks and coordination. Independent reviewer after implementation; isolated browser verifier may be delegated.

## Implementation and usage
Open either scene's **visual observation · fixed-view capture** section, choose **Capture current view**, then inspect the PNG/metadata or resolve an integer image pixel using the preview/fields. Download exports the exact local PNG data URL plus metadata; the panel never sends it to the provider. A changed view marks the bundle stale and disables preview/export until recapture; resolution independently rejects stale IDs. Only the latest observation is retained.

Shared JSON-only contracts are in `packages/contracts/src/visual-observation.ts`; `apps/web/src/visual-capture.ts` owns the disposable renderer adapter. Existing authoritative point/pick caches supply original binary64 provenance. Both viewers integrate the shared panel and pinned-Three OrbitControls idle stabilization (`orbit-stability.ts`). Camera pose is not silently rounded in the bundle/signature; real input and damping remain detectable.

## Verification and evidence
- Node `v22.23.3`, pnpm `10.34.6`.
- `pnpm verify` — final **569/569 tests**, typecheck (Svelte 0 errors/warnings), production build and server typecheck pass. `/tmp/spatial-task027/final-verify.log`. Build retains existing large-chunk warning.
- `node /tmp/spatial-task027/browser.cjs > /tmp/spatial-task027/final-browser.log 2>&1` — **110 isolated checks PASS** against final minified build using existing CDP9222. Desktop/mobile PNG dimensions/hash/nonblank/legibility, original Toronto/synthetic provenance, invalid/no-hit, latest-only image, JSON export, camera/resize/overlay/selection/LOD/detail stale rejection, and idle/scroll currency pass. `/tmp/spatial-task027/browser-metrics.json`, `browser-{desktop,mobile}-{toronto,demo}.png` + `.ax.yml`, `*-capture.png`/`*-metadata.json`, and `toronto-observation-export.json`.
- All browser APIs are fixture-intercepted on an owned ephemeral loopback static server; deliberate302/303 redirects toward real3001 are denied before network. No model sends, application console errors, interceptor/server errors or nonowned requests after the deny proof. Owned context/server closed; existing Chrome untouched. No live-data/full-resolution performance certification.
- Independent incremental review first reproduced three clipping/occlusion errors and later target-roundoff staleness. Corrected with regression fixtures: `tests/visual-observation.test.ts` and `tests/orbit-stability.test.ts`. Final fresh corrective review **READY, no actionable task027 findings**: `/tmp/spatial-task027/final-review.md` (28/28 focused tests, original projection probe corrected and idle divergence0/300 for each viewer). Earlier failures remain in `/tmp/spatial-task027/independent-review.md` and `corrective-review.md`; they are superseded, not hidden.
- GitNexus bound to `cad-agent` at this checkout, index one commit behind HEAD. Viewer impact is UNKNOWN; source confirmed Demo/Toronto/ClosestPole callers. Core/barrel impact warned CRITICAL before additive exports. Aggregate `detect_changes` is CRITICAL across pre-existing025/026 edits and truncated, not a clean slice certificate. No index refresh/commit performed. Parent cached LSP still reports stale missing exports despite clean CLI and independent child checks; no source workaround or clean LSP certification claimed.
- Final `git diff --check` passes; actual diff/new files inspected. Existing task025/026/user AGENTS.md changes preserved. No service/account/config change or live model call.

## Remaining limitations and next gate
Images are not yet provider/VLM input. Evaluation runner, capability-safe visual transport and broader verified model tools need separate bounded tasks; do not expand automatically. Three private OrbitControls idle-state fields are pinned/tested; changed internals fail closed to normal updates rather than suppressing motion. Explicit pixel resolution is synchronous over displayed points and may be slow/memory-intensive for uncapped detail; timer currency checks never raycast. Resolution is conservative around crowded/duplicate layers and can return ambiguous/no-hit; it is not segmentation, CAD verification or whole-dataset evidence. Full-checkout fresh-session review and graph coverage remain pending separately.

Completion handoff: `/tmp/spatial-task027/completion-handoff.md`.
